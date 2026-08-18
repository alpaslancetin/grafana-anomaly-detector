from __future__ import annotations

import urllib.parse

from ..models import PrometheusRangeSeries, PrometheusSample
from .base import BaseSourceReader, SourceQueryError, http_json


class LokiSourceReader(BaseSourceReader):
    def query_range(self, start_time: float, end_time: float, step_seconds: int) -> list[PrometheusRangeSeries]:
        if not self.rule.datasource_url:
            raise SourceQueryError(f'rule {self.rule.name!r} requires datasource_url for Loki source.')
        params = urllib.parse.urlencode(
            {
                'query': self.rule.query,
                'start': f'{start_time:.3f}',
                'end': f'{end_time:.3f}',
                'step': max(1, int(step_seconds)),
            }
        )
        payload = http_json(f'{self.rule.datasource_url.rstrip("/")}/loki/api/v1/query_range?{params}', timeout_seconds=self.timeout_seconds)
        data = payload.get('data', {})
        if data.get('resultType') != 'matrix':
            raise SourceQueryError(f'Loki query must return matrix for rule {self.rule.name!r}; use range aggregation plus unwrap.')

        series: list[PrometheusRangeSeries] = []
        for row in data.get('result', []):
            labels = {str(key): str(value) for key, value in row.get('metric', {}).items()}
            labels.setdefault('__name__', self.rule.name)
            samples: list[PrometheusSample] = []
            for timestamp, value in row.get('values', []):
                try:
                    samples.append(PrometheusSample(labels=labels, value=float(value), timestamp=float(timestamp)))
                except (TypeError, ValueError):
                    continue
            if samples:
                series.append(PrometheusRangeSeries(labels=labels, samples=samples))
        return series
