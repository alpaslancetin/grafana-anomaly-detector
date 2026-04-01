from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib import error, parse, request


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
LABELED_DIR = SCRIPT_DIR / "outputs" / "labeled_scenarios"
OUTPUT_DIR = SCRIPT_DIR / "outputs"
RAW_RECORDS_DIR = OUTPUT_DIR / "raw_elastic_records"
RAW_BUCKETS_DIR = OUTPUT_DIR / "raw_elastic_buckets"
NORMALIZED_OUTPUT = OUTPUT_DIR / "elastic_records_normalized.json"
METRICS_OUTPUT = OUTPUT_DIR / "scored_comparisons" / "side_by_side_metrics.json"
CLUSTER_INFO_OUTPUT = OUTPUT_DIR / "elastic_cluster_info.json"
RUN_REPORT_OUTPUT = OUTPUT_DIR / "local_elastic_benchmark_report.md"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the labeled benchmark suite against a local Elastic ML cluster")
    parser.add_argument("--elastic-url", default="http://localhost:9200")
    parser.add_argument("--username")
    parser.add_argument("--password")
    parser.add_argument("--standard-threshold", type=float, default=25.0)
    parser.add_argument("--threshold-candidates", default="5,10,15,20,25,30,40,50,60,75")
    parser.add_argument("--request-timeout-seconds", type=int, default=300)
    return parser.parse_args()


