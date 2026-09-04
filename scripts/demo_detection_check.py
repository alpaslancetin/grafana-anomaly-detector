"""Replay the actual demo generator through the checked-in demo rule policies.

This tests short-pulse demo suitability, not production detection quality.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'prometheus-live-demo' / 'anomaly_exporter'))
from app.canonical import aggregate_raw_points, build_raw_point, score_points
from app.config_loader import load_config


def main() -> int:
    spec = importlib.util.spec_from_file_location('demo_generator', ROOT / 'prometheus-live-demo/synthetic_exporter/synthetic_exporter.py')
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    rules = load_config(ROOT / 'multi-sink-demo/exporter/config.yml').rules
    failures = []
    for offset in (0, 37, 91):
        start = 1788432000 + offset
        for rule in rules:
            metric = rule.query.split('{')[0]
            for name in (key for key in generator.metric_snapshot(start) if key.startswith(metric + '{')):
                first = 'instance="api-1"' in name
                phase = 0 if first else 15 if 'latency' in metric else 10 if 'requests' in metric else 12
                period, duration = (150, 18) if first else (190, 16)
                times = list(range(start, start + 3600, rule.step_seconds))
                raw = [build_raw_point(t, generator.metric_snapshot(t)[name]) for t in times]
                output = score_points(rule, name, {}, aggregate_raw_points(raw, rule.bucket_span_seconds))
                truth = {t for t in times[rule.baseline_window:] if generator.spike(t, period, duration, 1, phase)}
                predicted = {int(point.timestamp) for point in output if point.is_anomaly}
                events = []
                for t in sorted(truth):
                    if not events or t != events[-1][-1] + rule.step_seconds:
                        events.append([])
                    events[-1].append(t)
                recall = sum(bool(predicted.intersection(event)) for event in events) / len(events)
                precision = len(predicted & truth) / len(predicted) if predicted else 0
                print(f'offset={offset} {rule.name}/api-{1 if first else 2}: event_recall={recall:.3f} point_precision={precision:.3f}')
                # Recovery may hold an incident beyond the pulse, so strict point
                # precision is reported separately from event detection.
                if recall < 0.8 or precision < 0.45:
                    failures.append(f'{offset}/{name}: short-pulse regression')
    for failure in failures:
        print('[FAIL]', failure)
    print('[FAIL]' if failures else '[PASS]', 'demo short-pulse replay; not a production acceptance gate')
    return int(bool(failures))


if __name__ == '__main__':
    raise SystemExit(main())
