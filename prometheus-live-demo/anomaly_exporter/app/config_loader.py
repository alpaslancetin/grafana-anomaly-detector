from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

from .models import (
    AppConfig,
    GlobalConfig,
    RuleConfig,
    SinkDefinition,
    SUPPORTED_AGGREGATIONS,
    SUPPORTED_ALGORITHMS,
    SUPPORTED_ANOMALY_DIRECTIONS,
    SUPPORTED_SEASONAL_REFINEMENTS,
    SUPPORTED_SEVERITY_PRESETS,
)


class ConfigError(RuntimeError):
    pass


try:
    import yaml  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - fallback path for portable mode
    yaml = None


def _env_override(name: str, value: object) -> object:
    override = os.environ.get(name)
    return override if override not in (None, '') else value


def _as_positive_int(value: object, field_name: str, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f'{field_name} must be an integer.') from exc
    if parsed <= 0:
        raise ConfigError(f'{field_name} must be positive.')
    return parsed


def _as_non_negative_int(value: object, field_name: str, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f'{field_name} must be an integer.') from exc
    if parsed < 0:
        raise ConfigError(f'{field_name} must be zero or positive.')
    return parsed


def _as_positive_float(value: object, field_name: str, default: float) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f'{field_name} must be a number.') from exc
    if not math.isfinite(parsed) or parsed <= 0:
        raise ConfigError(f'{field_name} must be a finite positive number.')
    return parsed


def _as_non_negative_float(value: object, field_name: str, default: float) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f'{field_name} must be a number.') from exc
    if not math.isfinite(parsed) or parsed < 0:
        raise ConfigError(f'{field_name} must be a finite zero or positive number.')
    return parsed


