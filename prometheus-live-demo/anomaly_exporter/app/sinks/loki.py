from __future__ import annotations

import json

from .base import AnomalySink, SinkBatch, json_bytes, snapshot_records, unix_ns, http_request


class LokiSink(AnomalySink):
    def __init__(self, settings: dict[str, object]) -> None:
        super().__init__('loki')
        self.url = str(settings.get('url', '')).rstrip('/')
        if not self.url:
            raise ValueError('loki.url is required when Loki sink is enabled.')
        self.labels = {str(key): str(value) for key, value in (settings.get('labels') or {}).items()} if isinstance(settings.get('labels'), dict) else {}
        self.batch_max_records = int(settings.get('batch_max_records') or 500)
        self.timeout_seconds = int(settings.get('timeout_seconds') or 5)
        self.verify = bool(settings.get('verify', True))

    def write(self, batch: SinkBatch) -> int:
        records = snapshot_records(batch)
        written = 0
        for offset in range(0, len(records), self.batch_max_records):
            chunk = records[offset : offset + self.batch_max_records]
            streams = []
            for record in chunk:
                stream = {
                    **self.labels,
                    'rule': str(record.get('rule', 'unknown')),
                    'record_type': str(record.get('record_type', 'series')),
                }
                streams.append(
                    {
                        'stream': stream,
                        'values': [[unix_ns(float(record['timestamp'])), json.dumps(record, separators=(',', ':'), sort_keys=True)]],
                    }
                )
            http_request(
                f'{self.url}/loki/api/v1/push',
                body=json_bytes({'streams': streams}),
                headers={'Content-Type': 'application/json'},
                timeout_seconds=self.timeout_seconds,
                verify=self.verify,
            )
            written += len(chunk)
        return written
