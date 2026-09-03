# Exporter, Source Reader ve Sink Kullanim Kilavuzu

> Tarihsel referans: Bu kilavuz v1.5.0 oncesi akisi anlatir. Guncel kurulum ve konfigurasyon icin [v1.5.0 kilavuzunu](../release/GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_v1.5.0_TR.md) kullanin.

Bu dokuman Grafana Anomaly Detector paneli ile exporter arasindaki score feed akisini, sink hedeflerini ve panel kapaliyken score'un nasil uretilmeye devam ettigini aciklar.

## Temel Kavramlar

Panel datasource/query:

- Anomaly score'un hangi veriden hesaplanacagini belirler.
- Ornek: Prometheus query, Loki unwrap query, PostgreSQL SQL query.

Score feed target:

- Hesaplanan score'un nereye yazilacagini belirler.
- Ornek: Prometheus metrics, Loki, InfluxDB, PostgreSQL, ClickHouse veya Elasticsearch.
- UI tek hedef secimine izin verir; ayni score snapshot'i birden fazla target'a cogaltilmaz.

Canonical score:

- Panelde gorunen `0-100` severity score'dur.
- Exporter tarafinda `normalized_score` olarak kaydedilir.
- Prometheus metric adi: `grafana_anomaly_score` ve rule seviyesinde `grafana_anomaly_rule_score`.
- Alert esikleri `score > 95` gibi bu `0-100` deger uzerinden kurulmalidir.

Raw score:

- Algoritmanin ham uzaklik skorudur.
- Prometheus metric adi: `grafana_anomaly_score_raw`.
- Debug/analiz icindir; alert esigi icin varsayilan ana deger degildir.

## Iki Calisma Modu

### 1. Panel-computed push mode

Bu modda panel acik ve veri alirken anomaly score'u panel hesaplar, sonra exporter'a yollar.

Akis:

```text
Grafana panel datasource -> panel canonical scoring -> /api/feed/scores -> exporter -> secilen sink
```

Bu modun ozelligi:

- UI'daki `Score feed target` ayari bu akisi kontrol eder.
- Panel acik veya refresh alirken calisir.
- Panelin gordugu score birebir exporter'a push edilir.
- Herhangi bir Grafana datasource'u numeric time-series donduruyorsa kullanilabilir.

Sinir:

- Panel hic acik degilse veya refresh almiyorsa yeni snapshot push edilmez.
- 7/24 alerting icin sadece bu moda guvenilmez.

### 2. Exporter parity/range mode

Bu mod panel kapaliyken 7/24 calismak icindir. Exporter panel yerine ayni datasource'tan ayni time-series'i range olarak okur ve ayni canonical scorer ile score'u kendisi uretir.

Akis:

```text
Exporter rule -> source reader -> canonical Python scoring -> Prometheus metrics + configured sinks
```

Bu modun ozelligi:

- Panel acik olmak zorunda degildir.
- Exporter kendi evaluation loop'u ile calisir.
- Aynı range, step, bucket ve trailing-window semantigi kullanildigi icin panelde gorulecek score ile exporter'in feed ettigi score ayni olur.
- Eski Prometheus instant-query modu korunur; `range_seconds` verilmezse legacy davranis devam eder.

## Panel Kapaliyken Score Nasil Feed Edilir?

Panel kapaliyken score feed icin exporter rule'u parity/range mode'da tanimlanir.

Gerekli rule alanlari:

```yaml
rules:
  - name: checkout_latency
    query: demo_latency_ms{service="checkout",environment="demo"}
    source_type: prometheus
    range_seconds: 3600
    step_seconds: 30
    bucket_span_seconds: 60
    algorithm: mad
    threshold: 2.4
    baseline_window: 12
    severity_preset: page_first
    aggregation: max
```

Bu ayarla exporter:

- Son 1 saati okur: `range_seconds: 3600`
- 30 saniyelik step ile veri ceker: `step_seconds: 30`
- Panel bucket davranisina denk olacak sekilde 60 saniyelik bucket uretir: `bucket_span_seconds: 60`
- Son noktayi onceki baseline bucket'larina gore skorlar.
- Skoru Prometheus metrics'e ve configured sink'lere yazar.

Kritik nokta:

- Sink writer score'u tekrar hesaplamaz.
- Sadece canonical scorer'in urettigi snapshot'i yazar.

## Panel ile Exporter Score'unun Ayni Olmasi Icin Ne Yapildi?

Skor paritesi icin su degisiklikler yapildi:

- Panel scoring tek canonical TypeScript module'e alindi: `grafana-anomaly-detector-panel/src/scoring.ts`
- Exporter tarafina ayni matematik ve pencere semantigini uygulayan Python canonical scorer eklendi: `prometheus-live-demo/anomaly_exporter/app/canonical.py`
- Exporter'a Prometheus `query_range` destegi eklendi.
- Source reader yapisi eklendi: Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse, Elasticsearch.
- Ayni input semantigi sabitlendi:
  - timestamp siralama
  - duplicate timestamp averaging
  - optional bucket aggregation
  - current point'i baseline'a dahil etmeyen trailing window
  - ayni `zscore`, `mad`, `ewma`, `seasonal`, `level_shift`
  - ayni severity normalization
  - ayni confidence ve data-quality kurallari
- Cold-start davranisi esitlendi: yeterli history yokken score `0`, confidence `low`, data quality `thin`.
- Golden parity test eklendi: `scripts/parity_check.py`

Kanıt komutu:

```bash
python3 scripts/parity_check.py
```

Beklenen kanit satiri:

```text
2026-04-10 12:00 UTC panel_score=10 fed_score=10
```

Bu test TypeScript panel scorer ile Python exporter scorer'i ayni fixture uzerinde calistirir ve her noktayi `1e-6` tolerans ile karsilastirir.

## Score Feed Target Davranisi

### Prometheus metrics

Panel score'u exporter'a gider ve exporter `/metrics` icinde gorunur.

Sink yazimi yapilmaz.

Prometheus sorgu:

```promql
grafana_anomaly_rule_score
```

### Tek hedef modeli

Panel score'u exporter'a gider ve sadece UI'da secilen hedefe yazilir. Bu model veri cogalmasini ve hangi alert query'nin kullanilacagi konusundaki karisikligi onler.

Secilebilir hedefler:

- Prometheus metrics
- Loki
- InfluxDB
- PostgreSQL
- ClickHouse
- Elasticsearch

Prometheus metrics secilirse score exporter `/metrics` icinde gorunur ve sink queue kullanilmaz. Diger hedefler secilirse score yalniz o sink queue'suna yazilir.

### Specific sink

Panel score'u sadece secilen sink'e yazilir.

Ornek:

```text
Panel datasource: Prometheus
Score feed target: InfluxDB
```

Davranis:

```text
Prometheus verisi -> panel score hesaplar -> exporter -> sadece InfluxDB sink'e yazar
```

Burada Prometheus target verilmesi sorun degildir. Prometheus okunan kaynak, InfluxDB yazilan hedeftir.

## Alert Query ve Synced Rules Butonlari

Paneldeki alert/query aksiyonlari score'un yazildigi hedefe gore query dondurur. Bu kisim artik Prometheus'a sabit degildir.

Beklenen davranis:

- `Prometheus metrics`: PromQL dondurur.
- `Loki`: LogQL dondurur.
- `InfluxDB`: Flux dondurur.
- `PostgreSQL`: SQL dondurur.
- `ClickHouse`: SQL dondurur.
- `Elasticsearch`: Elasticsearch query spec dondurur.

Ornek:

```text
Panel datasource: PostgreSQL
Score feed target: Elasticsearch
```

Bu durumda panel veriyi PostgreSQL datasource'tan okur, anomaly score'u hesaplar, score kaydini Elasticsearch sink'e yazar ve alert query butonu Elasticsearch'e uygun query spec dondurur. PromQL bu akista sadece Prometheus metrics hedefi secildiyse kullanilir.

UI dogrulama komutu:

```bash
node scripts/verify_multi_sink_panel_buttons.mjs
```

Bu test incident timeline tiklamasini, inspector/detail alanini, annotation aksiyonlarini, score feed sync butonlarini, synced rule query ciktisini ve alert export query/annotation alanlarini 6 demo datasource akisi icin kontrol eder.

## Loki Kardinalite Notu

Loki sink stream label seti dusuk kardinaliteli tutulmalidir. `job`, `env`, `rule` ve `record_type` gibi stabil alanlar label olabilir; `severity_label`, `is_anomaly`, `score`, `expected`, `deviation`, `timestamp` gibi degisen alanlar label yapilmamalidir.

Dogru unwrap query ornegi:

```logql
max_over_time({job="grafana_anomaly_exporter",record_type="rule",rule="checkout_latency"}
  | json normalized_score="normalized_score"
  | unwrap normalized_score [5m])
```

