from __future__ import annotations

from ..models import PrometheusRangeSeries, RuleConfig
from ..prometheus_api import PrometheusClient, PrometheusQueryError
from .base import BaseSourceReader, SourceQueryError


class PrometheusSourceReader(BaseSourceReader):
    def __init__(self, rule: RuleConfig, timeout_seconds: int, default_url: str) -> None:
        super().__init__(rule, timeout_seconds)
        self.client = PrometheusClient(rule.datasource_url or default_url, timeout_seconds)

    def query_range(self, start_time: float, end_time: float, step_seconds: int) -> list[PrometheusRangeSeries]:
        try:
            return self.client.range_query(self.rule.query, start_time, end_time, step_seconds)
        except PrometheusQueryError as exc:
            raise SourceQueryError(str(exc)) from exc
