# Grafana Anomaly Detector

<p align="center">
  <strong>An anomaly detection panel for Grafana with a multi-datasource, alert-ready score-feed exporter.</strong>
</p>

<p align="center">
  Detect anomalies inside the panel, inspect why they were flagged, and publish alert-ready scores to Prometheus metrics or the data store of your choice — without maintaining custom rule files for each dashboard.
</p>

<p align="center">
  <img alt="Grafana compatibility" src="https://img.shields.io/badge/Grafana-11.6.7%2B-F46800?style=for-the-badge&logo=grafana&logoColor=white">
  <img alt="Validated versions" src="https://img.shields.io/badge/Validated-11.6.7%20%7C%2012.4.0-0F172A?style=for-the-badge">
  <img alt="Plugin version" src="https://img.shields.io/badge/Plugin-v1.3.0-2563EB?style=for-the-badge">
  <img alt="Sources & sinks" src="https://img.shields.io/badge/Sources%20%26%20Sinks-6%20%C3%97%206-7C3AED?style=for-the-badge">
  <img alt="License" src="https://img.shields.io/badge/License-Apache--2.0-16A34A?style=for-the-badge">
</p>

---

## 🆕 New in v1.3.0

- **Multi-datasource range readers**: read series from Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch.
- **Score feed to any store**: publish the plugin-computed score to Prometheus metrics **or** one selected sink (Loki, InfluxDB, PostgreSQL, ClickHouse, Elasticsearch).
- **Source ≠ target split flows**: for example, score PostgreSQL panel data and write the result into Elasticsearch.
- **Target-aware alert queries**: the exported/synced query follows the target store — PromQL, LogQL, Flux, SQL, or an Elasticsearch query spec.
- **Visual fixes**: `PEAK SCORE` and the legend now show the normalized `0-100` severity score (instead of an unbounded raw value), with a denser incident list that keeps detail/annotation actions visible.
- **Hardening & tuning from testing**: PostgreSQL sink auto-reconnect after a backend restart, explicit `HTTP 429` backpressure instead of silent sink drops, NaN/Inf-safe scoring, improved `level_shift` baseline, and `>10k points/sec` throughput.

> Score parity (panel score == fed score, `<= 1e-6`), the panel-independent live feed, and the `/metrics`, `/health`, `/api/sync` endpoints are preserved from earlier releases — v1.3.0 builds on top of them.

## ✨ Why this project stands out

- **Panel-native anomaly detection**: analyze time-series directly where operators already work.
- **Readable anomaly context**: expected value, deviation, confidence, data quality, and main reason are surfaced in the UI.
- **Bring your own store**: a single score feed target writes to Prometheus metrics or any supported sink — no fan-out, one selected destination.
- **Alert-ready, target-aware**: synced rules generate the correct alert query for the chosen store and can be used in Grafana Alerting or any compatible stack.
- **Multiple scoring models**: `zscore`, `mad`, `ewma`, `seasonal`, and `level_shift`.
- **Test-backed compatibility**: validated with live responsive and score-feed flows on Grafana `11.6.7` and `12.4.0`.

## 🧭 At a glance

| Area | What you get |
| --- | --- |
| Panel UX | Recommended mode, Advanced mode, incident inspector, expected line and band, focused anomaly view |
| Detection | Multi-algorithm scoring, severity mapping, confidence scoring, data quality awareness |
| Data sources | Range readers for Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse, Elasticsearch |
| Operations | Score feed to Prometheus metrics or one selected sink, target-aware alert queries, sink health & backpressure metrics, exporter bundles |
| Delivery | Source code, live demo stack, release zips, GitHub release notes |

## 🖼️ Product view

<table>
  <tr>
    <td width="50%">
      <img alt="Anomaly Detector panel and inspector on a Loki source" src="assets/readme/panel-anomaly-detector.png">
    </td>
    <td width="50%">
      <img alt="Score feed published to a Loki sink with a target-aware LogQL query" src="assets/readme/panel-score-feed-loki.png">
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Anomaly Detector panel &amp; inspector (Loki source)</strong></td>
    <td align="center"><strong>Score feed to a Loki sink &amp; LogQL query</strong></td>
  </tr>
</table>

## 🔄 How it works

```mermaid
flowchart LR
    S["Data source<br/>Prometheus · Loki · InfluxDB<br/>PostgreSQL · ClickHouse · Elasticsearch"] --> A["Grafana panel"]
    A --> B["Anomaly scoring in panel"]
    B --> C["Incident inspector<br/>expected line + band"]
    B --> D["Score feed sync"]
    D --> E["Exporter"]
    E --> F["Prometheus metrics"]
    E --> G["Feed sink<br/>Loki · InfluxDB · PostgreSQL<br/>ClickHouse · Elasticsearch"]
    F --> H["Grafana Alerting"]
    G --> H
```

