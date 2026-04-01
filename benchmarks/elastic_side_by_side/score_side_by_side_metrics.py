from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import replace
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
FUNCTIONAL_DIR = ROOT / "benchmarks" / "functional"
sys.path.insert(0, str(FUNCTIONAL_DIR))
sys.path.insert(0, str(ROOT / "prometheus-live-demo" / "anomaly_exporter"))

from run_functional_benchmark import SCENARIO_BUILDERS, Scenario, evaluate_scenario  # noqa: E402
from app.algorithms import evaluate_series  # noqa: E402
from app.models import RuleConfig, SeriesState  # noqa: E402


TUNING_SUMMARY_PATH = ROOT / "benchmarks" / "functional" / "outputs" / "functional_tuning_sweep_summary.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "outputs" / "scored_comparisons"


def load_tuned_configs() -> dict[str, dict[str, object]]:
    payload = json.loads(TUNING_SUMMARY_PATH.read_text(encoding="utf-8"))
    return {scenario["name"]: scenario["best_config"] for scenario in payload["scenarios"]}


def load_elastic_records(path: Path | None) -> dict[str, list[dict[str, object]]]:
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    grouped: dict[str, list[dict[str, object]]] = {}
    for record in payload.get("records", []):
        scenario = record.get("scenario")
        if isinstance(scenario, str):
            grouped.setdefault(scenario, []).append(record)
    return grouped


def evaluate_trace_predictions(scenario: Scenario, rule: RuleConfig) -> set[int]:
    state = SeriesState.create(history_limit=rule.history_limit, seasonal_window=rule.baseline_window)
    predicted: set[int] = set()
    base_timestamp = 1_700_000_000
    for index, value in enumerate(scenario.values):
        timestamp = base_timestamp + (index * scenario.step_seconds)
        snapshot = evaluate_series(
            state=state,
            rule=rule,
            source_metric=rule.name,
            labels=scenario.labels,
            value=value,
            timestamp=timestamp,
        )
        if snapshot.is_anomaly:
            predicted.add(index)
    return predicted


def elastic_predictions_for_scenario(scenario: Scenario, records: list[dict[str, object]], score_threshold: float) -> set[int]:
    base_timestamp = 1_700_000_000
    predicted: set[int] = set()
    for record in records:
        score = float(record.get("record_score") or 0.0)
        if score < score_threshold:
            continue
        timestamp_ms = float(record.get("timestamp") or 0.0)
        index = int(round(((timestamp_ms / 1000.0) - base_timestamp) / scenario.step_seconds))
        if 0 <= index < len(scenario.values):
            predicted.add(index)
    return predicted


def metrics_from_predictions(scenario: Scenario, predicted_indices: set[int]) -> dict[str, object]:
    tp = len(predicted_indices & scenario.anomaly_indices)
    fp = len(predicted_indices - scenario.anomaly_indices)
    fn = len(scenario.anomaly_indices - predicted_indices)
    tn = len(scenario.values) - tp - fp - fn

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    false_positive_rate = fp / max(1, (fp + tn))
    detected_in_window = sorted(index for index in predicted_indices if index in scenario.anomaly_indices)
    detection_delay_points = detected_in_window[0] - min(scenario.anomaly_indices) if detected_in_window else None

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_positive_rate": round(false_positive_rate, 4),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "detection_delay_points": detection_delay_points,
    }


def mean_metric(rows: list[dict[str, object]], key: str) -> float:
    numeric = [float(row[key]) for row in rows]
    return round(statistics.mean(numeric), 4) if numeric else 0.0


def parse_threshold_candidates(value: str) -> list[float]:
    candidates: list[float] = []
    for part in value.split(","):
        item = part.strip()
        if not item:
            continue
        candidates.append(float(item))
    if not candidates:
        raise ValueError("At least one Elastic score threshold candidate is required")
    return candidates


