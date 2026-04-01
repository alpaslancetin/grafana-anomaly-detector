from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STATE_FILE = ROOT / "prometheus-live-demo" / "anomaly_exporter" / "state" / "dynamic_rules.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "outputs"
EXPORTER_BASE = "http://localhost:9110"
PROM_BASE = "http://localhost:9091"
GRAFANA_BASE = "http://localhost:3000"
DEFAULT_STAGES = [75, 100, 150, 200, 300, 400]
DEFAULT_SETTLE_SECONDS = 10
DEFAULT_MAX_ACCEPTABLE_EVAL_SECONDS = 1.5


def timed_json_get(url: str) -> tuple[dict, float]:
    started = time.perf_counter()
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload, time.perf_counter() - started


def timed_text_get(url: str) -> tuple[str, float]:
    started = time.perf_counter()
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = response.read().decode("utf-8")
    return payload, time.perf_counter() - started


def timed_post_json(url: str, payload: dict) -> tuple[dict, float]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
    return body, time.perf_counter() - started


def build_payload(index: int) -> dict:
    mode = index % 3
    if mode == 0:
        query = 'demo_latency_ms{service="checkout",environment="demo"}'
        algorithm = "mad"
        sensitivity = 2.8
        baseline_window = 12
        metric_preset = "latency"
        severity_preset = "page_first"
    elif mode == 1:
        query = 'demo_requests_per_second{service="checkout",environment="demo"}'
        algorithm = "ewma"
        sensitivity = 2.8
        baseline_window = 16
        metric_preset = "traffic"
        severity_preset = "warning_first"
    else:
        query = 'demo_cpu_usage_ratio{service="checkout",environment="demo"}'
        algorithm = "zscore"
        sensitivity = 3.0
        baseline_window = 20
        metric_preset = "saturation"
        severity_preset = "balanced"

    return {
        "dashboardUid": "capacity-extended",
        "dashboardTitle": "Capacity Extended Dashboard",
        "panelId": 2000 + index,
        "panelTitle": f"Capacity extended detector {index}",
        "source": "saved",
        "ruleNamePrefix": f"capacity_extended_{index}",
        "targets": [
            {
                "refId": "A",
                "expr": query,
                "datasourceUid": "anomaly-demo-prometheus",
                "datasourceType": "prometheus",
            }
        ],
        "resolvedOptions": {
            "setupMode": "recommended",
            "metricPreset": metric_preset,
            "effectiveMetricPreset": metric_preset,
            "detectionMode": "single",
            "algorithm": algorithm,
            "sensitivity": sensitivity,
            "baselineWindow": baseline_window,
            "seasonalitySamples": 24,
            "seasonalRefinement": "cycle",
            "severityPreset": severity_preset,
        },
    }


def current_dynamic_rules() -> int:
    payload, _ = timed_json_get(f"{EXPORTER_BASE}/api/sync/rules")
    return len(payload["rules"])


def ensure_dynamic_target(target: int) -> dict[str, float]:
    current_dynamic = current_dynamic_rules()
    total_post_seconds = 0.0
    added = 0
    if current_dynamic >= target:
        return {"added_rules": added, "total_post_seconds": total_post_seconds}
    for index in range(current_dynamic + 1, target + 1):
        _, elapsed = timed_post_json(f"{EXPORTER_BASE}/api/sync/panel", build_payload(index))
        total_post_seconds += elapsed
        added += 1
    return {"added_rules": added, "total_post_seconds": round(total_post_seconds, 4)}


def query_prometheus_scalar(expression: str) -> tuple[float, float]:
    encoded = urllib.parse.quote(expression, safe="")
    payload, elapsed = timed_json_get(f"{PROM_BASE}/api/v1/query?query={encoded}")
    result = payload.get("data", {}).get("result", [])
    if not result:
        return 0.0, elapsed
    return float(result[0]["value"][1]), elapsed


def parse_metric(metrics_text: str, metric_name: str) -> float:
    for line in metrics_text.splitlines():
        if line.startswith(metric_name + " "):
            return float(line.split()[-1])
    return 0.0


def collect_process_snapshot() -> list[dict[str, object]]:
    command = (
        "wsl.exe -e bash -lc "
        "\"ps -eo pid,pcpu,pmem,rss,cmd | grep -E 'grafana server|python /app/main.py|/bin/prometheus --config.file=/etc/prometheus/prometheus.yml|/usr/bin/prometheus$' | grep -v grep\""
    )
    result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
    processes: list[dict[str, object]] = []
    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        processes.append(
            {
                "pid": int(parts[0]),
                "cpu_percent": float(parts[1]),
                "mem_percent": float(parts[2]),
                "rss_kb": int(parts[3]),
                "command": parts[4],
            }
        )
    return processes


