from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .alert_queries import build_score_feed_registration
from .algorithms import aggregate_rule_scores, evaluate_series
from .canonical import aggregate_raw_points, build_raw_point, score_points
from .config_loader import ConfigError, load_config
from .dynamic_rules import DynamicRuleRegistry, RegistrationError
from .display_names import resolve_series_display_name
from .models import AppConfig, RuleConfig, RuleSnapshot, SeriesSnapshot, SeriesState
from .prometheus_api import PrometheusClient, PrometheusQueryError
from .sinks import build_sink_manager
from .sinks.base import SinkManager
from .sources import SourceQueryError, build_source_reader, normalize_source_type

DEFAULT_DYNAMIC_STATE_PATH = '/app/state/dynamic_rules.json'
LOGGER = logging.getLogger('grafana_anomaly_exporter')
MIN_OVERDUE_SLEEP_SECONDS = 0.05


def next_cycle_sleep_seconds(interval_seconds: float, elapsed_seconds: float) -> float:
    return max(MIN_OVERDUE_SLEEP_SECONDS, max(0.0, interval_seconds) - max(0.0, elapsed_seconds))


SEVERITY_LEVELS = {'normal': 0, 'low': 1, 'medium': 2, 'high': 3, 'critical': 4}
DATA_QUALITY_LEVELS = {'healthy': 0, 'thin': 1, 'flatline': 2, 'gappy': 3}
PROMETHEUS_DYNAMIC_LABELS = {
    'severity_label',
    'confidence_label',
    'data_quality',
    'data_quality_label',
    'score_driver',
}


class BackpressureError(RegistrationError):
    def __init__(self, message: str, status: dict[str, object]) -> None:
        super().__init__(message)
        self.status = status