def overall_from_rows(rows: list[dict[str, object]]) -> dict[str, float]:
    return {
        "mean_precision": mean_metric(rows, "precision"),
        "mean_recall": mean_metric(rows, "recall"),
        "mean_f1": mean_metric(rows, "f1"),
        "mean_false_positive_rate": mean_metric(rows, "false_positive_rate"),
    }


def select_best_elastic_threshold(
    scenarios: list[Scenario],
    elastic_by_scenario: dict[str, list[dict[str, object]]],
    candidates: list[float],
) -> tuple[float, list[dict[str, object]]]:
    sweeps: list[dict[str, object]] = []
    for threshold in candidates:
        rows = [
            metrics_from_predictions(
                scenario,
                elastic_predictions_for_scenario(scenario, elastic_by_scenario.get(scenario.name, []), threshold),
            )
            for scenario in scenarios
        ]
        overall = overall_from_rows(rows)
        sweeps.append(
            {
                "threshold": threshold,
                **overall,
            }
        )

    sweeps.sort(
        key=lambda item: (
            float(item["mean_f1"]),
            float(item["mean_precision"]),
            float(item["mean_recall"]),
            -float(item["mean_false_positive_rate"]),
        ),
        reverse=True,
    )
    return float(sweeps[0]["threshold"]), sweeps


