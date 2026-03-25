from __future__ import annotations

import json
import urllib.parse
import urllib.request

from .models import PrometheusSample


class PrometheusQueryError(RuntimeError):
    pass


class PrometheusClient:
    def __init__(self, base_url: str, timeout_seconds: int) -> None:
        self.base_url = base_url.rstrip('/')
        self.timeout_seconds = timeout_seconds

    def instant_query(self, query: str, evaluation_time: float) -> list[PrometheusSample]:
        params = urllib.parse.urlencode({'query': query, 'time': f'{evaluation_time:.3f}'})
        url = f'{self.base_url}/api/v1/query?{params}'
        request = urllib.request.Request(url=url, method='GET')

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except Exception as exc:  # noqa: BLE001
            raise PrometheusQueryError(f'Query to Prometheus failed for {query!r}: {exc}') from exc

        if payload.get('status') != 'success':
            raise PrometheusQueryError(f'Prometheus returned non-success status for {query!r}: {payload}')

        data = payload.get('data', {})
        result_type = data.get('resultType')
        result = data.get('result', [])

        if result_type == 'vector':
            samples: list[PrometheusSample] = []
            for row in result:
                metric = {str(key): str(value) for key, value in row.get('metric', {}).items()}
                timestamp, value = row.get('value', [evaluation_time, '0'])
                try:
                    numeric_value = float(value)
                except (TypeError, ValueError):
                    continue
                samples.append(PrometheusSample(labels=metric, value=numeric_value, timestamp=float(timestamp)))
            return samples

        if result_type == 'scalar':
            timestamp, value = result
            return [PrometheusSample(labels={}, value=float(value), timestamp=float(timestamp))]

        raise PrometheusQueryError(f'Unsupported Prometheus result type {result_type!r} for query {query!r}.')
