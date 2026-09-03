# Exporter configuration examples

Choose one template, copy it to `config.yml`, edit its endpoints/query, then validate it before start.

```bash
cp examples/config.prometheus.yml config.yml
./portable-exporter.sh validate
./portable-exporter.sh start http://127.0.0.1:9090
```

For an InfluxDB 2.x source and sink:

```bash
cp examples/config.influxdb.yml config.yml
export ANOMALY_SOURCE_INFLUX_ORG='my-org'
export ANOMALY_SOURCE_INFLUX_TOKEN='source-token'
export ANOMALY_SINK_INFLUX_TOKEN='sink-token'
./portable-exporter.sh validate
./portable-exporter.sh start
```

Use different source and anomaly-score buckets. Reading the exporter's own score records back as source input creates a feedback loop and is intentionally not shown as a valid example.

## Detection direction

Set `anomaly_direction` per rule:

- `high_mean`: flags only values above the learned mean; recommended for latency, error rate, CPU and saturation.
- `low_mean`: flags only values below the learned mean; recommended for availability, success rate and minimum throughput.
- `high_or_low`: flags both directions; recommended when either increase or decrease is operationally relevant.

Use `persistence_buckets: 3` and `persistence_window: 4` to require three passing decisions among the latest four evaluated buckets. `data_quality_gate: true` blocks anomaly decisions when the input window is not trustworthy.

Use `recovery_threshold` below the opening `threshold` to add hysteresis. `recovery_buckets` requires consecutive healthy evaluations before closing an incident, while `cooldown_buckets` prevents immediate reopening. Alert on the target-specific `activeQuery` when lifecycle state, rather than a raw score threshold, should drive notifications.

Prometheus is optional when both the source and selected sink are non-Prometheus. The exporter still exposes its own `/metrics` endpoint for observability, but InfluxDB, Loki, PostgreSQL, ClickHouse, and Elasticsearch alert queries read their selected sink directly.
