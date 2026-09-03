from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
import sys
from typing import Any, DefaultDict, Deque, Dict
SeverityThresholds = Dict[str, int]

SEVERITY_THRESHOLDS: dict[str, SeverityThresholds] = {
    'warning_first': {'low': 35, 'medium': 55, 'high': 72, 'critical': 88},
    'balanced': {'low': 40, 'medium': 60, 'high': 75, 'critical': 90},
    'page_first': {'low': 45, 'medium': 65, 'high': 82, 'critical': 95},
}

SUPPORTED_ALGORITHMS = {'zscore', 'mad', 'ewma', 'seasonal', 'level_shift'}
SUPPORTED_ANOMALY_DIRECTIONS = {'high_mean', 'low_mean', 'high_or_low'}
SUPPORTED_SEASONAL_REFINEMENTS = {'cycle', 'hour_of_day', 'weekday_hour'}
SUPPORTED_SEVERITY_PRESETS = set(SEVERITY_THRESHOLDS.keys())
SUPPORTED_AGGREGATIONS = {'max', 'top3_avg'}
MIN_BASELINE_POINTS = 3
MIN_SEASONAL_SAMPLES = 3
MAX_RAW_SCORE = 100.0
DATACLASS_KWARGS = {'slots': True} if sys.version_info >= (3, 10) else {}


def warmup_history_points(baseline_window: int) -> int:
    return max(MIN_BASELINE_POINTS, int(baseline_window))


@dataclass(**DATACLASS_KWARGS)
class GlobalConfig:
    prometheus_url: str = 'http://prometheus:9090'
    evaluation_interval_seconds: int = 5
    request_timeout_seconds: int = 10
    listen_host: str = '0.0.0.0'
    listen_port: int = 9110
    config_reload_interval_seconds: int = 10
    base_path: str = ''
    cors_allowed_origins: list[str] = field(default_factory=list)
    api_token_env: str = ''
    max_request_body_bytes: int = 1_048_576
    allowed_datasource_hosts: list[str] = field(default_factory=list)
    max_dynamic_rules: int = 5000
    max_rules_per_panel: int = 50
    max_query_length: int = 16384
    max_feed_series: int = 1000
    runtime_scope_ttl_seconds: int = 3600
    pushed_feed_ttl_seconds: int = 300
    api_rate_limit_per_minute: int = 120


@dataclass(**DATACLASS_KWARGS)
class RuleConfig:
    name: str
    query: str
    source_type: str = 'prometheus'
    datasource_url: str = ''
    target_sinks: list[str] | None = None
    range_seconds: int = 0
    step_seconds: int = 0
    bucket_span_seconds: int = 0
    algorithm: str = 'mad'
    anomaly_direction: str = 'high_or_low'
    minimum_absolute_deviation: float = 0.0
    minimum_relative_deviation: float = 0.0
    minimum_activity: float = 0.0
    persistence_buckets: int = 1
    persistence_window: int = 1
    recovery_threshold: float = 0.0
    recovery_buckets: int = 1
    cooldown_buckets: int = 0
    data_quality_gate: bool = False
    threshold: float = 4.0
    baseline_window: int = 12
    seasonality_samples: int = 24
    seasonal_refinement: str = 'cycle'
    severity_preset: str = 'balanced'
    aggregation: str = 'max'
    legend: str = ''
    labels: dict[str, str] = field(default_factory=dict)
    description: str = ''

    @property
    def history_limit(self) -> int:
        seasonal_depth = self.baseline_window * max(self.seasonality_samples, 1)
        return max(256, seasonal_depth + 8, self.baseline_window * 6)


@dataclass(**DATACLASS_KWARGS)
class SinkDefinition:
    name: str
    enabled: bool = False
    settings: dict[str, Any] = field(default_factory=dict)
    error: str = ''


@dataclass(**DATACLASS_KWARGS)
class AppConfig:
    global_config: GlobalConfig
    rules: list[RuleConfig]
    sinks: dict[str, SinkDefinition] = field(default_factory=dict)


@dataclass(**DATACLASS_KWARGS)
class PrometheusSample:
    labels: dict[str, str]
    value: float
    timestamp: float


@dataclass(**DATACLASS_KWARGS)
class PrometheusRangeSeries:
    labels: dict[str, str]
    samples: list[PrometheusSample]


@dataclass(**DATACLASS_KWARGS)
class SampleHistoryEntry:
    timestamp: float
    value: float


@dataclass(**DATACLASS_KWARGS)
class SeriesState:
    history: Deque[SampleHistoryEntry]
    residuals: Deque[float]
    seasonal_history: DefaultDict[str, Deque[float]]
    decision_history: Deque[bool]
    ewma_baseline: float | None = None
    incident_open: bool = False
    recovery_count: int = 0
    cooldown_remaining: int = 0

    @classmethod
    def create(cls, history_limit: int, seasonal_window: int) -> 'SeriesState':
        return cls(
            history=deque(maxlen=history_limit),
            residuals=deque(maxlen=max(history_limit, seasonal_window * 4)),
            seasonal_history=defaultdict(lambda: deque(maxlen=max(seasonal_window, 2))),
            decision_history=deque(maxlen=max(history_limit, 4)),
        )


@dataclass(**DATACLASS_KWARGS)
class SeverityState:
    raw_score: float
    normalized_score: float
    severity_label: str
    is_anomaly: bool
    confidence_score: float
    confidence_label: str
    data_quality_label: str


@dataclass(**DATACLASS_KWARGS)
class SeriesSnapshot:
    rule_name: str
    source_metric: str
    labels: dict[str, str]
    value: float
    expected: float | None
    lower: float | None
    upper: float | None
    deviation: float | None
    raw_score: float
    point_raw_score: float
    window_raw_score: float
    score_driver: str
    normalized_score: float
    severity_label: str
    is_anomaly: bool
    confidence_score: float
    confidence_label: str
    data_quality_label: str
    threshold: float
    algorithm: str
    severity_preset: str
    timestamp: float
    decision_state: str = 'normal'


@dataclass(**DATACLASS_KWARGS)
class RuleSnapshot:
    name: str
    algorithm: str
    severity_preset: str
    query: str
    series_count: int
    breach_count: int
    max_raw_score: float
    max_score: float
    max_severity_label: str
    active_series: int
    timestamp: float
    active_incidents: int = 0
    data_state: str = 'ok'
    last_data_timestamp: float = 0.0
