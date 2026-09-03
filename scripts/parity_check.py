from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PANEL_DIR = ROOT / 'grafana-anomaly-detector-panel'
EXPORTER_DIR = ROOT / 'prometheus-live-demo' / 'anomaly_exporter'
TARGET_TS = datetime(2026, 4, 10, 12, 0, tzinfo=timezone.utc).timestamp()
EPSILON = 1e-6

sys.path.insert(0, str(EXPORTER_DIR))

from app.canonical import build_raw_point, score_points  # noqa: E402
from app.models import RuleConfig  # noqa: E402


def deterministic_points() -> list[dict[str, float]]:
    start = datetime(2026, 4, 10, 10, 0, tzinfo=timezone.utc).timestamp()
    points: list[dict[str, float]] = []
    for index in range(180):
        baseline = 100 + math.sin(index / 8) * 2.5 + (index % 17) * 0.07
        if index in {72, 121, 145}:
            baseline += 14 + index % 4
        points.append({'timestamp': start + index * 60, 'value': round(baseline, 6)})
    return points


def score10_points() -> list[dict[str, float]]:
    start = datetime(2026, 4, 10, 10, 0, tzinfo=timezone.utc).timestamp()
    points = [{'timestamp': start + index * 60, 'value': 100.0} for index in range(180)]
    target_index = int((TARGET_TS - start) // 60)
    points[target_index]['value'] = 101.53846153846153
    return points


def zero_baseline_spike_points() -> list[dict[str, float]]:
    start = datetime(2026, 4, 10, 10, 0, tzinfo=timezone.utc).timestamp()
    points = [{'timestamp': start + index * 60, 'value': 0.0} for index in range(180)]
    points[120]['value'] = 100.0
    return points


def irregular_cadence_points() -> list[dict[str, float]]:
    start = datetime(2026, 4, 10, 10, 0, tzinfo=timezone.utc).timestamp()
    points: list[dict[str, float]] = []
    timestamp = start
    for index in range(180):
        points.append({'timestamp': timestamp, 'value': 100.0 + math.sin(index / 9)})
        timestamp += 120 if index % 3 == 2 else 60
    return points


def directional_shift_points(value: float) -> list[dict[str, float]]:
    start = datetime(2026, 4, 10, 10, 0, tzinfo=timezone.utc).timestamp()
    points = [{'timestamp': start + index * 60, 'value': 100.0} for index in range(180)]
    for index in range(120, 126):
        points[index]['value'] = value
    return points


def decision_lifecycle_points() -> list[dict[str, float]]:
    start = datetime(2026, 4, 10, 10, 0, tzinfo=timezone.utc).timestamp()
    values = ([99.0, 101.0] * 6) + [108.0, 108.0, 108.0, 103.0, 100.0, 100.0, 108.0, 108.0, 108.0]
    return [{'timestamp': start + index * 60, 'value': value} for index, value in enumerate(values)]


def build_cases() -> list[dict[str, Any]]:
    base_options = {
        'sensitivity': 3.0,
        'baselineWindow': 12,
        'seasonalitySamples': 24,
        'seasonalRefinement': 'cycle',
        'severityPreset': 'balanced',
    }
    cases = [
        {'name': 'zscore_score10_at_1200', 'points': score10_points(), 'options': {**base_options, 'algorithm': 'zscore'}},
        {'name': 'mad_zero_baseline_spike', 'points': zero_baseline_spike_points(), 'options': {**base_options, 'algorithm': 'mad'}},
        {'name': 'zscore_irregular_cadence', 'points': irregular_cadence_points(), 'options': {**base_options, 'algorithm': 'zscore'}},
        {
            'name': 'mad_high_mean_persistent',
            'points': directional_shift_points(160.0),
            'options': {
                **base_options,
                'algorithm': 'mad',
                'anomalyDirection': 'high_mean',
                'persistenceBuckets': 3,
                'persistenceWindow': 4,
                'dataQualityGate': False,
            },
        },
        {
            'name': 'mad_low_mean_with_floors',
            'points': directional_shift_points(40.0),
            'options': {
                **base_options,
                'algorithm': 'mad',
                'anomalyDirection': 'low_mean',
                'minimumAbsoluteDeviation': 20.0,
                'minimumRelativeDeviation': 0.2,
                'persistenceBuckets': 2,
                'persistenceWindow': 3,
                'dataQualityGate': False,
            },
        },
        {
            'name': 'mad_low_mean_blocks_high_shift',
            'points': directional_shift_points(160.0),
            'options': {**base_options, 'algorithm': 'mad', 'anomalyDirection': 'low_mean'},
        },
        {
            'name': 'mad_decision_lifecycle',
            'points': decision_lifecycle_points(),
            'options': {
                **base_options,
                'algorithm': 'mad',
                'anomalyDirection': 'high_mean',
                'persistenceBuckets': 2,
                'persistenceWindow': 3,
                'recoveryThreshold': 2.0,
                'recoveryBuckets': 2,
                'cooldownBuckets': 2,
            },
        },
    ]
    for algorithm in ['zscore', 'mad', 'ewma', 'seasonal', 'level_shift']:
        cases.append({'name': f'{algorithm}_deterministic', 'points': deterministic_points(), 'options': {**base_options, 'algorithm': algorithm}})
    return cases


def run_ts(cases: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    command = [
        'node',
        '-r',
        'ts-node/register/transpile-only',
        str(ROOT / 'scripts' / 'parity_check_ts_runner.ts'),
    ]
    env = os.environ.copy()
    env['TS_NODE_COMPILER_OPTIONS'] = json.dumps({'target': 'es2018', 'module': 'commonjs', 'importHelpers': False, 'noEmitHelpers': False})
    completed = subprocess.run(
        command,
        cwd=PANEL_DIR,
        env=env,
        input=json.dumps({'cases': cases}),
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(f'TS parity runner failed with exit {completed.returncode}\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}')
    return {item['name']: item['points'] for item in json.loads(completed.stdout)}


def run_py(cases: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for item in cases:
        options = item['options']
        rule = RuleConfig(
            name=item['name'],
            query='parity_fixture',
            algorithm=options['algorithm'],
            anomaly_direction=str(options.get('anomalyDirection', 'high_or_low')),
            minimum_absolute_deviation=float(options.get('minimumAbsoluteDeviation', 0.0)),
            minimum_relative_deviation=float(options.get('minimumRelativeDeviation', 0.0)),
            minimum_activity=float(options.get('minimumActivity', 0.0)),
            persistence_buckets=int(options.get('persistenceBuckets', 1)),
            persistence_window=int(options.get('persistenceWindow', 1)),
            recovery_threshold=float(options.get('recoveryThreshold', 0.0)),
            recovery_buckets=int(options.get('recoveryBuckets', 1)),
            cooldown_buckets=int(options.get('cooldownBuckets', 0)),
            data_quality_gate=bool(options.get('dataQualityGate', False)),
            threshold=float(options['sensitivity']),
            baseline_window=int(options['baselineWindow']),
            seasonality_samples=int(options['seasonalitySamples']),
            seasonal_refinement=str(options['seasonalRefinement']),
            severity_preset=str(options['severityPreset']),
        )
        snapshots = score_points(
            rule,
            'parity_fixture',
            {},
            [build_raw_point(float(point['timestamp']), float(point['value'])) for point in item['points']],
        )
        result[item['name']] = [
            {
                'timestamp': snapshot.timestamp,
                'value': snapshot.value,
                'expected': snapshot.expected,
                'lower': snapshot.lower,
                'upper': snapshot.upper,
                'rawScore': snapshot.raw_score,
                'pointRawScore': snapshot.point_raw_score,
                'windowRawScore': snapshot.window_raw_score,
                'scoreDriver': snapshot.score_driver,
                'normalizedScore': snapshot.normalized_score,
                'severityLabel': snapshot.severity_label,
                'isAnomaly': snapshot.is_anomaly,
                'confidenceScore': snapshot.confidence_score,
                'confidenceLabel': snapshot.confidence_label,
                'dataQualityLabel': snapshot.data_quality_label,
                'decisionState': snapshot.decision_state,
            }
            for snapshot in snapshots
        ]
    return result


def assert_close(case_name: str, index: int, field: str, left: Any, right: Any) -> None:
    if left is None or right is None:
        if left != right:
            raise AssertionError(f'{case_name}[{index}].{field}: TS={left!r} Python={right!r}')
        return
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        if abs(float(left) - float(right)) > EPSILON:
            raise AssertionError(f'{case_name}[{index}].{field}: TS={left!r} Python={right!r}')
        return
    if left != right:
        raise AssertionError(f'{case_name}[{index}].{field}: TS={left!r} Python={right!r}')


def main() -> int:
    cases = build_cases()
    ts_result = run_ts(cases)
    py_result = run_py(cases)
    fields = [
        'timestamp',
        'value',
        'expected',
        'lower',
        'upper',
        'rawScore',
        'pointRawScore',
        'windowRawScore',
        'normalizedScore',
        'severityLabel',
        'isAnomaly',
        'confidenceScore',
        'confidenceLabel',
        'dataQualityLabel',
        'scoreDriver',
        'decisionState',
    ]

    compared = 0
    for case in cases:
        name = case['name']
        ts_points = ts_result[name]
        py_points = py_result[name]
        if len(ts_points) != len(py_points):
            raise AssertionError(f'{name}: TS produced {len(ts_points)} points, Python produced {len(py_points)} points')
        for index, (ts_point, py_point) in enumerate(zip(ts_points, py_points)):
            for field in fields:
                assert_close(name, index, field, ts_point[field], py_point[field])
            compared += 1

    score10 = next(point for point in ts_result['zscore_score10_at_1200'] if abs(point['timestamp'] - TARGET_TS) < EPSILON)
    fed_score10 = next(point for point in py_result['zscore_score10_at_1200'] if abs(point['timestamp'] - TARGET_TS) < EPSILON)
    if score10['normalizedScore'] != 10 or fed_score10['normalizedScore'] != 10:
        raise AssertionError(f'12:00 score example failed: panel={score10["normalizedScore"]} fed={fed_score10["normalizedScore"]}')

    zero_spike = ts_result['mad_zero_baseline_spike'][120]
    fed_zero_spike = py_result['mad_zero_baseline_spike'][120]
    if zero_spike['rawScore'] != 100 or fed_zero_spike['rawScore'] != 100:
        raise AssertionError(f'raw score cap failed: panel={zero_spike["rawScore"]} fed={fed_zero_spike["rawScore"]}')

    print(f'[OK] parity points compared: {compared}')
    print(f'[OK] 2026-04-10 12:00 UTC panel_score={score10["normalizedScore"]} fed_score={fed_score10["normalizedScore"]}')
    print(f'[OK] zero-baseline raw score cap panel={zero_spike["rawScore"]} fed={fed_zero_spike["rawScore"]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
