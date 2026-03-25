from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import DefaultDict, Deque

SeverityThresholds = dict[str, int]

SEVERITY_THRESHOLDS: dict[str, SeverityThresholds] = {
    'warning_first': {'low': 35, 'medium': 55, 'high': 72, 'critical': 88},
    'balanced': {'low': 40, 'medium': 60, 'high': 75, 'critical': 90},
    'page_first': {'low': 45, 'medium': 65, 'high': 82, 'critical': 95},
}

SUPPORTED_ALGORITHMS = {'zscore', 'mad', 'ewma', 'seasonal'}
SUPPORTED_SEASONAL_REFINEMENTS = {'cycle', 'hour_of_day', 'weekday_hour'}
SUPPORTED_SEVERITY_PRESETS = set(SEVERITY_THRESHOLDS.keys())
SUPPORTED_AGGREGATIONS = {'max', 'top3_avg'}
MIN_BASELINE_POINTS = 3
MIN_SEASONAL_SAMPLES = 2


@dataclass(slots=True)
class GlobalConfig:
    prometheus_url: str = 'http://prometheus:9090'
    evaluation_interval_seconds: int = 5
    request_timeout_seconds: int = 10
    listen_host: str = '0.0.0.0'
    listen_port: int = 9110
    config_reload_interval_seconds: int = 10


@dataclass(slots=True)
class RuleConfig:
    name: str
    query: str
    algorithm: str = 'mad'
    threshold: float = 2.8
    baseline_window: int = 12
    seasonality_samples: int = 24
    seasonal_refinement: str = 'cycle'
    severity_preset: str = 'balanced'
    aggregation: str = 'max'
    labels: dict[str, str] = field(default_factory=dict)
    description: str = ''

    @property
    def history_limit(self) -> int:
        seasonal_depth = self.baseline_window * max(self.seasonality_samples, 1)
        return max(256, seasonal_depth + 8, self.baseline_window * 6)


@dataclass(slots=True)
class AppConfig:
    global_config: GlobalConfig
    rules: list[RuleConfig]


@dataclass(slots=True)
class PrometheusSample:
    labels: dict[str, str]
    value: float
    timestamp: float


@dataclass(slots=True)
class SampleHistoryEntry:
    timestamp: float
    value: float


@dataclass(slots=True)
class SeriesState:
    history: Deque[SampleHistoryEntry]
    residuals: Deque[float]
    seasonal_history: DefaultDict[str, Deque[float]]
    ewma_baseline: float | None = None

    @classmethod
    def create(cls, history_limit: int, seasonal_window: int) -> 'SeriesState':
        return cls(
            history=deque(maxlen=history_limit),
            residuals=deque(maxlen=max(history_limit, seasonal_window * 4)),
            seasonal_history=defaultdict(lambda: deque(maxlen=max(seasonal_window, 2))),
        )


@dataclass(slots=True)
class SeverityState:
    raw_score: float
    normalized_score: float
    severity_label: str
    is_anomaly: bool


@dataclass(slots=True)
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
    normalized_score: float
    severity_label: str
    is_anomaly: bool
    threshold: float
    algorithm: str
    severity_preset: str
    timestamp: float


@dataclass(slots=True)
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
