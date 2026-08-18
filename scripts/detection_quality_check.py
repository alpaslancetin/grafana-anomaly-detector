from __future__ import annotations

import math
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from statistics import median


ROOT = Path(__file__).resolve().parents[1]
EXPORTER_DIR = ROOT / 'prometheus-live-demo' / 'anomaly_exporter'
sys.path.insert(0, str(EXPORTER_DIR))

from app.canonical import build_raw_point, score_points  # noqa: E402
from app.models import RuleConfig  # noqa: E402


POINT_EVENTS = (300, 600, 900, 1200)
SHIFT_START = 1000
SHIFT_END = 1060
POINT_COUNT = 1440


@dataclass(frozen=True)
class AlgorithmProfile:
    threshold: float
    baseline_window: int
    seasonality_samples: int = 144


PROFILES = {
    'zscore': AlgorithmProfile(4.0, 12),
    'mad': AlgorithmProfile(4.0, 12),
    'ewma': AlgorithmProfile(4.5, 30),
    'seasonal': AlgorithmProfile(4.5, 8),
    'level_shift': AlgorithmProfile(6.0, 30),
}


def build_scenario(*, noise: float, spike: float, shift: float) -> list[float]:
    rng = random.Random(42)
    values: list[float] = []
    for index in range(POINT_COUNT):
        baseline = 100 + math.sin(index * 2 * math.pi / 144) * 4 + math.sin(index * 2 * math.pi / 1008) * 1.5
        value = baseline + rng.gauss(0, noise)
        if SHIFT_START <= index < SHIFT_END:
            value += shift
        if index in POINT_EVENTS:
            direction = 1 if (index // 300) % 2 else -1
            value += direction * spike
        values.append(value)
    return values


def event_windows() -> list[range]:
    return [range(max(0, index - 1), min(POINT_COUNT, index + 2)) for index in POINT_EVENTS] + [range(SHIFT_START, SHIFT_END)]


def evaluate(algorithm: str, values: list[float]) -> dict[str, float | int]:
    profile = PROFILES[algorithm]
    rule = RuleConfig(
        name=f'quality_{algorithm}',
        query='quality_fixture',
        algorithm=algorithm,
        threshold=profile.threshold,
        baseline_window=profile.baseline_window,
        seasonality_samples=profile.seasonality_samples,
        seasonal_refinement='cycle',
        severity_preset='balanced',
    )
    points = [build_raw_point(float(index * 60), value) for index, value in enumerate(values)]
    # Warm caches and report the median of repeated runs so host jitter does not
    # turn the quality gate into a false performance regression.
    for _ in range(2):
        score_points(rule, 'quality_fixture', {}, points)
    durations: list[float] = []
    snapshots = []
    for _ in range(5):
        # CPU time measures scorer cost without charging unrelated Docker/host
        # scheduling pauses to the algorithm under test.
        started = time.process_time()
        snapshots = score_points(rule, 'quality_fixture', {}, points)
        durations.append(time.process_time() - started)
    duration = median(durations)
    predicted = {index for index, snapshot in enumerate(snapshots) if snapshot.is_anomaly}
    windows = event_windows()
    truth = {index for window in windows for index in window}
    detected_events = sum(1 for window in windows if predicted.intersection(window))
    true_positive_points = len(predicted.intersection(truth))
    precision = true_positive_points / len(predicted) if predicted else 0.0
    recall = detected_events / len(windows)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    false_positive_points = len(predicted.difference(truth))
    background_points = POINT_COUNT - len(truth)
    shift_hits = len(predicted.intersection(range(SHIFT_START, SHIFT_END)))
    shift_candidates = sorted(predicted.intersection(range(SHIFT_START, SHIFT_END)))

    return {
        'events': detected_events,
        'event_recall': recall,
        'precision': precision,
        'f1': f1,
        'false_positive_points': false_positive_points,
        'false_positive_rate': false_positive_points / background_points,
        'warmup_breaches': sum(1 for index in predicted if index < profile.baseline_window),
        'shift_hits': shift_hits,
        'shift_onset': shift_candidates[0] - SHIFT_START if shift_candidates else -1,
        'points_per_second': round(len(points) / duration),
    }


def main() -> int:
    scenarios = {
        'clear': build_scenario(noise=0.8, spike=20, shift=14),
        'hard': build_scenario(noise=2.5, spike=12, shift=8),
    }
    results = {name: {algorithm: evaluate(algorithm, values) for algorithm in PROFILES} for name, values in scenarios.items()}

    print('scenario algorithm   recall precision    f1   fp_rate warmup shift/onset throughput')
    for scenario, algorithms in results.items():
        for algorithm, metrics in algorithms.items():
            print(
                f'{scenario:8} {algorithm:11} '
                f'{metrics["event_recall"]:6.2f} {metrics["precision"]:9.2f} {metrics["f1"]:5.2f} '
                f'{metrics["false_positive_rate"]:8.3f} {metrics["warmup_breaches"]:6d} '
                f'{metrics["shift_hits"]:2d}/{metrics["shift_onset"]:3d} {metrics["points_per_second"]:10d}'
            )

    failures: list[str] = []
    for scenario, algorithms in results.items():
        for algorithm, metrics in algorithms.items():
            if metrics['warmup_breaches'] != 0:
                failures.append(f'{scenario}/{algorithm}: warm-up breach')

    clear = results['clear']
    for algorithm in ('zscore', 'mad', 'ewma'):
        if clear[algorithm]['event_recall'] < 0.8:
            failures.append(f'clear/{algorithm}: event recall below 0.8')
        if clear[algorithm]['false_positive_rate'] > 0.05:
            failures.append(f'clear/{algorithm}: false-positive rate above 5%')
    if clear['level_shift']['shift_onset'] < 0 or clear['level_shift']['shift_onset'] > 12:
        failures.append('clear/level_shift: sustained shift not detected within 12 buckets')
    if any(metrics['points_per_second'] < 10_000 for metrics in clear.values()):
        failures.append('clear: scorer throughput below 10k points/s')

    if failures:
        for failure in failures:
            print(f'[FAIL] {failure}')
        return 1

    print('[PASS] warm-up, clear-event recall, false-positive and throughput gates passed')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
