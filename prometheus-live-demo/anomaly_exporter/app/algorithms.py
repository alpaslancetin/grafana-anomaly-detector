from __future__ import annotations

import math
from datetime import datetime
from statistics import median

from .models import (
    MIN_BASELINE_POINTS,
    MIN_SEASONAL_SAMPLES,
    RuleConfig,
    SampleHistoryEntry,
    SeriesSnapshot,
    SeriesState,
    SeverityState,
    SEVERITY_THRESHOLDS,
)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _stddev(values: list[float], center: float | None = None) -> float:
    if len(values) <= 1:
        return 0.0
    avg = center if center is not None else _mean(values)
    variance = sum((value - avg) ** 2 for value in values) / len(values)
    return math.sqrt(variance)


def _safe_spread(spread: float, reference: float) -> float:
    if math.isfinite(spread) and spread > 1e-9:
        return spread
    return max(abs(reference) * 0.02, 1e-6)


def _severity_state(raw_score: float, threshold: float, severity_preset: str) -> SeverityState:
    preset = SEVERITY_THRESHOLDS[severity_preset]
    safe_threshold = max(threshold, 1e-6)
    ratio = raw_score / safe_threshold

    if ratio < 1:
        return SeverityState(
            raw_score=raw_score,
            normalized_score=min(preset['low'] - 1, round(ratio * (preset['low'] - 1))),
            severity_label='normal',
            is_anomaly=False,
        )

    normalized_score = min(100, round(preset['low'] + (ratio - 1) * 30))
    if normalized_score >= preset['critical']:
        label = 'critical'
    elif normalized_score >= preset['high']:
        label = 'high'
    elif normalized_score >= preset['medium']:
        label = 'medium'
    else:
        label = 'low'

    return SeverityState(
        raw_score=raw_score,
        normalized_score=normalized_score,
        severity_label=label,
        is_anomaly=raw_score >= threshold,
    )


def _seasonal_key(timestamp: float, refinement: str) -> str:
    dt = datetime.utcfromtimestamp(timestamp)
    if refinement == 'hour_of_day':
        return str(dt.hour)
    return f'{dt.weekday()}-{dt.hour}'


def _empty_snapshot(rule: RuleConfig, source_metric: str, labels: dict[str, str], value: float, timestamp: float) -> SeriesSnapshot:
    severity = _severity_state(0.0, rule.threshold, rule.severity_preset)
    return SeriesSnapshot(
        rule_name=rule.name,
        source_metric=source_metric,
        labels=labels,
        value=value,
        expected=None,
        lower=None,
        upper=None,
        deviation=None,
        raw_score=severity.raw_score,
        normalized_score=severity.normalized_score,
        severity_label=severity.severity_label,
        is_anomaly=False,
        threshold=rule.threshold,
        algorithm=rule.algorithm,
        severity_preset=rule.severity_preset,
        timestamp=timestamp,
    )


def _snapshot(rule: RuleConfig, source_metric: str, labels: dict[str, str], value: float, expected: float, spread: float, timestamp: float) -> SeriesSnapshot:
    raw_score = abs(value - expected) / spread
    severity = _severity_state(raw_score, rule.threshold, rule.severity_preset)
    return SeriesSnapshot(
        rule_name=rule.name,
        source_metric=source_metric,
        labels=labels,
        value=value,
        expected=expected,
        lower=expected - rule.threshold * spread,
        upper=expected + rule.threshold * spread,
        deviation=value - expected,
        raw_score=severity.raw_score,
        normalized_score=severity.normalized_score,
        severity_label=severity.severity_label,
        is_anomaly=severity.is_anomaly,
        threshold=rule.threshold,
        algorithm=rule.algorithm,
        severity_preset=rule.severity_preset,
        timestamp=timestamp,
    )


def evaluate_series(state: SeriesState, rule: RuleConfig, source_metric: str, labels: dict[str, str], value: float, timestamp: float) -> SeriesSnapshot:
    history_values = [entry.value for entry in state.history]

    if rule.algorithm == 'zscore':
        history_slice = history_values[-rule.baseline_window:]
        if len(history_slice) < MIN_BASELINE_POINTS:
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            expected = _mean(history_slice)
            spread = _safe_spread(_stddev(history_slice, expected), expected)
            result = _snapshot(rule, source_metric, labels, value, expected, spread, timestamp)

    elif rule.algorithm == 'mad':
        history_slice = history_values[-rule.baseline_window:]
        if len(history_slice) < MIN_BASELINE_POINTS:
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            expected = median(history_slice)
            mad = median([abs(entry - expected) for entry in history_slice]) * 1.4826
            spread = _safe_spread(mad, expected)
            result = _snapshot(rule, source_metric, labels, value, expected, spread, timestamp)

    elif rule.algorithm == 'ewma':
        if state.ewma_baseline is None:
            state.ewma_baseline = value
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            expected = state.ewma_baseline
            residual_slice = list(state.residuals)[-rule.baseline_window:]
            if residual_slice:
                spread = _safe_spread(median(residual_slice), expected)
            else:
                spread = _safe_spread(_stddev(history_values[-rule.baseline_window:]), expected)
            result = _snapshot(rule, source_metric, labels, value, expected, spread, timestamp)
            state.residuals.append(abs(value - expected))
            alpha = 2 / (max(rule.baseline_window, 2) + 1)
            state.ewma_baseline = alpha * value + (1 - alpha) * expected

    else:
        if rule.seasonal_refinement == 'cycle':
            peers: list[float] = []
            cursor = len(history_values) - rule.seasonality_samples
            while cursor >= 0 and len(peers) < rule.baseline_window:
                peers.append(history_values[cursor])
                cursor -= rule.seasonality_samples
        else:
            bucket_key = _seasonal_key(timestamp, rule.seasonal_refinement)
            peers = list(state.seasonal_history[bucket_key])[-rule.baseline_window:]

        if len(peers) < MIN_SEASONAL_SAMPLES:
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            expected = _mean(peers)
            spread = _safe_spread(_stddev(peers, expected), expected)
            result = _snapshot(rule, source_metric, labels, value, expected, spread, timestamp)

        if rule.seasonal_refinement != 'cycle':
            bucket_key = _seasonal_key(timestamp, rule.seasonal_refinement)
            state.seasonal_history[bucket_key].append(value)

    state.history.append(SampleHistoryEntry(timestamp=timestamp, value=value))
    if rule.algorithm != 'ewma' and state.ewma_baseline is None:
        state.ewma_baseline = value
    return result


def aggregate_rule_scores(rule: RuleConfig, scores: list[SeriesSnapshot]) -> float:
    if not scores:
        return 0.0
    ordered = sorted((snapshot.normalized_score for snapshot in scores), reverse=True)
    if rule.aggregation == 'top3_avg':
        top = ordered[: min(3, len(ordered))]
        return sum(top) / len(top)
    return ordered[0]
