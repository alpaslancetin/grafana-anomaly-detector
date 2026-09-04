# Grafana Anomaly Detector v1.5.0 - Uctan Uca Kurulum, Upgrade ve Operasyon Kilavuzu

Guncel dagitim **1.5.0-r1** paket revizyonudur. Plugin/exporter uygulama surumu
**1.5.0** kalir. Komutlardaki ZIP adlari r1 paketlerine aittir. Orijinal v1.5.0
release/tag degistirilmemistir. Paketlerin SHA-256 listesi ve her ZIP icindeki
`BUILD_INFO.json`, dogru build'i ayirt etmenizi saglar.

`/anomalyalarm` LB akisi icin [proxy kilavuzuna](../docs/ANOMALYALARM_PROXY_TR.md)
bakiniz; exporter ZIP'inde ayni dokuman `ANOMALYALARM_PROXY_TR.md` adiyla bulunur.
RHEL installer yeniden calistirildiginda mevcut `config.yml` ve `exporter.env`
korunur. Yeni YAML sablonlari `CONFIG_ROOT/examples` altina kopyalanir; mevcut
ayarlarinizi manuel karsilastirin. Installer custom INSTALL_ROOT/CONFIG_ROOT veya
kullanici override'i kullaniyorsaniz systemd unit'in sabit yollarini da elle
uyarlamaniz gerekir. Uninstall script'i config/state dahil verileri siler;
upgrade icin uninstall kullanmayin, once yedek alin.

Bu dokuman `Grafana Anomaly Detector v1.5.0` paketlerini sifirdan kurmak, mevcut kurulumu upgrade etmek, exporter'i ayaga kaldirmak, score feed akisini anlamak, alert olusturmak ve sorun gidermek icin hazirlandi.

Okuyan kisi bu dokumanla su isleri tek basina yapabilmelidir:

- Grafana panel plugin paketini kurmak veya upgrade etmek
- Exporter paketini portable veya RHEL systemd olarak calistirmak
- Prometheus scrape ayarini yapmak
- Panel uzerinden anomaly detection ve score feed ayarlarini yapmak
- Prometheus metrics veya tekil sink hedefi secmek
- Loki, InfluxDB, PostgreSQL, ClickHouse, Elasticsearch sink/source mantigini anlamak
- Panel kapaliyken 7/24 score feed icin exporter range/parity mode kullanmak
- Grafana Alerting tarafinda dogru query, threshold, no-data ve error politikasini kurmak
- Kurulum sonrasi test ve troubleshooting adimlarini uygulamak

---

## 1. Surum ve Paket Ozeti

| Bilesen | Deger |
| --- | --- |
| Plugin version | `1.5.0` |
| Exporter version | `1.5.0` |
| Plugin ID | `alpas-anomalydetector-panel` |
| Minimum Grafana | `11.6.7` |
| Test edilen Grafana | `11.6.7`, `12.4.0` |
| Minimum exporter Python | `3.9` |
| Onerilen exporter Python | `3.9.x` |
| Varsayilan exporter portu | `9110` |
| Varsayilan panel endpoint | `http://127.0.0.1:9110` |

Paket klasorunde bulunmasi gereken dosyalar:

```text
grafana-anomaly-detector-plugin-1.5.0-r1.zip
grafana-anomaly-exporter-bundle-1.5.0-r1.zip
GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_TR.md
PACKAGE_CONTENTS_v1.5.0_TR.md
README.md
GITHUB_RELEASE_NOTES_v1.5.0.md
SHA256SUMS_v1.5.0-r1.txt
screenshots/
```

---

## 2. Mimari Akis

```mermaid
flowchart LR
    A["Grafana dashboard paneli"] --> B["Anomaly Detector plugin"]
    B --> C["Panel canonical scoring"]
    C --> D["Incident inspector"]
    C --> E["Score feed sync"]
    E --> F["Anomaly exporter :9110"]
    F --> G["Prometheus /metrics"]
    F --> H["Secilen tek sink"]
    H --> I["Loki / InfluxDB / PostgreSQL / ClickHouse / Elasticsearch"]
    G --> J["Grafana Alerting"]
    I --> J
```

Neden iki parca var?

- Plugin, kullanicinin Grafana panelinde gordugu time-series'i analiz eder ve anomalileri aciklar.
- Exporter, plugin'in urettigi score snapshot'larini alert-ready metric veya sink kaydina cevirir.
- Grafana Alerting, panel UI calismadan da query calistirabilmelidir. Bu nedenle kalici alarm icin exporter metrikleri veya sink kayitlari kullanilir.

---

## 3. Temel Kavramlar

### 3.1 Raw detection score

Raw score algoritmanin ham uzaklik skorudur. Ornek: mevcut deger beklenen baseline'dan kac robust spread uzakta?

Kullanim amaci:

- Debug
- Incident analizi
- "Bu anomali neden guclu?" sorusuna teknik cevap

Yanlis kullanim:

- Alert threshold icin ana deger olarak kullanmak.
- Raw score ile `score > 95` gibi 0-100 mantigi kurmak.

### 3.2 Alert score (0-100)

Alert score plugin ve exporter tarafinda normalize edilen `0-100` severity skorudur.

Kullanim amaci:

- Alert threshold
- E-posta/notification subject severity
- Sinklerde `normalized_score`
- Prometheus'ta `grafana_anomaly_rule_score`

