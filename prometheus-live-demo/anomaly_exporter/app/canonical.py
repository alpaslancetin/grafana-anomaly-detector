from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import datetime
from statistics import median

from .models import (
    MIN_BASELINE_POINTS,
    MIN_SEASONAL_SAMPLES,
    MAX_RAW_SCORE,
    RuleConfig,
    SeriesSnapshot,
    SEVERITY_THRESHOLDS,
    warmup_history_points,
)


@dataclass
class RawPoint:
    time: float
    value: float
    bucket_start: float
    bucket_end: float
    sample_count: int
    min_value: float
    max_value: float


def build_raw_point(timestamp: float, value: float) -> RawPoint:
    return RawPoint(
        time=timestamp,
        value=value,
        bucket_start=timestamp,
        bucket_end=timestamp,
        sample_count=1,
        min_value=value,
        max_value=value,
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


def _finite_or(value: float, fallback: float) -> float:
    return value if math.isfinite(value) else fallback


def _valid_raw_points(points: list[RawPoint]) -> list[RawPoint]:
    valid: list[RawPoint] = []
    for point in points:
        if not math.isfinite(point.time) or not math.isfinite(point.value):
            continue
        valid.append(
            RawPoint(
                time=point.time,
                value=point.value,
                bucket_start=_finite_or(point.bucket_start, point.time),
                bucket_end=_finite_or(point.bucket_end, point.time),
                sample_count=max(1, int(point.sample_count or 1)),
                min_value=_finite_or(point.min_value, point.value),
                max_value=_finite_or(point.max_value, point.value),
            )
        )
    return valid


def dedupe_consecutive_points(points: list[RawPoint]) -> list[RawPoint]:
    merged: list[RawPoint] = []
    for point in points:
        previous = merged[-1] if merged else None
        if previous is not None and previous.time == point.time:
            count = previous.sample_count + point.sample_count
            previous.value = (previous.value * previous.sample_count + point.value * point.sample_count) / count
            previous.sample_count = count
            previous.min_value = min(previous.min_value, point.min_value)
            previous.max_value = max(previous.max_value, point.max_value)
            previous.bucket_start = min(previous.bucket_start, point.bucket_start)
            previous.bucket_end = max(previous.bucket_end, point.bucket_end)
            continue
        merged.append(RawPoint(**point.__dict__))
    return merged


def aggregate_raw_points(points: list[RawPoint], bucket_span_seconds: float | None) -> list[RawPoint]:
    if not bucket_span_seconds or not points:
        return dedupe_consecutive_points([RawPoint(**point.__dict__) for point in points])

    buckets: dict[float, dict[str, float]] = {}
    for point in points:
        bucket_start = math.floor(point.time / bucket_span_seconds) * bucket_span_seconds
        entry = buckets.setdefault(
            bucket_start,
            {
                'sum': 0.0,
                'count': 0.0,
                'min': math.inf,
                'max': -math.inf,
                'end': bucket_start + bucket_span_seconds,
            },
        )
        entry['sum'] += point.value * point.sample_count
        entry['count'] += point.sample_count
        entry['min'] = min(entry['min'], point.min_value)
        entry['max'] = max(entry['max'], point.max_value)

    return [
        RawPoint(
            time=bucket_start + math.floor(bucket_span_seconds / 2 + 0.5),
            value=entry['sum'] / entry['count'],
            bucket_start=bucket_start,
            bucket_end=entry['end'],
            sample_count=int(entry['count']),
            min_value=entry['min'],
            max_value=entry['max'],
        )
        for bucket_start, entry in sorted(buckets.items())
    ]


def _seasonal_bucket_keys(timestamp: float) -> dict[str, str]:
    dt = datetime.utcfromtimestamp(timestamp)
    # JavaScript Date.getDay(): Sunday=0. Python weekday(): Monday=0.
    js_weekday = (dt.weekday() + 1) % 7
    return {
        'hour_of_day': f'hour:{dt.hour}',
        'weekday_hour': f'weekday:{js_weekday}-{dt.hour}',
    }


def _seasonal_expected_and_spread(peers: list[float], recent_history: list[float]) -> tuple[float, float]:
    expected = median(peers)
    peer_spread = _safe_spread(_mad(peers, expected), expected)
    deltas = [current - previous for previous, current in zip(peers, peers[1:])]
    trend = median(deltas) if len(deltas) >= 2 else 0.0
    delta_spread = _safe_spread(_mad(deltas, trend), expected) if len(deltas) >= 2 else 0.0
    local_spread = _safe_spread(_mad(recent_history), median(recent_history)) if recent_history else 0.0
    spread = max(peer_spread, delta_spread, local_spread * 0.75)
    return expected + trend, _safe_spread(spread, expected + trend)


def _level_shift_reference_values(values: list[float], start: int, baseline_end: int, window: int) -> list[float]:
    anchor_end = min(start + window, baseline_end)
    if anchor_end - start >= MIN_BASELINE_POINTS:
        return values[start:anchor_end]
    return values[max(start, baseline_end - window) : baseline_end]


def _severity_state(raw_score: float, threshold: float, severity_preset: str) -> tuple[float, str, bool]:
    preset = SEVERITY_THRESHOLDS[severity_preset]
    safe_threshold = max(threshold, 0.0001)
    ratio = raw_score / safe_threshold

    if ratio < 1:
        return min(preset['low'] - 1, round(ratio * (preset['low'] - 1))), 'normal', False

    normalized_score = min(100, round(preset['low'] + (ratio - 1) * 30))
    if normalized_score >= preset['critical']:
        label = 'critical'
    elif normalized_score >= preset['high']:
        label = 'high'
    elif normalized_score >= preset['medium']:
        label = 'medium'
    else:
        label = 'low'
    return normalized_score, label, raw_score >= threshold


def _window_score(history: list[float], current_value: float, expected: float, spread: float, window: int) -> float:
    context_window = min(max(3, window // 3), 10)
    recent = history[-(context_window - 1) :] + [current_value]
    if len(recent) < 3:
        return 0.0
    return abs(_mean(recent) - expected) / spread


def _data_quality_state(points: list[RawPoint], index: int, baseline_window: int) -> str:
    history = points[max(0, index - baseline_window) : index + 1]
    values = [entry.value for entry in history]
    recent = history[-max(4, min(baseline_window, 8)) :]

    if len(values) < max(MIN_BASELINE_POINTS, baseline_window // 2):
        return 'thin'

    if len(recent) >= 3:
        diffs = [recent[offset + 1].time - recent[offset].time for offset in range(len(recent) - 1)]
        diffs = [diff for diff in diffs if diff > 0]
        expected_step = median(diffs) if diffs else None
        smallest_step = min(diffs) if diffs else None
        largest_step = max(diffs) if diffs else None
        if (
            (expected_step and any(diff > expected_step * 2.4 for diff in diffs))
            or (smallest_step and largest_step and largest_step > smallest_step * 1.8)
        ):
            return 'gappy'

    if len(recent) >= 4:
        recent_values = [entry.value for entry in recent]
        floor = max(abs(_mean(recent_values)) * 0.002, 1e-6)
        if max(recent_values) - min(recent_values) <= floor:
            return 'flatline'

    return 'healthy'


def _data_quality_state_from_arrays(values: list[float], times: list[float], index: int, baseline_window: int) -> str:
    start = max(0, index - baseline_window)
    history_len = index + 1 - start
    recent_start = max(start, index + 1 - max(4, min(baseline_window, 8)))

    if history_len < max(MIN_BASELINE_POINTS, baseline_window // 2):
        return 'thin'

    if index + 1 - recent_start >= 3:
        diffs = [times[offset + 1] - times[offset] for offset in range(recent_start, index) if times[offset + 1] - times[offset] > 0]
        expected_step = median(diffs) if diffs else None
        smallest_step = min(diffs) if diffs else None
        largest_step = max(diffs) if diffs else None
        if (
            (expected_step and any(diff > expected_step * 2.4 for diff in diffs))
            or (smallest_step and largest_step and largest_step > smallest_step * 1.8)
        ):
            return 'gappy'

    if index + 1 - recent_start >= 4:
        recent_values = values[recent_start : index + 1]
        floor = max(abs(_mean(recent_values)) * 0.002, 1e-6)
        if max(recent_values) - min(recent_values) <= floor:
            return 'flatline'

    return 'healthy'


def _data_quality_states(points: list[RawPoint], baseline_window: int) -> list[str]:
    values = [point.value for point in points]
    times = [point.time for point in points]
    return [_data_quality_state_from_arrays(values, times, index, baseline_window) for index in range(len(points))]


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
    elif data_quality_label == 'gappy':
        score -= 12

    confidence_score = max(5.0, min(100.0, round(score, 1)))
    if confidence_score >= 80:
        return confidence_score, 'high'
    if confidence_score >= 55:
        return confidence_score, 'medium'
    return confidence_score, 'low'


def _empty_snapshot(rule: RuleConfig, source_metric: str, labels: dict[str, str], point: RawPoint) -> SeriesSnapshot:
    normalized_score, severity_label, is_anomaly = _severity_state(0.0, rule.threshold, rule.severity_preset)
    return SeriesSnapshot(
        rule_name=rule.name,
        source_metric=source_metric,
        labels=labels,
        value=point.value,
        expected=None,
        lower=None,
        upper=None,
        deviation=None,
        raw_score=0.0,
        point_raw_score=0.0,
        window_raw_score=0.0,
        score_driver='point',
        normalized_score=normalized_score,
        severity_label=severity_label,
        is_anomaly=is_anomaly,
        confidence_score=5,
        confidence_label='low',
        data_quality_label='thin',
        threshold=rule.threshold,
        algorithm=rule.algorithm,
        severity_preset=rule.severity_preset,
        timestamp=point.time,
        decision_state='warming_up',
    )


def _snapshot(
    rule: RuleConfig,
    source_metric: str,
    labels: dict[str, str],
    points: list[RawPoint],
    index: int,
    history: list[float],
    expected: float,
    spread: float,
    *,
    data_quality_label: str | None = None,
    include_window_score: bool = False,
    level_shift_score_driver: bool = False,
    level_shift_point_multiplier: float = 1.0,
) -> SeriesSnapshot:
    point = points[index]
    if data_quality_label is None:
        data_quality_label = _data_quality_state(points, index, rule.baseline_window)
    point_raw_score = abs(point.value - expected) / spread
    window_raw_score = _window_score(history, point.value, expected, spread, rule.baseline_window) if include_window_score else 0.0
    raw_score = max(point_raw_score * level_shift_point_multiplier, window_raw_score)
    normalized_score, severity_label, is_anomaly = _severity_state(raw_score, rule.threshold, rule.severity_preset)
    confidence_score, confidence_label = _confidence_state(
        raw_score,
        rule.threshold,
        point_raw_score,
        window_raw_score,
        len(history) + 1,
        data_quality_label,
    )
    if level_shift_score_driver:
        score_driver = 'window' if window_raw_score >= point_raw_score * level_shift_point_multiplier else 'point'
    else:
        score_driver = 'window' if window_raw_score > point_raw_score else 'point'

    return SeriesSnapshot(
        rule_name=rule.name,
        source_metric=source_metric,
        labels=labels,
        value=point.value,
        expected=expected,
        lower=expected - rule.threshold * spread,
        upper=expected + rule.threshold * spread,
        deviation=point.value - expected,
        raw_score=_bound_raw_score(raw_score),
        point_raw_score=_bound_raw_score(point_raw_score),
        window_raw_score=_bound_raw_score(window_raw_score),
        score_driver=score_driver,
        normalized_score=normalized_score,
        severity_label=severity_label,
        is_anomaly=is_anomaly,
        confidence_score=confidence_score,
        confidence_label=confidence_label,
        data_quality_label=data_quality_label,
        threshold=rule.threshold,
        algorithm=rule.algorithm,
        severity_preset=rule.severity_preset,
        timestamp=point.time,
        decision_state='open' if is_anomaly else 'normal',
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


def _apply_decision_policy(rule: RuleConfig, snapshots: list[SeriesSnapshot]) -> list[SeriesSnapshot]:
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
        return snapshots
    window = max(1, rule.persistence_window)
    required = max(1, min(window, rule.persistence_buckets))
    open_candidates = [_decision_candidate(rule, snapshot) for snapshot in snapshots]
    close_threshold = rule.recovery_threshold if rule.recovery_threshold > 0 else rule.threshold
    hold_candidates = [_decision_candidate(rule, snapshot, close_threshold) for snapshot in snapshots]
    resolved: list[SeriesSnapshot] = []
    recent: list[bool] = []
    incident_open = False
    recovery_count = 0
    cooldown_remaining = 0
    for index, snapshot in enumerate(snapshots):
        open_candidate = open_candidates[index]
        hold_candidate = hold_candidates[index]
        recent.append(open_candidate)
        recent = recent[-window:]

        if incident_open:
            if hold_candidate:
                recovery_count = 0
                resolved.append(replace(snapshot, is_anomaly=True, decision_state='open'))
                continue
            recovery_count += 1
            if recovery_count < max(1, rule.recovery_buckets):
                resolved.append(replace(snapshot, is_anomaly=True, decision_state='recovering'))
                continue
            incident_open = False
            recovery_count = 0
            cooldown_remaining = max(0, rule.cooldown_buckets)

        if cooldown_remaining > 0:
            cooldown_remaining -= 1
            resolved.append(replace(snapshot, normalized_score=0.0, severity_label='normal', is_anomaly=False, decision_state='cooldown'))
            continue

        if open_candidate and sum(recent) >= required:
            incident_open = True
            resolved.append(replace(snapshot, is_anomaly=True, decision_state='open'))
            continue

        state = 'candidate' if open_candidate else ('warming_up' if snapshot.expected is None else 'normal')
        # Alert queries consume normalized_score, so a blocked decision must
        # not retain a firing score; raw magnitude remains for diagnosis.
        resolved.append(replace(snapshot, normalized_score=0.0, severity_label='normal', is_anomaly=False, decision_state=state))
    return resolved


def score_points(rule: RuleConfig, source_metric: str, labels: dict[str, str], raw_points: list[RawPoint]) -> list[SeriesSnapshot]:
    points = dedupe_consecutive_points(sorted(_valid_raw_points(raw_points), key=lambda point: point.time))
    if not points:
        return []
    threshold = max(rule.threshold, 0.2)
    window = max(rule.baseline_window, 3)
    canonical_rule = RuleConfig(
        name=rule.name,
        query=rule.query,
        source_type=rule.source_type,
        datasource_url=rule.datasource_url,
        target_sinks=rule.target_sinks,
        range_seconds=rule.range_seconds,
        step_seconds=rule.step_seconds,
        bucket_span_seconds=rule.bucket_span_seconds,
        algorithm=rule.algorithm,
        anomaly_direction=rule.anomaly_direction,
        minimum_absolute_deviation=rule.minimum_absolute_deviation,
        minimum_relative_deviation=rule.minimum_relative_deviation,
        minimum_activity=rule.minimum_activity,
        persistence_buckets=rule.persistence_buckets,
        persistence_window=rule.persistence_window,
        recovery_threshold=rule.recovery_threshold,
        recovery_buckets=rule.recovery_buckets,
        cooldown_buckets=rule.cooldown_buckets,
        data_quality_gate=rule.data_quality_gate,
        threshold=threshold,
        baseline_window=window,
        seasonality_samples=max(rule.seasonality_samples, 2),
        seasonal_refinement=rule.seasonal_refinement,
        severity_preset=rule.severity_preset,
        aggregation=rule.aggregation,
        legend=rule.legend,
        labels=rule.labels,
        description=rule.description,
    )

    quality_states = _data_quality_states(points, window)

    if canonical_rule.algorithm == 'ewma':
        snapshots = _score_ewma(canonical_rule, source_metric, labels, points, quality_states)
    elif canonical_rule.algorithm == 'seasonal':
        snapshots = _score_seasonal(canonical_rule, source_metric, labels, points, quality_states)
    elif canonical_rule.algorithm == 'level_shift':
        snapshots = _score_level_shift(canonical_rule, source_metric, labels, points, quality_states)
    else:
        snapshots = []
        for index, point in enumerate(points):
            history_points = points[max(0, index - window) : index]
            history = [entry.value for entry in history_points]

            if canonical_rule.algorithm == 'zscore':
                if len(history) < warmup_history_points(window):
                    snapshots.append(_empty_snapshot(canonical_rule, source_metric, labels, point))
                    continue
                expected = _mean(history)
                spread = _safe_spread(_stddev(history, expected), expected)
                snapshots.append(
                    _snapshot(
                        canonical_rule,
                        source_metric,
                        labels,
                        points,
                        index,
                        history,
                        expected,
                        spread,
                        data_quality_label=quality_states[index],
                    )
                )
            else:
                if len(history) < warmup_history_points(window):
                    snapshots.append(_empty_snapshot(canonical_rule, source_metric, labels, point))
                    continue
                expected = median(history)
                spread = _safe_spread(median([abs(value - expected) for value in history]) * 1.4826, expected)
                snapshots.append(
                    _snapshot(
                        canonical_rule,
                        source_metric,
                        labels,
                        points,
                        index,
                        history,
                        expected,
                        spread,
                        data_quality_label=quality_states[index],
                    )
                )

    return _apply_decision_policy(canonical_rule, snapshots)


def _score_level_shift(
    rule: RuleConfig,
    source_metric: str,
    labels: dict[str, str],
    points: list[RawPoint],
    quality_states: list[str],
) -> list[SeriesSnapshot]:
    values = [point.value for point in points]
    shift_window = min(max(3, rule.baseline_window // 3), 12)
    recent_window = max(1, shift_window - 1)
    lookback_window = max(rule.baseline_window * 6, rule.baseline_window + shift_window)
    min_history = max(warmup_history_points(rule.baseline_window), MIN_BASELINE_POINTS * 2, shift_window + MIN_BASELINE_POINTS)
    snapshots: list[SeriesSnapshot] = []

    for index, point in enumerate(points):
        start = max(0, index - lookback_window)
        if index - start < min_history:
            snapshots.append(_empty_snapshot(rule, source_metric, labels, point))
            continue

        baseline_end = index - recent_window
        if baseline_end - start < MIN_BASELINE_POINTS:
            snapshots.append(_empty_snapshot(rule, source_metric, labels, point))
            continue

        reference_history = _level_shift_reference_values(values, start, baseline_end, rule.baseline_window)
        expected = _mean(reference_history)
        spread = _safe_spread(_stddev(reference_history, expected), expected)
        point_raw_score = abs(point.value - expected) / spread
        recent_start = max(0, index - recent_window)
        recent_sum = point.value
        persistent_buckets = 1 if abs(point.value - expected) > spread else 0
        for recent_value in values[recent_start:index]:
            recent_sum += recent_value
            if abs(recent_value - expected) > spread:
                persistent_buckets += 1
        recent_count = index - recent_start + 1
        recent_center = recent_sum / recent_count
        persistence_ratio = persistent_buckets / recent_count
        window_raw_score = (abs(recent_center - expected) / spread) * (1 + max(0.0, persistence_ratio - 0.4))
        raw_score = max(point_raw_score * 0.85, window_raw_score)
        normalized_score, severity_label, is_anomaly = _severity_state(raw_score, rule.threshold, rule.severity_preset)
        data_quality_label = quality_states[index]
        confidence_score, confidence_label = _confidence_state(
            raw_score,
            rule.threshold,
            point_raw_score,
            window_raw_score,
            len(reference_history) + 1,
            data_quality_label,
        )
        snapshots.append(
            SeriesSnapshot(
                rule_name=rule.name,
                source_metric=source_metric,
                labels=labels,
                value=point.value,
                expected=expected,
                lower=expected - rule.threshold * spread,
                upper=expected + rule.threshold * spread,
                deviation=point.value - expected,
                raw_score=_bound_raw_score(raw_score),
                point_raw_score=_bound_raw_score(point_raw_score),
                window_raw_score=_bound_raw_score(window_raw_score),
                score_driver='window' if window_raw_score >= point_raw_score * 0.85 else 'point',
                normalized_score=normalized_score,
                severity_label=severity_label,
                is_anomaly=is_anomaly,
                confidence_score=confidence_score,
                confidence_label=confidence_label,
                data_quality_label=data_quality_label,
                threshold=rule.threshold,
                algorithm=rule.algorithm,
                severity_preset=rule.severity_preset,
                timestamp=point.time,
                decision_state='open' if is_anomaly else 'normal',
            )
        )

    return snapshots


def _score_ewma(
    rule: RuleConfig,
    source_metric: str,
    labels: dict[str, str],
    points: list[RawPoint],
    quality_states: list[str],
) -> list[SeriesSnapshot]:
    snapshots: list[SeriesSnapshot] = []
    alpha = 2 / (max(rule.baseline_window, 2) + 1)
    smoothed: float | None = None
    residual_history: list[float] = []

    for index, point in enumerate(points):
        if index == 0 or smoothed is None:
            smoothed = point.value
            snapshots.append(_empty_snapshot(rule, source_metric, labels, point))
            continue

        expected = smoothed
        recent_values = [entry.value for entry in points[max(0, index - rule.baseline_window) : index]]
        residual_slice = residual_history[-rule.baseline_window :]
        residual_median = median(residual_slice) if residual_slice else 0.0
        spread = _safe_spread(residual_median or _stddev(recent_values), expected)
        residual_history.append(abs(point.value - expected))
        smoothed = alpha * point.value + (1 - alpha) * expected
        if len(recent_values) < warmup_history_points(rule.baseline_window):
            snapshots.append(_empty_snapshot(rule, source_metric, labels, point))
            continue
        snapshots.append(
            _snapshot(
                rule,
                source_metric,
                labels,
                points,
                index,
                recent_values,
                expected,
                spread,
                data_quality_label=quality_states[index],
                include_window_score=True,
            )
        )

    return snapshots


def _score_seasonal(
    rule: RuleConfig,
    source_metric: str,
    labels: dict[str, str],
    points: list[RawPoint],
    quality_states: list[str],
) -> list[SeriesSnapshot]:
    snapshots: list[SeriesSnapshot] = []
    hourly_history: dict[str, list[float]] = {}
    weekday_history: dict[str, list[float]] = {}

    for index, point in enumerate(points):
        peers: list[float] = []
        if rule.seasonal_refinement == 'cycle':
            cursor = index - rule.seasonality_samples
            while cursor >= 0 and len(peers) < rule.baseline_window:
                peers.append(points[cursor].value)
                cursor -= rule.seasonality_samples
        else:
            bucket_keys = _seasonal_bucket_keys(point.time)
            peers = (
                list(hourly_history.get(bucket_keys['hour_of_day'], []))[-rule.baseline_window :]
                if rule.seasonal_refinement == 'hour_of_day'
                else list(weekday_history.get(bucket_keys['weekday_hour'], []))[-rule.baseline_window :]
            )
            if rule.seasonal_refinement == 'weekday_hour' and len(peers) < MIN_SEASONAL_SAMPLES:
                peers = list(hourly_history.get(bucket_keys['hour_of_day'], []))[-rule.baseline_window :]

            hourly_history.setdefault(bucket_keys['hour_of_day'], []).append(point.value)
            weekday_history.setdefault(bucket_keys['weekday_hour'], []).append(point.value)

        if len(peers) < MIN_SEASONAL_SAMPLES:
            snapshots.append(_empty_snapshot(rule, source_metric, labels, point))
            continue

        recent_history = [entry.value for entry in points[max(0, index - rule.baseline_window) : index]]
        expected, spread = _seasonal_expected_and_spread(peers, recent_history)
        snapshots.append(
            _snapshot(
                rule,
                source_metric,
                labels,
                points,
                index,
                recent_history,
                expected,
                spread,
                data_quality_label=quality_states[index],
            )
        )

    return snapshots