def render_markdown(scenarios: list[dict[str, object]], overall: dict[str, object]) -> str:
    lines = [
        "# Side-by-Side Metric Comparison",
        "",
        f"- Elastic results loaded: {overall['elastic_loaded']}",
        f"- Elastic standard threshold: {overall['elastic_standard_threshold']}",
        f"- Elastic best threshold: {overall['elastic_best_threshold']}",
        "",
        "## Overall",
        "",
        f"- Default mean precision: {overall['default_mean_precision']}",
        f"- Tuned mean precision: {overall['tuned_mean_precision']}",
        f"- Elastic standard mean precision: {overall['elastic_standard_mean_precision']}",
        f"- Elastic best mean precision: {overall['elastic_best_mean_precision']}",
        f"- Default mean F1: {overall['default_mean_f1']}",
        f"- Tuned mean F1: {overall['tuned_mean_f1']}",
        f"- Elastic standard mean F1: {overall['elastic_standard_mean_f1']}",
        f"- Elastic best mean F1: {overall['elastic_best_mean_f1']}",
        "",
        "## Scenario matrix",
        "",
        "| Scenario | Default P | Tuned P | Elastic Std P | Elastic Best P | Default F1 | Tuned F1 | Elastic Std F1 | Elastic Best F1 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in scenarios:
        elastic_standard = row["elastic_standard"]
        elastic_best = row["elastic_best"]
        lines.append(
            f"| {row['name']} | {row['default']['precision']} | {row['tuned']['precision']} | "
            f"{elastic_standard['precision']} | {elastic_best['precision']} | "
            f"{row['default']['f1']} | {row['tuned']['f1']} | {elastic_standard['f1']} | {elastic_best['f1']} |"
        )
    lines.append("")
    lines.append("## Elastic threshold sweep")
    lines.append("")
    lines.append("| Threshold | Mean precision | Mean recall | Mean F1 | Mean FP rate |")
    lines.append("| --- | --- | --- | --- | --- |")
    for candidate in overall["elastic_threshold_sweep"]:
        lines.append(
            f"| {candidate['threshold']} | {candidate['mean_precision']} | {candidate['mean_recall']} | "
            f"{candidate['mean_f1']} | {candidate['mean_false_positive_rate']} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Score default/tuned/Elastic outputs side by side")
    parser.add_argument("--elastic-normalized", help="Optional normalized Elastic JSON")
    parser.add_argument("--elastic-standard-threshold", type=float, default=25.0)
    parser.add_argument(
        "--elastic-threshold-candidates",
        default="5,10,15,20,25,30,40,50,60,75",
        help="Comma-separated Elastic record_score thresholds to sweep",
    )
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tuned_configs = load_tuned_configs()
    elastic_by_scenario = load_elastic_records(Path(args.elastic_normalized)) if args.elastic_normalized else {}
    scenarios = [builder() for builder in SCENARIO_BUILDERS]
    threshold_candidates = parse_threshold_candidates(args.elastic_threshold_candidates)
    if args.elastic_standard_threshold not in threshold_candidates:
        threshold_candidates = sorted(set([*threshold_candidates, args.elastic_standard_threshold]))

    best_threshold, threshold_sweep = select_best_elastic_threshold(scenarios, elastic_by_scenario, threshold_candidates)

    scenario_rows: list[dict[str, object]] = []
    default_rows: list[dict[str, object]] = []
    tuned_rows: list[dict[str, object]] = []
    elastic_standard_rows: list[dict[str, object]] = []
    elastic_best_rows: list[dict[str, object]] = []

    for scenario in scenarios:
        tuned_rule = replace(scenario.rule, **tuned_configs[scenario.name])

        default_metrics = metrics_from_predictions(scenario, evaluate_trace_predictions(scenario, scenario.rule))
        tuned_metrics = metrics_from_predictions(
            scenario,
            evaluate_trace_predictions(
                Scenario(
                    name=scenario.name,
                    description=scenario.description,
                    rule=tuned_rule,
                    values=list(scenario.values),
                    anomaly_indices=set(scenario.anomaly_indices),
                    step_seconds=scenario.step_seconds,
                    labels=dict(scenario.labels),
                ),
                tuned_rule,
            ),
        )
        elastic_standard_metrics = metrics_from_predictions(
            scenario,
            elastic_predictions_for_scenario(
                scenario,
                elastic_by_scenario.get(scenario.name, []),
                args.elastic_standard_threshold,
            ),
        )
        elastic_best_metrics = metrics_from_predictions(
            scenario,
            elastic_predictions_for_scenario(
                scenario,
                elastic_by_scenario.get(scenario.name, []),
                best_threshold,
            ),
        )

        scenario_rows.append(
            {
                "name": scenario.name,
                "default": default_metrics,
                "tuned": tuned_metrics,
                "elastic_standard": elastic_standard_metrics,
                "elastic_best": elastic_best_metrics,
            }
        )
        default_rows.append(default_metrics)
        tuned_rows.append(tuned_metrics)
        elastic_standard_rows.append(elastic_standard_metrics)
        elastic_best_rows.append(elastic_best_metrics)

    overall = {
        "elastic_loaded": bool(elastic_by_scenario),
        "elastic_standard_threshold": args.elastic_standard_threshold,
        "elastic_best_threshold": best_threshold,
        "elastic_threshold_sweep": threshold_sweep,
        "default_mean_precision": mean_metric(default_rows, "precision"),
        "tuned_mean_precision": mean_metric(tuned_rows, "precision"),
        "elastic_standard_mean_precision": mean_metric(elastic_standard_rows, "precision"),
        "elastic_best_mean_precision": mean_metric(elastic_best_rows, "precision"),
        "default_mean_f1": mean_metric(default_rows, "f1"),
        "tuned_mean_f1": mean_metric(tuned_rows, "f1"),
        "elastic_standard_mean_f1": mean_metric(elastic_standard_rows, "f1"),
        "elastic_best_mean_f1": mean_metric(elastic_best_rows, "f1"),
    }

    payload = {
        "overall": overall,
        "scenarios": scenario_rows,
    }
    (OUTPUT_DIR / "side_by_side_metrics.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "side_by_side_metrics.md").write_text(render_markdown(scenario_rows, overall), encoding="utf-8")
    print(json.dumps({"output_dir": str(OUTPUT_DIR), "elastic_loaded": overall["elastic_loaded"]}, indent=2))


if __name__ == "__main__":
    main()