Oneri:

```text
warning/watchlist: score > 75
major: score > 90
critical: score > 95
```

### 3.3 Source datasource ve score feed target farki

Source datasource:

- Panelin veriyi nereden okudugudur.
- Ornek: Prometheus query, PostgreSQL SQL query, Loki unwrap query.

Score feed target:

- Hesaplanan anomaly score'un nereye yazilacagidir.
- Ornek: Prometheus metrics, Loki, InfluxDB, PostgreSQL, ClickHouse, Elasticsearch.

Ornek:

```text
Panel datasource: PostgreSQL
Score feed target: Elasticsearch
```

Sonuc:

```text
PostgreSQL verisi okunur -> plugin score hesaplar -> exporter'a gonderir -> score Elasticsearch sink'e yazilir
```

### 3.4 Neden `All configured sinks` yok?

v1.5.0 son tasarimda kullanici tek hedef secer. Bu karar kasitlidir.

Neden:

- Ayni score'un birden fazla backend'e gereksiz cogaltilmasini onler.
- Alert query butonunun hangi query dilini uretmesi gerektigi netlesir.
- Operasyonel troubleshooting daha kolay olur.

### 3.5 Anomaly direction: High mean / Low mean

v1.5.0, Elastic ML'deki yon mantigina benzer bicimde karar yonunu acik bir konfigurasyon yapar. Panel ve exporter ayni degeri kullanir.

| Panel secimi | YAML degeri | Davranis | Tipik metrik |
| --- | --- | --- | --- |
| High mean | `high_mean` | Yalniz beklenen ortalamanin ustundeki sapmalar alarm olabilir | latency, error rate, CPU, memory, saturation |
| Low mean | `low_mean` | Yalniz beklenen ortalamanin altindaki sapmalar alarm olabilir | availability, success rate, minimum traffic, connection count |
| High or low | `high_or_low` | Iki yondeki sapmalar alarm olabilir | cift yonlu trafik ve business volume |

Recommended mod, metric preset ve seri semantiginden guvenli bir varsayilan secer. Advanced modda kullanici `Anomaly direction` alanini degistirerek bunu override eder. Yanlis yondeki kuvvetli bir sapma debug icin raw score'da gorulebilir, ancak alert score `0` olur ve alarm beslemez.

Ornek:

```yaml
algorithm: mad
anomaly_direction: high_mean
threshold: 4.0
minimum_absolute_deviation: 20
minimum_relative_deviation: 0.10
minimum_activity: 1
persistence_buckets: 3
persistence_window: 4
recovery_threshold: 3.0
recovery_buckets: 2
cooldown_buckets: 2
data_quality_gate: true
```

- `minimum_absolute_deviation`: Beklenen deger ile mevcut deger arasindaki en az mutlak fark.
- `minimum_relative_deviation`: Beklenene gore en az oransal fark; `0.10` yuzde 10 demektir.
- `minimum_activity`: Cok dusuk veya anlamsiz aktivite seviyelerinde karar uretilmesini engeller.
- `persistence_buckets/window`: Son `window` bucket icinde en az `buckets` kararinin gecmesini ister; `3/4` tek noktalik sivrilmeleri eler.
- `recovery_threshold`: Olay acildiktan sonra kapanis icin kullanilan daha dusuk esiktir. Acilis esiginden buyuk olamaz.
- `recovery_buckets`: Olay kapanmadan once gereken ardisik saglikli bucket sayisidir.
- `cooldown_buckets`: Kapanan olayin tekrar acilabilmesi icin beklenecek bucket sayisidir.
- `data_quality_gate`: Gappy, yetersiz veya guvenilmez pencerenin anomaly alarmi uretmesini engeller.

Karar sirasi `normal -> candidate -> open -> recovering -> cooldown -> normal` seklindedir. Alarm icin ham skoru tekrar esiklemek yerine Score feed kartinda verilen target-specific `activeQuery` kullanilirsa panel ve exporter lifecycle karari birebir korunur.

---

## 4. Gorsel Referanslar

Dokumanla beraber `screenshots/` klasoru gelir.

| Ekran | Dosya | Neden onemli? |
| --- | --- | --- |
| Single metric detector | `screenshots/grafana-single-metric-premium.png` | Panelin beklenen band, severity ve incident anlatimini gosterir |
| Multi metric detector | `screenshots/grafana-multi-metric-premium.png` | Birden fazla seriyle incident okuma deneyimini gosterir |
| Score feed export | `screenshots/score-feed-export.png` | Export/query/action bloklarini gosterir |
| Final QA inspector | `screenshots/final-qa-score-labels-inspector.png` | `Raw detection score` ve `Alert score (0-100)` ayriminin runtime'da gorundugunu kanitlar |

Markdown gorunumunde:

![Single metric](screenshots/grafana-single-metric-premium.png)

![Score feed](screenshots/score-feed-export.png)

![Final QA inspector](screenshots/final-qa-score-labels-inspector.png)

---

## 5. Sifirdan Plugin Kurulumu

### 5.1 On kosullar

Grafana:

- `11.6.7` veya daha yeni
- `12.4.0` ile test edildi

Grafana plugin path ornekleri:

