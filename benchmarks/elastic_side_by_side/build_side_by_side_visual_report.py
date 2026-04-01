from __future__ import annotations

import argparse
import json
import math
from dataclasses import replace
from pathlib import Path
import sys
from typing import Iterable


ROOT = Path(__file__).resolve().parents[2]
FUNCTIONAL_DIR = ROOT / "benchmarks" / "functional"
sys.path.insert(0, str(FUNCTIONAL_DIR))
sys.path.insert(0, str(ROOT / "prometheus-live-demo" / "anomaly_exporter"))

from run_functional_benchmark import SCENARIO_BUILDERS, Scenario, evaluate_scenario  # noqa: E402
from app.algorithms import evaluate_series  # noqa: E402
from app.models import RuleConfig, SeriesState  # noqa: E402


OUTPUT_DIR = Path(__file__).resolve().parent / "outputs" / "visual_report"
TUNING_SUMMARY_PATH = ROOT / "benchmarks" / "functional" / "outputs" / "functional_tuning_sweep_summary.json"


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
    for records in grouped.values():
        records.sort(key=lambda item: float(item.get("timestamp") or 0))
    return grouped


def collect_trace(scenario: Scenario, rule: RuleConfig) -> list[dict[str, object]]:
    state = SeriesState.create(history_limit=rule.history_limit, seasonal_window=rule.baseline_window)
    base_timestamp = 1_700_000_000
    trace: list[dict[str, object]] = []
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
        trace.append(
            {
                "index": index,
                "timestamp": timestamp,
                "value": value,
                "expected": snapshot.expected,
                "lower": snapshot.lower,
                "upper": snapshot.upper,
                "raw_score": snapshot.raw_score,
                "normalized_score": snapshot.normalized_score,
                "is_anomaly": snapshot.is_anomaly,
            }
        )
    return trace


def polyline(points: Iterable[tuple[float, float]]) -> str:
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


def scale_builder(values: list[float], top: float, height: float):
    minimum = min(values)
    maximum = max(values)
    if math.isclose(minimum, maximum):
        minimum -= 1.0
        maximum += 1.0
    padding = (maximum - minimum) * 0.1
    low = minimum - padding
    high = maximum + padding

    def scale(value: float) -> float:
        ratio = 0.0 if math.isclose(high, low) else (value - low) / (high - low)
        return top + height - (ratio * height)

    return scale