def auth_header(username: str | None, password: str | None) -> dict[str, str]:
    if not username:
        return {}
    token = base64.b64encode(f"{username}:{password or ''}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def api_request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: Any | None = None,
    data_bytes: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout_seconds: int = 300,
) -> Any:
    merged_headers = {"Accept": "application/json"}
    if headers:
        merged_headers.update(headers)

    body: bytes | None = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        merged_headers.setdefault("Content-Type", "application/json")
    elif data_bytes is not None:
        body = data_bytes

    url = parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    req = request.Request(url=url, data=body, headers=merged_headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            content_type = response.headers.get("Content-Type", "")
            body_bytes = response.read()
            if "application/json" in content_type:
                return json.loads(body_bytes.decode("utf-8"))
            if not body_bytes:
                return None
            return body_bytes.decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: HTTP {exc.code} {detail}") from exc


def run_python(script_path: Path, *args: str) -> None:
    subprocess.run([sys.executable, str(script_path), *args], cwd=str(ROOT), check=True)


def load_manifest() -> list[dict[str, Any]]:
    manifest_path = LABELED_DIR / "scenario_manifest.json"
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def delete_job_if_exists(base_url: str, headers: dict[str, str], job_id: str, timeout_seconds: int) -> None:
    try:
        api_request(
            base_url,
            f"/_ml/anomaly_detectors/{job_id}?force=true&delete_user_annotations=true",
            method="DELETE",
            headers=headers,
            timeout_seconds=timeout_seconds,
        )
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise


def create_and_run_job(
    *,
    base_url: str,
    headers: dict[str, str],
    scenario: dict[str, Any],
    timeout_seconds: int,
) -> dict[str, Any]:
    job_template_path = ROOT / str(scenario["job_template_path"])
    ndjson_path = ROOT / str(scenario["ndjson_path"])
    job = json.loads(job_template_path.read_text(encoding="utf-8"))
    job_id = str(job["job_id"])

    delete_job_if_exists(base_url, headers, job_id, timeout_seconds)
    api_request(
        base_url,
        f"/_ml/anomaly_detectors/{job_id}",
        method="PUT",
        payload=job,
        headers=headers,
        timeout_seconds=timeout_seconds,
    )
    api_request(
        base_url,
        f"/_ml/anomaly_detectors/{job_id}/_open",
        method="POST",
        headers=headers,
        timeout_seconds=timeout_seconds,
    )
    api_request(
        base_url,
        f"/_ml/anomaly_detectors/{job_id}/_data",
        method="POST",
        data_bytes=ndjson_path.read_bytes(),
        headers={**headers, "Content-Type": "application/x-ndjson"},
        timeout_seconds=timeout_seconds,
    )
    api_request(
        base_url,
        f"/_ml/anomaly_detectors/{job_id}/_flush",
        method="POST",
        payload={},
        headers=headers,
        timeout_seconds=timeout_seconds,
    )
    api_request(
        base_url,
        f"/_ml/anomaly_detectors/{job_id}/_close",
        method="POST",
        headers=headers,
        timeout_seconds=timeout_seconds,
    )
    records = api_request(
        base_url,
        f"/_ml/anomaly_detectors/{job_id}/results/records?exclude_interim=true&size=1000&sort=record_score&desc=true",
        headers=headers,
        timeout_seconds=timeout_seconds,
    )
    buckets = api_request(
        base_url,
        f"/_ml/anomaly_detectors/{job_id}/results/buckets?exclude_interim=true&size=1000&sort=anomaly_score&desc=true",
        headers=headers,
        timeout_seconds=timeout_seconds,
    )
    return {
        "job_id": job_id,
        "records": records,
        "buckets": buckets,
    }


def write_run_report(cluster_info: dict[str, Any], metrics: dict[str, Any], manifest: list[dict[str, Any]]) -> None:
    overall = metrics["overall"]
    lines = [
        "# Elastic Local Side-by-Side Benchmark Report",
        "",
        "## Environment",
        "",
        f"- Elastic URL: {cluster_info['cluster_url']}",
        f"- Elastic version: {cluster_info['root']['version']['number']}",
        f"- Elastic license: {cluster_info['license']['license']['type']}",
        f"- Scenario count: {len(manifest)}",
        "",
        "## Overall result",
        "",
        f"- Elastic standard threshold: {overall['elastic_standard_threshold']}",
        f"- Elastic best threshold: {overall['elastic_best_threshold']}",
        f"- Default mean F1: {overall['default_mean_f1']}",
        f"- Tuned mean F1: {overall['tuned_mean_f1']}",
        f"- Elastic standard mean F1: {overall['elastic_standard_mean_f1']}",
        f"- Elastic best mean F1: {overall['elastic_best_mean_f1']}",
        "",
        "## Output files",
        "",
        f"- Normalized Elastic records: `{NORMALIZED_OUTPUT.relative_to(ROOT)}`",
        f"- Visual report HTML: `benchmarks/elastic_side_by_side/outputs/visual_report/side_by_side_visual_report.html`",
        f"- Scored comparison JSON: `{METRICS_OUTPUT.relative_to(ROOT)}`",
        f"- Elastic cluster info: `{CLUSTER_INFO_OUTPUT.relative_to(ROOT)}`",
        "",
    ]
    RUN_REPORT_OUTPUT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    args = parse_args()
    RAW_RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    RAW_BUCKETS_DIR.mkdir(parents=True, exist_ok=True)
    for stale_file in RAW_RECORDS_DIR.glob("*.json"):
        stale_file.unlink()
    for stale_file in RAW_BUCKETS_DIR.glob("*.json"):
        stale_file.unlink()

    headers = auth_header(args.username, args.password)

    run_python(ROOT / "benchmarks" / "functional" / "run_functional_benchmark.py")
    run_python(ROOT / "benchmarks" / "functional" / "run_functional_tuning_sweep.py")
    run_python(SCRIPT_DIR / "export_labeled_scenarios_for_elastic.py")
    manifest = load_manifest()

    cluster_info = {
        "cluster_url": args.elastic_url,
        "root": api_request(args.elastic_url, "/", headers=headers, timeout_seconds=args.request_timeout_seconds),
        "license": api_request(args.elastic_url, "/_license", headers=headers, timeout_seconds=args.request_timeout_seconds),
        "ml_info": api_request(args.elastic_url, "/_ml/info", headers=headers, timeout_seconds=args.request_timeout_seconds),
    }
    CLUSTER_INFO_OUTPUT.write_text(json.dumps(cluster_info, indent=2), encoding="utf-8")

    run_summaries: list[dict[str, Any]] = []
    for scenario in manifest:
        result = create_and_run_job(
            base_url=args.elastic_url,
            headers=headers,
            scenario=scenario,
            timeout_seconds=args.request_timeout_seconds,
        )
        scenario_name = str(scenario["scenario"])
        (RAW_RECORDS_DIR / f"{scenario_name}.records.json").write_text(
            json.dumps(result["records"], indent=2),
            encoding="utf-8",
        )
        (RAW_BUCKETS_DIR / f"{scenario_name}.buckets.json").write_text(
            json.dumps(result["buckets"], indent=2),
            encoding="utf-8",
        )
        run_summaries.append(
            {
                "scenario": scenario_name,
                "job_id": result["job_id"],
                "record_count": len(result["records"].get("records", [])),
                "bucket_count": len(result["buckets"].get("buckets", [])),
            }
        )

    run_python(
        SCRIPT_DIR / "normalize_elastic_records.py",
        "--input-dir",
        str(RAW_RECORDS_DIR),
        "--output",
        str(NORMALIZED_OUTPUT),
    )
    run_python(
        SCRIPT_DIR / "score_side_by_side_metrics.py",
        "--elastic-normalized",
        str(NORMALIZED_OUTPUT),
        "--elastic-standard-threshold",
        str(args.standard_threshold),
        "--elastic-threshold-candidates",
        args.threshold_candidates,
    )

    metrics_payload = json.loads(METRICS_OUTPUT.read_text(encoding="utf-8"))
    best_threshold = float(metrics_payload["overall"]["elastic_best_threshold"])

    run_python(
        SCRIPT_DIR / "build_side_by_side_visual_report.py",
        "--elastic-normalized",
        str(NORMALIZED_OUTPUT),
        "--elastic-threshold",
        str(best_threshold),
    )

    run_summary_output = OUTPUT_DIR / "local_elastic_benchmark_summary.json"
    run_summary_output.write_text(
        json.dumps(
            {
                "cluster": cluster_info,
                "runs": run_summaries,
                "metrics_overall": metrics_payload["overall"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    write_run_report(cluster_info, metrics_payload, manifest)
    print(json.dumps({"scenario_count": len(manifest), "best_threshold": best_threshold}, indent=2))


if __name__ == "__main__":
    main()