```text
RHEL default: /var/lib/grafana/plugins
Custom kurulum: /data/grafana/plugins
Docker demo: /var/lib/grafana/plugins
```

### 5.2 Backup al

RHEL/custom kurulum icin:

```bash
mkdir -p /data/grafana/backup/plugin_$(date +%Y%m%d_%H%M%S)

cp -a /data/grafana/plugins/alpas-anomalydetector-panel \
  /data/grafana/backup/plugin_$(date +%Y%m%d_%H%M%S)/ 2>/dev/null || true
```

Neden:

- Plugin zip yanlis acilirsa geri donus kolay olur.
- Grafana upgrade sirasinda eski plugin dosyalarini karsilastirmak mumkun olur.

### 5.3 Plugin zip'i ac

Paket:

```text
grafana-anomaly-detector-plugin-1.5.0-r1.zip
```

Custom `/data/grafana` ornegi:

```bash
mkdir -p /data/grafana/plugins/alpas-anomalydetector-panel
rm -rf /data/grafana/plugins/alpas-anomalydetector-panel/*

unzip grafana-anomaly-detector-plugin-1.5.0-r1.zip \
  -d /data/grafana/plugins/alpas-anomalydetector-panel
```

Dogru dosya yapisi:

```text
/data/grafana/plugins/alpas-anomalydetector-panel/plugin.json
/data/grafana/plugins/alpas-anomalydetector-panel/module.js
/data/grafana/plugins/alpas-anomalydetector-panel/img/logo.svg
```

Yanlis dosya yapisi:

```text
/data/grafana/plugins/alpas-anomalydetector-panel/grafana-anomaly-detector-plugin/plugin.json
```

Bu durumda Grafana plugin'i bulamayabilir. Bir seviye fazla klasor olusmamalidir.

### 5.4 grafana.ini ayari

`defaults.ini` degistirilmemelidir. Custom config dosyasinda ayar yapilmalidir.

Ornek:

```ini
[plugins]
allow_loading_unsigned_plugins = alpas-anomalydetector-panel
preinstall_disabled = true
preinstall_auto_update = false
```

Neden:

- Plugin imzali marketplace paketi degilse Grafana unsigned plugin'i bloklar.
- ID degismemelidir: `alpas-anomalydetector-panel`

Yanlis olursa:

- UI'da panel tipi gorunmez.
- Grafana logunda unsigned plugin veya plugin load hatasi gorulur.

### 5.5 Grafana restart

Systemd:

```bash
systemctl restart grafana-server
systemctl status grafana-server --no-pager
```

Portable/custom process:

```bash
ps -ef | grep grafana
# mevcut process yonetim sekline gore restart
```

Test:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

Beklenen:

```json
{"database":"ok","version":"12.4.0"}
```

### 5.6 UI kontrol

1. Grafana UI acilir.
2. Dashboard > Add panel.
3. Visualization seciminde `Anomaly Detector` gorulmelidir.
4. Panelde numeric time-series query calistirilir.

---

## 6. Exporter Kurulumu - Portable Mod

Portable mod test, POC ve custom process yonetimi icin en hizli yoldur.

### 6.1 Paketi ac

```bash
cd /data
unzip grafana-anomaly-exporter-bundle-1.5.0-r1.zip
cd grafana-anomaly-exporter-bundle
```

Beklenen yapi:

```text
portable-exporter.sh
grafana-anomaly-exporter.env.example
prometheus-scrape-job.yml.snippet
exporter/
exporter/main.py
exporter/app/server.py
exporter/config.yml
```

### 6.2 Python kontrolu

```bash
python3.9 --version
```

Beklenen:

```text
Python 3.9.x
```

Python path'i net vermek icin:

```bash
export ANOMALY_PYTHON_BIN=$(command -v python3.9)
```

### 6.3 Config sec, duzenle ve dogrula

Paket `exporter/config.yml` ile hazir gelir. Prometheus sablonunu yeniden baz almak icin:

```bash
cp exporter/examples/config.prometheus.yml exporter/config.yml
vi exporter/config.yml
./portable-exporter.sh validate
```

En az `global.prometheus_url`, rule `query`, `name` ve operasyonel `labels` alanlari ortama gore duzenlenmelidir.

InfluxDB 2.x source ve sink kullanilacaksa:

```bash
cp exporter/examples/config.influxdb.yml exporter/config.yml
vi exporter/config.yml
export ANOMALY_SOURCE_INFLUX_ORG='my-org'
export ANOMALY_SOURCE_INFLUX_TOKEN='source-token'
export ANOMALY_SINK_INFLUX_TOKEN='sink-token'
./portable-exporter.sh validate
```

InfluxDB source bucket ile anomaly score sink bucket ayni olmamalidir. Aksi halde score kayitlari tekrar source olarak okunup geri-besleme dongusu olusturabilir.

Beklenen dogrulama:

```text
Config OK: rules=1 sinks=0
```

InfluxDB sablonunda `sinks=1` gorulur.

### 6.4 Exporter'i baslat

Prometheus ayni hostta ve `8090` portundaysa:

```bash
ANOMALY_PYTHON_BIN=$(command -v python3.9) \
ANOMALY_LISTEN_HOST=0.0.0.0 \
ANOMALY_LISTEN_PORT=9110 \
./portable-exporter.sh start http://127.0.0.1:8090
```

Foreground test:

