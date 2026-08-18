from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone

from .base import AnomalySink, SinkBatch, iso_timestamp, snapshot_records, http_request


class ElasticsearchSink(AnomalySink):
    def __init__(self, settings: dict[str, object]) -> None:
        super().__init__('elasticsearch')
        self.url = str(settings.get('url', '')).rstrip('/')
        if not self.url:
            raise ValueError('elasticsearch.url is required when Elasticsearch sink is enabled.')
        self.index_prefix = str(settings.get('index_prefix') or 'grafana-anomaly').strip()
        self.user_env = str(settings.get('user_env') or 'ANOMALY_SINK_ES_USER')
        self.password_env = str(settings.get('password_env') or 'ANOMALY_SINK_ES_PASSWORD')
        self.timeout_seconds = int(settings.get('timeout_seconds') or 5)
        self.verify = bool(settings.get('verify', True))

    def write(self, batch: SinkBatch) -> int:
        records = snapshot_records(batch)
        if not records:
            return 0
        lines: list[str] = []
        for record in records:
            index = self._index_name(float(record['timestamp']))
            document = dict(record)
            document['@timestamp'] = iso_timestamp(float(record['timestamp']))
            lines.append(json.dumps({'index': {'_index': index}}, separators=(',', ':')))
            lines.append(json.dumps(document, separators=(',', ':'), sort_keys=True))
        body = ('\n'.join(lines) + '\n').encode('utf-8')
        response = http_request(
            f'{self.url}/_bulk',
            body=body,
            headers=self._headers(),
            timeout_seconds=self.timeout_seconds,
            verify=self.verify,
        )
        payload = json.loads(response.decode('utf-8') or '{}')
        if payload.get('errors'):
            raise RuntimeError(f'Elasticsearch bulk write returned item errors: {payload}')
        return len(records)

    def _index_name(self, timestamp: float) -> str:
        suffix = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime('%Y.%m.%d')
        return f'{self.index_prefix}-{suffix}'

    def _headers(self) -> dict[str, str]:
        headers = {'Content-Type': 'application/x-ndjson'}
        user = os.environ.get(self.user_env, '')
        password = os.environ.get(self.password_env, '')
        if user or password:
            token = base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
            headers['Authorization'] = f'Basic {token}'
        return headers
