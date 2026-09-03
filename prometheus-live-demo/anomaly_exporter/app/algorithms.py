from __future__ import annotations

import math
from dataclasses import replace
from datetime import datetime
from statistics import median

from .models import (
    MIN_BASELINE_POINTS,
    MIN_SEASONAL_SAMPLES,
    MAX_RAW_SCORE,
    RuleConfig,
    SampleHistoryEntry,
    SeriesSnapshot,
    SeriesState,
    SeverityState,
    SEVERITY_THRESHOLDS,
    warmup_history_points,
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


def _bound_raw_score(score: float) -> float:
    return max(0.0, min(MAX_RAW_SCORE, score)) if math.isfinite(score) else 0.0


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
    if sample_count >= 8:
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


def _level_shift_reference_values(values: list[float], start: int, baseline_end: int, window: int) -> list[float]:
    anchor_end = min(start + window, baseline_end)
    if anchor_end - start >= MIN_BASELINE_POINTS:
        return values[start:anchor_end]
    return values[max(start, baseline_end - window) : baseline_end]


def _empty_snapshot(rule: RuleConfig, source_metric: str, labels: dict[str, str], value: float, timestamp: float) -> SeriesSnapshot:
    severity = _severity_state(0.0, rule.threshold, rule.severity_preset, data_quality_label='thin')
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
        decision_state='warming_up',
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
        raw_score=_bound_raw_score(severity.raw_score),
        point_raw_score=_bound_raw_score(point_raw_score),
        window_raw_score=_bound_raw_score(window_raw_score),
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
        decision_state='open' if severity.is_anomaly else 'normal',
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
    recent_window = max(1, shift_window - 1)
    lookback_window = max(rule.baseline_window * 6, rule.baseline_window + shift_window)
    start = max(0, len(history_values) - lookback_window)
    if len(history_values) - start < max(MIN_BASELINE_POINTS * 2, shift_window + MIN_BASELINE_POINTS):
        return _empty_snapshot(rule, source_metric, labels, value, timestamp)

    baseline_end = len(history_values) - recent_window
    if baseline_end - start < MIN_BASELINE_POINTS:
        return _empty_snapshot(rule, source_metric, labels, value, timestamp)

    reference_history = _level_shift_reference_values(history_values, start, baseline_end, rule.baseline_window)
    expected = _mean(reference_history)
    spread = _safe_spread(_stddev(reference_history, expected), expected)
    point_raw_score = abs(value - expected) / spread
    recent_values = history_values[-recent_window:]
    recent_sum = value
    persistent_buckets = 1 if abs(value - expected) > spread else 0
    for item in recent_values:
        recent_sum += item
        if abs(item - expected) > spread:
            persistent_buckets += 1
    recent_count = len(recent_values) + 1
    recent_center = recent_sum / recent_count
    persistence_ratio = persistent_buckets / recent_count
    window_raw_score = abs(recent_center - expected) / spread * (1.0 + max(0.0, persistence_ratio - 0.4))
    raw_score = max(point_raw_score * 0.85, window_raw_score)
    score_driver = 'window' if window_raw_score >= point_raw_score * 0.85 else 'point'
    severity = _severity_state(
        raw_score,
        rule.threshold,
        rule.severity_preset,
        point_raw_score=point_raw_score,
        window_raw_score=window_raw_score,
        sample_count=len(reference_history) + 1,
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
        raw_score=_bound_raw_score(severity.raw_score),
        point_raw_score=_bound_raw_score(point_raw_score),
        window_raw_score=_bound_raw_score(window_raw_score),
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
        decision_state='open' if severity.is_anomaly else 'normal',
    )


def _decision_candidate(rule: RuleConfig, snapshot: SeriesSnapshot, threshold: float | None = None) -> bool:
    if snapshot.expected is None:
        return False
    deviation = snapshot.value - snapshot.expected
    direction_matches = (
        rule.anomaly_direction == 'high_or_low'
        or (rule.anomaly_direction == 'high_mean' and deviation > 0)
        or (rule.anomaly_direction == 'low_mean' and deviation < 0)
    )
    absolute_deviation = abs(deviation)
    relative_deviation = absolute_deviation / max(abs(snapshot.expected), 1e-9)
    quality_matches = not rule.data_quality_gate or snapshot.data_quality_label == 'healthy'
    return bool(
        snapshot.raw_score >= (rule.threshold if threshold is None else threshold)
        and direction_matches
        and absolute_deviation >= max(0.0, rule.minimum_absolute_deviation)
        and relative_deviation >= max(0.0, rule.minimum_relative_deviation)
        and max(abs(snapshot.value), abs(snapshot.expected)) >= max(0.0, rule.minimum_activity)
        and quality_matches
    )


def _apply_decision_policy(rule: RuleConfig, state: SeriesState, snapshot: SeriesSnapshot) -> SeriesSnapshot:
    if (
        rule.anomaly_direction == 'high_or_low'
        and rule.minimum_absolute_deviation <= 0
        and rule.minimum_relative_deviation <= 0
        and rule.minimum_activity <= 0
        and rule.persistence_buckets <= 1
        and rule.recovery_threshold <= 0
        and rule.recovery_buckets <= 1
        and rule.cooldown_buckets <= 0
        and not rule.data_quality_gate
    ):
        return snapshot
    open_candidate = _decision_candidate(rule, snapshot)
    close_threshold = rule.recovery_threshold if rule.recovery_threshold > 0 else rule.threshold
    hold_candidate = _decision_candidate(rule, snapshot, close_threshold)
    state.decision_history.append(open_candidate)
    window = max(1, rule.persistence_window)
    required = max(1, min(window, rule.persistence_buckets))
    recent = list(state.decision_history)[-window:]
    if state.incident_open:
        if hold_candidate:
            state.recovery_count = 0
            return replace(snapshot, is_anomaly=True, decision_state='open')
        state.recovery_count += 1
        if state.recovery_count < max(1, rule.recovery_buckets):
            return replace(snapshot, is_anomaly=True, decision_state='recovering')
        state.incident_open = False
        state.recovery_count = 0
        state.cooldown_remaining = max(0, rule.cooldown_buckets)

    if state.cooldown_remaining > 0:
        state.cooldown_remaining -= 1
        return replace(snapshot, normalized_score=0.0, severity_label='normal', is_anomaly=False, decision_state='cooldown')

    if open_candidate and sum(recent) >= required:
        state.incident_open = True
        return replace(snapshot, is_anomaly=True, decision_state='open')

    decision_state = 'candidate' if open_candidate else ('warming_up' if snapshot.expected is None else 'normal')
    return replace(snapshot, normalized_score=0.0, severity_label='normal', is_anomaly=False, decision_state=decision_state)


def evaluate_series(state: SeriesState, rule: RuleConfig, source_metric: str, labels: dict[str, str], value: float, timestamp: float) -> SeriesSnapshot:
    history_values = [entry.value for entry in state.history]
    minimum_history = warmup_history_points(rule.baseline_window)

    if rule.algorithm == 'zscore':
        history_slice = history_values[-rule.baseline_window:]
        if len(history_slice) < minimum_history:
            result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
        else:
            expected = _mean(history_slice)
            spread = _safe_spread(_stddev(history_slice, expected), expected)
            result = _snapshot(rule, source_metric, labels, history_values, value, expected, spread, timestamp)

    elif rule.algorithm == 'mad':
        history_slice = history_values[-rule.baseline_window:]
        if len(history_slice) < minimum_history:
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
            state.residuals.append(abs(value - expected))
            alpha = 2 / (max(rule.baseline_window, 2) + 1)
            state.ewma_baseline = alpha * value + (1 - alpha) * expected
            if len(history_values) < minimum_history:
                result = _empty_snapshot(rule, source_metric, labels, value, timestamp)
            else:
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

    elif rule.algorithm == 'level_shift':
        shift_window = min(max(3, rule.baseline_window // 3), 12)
        lookback_window = max(rule.baseline_window * 6, rule.baseline_window + shift_window)
        history_slice = history_values[-lookback_window:]
        if len(history_slice) < max(minimum_history, MIN_BASELINE_POINTS * 2, shift_window + MIN_BASELINE_POINTS):
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

    result = _apply_decision_policy(rule, state, result)
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
