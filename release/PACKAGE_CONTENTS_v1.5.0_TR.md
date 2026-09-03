# Grafana Anomaly Detector Paket Ozeti - v1.5.0

## Paketler

- `grafana-anomaly-detector-plugin.zip`: Plugin ID `alpas-anomalydetector-panel`, surum `1.5.0`, minimum Grafana `11.6.7`.
- `grafana-anomaly-exporter-bundle-1.5.0.zip`: Exporter `1.5.0`, minimum Python `3.9`, portable ve RHEL kurulum dosyalari.

## Hazir konfigurasyonlar

- `exporter/config.yml`: Prometheus kaynagi icin calisir baslangic ornegi.
- `exporter/examples/config.prometheus.yml`: Prometheus source ve `/metrics` hedefi.
- `exporter/examples/config.influxdb.yml`: InfluxDB 2.x source ve ayri anomaly-score bucket hedefi.

Her kuralda `anomaly_direction` kullanilir:

- `high_mean`: ortalamanin uzerindeki sapmalar.
- `low_mean`: ortalamanin altindaki sapmalar.
- `high_or_low`: iki yonlu sapmalar.

`persistence_buckets: 3` ve `persistence_window: 4`, son dort degerlendirmeden en az ucunun karar kapilarini gecmesini ister. `data_quality_gate: true`, guvenilmez veri penceresinin alarm uretmesini engeller.

`recovery_threshold`, acik olay kapanirken kullanilan daha dusuk esiktir. `recovery_buckets`, kapanis icin gereken ardisik saglikli degerlendirme sayisini; `cooldown_buckets` ise kapanistan sonra yeniden acilmayi bekletecek degerlendirme sayisini belirler.

Prometheus yalniz Prometheus kaynak veya hedef secildiginde gerekir. InfluxDB, Loki, PostgreSQL, ClickHouse veya Elasticsearch hedefi kendi alert query'siyle dogrudan kullanilabilir.

## Baslangic

```bash
unzip grafana-anomaly-exporter-bundle-1.5.0.zip
cd grafana-anomaly-exporter-bundle
vi exporter/config.yml
ANOMALY_PYTHON_BIN=$(command -v python3.9) ./portable-exporter.sh validate
ANOMALY_PYTHON_BIN=$(command -v python3.9) ./portable-exporter.sh start http://127.0.0.1:9090
curl -fsS http://127.0.0.1:9110/api/capabilities
```

## Guvenlik

Uretimde `cors_allowed_origins`, `allowed_datasource_hosts` ve gerekirse `api_token_env` doldurulmalidir. Token ve parola degerleri YAML icine yazilmaz; yalniz environment variable adi tutulur.

## Kontrol

```bash
sha256sum -c SHA256SUMS_v1.5.0.txt
curl -fsS http://127.0.0.1:9110/health
curl -fsS http://127.0.0.1:9110/health/ready
curl -fsS http://127.0.0.1:9110/health/dependencies
curl -fsS http://127.0.0.1:9110/metrics | grep 'version="1.5.0"'
```
