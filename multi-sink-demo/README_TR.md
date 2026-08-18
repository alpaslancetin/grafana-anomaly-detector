# Grafana Anomaly Multi-Sink Demo

Bu demo, anomaly exporter 1.3.0 ile uretilen skorlarin Prometheus exposition'a ek olarak Loki, InfluxDB, PostgreSQL, ClickHouse ve Elasticsearch backend'lerine yazildigini gosterir.

Detayli exporter/source/sink kullanim kilavuzu:

- `../docs/EXPORTER_SINK_KULLANIM_KILAVUZU_TR.md`

## Hizli Baslangic

```bash
cd multi-sink-demo
docker compose up -d --build
./scripts/test_grafana_datasources.sh
./scripts/publish_plugin_score_feed_matrix.sh
./scripts/run_readback_checks.sh
# veya tamamini tek komutla:
./scripts/health-check.sh
```

Grafana:

- URL: `http://127.0.0.1:3000`
- User: `admin`
- Password: `admin`

Not: WSL uzerinde baska Grafana calisiyorsa `localhost:3000` farkli instance'a gidebilir. Bu demo icin net adres `http://127.0.0.1:3000`.

Servis portlari:

- Prometheus: `http://127.0.0.1:9091`
- Exporter: `http://127.0.0.1:9110/metrics`
- Loki: `http://127.0.0.1:3100`
- InfluxDB: `http://127.0.0.1:8086`
- PostgreSQL: `localhost:5432`
- ClickHouse HTTP: `http://127.0.0.1:8123`
- Elasticsearch: `http://127.0.0.1:9200`

## Dogrulama

Grafana datasource baglantilari:

```bash
./scripts/test_grafana_datasources.sh
```

Exporter sagligi:

```bash
curl -fsS http://localhost:9110/health
curl -fsS http://localhost:9110/metrics | grep grafana_anomaly_sink_up
```

Skor paritesi:

```bash
python3 ../scripts/parity_check.py
```

Bu test panel scorer'i ile exporter canonical scorer'ini ayni fixture uzerinde karsilastirir. Ozel kanit satiri:

```text
2026-04-10 12:00 UTC panel_score=10 fed_score=10
```

Loki:

```bash
curl -fsSG http://localhost:3100/loki/api/v1/query \
  --data-urlencode 'query={job="grafana_anomaly_exporter"}'
```

Loki time-series unwrap testi:

```logql
max_over_time({job="grafana_anomaly_exporter",record_type="series"} | json normalized_score="normalized_score" | unwrap normalized_score [1m])
```

`./scripts/run_readback_checks.sh` bu sorguyu `query_range` ile calistirir ve `resultType: matrix` + numerik `values` geldigini assert eder.

InfluxDB:

```bash
curl -fsS 'http://localhost:8086/api/v2/query?org=anomaly' \
  -H 'Authorization: Token anomaly-demo-token' \
  -H 'Content-Type: application/json' \
  --data '{"query":"from(bucket: \"anomaly\") |> range(start: -30m) |> filter(fn: (r) => r._measurement == \"grafana_anomaly\") |> count()"}'
```

PostgreSQL:

```bash
docker compose exec -T postgres psql -U anomaly -d anomaly -c 'SELECT count(*) FROM grafana_anomaly_scores;'
```

ClickHouse:

```bash
curl -fsS 'http://localhost:8123/?query=SELECT%20count()%20FROM%20default.grafana_anomaly_scores'
```

Elasticsearch:

```bash
curl -fsS 'http://localhost:9200/grafana-anomaly-*/_count'
```

## Grafana UI Uzerinden Test

Grafana'ya gir:

- URL: `http://localhost:3000`
- Kesin adres: `http://127.0.0.1:3000`
- User: `admin`
- Password: `admin`

Dashboard kontrolu:

- `Dashboards > Multi Sink Demo > Grafana Anomaly Multi Sink Feed`
- Panellerde Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse ve Elasticsearch feed kayitlari gorunmeli.
- `Dashboards > Multi Sink Demo > Grafana Anomaly Plugin Source Matrix`
- Bu dashboard plugin panelinin farkli datasource'lardan okudugu anomaly skorlarini secilen hedef sink'e yazma akisini test etmek icindir.
- Ornek paneller: Prometheus -> Prometheus, Loki -> Loki, InfluxDB -> InfluxDB, PostgreSQL -> Elasticsearch, ClickHouse -> ClickHouse, Elasticsearch -> PostgreSQL.
- Her panelde `Score feed target` opsiyonu degistirilerek hedef `prometheus`, `loki`, `influxdb`, `postgresql`, `clickhouse` veya `elasticsearch` secilebilir.

Datasource health kontrolu:

- `Connections > Data sources`
- Her datasource icin `Save & test` veya `Test` butonu `OK` donmeli.

Plugin-computed score feed matrix testi:

```bash
./scripts/publish_plugin_score_feed_matrix.sh
./scripts/run_readback_checks.sh
```

Bu test 6 kaynak datasource tipi ile 6 hedef sink kombinasyonunu dener:

- Kaynaklar: `prometheus`, `loki`, `influxdb`, `postgresql`, `clickhouse`, `elasticsearch`
- Hedefler: `prometheus`, `loki`, `influxdb`, `postgresql`, `clickhouse`, `elasticsearch`
- Toplam: 36 plugin-computed score feed kaydi

Basarili calistiginda exporter `/metrics` icinde `feed_source="plugin"` etiketli `matrix_*` rule'lari gorunur ve her hedef backend icin read-back kontrolu OK doner.

Panel butonlari ve hedefe gore alert query dogrulamasi:

```bash
cd ..
node scripts/verify_multi_sink_panel_buttons.mjs
```

Bu test `Grafana Anomaly Plugin Source Matrix` dashboard'undaki 6 panelde su kontrolleri yapar:

- Incident timeline tiklamasi ve detay/inspector gorunurlugu
- `Copy annotation JSON` ve `Create annotation` aksiyonlari
- `Sync score feed` ve `Show synced rules`
- Alert query dilinin hedef store'a uygunlugu
- Alert export icindeki query language, alert query ve annotation alanlari

Beklenen query dili eslesmeleri:

- Prometheus -> Prometheus metrics: PromQL
- Loki -> Loki sink: LogQL
- InfluxDB -> InfluxDB sink: Flux
- PostgreSQL -> Elasticsearch sink: Elasticsearch query spec
- ClickHouse -> ClickHouse sink: SQL
- Elasticsearch -> PostgreSQL sink: SQL

## Skor Paritesi ve Kaynak Okuma

Canonical feed score `0-100` araligindaki panel `severityScore`/exporter `normalized_score` degeridir. Alert rule'larinda `score > 95` gibi esikler bu deger uzerinden calisir. Ham algoritma skoru ayrica `raw_score` ve `grafana_anomaly_score_raw` olarak korunur.

Exporter iki modda calisir:

- Eski uyumlu Prometheus modu: `range_seconds` verilmezse mevcut `instant_query` yolu korunur.
- Parite modu: `range_seconds`, `step_seconds` ve `bucket_span_seconds` verilirse exporter ayni zaman araligini okuyup paneldeki canonical scorer ile skoru yeniden uretir.

Desteklenen source reader tipleri:

- `prometheus`
- `loki`
- `influxdb`
- `postgresql`
- `clickhouse`
- `elasticsearch`

Source URL/DSN config icinde `datasource_url` ile veya env fallback ile verilebilir:

- `ANOMALY_SOURCE_PROMETHEUS_URL`
- `ANOMALY_SOURCE_LOKI_URL`
- `ANOMALY_SOURCE_INFLUXDB_URL`
- `ANOMALY_SOURCE_POSTGRESQL_URL` veya `ANOMALY_SOURCE_PG_DSN`
- `ANOMALY_SOURCE_CLICKHOUSE_URL`
- `ANOMALY_SOURCE_ELASTICSEARCH_URL`