```bash
ANOMALY_PYTHON_BIN=$(command -v python3.9) \
ANOMALY_LISTEN_HOST=0.0.0.0 \
ANOMALY_LISTEN_PORT=9110 \
./portable-exporter.sh foreground http://127.0.0.1:8090
```

Status:

```bash
./portable-exporter.sh status
```

Health:

```bash
curl -fsS http://127.0.0.1:9110/health
curl -fsS http://127.0.0.1:9110/health/live
curl -fsS http://127.0.0.1:9110/health/ready
curl -fsS http://127.0.0.1:9110/health/dependencies
curl -fsS http://127.0.0.1:9110/api/capabilities
```

Metrics:

```bash
curl -fsS http://127.0.0.1:9110/metrics | head
```

Stop:

```bash
./portable-exporter.sh stop
```

### 6.5 Port hatasi

Hata:

```text
OSError: [Errno 98] Address already in use
```

Neden:

- `9110` portunda eski exporter veya baska process vardir.

Kontrol:

```bash
ss -ltnp | grep 9110
ps -ef | grep anomaly
```

Cozum:

```bash
./portable-exporter.sh stop
# veya farkli port:
ANOMALY_LISTEN_PORT=9111 ./portable-exporter.sh start http://127.0.0.1:8090
```

---

## 7. Exporter Kurulumu - RHEL Systemd

Production icin systemd onerilir.

### 7.1 Dosyalari yerlestir

```bash
cd /data
unzip grafana-anomaly-exporter-bundle-1.5.0-r1.zip
cd grafana-anomaly-exporter-bundle
```

### 7.2 Env dosyasini hazirla

```bash
cp grafana-anomaly-exporter.env.example /data/grafana-anomaly-exporter.env
vi /data/grafana-anomaly-exporter.env
```

Ornek:

```bash
ANOMALY_PYTHON_BIN=/usr/bin/python3.9
ANOMALY_CONFIG_PATH=/data/grafana-anomaly-exporter/exporter/config.yml
ANOMALY_LISTEN_HOST=0.0.0.0
ANOMALY_LISTEN_PORT=9110
ANOMALY_LOG_LEVEL=INFO
```

### 7.3 Install script

```bash
chmod +x install-exporter-rhel.sh
./install-exporter-rhel.sh http://127.0.0.1:8090
```

Sonra:

```bash
systemctl daemon-reload
systemctl enable grafana-anomaly-exporter
systemctl start grafana-anomaly-exporter
systemctl status grafana-anomaly-exporter --no-pager
```

Log:

```bash
journalctl -u grafana-anomaly-exporter -f
```

### 7.4 Prometheus scrape ekle

Prometheus config ornegi:

```yaml
scrape_configs:
  - job_name: grafana-anomaly-exporter
    static_configs:
      - targets:
          - 127.0.0.1:9110
```

Prometheus config reload:

```bash
curl -X POST http://127.0.0.1:8090/-/reload
```

Reload endpoint kapaliysa:

```bash
systemctl restart prometheus
```

Kontrol:

```promql
up{job="grafana-anomaly-exporter"}
grafana_anomaly_build_info
```

---

## 8. Exporter Config Aciklamasi

Ana config:

```yaml
global:
  prometheus_url: http://prometheus:9090
  evaluation_interval_seconds: 5
  request_timeout_seconds: 10
  listen_host: 0.0.0.0
  listen_port: 9110
  config_reload_interval_seconds: 10
  base_path: /anomalyalarm
  cors_allowed_origins:
    - https://grafana.example.com
  allowed_datasource_hosts:
    - prometheus
    - influxdb
  max_dynamic_rules: 5000
  max_rules_per_panel: 50
  max_query_length: 16384
  max_feed_series: 1000
  runtime_scope_ttl_seconds: 3600
  pushed_feed_ttl_seconds: 300
  api_rate_limit_per_minute: 120
```

| Alan | Ne ise yarar? | Yanlis olursa ne olur? |
| --- | --- | --- |
| `prometheus_url` | Legacy Prometheus query ve default source icin Prometheus adresi | Exporter query alamaz, rule score uretilemez |
| `evaluation_interval_seconds` | Exporter rule'larinin kac saniyede bir calisacagi | Cok dusukse CPU/query yuk artar, cok yuksekse alarm gecikir |
| `request_timeout_seconds` | Datasource istek timeout'u | Cok dusukse agir query fail olur |
| `listen_host` | Exporter'in hangi interface'te dinleyecegi | `127.0.0.1` olursa uzak Grafana/browser erisemeyebilir |
| `listen_port` | Exporter portu | Port doluysa exporter acilmaz |
| `config_reload_interval_seconds` | Config dosyasi degisikligini ne siklikta okuyacagi | Cok uzun olursa yeni rule gec uygulanir |
| `base_path` | Root API'ye ek olarak reverse-proxy prefix alias'i | Proxy prefix'i ile exporter route'u eslesmezse sync 404 olur |
| `cors_allowed_origins` | Browser POST yapabilecek kesin Grafana origin listesi | Bos/yanlis origin browser tarafinda CORS ile reddedilir |
| `allowed_datasource_hosts` | Dynamic source query icin izinli host listesi | Tanimsiz host reddedilir; SSRF riski azalir |
| `max_dynamic_rules` | Registry toplam dynamic rule kotasi | Sinirsiz scope/cardinality buyumesini onler |
| `max_rules_per_panel` | Tek panel sync istegindeki target kotasi | Hatalı veya kotu niyetli target patlamasini reddeder |
| `max_query_length` | Kaydedilebilecek query uzunlugu | Asiri buyuk sorgu/state girdisini reddeder |
| `max_feed_series` | Tek score feed POST icindeki seri kotasi | Bellek ve sink kuyrugu baskisini sinirlar |
| `runtime_scope_ttl_seconds` | Runtime scope gorulmezse temizlenme suresi | Eski variable kombinasyonlarinin kalici buyumesini onler |
| `pushed_feed_ttl_seconds` | Browser preview snapshot yasam suresi | Panel kapaninca eski preview'in sonsuza kadar kullanilmasini onler |
| `api_rate_limit_per_minute` | Client basina dakikalik yazma istegi | Auto-sync firtinasi ve brute-force yukunu sinirlar |

