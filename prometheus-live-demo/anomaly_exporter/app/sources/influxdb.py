from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import urllib.parse
import urllib.request

from ..models import PrometheusRangeSeries, PrometheusSample
from .base import BaseSourceReader, SourceQueryError, grouped_series, labels_from_row, parse_timestamp


class InfluxDBSourceReader(BaseSourceReader):
    def query_range(self, start_time: float, end_time: float, step_seconds: int) -> list[PrometheusRangeSeries]:
        if not self.rule.datasource_url:
            raise SourceQueryError(f'rule {self.rule.name!r} requires datasource_url for InfluxDB source.')
        org = os.environ.get('ANOMALY_SOURCE_INFLUX_ORG', 'anomaly')
        token = os.environ.get('ANOMALY_SOURCE_INFLUX_TOKEN', '')
        query = _expand_grafana_macros(self.rule.query, start_time, end_time, step_seconds)
        url = f'{self.rule.datasource_url.rstrip("/")}/api/v2/query?{urllib.parse.urlencode({"org": org})}'
        body = json.dumps({'query': query}).encode('utf-8')
        headers = {'Content-Type': 'application/json', 'Accept': 'application/csv'}
        if token:
            headers['Authorization'] = f'Token {token}'
        request = urllib.request.Request(url=url, method='POST', data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                text = response.read().decode('utf-8')
        except Exception as exc:  # noqa: BLE001
            raise SourceQueryError(f'InfluxDB query failed for rule {self.rule.name!r}: {exc}') from exc

        samples: list[PrometheusSample] = []
        for row in csv.DictReader(line for line in io.StringIO(text) if not line.startswith('#')):
            value = row.get('_value')
            if value is None:
                continue
            try:
                samples.append(PrometheusSample(labels=labels_from_row(row, self.rule.name), value=float(value), timestamp=parse_timestamp(row.get('_time'))))
            except (SourceQueryError, TypeError, ValueError):
                continue
        return grouped_series(self.rule.name, samples)


def _expand_grafana_macros(query: str, start_time: float, end_time: float, step_seconds: int) -> str:
    start_iso = _flux_time(start_time)
    end_iso = _flux_time(end_time)
    return (
        query.replace('v.timeRangeStart', f'time(v: "{start_iso}")')
        .replace('v.timeRangeStop', f'time(v: "{end_iso}")')
        .replace('$__from', start_iso)
        .replace('$__to', end_iso)
        .replace('$__step', f'{max(1, step_seconds)}s')
    )


def _flux_time(value: float) -> str:
    return dt.datetime.fromtimestamp(value, tz=dt.timezone.utc).isoformat().replace('+00:00', 'Z')
