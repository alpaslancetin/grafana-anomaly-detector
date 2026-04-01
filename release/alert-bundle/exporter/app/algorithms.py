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


def _mad(values: list[float], center: float | None = None) -> float:
    if not values:
        return 0.0
    median_center = center if center is not None else median(values)
    return median([abs(value - median_center) for value in values]) * 1.4826


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


def _window_score(history_values: list[float], current_value: float, expected: float, spread: float, baseline_window: int) -> float:
    context_window = min(max(3, baseline_window // 3), 10)
    recent = history_values[-(context_window - 1):] + [current_value]
    if len(recent) < 3:
        return 0.0
    return abs(_mean(recent) - expected) / spread


def _data_quality_state(history_values: list[float], baseline_window: int) -> str:
    recent = history_values[-max(4, min(baseline_window, 8)) :]
    if len(history_values) < max(MIN_BASELINE_POINTS, baseline_window // 2):
        return 'thin'
    if len(recent) >= 4:
        floor = max(abs(_mean(recent)) * 0.002, 1e-6)
        if max(recent) - min(recent) <= floor:
            return 'flatline'
    return 'healthy'


def _confidence_state(
    raw_score: float,
    threshold: float,
    point_raw_score: float,
    window_raw_score: float,
    sample_count: int,
    data_quality_label: str,
) -> tuple[float, str]:
    safe_threshold = max(threshold, 1e-6)
    ratio = min(raw_score / safe_threshold, 2.5)
    score = ratio / 2.5 * 100
    if window_raw_score > point_raw_score:
        score += 8
    if sample_count >= max(5, sample_count // 2):
        score += 4
    if data_quality_label == 'thin':
        score -= 18
    elif data_quality_label == 'flatline':
        score -= 22
    confidence_score = max(5.0, min(100.0, round(score, 1)))
    if confidence_score >= 80:
        return confidence_score, 'high'
    if confidence_score >= 55:
        return confidence_score, 'medium'
    return confidence_score, 'low'


def _severity_state(
    raw_score: float,
    threshold: float,
    severity_preset: str,
    *,
    point_raw_score: float = 0.0,
    window_raw_score: float = 0.0,
    sample_count: int = 0,
    data_quality_label: str = 'healthy',
) -> SeverityState:
    preset = SEVERITY_THRESHOLDS[severity_preset]
    safe_threshold = max(threshold, 1e-6)
    ratio = raw_score / safe_threshold
    confidence_score, confidence_label = _confidence_state(
        raw_score,
        threshold,
        point_raw_score,
        window_raw_score,
        sample_count,
        data_quality_label,
    )

    if ratio < 1:
        return SeverityState(
            raw_score=raw_score,
            normalized_score=min(preset['low'] - 1, round(ratio * (preset['low'] - 1))),
            severity_label='normal',
            is_anomaly=False,
            confidence_score=confidence_score,
            confidence_label=confidence_label,
            data_quality_label=data_quality_label,
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
        confidence_score=confidence_score,
        confidence_label=confidence_label,
        data_quality_label=data_quality_label,
    )


def _seasonal_key(timestamp: float, refinement: str) -> str:
    dt = datetime.utcfromtimestamp(timestamp)
    if refinement == 'hour_of_day':
        return f'hour:{dt.hour}'
    return f'weekday:{dt.weekday()}-{dt.hour}'


def _seasonal_bucket_keys(timestamp: float) -> dict[str, str]:
    dt = datetime.utcfromtimestamp(timestamp)
    return {
        'hour_of_day': f'hour:{dt.hour}',
        'weekday_hour': f'weekday:{dt.weekday()}-{dt.hour}',
    }


def _seasonal_expected_and_spread(peers: list[float], recent_history: list[float]) -> tuple[float, float]:
    expected = median(peers)
    peer_spread = _safe_spread(_mad(peers, expected), expected)

    deltas = [current - previous for previous, current in zip(peers, peers[1:])]
    trend = median(deltas) if len(deltas) >= 2 else 0.0
    delta_spread = _safe_spread(_mad(deltas, trend), expected) if len(deltas) >= 2 else 0.0

    if recent_history:
        local_center = median(recent_history)
        local_spread = _safe_spread(_mad(recent_history, local_center), local_center)
    else:
        local_spread = 0.0

    spread = max(peer_spread, delta_spread, local_spread * 0.75)
    return expected + trend, _safe_spread(spread, expected + trend)


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
        point_raw_score=0.0,
        window_raw_score=0.0,
        score_driver='point',
        normalized_score=severity.normalized_score,
        severity_label=severity.severity_label,
        is_anomaly=False,
        confidence_score=severity.confidence_score,
        confidence_label=severity.confidence_label,
        data_quality_label=severity.data_quality_label,
        threshold=rule.threshold,
        algorithm=rule.algorithm,
        severity_preset=rule.severity_preset,
        timestamp=timestamp,
    )

def _snapshot(
    rule: RuleConfig,
    source_metric: str,
    labels: dict[str, str],
    history_values: list[float],
    value: float,
    expected: float,
    spread: float,
    timestamp: float,
    *,
    include_window_score: bool = False,
) -> SeriesSnapshot:
    data_quality_label = _data_quality_state(history_values, rule.baseline_window)
    point_raw_score = abs(value - expected) / spread
    window_raw_score = _window_score(history_values, value, expected, spread, rule.baseline_window) if include_window_score else 0.0
    raw_score = max(point_raw_score, window_raw_score)
    score_driver = 'window' if window_raw_score > point_raw_score else 'point'
    severity = _severity_state(
        raw_score,
        rule.threshold,
        rule.severity_preset,
        point_raw_score=point_raw_score,
        window_raw_score=window_raw_score,
        sample_count=len(history_values) + 1,
        data_quality_label=data_quality_label,
    )
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
        point_raw_score=point_raw_score,
        window_raw_score=window_raw_score,
        score_driver=score_driver,
        normalized_score=severity.normalized_score,
        severity_label=severity.severity_label,
        is_anomaly=severity.is_anomaly,
        confidence_score=severity.confidence_score,
        confidence_label=severity.confidence_label,
        data_quality_label=severity.data_quality_label,
        threshold=rule.threshold,
        algorithm=rule.algorithm,
        severity_preset=rule.severity_preset,
        timestamp=timestamp,
    )


def _snapshot_level_shift(
    rule: RuleConfig,
    source_metric: str,
    labels: dict[str, str],
    history_values: list[float],
    value: float,
    timestamp: float,
) -> SeriesSnapshot:
    data_quality_label = _data_quality_state(history_values, rule.baseline_window)
    shift_window = min(max(3, rule.baseline_window // 3), 12)
    baseline_history = history_values[-rule.baseline_window :]
    if len(baseline_history) <= shift_window:
        return _empty_snapshot(rule, source_metric, labels, value, timestamp)

    baseline_only = baseline_history[: -max(1, shift_window - 1)]
    if len(baseline_only) < MIN_BASELINE_POINTS:
        return _empty_snapshot(rule, source_metric, labels, value, timestamp)

    expected = median(baseline_only)
    spread = max(_safe_spread(_mad(baseline_only, expected), expected), _safe_spread(_stddev(baseline_only, expected), expected))
    point_raw_score = abs(value - expected) / spread
    recent = history_values[-(shift_window - 1) :] + [value]
    recent_center = median(recent)
    persistent_buckets = sum(1 for item in recent if abs(item - expected) > spread)
    persistence_ratio = persistent_buckets / len(recent)
    window_raw_score = abs(recent_center - expected) / spread * (1.0 + max(0.0, persistence_ratio - 0.4))
    raw_score = max(point_raw_score * 0.85, window_raw_score)
    score_driver = 'window' if window_raw_score >= point_raw_score * 0.85 else 'point'
    severity = _severity_state(
        raw_score,
        rule.threshold,
        rule.severity_preset,
        point_raw_score=point_raw_score,
        window_raw_score=window_raw_score,
        sample_count=len(recent),
        data_quality_label=data_quality_label,
    )
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
        point_raw_score=point_raw_score,
        window_raw_score=window_raw_score,
        score_driver=score_driver,
        normalized_score=severity.normalized_score,
        severity_label=severity.severity_label,
        is_anomaly=severity.is_anomaly,
        confidence_score=severity.confidence_score,
        confidence_label=severity.confidence_label,
        data_quality_label=severity.data_quality_label,
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
            result = _snapshot(rule, source_metric, labels, history_values, value, expected, spread, timestamp)

    elif rule.algorithm == 'mad':
        history_slice = history_values[-rule.baseline_window:]
        if len(history_slice) < MIN_BASELINE_POINTS:
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            expected = median(history_slice)
            mad = median([abs(entry - expected) for entry in history_slice]) * 1.4826
            spread = _safe_spread(mad, expected)
            result = _snapshot(rule, source_metric, labels, history_values, value, expected, spread, timestamp)

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
            result = _snapshot(
                rule,
                source_metric,
                labels,
                history_values,
                value,
                expected,
                spread,
                timestamp,
                include_window_score=True,
            )
            state.residuals.append(abs(value - expected))
            alpha = 2 / (max(rule.baseline_window, 2) + 1)
            state.ewma_baseline = alpha * value + (1 - alpha) * expected

    elif rule.algorithm == 'level_shift':
        history_slice = history_values[-rule.baseline_window :]
        if len(history_slice) < max(MIN_BASELINE_POINTS * 2, 6):
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            result = _snapshot_level_shift(rule, source_metric, labels, history_values, value, timestamp)

    else:
        if rule.seasonal_refinement == 'cycle':
            peers: list[float] = []
            cursor = len(history_values) - rule.seasonality_samples
            while cursor >= 0 and len(peers) < rule.baseline_window:
                peers.append(history_values[cursor])
                cursor -= rule.seasonality_samples
        else:
            bucket_keys = _seasonal_bucket_keys(timestamp)
            bucket_key = bucket_keys[rule.seasonal_refinement]
            peers = list(state.seasonal_history[bucket_key])[-rule.baseline_window:]
            if rule.seasonal_refinement == 'weekday_hour' and len(peers) < MIN_SEASONAL_SAMPLES:
                peers = list(state.seasonal_history[bucket_keys['hour_of_day']])[-rule.baseline_window:]

        if len(peers) < MIN_SEASONAL_SAMPLES:
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            recent_history = history_values[-rule.baseline_window:]
            expected, spread = _seasonal_expected_and_spread(peers, recent_history)
            result = _snapshot(rule, source_metric, labels, history_values, value, expected, spread, timestamp)

        bucket_keys = _seasonal_bucket_keys(timestamp)
        state.seasonal_history[bucket_keys['hour_of_day']].append(value)
        state.seasonal_history[bucket_keys['weekday_hour']].append(value)

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
