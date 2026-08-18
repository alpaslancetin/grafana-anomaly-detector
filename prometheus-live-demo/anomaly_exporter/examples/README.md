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
