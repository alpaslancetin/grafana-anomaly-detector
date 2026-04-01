from __future__ import annotations

import argparse
import json
from pathlib import Path


def extract_records(payload: object) -> list[dict[str, object]]:
    if isinstance(payload, dict) and isinstance(payload.get("records"), list):
        return [record for record in payload["records"] if isinstance(record, dict)]
    if isinstance(payload, list):
        return [record for record in payload if isinstance(record, dict)]
    return []


def scalar_or_first(value: object) -> object:
    if isinstance(value, list):
        return value[0] if value else None
    return value


def infer_scenario(file_path: Path, record: dict[str, object]) -> str:
    custom_settings = record.get("custom_settings")
    if isinstance(custom_settings, dict):
        scenario = custom_settings.get("benchmark_scenario")
        if isinstance(scenario, str) and scenario:
            return scenario
    job_id = record.get("job_id")
    if isinstance(job_id, str) and job_id.startswith("benchmark-"):
        return job_id.removeprefix("benchmark-")
    return file_path.stem.replace(".records", "")


def normalize_file(file_path: Path) -> list[dict[str, object]]:
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    normalized: list[dict[str, object]] = []
    for record in extract_records(payload):
        explanation = record.get("anomaly_score_explanation")
        if not isinstance(explanation, dict):
            explanation = {}
        normalized.append(
            {
                "scenario": infer_scenario(file_path, record),
                "timestamp": record.get("timestamp"),
                "record_score": record.get("record_score", 0),
                "initial_record_score": record.get("initial_record_score", 0),
                "probability": record.get("probability"),
                "actual": scalar_or_first(record.get("actual")),
                "typical": scalar_or_first(record.get("typical")),
                "function": record.get("function"),
                "field_name": record.get("field_name"),
                "multi_bucket_impact": record.get("multi_bucket_impact"),
                "single_bucket_impact": explanation.get("single_bucket_impact"),
                "lower_confidence_bound": explanation.get("lower_confidence_bound"),
                "upper_confidence_bound": explanation.get("upper_confidence_bound"),
                "typical_value": explanation.get("typical_value"),
                "by_field_name": record.get("by_field_name"),
                "by_field_value": record.get("by_field_value"),
                "partition_field_name": record.get("partition_field_name"),
                "partition_field_value": record.get("partition_field_value"),
                "job_id": record.get("job_id"),
            }
        )
    return normalized


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize Elastic records export files for side-by-side reporting")
    parser.add_argument("--input-dir", required=True, help="Directory containing *.json records exports")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    all_records: list[dict[str, object]] = []
    for file_path in sorted(input_dir.glob("*.json")):
        all_records.extend(normalize_file(file_path))

    payload = {
        "record_count": len(all_records),
        "records": all_records,
    }
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({"record_count": len(all_records), "output": str(output_path)}, indent=2))


if __name__ == "__main__":
    main()
