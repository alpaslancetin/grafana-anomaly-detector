# Release packages

This folder contains the current `Grafana Anomaly Detector v1.4.0` release set.

## Artifacts

- `grafana-anomaly-detector-plugin.zip`: Grafana panel plugin.
- `grafana-anomaly-exporter-bundle-1.4.0.zip`: portable and RHEL exporter bundle.
- `GITHUB_RELEASE_NOTES_v1.4.0.md`: GitHub release description.
- `GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_TR.md`: end-to-end Turkish guide.
- `PACKAGE_CONTENTS_v1.4.0_TR.md`: package contents and operational notes.
- `SHA256SUMS_v1.4.0.txt`: release integrity checksums.

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
unzip grafana-anomaly-exporter-bundle-1.4.0.zip
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

## Validation

```bash
sha256sum -c SHA256SUMS_v1.4.0.txt
curl -fsS http://127.0.0.1:9110/health
curl -fsS http://127.0.0.1:9110/metrics | grep grafana_anomaly_build_info
```