def render_detector_svg(
    scenario: Scenario,
    trace: list[dict[str, object]],
    *,
    title: str,
    subtitle: str,
    threshold: float,
    output_path: Path,
) -> None:
    width = 1200
    height = 760
    margin_left = 70
    margin_right = 30
    top_chart_top = 90
    top_chart_height = 270
    bottom_chart_top = 430
    bottom_chart_height = 220
    chart_width = width - margin_left - margin_right

    x_positions = [margin_left + (chart_width * index / max(1, len(trace) - 1)) for index in range(len(trace))]
    value_candidates: list[float] = []
    for point in trace:
        for key in ("value", "expected", "lower", "upper"):
            value = point.get(key)
            if value is not None:
                value_candidates.append(float(value))
    value_scale = scale_builder(value_candidates, top_chart_top, top_chart_height)
    score_scale = scale_builder([0.0, threshold, max(float(point["raw_score"]) for point in trace) + 0.5], bottom_chart_top, bottom_chart_height)

    actual_points = [(x_positions[index], value_scale(float(point["value"]))) for index, point in enumerate(trace)]
    expected_points = [(x_positions[index], value_scale(float(point["expected"]))) for index, point in enumerate(trace) if point["expected"] is not None]
    lower_points = [(x_positions[index], value_scale(float(point["lower"]))) for index, point in enumerate(trace) if point["lower"] is not None]
    upper_points = [(x_positions[index], value_scale(float(point["upper"]))) for index, point in enumerate(trace) if point["upper"] is not None]
    raw_score_points = [(x_positions[index], score_scale(float(point["raw_score"]))) for index, point in enumerate(trace)]
    threshold_y = score_scale(threshold)

    anomaly_markers = [(x_positions[index], value_scale(float(point["value"]))) for index, point in enumerate(trace) if point["is_anomaly"]]
    labeled_markers = [(x_positions[index], value_scale(float(point["value"]))) for index, point in enumerate(trace) if index in scenario.anomaly_indices]
    band_path = polyline(upper_points) + " " + polyline(reversed(lower_points)) if lower_points and upper_points else ""
    band_fragment = f'<polygon points="{band_path}" fill="#dbeafe" fill-opacity="0.65" stroke="none"/>' if band_path else ""
    expected_fragment = (
        f'<polyline points="{polyline(expected_points)}" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-dasharray="6 5"/>'
        if expected_points
        else ""
    )
    anomaly_fragment = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="#ef4444" stroke="#7f1d1d" stroke-width="1"/>'
        for x, y in anomaly_markers
    )
    labeled_fragment = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="none" stroke="#111827" stroke-width="2"/>'
        for x, y in labeled_markers
    )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#fbfcfe" rx="24"/>
  <text x="40" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#0f172a">{title}</text>
  <text x="40" y="68" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#475569">{subtitle}</text>
  <text x="40" y="108" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#0f172a">Signal and expected band</text>
  <rect x="{margin_left}" y="{top_chart_top}" width="{chart_width}" height="{top_chart_height}" fill="#ffffff" stroke="#dbe4f0"/>
  <line x1="{margin_left}" y1="{top_chart_top + top_chart_height}" x2="{margin_left + chart_width}" y2="{top_chart_top + top_chart_height}" stroke="#94a3b8"/>
  <line x1="{margin_left}" y1="{top_chart_top}" x2="{margin_left}" y2="{top_chart_top + top_chart_height}" stroke="#94a3b8"/>
  {band_fragment}
  {expected_fragment}
  <polyline points="{polyline(actual_points)}" fill="none" stroke="#0f172a" stroke-width="2.5"/>
  {anomaly_fragment}
  {labeled_fragment}
  <text x="40" y="448" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#0f172a">Raw score vs threshold</text>
  <rect x="{margin_left}" y="{bottom_chart_top}" width="{chart_width}" height="{bottom_chart_height}" fill="#ffffff" stroke="#dbe4f0"/>
  <line x1="{margin_left}" y1="{bottom_chart_top + bottom_chart_height}" x2="{margin_left + chart_width}" y2="{bottom_chart_top + bottom_chart_height}" stroke="#94a3b8"/>
  <line x1="{margin_left}" y1="{bottom_chart_top}" x2="{margin_left}" y2="{bottom_chart_top + bottom_chart_height}" stroke="#94a3b8"/>
  <line x1="{margin_left}" y1="{threshold_y:.1f}" x2="{margin_left + chart_width}" y2="{threshold_y:.1f}" stroke="#ef4444" stroke-width="2" stroke-dasharray="7 5"/>
  <polyline points="{polyline(raw_score_points)}" fill="none" stroke="#7c3aed" stroke-width="2.5"/>
  <text x="{margin_left + 12}" y="{threshold_y - 8:.1f}" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#b91c1c">threshold={threshold:.2f}</text>
  <g transform="translate(40, 690)">
    <circle cx="0" cy="0" r="5" fill="#ef4444" stroke="#7f1d1d" stroke-width="1"/>
    <text x="14" y="5" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#334155">Detector anomaly</text>
    <circle cx="180" cy="0" r="6" fill="none" stroke="#111827" stroke-width="2"/>
    <text x="196" y="5" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#334155">Labeled anomaly</text>
  </g>
