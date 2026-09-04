# Release packages

This folder contains package revision `1.5.0-r1` of plugin/exporter `1.5.0`. Both ZIP names are versioned. Original packages and checksums remain on the [v1.5.0 release](https://github.com/alpaslancetin/grafana-anomaly-detector/releases/tag/v1.5.0); do not use their checksums with r1 packages.

## Artifacts

- `grafana-anomaly-detector-plugin-1.5.0-r1.zip`: Grafana panel plugin.
- `grafana-anomaly-exporter-bundle-1.5.0-r1.zip`: portable and RHEL exporter bundle.
- `GITHUB_RELEASE_NOTES_v1.5.0.md`: GitHub release description.
- `GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_v1.5.0_TR.md`: end-to-end Turkish guide.
- `PACKAGE_CONTENTS_v1.5.0_TR.md`: package contents and operational notes.
- `SHA256SUMS_v1.5.0-r1.txt`: release integrity checksums.
- [STATUS_v1.5.0.md](STATUS_v1.5.0.md): verified coverage, chart limitations, and remaining production qualification.

This is a code/package revision, not just documentation. The original v1.5.0 tag and assets are not replaced. The v1.5.0-r1 release points to the revised source and packages. Each ZIP contains `BUILD_INFO.json` with the source commit and per-file SHA-256 values. Rebuild using `python scripts/build_release.py` after the production plugin build; do not include runtime state or local QA output.

## Compatibility

- Grafana: `11.6.7` or later.
- Live validated Grafana versions: `11.6.7`, `12.4.0`.
- Exporter Python: `3.9` or later.

## Exporter first start

The exporter zip now contains a ready-to-run `exporter/config.yml` plus two editable templates:

- `exporter/examples/config.prometheus.yml`
- `exporter/examples/config.influxdb.yml`

Prometheus source:

```bash
unzip grafana-anomaly-exporter-bundle-1.5.0-r1.zip
cd grafana-anomaly-exporter-bundle
cp exporter/examples/config.prometheus.yml exporter/config.yml
vi exporter/config.yml
ANOMALY_PYTHON_BIN=$(command -v python3.9) ./portable-exporter.sh validate
ANOMALY_PYTHON_BIN=$(command -v python3.9) ./portable-exporter.sh start http://127.0.0.1:9090
```

InfluxDB 2.x source and sink:

```bash
cp exporter/examples/config.influxdb.yml exporter/config.yml
vi exporter/config.yml
export ANOMALY_SOURCE_INFLUX_ORG='my-org'
export ANOMALY_SOURCE_INFLUX_TOKEN='source-token'
export ANOMALY_SINK_INFLUX_TOKEN='sink-token'
./portable-exporter.sh validate
./portable-exporter.sh start
```

The Influx example intentionally uses separate source and score buckets to prevent score-feedback loops. The packaged `dynamic_rules.json` is empty; no development dashboard state is distributed.

The exporter API uses schema `3`. It supports lifecycle-aware decisions, explicit panel unregister, runtime-scope expiry, bounded requests, and separate `/health/live`, `/health/ready`, and `/health/dependencies` probes. Prometheus is optional when a non-Prometheus source and sink are selected.

## Validation

```bash
sha256sum -c SHA256SUMS_v1.5.0-r1.txt
curl -fsS http://127.0.0.1:9110/health
curl -fsS http://127.0.0.1:9110/health/ready
curl -fsS http://127.0.0.1:9110/health/dependencies
curl -fsS http://127.0.0.1:9110/metrics | grep grafana_anomaly_build_info
```
