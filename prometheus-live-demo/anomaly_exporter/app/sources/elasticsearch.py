from __future__ import annotations

import base64
import json
import os
import urllib.request

from ..models import PrometheusRangeSeries
from ..http_security import open_same_origin
from .base import BaseSourceReader, SourceQueryError, grouped_series, labels_from_row, sample_from_row


class ElasticsearchSourceReader(BaseSourceReader):
    def query_range(self, start_time: float, end_time: float, step_seconds: int) -> list[PrometheusRangeSeries]:
        if not self.rule.datasource_url:
            raise SourceQueryError(f'rule {self.rule.name!r} requires datasource_url for Elasticsearch source.')
        url = self.rule.datasource_url.rstrip('/')
        search_url = url if url.endswith('/_search') else f'{url}/_search'
        query_text = self.rule.query.strip()
        if query_text.startswith('{'):
            model = json.loads(query_text)
            if 'metrics' in model or 'bucketAggs' in model:
                body = _build_model_aggregation_query(model, start_time, end_time)
            else:
                body = self.rule.query
        else:
            body = json.dumps(
                {
                    'size': 1000,
                    'query': {
                        'bool': {
                            'filter': [
                                {'query_string': {'query': self.rule.query}},
                                {'range': {'@timestamp': {'gte': int(start_time * 1000), 'lte': int(end_time * 1000), 'format': 'epoch_millis'}}},
                            ]
                        }
                    },
                    'sort': [{'@timestamp': 'asc'}],
                }
            )
        headers = {'Content-Type': 'application/json'}
        user = os.environ.get('ANOMALY_SOURCE_ES_USER')
        password = os.environ.get('ANOMALY_SOURCE_ES_PASSWORD')
        if user and password:
            headers['Authorization'] = 'Basic ' + base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
        request = urllib.request.Request(url=search_url, method='POST', data=body.encode('utf-8'), headers=headers)
        try:
            with open_same_origin(request, self.timeout_seconds) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except Exception as exc:  # noqa: BLE001
            raise SourceQueryError(f'Elasticsearch query failed for rule {self.rule.name!r}: {exc}') from exc

        samples = []
        buckets = payload.get('aggregations', {}).get('by_time', {}).get('buckets', [])
        for bucket in buckets:
            value = (bucket.get('value') or {}).get('value')
            if value is None:
                continue
            sample = sample_from_row(
                {'@timestamp': bucket.get('key'), 'normalized_score': value, 'query': query_text},
                labels={'__name__': self.rule.name, 'query': query_text},
            )
            if sample is not None:
                samples.append(sample)
        if samples:
            return grouped_series(self.rule.name, samples)

        for hit in payload.get('hits', {}).get('hits', []):
            row = hit.get('_source', {})
            sample = sample_from_row(row, labels=labels_from_row(row, self.rule.name))
            if sample is not None:
                samples.append(sample)
        return grouped_series(self.rule.name, samples)


def _build_model_aggregation_query(model: dict[str, object], start_time: float, end_time: float) -> str:
    metrics = model.get('metrics') if isinstance(model.get('metrics'), list) else []
    bucket_aggs = model.get('bucketAggs') if isinstance(model.get('bucketAggs'), list) else []
    first_metric = next((item for item in metrics if isinstance(item, dict)), {})
    first_bucket = next((item for item in bucket_aggs if isinstance(item, dict)), {})
    metric_field = str(first_metric.get('field') or 'normalized_score')
    metric_type = str(first_metric.get('type') or 'max').lower()
    time_field = str(model.get('timeField') or first_bucket.get('field') or '@timestamp')
    settings = first_bucket.get('settings') if isinstance(first_bucket.get('settings'), dict) else {}
    interval = str(settings.get('interval') or '1m')
    metric_agg = metric_type if metric_type in {'avg', 'max', 'min', 'sum'} else 'max'
    return json.dumps(
        {
            'size': 0,
            'query': {
                'bool': {
                    'filter': [
                        {'query_string': {'query': str(model.get('query') or '*')}},
                        {'range': {time_field: {'gte': int(start_time * 1000), 'lte': int(end_time * 1000), 'format': 'epoch_millis'}}},
                    ]
                }
            },
            'aggs': {
                'by_time': {
                    'date_histogram': {'field': time_field, 'fixed_interval': interval, 'min_doc_count': 0},
                    'aggs': {'value': {metric_agg: {'field': metric_field}}},
                }
            },
        }
    )