### Detection flow

1. Open a Grafana panel with numeric time-series data from any supported source.
2. Choose `Recommended` for guided defaults or `Advanced` for manual tuning.
3. The panel computes an expected baseline and flags anomalies.
4. Operators inspect the anomaly story inside the panel.
5. If needed, the panel syncs rule metadata to the exporter and selects a score feed target.
6. The exporter publishes the score to Prometheus metrics or the selected sink, with a target-aware alert query.

## 🗄️ Multi-datasource sources and sinks

The exporter can read range series from six source types and publish the computed score to Prometheus metrics or one selected sink.

| Score feed target | Generated alert query |
| --- | --- |
| Prometheus metrics | PromQL |
| Loki | LogQL |
| InfluxDB | Flux |
| PostgreSQL | SQL |
| ClickHouse | SQL |
| Elasticsearch | Elasticsearch query spec |

**Enabling sinks (optional)** — Prometheus-only mode needs no extra configuration. To enable a sink, set the matching environment variables (see `grafana-anomaly-exporter.env.example`):

```bash
# Optional multi-datasource sinks. Leave disabled to keep Prometheus-only mode.
ANOMALY_SINK_LOKI_ENABLED=true
ANOMALY_SINK_LOKI_URL=http://127.0.0.1:3100

ANOMALY_SINK_INFLUX_ENABLED=true
ANOMALY_SINK_INFLUX_URL=http://127.0.0.1:8086
ANOMALY_SINK_INFLUX_ORG=anomaly
ANOMALY_SINK_INFLUX_BUCKET=anomaly
ANOMALY_SINK_INFLUX_TOKEN=

ANOMALY_SINK_PG_ENABLED=true
ANOMALY_SINK_PG_DSN=postgresql://anomaly:anomaly@127.0.0.1:5432/anomaly

ANOMALY_SINK_CH_ENABLED=true
ANOMALY_SINK_CH_URL=http://127.0.0.1:8123

ANOMALY_SINK_ES_ENABLED=true
ANOMALY_SINK_ES_URL=http://127.0.0.1:9200
```

- A score is written to **one** selected target, not fanned out to every sink.
- Source and target can differ — e.g. read from PostgreSQL and write the score into Elasticsearch.
- For non-Prometheus targets, sink queue pressure is explicit: if a write cannot be queued, `/api/feed/scores` returns `HTTP 429` and the queue/drop metrics show the condition.
- If no sink is configured, plugin-computed scores are still exposed from the exporter Prometheus metrics endpoint.

## 🔌 Plugin installation

If you only want the panel plugin, you do not need the exporter bundle.

**Release package**

- [`release/grafana-anomaly-detector-plugin.zip`](release/grafana-anomaly-detector-plugin.zip)

**Typical Grafana install flow**

1. Extract or copy the `alpas-anomalydetector-panel` plugin directory into your Grafana plugins path.
2. Keep the unsigned plugin allow-list entry:
   - `allow_loading_unsigned_plugins = alpas-anomalydetector-panel`
3. Restart Grafana.
4. Hard refresh the browser after the restart.

**Typical Linux path**

- `/var/lib/grafana/plugins/alpas-anomalydetector-panel`

**Minimal config note**

```ini
[plugins]
allow_loading_unsigned_plugins = alpas-anomalydetector-panel
```

## 🚨 Score feed exporter

The exporter turns panel-side anomaly settings into metrics that can be used in Grafana Alerting or any compatible alerting stack — exposed as Prometheus metrics and, optionally, written to a selected sink.

**Exporter source**

- [`prometheus-live-demo/anomaly_exporter/`](prometheus-live-demo/anomaly_exporter)

**Main exported metrics**

- `grafana_anomaly_rule_score`
- `grafana_anomaly_score`
- `grafana_anomaly_confidence_score`
- `grafana_anomaly_sink_up`
- `grafana_anomaly_sink_queue_depth`, `grafana_anomaly_sink_queue_capacity`, `grafana_anomaly_sink_dropped_batches_total`, `grafana_anomaly_sink_last_drop_timestamp_seconds`
- `grafana_anomaly_build_info{version="1.3.0"}`

**Minimum Python requirement**

- minimum supported Python: `3.9`
- recommended Python: `3.9.x`

**Release package**

