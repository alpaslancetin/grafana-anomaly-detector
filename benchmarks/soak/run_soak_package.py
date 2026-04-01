from __future__ import annotations

import argparse
import base64
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


def load_config(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_headers(config: dict[str, object]) -> dict[str, str]:
    headers = {"User-Agent": "anomaly-soak-runner/1.0"}
    custom_headers = config.get("headers")
    if isinstance(custom_headers, dict):
        for key, value in custom_headers.items():
            headers[str(key)] = str(value)

    basic_auth = config.get("basic_auth")
    if isinstance(basic_auth, dict):
        user = str(basic_auth.get("user") or "")
        password = str(basic_auth.get("password") or "")
        if user or password:
            token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
            headers["Authorization"] = f"Basic {token}"

    bearer_token = config.get("bearer_token")
    if isinstance(bearer_token, str) and bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    return headers


def timed_request(
    url: str,
    headers: dict[str, str],
    body: bytes | None = None,
    content_type: str = "application/json",
    *,
    decode_response: bool = True,
) -> tuple[int, str | bytes, float]:
    request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST" if body is not None else "GET")
    if body is not None:
        request.add_header("Content-Type", content_type)
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=30) as response:
        raw_payload = response.read()
        status = response.status
    payload: str | bytes = raw_payload.decode("utf-8") if decode_response else raw_payload
    return status, payload, time.perf_counter() - started


def timed_request_json(url: str, headers: dict[str, str], body: dict[str, object] | None = None) -> tuple[dict[str, object], float]:
    encoded = json.dumps(body).encode("utf-8") if body is not None else None
    _, payload, elapsed = timed_request(url, headers, encoded)
    return json.loads(payload), elapsed


def parse_metric(metrics_text: str, metric_name: str) -> float:
    for line in metrics_text.splitlines():
        if line.startswith(metric_name + " "):
            return float(line.split()[-1])
    return 0.0