API schema surumu `3` tur. `/api/capabilities` cevabinda `decisionLifecycle`, `ruleLifecycle` ve request limitleri gorulmelidir.

Prometheus yalniz Prometheus source veya `Prometheus metrics` score target secildiginde zorunludur. InfluxDB source -> InfluxDB sink gibi bir akista alarm Flux ile dogrudan InfluxDB'den okunabilir; Prometheus kurulumu gerekmez. Exporter'in `/metrics` endpointi operasyonel gozlem icin yine kullanilabilir.

---

## 9. Panel Ayarlari

Panel options icinde onemli alanlar:

| Alan | Onerilen | Etki |
| --- | --- | --- |
| `Setup mode` | Recommended | Algoritma ve severity preset secimini kolaylastirir |
| `Metric type` | Auto veya metrik ailesi | Latency/error/traffic icin uygun defaultlari secer |
| `Detection mode` | Single metric | Her seri ayri skorlanir |
| `Score feed mode` | Auto sync veya Manual sync | Score'un exporter'a nasil gidecegini belirler |
| `Score feed target` | Prometheus metrics veya tek sink | Score'un nereye yazilacagini belirler |
| `Exporter endpoint` | `http://<exporter-host>:9110` | Browser/panel bu adrese POST atar |
| `Bucket span` | Auto | Yogun serilerde paneli rahatlatir |
| `Show anomaly focus band` | Default disabled | Gorsel sadelik icin kapali gelir |

### 9.1 Score feed mode

`Auto sync`:

- Panel veri aldikca exporter'a otomatik POST yapar.
- Operasyonel dashboardlarda kullanislidir.

`Manual sync`:

- Kullanici `Sync score feed` butonuna basinca gonderir.
- Test ve kontrollu publish icin iyidir.

`Off`:

- Score feed kapatilir.
- Sadece gorsel anomaly paneli olarak kullanilir.

### 9.2 Exporter endpoint neden browser tarafindan erisilebilir olmali?

Plugin panel kodu browser icinde calisir. `Sync score feed` butonu exporter'a browser'dan POST yapar.

Bu nedenle:

- Grafana server'in exporter'a erismesi tek basina yetmez.
- Kullanicinin browser'i da `http://<exporter-host>:9110` adresine erisebilmelidir.

Yanlis olursa:

- Panel gorunur ama `Sync score feed` hata verir.
- Browser devtools network'te `Failed to fetch` gorulur.

Cozum:

- Exporter'i kullanicinin erisebildigi network interface'te dinlet.
- Firewall'da `9110` ac.
- HTTPS Grafana + HTTP exporter policy sorunu varsa reverse proxy ile HTTPS endpoint ver.

---

## 10. Sink Konfigurasyonlari

### 10.1 Loki sink

```yaml
sinks:
  loki:
    enabled: true
    url: http://loki:3100
    labels: { job: grafana_anomaly_exporter, env: prod }
    batch_max_records: 500
    timeout_seconds: 5
```

Neden:

- Score kayitlarini log/event gibi tutmak icin uygundur.
- LogQL ile alert/query uretilebilir.

Dikkat:

- Dinamik alanlari label yapma.
- `severity_label`, `score`, `timestamp` JSON icinde kalmali.

Dogru LogQL:

```logql
max_over_time({job="grafana_anomaly_exporter",record_type="rule",rule="checkout_latency"}
  | json normalized_score="normalized_score"
  | unwrap normalized_score [5m])
```

### 10.2 InfluxDB sink

```yaml
sinks:
  influxdb:
    enabled: true
    url: http://influxdb:8086
    version: 2
    org: anomaly
    bucket: anomaly
    token_env: ANOMALY_SINK_INFLUX_TOKEN
    measurement: grafana_anomaly
```

Env:

```bash
export ANOMALY_SINK_INFLUX_TOKEN='token'
```

Flux alert query:

```flux
from(bucket: "anomaly")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "grafana_anomaly" and r._field == "score")
  |> filter(fn: (r) => r.record_type == "rule" and r.rule == "checkout_latency")
  |> aggregateWindow(every: 1m, fn: max, createEmpty: false)
```

### 10.3 PostgreSQL sink

```yaml
sinks:
  postgresql:
    enabled: true
    dsn_env: ANOMALY_SINK_PG_DSN
    table: grafana_anomaly_scores
    auto_create_table: true
```

