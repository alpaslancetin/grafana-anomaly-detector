from __future__ import annotations

import os
from pathlib import Path

import yaml

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


def load_config(path: str | Path) -> AppConfig:
    raw_text = Path(path).read_text(encoding='utf-8')
    raw = yaml.safe_load(raw_text) or {}
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