def collect_stage_snapshot(target_dynamic_count: int, add_summary: dict[str, float]) -> dict[str, object]:
    health, grafana_health_latency = timed_json_get(f"{GRAFANA_BASE}/api/health")
    metrics_text, exporter_metrics_latency = timed_text_get(f"{EXPORTER_BASE}/metrics")
    rule_score_series, prom_rule_query_latency = query_prometheus_scalar("count(grafana_anomaly_rule_score)")
    series_score_series, prom_series_query_latency = query_prometheus_scalar("count(grafana_anomaly_score)")

    snapshot = {
        "target_dynamic_rules": target_dynamic_count,
        "grafana_health": health,
        "dynamic_rule_count": parse_metric(metrics_text, "grafana_anomaly_dynamic_rule_count"),
        "config_rule_count": parse_metric(metrics_text, "grafana_anomaly_config_rule_count"),
        "last_scrape_success": parse_metric(metrics_text, "grafana_anomaly_last_scrape_success"),
        "evaluation_duration_seconds": parse_metric(metrics_text, "grafana_anomaly_evaluation_duration_seconds"),
        "rule_score_series": rule_score_series,
        "series_score_series": series_score_series,
        "grafana_health_latency_seconds": round(grafana_health_latency, 4),
        "exporter_metrics_latency_seconds": round(exporter_metrics_latency, 4),
        "prom_rule_query_latency_seconds": round(prom_rule_query_latency, 4),
        "prom_series_query_latency_seconds": round(prom_series_query_latency, 4),
        "state_file_size_bytes": STATE_FILE.stat().st_size if STATE_FILE.exists() else 0,
        "post_add_summary": add_summary,
        "processes": collect_process_snapshot(),
    }
    return snapshot


def compute_safe_limit(stages: list[dict[str, object]], max_acceptable_eval_seconds: float) -> int:
    safe_limit = 0
    for stage in stages:
        healthy = (
            stage["last_scrape_success"] == 1.0
            and stage["evaluation_duration_seconds"] <= max_acceptable_eval_seconds
        )
        if healthy:
            safe_limit = int(stage["target_dynamic_rules"])
        else:
            break
    return safe_limit


def render_report(summary: dict[str, object], max_acceptable_eval_seconds: float) -> str:
    lines = [
        "# Detector Scale Extended Report",
        "",
        "This test increases synced dynamic detector count until the exporter-side evaluation time or scrape health becomes risky.",
        f"Safety guardrail in this run: evaluation duration <= {max_acceptable_eval_seconds} seconds and scrape success = 1.",
        "",
        "## Stages",
        "",
        "| Target dynamic rules | Config rule count | Eval duration (s) | Scrape success | Rule series | Series score series | Exporter metrics latency (s) | Prom query latency (s) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    for stage in summary["stages"]:
        prom_latency = max(stage["prom_rule_query_latency_seconds"], stage["prom_series_query_latency_seconds"])
        lines.append(
            f"| {int(stage['target_dynamic_rules'])} | {stage['config_rule_count']} | {stage['evaluation_duration_seconds']:.6f} | "
            f"{stage['last_scrape_success']} | {stage['rule_score_series']} | {stage['series_score_series']} | "
            f"{stage['exporter_metrics_latency_seconds']} | {prom_latency} |"
        )

    lines.extend(
        [
            "",
            "## Result",
            "",
            f"- Estimated safe dynamic detector limit in this environment: {summary['estimated_safe_dynamic_limit']}",
            f"- Stop reason: {summary['stop_reason']}",
            "",
            "## Notes",
            "",
            "- This is still not a full browser render stress test.",
            "- It is, however, a much stronger detector-side capacity estimate than the initial smoke run.",
        ]
    )
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extended dynamic detector scale test")
    parser.add_argument("--stages", default=",".join(str(stage) for stage in DEFAULT_STAGES))
    parser.add_argument("--settle-seconds", type=int, default=DEFAULT_SETTLE_SECONDS)
    parser.add_argument("--max-eval-seconds", type=float, default=DEFAULT_MAX_ACCEPTABLE_EVAL_SECONDS)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stages = [int(chunk.strip()) for chunk in args.stages.split(",") if chunk.strip()]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = OUTPUT_DIR / "dynamic_rules.extended.backup.json"
    shutil.copyfile(STATE_FILE, backup_path)

    summary: dict[str, object] = {"stages": [], "note": "extended detector scale test"}
    stop_reason = "completed planned stages"
    try:
        for stage in stages:
            add_summary = ensure_dynamic_target(stage)
            time.sleep(args.settle_seconds)
            snapshot = collect_stage_snapshot(stage, add_summary)
            summary["stages"].append(snapshot)

            if snapshot["last_scrape_success"] != 1.0:
                stop_reason = f"scrape health dropped at {stage} dynamic detectors"
                break
            if snapshot["evaluation_duration_seconds"] > args.max_eval_seconds:
                stop_reason = f"evaluation duration exceeded guardrail at {stage} dynamic detectors"
                break
    finally:
        shutil.copyfile(backup_path, STATE_FILE)
        time.sleep(args.settle_seconds)

    summary["estimated_safe_dynamic_limit"] = compute_safe_limit(summary["stages"], args.max_eval_seconds)
    summary["stop_reason"] = stop_reason
    summary["run_parameters"] = {
        "stages": stages,
        "settle_seconds": args.settle_seconds,
        "max_eval_seconds": args.max_eval_seconds,
    }

    (OUTPUT_DIR / "detector_scale_extended_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "detector_scale_extended_report.md").write_text(render_report(summary, args.max_eval_seconds), encoding="utf-8")

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
