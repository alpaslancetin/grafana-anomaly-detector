from __future__ import annotations

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
STAGES = [3, 10, 25, 50]
SETTLE_SECONDS = 8


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def http_get_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=20) as response:
        return response.read().decode("utf-8")


def http_post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def build_payload(index: int) -> dict:
    latency_mode = index % 2 == 0
    if latency_mode:
        query = 'demo_latency_ms{service="checkout",environment="demo"}'
        algorithm = "mad"
        sensitivity = 2.4
        baseline_window = 12
        metric_preset = "latency"
        severity_preset = "page_first"
    else:
        query = 'demo_requests_per_second{service="checkout",environment="demo"}'
        algorithm = "ewma"
        sensitivity = 2.1
        baseline_window = 14
        metric_preset = "traffic"
        severity_preset = "warning_first"

    return {
        "dashboardUid": "capacity-smoke",
        "dashboardTitle": "Capacity Smoke Dashboard",
        "panelId": 1000 + index,
        "panelTitle": f"Capacity synthetic detector {index}",
        "source": "saved",
        "ruleNamePrefix": f"capacity_smoke_{index}",
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


def ensure_dynamic_target(target: int) -> None:
    current_rules = http_get_json(f"{EXPORTER_BASE}/api/sync/rules")["rules"]
    current_dynamic = len(current_rules)
    if current_dynamic >= target:
        return
    for index in range(current_dynamic + 1, target + 1):
        http_post_json(f"{EXPORTER_BASE}/api/sync/panel", build_payload(index))


def query_prometheus_scalar(expression: str) -> float:
    encoded = urllib.parse.quote(expression, safe="")
    payload = http_get_json(f"{PROM_BASE}/api/v1/query?query={encoded}")
    result = payload.get("data", {}).get("result", [])
    if not result:
        return 0.0
    return float(result[0]["value"][1])


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
        if not line or line.startswith("your "):
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


def collect_stage_snapshot(target_dynamic_count: int) -> dict[str, object]:
    metrics_text = http_get_text(f"{EXPORTER_BASE}/metrics")
    return {
        "target_dynamic_rules": target_dynamic_count,
        "grafana_health": http_get_json(f"{GRAFANA_BASE}/api/health"),
        "dynamic_rule_count": parse_metric(metrics_text, "grafana_anomaly_dynamic_rule_count"),
        "config_rule_count": parse_metric(metrics_text, "grafana_anomaly_config_rule_count"),
        "last_scrape_success": parse_metric(metrics_text, "grafana_anomaly_last_scrape_success"),
        "evaluation_duration_seconds": parse_metric(metrics_text, "grafana_anomaly_evaluation_duration_seconds"),
        "rule_score_series": query_prometheus_scalar("count(grafana_anomaly_rule_score)"),
        "series_score_series": query_prometheus_scalar("count(grafana_anomaly_score)"),
        "processes": collect_process_snapshot(),
    }


def render_report(summary: dict[str, object]) -> str:
    lines = [
        "# Detector Scale Smoke Report",
        "",
        "This is an initial exporter-side and Prometheus-side smoke load test.",
        "It does not yet represent a full browser-side Grafana dashboard rendering limit.",
        "",
        "## Stages",
        "",
        "| Target dynamic rules | Config rule count | Eval duration (s) | Rule score series | Series score series | Last scrape success |",
        "| --- | --- | --- | --- | --- | --- |",
    ]

    for stage in summary["stages"]:
        lines.append(
            f"| {int(stage['target_dynamic_rules'])} | {stage['config_rule_count']} | {stage['evaluation_duration_seconds']:.6f} | "
            f"{stage['rule_score_series']} | {stage['series_score_series']} | {stage['last_scrape_success']} |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- Dynamic rule count represents detectors synced from Grafana panels.",
            "- Config rule count includes static and dynamic rules together.",
            "- If evaluation duration remains near-linear while scrape success stays at 1, the detector side is still healthy in this stage range.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = OUTPUT_DIR / "dynamic_rules.backup.json"
    shutil.copyfile(STATE_FILE, backup_path)

    summary: dict[str, object] = {"stages": [], "note": "initial detector scale smoke test"}
    try:
        for stage in STAGES:
            ensure_dynamic_target(stage)
            time.sleep(SETTLE_SECONDS)
            summary["stages"].append(collect_stage_snapshot(stage))
    finally:
        shutil.copyfile(backup_path, STATE_FILE)
        time.sleep(SETTLE_SECONDS)

    (OUTPUT_DIR / "detector_scale_smoke_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "detector_scale_smoke_report.md").write_text(render_report(summary), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