- [`release/grafana-anomaly-exporter-bundle-1.3.0.zip`](release/grafana-anomaly-exporter-bundle-1.3.0.zip)

**Installation notes**

- native RHEL install:
  - `./install-exporter-rhel.sh http://PROMETHEUS_HOST:PORT`
  - then `./enable-local-prometheus-scrape-rhel.sh`
- portable mode:
  - `./portable-exporter.sh start http://PROMETHEUS_HOST:PORT`
- Grafana panel settings:
  - `Score feed endpoint = http://EXPORTER_HOST:9110`
  - `Score feed target = Prometheus metrics` or one selected sink
- Prometheus must scrape the exporter endpoint:
  - `127.0.0.1:9110` or the exporter host you expose

**Important behavior**

- The score feed is a **live rolling detector**, not a replay of the selected dashboard time range.
- Exported scores are produced from:
  - synced rule configuration
  - source-side lookback in the query itself
  - exporter-side rolling history
- Removing a dashboard does **not** automatically clean synced exporter rules.

## 🧱 Repository layout

| Path | Purpose |
| --- | --- |
| [`grafana-anomaly-detector-panel/`](grafana-anomaly-detector-panel) | Plugin source code |
| [`prometheus-live-demo/`](prometheus-live-demo) | Local demo stack with Prometheus and exporter flow |
| [`release/`](release) | Release packages and GitHub release notes |
| [`assets/readme/`](assets/readme) | README visuals |

## ✅ Compatibility

### Minimum supported Grafana version

This release line requires **Grafana `11.6.7` or later**.

The plugin manifest declares:

- `grafanaDependency: >=11.6.7`

### Live validated Grafana versions

- `11.6.7`
- `12.4.0`

### Validated scenarios

- full dashboard rendering
- `viewPanel` rendering
- `d-solo` rendering
- narrow viewport behavior
- resize and redraw behavior
- score-feed sync and exporter rule registration
- multi-sink publish and read-back across Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch

## ⚙️ Requirements

### Runtime

- Grafana `>= 11.6.7`
- Prometheus, only if you want Prometheus-metric score-feed alerting
- A reachable sink endpoint, only if you publish scores to a non-Prometheus store

### Development

- Node.js `22+`
- npm `10+`

## 🚀 Quick start

### Plugin development

```bash
cd grafana-anomaly-detector-panel
npm install
npm run dev
```

Useful commands:

```bash
npm run build
npm run typecheck
npm run test:ci
npm run e2e
```

### Local live demo

```bash
cd prometheus-live-demo
docker compose up --build
```

Typical local endpoints:

- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9091`
- Exporter metrics: `http://localhost:9110/metrics`

## 📦 Release packages

Main outputs under [`release/`](release):

- `grafana-anomaly-detector-plugin.zip`
- `grafana-anomaly-exporter-bundle-1.3.0.zip`

Release package notes:

- [`release/README.md`](release/README.md)
- [`release/GITHUB_RELEASE_NOTES_v1.3.0.md`](release/GITHUB_RELEASE_NOTES_v1.3.0.md)

## 🛠️ Typical alerting path

1. Build an anomaly panel in Grafana.
2. Enable `Score feed mode` and pick a `Score feed target`.
3. Sync the panel to the exporter.
4. Query the score from the target store using the generated query (PromQL, LogQL, Flux, SQL, or an Elasticsearch query spec).
5. Use that query in Grafana Alerting.

## 📚 More detail

<details>
  <summary><strong>What does the panel expose in the UI?</strong></summary>

- expected value and expected band
- severity label and numeric score
- confidence label and confidence score
- data quality state
- main reason for the anomaly decision
- anomaly inspector and export helpers

</details>

<details>
  <summary><strong>How is the score feed target chosen?</strong></summary>

The panel option `Score feed target` selects a single destination: Prometheus metrics or one configured sink. The exporter writes the score only to that target and generates the matching alert query (PromQL, LogQL, Flux, SQL, or an Elasticsearch query spec). The source datasource and the target store do not have to be the same.

</details>

<details>
  <summary><strong>Why keep the plugin ID as <code>alpas-anomalydetector-panel</code>?</strong></summary>

The public repository and package names use neutral naming, but the plugin ID is kept stable for compatibility with existing Grafana installations and upgrade flows.

</details>

<details>
  <summary><strong>Where should I start if I only want to evaluate the project?</strong></summary>

Start with:

- the screenshots above
- [`prometheus-live-demo/`](prometheus-live-demo)
- [`release/`](release)

</details>

## License

This project is licensed under Apache-2.0. See [LICENSE](LICENSE).