class ExporterRuntime:
    def __init__(self, config_path: str, dynamic_state_path: str | None = None) -> None:
        self.config_path = Path(config_path)
        self.dynamic_state_path = Path(dynamic_state_path or (self.config_path.parent / 'state' / 'dynamic_rules.json'))
        self.dynamic_registry = DynamicRuleRegistry(self.dynamic_state_path)
        self.lock = threading.Lock()
        self.metrics_payload = self._render_boot_payload('starting')
        self.last_error = 'starting'
        self.last_reload_attempt = 0.0
        self.last_config_mtime = 0.0
        self.current_config: AppConfig | None = None
        self.rule_states: dict[str, dict[str, SeriesState]] = {}
        self.rule_snapshots: list[RuleSnapshot] = []
        self.series_snapshots: list[SeriesSnapshot] = []
        self.query_success: dict[str, int] = {}
        self.last_evaluation_timestamp = 0.0
        self.last_evaluation_duration_seconds = 0.0
        self.sink_manager = SinkManager([])
        self.sink_config_signature = ''
        self.pushed_feeds: dict[str, tuple[list[SeriesSnapshot], list[RuleSnapshot], float]] = {}

    def _render_boot_payload(self, status: str) -> bytes:
        payload = [
            '# HELP grafana_anomaly_exporter_up Whether the anomaly exporter process is running.',
            '# TYPE grafana_anomaly_exporter_up gauge',
            'grafana_anomaly_exporter_up 0',
            '# HELP grafana_anomaly_last_scrape_success Whether the last evaluation cycle succeeded.',
            '# TYPE grafana_anomaly_last_scrape_success gauge',
            'grafana_anomaly_last_scrape_success 0',
            '# HELP grafana_anomaly_exporter_info Exporter info and last error string.',
            '# TYPE grafana_anomaly_exporter_info gauge',
            self._render_sample('grafana_anomaly_exporter_info', {'last_error': status}, 1),
            '# HELP grafana_anomaly_build_info Exporter build info.',
            '# TYPE grafana_anomaly_build_info gauge',
            self._render_sample('grafana_anomaly_build_info', {'version': __version__}, 1),
            '',
        ]
        return '\n'.join(payload).encode('utf-8')

    def _load_combined_config(self) -> AppConfig:
        static_config = load_config(self.config_path)
        merged_rules: dict[str, RuleConfig] = {rule.name: rule for rule in static_config.rules}
        for rule in self.dynamic_registry.list_rule_configs():
            merged_rules[rule.name] = rule
        return AppConfig(global_config=static_config.global_config, rules=list(merged_rules.values()), sinks=static_config.sinks)

    def maybe_reload_config(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last_reload_attempt < 1:
            return
        self.last_reload_attempt = now

        try:
            config_mtime = self.config_path.stat().st_mtime
        except FileNotFoundError as exc:
            raise ConfigError(f'Config file not found: {self.config_path}') from exc

        dynamic_changed = self.dynamic_registry.reload_if_changed()
        if not force and self.current_config is not None and config_mtime == self.last_config_mtime and not dynamic_changed:
            return

        config = self._load_combined_config()
        self._reload_sink_manager_if_needed(config)
        with self.lock:
            previous_states = self.rule_states
            previous_query_success = self.query_success
            self.current_config = config
            self.rule_states = {rule.name: previous_states.get(rule.name, {}) for rule in config.rules}
            self.query_success = {rule.name: previous_query_success.get(rule.name, 0) for rule in config.rules}
            self.last_config_mtime = config_mtime
            self.last_error = ''
        LOGGER.info('config loaded rules=%s sinks=%s dynamic_rules=%s', len(config.rules), len(config.sinks), len(self.dynamic_registry.records))

    def _reload_sink_manager_if_needed(self, config: AppConfig) -> None:
        signature = repr(sorted((name, definition.enabled, definition.error, sorted(definition.settings.items())) for name, definition in config.sinks.items()))
        if signature == self.sink_config_signature:
            return
        previous = self.sink_manager
        self.sink_manager = build_sink_manager(config.sinks)
        self.sink_config_signature = signature
        previous.close()

    def register_panel_sync(self, payload: dict[str, object]) -> dict[str, object]:
        result = self.dynamic_registry.upsert_panel_registration(payload)
        self.maybe_reload_config(force=True)
        target = str(result.get('target') or payload.get('target') or payload.get('scoreFeedTarget') or 'prometheus').strip().lower()
        registered = []
        for item in result.get('registered', []):
            if not isinstance(item, dict):
                continue
            rule_name = str(item.get('rule') or '')
            if not rule_name:
                continue
            registration = build_score_feed_registration(rule_name, target, self.current_config)
            registered.append({**item, **registration})
        result = {**result, 'registered': registered}
        evaluation_interval = self.current_config.global_config.evaluation_interval_seconds if self.current_config is not None else 5
        return {
            **result,
            'evaluationIntervalSeconds': evaluation_interval,
            'dynamicRules': self.list_dynamic_rules(),
        }

    def ingest_score_feed(self, payload: dict[str, object]) -> dict[str, object]:
        self.maybe_reload_config(force=self.current_config is None)
        target = str(payload.get('target') or 'prometheus').strip().lower()
        valid_targets = {'prometheus', 'all', 'loki', 'influxdb', 'postgresql', 'clickhouse', 'elasticsearch'}
        if target not in valid_targets:
            raise RegistrationError(f'Unsupported score feed target: {target}')

        rule_name = self._safe_text(payload.get('ruleName'), 'plugin_anomaly_panel')
        panel_id = int(self._safe_number(payload.get('panelId'), 0))
        dashboard_uid = self._safe_text(payload.get('dashboardUid'), 'local_dashboard')
        dashboard_title = self._safe_text(payload.get('dashboardTitle'), dashboard_uid)
        panel_title = self._safe_text(payload.get('panelTitle'), rule_name)
        resolved_options = payload.get('resolvedOptions') if isinstance(payload.get('resolvedOptions'), dict) else {}
        rule_payload = payload.get('rule') if isinstance(payload.get('rule'), dict) else {}
        series_payload = payload.get('series') if isinstance(payload.get('series'), list) else []
        source_datasource_payload = payload.get('sourceDatasources') if isinstance(payload.get('sourceDatasources'), list) else []

        algorithm = self._safe_text(resolved_options.get('algorithm') if isinstance(resolved_options, dict) else None, 'plugin')
        severity_preset = self._safe_text(resolved_options.get('severityPreset') if isinstance(resolved_options, dict) else None, 'balanced')
        threshold = self._safe_number(resolved_options.get('sensitivity') if isinstance(resolved_options, dict) else None, 0.0)
        common_labels = {
            'feed_source': 'plugin',
            'dashboard_uid': dashboard_uid,
            'dashboard_title': dashboard_title,
            'panel_id': str(panel_id),
            'panel_title': panel_title,
            'feed_target': target,
        }
        source_datasources: list[dict[str, str]] = []
        for item in source_datasource_payload:
            if not isinstance(item, dict):
                continue
            source_datasources.append({
                'uid': self._safe_text(item.get('uid'), 'unknown'),
                'type': self._safe_text(item.get('type'), 'unknown'),
            })
        if source_datasources:
            common_labels['source_datasource_uid'] = ','.join(item['uid'] for item in source_datasources)
            common_labels['source_datasource_type'] = ','.join(item['type'] for item in source_datasources)

        series_snapshots: list[SeriesSnapshot] = []
        for index, item in enumerate(series_payload):
            if not isinstance(item, dict):
                continue
            label = self._safe_text(item.get('label'), f'series_{index + 1}')
            labels = {**common_labels, 'series': label, 'series_key': self._safe_text(item.get('key'), label)}
            timestamp = self._safe_number(item.get('timestamp'), time.time())
            series_snapshots.append(
                SeriesSnapshot(
                    rule_name=rule_name,
                    source_metric=label,
                    labels=labels,
                    value=self._safe_number(item.get('value'), 0.0),
                    expected=self._optional_number(item.get('expected')),
                    lower=self._optional_number(item.get('lower')),
                    upper=self._optional_number(item.get('upper')),
                    deviation=self._optional_number(item.get('deviation')),
                    raw_score=self._safe_number(item.get('rawScore'), 0.0),
                    point_raw_score=self._safe_number(item.get('pointRawScore'), 0.0),
                    window_raw_score=self._safe_number(item.get('windowRawScore'), 0.0),
                    score_driver=self._safe_text(item.get('scoreDriver'), 'point'),
                    normalized_score=self._safe_number(item.get('normalizedScore'), 0.0),
                    severity_label=self._safe_text(item.get('severityLabel'), 'normal'),
                    is_anomaly=bool(item.get('isAnomaly')),
                    confidence_score=self._safe_number(item.get('confidenceScore'), 0.0),
                    confidence_label=self._safe_text(item.get('confidenceLabel'), 'low'),
                    data_quality_label=self._safe_text(item.get('dataQualityLabel'), 'healthy'),
                    threshold=threshold,
                    algorithm=algorithm,
                    severity_preset=severity_preset,
                    timestamp=timestamp,
                )
            )

        if not series_snapshots:
            raise RegistrationError('Score feed payload must include at least one computed series.')

        rule_timestamp = self._safe_number(rule_payload.get('timestamp') if isinstance(rule_payload, dict) else None, max(snapshot.timestamp for snapshot in series_snapshots))
        breach_count = int(self._safe_number(rule_payload.get('breachCount') if isinstance(rule_payload, dict) else None, sum(1 for snapshot in series_snapshots if snapshot.is_anomaly)))
        rule_snapshot = RuleSnapshot(
            name=rule_name,
            algorithm=algorithm,
            severity_preset=severity_preset,
            query='plugin-computed-score-feed',
            series_count=int(self._safe_number(rule_payload.get('seriesCount') if isinstance(rule_payload, dict) else None, len(series_snapshots))),
            breach_count=breach_count,
            max_raw_score=self._safe_number(rule_payload.get('rawScore') if isinstance(rule_payload, dict) else None, max(snapshot.raw_score for snapshot in series_snapshots)),
            max_score=self._safe_number(rule_payload.get('score') if isinstance(rule_payload, dict) else None, max(snapshot.normalized_score for snapshot in series_snapshots)),
            max_severity_label=self._safe_text(rule_payload.get('severityLabel') if isinstance(rule_payload, dict) else None, max(series_snapshots, key=lambda snapshot: snapshot.normalized_score).severity_label),
            active_series=int(self._safe_number(rule_payload.get('activeSeries') if isinstance(rule_payload, dict) else None, len(series_snapshots))),
            timestamp=rule_timestamp,
        )

        feed_key = f'{dashboard_uid}:{panel_id}:{rule_name}'
        with self.lock:
            self.pushed_feeds[feed_key] = (series_snapshots, [rule_snapshot], time.time())
            merged_series = self._merged_series_snapshots_locked()
            merged_rules = self._merged_rule_snapshots_locked()
            merged_success = self._merged_query_success_locked(self.query_success)
            self.metrics_payload = self._render_metrics(
                series_snapshots=merged_series,
                rule_snapshots=merged_rules,
                query_success=merged_success,
                config=self.current_config,
                duration=self.last_evaluation_duration_seconds,
                evaluation_time=max(self.last_evaluation_timestamp, rule_timestamp),
                last_error=self.last_error,
                success=1 if not self.last_error else 0,
            )

        target_sinks: list[str] | None
        if target == 'prometheus':
            target_sinks = []
        elif target == 'all':
            target_sinks = None
        else:
            target_sinks = [target]
        is_registered_for_closed_recompute = rule_name in self.dynamic_registry.records
        if is_registered_for_closed_recompute:
            enqueue_result = None
            sink_enqueue_status = {
                'queued': False,
                'dropped': False,
                'reason': 'panel rule is registered for backend recompute; sink writes are produced by the exporter evaluation loop',
                'queueDepth': 0,
                'queueCapacity': 0,
                'droppedBatchesTotal': 0,
            }
        elif target_sinks != []:
            enqueue_result = self.sink_manager.enqueue(series_snapshots, [rule_snapshot], rule_timestamp, target_sinks=target_sinks)
            if not enqueue_result.queued:
                status = self._serialize_enqueue_result(enqueue_result)
                message = f'score feed was not queued for sink target {target}: {enqueue_result.reason}'
                LOGGER.warning(message)
                raise BackpressureError(message, status)
            sink_enqueue_status = self._serialize_enqueue_result(enqueue_result)
        else:
            enqueue_result = None
            sink_enqueue_status = {'queued': False, 'reason': 'prometheus target does not use sink queue'}

        return {
            'target': target,
            'acceptedSeries': len(series_snapshots),
            'registered': [build_score_feed_registration(rule_name, target, self.current_config)],
            'sinkEnqueue': sink_enqueue_status,
            'removed': [],
        }

    @staticmethod
    def _serialize_enqueue_result(result) -> dict[str, object]:
        return {
            'queued': bool(result.queued),
            'dropped': bool(result.dropped),
            'reason': str(result.reason),
            'queueDepth': int(result.queue_depth),
            'queueCapacity': int(result.queue_capacity),
            'droppedBatchesTotal': int(result.dropped_batches_total),
        }

    @staticmethod
    def _safe_text(value: object, fallback: str) -> str:
        text = str(value).strip() if value is not None else ''
        return text or fallback

    @staticmethod
    def _safe_number(value: object, fallback: float) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return fallback
        if number != number or number in (float('inf'), float('-inf')):
            return fallback
        return number

    def _optional_number(self, value: object) -> float | None:
        if value is None:
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if number != number or number in (float('inf'), float('-inf')):
            return None
        return number

    def _pushed_series_snapshots_locked(self) -> list[SeriesSnapshot]:
        snapshots: list[SeriesSnapshot] = []
        for series_snapshots, _, _ in self.pushed_feeds.values():
            snapshots.extend(series_snapshots)
        return snapshots

    def _pushed_rule_snapshots_locked(self) -> list[RuleSnapshot]:
        snapshots: list[RuleSnapshot] = []
        for _, rule_snapshots, _ in self.pushed_feeds.values():
            snapshots.extend(rule_snapshots)
        return snapshots

    def _merged_series_snapshots_locked(self) -> list[SeriesSnapshot]:
        return list(self.series_snapshots) + self._pushed_series_snapshots_locked()

    def _merged_rule_snapshots_locked(self) -> list[RuleSnapshot]:
        merged = list(self.rule_snapshots)
        closed_rule_names = {snapshot.name for snapshot in merged}
        for snapshot in self._pushed_rule_snapshots_locked():
            # Panel-open pushes are an immediate preview. Once the persistent
            # panel-closed recompute exists, keep rule-level alert metrics unique.
            if snapshot.name in closed_rule_names:
                continue
            merged.append(snapshot)
        return merged

    def _merged_query_success_locked(self, query_success: dict[str, int]) -> dict[str, int]:
        merged = dict(query_success)
        for _, rule_snapshots, _ in self.pushed_feeds.values():
            for snapshot in rule_snapshots:
                merged[snapshot.name] = 1
        return merged

    def list_dynamic_rules(self) -> list[dict[str, object]]:
        self.dynamic_registry.reload_if_changed()
        return [self._serialize_dynamic_record(record) for record in self.dynamic_registry.list_records()]

    def _serialize_dynamic_record(self, record) -> dict[str, object]:
        registration = build_score_feed_registration(record.rule.name, record.target, self.current_config)
        return {
            'rule': record.rule.name,
            'target': record.target,
            'query': record.rule.query,
            'sourceType': record.rule.source_type,
            'datasourceUrl': record.rule.datasource_url,
            'targetSinks': record.rule.target_sinks,
            'algorithm': record.rule.algorithm,
            'threshold': record.rule.threshold,
            'baselineWindow': record.rule.baseline_window,
            'seasonalitySamples': record.rule.seasonality_samples,
            'seasonalRefinement': record.rule.seasonal_refinement,
            'severityPreset': record.rule.severity_preset,
            'aggregation': record.rule.aggregation,
            'legend': record.rule.legend,
            'labels': record.rule.labels,
            'dashboardUid': record.dashboard_uid,
            'dashboardTitle': record.dashboard_title,
            'panelId': record.panel_id,
            'panelTitle': record.panel_title,
            'refId': record.ref_id,
            'syncHash': record.sync_hash,
            'createdAt': record.created_at,
            'updatedAt': record.updated_at,
            'alertQuery': registration['query'],
            'perSeriesQuery': registration['perSeriesQuery'],
            'queryLanguage': registration['queryLanguage'],
            'datasourceType': registration['datasourceType'],
        }

    def run_once(self) -> None:
        self.maybe_reload_config(force=self.current_config is None)
        config = self.current_config
        if config is None:
            raise RuntimeError('Config could not be loaded.')

        start = time.time()
        evaluation_time = time.time()
        client = PrometheusClient(
            base_url=config.global_config.prometheus_url,
            timeout_seconds=config.global_config.request_timeout_seconds,
        )
        errors: list[str] = []
        next_rule_snapshots: list[RuleSnapshot] = []
        next_series_snapshots: list[SeriesSnapshot] = []
        next_query_success: dict[str, int] = {}
        sink_batches: list[tuple[list[str] | None, list[SeriesSnapshot], list[RuleSnapshot]]] = []

        def query_rule(rule: RuleConfig):
            try:
                source_type = normalize_source_type(rule.source_type)
                if rule.range_seconds > 0 or source_type != 'prometheus':
                    step_seconds = rule.step_seconds or config.global_config.evaluation_interval_seconds
                    range_seconds = rule.range_seconds or max(rule.history_limit * step_seconds, step_seconds * 4)
                    matrix = build_source_reader(rule, config.global_config).query_range(
                        evaluation_time - range_seconds,
                        evaluation_time,
                        step_seconds,
                    )
                    samples = []
                elif source_type == 'prometheus':
                    matrix = []
                    samples = client.instant_query(rule.query, evaluation_time)
                else:
                    raise SourceQueryError(f'Unsupported source_type {rule.source_type!r} for rule {rule.name!r}.')
                return samples, matrix, ''
            except (PrometheusQueryError, SourceQueryError) as exc:
                return [], [], str(exc)

        worker_count = min(4, max(1, len(config.rules)))
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix='anomaly-source') as executor:
            query_results = list(executor.map(query_rule, config.rules))

        for rule, (samples, matrix, query_error) in zip(config.rules, query_results):
            next_query_success[rule.name] = 0 if query_error else 1
            if query_error:
                errors.append(query_error)

            rule_scores: list[SeriesSnapshot] = []
            rule_state = self.rule_states.setdefault(rule.name, {})
            for series in matrix:
                raw_identifier = series.labels.get('__name__', rule.name)
                source_metric = resolve_series_display_name(rule.legend, series.labels, raw_identifier, rule.name)
                merged_labels = self._merge_labels(
                    source_labels={key: value for key, value in series.labels.items() if key != '__name__'},
                    extra_labels=rule.labels,
                )
                raw_points = [build_raw_point(sample.timestamp, sample.value) for sample in series.samples]
                scored_points = score_points(
                    rule,
                    source_metric,
                    merged_labels,
                    aggregate_raw_points(raw_points, rule.bucket_span_seconds or None),
                )
                snapshot = next((candidate for candidate in reversed(scored_points) if candidate.expected is not None), scored_points[-1] if scored_points else None)
                if snapshot is None:
                    continue
                rule_scores.append(snapshot)
                next_series_snapshots.append(snapshot)

            for sample in samples:
                raw_identifier = sample.labels.get('__name__', rule.name)
                source_metric = resolve_series_display_name(rule.legend, sample.labels, raw_identifier, rule.name)
                merged_labels = self._merge_labels(
                    source_labels={key: value for key, value in sample.labels.items() if key != '__name__'},
                    extra_labels=rule.labels,
                )
                series_key = self._series_key(merged_labels, source_metric)
                state = rule_state.get(series_key)
                if state is None:
                    state = SeriesState.create(history_limit=rule.history_limit, seasonal_window=rule.baseline_window)
                    rule_state[series_key] = state
                snapshot = evaluate_series(state, rule, source_metric, merged_labels, sample.value, sample.timestamp)
                rule_scores.append(snapshot)
                next_series_snapshots.append(snapshot)

            rule_snapshot = self._build_rule_snapshot(rule, rule_scores, evaluation_time)
            next_rule_snapshots.append(rule_snapshot)
            if rule.target_sinks != []:
                sink_batches.append((rule.target_sinks, list(rule_scores), [rule_snapshot]))

        duration = time.time() - start
        last_error = ' | '.join(errors[:3])

        with self.lock:
            self.series_snapshots = next_series_snapshots
            self.rule_snapshots = next_rule_snapshots
            self.query_success = next_query_success
            self.last_evaluation_timestamp = evaluation_time
            self.last_evaluation_duration_seconds = duration
            self.last_error = last_error
            self.metrics_payload = self._render_metrics(
                series_snapshots=self._merged_series_snapshots_locked(),
                rule_snapshots=self._merged_rule_snapshots_locked(),
                query_success=self._merged_query_success_locked(next_query_success),
                config=config,
                duration=duration,
                evaluation_time=evaluation_time,
                last_error=last_error,
                success=0 if errors else 1,
            )

        for target_sinks, series_batch, rule_batch in sink_batches:
            enqueue_result = self.sink_manager.enqueue(series_batch, rule_batch, evaluation_time, target_sinks=target_sinks)
            if enqueue_result.dropped:
                LOGGER.warning('evaluation sink batch dropped reason=%s dropped_batches_total=%s target_sinks=%s', enqueue_result.reason, enqueue_result.dropped_batches_total, target_sinks)

    def loop_forever(self) -> None:
        while True:
            cycle_started = time.monotonic()
            interval = 5
            try:
                self.maybe_reload_config()
                if self.current_config is not None:
                    interval = self.current_config.global_config.evaluation_interval_seconds
                self.run_once()
            except Exception as exc:  # noqa: BLE001
                LOGGER.exception('evaluation loop failed: %s', exc)
                with self.lock:
                    self.last_error = str(exc)
                    self.metrics_payload = self._render_metrics(
                        series_snapshots=self._merged_series_snapshots_locked(),
                        rule_snapshots=self._merged_rule_snapshots_locked(),
                        query_success=self._merged_query_success_locked(self.query_success),
                        config=self.current_config,
                        duration=self.last_evaluation_duration_seconds,
                        evaluation_time=self.last_evaluation_timestamp,
                        last_error=self.last_error,
                        success=0,
                    )
            elapsed = time.monotonic() - cycle_started
            time.sleep(next_cycle_sleep_seconds(interval, elapsed))

    def read_metrics(self) -> bytes:
        with self.lock:
            return self.metrics_payload

    def _build_rule_snapshot(self, rule: RuleConfig, scores: list[SeriesSnapshot], evaluation_time: float) -> RuleSnapshot:
        breach_count = sum(1 for snapshot in scores if snapshot.is_anomaly)
        ordered = sorted(scores, key=lambda snapshot: snapshot.normalized_score, reverse=True)
        top_label = ordered[0].severity_label if ordered else 'normal'
        return RuleSnapshot(
            name=rule.name,
            algorithm=rule.algorithm,
            severity_preset=rule.severity_preset,
            query=rule.query,
            series_count=len(scores),
            breach_count=breach_count,
            max_raw_score=max((snapshot.raw_score for snapshot in scores), default=0.0),
            max_score=aggregate_rule_scores(rule, scores),
            max_severity_label=top_label,
            active_series=len(scores),
            timestamp=evaluation_time,
        )

    def _render_metrics(
        self,
        *,
        series_snapshots: list[SeriesSnapshot],
        rule_snapshots: list[RuleSnapshot],
        query_success: dict[str, int],
        config: AppConfig | None,
        duration: float,
        evaluation_time: float,
        last_error: str,
        success: int,
    ) -> bytes:
        lines = [
            '# HELP grafana_anomaly_exporter_up Whether the anomaly exporter process is running.',
            '# TYPE grafana_anomaly_exporter_up gauge',
            'grafana_anomaly_exporter_up 1',
            '# HELP grafana_anomaly_last_scrape_success Whether the last evaluation cycle succeeded.',
            '# TYPE grafana_anomaly_last_scrape_success gauge',
            f'grafana_anomaly_last_scrape_success {success}',
            '# HELP grafana_anomaly_evaluation_duration_seconds Duration of the last evaluation cycle.',
            '# TYPE grafana_anomaly_evaluation_duration_seconds gauge',
            f'grafana_anomaly_evaluation_duration_seconds {duration:.6f}',
            '# HELP grafana_anomaly_last_evaluation_timestamp_seconds Unix timestamp of the last evaluation.',
            '# TYPE grafana_anomaly_last_evaluation_timestamp_seconds gauge',
            f'grafana_anomaly_last_evaluation_timestamp_seconds {evaluation_time:.3f}',
            '# HELP grafana_anomaly_exporter_info Exporter info and last error string.',
            '# TYPE grafana_anomaly_exporter_info gauge',
            self._render_sample('grafana_anomaly_exporter_info', {'last_error': last_error or 'none'}, 1),
            '# HELP grafana_anomaly_build_info Exporter build info.',
            '# TYPE grafana_anomaly_build_info gauge',
            self._render_sample('grafana_anomaly_build_info', {'version': __version__}, 1),
            '# HELP grafana_anomaly_dynamic_rule_count Number of rules synced from Grafana panels.',
            '# TYPE grafana_anomaly_dynamic_rule_count gauge',
            f'grafana_anomaly_dynamic_rule_count {len(self.dynamic_registry.records)}',
            '# HELP grafana_anomaly_config_rule_count Total active rules after merging static and dynamic configurations.',
            '# TYPE grafana_anomaly_config_rule_count gauge',
            f'grafana_anomaly_config_rule_count {len(config.rules) if config is not None else 0}',
        ]

        if config is not None:
            lines.extend([
                '# HELP grafana_anomaly_config_reload_interval_seconds Config reload polling interval.',
                '# TYPE grafana_anomaly_config_reload_interval_seconds gauge',
                f'grafana_anomaly_config_reload_interval_seconds {config.global_config.config_reload_interval_seconds}',
            ])

        lines.extend([
            '# HELP grafana_anomaly_rule_query_success Whether the rule query succeeded on the last cycle.',
            '# TYPE grafana_anomaly_rule_query_success gauge',
        ])
        for rule_name, is_success in sorted(query_success.items()):
            lines.append(self._render_sample('grafana_anomaly_rule_query_success', {'rule': rule_name}, is_success))

        lines.extend([
            '# HELP grafana_anomaly_score Alert-ready anomaly score normalized to 0-100.',
            '# TYPE grafana_anomaly_score gauge',
            '# HELP grafana_anomaly_score_raw Raw algorithm score before normalization.',
            '# TYPE grafana_anomaly_score_raw gauge',
            '# HELP grafana_anomaly_score_point_raw Point-wise raw anomaly score before normalization.',
            '# TYPE grafana_anomaly_score_point_raw gauge',
            '# HELP grafana_anomaly_score_window_raw Window-context raw anomaly score before normalization.',
            '# TYPE grafana_anomaly_score_window_raw gauge',
            '# HELP grafana_anomaly_confidence_score Confidence score for the anomaly decision normalized to 0-100.',
            '# TYPE grafana_anomaly_confidence_score gauge',
            '# HELP grafana_anomaly_severity_level Severity state encoded as normal=0, low=1, medium=2, high=3, critical=4.',
            '# TYPE grafana_anomaly_severity_level gauge',
            '# HELP grafana_anomaly_data_quality_level Data quality encoded as healthy=0, thin=1, flatline=2, gappy=3.',
            '# TYPE grafana_anomaly_data_quality_level gauge',
            '# HELP grafana_anomaly_score_driver_window Whether the window score, rather than the point score, drives the result.',
            '# TYPE grafana_anomaly_score_driver_window gauge',
            '# HELP grafana_anomaly_expected Expected baseline value for the series.',
            '# TYPE grafana_anomaly_expected gauge',
            '# HELP grafana_anomaly_deviation Actual minus expected value.',
            '# TYPE grafana_anomaly_deviation gauge',
            '# HELP grafana_anomaly_upper_bound Upper bound of the expected anomaly band.',
            '# TYPE grafana_anomaly_upper_bound gauge',
            '# HELP grafana_anomaly_lower_bound Lower bound of the expected anomaly band.',
            '# TYPE grafana_anomaly_lower_bound gauge',
            '# HELP grafana_anomaly_is_anomaly Whether the raw score is above the configured threshold.',
            '# TYPE grafana_anomaly_is_anomaly gauge',
            '# HELP grafana_anomaly_value Latest actual value used for scoring.',
            '# TYPE grafana_anomaly_value gauge',
            '# HELP grafana_anomaly_rule_score Aggregated alert-ready anomaly score for the configured rule.',
            '# TYPE grafana_anomaly_rule_score gauge',
            '# HELP grafana_anomaly_rule_score_raw Maximum raw anomaly score for the configured rule.',
            '# TYPE grafana_anomaly_rule_score_raw gauge',
            '# HELP grafana_anomaly_rule_breach_count Number of returned series above threshold.',
            '# TYPE grafana_anomaly_rule_breach_count gauge',
            '# HELP grafana_anomaly_rule_series_count Number of active series returned by the rule query.',
            '# TYPE grafana_anomaly_rule_series_count gauge',
        ])

        for snapshot in series_snapshots:
            labels = self._build_series_labels(snapshot)
            lines.append(self._render_sample('grafana_anomaly_score', labels, snapshot.normalized_score))
            lines.append(self._render_sample('grafana_anomaly_score_raw', labels, snapshot.raw_score))
            lines.append(self._render_sample('grafana_anomaly_score_point_raw', labels, snapshot.point_raw_score))
            lines.append(self._render_sample('grafana_anomaly_score_window_raw', labels, snapshot.window_raw_score))
            lines.append(self._render_sample('grafana_anomaly_confidence_score', labels, snapshot.confidence_score))
            lines.append(self._render_sample('grafana_anomaly_severity_level', labels, SEVERITY_LEVELS.get(snapshot.severity_label, 0)))
            lines.append(self._render_sample('grafana_anomaly_data_quality_level', labels, DATA_QUALITY_LEVELS.get(snapshot.data_quality_label, 1)))
            lines.append(self._render_sample('grafana_anomaly_score_driver_window', labels, 1 if snapshot.score_driver == 'window' else 0))
            lines.append(self._render_sample('grafana_anomaly_value', labels, snapshot.value))
            lines.append(self._render_sample('grafana_anomaly_is_anomaly', labels, 1 if snapshot.is_anomaly else 0))
            if snapshot.expected is not None:
                lines.append(self._render_sample('grafana_anomaly_expected', labels, snapshot.expected))
            if snapshot.deviation is not None:
                lines.append(self._render_sample('grafana_anomaly_deviation', labels, snapshot.deviation))
            if snapshot.upper is not None:
                lines.append(self._render_sample('grafana_anomaly_upper_bound', labels, snapshot.upper))
            if snapshot.lower is not None:
                lines.append(self._render_sample('grafana_anomaly_lower_bound', labels, snapshot.lower))

        rules_by_name = {rule.name: rule for rule in config.rules} if config is not None else {}
        pushed_rule_labels: dict[str, dict[str, str]] = {}
        rule_level_feed_labels = {
            'feed_source',
            'dashboard_uid',
            'dashboard_title',
            'panel_id',
            'panel_title',
            'feed_target',
            'source_datasource_uid',
            'source_datasource_type',
        }
        for snapshot in series_snapshots:
            if snapshot.labels.get('feed_source') != 'plugin':
                continue
            pushed_rule_labels.setdefault(
                snapshot.rule_name,
                {key: value for key, value in snapshot.labels.items() if key in rule_level_feed_labels},
            )
        for snapshot in rule_snapshots:
            labels = {
                'rule': snapshot.name,
                'algorithm': snapshot.algorithm,
                'severity_preset': snapshot.severity_preset,
            }
            extra_labels = rules_by_name.get(snapshot.name).labels if snapshot.name in rules_by_name else pushed_rule_labels.get(snapshot.name, {})
            labels = self._merge_labels(labels, extra_labels)
            lines.append(self._render_sample('grafana_anomaly_rule_score', labels, snapshot.max_score))
            lines.append(self._render_sample('grafana_anomaly_rule_score_raw', labels, snapshot.max_raw_score))
            lines.append(self._render_sample('grafana_anomaly_rule_breach_count', labels, snapshot.breach_count))
            lines.append(self._render_sample('grafana_anomaly_rule_series_count', labels, snapshot.series_count))

        lines.extend(self._render_sink_metrics())

        lines.append('')
        return '\n'.join(lines).encode('utf-8')

    def _render_sink_metrics(self) -> list[str]:
        statuses = self.sink_manager.statuses()
        if not statuses:
            return []
        lines = [
            '# HELP grafana_anomaly_sink_up Whether the last write to the sink succeeded.',
            '# TYPE grafana_anomaly_sink_up gauge',
            '# HELP grafana_anomaly_sink_last_write_timestamp_seconds Unix timestamp of the last successful sink write.',
            '# TYPE grafana_anomaly_sink_last_write_timestamp_seconds gauge',
            '# HELP grafana_anomaly_sink_write_duration_seconds Duration of the last sink write.',
            '# TYPE grafana_anomaly_sink_write_duration_seconds gauge',
            '# HELP grafana_anomaly_sink_records_written_total Total records successfully written to the sink.',
            '# TYPE grafana_anomaly_sink_records_written_total counter',
            '# HELP grafana_anomaly_sink_errors_total Total sink write errors.',
            '# TYPE grafana_anomaly_sink_errors_total counter',
            '# HELP grafana_anomaly_sink_last_error Last sink error string.',
            '# TYPE grafana_anomaly_sink_last_error gauge',
        ]
        for status in statuses:
            labels = {'sink': status.sink}
            lines.append(self._render_sample('grafana_anomaly_sink_up', labels, status.up))
            lines.append(self._render_sample('grafana_anomaly_sink_last_write_timestamp_seconds', labels, status.last_write_timestamp_seconds))
            lines.append(self._render_sample('grafana_anomaly_sink_write_duration_seconds', labels, status.write_duration_seconds))
            lines.append(self._render_sample('grafana_anomaly_sink_records_written_total', labels, status.records_written_total))
            lines.append(self._render_sample('grafana_anomaly_sink_errors_total', labels, status.errors_total))
            lines.append(self._render_sample('grafana_anomaly_sink_last_error', {**labels, 'error': status.last_error}, 1))
        queue_status = self.sink_manager.queue_status()
        lines.extend([
            '# HELP grafana_anomaly_sink_queue_depth Current queued sink batches waiting for the worker.',
            '# TYPE grafana_anomaly_sink_queue_depth gauge',
            f'grafana_anomaly_sink_queue_depth {queue_status.queue_depth}',
            '# HELP grafana_anomaly_sink_queue_capacity Maximum queued sink batches.',
            '# TYPE grafana_anomaly_sink_queue_capacity gauge',
            f'grafana_anomaly_sink_queue_capacity {queue_status.queue_capacity}',
            '# HELP grafana_anomaly_sink_dropped_batches_total Total sink batches dropped before reaching sink writers.',
            '# TYPE grafana_anomaly_sink_dropped_batches_total counter',
            f'grafana_anomaly_sink_dropped_batches_total {queue_status.dropped_batches_total}',
            '# HELP grafana_anomaly_sink_last_drop_timestamp_seconds Unix timestamp of the last dropped sink batch.',
            '# TYPE grafana_anomaly_sink_last_drop_timestamp_seconds gauge',
            f'grafana_anomaly_sink_last_drop_timestamp_seconds {queue_status.last_drop_timestamp_seconds:.3f}',
        ])
        return lines

    def _build_series_labels(self, snapshot: SeriesSnapshot) -> dict[str, str]:
        stable_source_labels = {
            key: value for key, value in snapshot.labels.items() if key not in PROMETHEUS_DYNAMIC_LABELS
        }
        return self._merge_labels(
            {
                'rule': snapshot.rule_name,
                'source_metric': snapshot.source_metric,
                'algorithm': snapshot.algorithm,
                'severity_preset': snapshot.severity_preset,
            },
            stable_source_labels,
        )

    def _merge_labels(self, source_labels: dict[str, str], extra_labels: dict[str, str]) -> dict[str, str]:
        merged = dict(source_labels)
        for key, value in extra_labels.items():
            target_key = key if key not in merged else f'extra_{key}'
            merged[target_key] = value
        return merged

    def _series_key(self, labels: dict[str, str], source_metric: str) -> str:
        return f'{source_metric}|' + '|'.join(f'{key}={value}' for key, value in sorted(labels.items()))

    def _render_sample(self, metric_name: str, labels: dict[str, str], metric_value: float | int) -> str:
        label_text = ','.join(
            f'{key}="{self._escape_label_value(label_value)}"' for key, label_value in sorted(labels.items())
        )
        return f'{metric_name}{{{label_text}}} {metric_value}' if label_text else f'{metric_name} {metric_value}'

    def _escape_label_value(self, value: str) -> str:
        return str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


