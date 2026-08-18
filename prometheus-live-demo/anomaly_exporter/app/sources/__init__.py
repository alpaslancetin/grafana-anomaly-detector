from __future__ import annotations

import os

from ..models import GlobalConfig, RuleConfig
from .base import BaseSourceReader, SourceQueryError
from .clickhouse import ClickHouseSourceReader
from .elasticsearch import ElasticsearchSourceReader
from .influxdb import InfluxDBSourceReader
from .loki import LokiSourceReader
from .postgresql import PostgreSQLSourceReader
from .prometheus import PrometheusSourceReader


def normalize_source_type(source_type: str) -> str:
    lowered = source_type.strip().lower()
    aliases = {
        '': 'prometheus',
        'prom': 'prometheus',
        'postgres': 'postgresql',
        'grafana-postgresql-datasource': 'postgresql',
        'grafana-influxdb-datasource': 'influxdb',
        'grafana-clickhouse-datasource': 'clickhouse',
        'elastic': 'elasticsearch',
        'es': 'elasticsearch',
    }
    return aliases.get(lowered, lowered)


def build_source_reader(rule: RuleConfig, global_config: GlobalConfig) -> BaseSourceReader:
    source_type = normalize_source_type(rule.source_type)
    if not rule.datasource_url:
        env_key = f'ANOMALY_SOURCE_{source_type.upper()}_URL'
        rule.datasource_url = os.environ.get(env_key, '')
    if source_type == 'prometheus':
        return PrometheusSourceReader(rule, global_config.request_timeout_seconds, global_config.prometheus_url)
    if source_type == 'loki':
        return LokiSourceReader(rule, global_config.request_timeout_seconds)
    if source_type == 'influxdb':
        return InfluxDBSourceReader(rule, global_config.request_timeout_seconds)
    if source_type == 'postgresql':
        return PostgreSQLSourceReader(rule, global_config.request_timeout_seconds)
    if source_type == 'clickhouse':
        return ClickHouseSourceReader(rule, global_config.request_timeout_seconds)
    if source_type == 'elasticsearch':
        return ElasticsearchSourceReader(rule, global_config.request_timeout_seconds)
    raise SourceQueryError(f'Unsupported source_type {rule.source_type!r} for rule {rule.name!r}.')


__all__ = ['BaseSourceReader', 'SourceQueryError', 'build_source_reader', 'normalize_source_type']