Env:

```bash
export ANOMALY_SINK_PG_DSN='postgresql://user:pass@host:5432/db'
```

SQL:

```sql
SELECT ts AS time, score, rule, record_type
FROM grafana_anomaly_scores
WHERE ts > now() - interval '30 minutes'
ORDER BY ts DESC
LIMIT 50;
```

Not:

- PostgreSQL backend restart olursa exporter stale connection'i kapatip yeniden baglanir.
- Bu davranis KD-11 reconnect riskini kapatmak icin eklendi.

### 10.4 ClickHouse sink

```yaml
sinks:
  clickhouse:
    enabled: true
    url: http://clickhouse:8123
    database: default
    table: grafana_anomaly_scores
    auto_create_table: true
```

SQL:

```sql
SELECT ts, score, rule, record_type
FROM default.grafana_anomaly_scores
WHERE ts > now() - INTERVAL 30 MINUTE
ORDER BY ts DESC
LIMIT 50
```

### 10.5 Elasticsearch sink

```yaml
sinks:
  elasticsearch:
    enabled: true
    url: http://elasticsearch:9200
    index_prefix: grafana-anomaly
```

Sonuc index:

```text
grafana-anomaly-YYYY.MM.DD
```

Kullanim:

- Kibana/Grafana Elasticsearch datasource ile query.
- Alert query butonu Elasticsearch query spec uretir.

---

## 11. Source Reader Konfigurasyonlari

Panel acikken push mode yeterlidir. Panel kapaliyken 7/24 score icin exporter range/parity rule gerekir.

### 11.1 Ortak rule alanlari

```yaml
rules:
  - name: checkout_latency
    source_type: prometheus
    query: demo_latency_ms{service="checkout"}
    range_seconds: 3600
    step_seconds: 30
    bucket_span_seconds: 60
    algorithm: mad
    threshold: 4.0
    baseline_window: 12
    severity_preset: page_first
    aggregation: max
```

| Alan | Ne ise yarar? |
| --- | --- |
| `name` | Rule ve metric label adidir |
| `source_type` | Datasource tipidir |
| `query` | Source datasource query'sidir |
| `range_seconds` | Kac saniyelik history okunur |
| `step_seconds` | Range query step araligi |
| `bucket_span_seconds` | Panel bucket davranisina denk aggregation |
| `algorithm` | `zscore`, `mad`, `ewma`, `seasonal`, `level_shift` |
| `threshold` | Raw detector threshold; defaultlar metrik tipine gore secilir |
| `severity_preset` | Raw score'u 0-100 alert score'a map eder |
| `aggregation` | Birden fazla seri rule score'una nasil indirgenir |

### 11.2 Prometheus source

```yaml
source_type: prometheus
query: demo_latency_ms{service="checkout"}
```

`global.prometheus_url` kullanilir.

### 11.3 Loki source

```yaml
source_type: loki
datasource_url: http://loki:3100
query: max_over_time({job="app"} | json | unwrap latency_ms [1m])
```

### 11.4 InfluxDB source

```yaml
source_type: influxdb
datasource_url: http://influxdb:8086
query: >
  from(bucket: "app")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "latency" and r._field == "value")
```

Env:

```bash
export ANOMALY_SOURCE_INFLUX_ORG='anomaly'
export ANOMALY_SOURCE_INFLUX_TOKEN='token'
```

### 11.5 PostgreSQL source

```yaml
source_type: postgresql
datasource_url: postgresql://user:pass@postgres:5432/app
query: >
  SELECT ts AS time, latency_ms AS value
  FROM app_latency
  WHERE ts >= to_timestamp($__from) AND ts <= to_timestamp($__to)
  ORDER BY ts
```

### 11.6 ClickHouse source

```yaml
source_type: clickhouse
datasource_url: http://clickhouse:8123
query: >
  SELECT ts AS time, latency_ms AS value
  FROM default.app_latency
  WHERE ts >= toDateTime($__from) AND ts <= toDateTime($__to)
  ORDER BY ts
```

### 11.7 Elasticsearch source

```yaml
source_type: elasticsearch
datasource_url: http://elasticsearch:9200/app-latency-*/_search
query: service:checkout
```

---

## 12. Alert Kurulumu

### 12.1 Dogru score secimi

Alert icin ana deger:

```text
Alert score (0-100)
```

Prometheus metric:

```promql
grafana_anomaly_rule_score
```

Raw debug metric:

```promql
grafana_anomaly_score_raw
```

Raw score ile alert kurmak normal akista onerilmez.

### 12.2 Onerilen Grafana Alerting ayarlari

| Alan | Onerilen |
| --- | --- |
| Query | Target'a uygun query |
| Condition | `IS ABOVE 90` veya `IS ABOVE 95` |
| Evaluation interval | `3m` |
| For | `10m` |
| No data | `Alerting` |
| Execution error | `Error` |

Neden `for=10m`?

- Kisa spike'lar false-positive olmasin.
- 3 dakikalik evaluation ile yaklasik 4 basarili degerlendirme sonrasi firing olur.

Neden `NoData=Alerting`?

- Veri akisi kesildiginde alarm yesil kalmamali.
- Monitoring sisteminde sessiz korluk en buyuk risktir.

### 12.3 Prometheus alert query

