from __future__ import annotations

import json
import os
from pathlib import Path

try:
    import yaml  # type: ignore
except ModuleNotFoundError:
    yaml = None

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
    text = value.strip()
    if text == '':
        return ''
    if text in ('[]', '[ ]'):
        return []
    if text in ('{}', '{ }'):
        return {}
    lower = text.lower()
    if lower in ('null', '~'):
        return None
    if lower == 'true':
        return True
    if lower == 'false':
        return False
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        return text[1:-1]
    try:
        if any(ch in text for ch in '.eE'):
            return float(text)
        return int(text)
    except ValueError:
        return text


def _parse_minimal_yaml(raw_text: str) -> dict:
    result: dict[str, object] = {}
    section: str | None = None
    current_rule: dict[str, object] | None = None
    current_nested_map: dict[str, object] | None = None

    for line_number, raw_line in enumerate(raw_text.splitlines(), start=1):
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        indent = len(line) - len(line.lstrip(' '))

        if indent == 0:
            current_rule = None
            current_nested_map = None
            if ':' not in stripped:
                raise ConfigError(f'Unsupported YAML syntax on line {line_number}.')
            key, value = stripped.split(':', 1)
            key = key.strip()
            value = value.strip()
            if value == '':
                if key == 'global':
                    result[key] = {}
                elif key == 'rules':
                    result[key] = []
                else:
                    result[key] = {}
                section = key
            else:
                result[key] = _parse_scalar(value)
                section = None
            continue

        if section == 'global':
            if ':' not in stripped:
                raise ConfigError(f'Unsupported global config syntax on line {line_number}.')
            key, value = stripped.split(':', 1)
            global_raw = result.setdefault('global', {})
            if not isinstance(global_raw, dict):
                raise ConfigError('global must be a mapping.')
            global_raw[key.strip()] = _parse_scalar(value.strip())
            continue

        if section == 'rules':
            rules_raw = result.setdefault('rules', [])
            if not isinstance(rules_raw, list):
                raise ConfigError('rules must be a list.')

            if stripped.startswith('- '):
                current_rule = {}
                rules_raw.append(current_rule)
                current_nested_map = None
                remainder = stripped[2:].strip()
                if remainder:
                    if ':' not in remainder:
                        raise ConfigError(f'Unsupported rule syntax on line {line_number}.')
                    key, value = remainder.split(':', 1)
                    key = key.strip()
                    value = value.strip()
                    if value == '':
                        current_rule[key] = {}
                        current_nested_map = current_rule[key]  # type: ignore[assignment]
                    else:
                        current_rule[key] = _parse_scalar(value)
                continue

            if current_rule is None:
                raise ConfigError(f'rules[{line_number}] is malformed.')
            if ':' not in stripped:
                raise ConfigError(f'Unsupported rule entry syntax on line {line_number}.')

            key, value = stripped.split(':', 1)
            key = key.strip()
            value = value.strip()

            if indent >= 4 and current_nested_map is not None:
                current_nested_map[key] = _parse_scalar(value)
            else:
                if value == '':
                    current_rule[key] = {}
                    current_nested_map = current_rule[key]  # type: ignore[assignment]
                else:
                    current_rule[key] = _parse_scalar(value)
                    current_nested_map = None
            continue

        raise ConfigError(f'Unsupported YAML structure on line {line_number}.')

    return result


def _load_raw_config(path: str | Path) -> dict:
    config_path = Path(path)
    raw_text = config_path.read_text(encoding='utf-8')

    if config_path.suffix.lower() == '.json':
        loaded = json.loads(raw_text or '{}')
        return loaded if isinstance(loaded, dict) else {}

    if yaml is not None:
        loaded = yaml.safe_load(raw_text) or {}
        return loaded if isinstance(loaded, dict) else {}

    return _parse_minimal_yaml(raw_text)


def load_config(path: str | Path) -> AppConfig:
    raw = _load_raw_config(path)
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