class MetricsHandler(BaseHTTPRequestHandler):
    runtime: ExporterRuntime

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in ('/metrics', '/'):
            payload = self.runtime.read_metrics()
            self.send_response(200)
            self._send_cors_headers()
            self.send_header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if parsed.path == '/health':
            payload = b'ok\n'
            self.send_response(200)
            self._send_cors_headers()
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if parsed.path == '/api/sync/rules':
            self._write_json(200, {'rules': self.runtime.list_dynamic_rules()})
            return

        self.send_response(404)
        self._send_cors_headers()
        self.end_headers()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in ('/api/sync/panel', '/api/feed/scores'):
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            return

        try:
            content_length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            content_length = 0

        try:
            raw_body = self.rfile.read(content_length) if content_length > 0 else b'{}'
            payload = json.loads(raw_body.decode('utf-8') or '{}')
            if not isinstance(payload, dict):
                raise RegistrationError('Sync payload must be a JSON object.')
            if parsed.path == '/api/feed/scores':
                result = self.runtime.ingest_score_feed(payload)
            else:
                result = self.runtime.register_panel_sync(payload)
            self._write_json(200, result)
        except BackpressureError as exc:
            self._write_json(429, {'error': str(exc), 'sinkEnqueue': exc.status})
        except (json.JSONDecodeError, RegistrationError) as exc:
            self._write_json(400, {'error': str(exc)})
        except Exception as exc:  # noqa: BLE001
            LOGGER.exception('request failed path=%s error=%s', parsed.path, exc)
            self._write_json(500, {'error': str(exc)})

    def _write_json(self, status_code: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload, indent=2).encode('utf-8')
        self.send_response(status_code)
        self._send_cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_cors_headers(self) -> None:
        origin = self.headers.get('Origin') or '*'
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def run_server(config_path: str, dynamic_state_path: str | None = None) -> None:
    logging.basicConfig(
        level=getattr(logging, os.environ.get('ANOMALY_LOG_LEVEL', 'INFO').upper(), logging.INFO),
        format='%(asctime)s %(levelname)s %(name)s %(message)s',
    )
    LOGGER.info('starting exporter config_path=%s dynamic_state_path=%s', config_path, dynamic_state_path or DEFAULT_DYNAMIC_STATE_PATH)
    runtime = ExporterRuntime(config_path=config_path, dynamic_state_path=dynamic_state_path)
    runtime.maybe_reload_config(force=True)
    worker = threading.Thread(target=runtime.loop_forever, daemon=True)
    worker.start()

    config = runtime.current_config
    if config is None:
        raise RuntimeError('Config was not loaded at startup.')

    MetricsHandler.runtime = runtime
    server = ThreadingHTTPServer((config.global_config.listen_host, config.global_config.listen_port), MetricsHandler)
    LOGGER.info('listening host=%s port=%s', config.global_config.listen_host, config.global_config.listen_port)
    server.serve_forever()
