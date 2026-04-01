from __future__ import annotations

import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import RuleConfig

DATACLASS_KWARGS = {'slots': True} if sys.version_info >= (3, 10) else {}

@dataclass(**DATACLASS_KWARGS)
class DynamicRuleRecord:
    rule: RuleConfig
    dashboard_uid: str
    dashboard_title: str
    panel_id: int
    panel_title: str
    ref_id: str
    sync_hash: str
    created_at: float
    updated_at: float


class RegistrationError(RuntimeError):
    pass


class DynamicRuleRegistry:
    def __init__(self, state_path: str | Path) -> None:
        self.state_path = Path(state_path)
        self.records: dict[str, DynamicRuleRecord] = {}
        self.last_mtime = 0.0
        self.load()

    def load(self) -> None:
        if not self.state_path.exists():
            self.records = {}
            return
        raw = json.loads(self.state_path.read_text(encoding='utf-8'))
        loaded: dict[str, DynamicRuleRecord] = {}
        for item in raw.get('rules', []):
            rule_data = item['rule']
            rule = RuleConfig(
                name=rule_data['name'],
                query=rule_data['query'],
                algorithm=rule_data.get('algorithm', 'mad'),
                threshold=float(rule_data.get('threshold', 2.8)),
                baseline_window=int(rule_data.get('baseline_window', 12)),
                seasonality_samples=int(rule_data.get('seasonality_samples', 24)),
                seasonal_refinement=rule_data.get('seasonal_refinement', 'cycle'),
                severity_preset=rule_data.get('severity_preset', 'balanced'),
                aggregation=rule_data.get('aggregation', 'max'),
                labels={str(k): str(v) for k, v in (rule_data.get('labels', {}) or {}).items()},
                description=str(rule_data.get('description', '')),
            )
            loaded[rule.name] = DynamicRuleRecord(
                rule=rule,
                dashboard_uid=str(item['dashboard_uid']),
                dashboard_title=str(item.get('dashboard_title', '')),
                panel_id=int(item['panel_id']),
                panel_title=str(item.get('panel_title', '')),
                ref_id=str(item.get('ref_id', 'A')),
                sync_hash=str(item.get('sync_hash', '')),
                created_at=float(item.get('created_at', time.time())),
                updated_at=float(item.get('updated_at', time.time())),
            )
        self.records = loaded
        self.last_mtime = self.state_path.stat().st_mtime if self.state_path.exists() else 0.0

    def reload_if_changed(self) -> bool:
        if not self.state_path.exists():
            if self.records:
                self.records = {}
                self.last_mtime = 0.0
                return True
            return False
        mtime = self.state_path.stat().st_mtime
        if mtime == self.last_mtime:
            return False
        self.load()
        return True

    def list_rule_configs(self) -> list[RuleConfig]:
        return [record.rule for record in self.records.values()]

    def list_records(self) -> list[DynamicRuleRecord]:
        return sorted(self.records.values(), key=lambda record: (record.dashboard_uid, record.panel_id, record.ref_id, record.rule.name))

    def upsert_panel_registration(self, payload: dict[str, Any]) -> dict[str, Any]:
        dashboard_uid = str(payload.get('dashboardUid', '')).strip()
        panel_id_raw = payload.get('panelId')
        targets = payload.get('targets', []) or []
        resolved = payload.get('resolvedOptions', {}) or {}

        if not dashboard_uid:
            raise RegistrationError('dashboardUid is required.')
        if panel_id_raw is None:
            raise RegistrationError('panelId is required.')
        if not isinstance(targets, list) or not targets:
            raise RegistrationError('At least one Prometheus target is required.')

        try:
            panel_id = int(panel_id_raw)
        except (TypeError, ValueError) as exc:
            raise RegistrationError('panelId must be an integer.') from exc

        algorithm = str(resolved.get('algorithm', 'mad')).lower()
        threshold = float(resolved.get('sensitivity', 2.8))
        baseline_window = int(resolved.get('baselineWindow', 12))
        seasonality_samples = int(resolved.get('seasonalitySamples', 24))
        seasonal_refinement = str(resolved.get('seasonalRefinement', 'cycle')).lower()
        severity_preset = str(resolved.get('severityPreset', 'balanced')).lower()
        detection_mode = str(resolved.get('detectionMode', 'single')).lower()
        aggregation = 'top3_avg' if detection_mode == 'multi' else 'max'

        dashboard_title = str(payload.get('dashboardTitle', '')).strip()
        panel_title = str(payload.get('panelTitle', '')).strip()
        requested_prefix = str(payload.get('ruleNamePrefix', '')).strip()
        sync_hash = str(payload.get('syncHash', '')).strip()
        now = time.time()

        scope_keys = [name for name, record in self.records.items() if record.dashboard_uid == dashboard_uid and record.panel_id == panel_id]
        removed = sorted(scope_keys)
        for name in scope_keys:
            self.records.pop(name, None)

        valid_targets = [target for target in targets if str(target.get('expr', '')).strip()]
        if not valid_targets:
            self.save()
            return {'registered': [], 'removed': removed}

        base_name = self._sanitize_rule_name(requested_prefix or f'{dashboard_uid}_panel_{panel_id}')
        registered: list[dict[str, str]] = []

        for index, target in enumerate(valid_targets, start=1):
            ref_id = str(target.get('refId', f'Q{index}')).strip() or f'Q{index}'
            rule_name = base_name if len(valid_targets) == 1 else self._sanitize_rule_name(f'{base_name}_{ref_id}')
            labels = {
                'dashboard_uid': dashboard_uid,
                'dashboard_title': dashboard_title or dashboard_uid,
                'panel_id': str(panel_id),
                'panel_title': panel_title or f'Panel {panel_id}',
                'query_ref_id': ref_id,
                'feed_source': 'grafana_panel',
                'detection_mode': detection_mode,
                'metric_preset': str(resolved.get('effectiveMetricPreset') or resolved.get('metricPreset') or 'custom'),
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
                algorithm=algorithm,
                threshold=threshold,
                baseline_window=baseline_window,
                seasonality_samples=seasonality_samples,
                seasonal_refinement=seasonal_refinement,
                severity_preset=severity_preset,
                aggregation=aggregation,
                labels=labels,
                description=f'Grafana panel sync for {panel_title or dashboard_uid} [{ref_id}]',
            )
            record = DynamicRuleRecord(
                rule=rule,
                dashboard_uid=dashboard_uid,
                dashboard_title=dashboard_title,
                panel_id=panel_id,
                panel_title=panel_title,
                ref_id=ref_id,
                sync_hash=sync_hash,
                created_at=now,
                updated_at=now,
            )
            self.records[rule.name] = record
            registered.append(
                {
                    'rule': rule.name,
                    'query': f'grafana_anomaly_rule_score{{rule="{rule.name}"}}',
                    'perSeriesQuery': f'grafana_anomaly_score{{rule="{rule.name}"}}',
                }
            )

        self.save()
        return {'registered': registered, 'removed': removed}

    def save(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            'version': 1,
            'rules': [self._record_to_dict(record) for record in self.list_records()],
        }
        self.state_path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
        self.last_mtime = self.state_path.stat().st_mtime

    def _record_to_dict(self, record: DynamicRuleRecord) -> dict[str, Any]:
        return {
            'dashboard_uid': record.dashboard_uid,
            'dashboard_title': record.dashboard_title,
            'panel_id': record.panel_id,
            'panel_title': record.panel_title,
            'ref_id': record.ref_id,
            'sync_hash': record.sync_hash,
            'created_at': record.created_at,
            'updated_at': record.updated_at,
            'rule': {
                'name': record.rule.name,
                'query': record.rule.query,
                'algorithm': record.rule.algorithm,
                'threshold': record.rule.threshold,
                'baseline_window': record.rule.baseline_window,
                'seasonality_samples': record.rule.seasonality_samples,
                'seasonal_refinement': record.rule.seasonal_refinement,
                'severity_preset': record.rule.severity_preset,
                'aggregation': record.rule.aggregation,
                'labels': record.rule.labels,
                'description': record.rule.description,
            },
        }

    def _sanitize_rule_name(self, value: str) -> str:
        sanitized = re.sub(r'[^a-zA-Z0-9_]+', '_', value).strip('_').lower()
        return sanitized[:120] if sanitized else f'panel_rule_{int(time.time())}'