```promql
max_over_time(grafana_anomaly_rule_score{rule="checkout_latency"}[5m])
```

### 12.4 Loki alert query

```logql
max_over_time({job="grafana_anomaly_exporter",record_type="rule",rule="checkout_latency"}
  | json normalized_score="normalized_score"
  | unwrap normalized_score [5m])
```

### 12.5 InfluxDB alert query

```flux
from(bucket: "anomaly")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "grafana_anomaly" and r._field == "score")
  |> filter(fn: (r) => r.record_type == "rule" and r.rule == "checkout_latency")
  |> aggregateWindow(every: 1m, fn: max, createEmpty: false)
```

### 12.6 PostgreSQL alert query

```sql
SELECT
  $__timeGroup(ts, '1m') AS time,
  max(score) AS score
FROM grafana_anomaly_scores
WHERE $__timeFilter(ts)
  AND record_type = 'rule'
  AND rule = 'checkout_latency'
GROUP BY 1
ORDER BY 1
```

### 12.7 Watchdog alarm

Exporter ve sink icin watchdog kurulmalidir.

Prometheus:

```promql
up{job="grafana-anomaly-exporter"} == 0
```

Sink:

```promql
grafana_anomaly_sink_up == 0
```

Drop/backpressure:

```promql
increase(grafana_anomaly_sink_dropped_batches_total[10m]) > 0
```

---

## 13. Upgrade Adimlari

### 13.1 Upgrade oncesi backup

```bash
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p /data/grafana/backup/anomaly_upgrade_$TS

cp -a /data/grafana/plugins/alpas-anomalydetector-panel \
  /data/grafana/backup/anomaly_upgrade_$TS/plugin 2>/dev/null || true

cp -a /data/grafana-anomaly-exporter-bundle \
  /data/grafana/backup/anomaly_upgrade_$TS/exporter 2>/dev/null || true

cp -a /data/grafana/conf/custom.ini \
  /data/grafana/backup/anomaly_upgrade_$TS/custom.ini 2>/dev/null || true
```

### 13.2 Plugin upgrade

```bash
systemctl stop grafana-server

rm -rf /data/grafana/plugins/alpas-anomalydetector-panel/*
unzip grafana-anomaly-detector-plugin-1.5.0-r1.zip \
  -d /data/grafana/plugins/alpas-anomalydetector-panel

systemctl start grafana-server
```

Kontrol:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

UI:

- Browser hard refresh
- Panel render
- Inspector'da `Raw detection score` ve `Alert score (0-100)` ayrimi

### 13.3 Exporter upgrade

Portable:

```bash
cd /data/grafana-anomaly-exporter-bundle
./portable-exporter.sh stop

cd /data
mv grafana-anomaly-exporter-bundle grafana-anomaly-exporter-bundle.old.$TS
unzip grafana-anomaly-exporter-bundle-1.5.0-r1.zip

# eski config/state gerekiyorsa geri tasinir
cp grafana-anomaly-exporter-bundle.old.$TS/exporter/config.yml \
  grafana-anomaly-exporter-bundle/exporter/config.yml

cp -a grafana-anomaly-exporter-bundle.old.$TS/exporter/state \
  grafana-anomaly-exporter-bundle/exporter/

cd grafana-anomaly-exporter-bundle
./portable-exporter.sh start http://127.0.0.1:8090
```

Systemd:

```bash
systemctl stop grafana-anomaly-exporter
# bundle dosyalari yenilenir, config/state korunur
systemctl start grafana-anomaly-exporter
journalctl -u grafana-anomaly-exporter -n 100 --no-pager
```

Kontrol:

```bash
curl -fsS http://127.0.0.1:9110/health
curl -fsS http://127.0.0.1:9110/metrics | grep grafana_anomaly_build_info
```

Beklenen:

```text
grafana_anomaly_build_info{version="1.5.0"} 1
```

---

## 14. Test ve Kabul Kontrolleri

### 14.1 Plugin dosya kontrolu

```bash
ls -l /data/grafana/plugins/alpas-anomalydetector-panel
grep -n '"version": "1.5.0"' /data/grafana/plugins/alpas-anomalydetector-panel/plugin.json
```

### 14.2 Exporter health

```bash
curl -fsS http://127.0.0.1:9110/health
curl -fsS http://127.0.0.1:9110/metrics | grep grafana_anomaly_build_info
```

### 14.3 Prometheus scrape

```promql
up{job="grafana-anomaly-exporter"}
grafana_anomaly_rule_score
grafana_anomaly_sink_up
```

### 14.4 Panel sync testi

Panelde:

1. `Score feed mode = Manual sync`
2. `Score feed target = Prometheus metrics`
3. `Exporter endpoint = http://<exporter-host>:9110`
4. `Sync score feed` tiklanir

Beklenen:

- Status `Synced`
- Target karti dogru hedefi gosterir
- Feed series sayisi > 0
- Alert query hedefe uygun dilde uretilir

### 14.5 Runtime QA komutlari

Repo gelistirme ortaminda:

```bash
cd grafana-anomaly-detector-panel
npm run typecheck
npm run test:ci
npm run build
npm run lint
```

E2E:

```bash
GRAFANA_URL=http://127.0.0.1:3000 \
GRAFANA_ADMIN_USER='<GRAFANA_ADMIN_USER>' \
GRAFANA_ADMIN_PASSWORD='<GRAFANA_ADMIN_PASSWORD>' \
npx playwright test tests/panel.spec.ts -g "renders the source-matrix Prometheus panel"
```

