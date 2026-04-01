from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .models import (
    AppConfig,
    GlobalConfig,
    RuleConfig,
    SUPPORTED_AGGREGATIONS,
    SUPPORTED_ALGORITHMS,
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


def _as_positive_float(value: object, field_name: str, default: float) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f'{field_name} must be a number.') from exc
    if parsed <= 0:
        raise ConfigError(f'{field_name} must be positive.')
    return parsed


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
            else:
                data[key] = _parse_scalar(rest)
            continue

        if section == 'global':
            if indent < 2 or ':' not in stripped:
                raise ConfigError(f'Unsupported global config line: {raw_line}')
            key, rest = stripped.split(':', 1)
            data['global'][key.strip()] = _parse_scalar(rest.strip())
            continue

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


def load_config(path: str | Path) -> AppConfig:
    raw_text = Path(path).read_text(encoding='utf-8')
    raw = _load_yaml_with_fallback(raw_text)
    global_raw = raw.get('global', {}) or {}
    rules_raw = raw.get('rules', [])

    if rules_raw is None:
        rules_raw = []
    if not isinstance(rules_raw, list):
        raise ConfigError('Config rules must be a list under rules:.')

    global_config = GlobalConfig(
        prometheus_url=str(_env_override('ANOMALY_PROMETHEUS_URL', global_raw.get('prometheus_url', GlobalConfig.prometheus_url))).rstrip('/'),
        evaluation_interval_seconds=_as_positive_int(
            _env_override('ANOMALY_EVALUATION_INTERVAL_SECONDS', global_raw.get('evaluation_interval_seconds')),
            'global.evaluation_interval_seconds',
            GlobalConfig.evaluation_interval_seconds,
        ),
        request_timeout_seconds=_as_positive_int(
            _env_override('ANOMALY_REQUEST_TIMEOUT_SECONDS', global_raw.get('request_timeout_seconds')),
            'global.request_timeout_seconds',
            GlobalConfig.request_timeout_seconds,
        ),
        listen_host=str(_env_override('ANOMALY_LISTEN_HOST', global_raw.get('listen_host', GlobalConfig.listen_host))),
        listen_port=_as_positive_int(
            _env_override('ANOMALY_LISTEN_PORT', global_raw.get('listen_port')),
            'global.listen_port',
            GlobalConfig.listen_port,
        ),
        config_reload_interval_seconds=_as_positive_int(
            _env_override('ANOMALY_CONFIG_RELOAD_INTERVAL_SECONDS', global_raw.get('config_reload_interval_seconds')),
            'global.config_reload_interval_seconds',
            GlobalConfig.config_reload_interval_seconds,
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

        rules.append(
            RuleConfig(
                name=name,
                query=query,
                algorithm=algorithm,
                threshold=_as_positive_float(entry.get('threshold'), f'rules[{index}].threshold', 2.8),
                baseline_window=_as_positive_int(entry.get('baseline_window'), f'rules[{index}].baseline_window', 12),
                seasonality_samples=_as_positive_int(entry.get('seasonality_samples'), f'rules[{index}].seasonality_samples', 24),
                seasonal_refinement=seasonal_refinement,
                severity_preset=severity_preset,
                aggregation=aggregation,
                labels={str(key): str(value) for key, value in labels.items()},
                description=str(entry.get('description', '')).strip(),
            )
        )

    return AppConfig(global_config=global_config, rules=rules)
