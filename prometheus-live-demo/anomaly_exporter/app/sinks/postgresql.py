from __future__ import annotations

import json
import os

from .base import AnomalySink, SinkBatch, iso_timestamp, snapshot_records


try:  # pragma: no cover - depends on optional deployment package
    import psycopg  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    psycopg = None

try:  # pragma: no cover - depends on optional deployment package
    import psycopg2  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    psycopg2 = None


class PostgreSQLSink(AnomalySink):
    def __init__(self, settings: dict[str, object]) -> None:
        super().__init__('postgresql')
        if psycopg is None and psycopg2 is None:
            raise ValueError('PostgreSQL sink requires optional psycopg or psycopg2 driver.')
        self.dsn_env = str(settings.get('dsn_env') or 'ANOMALY_SINK_PG_DSN')
        self.table = validate_identifier(str(settings.get('table') or 'grafana_anomaly_scores'))
        self.auto_create_table = bool(settings.get('auto_create_table', True))
        self.timeout_seconds = int(settings.get('timeout_seconds') or 5)
        self.connection = None

    def write(self, batch: SinkBatch) -> int:
        records = snapshot_records(batch)
        if not records:
            return 0
        try:
            return self._write_records(records)
        except Exception:
            self._disconnect()
            raise

    def _connect(self):
        if self.connection is not None:
            return self.connection
        dsn = os.environ.get(self.dsn_env, '')
        if not dsn:
            raise ValueError(f'PostgreSQL DSN env {self.dsn_env} is not set.')
        if psycopg is not None:
            self.connection = psycopg.connect(dsn, connect_timeout=self.timeout_seconds)
        else:
            self.connection = psycopg2.connect(dsn, connect_timeout=self.timeout_seconds)
        return self.connection

    def _disconnect(self) -> None:
        connection = self.connection
        self.connection = None
        if connection is None:
            return
        try:
            connection.close()
        except Exception:
            pass

    def _write_records(self, records: list[dict[str, object]]) -> int:
        connection = self._connect()
        if self.auto_create_table:
            self._create_table(connection)
        rows = [self._row(record) for record in records]
        sql = (
            f'INSERT INTO {self.table} '
            '(ts, record_type, rule, source_metric, labels, score, raw_score, confidence_score, value, expected, deviation, '
            'lower_bound, upper_bound, is_anomaly, severity_label, algorithm, decision_state, data_state) '
            'VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)'
        )
        with connection.cursor() as cursor:
            cursor.executemany(sql, rows)
        connection.commit()
        return len(rows)

    def _create_table(self, connection) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                f'''
                CREATE TABLE IF NOT EXISTS {self.table} (
                  ts timestamptz NOT NULL,
                  record_type text NOT NULL DEFAULT 'series',
                  rule text NOT NULL,
                  source_metric text NOT NULL,
                  labels jsonb NOT NULL,
                  score double precision,
                  raw_score double precision,
                  confidence_score double precision,
                  value double precision,
                  expected double precision,
                  deviation double precision,
                  lower_bound double precision,
                  upper_bound double precision,
                  is_anomaly boolean,
                  severity_label text,
                  algorithm text,
                  decision_state text,
                  data_state text
                )
                '''
            )
            cursor.execute(f"ALTER TABLE {self.table} ADD COLUMN IF NOT EXISTS record_type text NOT NULL DEFAULT 'series'")
            cursor.execute(f"ALTER TABLE {self.table} ADD COLUMN IF NOT EXISTS decision_state text")
            cursor.execute(f"ALTER TABLE {self.table} ADD COLUMN IF NOT EXISTS data_state text")
        connection.commit()

    def _row(self, record: dict[str, object]) -> tuple[object, ...]:
        return (
            iso_timestamp(float(record['timestamp'])),
            record.get('record_type') or 'series',
            record.get('rule'),
            record.get('source_metric'),
            json.dumps(record.get('labels') or {}, separators=(',', ':'), sort_keys=True),
            record.get('normalized_score'),
            record.get('raw_score'),
            record.get('confidence_score'),
            record.get('value'),
            record.get('expected'),
            record.get('deviation'),
            record.get('lower_bound'),
            record.get('upper_bound'),
            bool(record.get('is_anomaly')),
            record.get('severity_label'),
            record.get('algorithm'),
            record.get('decision_state'),
            record.get('data_state'),
        )


def validate_identifier(value: str) -> str:
    if not value.replace('_', '').isalnum() or not value:
        raise ValueError(f'Unsafe PostgreSQL identifier: {value!r}')
    return value
