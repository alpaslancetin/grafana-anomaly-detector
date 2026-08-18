# Grafana Anomaly Detector Paket Ozeti - v1.4.0

## Paketler

- `grafana-anomaly-detector-plugin.zip`
  - Plugin ID: `alpas-anomalydetector-panel`
  - Plugin version: `1.4.0`
  - Minimum Grafana: `11.6.7`
- `grafana-anomaly-exporter-bundle-1.4.0.zip`
  - Exporter version: `1.4.0`
  - Minimum Python: `3.9`
  - Portable ve RHEL systemd kurulum dosyalari

## Hazir config dosyalari

Exporter paketi acildiginda artik eksik config nedeniyle durmaz. Paket sunlari icerir:

- `exporter/config.yml`: Prometheus kaynagi icin calisir baslangic konfigurasyonu.
- `exporter/examples/config.prometheus.yml`: PromQL sorgusu duzenlenerek kullanilacak sablon.
- `exporter/examples/config.influxdb.yml`: InfluxDB 2.x source ve sink sablonu.

InfluxDB sablonunda source bucket ile anomaly-score bucket farklidir. Bu ayrim exporter score kayitlarinin tekrar source veri olarak okunup geri-besleme dongusu olusturmasini engeller.

## Portable kullanim

```bash
unzip grafana-anomaly-exporter-bundle-1.4.0.zip
cd grafana-anomaly-exporter-bundle
vi exporter/config.yml
ANOMALY_PYTHON_BIN=$(command -v python3.9) ./portable-exporter.sh validate
ANOMALY_PYTHON_BIN=$(command -v python3.9) ./portable-exporter.sh start http://127.0.0.1:9090
```

InfluxDB icin:

```bash
cp exporter/examples/config.influxdb.yml exporter/config.yml
export ANOMALY_SOURCE_INFLUX_ORG='my-org'
export ANOMALY_SOURCE_INFLUX_TOKEN='source-token'
export ANOMALY_SINK_INFLUX_TOKEN='sink-token'
./portable-exporter.sh validate
./portable-exporter.sh start
```

## v1.4.0 duzeltmeleri

- Panel ve exporter legend/alias aktarimi hizalandi.
- Threshold kontrolu daha kullanisli slider yapisina tasindi.
- Range baslangicindaki false-positive degerler warm-up ile engellendi.
- Panel ve exporter gappy/flatline kalite siniflandirmasi hizalandi.
- Exporter scheduler islem suresini periyoda eklemek yerine periyottan dusuyor.
- `NaN`, `Infinity`, sifir ve negatif threshold degerleri reddediliyor.
- Demo source ve alert sorgulari kanonik rule'larla sinirlanarak score geri-besleme donguleri kapatildi.
- Portable `restart` akisi duzeltildi.
- Paket bos `dynamic_rules.json` ile dagitiliyor.

## Kontrol

```bash
sha256sum -c SHA256SUMS_v1.4.0.txt
curl -fsS http://127.0.0.1:9110/health
curl -fsS http://127.0.0.1:9110/metrics | grep 'version="1.4.0"'
```
