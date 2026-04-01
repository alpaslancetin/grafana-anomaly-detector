from __future__ import annotations

import json
import statistics
import sys
from dataclasses import replace
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR))

from run_functional_benchmark import (  # noqa: E402
    OUTPUT_DIR as BASE_OUTPUT_DIR,
    SCENARIO_BUILDERS,
    TARGET_PROFILE,
    Scenario,
    evaluate_scenario,
)


OUTPUT_DIR = BASE_OUTPUT_DIR


def evaluate_with_rule(scenario: Scenario, **rule_overrides: object) -> dict[str, object]:
    tuned = replace(scenario.rule, **rule_overrides)
    tuned_scenario = Scenario(
        name=scenario.name,
        description=scenario.description,
        rule=tuned,
        values=list(scenario.values),
        anomaly_indices=set(scenario.anomaly_indices),
        step_seconds=scenario.step_seconds,
        labels=dict(scenario.labels),
    )
    return evaluate_scenario(tuned_scenario)


def candidate_overrides(scenario: Scenario) -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []

    if scenario.rule.algorithm == "mad":
        for algorithm in ("mad", "zscore"):
            for threshold in (2.4, 2.8, 3.2, 3.6, 4.0, 4.5, 5.0):
                for baseline_window in (8, 12, 16, 20, 24):
                    candidates.append(
                        {
                            "algorithm": algorithm,
                            "threshold": threshold,
                            "baseline_window": baseline_window,
                        }
                    )
    elif scenario.rule.algorithm == "ewma":
        for algorithm in ("ewma", "mad", "zscore"):
            for threshold in (2.1, 2.4, 2.8, 3.2, 3.6, 4.0, 4.5):
                for baseline_window in (8, 12, 16, 20, 24, 30):
                    candidates.append(
                        {
                            "algorithm": algorithm,
                            "threshold": threshold,
                            "baseline_window": baseline_window,
                        }
                    )
    elif scenario.rule.algorithm == "level_shift":
        for algorithm in ("level_shift", "ewma", "mad"):
            for threshold in (3.0, 3.5, 4.0, 4.5, 5.0):
                for baseline_window in (12, 18, 24, 30):
                    candidates.append(
                        {
                            "algorithm": algorithm,
                            "threshold": threshold,
                            "baseline_window": baseline_window,
                        }
                    )
    else:
        for threshold in (2.4, 2.8, 3.2, 3.6, 4.0, 4.5, 5.0, 6.0):
            for baseline_window in (3, 4, 5, 6, 8):
                for refinement in ("cycle", "hour_of_day", "weekday_hour"):
                    candidates.append(
                        {
                            "algorithm": "seasonal",
                            "threshold": threshold,
                            "baseline_window": baseline_window,
                            "seasonality_samples": 24,
                            "seasonal_refinement": refinement,
                        }
                    )

    unique: dict[tuple[tuple[str, object], ...], dict[str, object]] = {}
    for candidate in candidates:
        key = tuple(sorted(candidate.items()))
        unique[key] = candidate
    return list(unique.values())


def rank_key(result: dict[str, object]) -> tuple[object, ...]:
    delay = result["detection_delay_points"]
    delay_score = 999 if delay is None else delay
    return (
        result["passes_enterprise_target_profile"],
        result["f1"],
        result["precision"],
        result["recall"],
        -result["false_positive_rate"],
        -delay_score,
    )


def compare_default_vs_tuned(scenario: Scenario) -> dict[str, object]:
    default_result = evaluate_scenario(scenario)
    evaluated: list[dict[str, object]] = []

    for candidate in candidate_overrides(scenario):
        result = evaluate_with_rule(scenario, **candidate)
        evaluated.append(
            {
                "config": candidate,
                "result": result,
            }
        )

    best = max(evaluated, key=lambda entry: rank_key(entry["result"]))
    best_result = best["result"]

    return {
        "name": scenario.name,
        "description": scenario.description,
        "default": default_result,
        "best_tuned": best_result,
        "best_config": best["config"],
        "delta_precision": round(best_result["precision"] - default_result["precision"], 4),
        "delta_recall": round(best_result["recall"] - default_result["recall"], 4),
        "delta_f1": round(best_result["f1"] - default_result["f1"], 4),
        "delta_false_positive_rate": round(best_result["false_positive_rate"] - default_result["false_positive_rate"], 4),
        "candidate_count": len(evaluated),
    }


