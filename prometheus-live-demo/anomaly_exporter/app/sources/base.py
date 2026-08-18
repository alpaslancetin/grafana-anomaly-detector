from __future__ import annotations

import json
import time
import urllib.request
from datetime import datetime
from typing import Any

from ..models import PrometheusRangeSeries, PrometheusSample, RuleConfig


class SourceQueryError(RuntimeError):
    pass


class BaseSourceReader:
    def __init__(self, rule: RuleConfig, timeout_seconds: int) -> None:
        self.rule = rule
        self.timeout_seconds = timeout_seconds

    def query_range(self, start_time: float, end_time: float, step_seconds: int) -> list[PrometheusRangeSeries]:
        raise NotImplementedError


def http_json(url: str, *, method: str = 'GET', body: bytes | None = None, headers: dict[str, str] | None = None, timeout_seconds: int = 10) -> Any:
    request = urllib.request.Request(url=url, method=method, data=body, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as exc:  # noqa: BLE001
        raise SourceQueryError(f'HTTP source request failed for {url}: {exc}') from exc


def parse_timestamp(value: Any) -> float:
    if isinstance(value, (int, float)):
        timestamp = float(value)
        return timestamp / 1000 if timestamp > 10_000_000_000 else timestamp
    if value is None:
        return time.time()
    text = str(value).strip()
    if not text:
        return time.time()
    try:
        timestamp = float(text)
        return timestamp / 1000 if timestamp > 10_000_000_000 else timestamp
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp()
    except ValueError as exc:
        raise SourceQueryError(f'Could not parse timestamp value {value!r}.') from exc


def sample_from_row(row: dict[str, Any], labels: dict[str, str] | None = None) -> PrometheusSample | None:
    time_value = row.get('time', row.get('ts', row.get('timestamp', row.get('@timestamp', row.get('_time')))))
    value = row.get('value', row.get('score', row.get('normalized_score', row.get('_value'))))
    if value is None:
        return None
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None
    return PrometheusSample(labels=labels or {}, value=numeric_value, timestamp=parse_timestamp(time_value))


def single_series(name: str, samples: list[PrometheusSample], labels: dict[str, str] | None = None) -> list[PrometheusRangeSeries]:
    if not samples:
        return []
    merged_labels = {'__name__': name}
    merged_labels.update(labels or {})
    return [PrometheusRangeSeries(labels=merged_labels, samples=samples)]


LABEL_EXCLUDE_COLUMNS = {
    '',
    'result',
    'table',
    'time',
    'ts',
    'timestamp',
    '@timestamp',
    '_time',
    '_start',
    '_stop',
    'value',
    'score',
    'normalized_score',
    '_value',
    'raw_score',
    'expected',
    'lower',
    'upper',
    'deviation',
    'point_raw_score',
    'window_raw_score',
    'confidence_score',
    'threshold',
}


def labels_from_row(row: dict[str, Any], default_name: str) -> dict[str, str]:
    labels = {'__name__': str(row.get('__name__') or row.get('source_metric') or row.get('rule') or default_name)}
    for key, value in row.items():
        key_text = str(key)
        if key_text in LABEL_EXCLUDE_COLUMNS or value is None:
            continue
        value_text = str(value)
        if value_text:
            labels[key_text] = value_text
    return labels


def grouped_series(name: str, samples: list[PrometheusSample]) -> list[PrometheusRangeSeries]:
    grouped: dict[tuple[tuple[str, str], ...], list[PrometheusSample]] = {}
    labels_by_key: dict[tuple[tuple[str, str], ...], dict[str, str]] = {}
    for sample in samples:
        labels = {'__name__': name}
        labels.update(sample.labels)
        labels.setdefault('__name__', name)
        key = tuple(sorted(labels.items()))
        labels_by_key[key] = labels
        grouped.setdefault(key, []).append(sample)
    return [
        PrometheusRangeSeries(labels=labels_by_key[key], samples=sorted(values, key=lambda item: item.timestamp))
        for key, values in grouped.items()
        if values
    ]