Kacinilacak pattern:

```logql
{job="grafana_anomaly_exporter"} | json | unwrap normalized_score
```

Bu pattern tum JSON alanlarini cikardigi ve cok genis stream seti uzerinden calistigi icin dashboard araligi buyuyunce Loki `maximum of series reached` hatasina neden olabilir.

## Sink Config Ornegi

```yaml
sinks:
  loki:
    enabled: true
    url: http://loki:3100
    labels: { job: grafana_anomaly_exporter, env: prod }
    batch_max_records: 500
    timeout_seconds: 5

  influxdb:
    enabled: true
    url: http://influxdb:8086
    version: 2
    org: anomaly
    bucket: anomaly
    token_env: ANOMALY_SINK_INFLUX_TOKEN
    measurement: grafana_anomaly
    timeout_seconds: 5

  postgresql:
    enabled: true
    dsn_env: ANOMALY_SINK_PG_DSN
    table: grafana_anomaly_scores
    auto_create_table: true
    timeout_seconds: 5

  clickhouse:
    enabled: true
    url: http://clickhouse:8123
    database: default
    table: grafana_anomaly_scores
    auto_create_table: true
    timeout_seconds: 5

  elasticsearch:
    enabled: true
    url: http://elasticsearch:9200
    index_prefix: grafana-anomaly
    timeout_seconds: 5
```

Sifre/token degerleri dogrudan config'e yazilmaz. Env uzerinden verilir.

Ornek env:

```bash
export ANOMALY_SINK_INFLUX_TOKEN='...'
export ANOMALY_SINK_PG_DSN='postgresql://user:pass@host:5432/db'
```

## Source Reader Config Ornekleri

### Prometheus source

```yaml
rules:
  - name: checkout_latency
    source_type: prometheus
    query: demo_latency_ms{service="checkout"}
    range_seconds: 3600
    step_seconds: 30
    bucket_span_seconds: 60
    algorithm: mad
    threshold: 2.4
    baseline_window: 12
    severity_preset: page_first
```

### Loki source

Loki log datasource numeric time-series icin `unwrap` gerektirir.

```yaml
rules:
  - name: loki_latency_score
    source_type: loki
    datasource_url: http://loki:3100
    query: max_over_time({job="app"} | json | unwrap latency_ms [1m])
    range_seconds: 3600
    step_seconds: 60
    bucket_span_seconds: 60
    algorithm: mad
    threshold: 2.8
    baseline_window: 12
```

### InfluxDB source

```yaml
rules:
  - name: influx_latency
    source_type: influxdb
    datasource_url: http://influxdb:8086
    query: >
      from(bucket: "app")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "latency" and r._field == "value")
    range_seconds: 3600
    step_seconds: 60
    bucket_span_seconds: 60
    algorithm: mad
```

Gerekli env:

```bash
export ANOMALY_SOURCE_INFLUX_ORG='anomaly'
export ANOMALY_SOURCE_INFLUX_TOKEN='...'
```

### PostgreSQL source

```yaml
rules:
  - name: pg_latency
    source_type: postgresql
    datasource_url: postgresql://user:pass@postgres:5432/app
    query: >
      SELECT ts AS time, latency_ms AS value
      FROM app_latency
      WHERE ts >= to_timestamp($__from) AND ts <= to_timestamp($__to)
      ORDER BY ts
    range_seconds: 3600
    step_seconds: 60
    bucket_span_seconds: 60
    algorithm: mad
```

PostgreSQL source icin opsiyonel `psycopg` veya `psycopg2` gerekir. Driver yoksa sadece bu source hata verir, exporter ayakta kalir.

### ClickHouse source

```yaml
rules:
  - name: ch_latency
    source_type: clickhouse
    datasource_url: http://clickhouse:8123
    query: >
      SELECT ts AS time, latency_ms AS value
      FROM default.app_latency
      WHERE ts >= toDateTime($__from) AND ts <= toDateTime($__to)
      ORDER BY ts
    range_seconds: 3600
    step_seconds: 60
    bucket_span_seconds: 60
    algorithm: mad
```

### Elasticsearch source

```yaml
rules:
  - name: es_latency
    source_type: elasticsearch
    datasource_url: http://elasticsearch:9200/app-latency-*/_search
    query: service:checkout
    range_seconds: 3600
    step_seconds: 60
    bucket_span_seconds: 60
    algorithm: mad
```

Elasticsearch source dokumanlarinda `_source` icinde `@timestamp` ve `value` veya `score` numerik alaninin bulunmasi beklenir.

