from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
import sys
from typing import DefaultDict, Deque, Dict
SeverityThresholds = Dict[str, int]

SEVERITY_THRESHOLDS: dict[str, SeverityThresholds] = {
    'warning_first': {'low': 35, 'medium': 55, 'high': 72, 'critical': 88},
    'balanced': {'low': 40, 'medium': 60, 'high': 75, 'critical': 90},
    'page_first': {'low': 45, 'medium': 65, 'high': 82, 'critical': 95},
}

SUPPORTED_ALGORITHMS = {'zscore', 'mad', 'ewma', 'seasonal', 'level_shift'}
SUPPORTED_SEASONAL_REFINEMENTS = {'cycle', 'hour_of_day', 'weekday_hour'}
SUPPORTED_SEVERITY_PRESETS = set(SEVERITY_THRESHOLDS.keys())
SUPPORTED_AGGREGATIONS = {'max', 'top3_avg'}
MIN_BASELINE_POINTS = 3
MIN_SEASONAL_SAMPLES = 3
DATACLASS_KWARGS = {'slots': True} if sys.version_info >= (3, 10) else {}


@dataclass(**DATACLASS_KWARGS)
class GlobalConfig:
    prometheus_url: str = 'http://prometheus:9090'
    evaluation_interval_seconds: int = 5
    request_timeout_seconds: int = 10
    listen_host: str = '0.0.0.0'
    listen_port: int = 9110
    config_reload_interval_seconds: int = 10


@dataclass(**DATACLASS_KWARGS)
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


@dataclass(**DATACLASS_KWARGS)
class AppConfig:
    global_config: GlobalConfig
    rules: list[RuleConfig]


@dataclass(**DATACLASS_KWARGS)
class PrometheusSample:
    labels: dict[str, str]
    value: float
    timestamp: float


@dataclass(**DATACLASS_KWARGS)
class SampleHistoryEntry:
    timestamp: float
    value: float


@dataclass(**DATACLASS_KWARGS)
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
