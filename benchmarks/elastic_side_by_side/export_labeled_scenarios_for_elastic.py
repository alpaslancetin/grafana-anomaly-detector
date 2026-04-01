from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
FUNCTIONAL_DIR = ROOT / "benchmarks" / "functional"
sys.path.insert(0, str(FUNCTIONAL_DIR))

from run_functional_benchmark import SCENARIO_BUILDERS, Scenario  # noqa: E402


OUTPUT_DIR = Path(__file__).resolve().parent / "outputs" / "labeled_scenarios"


def iso_timestamp(epoch_seconds: float) -> str:
    return datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def bucket_span_for_step(step_seconds: int) -> str:
    if step_seconds % 3600 == 0:
        return f"{step_seconds // 3600}h"
    if step_seconds % 60 == 0:
        return f"{step_seconds // 60}m"
    return f"{step_seconds}s"


def detector_function_for_scenario(scenario: Scenario) -> str:
    anomaly_mean = sum(scenario.values[index] for index in sorted(scenario.anomaly_indices)) / len(scenario.anomaly_indices)
    baseline_indices = [index for index in range(len(scenario.values)) if index not in scenario.anomaly_indices]
    baseline_mean = sum(scenario.values[index] for index in baseline_indices) / len(baseline_indices)
    if anomaly_mean < baseline_mean:
        return "low_mean"
    return "high_mean"


def build_post_data_docs(scenario: Scenario) -> list[dict[str, object]]:
    docs: list[dict[str, object]] = []
    base_timestamp = 1_700_000_000
    for index, value in enumerate(scenario.values):
        timestamp = base_timestamp + (index * scenario.step_seconds)
        docs.append(
            {
                "@timestamp": iso_timestamp(timestamp),
                "timestamp_epoch_seconds": timestamp,
                "timestamp_epoch_ms": timestamp * 1000,
                "scenario": scenario.name,
                "metric_name": scenario.rule.query,
                "metric_value": round(value, 6),
                "service": scenario.labels.get("service", "benchmark"),
                "is_labeled_anomaly": index in scenario.anomaly_indices,
                "point_index": index,
                "description": scenario.description,
            }
        )
    return docs


def build_job_template(scenario: Scenario) -> dict[str, object]:
    job_id = f"benchmark-{scenario.name}"
    return {
        "job_id": job_id,
        "description": f"Elastic side-by-side benchmark for {scenario.name}",
        "model_plot_config": {
            "enabled": True,
        },
        "analysis_config": {
            "bucket_span": bucket_span_for_step(scenario.step_seconds),
            "detectors": [
                {
                    "function": detector_function_for_scenario(scenario),
                    "field_name": "metric_value",
                    "detector_description": f"{scenario.name} detector",
                }
            ],
            "influencers": ["service", "scenario"],
        },
        "data_description": {
            "time_field": "timestamp_epoch_seconds",
            "time_format": "epoch",
        },
        "custom_settings": {
            "benchmark_scenario": scenario.name,
            "benchmark_expected_points": len(scenario.values),
            "benchmark_labeled_anomaly_count": len(scenario.anomaly_indices),
        },
    }


def render_readme_manifest(manifest: list[dict[str, object]]) -> str:
    lines = [
        "# Elastic Labeled Scenario Manifest",
        "",
        "| Scenario | Step | Points | Labeled anomalies | Suggested detector function | Suggested bucket span |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for item in manifest:
        lines.append(
            f"| {item['scenario']} | {item['step_seconds']}s | {item['point_count']} | {item['labeled_anomaly_count']} | "
            f"{item['suggested_detector_function']} | {item['suggested_bucket_span']} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    job_dir = OUTPUT_DIR / "job_templates"
    job_dir.mkdir(parents=True, exist_ok=True)
    for stale_file in OUTPUT_DIR.glob("*.ndjson"):
        stale_file.unlink()
    for stale_file in job_dir.glob("*.job.json"):
        stale_file.unlink()

    all_docs: list[dict[str, object]] = []
    manifest: list[dict[str, object]] = []

    for builder in SCENARIO_BUILDERS:
        scenario = builder()
        docs = build_post_data_docs(scenario)
        all_docs.extend(docs)

        scenario_file = OUTPUT_DIR / f"{scenario.name}.ndjson"
        scenario_file.write_text(
            "\n".join(json.dumps(doc, ensure_ascii=True) for doc in docs) + "\n",
            encoding="utf-8",
        )

        job_template = build_job_template(scenario)
        (job_dir / f"{scenario.name}.job.json").write_text(json.dumps(job_template, indent=2), encoding="utf-8")

        manifest.append(
            {
                "scenario": scenario.name,
                "description": scenario.description,
                "step_seconds": scenario.step_seconds,
                "point_count": len(scenario.values),
                "labeled_anomaly_count": len(scenario.anomaly_indices),
                "suggested_detector_function": detector_function_for_scenario(scenario),
                "suggested_bucket_span": bucket_span_for_step(scenario.step_seconds),
                "job_template_path": str((job_dir / f"{scenario.name}.job.json").relative_to(ROOT)),
                "ndjson_path": str(scenario_file.relative_to(ROOT)),
                "source_rule": asdict(scenario.rule),
            }
        )

    (OUTPUT_DIR / "all_scenarios.ndjson").write_text(
        "\n".join(json.dumps(doc, ensure_ascii=True) for doc in all_docs) + "\n",
        encoding="utf-8",
    )
    (OUTPUT_DIR / "scenario_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "scenario_manifest.md").write_text(render_readme_manifest(manifest), encoding="utf-8")

    print(json.dumps({"scenario_count": len(manifest), "output_dir": str(OUTPUT_DIR)}, indent=2))


if __name__ == "__main__":
    main()
