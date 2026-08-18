from __future__ import annotations

import json
from typing import Any

from .models import AppConfig


def build_score_feed_registration(rule_name: str, target: str, config: AppConfig | None) -> dict[str, object]:
    normalized_target = (target or 'prometheus').strip().lower()
    primary = _build_target_query(rule_name, normalized_target if normalized_target != 'all' else 'prometheus', config)
    registration: dict[str, object] = {
        'rule': rule_name,
        'target': normalized_target,
        **primary,
    }

    if normalized_target == 'all':
        variants = [_build_target_query(rule_name, 'prometheus', config)]
        enabled_sink_names = sorted(
            name
            for name, definition in (config.sinks.items() if config is not None else [])
            if definition.enabled and not definition.error
        )
        for sink_name in enabled_sink_names:
            variants.append(_build_target_query(rule_name, sink_name, config))
        registration['queryVariants'] = variants

    return registration


def _build_target_query(rule_name: str, target: str, config: AppConfig | None) -> dict[str, str]:
    if target == 'loki':
        return _build_loki_query(rule_name)
    if target == 'influxdb':
        return _build_influxdb_query(rule_name, _sink_settings(config, 'influxdb'))
    if target == 'postgresql':
        return _build_postgresql_query(rule_name, _sink_settings(config, 'postgresql'))
    if target == 'clickhouse':
        return _build_clickhouse_query(rule_name, _sink_settings(config, 'clickhouse'))
    if target == 'elasticsearch':
        return _build_elasticsearch_query(rule_name, _sink_settings(config, 'elasticsearch'))
    return _build_prometheus_query(rule_name)


def _sink_settings(config: AppConfig | None, name: str) -> dict[str, Any]:
    if config is None or name not in config.sinks:
        return {}
    return dict(config.sinks[name].settings)


def _build_prometheus_query(rule_name: str) -> dict[str, str]:
    rule = _escape_prom_label(rule_name)
    return {
        'queryLanguage': 'PromQL',
        'datasourceType': 'prometheus',
        'query': f'max_over_time(grafana_anomaly_rule_score{{rule="{rule}"}}[5m])',
        'perSeriesQuery': f'grafana_anomaly_score{{rule="{rule}"}}',
    }


def _build_loki_query(rule_name: str) -> dict[str, str]:
    rule = _escape_logql_label(rule_name)
    return {
        'queryLanguage': 'LogQL',
        'datasourceType': 'loki',
        'query': f'max_over_time({{record_type="rule",rule="{rule}"}} | json normalized_score="normalized_score" | unwrap normalized_score [5m])',
        'perSeriesQuery': f'max_over_time({{record_type="series",rule="{rule}"}} | json normalized_score="normalized_score" | unwrap normalized_score [5m])',
    }


def _build_influxdb_query(rule_name: str, settings: dict[str, Any]) -> dict[str, str]:
    measurement = _escape_flux_string(str(settings.get('measurement') or 'grafana_anomaly'))
    rule = _escape_flux_string(rule_name)
    version = int(settings.get('version') or 2)
    if version == 1:
        measurement_influxql = _escape_influxql_identifier(str(settings.get('measurement') or 'grafana_anomaly'))
        rule_influxql = _escape_sql_literal(rule_name)
        return {
            'queryLanguage': 'InfluxQL',
            'datasourceType': 'influxdb',
            'query': f'SELECT max("score") FROM "{measurement_influxql}" WHERE "record_type" = \'rule\' AND "rule" = \'{rule_influxql}\' AND time > now() - 5m',
            'perSeriesQuery': f'SELECT max("score") FROM "{measurement_influxql}" WHERE "record_type" = \'series\' AND "rule" = \'{rule_influxql}\' AND time > now() - 5m GROUP BY "source_metric"',
        }

    bucket = _escape_flux_string(str(settings.get('bucket') or 'anomaly'))
    base = f'from(bucket: "{bucket}") |> range(start: -5m) |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "score"'
    return {
        'queryLanguage': 'Flux',
        'datasourceType': 'influxdb',
        'query': f'{base} and r.record_type == "rule" and r.rule == "{rule}") |> aggregateWindow(every: 1m, fn: max, createEmpty: false) |> yield(name: "score")',
        'perSeriesQuery': f'{base} and r.record_type == "series" and r.rule == "{rule}") |> aggregateWindow(every: 1m, fn: max, createEmpty: false) |> yield(name: "series_score")',
    }