</svg>
"""
    output_path.write_text(svg, encoding="utf-8")


def render_elastic_svg(
    scenario: Scenario,
    elastic_records: list[dict[str, object]],
    *,
    score_threshold: float,
    output_path: Path,
) -> None:
    width = 1200
    height = 760
    margin_left = 70
    margin_right = 30
    top_chart_top = 90
    top_chart_height = 270
    bottom_chart_top = 430
    bottom_chart_height = 220
    chart_width = width - margin_left - margin_right
    base_timestamp = 1_700_000_000

    x_positions = [margin_left + (chart_width * index / max(1, len(scenario.values) - 1)) for index in range(len(scenario.values))]
    value_scale = scale_builder(list(scenario.values), top_chart_top, top_chart_height)
    score_values = [0.0, score_threshold] + [float(record.get("record_score") or 0.0) for record in elastic_records]
    score_scale = scale_builder(score_values, bottom_chart_top, bottom_chart_height)
    actual_points = [(x_positions[index], value_scale(float(value))) for index, value in enumerate(scenario.values)]

    elastic_markers = []
    score_markers = []
    typical_markers = []
    bound_fragments: list[str] = []
    for record in elastic_records:
        timestamp = float(record.get("timestamp") or 0) / 1000.0
        index = int(round((timestamp - base_timestamp) / scenario.step_seconds))
        if 0 <= index < len(scenario.values):
            x = x_positions[index]
            actual_y = value_scale(float(scenario.values[index]))
            elastic_markers.append((x, actual_y, float(record.get("record_score") or 0.0)))
            score_markers.append((x, score_scale(float(record.get("record_score") or 0.0))))
            if record.get("typical") is not None:
                typical_markers.append((x, value_scale(float(record["typical"]))))
            lower = record.get("lower_confidence_bound")
            upper = record.get("upper_confidence_bound")
            if lower is not None and upper is not None:
                bound_fragments.append(
                    f'<line x1="{x:.1f}" y1="{value_scale(float(lower)):.1f}" x2="{x:.1f}" y2="{value_scale(float(upper)):.1f}" '
                    f'stroke="#86efac" stroke-width="3" stroke-linecap="round"/>'
                )
    elastic_marker_fragment = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5.5" fill="{"#16a34a" if score >= score_threshold else "#f59e0b"}" '
        f'stroke="#14532d" stroke-width="1"/>'
        for x, y, score in elastic_markers
    )
    typical_fragment = "".join(
        f'<rect x="{x - 3:.1f}" y="{y - 3:.1f}" width="6" height="6" fill="#2563eb"/>'
        for x, y in typical_markers
    )
    score_marker_fragment = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="#16a34a"/>'
        for x, y in score_markers
    )
    score_polyline = polyline(score_markers) if score_markers else ""

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#fffdf8" rx="24"/>
  <text x="40" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#0f172a">Elastic result view</text>
  <text x="40" y="68" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#475569">{scenario.name} imported from Elastic records export | threshold={score_threshold:.1f}</text>
  <text x="40" y="108" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#0f172a">Signal with Elastic anomaly markers</text>
  <rect x="{margin_left}" y="{top_chart_top}" width="{chart_width}" height="{top_chart_height}" fill="#ffffff" stroke="#dbe4f0"/>
  <line x1="{margin_left}" y1="{top_chart_top + top_chart_height}" x2="{margin_left + chart_width}" y2="{top_chart_top + top_chart_height}" stroke="#94a3b8"/>
  <line x1="{margin_left}" y1="{top_chart_top}" x2="{margin_left}" y2="{top_chart_top + top_chart_height}" stroke="#94a3b8"/>
  <polyline points="{polyline(actual_points)}" fill="none" stroke="#334155" stroke-width="2.5"/>
  {''.join(bound_fragments)}
  {typical_fragment}
  {elastic_marker_fragment}
  <text x="40" y="448" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#0f172a">Elastic record_score</text>
  <rect x="{margin_left}" y="{bottom_chart_top}" width="{chart_width}" height="{bottom_chart_height}" fill="#ffffff" stroke="#dbe4f0"/>
  <line x1="{margin_left}" y1="{bottom_chart_top + bottom_chart_height}" x2="{margin_left + chart_width}" y2="{bottom_chart_top + bottom_chart_height}" stroke="#94a3b8"/>
  <line x1="{margin_left}" y1="{bottom_chart_top}" x2="{margin_left}" y2="{bottom_chart_top + bottom_chart_height}" stroke="#94a3b8"/>
  <line x1="{margin_left}" y1="{score_scale(score_threshold):.1f}" x2="{margin_left + chart_width}" y2="{score_scale(score_threshold):.1f}" stroke="#f59e0b" stroke-width="2" stroke-dasharray="7 5"/>
  <polyline points="{score_polyline}" fill="none" stroke="#16a34a" stroke-width="2.5"/>
  {score_marker_fragment}
  <g transform="translate(40, 690)">
    <circle cx="0" cy="0" r="5" fill="#16a34a" stroke="#14532d" stroke-width="1"/>
    <text x="14" y="5" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#334155">Elastic anomaly (score >= threshold)</text>
    <circle cx="290" cy="0" r="5" fill="#f59e0b" stroke="#92400e" stroke-width="1"/>
    <text x="304" y="5" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#334155">Elastic record below threshold</text>
    <rect x="570" y="-4" width="8" height="8" fill="#2563eb"/>
    <text x="586" y="5" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#334155">Elastic typical</text>
  </g>
</svg>
"""
    output_path.write_text(svg, encoding="utf-8")


