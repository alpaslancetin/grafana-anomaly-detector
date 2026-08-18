from __future__ import annotations

import os
import re
from typing import Any

from ..models import PrometheusRangeSeries, PrometheusSample
from .base import BaseSourceReader, SourceQueryError, grouped_series, labels_from_row, parse_timestamp

try:  # pragma: no cover - depends on optional runtime package
    import psycopg  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    psycopg = None  # type: ignore

try:  # pragma: no cover - depends on optional runtime package
    import psycopg2  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    psycopg2 = None  # type: ignore


class PostgreSQLSourceReader(BaseSourceReader):
    def query_range(self, start_time: float, end_time: float, step_seconds: int) -> list[PrometheusRangeSeries]:
        dsn = self.rule.datasource_url or os.environ.get('ANOMALY_SOURCE_PG_DSN', '')
        if not dsn:
            raise SourceQueryError(f'rule {self.rule.name!r} requires datasource_url or ANOMALY_SOURCE_PG_DSN for PostgreSQL source.')
        query = _expand_grafana_macros(self.rule.query, start_time, end_time, step_seconds)
        rows: list[Any]
        if psycopg is not None:
            with psycopg.connect(dsn, connect_timeout=self.timeout_seconds) as conn:  # type: ignore[union-attr]
                with conn.cursor() as cursor:
                    cursor.execute(query)
                    rows = cursor.fetchall()
                    columns = [item.name for item in cursor.description or []]
        elif psycopg2 is not None:
            with psycopg2.connect(dsn, connect_timeout=self.timeout_seconds) as conn:  # type: ignore[union-attr]
                with conn.cursor() as cursor:
                    cursor.execute(query)
                    rows = cursor.fetchall()
                    columns = [item.name for item in cursor.description or []]
        else:
            raise SourceQueryError('PostgreSQL source requires optional psycopg or psycopg2 package.')

        samples: list[PrometheusSample] = []
        for row in rows:
            record = dict(zip(columns, row))
            value = record.get('value', record.get('score', record.get('normalized_score')))
            if value is None:
                continue
            try:
                samples.append(
                    PrometheusSample(
                        labels=labels_from_row(record, self.rule.name),
                        value=float(value),
                        timestamp=parse_timestamp(record.get('time', record.get('ts', record.get('timestamp')))),
                    )
                )
            except (SourceQueryError, TypeError, ValueError):
                continue
        return grouped_series(self.rule.name, samples)


def _expand_grafana_macros(query: str, start_time: float, end_time: float, step_seconds: int) -> str:
    expanded = query
    expanded = re.sub(
        r"\$__timeFilter\(([^)]+)\)",
        lambda match: f"{match.group(1)} >= to_timestamp({int(start_time)}) AND {match.group(1)} <= to_timestamp({int(end_time)})",
        expanded,
    )
    expanded = re.sub(
        r"\$__timeGroup\(([^,]+),\s*'([^']+)'\)",
        lambda match: _postgres_time_group(match.group(1), match.group(2)),
        expanded,
    )
    return expanded.replace('$__from', str(int(start_time))).replace('$__to', str(int(end_time))).replace('$__step', str(max(1, step_seconds)))


def _postgres_time_group(column: str, interval: str) -> str:
    normalized = interval.strip().lower()
    if normalized.endswith('m'):
        return f"date_trunc('minute', {column.strip()})"
    if normalized.endswith('h'):
        return f"date_trunc('hour', {column.strip()})"
    if normalized.endswith('d'):
        return f"date_trunc('day', {column.strip()})"
    return f"date_trunc('second', {column.strip()})"
