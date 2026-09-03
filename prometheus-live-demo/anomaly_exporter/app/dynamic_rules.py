from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import (
    RuleConfig,
    SUPPORTED_ALGORITHMS,
    SUPPORTED_ANOMALY_DIRECTIONS,
    SUPPORTED_SEASONAL_REFINEMENTS,
    SUPPORTED_SEVERITY_PRESETS,
)

DATACLASS_KWARGS = {'slots': True} if sys.version_info >= (3, 10) else {}
STATE_SCHEMA_VERSION = 3
SUPPORTED_SCOPE_POLICIES = {'saved', 'pinned', 'runtime'}
SUPPORTED_API_CAPABILITIES = {'idempotentSync', 'scopeIdentity', 'directionPolicy', 'decisionLifecycle'}


def _state_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'true', 'yes', '1', 'on'}:
            return True
        if normalized in {'false', 'no', '0', 'off', ''}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    raise ValueError(f'invalid boolean value: {value!r}')


@dataclass(**DATACLASS_KWARGS)
class DynamicRuleRecord:
    rule: RuleConfig
    target: str
    dashboard_uid: str
    dashboard_title: str
    panel_id: int
    panel_title: str
    ref_id: str
    sync_hash: str
    scope_hash: str
    scope_policy: str
    revision: int
    created_at: float
    updated_at: float
    last_seen_at: float


class RegistrationError(RuntimeError):
    pass


class RegistrationConflict(RegistrationError):
    pass