def render_placeholder_svg(scenario: Scenario, output_path: Path) -> None:
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360">
  <rect width="1200" height="360" fill="#f8fafc" rx="24"/>
  <text x="40" y="70" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#0f172a">Elastic result pending</text>
  <text x="40" y="120" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#475569">Scenario: {scenario.name}</text>
  <text x="40" y="165" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#475569">Run the Elastic job on the exported labeled dataset, export records JSON,</text>
  <text x="40" y="195" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#475569">then normalize it with normalize_elastic_records.py and rebuild this report.</text>
</svg>
"""
    output_path.write_text(svg, encoding="utf-8")


def html_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def render_html(summary_rows: list[dict[str, object]], cards: list[str], output_path: Path) -> None:
    rows = "\n".join(
        f"<tr><td>{html_escape(str(row['scenario']))}</td><td>{html_escape(str(row['default_precision']))}</td>"
        f"<td>{html_escape(str(row['tuned_precision']))}</td><td>{html_escape(str(row['default_f1']))}</td>"
        f"<td>{html_escape(str(row['tuned_f1']))}</td><td>{html_escape(str(row['elastic_loaded']))}</td></tr>"
        for row in summary_rows
    )
    html = f"""<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>Anomaly Detector Side-by-Side Visual Report</title>
  <style>
    body {{ font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 32px; background: #edf2f7; color: #0f172a; }}
    .summary, .card {{ background: white; border-radius: 18px; padding: 24px; margin-bottom: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
    th, td {{ border-bottom: 1px solid #e2e8f0; padding: 12px; text-align: left; }}
    .grid {{ display: grid; grid-template-columns: 1fr; gap: 18px; }}
    img {{ width: 100%; border: 1px solid #dbe4f0; border-radius: 14px; background: white; }}
    .meta {{ color: #475569; margin-bottom: 16px; }}
  </style>
</head>
<body>
  <section class="summary">
    <h1>Anomaly Detector Side-by-Side Visual Report</h1>
    <p>Ayni labeled dataset uzerinde bizim detector davranisini ve Elastic davranisini yan yana gormek icin hazirlanan benchmark raporu.</p>
    <table>
      <thead>
        <tr><th>Scenario</th><th>Default precision</th><th>Tuned precision</th><th>Default F1</th><th>Tuned F1</th><th>Elastic loaded</th></tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  </section>
  {''.join(cards)}
</body>
</html>
"""
    output_path.write_text(html, encoding="utf-8")


def remove_stale_visual_assets(active_scenarios: list[str]) -> None:
    keep_names = {"side_by_side_visual_report.html", "side_by_side_visual_summary.json"}
    for scenario in active_scenarios:
        keep_names.update(
            {
                f"{scenario}.default.svg",
                f"{scenario}.tuned.svg",
                f"{scenario}.elastic.svg",
            }
        )

    for path in OUTPUT_DIR.iterdir():
        if not path.is_file():
            continue
        if path.name in keep_names:
            continue
        if path.suffix.lower() not in {".svg", ".png"}:
            continue
        path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build side-by-side visual report for benchmark scenarios")
    parser.add_argument("--elastic-normalized", help="Optional normalized Elastic results JSON")
    parser.add_argument("--elastic-threshold", type=float, default=25.0)
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tuned_configs = load_tuned_configs()
    elastic_by_scenario = load_elastic_records(Path(args.elastic_normalized)) if args.elastic_normalized else {}
    remove_stale_visual_assets([builder().name for builder in SCENARIO_BUILDERS])

    summary_rows: list[dict[str, object]] = []
    cards: list[str] = []

    for builder in SCENARIO_BUILDERS:
        scenario = builder()
        tuned_rule = replace(scenario.rule, **tuned_configs[scenario.name])

        default_trace = collect_trace(scenario, scenario.rule)
        tuned_trace = collect_trace(scenario, tuned_rule)
        default_result = evaluate_scenario(scenario)
        tuned_result = evaluate_scenario(
            Scenario(
                name=scenario.name,
                description=scenario.description,
                rule=tuned_rule,
                values=list(scenario.values),
                anomaly_indices=set(scenario.anomaly_indices),
                step_seconds=scenario.step_seconds,
                labels=dict(scenario.labels),
            )
        )

        default_svg = OUTPUT_DIR / f"{scenario.name}.default.svg"
        tuned_svg = OUTPUT_DIR / f"{scenario.name}.tuned.svg"
        elastic_svg = OUTPUT_DIR / f"{scenario.name}.elastic.svg"

        render_detector_svg(
            scenario,
            default_trace,
            title=f"{scenario.name} - Current detector",
            subtitle=f"default config | precision={default_result['precision']} | F1={default_result['f1']}",
            threshold=scenario.rule.threshold,
            output_path=default_svg,
        )
        render_detector_svg(
            scenario,
            tuned_trace,
            title=f"{scenario.name} - Tuned detector",
            subtitle=f"best benchmark config | precision={tuned_result['precision']} | F1={tuned_result['f1']}",
            threshold=tuned_rule.threshold,
            output_path=tuned_svg,
        )

        elastic_records = elastic_by_scenario.get(scenario.name, [])
        if elastic_records:
            render_elastic_svg(
                scenario,
                elastic_records,
                score_threshold=args.elastic_threshold,
                output_path=elastic_svg,
            )
        else:
            render_placeholder_svg(scenario, elastic_svg)

        summary_rows.append(
            {
                "scenario": scenario.name,
                "default_precision": default_result["precision"],
                "tuned_precision": tuned_result["precision"],
                "default_f1": default_result["f1"],
                "tuned_f1": tuned_result["f1"],
                "elastic_loaded": bool(elastic_records),
            }
        )

        cards.append(
            f"""
            <section class="card">
              <h2>{html_escape(scenario.name)}</h2>
              <div class="meta">{html_escape(scenario.description)}</div>
              <div class="grid">
                <img src="{default_svg.name}" alt="{html_escape(scenario.name)} default detector" />
                <img src="{tuned_svg.name}" alt="{html_escape(scenario.name)} tuned detector" />
                <img src="{elastic_svg.name}" alt="{html_escape(scenario.name)} elastic detector" />
              </div>
            </section>
            """
        )

    render_html(summary_rows, cards, OUTPUT_DIR / "side_by_side_visual_report.html")
    (OUTPUT_DIR / "side_by_side_visual_summary.json").write_text(json.dumps(summary_rows, indent=2), encoding="utf-8")
    print(json.dumps({"scenario_count": len(summary_rows), "output_dir": str(OUTPUT_DIR)}, indent=2))


if __name__ == "__main__":
    main()