Beklenen:

```text
2 passed
```

---

## 15. Troubleshooting

### 15.1 Panel gorunmuyor

Kontrol:

```bash
grep allow_loading_unsigned_plugins /data/grafana/conf/custom.ini
ls /data/grafana/plugins/alpas-anomalydetector-panel/plugin.json
```

Cozum:

- Plugin ID allowlist'e eklenir.
- Plugin zip dogru klasore acilir.
- Grafana restart edilir.

### 15.2 Sync score feed `Failed to fetch`

Nedenler:

- Browser exporter'a erisemiyor.
- `ANOMALY_LISTEN_HOST=127.0.0.1` sadece server localinde dinliyor.
- Firewall `9110` kapali.
- HTTPS Grafana sayfasindan HTTP exporter endpoint'i browser policy ile engelleniyor.

Cozum:

```bash
ANOMALY_LISTEN_HOST=0.0.0.0
ANOMALY_LISTEN_PORT=9110
```

Gerekirse HTTPS reverse proxy:

```text
https://grafana-domain/anomaly-exporter -> http://127.0.0.1:9110
```

Panel endpoint:

```text
https://grafana-domain/anomaly-exporter
```

### 15.3 `/api/feed/rules` bos geliyor

```json
{"rules":[]}
```

Bu her zaman hata degildir.

Neden:

- Henuz panelden sync yapilmadi.
- Exporter config'te kalici rule tanimli degil.
- Dynamic rules state bos.

Cozum:

- Panelde `Sync score feed` calistir.
- Veya `exporter/config.yml` icine `rules:` ekle.

### 15.4 `Address already in use`

```text
OSError: [Errno 98] Address already in use
```

Cozum:

```bash
ss -ltnp | grep 9110
./portable-exporter.sh stop
```

### 15.5 Alert firing olmuyor

Kontrol:

```promql
max_over_time(grafana_anomaly_rule_score{rule="RULE_NAME"}[5m])
```

Sorular:

- Score gercekten threshold ustunde mi?
- Alert score 0-100 mu, raw score mu?
- Rule `for=10m` bekliyor mu?
- NoData/Error ayari sessizce OK mu?
- Prometheus exporter'i scrape ediyor mu?

### 15.6 Loki series limit hatasi

Kotu query:

```logql
{job="grafana_anomaly_exporter"} | json | unwrap normalized_score
```

Iyi query:

```logql
max_over_time({job="grafana_anomaly_exporter",record_type="rule",rule="checkout_latency"}
  | json normalized_score="normalized_score"
  | unwrap normalized_score [5m])
```

---

## 16. Production Checklist

Kurulum oncesi:

- [ ] Grafana version `>=11.6.7`
- [ ] Plugin backup alindi
- [ ] Exporter config/state backup alindi
- [ ] Python `3.9.x` mevcut
- [ ] Exporter portu belirlendi
- [ ] Firewall/reverse proxy planlandi

Kurulum sonrasi:

- [ ] Grafana health OK
- [ ] Plugin UI'da gorunuyor
- [ ] Exporter `/health` OK
- [ ] Prometheus `up{job="grafana-anomaly-exporter"} == 1`
- [ ] `grafana_anomaly_build_info{version="1.5.0"} 1`
- [ ] Panel `Sync score feed` basarili
- [ ] Alert query dogru hedef dilinde
- [ ] Alert rule `NoData=Alerting`, `ExecErr=Error`
- [ ] Watchdog alarm kuruldu
- [ ] Sink varsa `grafana_anomaly_sink_up == 1`

---

## 17. Kisa Karar Rehberi

Sadece anomaly panel istiyorsan:

```text
Plugin kur, exporter kurma.
```

Panelden alert-ready Prometheus metric istiyorsan:

```text
Plugin + exporter + Prometheus scrape.
Score feed target = Prometheus metrics.
```

Score'u Loki/Influx/PostgreSQL/ClickHouse/Elasticsearch'e yazmak istiyorsan:

```text
Exporter sink config ac.
Panelde tek target sec.
Alert query butonu secilen target'a uygun query verir.
```

Panel kapaliyken 7/24 score uretmek istiyorsan:

```text
Exporter config.yml icinde range/parity rule tanimla.
range_seconds + step_seconds + bucket_span_seconds kullan.
```

False-positive azaltmak istiyorsan:

```text
Alert score threshold'u 90/95 seviyesinde tut.
for=10m kullan.
NoData ve Error durumlarini OK yapma.
```

---

## 18. Son QA Kaniti

Bu paket setinde son kontrollu QA sonucunda:

- Plugin production bundle temiz build ile uretildi.
- `Raw detection score` ve `Alert score (0-100)` ayrimi runtime'da dogrulandi.
- Annotation tag duplicate riski test ile kapatildi.
- Alert provisioning tarafinda `noDataState=Alerting`, `execErrState=Error`, `for=3m` dogrulandi.
- Sink watchdog rule aktif dogrulandi.
- Hedef e2e test basarili:

```text
2 passed
```

Son karar:

```text
Plugin + exporter v1.5.0 paket seti kontrollu kurulum ve upgrade icin hazirdir.
```
