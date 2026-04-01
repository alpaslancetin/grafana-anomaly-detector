from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .algorithms import aggregate_rule_scores, evaluate_series
from .config_loader import ConfigError, load_config
from .dynamic_rules import DynamicRuleRegistry, RegistrationError
from .models import AppConfig, RuleConfig, RuleSnapshot, SeriesSnapshot, SeriesState
from .prometheus_api import PrometheusClient, PrometheusQueryError

DEFAULT_DYNAMIC_STATE_PATH = '/app/state/dynamic_rules.json'


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
            '',
        ]
        return '\n'.join(payload).encode('utf-8')

    def _load_combined_config(self) -> AppConfig:
        static_config = load_config(self.config_path)
        merged_rules: dict[str, RuleConfig] = {rule.name: rule for rule in static_config.rules}
        for rule in self.dynamic_registry.list_rule_configs():
            merged_rules[rule.name] = rule
        return AppConfig(global_config=static_config.global_config, rules=list(merged_rules.values()))

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
        with self.lock:
            previous_states = self.rule_states
            previous_query_success = self.query_success
            self.current_config = config
            self.rule_states = {rule.name: previous_states.get(rule.name, {}) for rule in config.rules}
            self.query_success = {rule.name: previous_query_success.get(rule.name, 0) for rule in config.rules}
            self.last_config_mtime = config_mtime
            self.last_error = ''

    def register_panel_sync(self, payload: dict[str, object]) -> dict[str, object]:
        result = self.dynamic_registry.upsert_panel_registration(payload)
        self.maybe_reload_config(force=True)
        evaluation_interval = self.current_config.global_config.evaluation_interval_seconds if self.current_config is not None else 5
        return {
            **result,
            'evaluationIntervalSeconds': evaluation_interval,
            'dynamicRules': self.list_dynamic_rules(),
        }

    def list_dynamic_rules(self) -> list[dict[str, object]]:
        self.dynamic_registry.reload_if_changed()
        return [self._serialize_dynamic_record(record) for record in self.dynamic_registry.list_records()]

    def _serialize_dynamic_record(self, record) -> dict[str, object]:
        return {
            'rule': record.rule.name,
            'query': record.rule.query,
            'algorithm': record.rule.algorithm,
            'threshold': record.rule.threshold,
            'baselineWindow': record.rule.baseline_window,
            'seasonalitySamples': record.rule.seasonality_samples,
            'seasonalRefinement': record.rule.seasonal_refinement,
            'severityPreset': record.rule.severity_preset,
            'aggregation': record.rule.aggregation,
            'labels': record.rule.labels,
            'dashboardUid': record.dashboard_uid,
            'dashboardTitle': record.dashboard_title,
            'panelId': record.panel_id,
            'panelTitle': record.panel_title,
            'refId': record.ref_id,
            'syncHash': record.sync_hash,
            'createdAt': record.created_at,
            'updatedAt': record.updated_at,
            'alertQuery': f'grafana_anomaly_rule_score{{rule="{record.rule.name}"}}',
            'perSeriesQuery': f'grafana_anomaly_score{{rule="{record.rule.name}"}}',
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

        for rule in config.rules:
            try:
                samples = client.instant_query(rule.query, evaluation_time)
                next_query_success[rule.name] = 1
            except PrometheusQueryError as exc:
                next_query_success[rule.name] = 0
                errors.append(str(exc))
                samples = []

            rule_scores: list[SeriesSnapshot] = []
            rule_state = self.rule_states.setdefault(rule.name, {})
            for sample in samples:
                source_metric = sample.labels.get('__name__', rule.name)
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

            next_rule_snapshots.append(self._build_rule_snapshot(rule, rule_scores, evaluation_time))

        duration = time.time() - start
        last_error = ' | '.join(errors[:3])
        payload = self._render_metrics(
            series_snapshots=next_series_snapshots,
            rule_snapshots=next_rule_snapshots,
            query_success=next_query_success,
            config=config,
            duration=duration,
            evaluation_time=evaluation_time,
            last_error=last_error,
            success=0 if errors else 1,
        )

        with self.lock:
            self.series_snapshots = next_series_snapshots
            self.rule_snapshots = next_rule_snapshots
            self.query_success = next_query_success
            self.last_evaluation_timestamp = evaluation_time
            self.last_evaluation_duration_seconds = duration
            self.last_error = last_error
            self.metrics_payload = payload

    def loop_forever(self) -> None:
        while True:
            interval = 5
            try:
                self.maybe_reload_config()
                if self.current_config is not None:
                    interval = self.current_config.global_config.evaluation_interval_seconds
                self.run_once()
            except Exception as exc:  # noqa: BLE001
                with self.lock:
                    self.last_error = str(exc)
                    self.metrics_payload = self._render_metrics(
                        series_snapshots=self.series_snapshots,
                        rule_snapshots=self.rule_snapshots,
                        query_success=self.query_success,
                        config=self.current_config,
                        duration=self.last_evaluation_duration_seconds,
                        evaluation_time=self.last_evaluation_timestamp,
                        last_error=self.last_error,
                        success=0,
                    )
            time.sleep(interval)

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
        for snapshot in rule_snapshots:
            labels = {
                'rule': snapshot.name,
                'algorithm': snapshot.algorithm,
                'severity_preset': snapshot.severity_preset,
            }
            extra_labels = rules_by_name.get(snapshot.name).labels if snapshot.name in rules_by_name else {}
            labels = self._merge_labels(labels, extra_labels)
            lines.append(self._render_sample('grafana_anomaly_rule_score', labels, snapshot.max_score))
            lines.append(self._render_sample('grafana_anomaly_rule_score_raw', labels, snapshot.max_raw_score))
            lines.append(self._render_sample('grafana_anomaly_rule_breach_count', labels, snapshot.breach_count))
            lines.append(self._render_sample('grafana_anomaly_rule_series_count', labels, snapshot.series_count))

        lines.append('')
        return '\n'.join(lines).encode('utf-8')

    def _build_series_labels(self, snapshot: SeriesSnapshot) -> dict[str, str]:
        return self._merge_labels(
            {
                'rule': snapshot.rule_name,
                'source_metric': snapshot.source_metric,
                'algorithm': snapshot.algorithm,
                'severity_preset': snapshot.severity_preset,
                'severity_label': snapshot.severity_label,
                'confidence_label': snapshot.confidence_label,
                'data_quality': snapshot.data_quality_label,
                'score_driver': snapshot.score_driver,
            },
            snapshot.labels,
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
        if parsed.path != '/api/sync/panel':
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
            result = self.runtime.register_panel_sync(payload)
            self._write_json(200, result)
        except (json.JSONDecodeError, RegistrationError) as exc:
            self._write_json(400, {'error': str(exc)})
        except Exception as exc:  # noqa: BLE001
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
    runtime = ExporterRuntime(config_path=config_path, dynamic_state_path=dynamic_state_path)
    runtime.maybe_reload_config(force=True)
    worker = threading.Thread(target=runtime.loop_forever, daemon=True)
    worker.start()

    config = runtime.current_config
    if config is None:
        raise RuntimeError('Config was not loaded at startup.')

    MetricsHandler.runtime = runtime
    server = ThreadingHTTPServer((config.global_config.listen_host, config.global_config.listen_port), MetricsHandler)
    server.serve_forever()
