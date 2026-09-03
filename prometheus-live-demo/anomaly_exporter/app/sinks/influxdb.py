from __future__ import annotations

import os
import urllib.parse

from .base import AnomalySink, SinkBatch, finite_number, snapshot_records, unix_ns, http_request


class InfluxDBSink(AnomalySink):
    def __init__(self, settings: dict[str, object]) -> None:
        super().__init__('influxdb')
        self.url = str(settings.get('url', '')).rstrip('/')
        if not self.url:
            raise ValueError('influxdb.url is required when InfluxDB sink is enabled.')
        self.version = int(settings.get('version') or 2)
        self.org = str(settings.get('org', '')).strip()
        self.bucket = str(settings.get('bucket', '')).strip()
        self.database = str(settings.get('database') or settings.get('db') or '').strip()
        self.token_env = str(settings.get('token_env') or 'ANOMALY_SINK_INFLUX_TOKEN')
        self.measurement = str(settings.get('measurement') or 'grafana_anomaly')
        self.timeout_seconds = int(settings.get('timeout_seconds') or 5)
        self.verify = bool(settings.get('verify', True))

    def write(self, batch: SinkBatch) -> int:
        lines = [self._line(record) for record in snapshot_records(batch)]
        payload = '\n'.join(line for line in lines if line).encode('utf-8')
        if not payload:
            return 0

        headers = {'Content-Type': 'text/plain; charset=utf-8'}
        if self.version == 2:
            token = os.environ.get(self.token_env, '')
            if not token:
                raise ValueError(f'InfluxDB token env {self.token_env} is not set.')
            if not self.org or not self.bucket:
                raise ValueError('influxdb.org and influxdb.bucket are required for version 2.')
            query = urllib.parse.urlencode({'org': self.org, 'bucket': self.bucket, 'precision': 'ns'})
            headers['Authorization'] = f'Token {token}'
            url = f'{self.url}/api/v2/write?{query}'
        else:
            if not self.database:
                raise ValueError('influxdb.database is required for version 1.')
            query = urllib.parse.urlencode({'db': self.database, 'precision': 'ns'})
            url = f'{self.url}/write?{query}'

        http_request(url, body=payload, headers=headers, timeout_seconds=self.timeout_seconds, verify=self.verify)
        return len(lines)

    def _line(self, record: dict[str, object]) -> str:
        tags = {
            'rule': str(record.get('rule', 'unknown')),
            'severity_label': str(record.get('severity_label', 'normal')),
            'algorithm': str(record.get('algorithm', 'unknown')),
            'source_metric': str(record.get('source_metric', 'unknown')),
            'record_type': str(record.get('record_type', 'series')),
            'decision_state': str(record.get('decision_state', 'normal')),
            'data_state': str(record.get('data_state', 'ok')),
        }
        fields = {
            'score': record.get('normalized_score'),
            'raw_score': record.get('raw_score'),
            'confidence_score': record.get('confidence_score'),
            'value': record.get('value'),
            'expected': record.get('expected'),
            'deviation': record.get('deviation'),
            'lower_bound': record.get('lower_bound'),
            'upper_bound': record.get('upper_bound'),
            'is_anomaly': 1 if record.get('is_anomaly') else 0,
            'last_data_timestamp': record.get('last_data_timestamp'),
        }
        field_text = ','.join(f'{escape_key(key)}={format_field(value)}' for key, value in fields.items() if format_field(value) is not None)
        if not field_text:
            return ''
        tag_text = ','.join(f'{escape_key(key)}={escape_tag(value)}' for key, value in tags.items())
        return f'{escape_key(self.measurement)},{tag_text} {field_text} {unix_ns(float(record["timestamp"]))}'


def escape_key(value: str) -> str:
    return str(value).replace('\\', '\\\\').replace(' ', '\\ ').replace(',', '\\,').replace('=', '\\=')


def escape_tag(value: str) -> str:
    return escape_key(value)


def format_field(value: object) -> str | None:
    number = finite_number(value)
    if number is None:
        return None
    return str(int(number)) if isinstance(number, int) else repr(float(number))