class DynamicRuleRegistry:
    """Thread-safe, crash-safe registry for browser-provisioned rules."""

    def __init__(self, state_path: str | Path) -> None:
        self.state_path = Path(state_path)
        self.backup_path = self.state_path.with_suffix(f'{self.state_path.suffix}.bak')
        self.lock_path = self.state_path.with_suffix(f'{self.state_path.suffix}.lock')
        self.records: dict[str, DynamicRuleRecord] = {}
        self.last_mtime = 0.0
        self.load_error = ''
        self.state_write_count = 0
        self.unchanged_count = 0
        self.conflict_count = 0
        self.lock = threading.RLock()
        self.load()

    def load(self) -> None:
        with self.lock:
            if not self.state_path.exists():
                self.records = {}
                self.last_mtime = 0.0
                self.load_error = ''
                return
            try:
                raw = json.loads(self.state_path.read_text(encoding='utf-8'))
                loaded = self._parse_state(raw)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                self.records = {}
                self.last_mtime = self.state_path.stat().st_mtime if self.state_path.exists() else 0.0
                self.load_error = f'Invalid dynamic rule state: {exc}'
                return

            self.records = loaded
            self.last_mtime = self.state_path.stat().st_mtime
            self.load_error = ''

    def _parse_state(self, raw: object) -> dict[str, DynamicRuleRecord]:
        if not isinstance(raw, dict) or not isinstance(raw.get('rules', []), list):
            raise ValueError('state root must contain a rules list')
        loaded: dict[str, DynamicRuleRecord] = {}
        for item in raw.get('rules', []):
            if not isinstance(item, dict) or not isinstance(item.get('rule'), dict):
                raise ValueError('each state rule must be an object')
            rule_data = item['rule']
            rule = RuleConfig(
                name=str(rule_data['name']),
                query=str(rule_data['query']),
                source_type=str(rule_data.get('source_type', rule_data.get('datasource_type', 'prometheus'))),
                datasource_url=str(rule_data.get('datasource_url', '')),
                target_sinks=rule_data.get('target_sinks'),
                range_seconds=int(rule_data.get('range_seconds', 0)),
                step_seconds=int(rule_data.get('step_seconds', 0)),
                bucket_span_seconds=int(rule_data.get('bucket_span_seconds', 0)),
                algorithm=str(rule_data.get('algorithm', 'mad')),
                anomaly_direction=str(rule_data.get('anomaly_direction', 'high_or_low')),
                minimum_absolute_deviation=float(rule_data.get('minimum_absolute_deviation', 0.0)),
                minimum_relative_deviation=float(rule_data.get('minimum_relative_deviation', 0.0)),
                minimum_activity=float(rule_data.get('minimum_activity', 0.0)),
                persistence_buckets=int(rule_data.get('persistence_buckets', 1)),
                persistence_window=int(rule_data.get('persistence_window', 1)),
                recovery_threshold=float(rule_data.get('recovery_threshold', 0.0)),
                recovery_buckets=int(rule_data.get('recovery_buckets', 1)),
                cooldown_buckets=int(rule_data.get('cooldown_buckets', 0)),
                data_quality_gate=_state_bool(rule_data.get('data_quality_gate'), False),
                threshold=float(rule_data.get('threshold', 4.0)),
                baseline_window=int(rule_data.get('baseline_window', 12)),
                seasonality_samples=int(rule_data.get('seasonality_samples', 24)),
                seasonal_refinement=str(rule_data.get('seasonal_refinement', 'cycle')),
                severity_preset=str(rule_data.get('severity_preset', 'balanced')),
                aggregation=str(rule_data.get('aggregation', 'max')),
                legend=str(rule_data.get('legend', rule_data.get('legend_format', ''))),
                labels={str(k): str(v) for k, v in (rule_data.get('labels', {}) or {}).items()},
                description=str(rule_data.get('description', '')),
            )
            if rule.recovery_threshold < 0 or rule.recovery_threshold > rule.threshold:
                raise ValueError('recovery_threshold must be between zero and threshold')
            if rule.recovery_buckets <= 0 or rule.cooldown_buckets < 0:
                raise ValueError('recovery_buckets must be positive and cooldown_buckets must be non-negative')
            now = time.time()
            record = DynamicRuleRecord(
                rule=rule,
                target=str(item.get('target') or rule.labels.get('feed_target') or 'prometheus').strip().lower(),
                dashboard_uid=str(item['dashboard_uid']),
                dashboard_title=str(item.get('dashboard_title', '')),
                panel_id=int(item['panel_id']),
                panel_title=str(item.get('panel_title', '')),
                ref_id=str(item.get('ref_id', 'A')),
                sync_hash=str(item.get('sync_hash', '')),
                scope_hash=str(item.get('scope_hash', 'saved') or 'saved'),
                scope_policy=str(item.get('scope_policy', 'saved') or 'saved'),
                revision=max(1, int(item.get('revision', 1))),
                created_at=float(item.get('created_at', now)),
                updated_at=float(item.get('updated_at', now)),
                last_seen_at=float(item.get('last_seen_at', item.get('updated_at', now))),
            )
            if not rule.name or not rule.query:
                raise ValueError('state rule name and query are required')
            loaded[rule.name] = record
        return loaded

    def reload_if_changed(self) -> bool:
        with self.lock:
            if not self.state_path.exists():
                if self.records or self.load_error:
                    self.records = {}
                    self.last_mtime = 0.0
                    self.load_error = ''
                    return True
                return False
            mtime = self.state_path.stat().st_mtime
            if mtime == self.last_mtime:
                return False
            self.load()
            return True

    def list_rule_configs(self) -> list[RuleConfig]:
        with self.lock:
            return [record.rule for record in self.records.values()]

    def list_records(self) -> list[DynamicRuleRecord]:
        with self.lock:
            return sorted(
                self.records.values(),
                key=lambda record: (record.dashboard_uid, record.panel_id, record.scope_hash, record.ref_id, record.rule.name),
            )

    def health(self) -> dict[str, object]:
        with self.lock:
            return {
                'ready': not self.load_error,
                'error': self.load_error,
                'activeRules': len(self.records),
                'stateWrites': self.state_write_count,
                'unchangedSyncs': self.unchanged_count,
                'conflicts': self.conflict_count,
                'schemaVersion': STATE_SCHEMA_VERSION,
            }

    def recover_from_backup(self) -> bool:
        with self.lock:
            if not self.backup_path.exists():
                return False
            raw = json.loads(self.backup_path.read_text(encoding='utf-8'))
            self._parse_state(raw)
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.backup_path, self.state_path)
            self.load()
            return not self.load_error

    def upsert_panel_registration(
        self,
        payload: dict[str, Any],
        *,
        max_dynamic_rules: int = 5000,
        max_rules_per_panel: int = 50,
        max_query_length: int = 16384,
    ) -> dict[str, Any]:
        with self.lock:
            if self.load_error:
                raise RegistrationError(f'Dynamic rule state is not writable until recovered: {self.load_error}')
            with self._process_lock():
                self.load()
                if self.load_error:
                    raise RegistrationError(f'Dynamic rule state is not writable until recovered: {self.load_error}')
                return self._upsert_panel_registration_locked(
                    payload,
                    max_dynamic_rules=max_dynamic_rules,
                    max_rules_per_panel=max_rules_per_panel,
                    max_query_length=max_query_length,
                )

    def _upsert_panel_registration_locked(
        self,
        payload: dict[str, Any],
        *,
        max_dynamic_rules: int,
        max_rules_per_panel: int,
        max_query_length: int,
    ) -> dict[str, Any]:
        try:
            schema_version = int(payload.get('schemaVersion', 1))
        except (TypeError, ValueError) as exc:
            raise RegistrationError('schemaVersion must be an integer.') from exc
        if schema_version > STATE_SCHEMA_VERSION:
            raise RegistrationError(f'Unsupported schemaVersion {schema_version}; maximum is {STATE_SCHEMA_VERSION}.')
        required_capabilities = payload.get('capabilitiesRequired', []) or []
        if not isinstance(required_capabilities, list):
            raise RegistrationError('capabilitiesRequired must be a list.')
        missing_capabilities = sorted(set(map(str, required_capabilities)) - SUPPORTED_API_CAPABILITIES)
        if missing_capabilities:
            raise RegistrationError(f'Unsupported required capabilities: {missing_capabilities}')

        dashboard_uid = str(payload.get('dashboardUid', '')).strip()
        panel_id_raw = payload.get('panelId')
        targets = payload.get('targets', []) or []
        resolved = payload.get('resolvedOptions', {}) or {}

        if not dashboard_uid:
            raise RegistrationError('dashboardUid is required.')
        if panel_id_raw is None:
            raise RegistrationError('panelId is required.')
        if not isinstance(targets, list):
            raise RegistrationError('targets must be a list.')
        try:
            panel_id = int(panel_id_raw)
        except (TypeError, ValueError) as exc:
            raise RegistrationError('panelId must be an integer.') from exc

        algorithm = str(resolved.get('algorithm', 'mad')).lower()
        anomaly_direction = str(resolved.get('anomalyDirection', 'high_or_low')).lower()
        try:
            threshold = float(resolved.get('sensitivity', 4.0))
            baseline_window = int(resolved.get('baselineWindow', 12))
            seasonality_samples = int(resolved.get('seasonalitySamples', 24))
            minimum_absolute_deviation = float(resolved.get('minimumAbsoluteDeviation', 0.0))
            minimum_relative_deviation = float(resolved.get('minimumRelativeDeviation', 0.0))
            minimum_activity = float(resolved.get('minimumActivity', 0.0))
            persistence_buckets = int(resolved.get('persistenceBuckets', 1))
            persistence_window = int(resolved.get('persistenceWindow', 1))
            recovery_threshold = float(resolved.get('recoveryThreshold', 0.0))
            recovery_buckets = int(resolved.get('recoveryBuckets', 1))
            cooldown_buckets = int(resolved.get('cooldownBuckets', 0))
        except (TypeError, ValueError) as exc:
            raise RegistrationError('Resolved anomaly options contain invalid numeric values.') from exc
        seasonal_refinement = str(resolved.get('seasonalRefinement', 'cycle')).lower()
        severity_preset = str(resolved.get('severityPreset', 'balanced')).lower()
        detection_mode = str(resolved.get('detectionMode', 'single')).lower()
        data_quality_gate_raw = resolved.get('dataQualityGate', False)
        if not isinstance(data_quality_gate_raw, bool):
            raise RegistrationError('dataQualityGate must be a boolean.')
        data_quality_gate = data_quality_gate_raw
        self._validate_detection_options(
            algorithm,
            anomaly_direction,
            threshold,
            baseline_window,
            seasonality_samples,
            seasonal_refinement,
            severity_preset,
            detection_mode,
            minimum_absolute_deviation,
            minimum_relative_deviation,
            minimum_activity,
            persistence_buckets,
            persistence_window,
            recovery_threshold,
            recovery_buckets,
            cooldown_buckets,
        )
        aggregation = 'top3_avg' if detection_mode == 'multi' else 'max'

        dashboard_title = str(payload.get('dashboardTitle', '')).strip()
        panel_title = str(payload.get('panelTitle', '')).strip()
        requested_prefix = str(payload.get('ruleNamePrefix', '')).strip()
        sync_hash = str(payload.get('syncHash', '')).strip()
        scope_policy = str(payload.get('scopePolicy', 'saved') or 'saved').strip().lower()
        scope_hash = str(payload.get('scopeHash', 'saved') or 'saved').strip().lower()
        if scope_policy not in SUPPORTED_SCOPE_POLICIES:
            raise RegistrationError(f'scopePolicy must be one of: {sorted(SUPPORTED_SCOPE_POLICIES)}')
        if not re.fullmatch(r'[a-z0-9_.:-]{1,128}', scope_hash):
            raise RegistrationError('scopeHash contains unsupported characters or is too long.')
        feed_target = self._normalize_target(payload.get('target') or payload.get('scoreFeedTarget') or 'prometheus')
        target_sinks = [] if feed_target == 'prometheus' else [feed_target]
        valid_targets = [target for target in targets if isinstance(target, dict) and str(target.get('expr', '')).strip()]
        if len(valid_targets) > max_rules_per_panel:
            raise RegistrationError(f'Panel target count exceeds configured limit ({max_rules_per_panel}).')
        if any(len(str(target.get('expr', '')).encode('utf-8')) > max_query_length for target in valid_targets):
            raise RegistrationError(f'A panel query exceeds the configured byte limit ({max_query_length}).')

        scope_records = [
            record
            for record in self.records.values()
            if record.dashboard_uid == dashboard_uid and record.panel_id == panel_id and record.scope_hash == scope_hash
        ]
        current_revision = max((record.revision for record in scope_records), default=0)
        expected_revision = payload.get('expectedRevision')
        if expected_revision is not None:
            try:
                expected_revision_value = int(expected_revision)
            except (TypeError, ValueError) as exc:
                raise RegistrationError('expectedRevision must be an integer.') from exc
            if expected_revision_value != current_revision:
                self.conflict_count += 1
                raise RegistrationConflict(f'Expected revision {expected_revision}, current revision is {current_revision}.')

        if (
            sync_hash
            and scope_records
            and len(scope_records) == len(valid_targets)
            and all(record.sync_hash == sync_hash and record.target == feed_target for record in scope_records)
        ):
            now = time.time()
            for record in scope_records:
                record.last_seen_at = now
            self.unchanged_count += 1
            return {
                'status': 'unchanged',
                'registered': [self._registration_item(record.rule.name, feed_target) for record in scope_records],
                'removed': [],
                'target': feed_target,
                'revision': current_revision,
                'syncHash': sync_hash,
                'scopeHash': scope_hash,
            }

        scope_names = {record.rule.name for record in scope_records}
        projected_total = len(self.records) - len(scope_names) + len(valid_targets)
        if projected_total > max_dynamic_rules:
            raise RegistrationError(f'Dynamic rule count would exceed configured limit ({max_dynamic_rules}).')
        for name in scope_names:
            self.records.pop(name, None)
        removed = sorted(scope_names)
        if not valid_targets:
            if removed:
                self._save_locked()
            return {
                'status': 'deleted' if removed else 'unchanged',
                'registered': [],
                'removed': removed,
                'target': feed_target,
                'revision': current_revision + (1 if removed else 0),
                'scopeHash': scope_hash,
            }

        now = time.time()
        revision = current_revision + 1
        base_name = self._sanitize_rule_name(requested_prefix or f'{dashboard_uid}_panel_{panel_id}')
        if scope_hash != 'saved':
            base_name = self._sanitize_rule_name(f'{base_name}_{self._short_hash(scope_hash)}')
        registered: list[dict[str, str]] = []

        for index, target in enumerate(valid_targets, start=1):
            ref_id = str(target.get('refId', f'Q{index}')).strip() or f'Q{index}'
            rule_name = base_name if len(valid_targets) == 1 else self._sanitize_rule_name(f'{base_name}_{ref_id}')
            if rule_name in self.records:
                rule_name = self._sanitize_rule_name(f'{rule_name}_{self._short_hash(self._identity_seed(dashboard_uid, panel_id, ref_id, target, scope_hash))}')
            labels = {
                'dashboard_uid': dashboard_uid,
                'dashboard_title': dashboard_title or dashboard_uid,
                'panel_id': str(panel_id),
                'panel_title': panel_title or f'Panel {panel_id}',
                'query_ref_id': ref_id,
                'feed_source': 'grafana_panel',
                'feed_target': feed_target,
                'detection_mode': detection_mode,
                'metric_preset': str(resolved.get('effectiveMetricPreset') or resolved.get('metricPreset') or 'custom'),
                'scope_hash': scope_hash,
            }
            datasource_uid = str(target.get('datasourceUid', '')).strip()
            datasource_type = str(target.get('datasourceType', '')).strip()
            if datasource_uid:
                labels['datasource_uid'] = datasource_uid
            if datasource_type:
                labels['datasource_type'] = datasource_type

            rule = RuleConfig(
                name=rule_name,
                query=str(target.get('expr')).strip(),
                source_type=datasource_type or 'prometheus',
                datasource_url=str(target.get('datasourceUrl', '')).strip(),
                target_sinks=target_sinks,
                range_seconds=int(resolved.get('rangeSeconds', 0) or 0),
                step_seconds=int(resolved.get('stepSeconds', 0) or 0),
                bucket_span_seconds=int(resolved.get('bucketSpanSeconds', 0) or 0),
                algorithm=algorithm,
                anomaly_direction=anomaly_direction,
                minimum_absolute_deviation=minimum_absolute_deviation,
                minimum_relative_deviation=minimum_relative_deviation,
                minimum_activity=minimum_activity,
                persistence_buckets=persistence_buckets,
                persistence_window=persistence_window,
                recovery_threshold=recovery_threshold,
                recovery_buckets=recovery_buckets,
                cooldown_buckets=cooldown_buckets,
                data_quality_gate=data_quality_gate,
                threshold=threshold,
                baseline_window=baseline_window,
                seasonality_samples=seasonality_samples,
                seasonal_refinement=seasonal_refinement,
                severity_preset=severity_preset,
                aggregation=aggregation,
                legend=str(target.get('legend', '')).strip(),
                labels=labels,
                description=f'Grafana panel sync for {panel_title or dashboard_uid} [{ref_id}]',
            )
            previous = next((record for record in scope_records if record.ref_id == ref_id), None)
            record = DynamicRuleRecord(
                rule=rule,
                target=feed_target,
                dashboard_uid=dashboard_uid,
                dashboard_title=dashboard_title,
                panel_id=panel_id,
                panel_title=panel_title,
                ref_id=ref_id,
                sync_hash=sync_hash,
                scope_hash=scope_hash,
                scope_policy=scope_policy,
                revision=revision,
                created_at=previous.created_at if previous else now,
                updated_at=now,
                last_seen_at=now,
            )
            self.records[rule.name] = record
            registered.append(self._registration_item(rule.name, feed_target))

        self._save_locked()
        return {
            'status': 'created' if current_revision == 0 else 'updated',
            'registered': registered,
            'removed': removed,
            'target': feed_target,
            'revision': revision,
            'syncHash': sync_hash,
            'scopeHash': scope_hash,
        }

    def delete_panel_registration(self, dashboard_uid: str, panel_id: int, scope_hash: str = 'saved') -> dict[str, Any]:
        with self.lock:
            with self._process_lock():
                self.load()
                if self.load_error:
                    raise RegistrationError(f'Dynamic rule state is not writable until recovered: {self.load_error}')
                names = sorted(
                    record.rule.name
                    for record in self.records.values()
                    if record.dashboard_uid == dashboard_uid and record.panel_id == panel_id and record.scope_hash == scope_hash
                )
                for name in names:
                    self.records.pop(name, None)
                if names:
                    self._save_locked()
                return {'status': 'deleted' if names else 'unchanged', 'removed': names, 'registered': [], 'scopeHash': scope_hash}

    def prune_expired_runtime_scopes(self, ttl_seconds: int, now: float | None = None) -> list[str]:
        if ttl_seconds <= 0:
            return []
        with self.lock:
            with self._process_lock():
                self.load()
                cutoff = (time.time() if now is None else now) - ttl_seconds
                names = sorted(
                    record.rule.name
                    for record in self.records.values()
                    if record.scope_policy == 'runtime' and record.last_seen_at < cutoff
                )
                for name in names:
                    self.records.pop(name, None)
                if names:
                    self._save_locked()
                return names

    def save(self) -> None:
        with self.lock:
            with self._process_lock():
                self._save_locked()

    def _save_locked(self) -> None:
        if self.load_error:
            raise RegistrationError(f'Refusing to overwrite invalid dynamic rule state: {self.load_error}')
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            'version': STATE_SCHEMA_VERSION,
            'rules': [self._record_to_dict(record) for record in self.list_records()],
        }
        encoded = json.dumps(payload, indent=2, sort_keys=True).encode('utf-8')
        self._parse_state(json.loads(encoded.decode('utf-8')))
        temp_path = self.state_path.with_name(
            f'.{self.state_path.name}.{os.getpid()}.{threading.get_ident()}.tmp'
        )
        try:
            with temp_path.open('wb') as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            if self.state_path.exists():
                shutil.copy2(self.state_path, self.backup_path)
                with self.backup_path.open('rb') as backup:
                    os.fsync(backup.fileno())
            os.replace(temp_path, self.state_path)
            self._fsync_parent_directory()
        finally:
            if temp_path.exists():
                temp_path.unlink()
        self.last_mtime = self.state_path.stat().st_mtime
        self.state_write_count += 1

    @contextmanager
    def _process_lock(self):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open('a+b') as handle:
            if os.name == 'nt':
                import msvcrt

                if handle.tell() == 0:
                    handle.write(b'0')
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == 'nt':
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def _fsync_parent_directory(self) -> None:
        if os.name == 'nt':
            return
        descriptor = os.open(str(self.state_path.parent), os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _record_to_dict(self, record: DynamicRuleRecord) -> dict[str, Any]:
        return {
            'dashboard_uid': record.dashboard_uid,
            'target': record.target,
            'dashboard_title': record.dashboard_title,
            'panel_id': record.panel_id,
            'panel_title': record.panel_title,
            'ref_id': record.ref_id,
            'sync_hash': record.sync_hash,
            'scope_hash': record.scope_hash,
            'scope_policy': record.scope_policy,
            'revision': record.revision,
            'created_at': record.created_at,
            'updated_at': record.updated_at,
            'last_seen_at': record.last_seen_at,
            'rule': {
                'name': record.rule.name,
                'query': record.rule.query,
                'source_type': record.rule.source_type,
                'datasource_url': record.rule.datasource_url,
                'target_sinks': record.rule.target_sinks,
                'range_seconds': record.rule.range_seconds,
                'step_seconds': record.rule.step_seconds,
                'bucket_span_seconds': record.rule.bucket_span_seconds,
                'algorithm': record.rule.algorithm,
                'anomaly_direction': record.rule.anomaly_direction,
                'minimum_absolute_deviation': record.rule.minimum_absolute_deviation,
                'minimum_relative_deviation': record.rule.minimum_relative_deviation,
                'minimum_activity': record.rule.minimum_activity,
                'persistence_buckets': record.rule.persistence_buckets,
                'persistence_window': record.rule.persistence_window,
                'recovery_threshold': record.rule.recovery_threshold,
                'recovery_buckets': record.rule.recovery_buckets,
                'cooldown_buckets': record.rule.cooldown_buckets,
                'data_quality_gate': record.rule.data_quality_gate,
                'threshold': record.rule.threshold,
                'baseline_window': record.rule.baseline_window,
                'seasonality_samples': record.rule.seasonality_samples,
                'seasonal_refinement': record.rule.seasonal_refinement,
                'severity_preset': record.rule.severity_preset,
                'aggregation': record.rule.aggregation,
                'legend': record.rule.legend,
                'labels': record.rule.labels,
                'description': record.rule.description,
            },
        }

    def _registration_item(self, rule_name: str, target: str) -> dict[str, str]:
        return {
            'rule': rule_name,
            'target': target,
            'query': f'grafana_anomaly_rule_score{{rule="{rule_name}"}}',
            'perSeriesQuery': f'grafana_anomaly_score{{rule="{rule_name}"}}',
            'activeQuery': f'grafana_anomaly_rule_is_anomaly{{rule="{rule_name}"}} == 1',
        }

    def _validate_detection_options(
        self,
        algorithm: str,
        anomaly_direction: str,
        threshold: float,
        baseline_window: int,
        seasonality_samples: int,
        seasonal_refinement: str,
        severity_preset: str,
        detection_mode: str,
        minimum_absolute_deviation: float,
        minimum_relative_deviation: float,
        minimum_activity: float,
        persistence_buckets: int,
        persistence_window: int,
        recovery_threshold: float,
        recovery_buckets: int,
        cooldown_buckets: int,
    ) -> None:
        if algorithm not in SUPPORTED_ALGORITHMS:
            raise RegistrationError(f'algorithm must be one of: {sorted(SUPPORTED_ALGORITHMS)}')
        if anomaly_direction not in SUPPORTED_ANOMALY_DIRECTIONS:
            raise RegistrationError(f'anomalyDirection must be one of: {sorted(SUPPORTED_ANOMALY_DIRECTIONS)}')
        if not math.isfinite(threshold) or threshold <= 0:
            raise RegistrationError('sensitivity must be a finite positive number.')
        if baseline_window <= 0:
            raise RegistrationError('baselineWindow must be positive.')
        if seasonality_samples <= 0:
            raise RegistrationError('seasonalitySamples must be positive.')
        if seasonal_refinement not in SUPPORTED_SEASONAL_REFINEMENTS:
            raise RegistrationError(f'seasonalRefinement must be one of: {sorted(SUPPORTED_SEASONAL_REFINEMENTS)}')
        if severity_preset not in SUPPORTED_SEVERITY_PRESETS:
            raise RegistrationError(f'severityPreset must be one of: {sorted(SUPPORTED_SEVERITY_PRESETS)}')
        if detection_mode not in {'single', 'multi'}:
            raise RegistrationError('detectionMode must be single or multi.')
        for field_name, value in (
            ('minimumAbsoluteDeviation', minimum_absolute_deviation),
            ('minimumRelativeDeviation', minimum_relative_deviation),
            ('minimumActivity', minimum_activity),
        ):
            if not math.isfinite(value) or value < 0:
                raise RegistrationError(f'{field_name} must be a finite zero or positive number.')
        if persistence_buckets <= 0 or persistence_window <= 0:
            raise RegistrationError('Persistence values must be positive integers.')
        if persistence_buckets > persistence_window:
            raise RegistrationError('persistenceBuckets must not exceed persistenceWindow.')
        if not math.isfinite(recovery_threshold) or recovery_threshold < 0:
            raise RegistrationError('recoveryThreshold must be a finite zero or positive number.')
        if recovery_threshold > threshold:
            raise RegistrationError('recoveryThreshold must not exceed sensitivity.')
        if recovery_buckets <= 0:
            raise RegistrationError('recoveryBuckets must be a positive integer.')
        if cooldown_buckets < 0:
            raise RegistrationError('cooldownBuckets must be zero or positive.')

    def _identity_seed(self, dashboard_uid: str, panel_id: int, ref_id: str, target: dict[str, Any], scope_hash: str) -> str:
        return '|'.join(
            (
                dashboard_uid,
                str(panel_id),
                ref_id,
                str(target.get('datasourceUid', '')),
                scope_hash,
            )
        )

    def _short_hash(self, value: str) -> str:
        return hashlib.sha256(value.encode('utf-8')).hexdigest()[:10]

    def _sanitize_rule_name(self, value: str) -> str:
        sanitized = re.sub(r'[^a-zA-Z0-9_]+', '_', value).strip('_').lower()
        return sanitized[:120] if sanitized else f'panel_rule_{self._short_hash(value or "empty")}'

    def _normalize_target(self, value: object) -> str:
        target = str(value or 'prometheus').strip().lower()
        aliases = {
            'elastic': 'elasticsearch',
            'es': 'elasticsearch',
            'influx': 'influxdb',
            'pg': 'postgresql',
            'postgres': 'postgresql',
        }
        target = aliases.get(target, target)
        if target not in {'prometheus', 'loki', 'influxdb', 'postgresql', 'clickhouse', 'elasticsearch'}:
            raise RegistrationError(f'Unsupported score feed target: {target}')
        return target