def _build_postgresql_query(rule_name: str, settings: dict[str, Any]) -> dict[str, str]:
    table = _safe_identifier(str(settings.get('table') or 'grafana_anomaly_scores'))
    rule = _escape_sql_literal(rule_name)
    return {
        'queryLanguage': 'SQL',
        'datasourceType': 'postgres',
        'query': f"SELECT $__timeGroup(ts, '1m') AS time, max(score) AS score FROM {table} WHERE $__timeFilter(ts) AND record_type = 'rule' AND rule = '{rule}' GROUP BY 1 ORDER BY 1",
        'perSeriesQuery': f"SELECT $__timeGroup(ts, '1m') AS time, source_metric, max(score) AS score FROM {table} WHERE $__timeFilter(ts) AND record_type = 'series' AND rule = '{rule}' GROUP BY 1, source_metric ORDER BY 1",
    }


def _build_clickhouse_query(rule_name: str, settings: dict[str, Any]) -> dict[str, str]:
    database = _safe_identifier(str(settings.get('database') or 'default'))
    table = _safe_identifier(str(settings.get('table') or 'grafana_anomaly_scores'))
    rule = _escape_sql_literal(rule_name)
    relation = f'{database}.{table}'
    return {
        'queryLanguage': 'SQL',
        'datasourceType': 'grafana-clickhouse-datasource',
        'query': f"SELECT toStartOfMinute(ts) AS time, max(score) AS score FROM {relation} WHERE $__timeFilter(ts) AND record_type = 'rule' AND rule = '{rule}' GROUP BY time ORDER BY time",
        'perSeriesQuery': f"SELECT toStartOfMinute(ts) AS time, source_metric, max(score) AS score FROM {relation} WHERE $__timeFilter(ts) AND record_type = 'series' AND rule = '{rule}' GROUP BY time, source_metric ORDER BY time",
    }


def _build_elasticsearch_query(rule_name: str, settings: dict[str, Any]) -> dict[str, str]:
    index_prefix = str(settings.get('index_prefix') or 'grafana-anomaly').strip() or 'grafana-anomaly'
    rule = _escape_lucene_phrase(rule_name)
    rule_query = {
        'index': f'{index_prefix}-*',
        'timeField': '@timestamp',
        'query': f'record_type:rule AND rule:"{rule}"',
        'metric': 'max(normalized_score)',
        'group_by': 'date_histogram(@timestamp, 1m)',
    }
    series_query = {
        'index': f'{index_prefix}-*',
        'timeField': '@timestamp',
        'query': f'record_type:series AND rule:"{rule}"',
        'metric': 'max(normalized_score)',
        'group_by': 'date_histogram(@timestamp, 1m) + source_metric',
    }
    return {
        'queryLanguage': 'Elasticsearch',
        'datasourceType': 'elasticsearch',
        'query': json.dumps(rule_query, separators=(',', ':')),
        'perSeriesQuery': json.dumps(series_query, separators=(',', ':')),
    }


def _escape_prom_label(value: str) -> str:
    return str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


def _escape_logql_label(value: str) -> str:
    return _escape_prom_label(value)


def _escape_flux_string(value: str) -> str:
    return str(value).replace('\\', '\\\\').replace('"', '\\"')


def _escape_sql_literal(value: str) -> str:
    return str(value).replace("'", "''")


def _escape_influxql_identifier(value: str) -> str:
    return str(value).replace('"', '\\"')


def _escape_lucene_phrase(value: str) -> str:
    return str(value).replace('\\', '\\\\').replace('"', '\\"')


def _safe_identifier(value: str) -> str:
    normalized = value.strip()
    if not normalized or not normalized.replace('_', '').isalnum():
        return 'grafana_anomaly_scores'
    return normalized
