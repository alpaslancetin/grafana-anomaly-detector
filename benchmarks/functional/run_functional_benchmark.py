from __future__ import annotations

import json
import math
import random
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[2]
EXPORTER_ROOT = ROOT / "prometheus-live-demo" / "anomaly_exporter"
sys.path.insert(0, str(EXPORTER_ROOT))

from app.algorithms import evaluate_series  # noqa: E402
from app.models import RuleConfig, SeriesState  # noqa: E402


OUTPUT_DIR = Path(__file__).resolve().parent / "outputs"
TARGET_PROFILE = {
    "precision": 0.80,
    "recall": 0.75,
    "f1": 0.77,
    "max_false_positive_rate": 0.20,
    "max_detection_delay_points": 3,
}


@dataclass
class Scenario:
    name: str
    description: str
    rule: RuleConfig
    values: list[float]
    anomaly_indices: set[int]
    step_seconds: int
    labels: dict[str, str]


def _rand(seed: int) -> random.Random:
    return random.Random(seed)


def _build_latency_spike() -> Scenario:
    rng = _rand(11)
    values = [100 + rng.gauss(0, 3) for _ in range(96)]
    anomaly_indices = set(range(60, 64))
    for index in anomaly_indices:
        values[index] += 85 + rng.gauss(0, 4)
    return Scenario(
        name="latency_spike_mad",
        description="Spiky latency metric with a short, high-amplitude outlier burst.",
        rule=RuleConfig(
            name="latency_spike_mad",
            query="synthetic_latency",
            algorithm="mad",
            threshold=4.0,
            baseline_window=12,
            severity_preset="page_first",
        ),
        values=values,
        anomaly_indices=anomaly_indices,
        step_seconds=300,
        labels={"service": "checkout", "scenario": "latency_spike"},
    )


def _build_error_burst() -> Scenario:
    rng = _rand(22)
    values = [max(0.0, 1.2 + rng.gauss(0, 0.12)) for _ in range(96)]
    anomaly_indices = set(range(44, 49))
    for index in anomaly_indices:
        values[index] += 7.5 + rng.gauss(0, 0.6)
    return Scenario(
        name="error_burst_mad",
        description="Low baseline error rate with a clear anomaly burst.",
        rule=RuleConfig(
            name="error_burst_mad",
            query="synthetic_error_rate",
            algorithm="mad",
            threshold=4.5,
            baseline_window=12,
            severity_preset="page_first",
        ),
        values=values,
        anomaly_indices=anomaly_indices,
        step_seconds=300,
        labels={"service": "checkout", "scenario": "error_burst"},
    )


def _build_traffic_drop() -> Scenario:
    rng = _rand(33)
    values = [240 + (index * 0.45) + rng.gauss(0, 4.5) for index in range(96)]
    anomaly_indices = set(range(52, 59))
    for index in anomaly_indices:
        values[index] -= 95 + rng.gauss(0, 6)
    return Scenario(
        name="traffic_drop_ewma",
        description="Gradually drifting traffic with a sudden sustained drop.",
        rule=RuleConfig(
            name="traffic_drop_ewma",
            query="synthetic_traffic",
            algorithm="ewma",
            threshold=4.5,
            baseline_window=30,
            severity_preset="warning_first",
        ),
        values=values,
        anomaly_indices=anomaly_indices,
        step_seconds=300,
        labels={"service": "checkout", "scenario": "traffic_drop"},
    )


def _build_seasonal_hourly() -> Scenario:
    rng = _rand(44)
    values: list[float] = []
    total_points = 24 * 8
    anomaly_indices = {24 * 7 + 10, 24 * 7 + 11}
    for index in range(total_points):
        hour = index % 24
        seasonal = 110 + 18 * math.sin((2 * math.pi * hour) / 24)
        value = seasonal + rng.gauss(0, 1.8)
        if index in anomaly_indices:
            value += 42 + rng.gauss(0, 2)
        values.append(value)
    return Scenario(
        name="seasonal_hourly_spike",
        description="Hourly repeating pattern with a same-hour anomaly on a later day.",
        rule=RuleConfig(
            name="seasonal_hourly_spike",
            query="synthetic_business_kpi",
            algorithm="seasonal",
            threshold=4.5,
            baseline_window=8,
            seasonality_samples=24,
            seasonal_refinement="cycle",
            severity_preset="balanced",
        ),
        values=values,
        anomaly_indices=anomaly_indices,
        step_seconds=3600,
        labels={"service": "checkout", "scenario": "seasonal_hourly"},
    )


def _build_resource_step() -> Scenario:
    rng = _rand(55)
    values = [55 + (index * 0.12) + rng.gauss(0, 1.1) for index in range(120)]
    anomaly_indices = set(range(82, 90))
    for index in anomaly_indices:
        values[index] += 16 + rng.gauss(0, 1.5)
    return Scenario(
        name="resource_step_ewma",
        description="Slowly increasing resource baseline with a clear abnormal step-up.",
        rule=RuleConfig(
            name="resource_step_ewma",
            query="synthetic_resource",
            algorithm="ewma",
            threshold=4.5,
            baseline_window=24,
            severity_preset="balanced",
        ),
        values=values,
        anomaly_indices=anomaly_indices,
        step_seconds=300,
        labels={"service": "checkout", "scenario": "resource_step"},
    )