## Exporter Health ve Sink Health

Exporter:

```bash
curl -fsS http://127.0.0.1:9110/health
```

Metrics:

```bash
curl -fsS http://127.0.0.1:9110/metrics
```

Sink health metricleri:

```promql
grafana_anomaly_sink_up
grafana_anomaly_sink_records_written_total
grafana_anomaly_sink_errors_total
grafana_anomaly_sink_last_error
grafana_anomaly_sink_queue_depth
grafana_anomaly_sink_queue_capacity
grafana_anomaly_sink_dropped_batches_total
grafana_anomaly_sink_last_drop_timestamp_seconds
```

Backpressure davranisi:

- `Prometheus metrics` target'i sink queue kullanmaz; skor exporter `/metrics` icinde tutulur.
- `Loki`, `InfluxDB`, `PostgreSQL`, `ClickHouse` veya `Elasticsearch` hedeflerinde batch once secilen sink queue'ya alinir.
- Queue dolarsa exporter sessiz basarili donmez; `/api/feed/scores` HTTP `429` dondurur ve drop metrikleri artar.
- Varsayilan queue kapasitesi `128` batch'tir; normal multi-sink publish burst'leri icin yeterlidir.
- PostgreSQL sink yazma hatasi aldiginda stale connection'i kapatir; backend tekrar gelince exporter restart gerektirmeden yeniden baglanir.
- Exporter log seviyesi `ANOMALY_LOG_LEVEL` ile ayarlanabilir. Varsayilan `INFO`; sink error ve sink recovered olaylari loglanir.

Rule score:

```promql
grafana_anomaly_rule_score
```

Series score:

```promql
grafana_anomaly_score
```

## Sink Read-back Sorgulari

### Loki

```logql
{job="grafana_anomaly_exporter",record_type="rule"} | json
```

Time-series:

```logql
max_over_time({job="grafana_anomaly_exporter",record_type="series",rule="checkout_latency"} | json normalized_score="normalized_score" | unwrap normalized_score [1m])
```

### InfluxDB

```flux
from(bucket: "anomaly")
  |> range(start: -30m)
  |> filter(fn: (r) => r._measurement == "grafana_anomaly" and r._field == "score")
```

### PostgreSQL

```sql
SELECT ts AS time, score, rule, record_type
FROM grafana_anomaly_scores
WHERE ts > now() - interval '30 minutes'
ORDER BY ts DESC
LIMIT 50;
```

### ClickHouse

```sql
SELECT ts, score, rule, record_type
FROM default.grafana_anomaly_scores
WHERE ts > now() - INTERVAL 30 MINUTE
ORDER BY ts DESC
LIMIT 50
```

### Elasticsearch

```text
record_type:rule
```

Metric panel icin:

- metric: `max(normalized_score)`
- bucket: `date histogram @timestamp`

## Lokal Demo Komutlari

```bash
cd /mnt/c/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/multi-sink-demo
docker compose up -d --build
./scripts/health-check.sh
```

Grafana:

```text
http://127.0.0.1:3000
admin / admin
```

Demo portlari:

```text
Prometheus    http://127.0.0.1:9091
Loki          http://127.0.0.1:3100
InfluxDB      http://127.0.0.1:8086
PostgreSQL    127.0.0.1:5432
ClickHouse    http://127.0.0.1:8123
Elasticsearch http://127.0.0.1:9200
Exporter      http://127.0.0.1:9110
```

## Pratik Karar Tablosu

Panel acik ve manuel test yapmak istiyorsan:

- `Score feed mode = manual` veya `auto`
- `Score feed target = istedigin sink`
- Panel refresh aldikca score push edilir.

Panel kapali ama 7/24 alerting istiyorsan:

- Exporter rule'a `range_seconds`, `step_seconds`, `bucket_span_seconds` ekle.
- `source_type` ve gerekirse `datasource_url` ayarla.
- Alert'i `grafana_anomaly_rule_score` veya sink datasource sorgusu uzerinden kur.

Sadece tek sink'e yazmak istiyorsan:

- UI'da ilgili sink'i sec.
- Ornek: `InfluxDB`, `Elasticsearch`, `ClickHouse`.

Prometheus sadece okuma kaynagi olsun ama score InfluxDB'ye yazilsin istiyorsan:

- Panel query Prometheus kalir.
- `Score feed target = InfluxDB` secilir.
- Veri Prometheus'tan okunur, score InfluxDB'ye yazilir.