def build_payload(index: int) -> dict[str, object]:
    mode = index % 3
    if mode == 0:
        query = 'demo_latency_ms{service="checkout",environment="demo"}'
        algorithm = "mad"
        sensitivity = 4.0
        baseline_window = 12
        metric_preset = "latency"
        severity_preset = "page_first"
    elif mode == 1:
        query = 'demo_requests_per_second{service="checkout",environment="demo"}'
        algorithm = "ewma"
        sensitivity = 4.5
        baseline_window = 30
        metric_preset = "traffic"
        severity_preset = "warning_first"
    else:
        query = 'demo_cpu_usage_ratio{service="checkout",environment="demo"}'
        algorithm = "ewma"
        sensitivity = 4.5
        baseline_window = 24
        metric_preset = "resource"
        severity_preset = "balanced"

    return {
        "dashboardUid": "soak-package",
        "dashboardTitle": "Soak Package Dashboard",
        "panelId": 3000 + index,
        "panelTitle": f"Soak detector {index}",
        "source": "saved",
        "ruleNamePrefix": f"soak_detector_{index}",
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


def ensure_dynamic_target(exporter_base_url: str, headers: dict[str, str], target: int) -> dict[str, object]:
    rules_payload, _ = timed_request_json(f"{exporter_base_url}/api/sync/rules", headers)
    current_rules = rules_payload["rules"]
    current_dynamic = len(current_rules)
    total_post_seconds = 0.0
    if current_dynamic >= target:
        return {"added_rules": 0, "total_post_seconds": 0.0}

    for index in range(current_dynamic + 1, target + 1):
        _, elapsed = timed_request_json(f"{exporter_base_url}/api/sync/panel", headers, build_payload(index))
        total_post_seconds += elapsed
    return {"added_rules": target - current_dynamic, "total_post_seconds": round(total_post_seconds, 4)}


def query_prometheus(prometheus_base_url: str, headers: dict[str, str], expression: str) -> tuple[float, float]:
    encoded = urllib.parse.quote(expression, safe="")
    payload, elapsed = timed_request_json(f"{prometheus_base_url}/api/v1/query?query={encoded}", headers)
    result = payload.get("data", {}).get("result", [])
    if not result:
        return 0.0, elapsed
    return float(result[0]["value"][1]), elapsed


def collect_process_snapshot() -> list[dict[str, object]]:
    command = (
        "wsl.exe -e bash -lc "
        "\"ps -eo pid,pcpu,pmem,rss,cmd | grep -E 'grafana server|python /app/main.py|/bin/prometheus --config.file=/etc/prometheus/prometheus.yml|/usr/bin/prometheus$' | grep -v grep\""
    )
    result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
    processes: list[dict[str, object]] = []
    for raw_line in result.stdout.splitlines():
        parts = raw_line.strip().split(None, 4)
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


def run_url_checks(checks: list[dict[str, object]], headers: dict[str, str]) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for check in checks:
        url = str(check.get("url"))
        name = str(check.get("name"))
        try:
            status, _, elapsed = timed_request(url, headers, body=None, content_type="text/plain", decode_response=False)
            results.append({"name": name, "url": url, "status": status, "latency_seconds": round(elapsed, 4), "ok": 200 <= status < 300})
        except Exception as exc:  # noqa: BLE001
            results.append({"name": name, "url": url, "status": "error", "latency_seconds": None, "ok": False, "error": str(exc)})
    return results


def collect_sample(config: dict[str, object], headers: dict[str, str]) -> dict[str, object]:
    grafana_base = str(config["grafana_base_url"])
    exporter_base = str(config["exporter_base_url"])
    prometheus_base = str(config["prometheus_base_url"])

    grafana_health, grafana_health_latency = timed_request_json(f"{grafana_base}/api/health", headers)
    _, metrics_text, exporter_metrics_latency = timed_request(f"{exporter_base}/metrics", headers, body=None, content_type="text/plain")

    prom_results: list[dict[str, object]] = []
    for query in config.get("prometheus_queries", []):
        if not isinstance(query, dict):
            continue
        value, elapsed = query_prometheus(prometheus_base, headers, str(query.get("expr")))
        prom_results.append({"name": str(query.get("name")), "expr": str(query.get("expr")), "value": value, "latency_seconds": round(elapsed, 4)})

    alert_results: list[dict[str, object]] = []
    for query in config.get("alert_queries", []):
        if not isinstance(query, dict):
            continue
        value, elapsed = query_prometheus(prometheus_base, headers, str(query.get("expr")))
        alert_results.append({"name": str(query.get("name")), "expr": str(query.get("expr")), "value": value, "latency_seconds": round(elapsed, 4)})

    dashboard_checks = run_url_checks([item for item in config.get("dashboard_checks", []) if isinstance(item, dict)], headers)
    render_checks = run_url_checks([item for item in config.get("render_checks", []) if isinstance(item, dict)], headers)

    sample = {
        "timestamp": time.time(),
        "grafana_health": grafana_health,
        "grafana_health_latency_seconds": round(grafana_health_latency, 4),
        "exporter_metrics_latency_seconds": round(exporter_metrics_latency, 4),
        "dynamic_rule_count": parse_metric(metrics_text, "grafana_anomaly_dynamic_rule_count"),
        "config_rule_count": parse_metric(metrics_text, "grafana_anomaly_config_rule_count"),
        "last_scrape_success": parse_metric(metrics_text, "grafana_anomaly_last_scrape_success"),
        "evaluation_duration_seconds": parse_metric(metrics_text, "grafana_anomaly_evaluation_duration_seconds"),
        "prometheus_queries": prom_results,
        "alert_queries": alert_results,
        "dashboard_checks": dashboard_checks,
        "render_checks": render_checks,
        "processes": collect_process_snapshot(),
    }
    return sample


def evaluate_sample(sample: dict[str, object], thresholds: dict[str, object]) -> list[str]:
    breaches: list[str] = []
    max_eval = float(thresholds.get("max_eval_seconds", 1.5))
    min_scrape_success = float(thresholds.get("min_scrape_success", 1.0))
    max_exporter_metrics_latency = float(thresholds.get("max_exporter_metrics_latency_seconds", 0.25))
    max_dashboard_latency = float(thresholds.get("max_dashboard_latency_seconds", 2.0))
    max_render_latency = float(thresholds.get("max_render_latency_seconds", 15.0))

    if float(sample["last_scrape_success"]) < min_scrape_success:
        breaches.append("scrape_success")
    if float(sample["evaluation_duration_seconds"]) > max_eval:
        breaches.append("evaluation_duration")
    if float(sample["exporter_metrics_latency_seconds"]) > max_exporter_metrics_latency:
        breaches.append("exporter_metrics_latency")

    for item in sample["dashboard_checks"]:
        if not item["ok"] or (item["latency_seconds"] is not None and float(item["latency_seconds"]) > max_dashboard_latency):
            breaches.append(f"dashboard:{item['name']}")

    for item in sample["render_checks"]:
        if not item["ok"] or (item["latency_seconds"] is not None and float(item["latency_seconds"]) > max_render_latency):
            breaches.append(f"render:{item['name']}")

    return breaches


def render_report(summary: dict[str, object]) -> str:
    lines = [
        "# Soak Test Report",
        "",
        f"- Target dynamic detectors: {summary['target_dynamic_rules']}",
        f"- Duration seconds: {summary['duration_seconds']}",
        f"- Samples collected: {summary['sample_count']}",
        f"- Final verdict: {summary['final_verdict']}",
        "",
        "## Sample summary",
        "",
        "| Sample | Eval duration (s) | Scrape success | Dashboard failures | Render failures | Effective breach count | Warmup ignored |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]

    for index, sample in enumerate(summary["samples"], start=1):
        dashboard_failures = sum(1 for item in sample["dashboard_checks"] if not item["ok"])
        render_failures = sum(1 for item in sample["render_checks"] if not item["ok"])
        lines.append(
            f"| {index} | {sample['evaluation_duration_seconds']} | {sample['last_scrape_success']} | "
            f"{dashboard_failures} | {render_failures} | {len(sample['effective_breaches'])} | {sample['warmup_ignored']} |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- This package is intended for 350-400 detector soak runs with alert-path queries, dashboard page checks, and render checks enabled together.",
            "- If dashboard or render checks return 302 or 401, provide valid Grafana auth headers in the config file.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run 350-400 detector soak package")
    parser.add_argument("--config", required=True, help="Path to soak profile JSON")
    parser.add_argument("--duration-seconds", type=int, help="Optional override for duration_seconds in config")
    parser.add_argument("--sample-interval-seconds", type=int, help="Optional override for sample_interval_seconds in config")
    parser.add_argument("--initial-settle-seconds", type=int, help="Optional override for initial_settle_seconds in config")
    parser.add_argument("--skip-dashboard-checks", action="store_true", help="Temporarily disable dashboard URL checks")
    parser.add_argument("--skip-render-checks", action="store_true", help="Temporarily disable render URL checks")
    args = parser.parse_args()

    config_path = Path(args.config)
    config = load_config(config_path)
    if args.skip_dashboard_checks:
        config["dashboard_checks"] = []
    if args.skip_render_checks:
        config["render_checks"] = []
    headers = build_headers(config)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = OUTPUT_DIR / f"{config_path.stem}.dynamic_rules.backup.json"
    shutil.copyfile(STATE_FILE, backup_path)

    target_dynamic_rules = int(config["target_dynamic_rules"])
    duration_seconds = args.duration_seconds if args.duration_seconds is not None else int(config["duration_seconds"])
    sample_interval_seconds = (
        args.sample_interval_seconds if args.sample_interval_seconds is not None else int(config["sample_interval_seconds"])
    )
    initial_settle_seconds = (
        args.initial_settle_seconds if args.initial_settle_seconds is not None else int(config.get("initial_settle_seconds", 20))
    )
    thresholds = dict(config.get("safety_thresholds", {}))

    summary: dict[str, object] = {
        "target_dynamic_rules": target_dynamic_rules,
        "duration_seconds": duration_seconds,
        "sample_interval_seconds": sample_interval_seconds,
        "samples": [],
        "seed_summary": {},
    }
    warmup_samples_to_ignore = int(config.get("warmup_samples_to_ignore", 0))

    try:
        summary["seed_summary"] = ensure_dynamic_target(str(config["exporter_base_url"]), headers, target_dynamic_rules)
        time.sleep(initial_settle_seconds)

        deadline = time.time() + duration_seconds
        while time.time() <= deadline:
            sample = collect_sample(config, headers)
            sample["breaches"] = evaluate_sample(sample, thresholds)
            sample_index = len(summary["samples"]) + 1
            sample["warmup_ignored"] = sample_index <= warmup_samples_to_ignore
            sample["effective_breaches"] = [] if sample["warmup_ignored"] else list(sample["breaches"])
            summary["samples"].append(sample)
            time.sleep(sample_interval_seconds)
    finally:
        shutil.copyfile(backup_path, STATE_FILE)
        time.sleep(5)

    summary["sample_count"] = len(summary["samples"])
    summary["warmup_samples_to_ignore"] = warmup_samples_to_ignore
    summary["final_verdict"] = "pass" if all(not sample["effective_breaches"] for sample in summary["samples"]) else "risk"

    json_path = OUTPUT_DIR / f"{config_path.stem}.summary.json"
    md_path = OUTPUT_DIR / f"{config_path.stem}.report.md"
    json_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    md_path.write_text(render_report(summary), encoding="utf-8")

    print(json.dumps({"summary": str(json_path), "report": str(md_path), "final_verdict": summary["final_verdict"]}, indent=2))


if __name__ == "__main__":
    main()