def _as_bool(value: object, field_name: str, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    lowered = str(value).strip().lower()
    if lowered in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if lowered in {'0', 'false', 'no', 'n', 'off'}:
        return False
    raise ConfigError(f'{field_name} must be a boolean.')


def _as_string_list(value: object, field_name: str) -> list[str]:
    if value in (None, ''):
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(',') if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raise ConfigError(f'{field_name} must be a list or comma-separated string.')


def _normalize_base_path(value: object) -> str:
    path = str(value or '').strip()
    if not path or path == '/':
        return ''
    if '://' in path or '?' in path or '#' in path:
        raise ConfigError('global.base_path must be a URL path such as /anomalyalarm.')
    normalized = '/' + path.strip('/')
    if '//' in normalized:
        raise ConfigError('global.base_path must not contain empty path segments.')
    return normalized


def _parse_inline_map(value: str) -> dict[str, object]:
    body = value.strip()[1:-1].strip()
    if not body:
        return {}
    result: dict[str, object] = {}
    for item in body.split(','):
        if ':' not in item:
            raise ConfigError(f'Unsupported inline mapping item: {item}')
        key, rest = item.split(':', 1)
        result[key.strip()] = _parse_scalar(rest.strip())
    return result


def _parse_scalar(value: str) -> object:
    stripped = value.strip()
    if stripped == '':
        return ''
    if stripped in {'[]', '[ ]'}:
        return []
    lowered = stripped.lower()
    if lowered == 'true':
        return True
    if lowered == 'false':
        return False
    if lowered in {'null', 'none'}:
        return None
    if (stripped.startswith('"') and stripped.endswith('"')) or (stripped.startswith("'") and stripped.endswith("'")):
        return stripped[1:-1]
    if stripped.startswith('{') and stripped.endswith('}'):
        return _parse_inline_map(stripped)
    try:
        if any(token in stripped for token in ('.', 'e', 'E')):
            return float(stripped)
        return int(stripped)
    except ValueError:
        return stripped


def _load_yaml_with_fallback(raw_text: str) -> dict[str, Any]:
    if yaml is not None:
        return yaml.safe_load(raw_text) or {}

    data: dict[str, Any] = {}
    section: str | None = None
    current_rule: dict[str, Any] | None = None
    current_sink: dict[str, Any] | None = None
    current_nested_map: dict[str, Any] | None = None

    for raw_line in raw_text.splitlines():
        if not raw_line.strip():
            continue
        line = raw_line.split('#', 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(' '))
        stripped = line.strip()

        if indent == 0:
            current_rule = None
            current_sink = None
            current_nested_map = None
            if ':' not in stripped:
                raise ConfigError(f'Unsupported config line: {raw_line}')
            key, rest = stripped.split(':', 1)
            key = key.strip()
            rest = rest.strip()
            if key == 'global':
                section = 'global'
                data['global'] = {} if rest == '' else _parse_scalar(rest)
                if not isinstance(data['global'], dict):
                    raise ConfigError('global must be a mapping.')
            elif key == 'rules':
                section = 'rules'
                data['rules'] = [] if rest in {'', '[]', '[ ]'} else _parse_scalar(rest)
                if not isinstance(data['rules'], list):
                    raise ConfigError('rules must be a list.')
            elif key == 'sinks':
                section = 'sinks'
                data['sinks'] = {} if rest == '' else _parse_scalar(rest)
                if not isinstance(data['sinks'], dict):
                    raise ConfigError('sinks must be a mapping.')
            else:
                data[key] = _parse_scalar(rest)
            continue

        if section == 'global':
            if indent < 2 or ':' not in stripped:
                raise ConfigError(f'Unsupported global config line: {raw_line}')
            key, rest = stripped.split(':', 1)
            data['global'][key.strip()] = _parse_scalar(rest.strip())
            continue

        if section == 'sinks':
            if indent == 2:
                if ':' not in stripped:
                    raise ConfigError(f'Unsupported sink config line: {raw_line}')
                key, rest = stripped.split(':', 1)
                sink_name = key.strip()
                rest = rest.strip()
                if rest:
                    parsed = _parse_scalar(rest)
                    if not isinstance(parsed, dict):
                        raise ConfigError(f'sinks.{sink_name} must be a mapping.')
                    data['sinks'][sink_name] = parsed
                    current_sink = data['sinks'][sink_name]
                else:
                    current_sink = {}
                    data['sinks'][sink_name] = current_sink
                current_nested_map = None
                continue

            if current_sink is None:
                raise ConfigError(f'Sink entry expected before line: {raw_line}')

            if indent == 4:
                if ':' not in stripped:
                    raise ConfigError(f'Unsupported sink property line: {raw_line}')
                key, rest = stripped.split(':', 1)
                key = key.strip()
                rest = rest.strip()
                if rest == '':
                    current_sink[key] = {}
                    current_nested_map = current_sink[key]
                else:
                    current_sink[key] = _parse_scalar(rest)
                    current_nested_map = None
                continue

            if indent == 6 and current_nested_map is not None:
                if ':' not in stripped:
                    raise ConfigError(f'Unsupported nested sink mapping line: {raw_line}')
                key, rest = stripped.split(':', 1)
                current_nested_map[key.strip()] = _parse_scalar(rest.strip())
                continue

            raise ConfigError(f'Unsupported sinks YAML subset near line: {raw_line}')

        if section != 'rules':
            raise ConfigError(f'Unsupported config structure near line: {raw_line}')

        if indent == 2 and stripped.startswith('- '):
            rule_line = stripped[2:].strip()
            current_rule = {}
            current_nested_map = None
            data['rules'].append(current_rule)
            if rule_line:
                if ':' not in rule_line:
                    raise ConfigError(f'Unsupported rule line: {raw_line}')
                key, rest = rule_line.split(':', 1)
                rest = rest.strip()
                if rest == '':
                    current_rule[key.strip()] = {}
                    current_nested_map = current_rule[key.strip()]
                else:
                    current_rule[key.strip()] = _parse_scalar(rest)
            continue

        if current_rule is None:
            raise ConfigError(f'Rule entry expected before line: {raw_line}')

        if indent == 4:
            if ':' not in stripped:
                raise ConfigError(f'Unsupported rule property line: {raw_line}')
            key, rest = stripped.split(':', 1)
            key = key.strip()
            rest = rest.strip()
            if rest == '':
                current_rule[key] = {}
                current_nested_map = current_rule[key]
            else:
                current_rule[key] = _parse_scalar(rest)
                current_nested_map = None
            continue

        if indent == 6 and current_nested_map is not None:
            if ':' not in stripped:
                raise ConfigError(f'Unsupported nested mapping line: {raw_line}')
            key, rest = stripped.split(':', 1)
            current_nested_map[key.strip()] = _parse_scalar(rest.strip())
            continue

        raise ConfigError(f'Unsupported YAML subset near line: {raw_line}')

    return data


SINK_ENV_FIELDS = {
    'loki': {
        'enabled': 'ANOMALY_SINK_LOKI_ENABLED',
        'url': 'ANOMALY_SINK_LOKI_URL',
        'batch_max_records': 'ANOMALY_SINK_LOKI_BATCH_MAX_RECORDS',
        'timeout_seconds': 'ANOMALY_SINK_LOKI_TIMEOUT_SECONDS',
        'verify': 'ANOMALY_SINK_LOKI_VERIFY',
    },
    'influxdb': {
        'enabled': 'ANOMALY_SINK_INFLUX_ENABLED',
        'url': 'ANOMALY_SINK_INFLUX_URL',
        'version': 'ANOMALY_SINK_INFLUX_VERSION',
        'org': 'ANOMALY_SINK_INFLUX_ORG',
        'bucket': 'ANOMALY_SINK_INFLUX_BUCKET',
        'database': 'ANOMALY_SINK_INFLUX_DATABASE',
        'token_env': 'ANOMALY_SINK_INFLUX_TOKEN_ENV',
        'measurement': 'ANOMALY_SINK_INFLUX_MEASUREMENT',
        'timeout_seconds': 'ANOMALY_SINK_INFLUX_TIMEOUT_SECONDS',
        'verify': 'ANOMALY_SINK_INFLUX_VERIFY',
    },
    'postgresql': {
        'enabled': 'ANOMALY_SINK_PG_ENABLED',
        'dsn_env': 'ANOMALY_SINK_PG_DSN_ENV',
        'table': 'ANOMALY_SINK_PG_TABLE',
        'auto_create_table': 'ANOMALY_SINK_PG_AUTO_CREATE_TABLE',
        'timeout_seconds': 'ANOMALY_SINK_PG_TIMEOUT_SECONDS',
    },
    'clickhouse': {
        'enabled': 'ANOMALY_SINK_CH_ENABLED',
        'url': 'ANOMALY_SINK_CH_URL',
        'database': 'ANOMALY_SINK_CH_DATABASE',
        'table': 'ANOMALY_SINK_CH_TABLE',
        'user_env': 'ANOMALY_SINK_CH_USER_ENV',
        'password_env': 'ANOMALY_SINK_CH_PASSWORD_ENV',
        'auto_create_table': 'ANOMALY_SINK_CH_AUTO_CREATE_TABLE',
        'timeout_seconds': 'ANOMALY_SINK_CH_TIMEOUT_SECONDS',
        'verify': 'ANOMALY_SINK_CH_VERIFY',
    },
    'elasticsearch': {
        'enabled': 'ANOMALY_SINK_ES_ENABLED',
        'url': 'ANOMALY_SINK_ES_URL',
        'index_prefix': 'ANOMALY_SINK_ES_INDEX_PREFIX',
        'user_env': 'ANOMALY_SINK_ES_USER_ENV',
        'password_env': 'ANOMALY_SINK_ES_PASSWORD_ENV',
        'timeout_seconds': 'ANOMALY_SINK_ES_TIMEOUT_SECONDS',
        'verify': 'ANOMALY_SINK_ES_VERIFY',
    },
}


def _sink_settings_with_env(sink_name: str, settings: dict[str, object]) -> dict[str, object]:
    merged = dict(settings)
    for key, env_name in SINK_ENV_FIELDS.get(sink_name, {}).items():
        merged[key] = _env_override(env_name, merged.get(key))
    return merged


def _load_sink_definitions(raw: dict[str, Any]) -> dict[str, SinkDefinition]:
    sinks_raw = raw.get('sinks', {}) or {}
    if not isinstance(sinks_raw, dict):
        raise ConfigError('Config sinks must be a mapping under sinks:.')

    definitions: dict[str, SinkDefinition] = {}
    for sink_name, settings_raw in sinks_raw.items():
        name = str(sink_name).strip().lower()
        if not isinstance(settings_raw, dict):
            definitions[name] = SinkDefinition(name=name, enabled=False, error=f'sinks.{name} must be a mapping.')
            continue

        settings = _sink_settings_with_env(name, settings_raw)
        try:
            enabled = _as_bool(settings.get('enabled'), f'sinks.{name}.enabled', False)
        except ConfigError as exc:
            definitions[name] = SinkDefinition(name=name, enabled=False, settings=settings, error=str(exc))
            continue

        for bool_key in ('verify', 'auto_create_table'):
            if bool_key in settings:
                try:
                    settings[bool_key] = _as_bool(settings.get(bool_key), f'sinks.{name}.{bool_key}', True)
                except ConfigError as exc:
                    definitions[name] = SinkDefinition(name=name, enabled=False, settings=settings, error=str(exc))
                    break
        else:
            definitions[name] = SinkDefinition(name=name, enabled=enabled, settings=settings)

    return definitions


def _parse_target_sinks(raw: object) -> list[str] | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        value = raw.strip()
        if not value or value.lower() == 'all':
            return None
        return [part.strip().lower() for part in value.split(',') if part.strip()]
    if isinstance(raw, list):
        return [str(item).strip().lower() for item in raw if str(item).strip()]
    raise ConfigError('target_sinks must be a list, comma-separated string, all, or omitted.')


def load_config(path: str | Path) -> AppConfig:
    raw_text = Path(path).read_text(encoding='utf-8')
    raw = _load_yaml_with_fallback(raw_text)
    global_raw = raw.get('global', {}) or {}
    rules_raw = raw.get('rules', [])
    sinks = _load_sink_definitions(raw)

    if rules_raw is None:
        rules_raw = []
    if not isinstance(rules_raw, list):
        raise ConfigError('Config rules must be a list under rules:.')

    global_defaults = GlobalConfig()
    global_config = GlobalConfig(
        prometheus_url=str(_env_override('ANOMALY_PROMETHEUS_URL', global_raw.get('prometheus_url', global_defaults.prometheus_url))).rstrip('/'),
        evaluation_interval_seconds=_as_positive_int(
            _env_override('ANOMALY_EVALUATION_INTERVAL_SECONDS', global_raw.get('evaluation_interval_seconds')),
            'global.evaluation_interval_seconds',
            global_defaults.evaluation_interval_seconds,
        ),
        request_timeout_seconds=_as_positive_int(
            _env_override('ANOMALY_REQUEST_TIMEOUT_SECONDS', global_raw.get('request_timeout_seconds')),
            'global.request_timeout_seconds',
            global_defaults.request_timeout_seconds,
        ),
        listen_host=str(_env_override('ANOMALY_LISTEN_HOST', global_raw.get('listen_host', global_defaults.listen_host))),
        listen_port=_as_positive_int(
            _env_override('ANOMALY_LISTEN_PORT', global_raw.get('listen_port')),
            'global.listen_port',
            global_defaults.listen_port,
        ),
        config_reload_interval_seconds=_as_positive_int(
            _env_override('ANOMALY_CONFIG_RELOAD_INTERVAL_SECONDS', global_raw.get('config_reload_interval_seconds')),
            'global.config_reload_interval_seconds',
            global_defaults.config_reload_interval_seconds,
        ),
        base_path=_normalize_base_path(_env_override('ANOMALY_BASE_PATH', global_raw.get('base_path', global_defaults.base_path))),
        cors_allowed_origins=_as_string_list(
            _env_override('ANOMALY_CORS_ALLOWED_ORIGINS', global_raw.get('cors_allowed_origins')),
            'global.cors_allowed_origins',
        ),
        api_token_env=str(_env_override('ANOMALY_API_TOKEN_ENV', global_raw.get('api_token_env', global_defaults.api_token_env))).strip(),
        max_request_body_bytes=_as_positive_int(
            _env_override('ANOMALY_MAX_REQUEST_BODY_BYTES', global_raw.get('max_request_body_bytes')),
            'global.max_request_body_bytes',
            global_defaults.max_request_body_bytes,
        ),
        allowed_datasource_hosts=_as_string_list(
            _env_override('ANOMALY_ALLOWED_DATASOURCE_HOSTS', global_raw.get('allowed_datasource_hosts')),
            'global.allowed_datasource_hosts',
        ),
        max_dynamic_rules=_as_positive_int(
            global_raw.get('max_dynamic_rules'), 'global.max_dynamic_rules', global_defaults.max_dynamic_rules
        ),
        max_rules_per_panel=_as_positive_int(
            global_raw.get('max_rules_per_panel'), 'global.max_rules_per_panel', global_defaults.max_rules_per_panel
        ),
        max_query_length=_as_positive_int(
            global_raw.get('max_query_length'), 'global.max_query_length', global_defaults.max_query_length
        ),
        max_feed_series=_as_positive_int(
            global_raw.get('max_feed_series'), 'global.max_feed_series', global_defaults.max_feed_series
        ),
        runtime_scope_ttl_seconds=_as_non_negative_int(
            global_raw.get('runtime_scope_ttl_seconds'),
            'global.runtime_scope_ttl_seconds',
            global_defaults.runtime_scope_ttl_seconds,
        ),
        pushed_feed_ttl_seconds=_as_non_negative_int(
            global_raw.get('pushed_feed_ttl_seconds'),
            'global.pushed_feed_ttl_seconds',
            global_defaults.pushed_feed_ttl_seconds,
        ),
        api_rate_limit_per_minute=_as_positive_int(
            global_raw.get('api_rate_limit_per_minute'),
            'global.api_rate_limit_per_minute',
            global_defaults.api_rate_limit_per_minute,
        ),
    )

    rules: list[RuleConfig] = []
    seen_names: set[str] = set()

    for index, entry in enumerate(rules_raw, start=1):
        if not isinstance(entry, dict):
            raise ConfigError(f'rules[{index}] must be a mapping.')

        name = str(entry.get('name', '')).strip()
        query = str(entry.get('query', '')).strip()
        if not name:
            raise ConfigError(f'rules[{index}].name is required.')
        if not query:
            raise ConfigError(f'rules[{index}].query is required.')
        if name in seen_names:
            raise ConfigError(f'rule name {name!r} is duplicated.')
        seen_names.add(name)

        algorithm = str(entry.get('algorithm', 'mad')).strip().lower()
        if algorithm not in SUPPORTED_ALGORITHMS:
            raise ConfigError(f'rules[{index}].algorithm must be one of: {sorted(SUPPORTED_ALGORITHMS)}')

        anomaly_direction = str(entry.get('anomaly_direction', 'high_or_low')).strip().lower()
        if anomaly_direction not in SUPPORTED_ANOMALY_DIRECTIONS:
            raise ConfigError(
                f'rules[{index}].anomaly_direction must be one of: {sorted(SUPPORTED_ANOMALY_DIRECTIONS)}'
            )

        seasonal_refinement = str(entry.get('seasonal_refinement', 'cycle')).strip().lower()
        if seasonal_refinement not in SUPPORTED_SEASONAL_REFINEMENTS:
            raise ConfigError(
                f'rules[{index}].seasonal_refinement must be one of: {sorted(SUPPORTED_SEASONAL_REFINEMENTS)}'
            )

        severity_preset = str(entry.get('severity_preset', 'balanced')).strip().lower()
        if severity_preset not in SUPPORTED_SEVERITY_PRESETS:
            raise ConfigError(f'rules[{index}].severity_preset must be one of: {sorted(SUPPORTED_SEVERITY_PRESETS)}')

        aggregation = str(entry.get('aggregation', 'max')).strip().lower()
        if aggregation not in SUPPORTED_AGGREGATIONS:
            raise ConfigError(f'rules[{index}].aggregation must be one of: {sorted(SUPPORTED_AGGREGATIONS)}')

        labels = entry.get('labels', {}) or {}
        if not isinstance(labels, dict):
            raise ConfigError(f'rules[{index}].labels must be a mapping.')

        threshold = _as_positive_float(entry.get('threshold'), f'rules[{index}].threshold', 4.0)
        recovery_threshold = _as_non_negative_float(
            entry.get('recovery_threshold'), f'rules[{index}].recovery_threshold', 0.0
        )
        if recovery_threshold > threshold:
            raise ConfigError(f'rules[{index}].recovery_threshold must not exceed threshold.')

        rules.append(
            RuleConfig(
                name=name,
                query=query,
                source_type=str(entry.get('source_type', entry.get('datasource_type', 'prometheus'))).strip().lower() or 'prometheus',
                datasource_url=str(entry.get('datasource_url', '')).strip(),
                target_sinks=_parse_target_sinks(entry.get('target_sinks', entry.get('sink_targets'))),
                range_seconds=_as_non_negative_int(entry.get('range_seconds'), f'rules[{index}].range_seconds', 0),
                step_seconds=_as_non_negative_int(entry.get('step_seconds'), f'rules[{index}].step_seconds', 0),
                bucket_span_seconds=_as_non_negative_int(entry.get('bucket_span_seconds'), f'rules[{index}].bucket_span_seconds', 0),
                algorithm=algorithm,
                anomaly_direction=anomaly_direction,
                minimum_absolute_deviation=_as_non_negative_float(
                    entry.get('minimum_absolute_deviation'), f'rules[{index}].minimum_absolute_deviation', 0.0
                ),
                minimum_relative_deviation=_as_non_negative_float(
                    entry.get('minimum_relative_deviation'), f'rules[{index}].minimum_relative_deviation', 0.0
                ),
                minimum_activity=_as_non_negative_float(
                    entry.get('minimum_activity'), f'rules[{index}].minimum_activity', 0.0
                ),
                persistence_buckets=_as_positive_int(
                    entry.get('persistence_buckets'), f'rules[{index}].persistence_buckets', 1
                ),
                persistence_window=_as_positive_int(
                    entry.get('persistence_window'), f'rules[{index}].persistence_window', 1
                ),
                recovery_threshold=recovery_threshold,
                recovery_buckets=_as_positive_int(
                    entry.get('recovery_buckets'), f'rules[{index}].recovery_buckets', 1
                ),
                cooldown_buckets=_as_non_negative_int(
                    entry.get('cooldown_buckets'), f'rules[{index}].cooldown_buckets', 0
                ),
                data_quality_gate=_as_bool(entry.get('data_quality_gate'), f'rules[{index}].data_quality_gate', False),
                threshold=threshold,
                baseline_window=_as_positive_int(entry.get('baseline_window'), f'rules[{index}].baseline_window', 12),
                seasonality_samples=_as_positive_int(entry.get('seasonality_samples'), f'rules[{index}].seasonality_samples', 24),
                seasonal_refinement=seasonal_refinement,
                severity_preset=severity_preset,
                aggregation=aggregation,
                legend=str(entry.get('legend', entry.get('legend_format', ''))).strip(),
                labels={str(key): str(value) for key, value in labels.items()},
                description=str(entry.get('description', '')).strip(),
            )
        )

    return AppConfig(global_config=global_config, rules=rules, sinks=sinks)
