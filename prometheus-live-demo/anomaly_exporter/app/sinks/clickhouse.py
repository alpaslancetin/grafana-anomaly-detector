from __future__ import annotations

import base64
import json
import os
import urllib.parse
from datetime import datetime, timezone

from .base import AnomalySink, SinkBatch, snapshot_records, http_request


class ClickHouseSink(AnomalySink):
    def __init__(self, settings: dict[str, object]) -> None:
        super().__init__('clickhouse')
        self.url = str(settings.get('url', '')).rstrip('/')
        if not self.url:
            raise ValueError('clickhouse.url is required when ClickHouse sink is enabled.')
        self.database = validate_identifier(str(settings.get('database') or 'default'))
        self.table = validate_identifier(str(settings.get('table') or 'grafana_anomaly_scores'))
        self.user_env = str(settings.get('user_env') or 'ANOMALY_SINK_CH_USER')
        self.password_env = str(settings.get('password_env') or 'ANOMALY_SINK_CH_PASSWORD')
        self.auto_create_table = bool(settings.get('auto_create_table', True))
        self.timeout_seconds = int(settings.get('timeout_seconds') or 5)
        self.verify = bool(settings.get('verify', True))

    def write(self, batch: SinkBatch) -> int:
        records = snapshot_records(batch)
        if not records:
            return 0
        if self.auto_create_table:
            self._create_table()
        body = '\n'.join(json.dumps(self._row(record), separators=(',', ':'), sort_keys=True) for record in records).encode('utf-8')
        query = urllib.parse.urlencode({'query': f'INSERT INTO {self.database}.{self.table} FORMAT JSONEachRow'})
        http_request(
            f'{self.url}/?{query}',
            body=body,
            headers=self._headers(),
            timeout_seconds=self.timeout_seconds,
            verify=self.verify,
        )
        return len(records)

    def _create_table(self) -> None:
        query = f'''
        CREATE TABLE IF NOT EXISTS {self.database}.{self.table} (
          ts DateTime64(3, 'UTC'),
          record_type String DEFAULT 'series',
          rule String,
          source_metric String,
          labels String,
          score Float64,
          raw_score Float64,
          confidence_score Nullable(Float64),
          value Nullable(Float64),
          expected Nullable(Float64),
          deviation Nullable(Float64),
          lower_bound Nullable(Float64),
          upper_bound Nullable(Float64),
          is_anomaly UInt8,
          severity_label String,
          algorithm String,
          decision_state String,
          data_state String
        ) ENGINE = MergeTree ORDER BY (rule, ts)
        '''
        encoded = urllib.parse.urlencode({'query': query})
        http_request(f'{self.url}/?{encoded}', body=b'', headers=self._headers(), timeout_seconds=self.timeout_seconds, verify=self.verify)
        for alter in (
            f"ALTER TABLE {self.database}.{self.table} ADD COLUMN IF NOT EXISTS record_type String DEFAULT 'series'",
            f"ALTER TABLE {self.database}.{self.table} ADD COLUMN IF NOT EXISTS decision_state String DEFAULT 'normal'",
            f"ALTER TABLE {self.database}.{self.table} ADD COLUMN IF NOT EXISTS data_state String DEFAULT 'ok'",
        ):
            encoded_alter = urllib.parse.urlencode({'query': alter})
            http_request(f'{self.url}/?{encoded_alter}', body=b'', headers=self._headers(), timeout_seconds=self.timeout_seconds, verify=self.verify)

    def _row(self, record: dict[str, object]) -> dict[str, object]:
        return {
            'ts': clickhouse_timestamp(float(record['timestamp'])),
            'record_type': str(record.get('record_type') or 'series'),
            'rule': str(record.get('rule', '')),
            'source_metric': str(record.get('source_metric', '')),
            'labels': json.dumps(record.get('labels') or {}, separators=(',', ':'), sort_keys=True),
            'score': record.get('normalized_score') or 0,
            'raw_score': record.get('raw_score') or 0,
            'confidence_score': record.get('confidence_score'),
            'value': record.get('value'),
            'expected': record.get('expected'),
            'deviation': record.get('deviation'),
            'lower_bound': record.get('lower_bound'),
            'upper_bound': record.get('upper_bound'),
            'is_anomaly': 1 if record.get('is_anomaly') else 0,
            'severity_label': str(record.get('severity_label', 'normal')),
            'algorithm': str(record.get('algorithm', 'unknown')),
            'decision_state': str(record.get('decision_state', 'normal')),
            'data_state': str(record.get('data_state', 'ok')),
        }

    def _headers(self) -> dict[str, str]:
        headers = {'Content-Type': 'application/json'}
        user = os.environ.get(self.user_env, '')
        password = os.environ.get(self.password_env, '')
        if user or password:
            token = base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
            headers['Authorization'] = f'Basic {token}'
        return headers


def validate_identifier(value: str) -> str:
    if not value.replace('_', '').isalnum() or not value:
        raise ValueError(f'Unsafe ClickHouse identifier: {value!r}')
    return value


def clickhouse_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