def aggregate(results: list[dict[str, object]], key: str) -> float:
    return round(statistics.mean(item[key] for item in results), 4)


def render_report(comparisons: list[dict[str, object]], overall: dict[str, object]) -> str:
    lines = [
        "# Functional Tuning Sweep Report",
        "",
        "This report estimates the best reachable quality with the current detector algorithm set and per-scenario tuning.",
        f"Enterprise target profile: precision>={TARGET_PROFILE['precision']}, recall>={TARGET_PROFILE['recall']}, "
        f"F1>={TARGET_PROFILE['f1']}, FP rate<={TARGET_PROFILE['max_false_positive_rate']}, "
        f"delay<={TARGET_PROFILE['max_detection_delay_points']} points.",
        "",
        "## Overall",
        "",
        f"- Scenario count: {overall['scenario_count']}",
        f"- Default pass count: {overall['default_passed_scenarios']} / {overall['scenario_count']}",
        f"- Tuned pass count: {overall['tuned_passed_scenarios']} / {overall['scenario_count']}",
        f"- Mean precision: {overall['default_mean_precision']} -> {overall['tuned_mean_precision']}",
        f"- Mean recall: {overall['default_mean_recall']} -> {overall['tuned_mean_recall']}",
        f"- Mean F1: {overall['default_mean_f1']} -> {overall['tuned_mean_f1']}",
        f"- Mean false positive rate: {overall['default_mean_false_positive_rate']} -> {overall['tuned_mean_false_positive_rate']}",
        "",
        "## Scenario comparison",
        "",
        "| Scenario | Default P | Tuned P | Default F1 | Tuned F1 | Default FP | Tuned FP | Tuned pass | Best config |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    for item in comparisons:
        best = item["best_config"]
        best_text = f"{best['algorithm']}, th={best['threshold']}, win={best['baseline_window']}"
        if "seasonal_refinement" in best:
            best_text += f", ref={best['seasonal_refinement']}"
        lines.append(
            f"| {item['name']} | {item['default']['precision']} | {item['best_tuned']['precision']} | "
            f"{item['default']['f1']} | {item['best_tuned']['f1']} | "
            f"{item['default']['false_positive_rate']} | {item['best_tuned']['false_positive_rate']} | "
            f"{item['best_tuned']['passes_enterprise_target_profile']} | {best_text} |"
        )

    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- If tuned pass count remains low, the current algorithm family still falls short of enterprise parity even after parameter tuning.",
            "- If tuned pass count increases strongly, the gap is primarily calibration, not architecture.",
            "- Seasonal scenario behavior is the strongest signal for whether deeper model capability is needed.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    comparisons = [compare_default_vs_tuned(builder()) for builder in SCENARIO_BUILDERS]

    default_results = [item["default"] for item in comparisons]
    tuned_results = [item["best_tuned"] for item in comparisons]
    overall = {
        "scenario_count": len(comparisons),
        "default_passed_scenarios": sum(1 for item in default_results if item["passes_enterprise_target_profile"]),
        "tuned_passed_scenarios": sum(1 for item in tuned_results if item["passes_enterprise_target_profile"]),
        "default_mean_precision": aggregate(default_results, "precision"),
        "tuned_mean_precision": aggregate(tuned_results, "precision"),
        "default_mean_recall": aggregate(default_results, "recall"),
        "tuned_mean_recall": aggregate(tuned_results, "recall"),
        "default_mean_f1": aggregate(default_results, "f1"),
        "tuned_mean_f1": aggregate(tuned_results, "f1"),
        "default_mean_false_positive_rate": aggregate(default_results, "false_positive_rate"),
        "tuned_mean_false_positive_rate": aggregate(tuned_results, "false_positive_rate"),
        "target_profile": TARGET_PROFILE,
    }

    payload = {
        "comparison_mode": "functional_tuning_sweep",
        "overall": overall,
        "scenarios": comparisons,
    }

    (OUTPUT_DIR / "functional_tuning_sweep_summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "functional_tuning_sweep_report.md").write_text(render_report(comparisons, overall), encoding="utf-8")

    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