def _build_subtle_level_shift() -> Scenario:
    rng = _rand(66)
    values = [100 + (index * 0.03) + rng.gauss(0, 0.65) for index in range(120)]
    anomaly_indices = set(range(72, 84))
    for index in anomaly_indices:
        values[index] += 4.8 + rng.gauss(0, 0.5)
    return Scenario(
        name="subtle_level_shift",
        description="Subtle but sustained level shift that benefits from the dedicated level-shift detector.",
        rule=RuleConfig(
            name="subtle_level_shift",
            query="synthetic_subtle_shift",
            algorithm="level_shift",
            threshold=3.5,
            baseline_window=24,
            severity_preset="balanced",
        ),
        values=values,
        anomaly_indices=anomaly_indices,
        step_seconds=300,
        labels={"service": "checkout", "scenario": "subtle_level_shift"},
    )


SCENARIO_BUILDERS: list[Callable[[], Scenario]] = [
    _build_latency_spike,
    _build_error_burst,
    _build_traffic_drop,
    _build_seasonal_hourly,
    _build_resource_step,
    _build_subtle_level_shift,
]


def evaluate_scenario(scenario: Scenario) -> dict[str, object]:
    state = SeriesState.create(history_limit=scenario.rule.history_limit, seasonal_window=scenario.rule.baseline_window)
    predicted_indices: set[int] = set()
    raw_scores: list[float] = []
    normalized_scores: list[float] = []

    base_timestamp = 1_700_000_000
    for index, value in enumerate(scenario.values):
        timestamp = base_timestamp + (index * scenario.step_seconds)
        snapshot = evaluate_series(
            state=state,
            rule=scenario.rule,
            source_metric=scenario.rule.name,
            labels=scenario.labels,
            value=value,
            timestamp=timestamp,
        )
        raw_scores.append(snapshot.raw_score)
        normalized_scores.append(snapshot.normalized_score)
        if snapshot.is_anomaly:
            predicted_indices.add(index)

    tp = len(predicted_indices & scenario.anomaly_indices)
    fp = len(predicted_indices - scenario.anomaly_indices)
    fn = len(scenario.anomaly_indices - predicted_indices)
    tn = len(scenario.values) - tp - fp - fn

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    if precision + recall:
        f1 = 2 * precision * recall / (precision + recall)
    else:
        f1 = 0.0
    false_positive_rate = fp / max(1, (fp + tn))

    first_truth = min(scenario.anomaly_indices)
    detected_in_window = sorted(index for index in predicted_indices if index in scenario.anomaly_indices)
    detection_delay_points = detected_in_window[0] - first_truth if detected_in_window else None

    passes_target = (
        precision >= TARGET_PROFILE["precision"]
        and recall >= TARGET_PROFILE["recall"]
        and f1 >= TARGET_PROFILE["f1"]
        and false_positive_rate <= TARGET_PROFILE["max_false_positive_rate"]
        and (detection_delay_points is not None and detection_delay_points <= TARGET_PROFILE["max_detection_delay_points"])
    )

    return {
        "name": scenario.name,
        "description": scenario.description,
        "algorithm": scenario.rule.algorithm,
        "threshold": scenario.rule.threshold,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_positive_rate": round(false_positive_rate, 4),
        "detection_delay_points": detection_delay_points,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "max_raw_score": round(max(raw_scores), 4),
        "max_normalized_score": round(max(normalized_scores), 2),
        "passes_enterprise_target_profile": passes_target,
    }


def render_markdown(results: list[dict[str, object]], overall: dict[str, object]) -> str:
    lines = [
        "# Functional Benchmark Report",
        "",
        "Reference mode: Elastic-aligned enterprise target profile (not a direct Elastic runtime export).",
        "",
        "## Overall summary",
        "",
        f"- Scenario count: {overall['scenario_count']}",
        f"- Passed target profile: {overall['passed_scenarios']} / {overall['scenario_count']}",
        f"- Mean precision: {overall['mean_precision']}",
        f"- Mean recall: {overall['mean_recall']}",
        f"- Mean F1: {overall['mean_f1']}",
        f"- Mean false positive rate: {overall['mean_false_positive_rate']}",
        "",
        "## Scenario results",
        "",
        "| Scenario | Algorithm | Precision | Recall | F1 | FP rate | Delay (points) | Target pass |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    for result in results:
        lines.append(
            f"| {result['name']} | {result['algorithm']} | {result['precision']} | {result['recall']} | {result['f1']} | "
            f"{result['false_positive_rate']} | {result['detection_delay_points']} | {result['passes_enterprise_target_profile']} |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- This benchmark measures our current detector quality against a target profile inspired by enterprise anomaly detection expectations.",
            "- It does not yet compare against a real Elastic ML result export.",
            "- The next parity step should be to feed the same labeled scenarios to Elastic and import the result file into the same reporting flow.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    results = [evaluate_scenario(builder()) for builder in SCENARIO_BUILDERS]
    overall = {
        "scenario_count": len(results),
        "passed_scenarios": sum(1 for result in results if result["passes_enterprise_target_profile"]),
        "mean_precision": round(statistics.mean(result["precision"] for result in results), 4),
        "mean_recall": round(statistics.mean(result["recall"] for result in results), 4),
        "mean_f1": round(statistics.mean(result["f1"] for result in results), 4),
        "mean_false_positive_rate": round(statistics.mean(result["false_positive_rate"] for result in results), 4),
        "target_profile": TARGET_PROFILE,
    }

    payload = {
        "comparison_mode": "elastic_aligned_target_profile",
        "overall": overall,
        "scenarios": results,
    }

    (OUTPUT_DIR / "functional_benchmark_summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "functional_benchmark_report.md").write_text(render_markdown(results, overall), encoding="utf-8")

    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
