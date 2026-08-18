from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request

from ..models import PrometheusRangeSeries
from .base import BaseSourceReader, SourceQueryError, grouped_series, labels_from_row, sample_from_row


class ClickHouseSourceReader(BaseSourceReader):
    def query_range(self, start_time: float, end_time: float, step_seconds: int) -> list[PrometheusRangeSeries]:
        if not self.rule.datasource_url:
            raise SourceQueryError(f'rule {self.rule.name!r} requires datasource_url for ClickHouse source.')
        query = _expand_grafana_macros(self.rule.query, start_time, end_time, step_seconds)
        if ' format ' not in query.lower():
            query = f'{query.rstrip(";")} FORMAT JSONEachRow'
        params = {'query': query}
        user = os.environ.get('ANOMALY_SOURCE_CH_USER')
        password = os.environ.get('ANOMALY_SOURCE_CH_PASSWORD')
        if user:
            params['user'] = user
        if password:
            params['password'] = password
        url = f'{self.rule.datasource_url.rstrip("/")}/?{urllib.parse.urlencode(params)}'
        request = urllib.request.Request(url=url, method='GET')
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                lines = response.read().decode('utf-8').splitlines()
        except Exception as exc:  # noqa: BLE001
            raise SourceQueryError(f'ClickHouse query failed for rule {self.rule.name!r}: {exc}') from exc

        samples = []
        for line in lines:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                sample = sample_from_row(row, labels=labels_from_row(row, self.rule.name))
            except (json.JSONDecodeError, SourceQueryError):
                continue
            if sample is not None:
                samples.append(sample)
        return grouped_series(self.rule.name, samples)


def _expand_grafana_macros(query: str, start_time: float, end_time: float, step_seconds: int) -> str:
    expanded = re.sub(
        r"\$__timeFilter\(([^)]+)\)",
        lambda match: f"{match.group(1)} >= toDateTime({int(start_time)}) AND {match.group(1)} <= toDateTime({int(end_time)})",
        query,
    )
    expanded = re.sub(
        r"\$__timeGroup\(([^,]+),\s*'([^']+)'\)",
        lambda match: _clickhouse_time_group(match.group(1), match.group(2)),
        expanded,
    )
    return expanded.replace('$__from', str(int(start_time))).replace('$__to', str(int(end_time))).replace('$__step', str(max(1, step_seconds)))


def _clickhouse_time_group(column: str, interval: str) -> str:
    normalized = interval.strip().lower()
    column = column.strip()
    if normalized.endswith('m'):
        return f'toStartOfMinute({column})'
    if normalized.endswith('h'):
        return f'toStartOfHour({column})'
    if normalized.endswith('d'):
        return f'toStartOfDay({column})'
    return column