Explore uzerinden manuel sorgular:

Prometheus:

```promql
grafana_anomaly_rule_score
```

Loki:

```logql
{job="grafana_anomaly_exporter", record_type="rule"} | json
```

InfluxDB:

```flux
from(bucket: "anomaly")
  |> range(start: -30m)
  |> filter(fn: (r) => r._measurement == "grafana_anomaly" and r._field == "score" and r.record_type == "rule")
```

PostgreSQL:

```sql
SELECT ts AS time, score, rule
FROM grafana_anomaly_scores
WHERE $__timeFilter(ts) AND record_type = 'rule'
ORDER BY ts DESC
LIMIT 50;
```

ClickHouse:

```sql
SELECT ts, score, rule
FROM default.grafana_anomaly_scores
WHERE $__timeFilter(ts) AND record_type = 'rule'
ORDER BY ts DESC
LIMIT 50
```

Elasticsearch:

```text
record_type:rule
```

Elasticsearch Explore'da metric olarak `max(normalized_score)`, bucket olarak `date histogram @timestamp` secilebilir. Dashboard'daki `Elasticsearch anomaly feed` paneli de ayni ayarla provision edilir.

## WSL2 Notlari

Elasticsearch icin WSL2 uzerinde `vm.max_map_count=262144` gerekebilir:

```bash
sudo sysctl -w vm.max_map_count=262144
```

Kalici yapmak icin `/etc/sysctl.conf` icine sunu ekleyebilirsin:

```conf
vm.max_map_count=262144
```

Demo Elasticsearch ayarlari:

- `ES_JAVA_OPTS=-Xms512m -Xmx512m`
- `xpack.security.enabled=false`
- single-node mode

InfluxDB v2 init bilgileri:

- org: `anomaly`
- bucket: `anomaly`
- token: `anomaly-demo-token`

PostgreSQL demo bilgileri:

- database: `anomaly`
- user: `anomaly`
- password: `anomaly-password`

## Grafana Dashboard

`Multi Sink Demo / Grafana Anomaly Multi Sink Feed` dashboard'u provision edilir. Dashboard Prometheus uzerinden sink health metriklerini, Loki log feed'ini, PostgreSQL/InfluxDB/ClickHouse/Elasticsearch uzerindeki skor kayitlarini gosterir.

## Grafana Alert Rule Ornekleri

`multi-sink-demo/grafana/provisioning/alerting/multi-sink-alerts.yml` dosyasi datasource basina ornek alert rule provision eder:

- Prometheus: exporter metric `grafana_anomaly_rule_score`
- Loki: LogQL `unwrap normalized_score`
- InfluxDB: Flux query, `score` field
- PostgreSQL: SQL query, `record_type = 'rule'`
- ClickHouse: SQL query, `record_type = 'rule'`
- Elasticsearch: metrics query, `max(normalized_score)` + date histogram
- Watchdog: Prometheus `min(grafana_anomaly_sink_up) < 1`

Alarm guvenligi:

- Score alarmlari `for: 3m`, `noDataState: Alerting`, `execErrState: Error` ile gelir.
- Watchdog `for: 2m`, `noDataState: Alerting`, `execErrState: Error` ile gelir.
- Bu ayar veri akisi durdugunda veya sorgu hata verdiginde alarmi yesil birakmamak icindir.

Grafana UI kontrolu:

- `Alerting > Alert rules`
- folder: `Multi Sink Demo`
- group: `Anomaly Multi Sink Alert Examples`

Not: Bu dosyalar Grafana file provisioning ile gelir; UI'dan editlenmeleri beklenmez. Query'leri canli denemek icin rule'u duplicate edip editable kopya uzerinden calisabilirsin.

## Temizlik

```bash
docker compose down -v
```
