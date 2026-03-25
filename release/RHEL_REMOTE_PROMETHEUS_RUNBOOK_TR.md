# RHEL Remote Prometheus Runbook

Bu dokuman, Grafana'nin zaten eristigi Prometheus datasource'unun ayri bir sunucuda oldugu senaryoyu hedefler.

Hedef:
- Grafana ve exporter RHEL sunucusunda calisir
- mevcut Prometheus ayri bir hostta kalir
- yeni Prometheus kurulmaz
- Grafana alerting yine ayni mevcut Prometheus datasource'u ile calisir

Kritik mantik:
1. Plugin Grafana hostuna kurulur
2. Exporter Grafana hostunda systemd servisi olarak calisir
3. Exporter, remote Prometheus API'sine baglanir
4. Remote Prometheus, exporter hostundaki `9110` endpointini scrape eder
5. Grafana Alerting mevcut Prometheus datasource'u ile `grafana_anomaly_rule_score` query'si kullanir

## 1. On kosullar
- Grafana RHEL hostta kurulu
- Prometheus ayri hostta kurulu ve Grafana tarafinda zaten datasource olarak tanimli
- RHEL hosttan Prometheus API'sine cikis var
- Prometheus hosttan exporter hostundaki `9110/tcp` portuna erisim var
- firewall / security group kurallari buna izin veriyor

## 2. Plugin kurulumu
```bash
cd /opt/grafana-anomaly-release/plugin-only
sudo ./install-rhel-plugin.sh
```

## 3. Exporter kurulumu
Remote Prometheus nedeniyle exporter localhost'a degil dis arayuze de bind etmelidir.

Ornek:
```bash
cd /opt/grafana-anomaly-release/alert-bundle
sudo EXPORTER_LISTEN_HOST=0.0.0.0 ./install-exporter-rhel.sh http://prometheus.example.internal:9090
```

Bu ne yapar:
- exporter remote Prometheus API'sini kullanir
- exporter `0.0.0.0:9110` uzerinden dinler
- remote Prometheus bu endpoint'i scrape edebilir

Dogrulama:
```bash
sudo systemctl status grafana-anomaly-exporter --no-pager
curl -s http://127.0.0.1:9110/metrics | sed -n '1,20p'
sudo cat /etc/grafana-anomaly-exporter/exporter.env
```

Beklenen env:
```bash
ANOMALY_PROMETHEUS_URL=http://prometheus.example.internal:9090
ANOMALY_LISTEN_HOST=0.0.0.0
ANOMALY_LISTEN_PORT=9110
```

## 4. Firewall ve network
Exporter remote taraftan scrape edilecekse RHEL hostta `9110/tcp` acik olmali.

Ornek firewalld:
```bash
sudo firewall-cmd --permanent --add-port=9110/tcp
sudo firewall-cmd --reload
```

Daha guvenli yol:
- portu sadece Prometheus hostundan gelecek trafige ac
- gerekiyorsa load balancer veya internal subnet ile sinirla

## 5. Remote Prometheus scrape ayari
Remote Prometheus hostunda bundle icindeki su snippet'i kullan:
- `prometheus-scrape-job.remote.yml.snippet`

Ornek:
```yaml
  - job_name: grafana-anomaly-exporter
    scrape_interval: 10s
    static_configs:
      - targets:
          - grafana-host.example.internal:9110
```

Prometheus config'i guncelledikten sonra reload et.

Dogrulama:
```bash
curl -s 'http://prometheus.example.internal:9090/api/v1/query?query=grafana_anomaly_exporter_up'
```

## 6. Grafana panel ve sync
Grafana'da mevcut Prometheus datasource'unu kullanarak anomaly paneli olustur.

Sonra:
- `Score feed mode = Auto sync` veya
- `Sync score feed`

Exporter tarafinda sync kontrolu:
```bash
curl -s http://127.0.0.1:9110/api/sync/rules
```

## 7. Alert rule
Grafana Alerting'de yine ayni mevcut Prometheus datasource'unu sec.

Query:
```promql
grafana_anomaly_rule_score{rule="..."}
```

Ornek:
```promql
grafana_anomaly_rule_score{rule="checkout_latency_panel"}
```

Condition:
- `WHEN QUERY IS ABOVE 75`
- `For = 2m`

## 8. Cok onemli limit
Su an exporter sadece Prometheus base URL ile dogrudan baglaniyor.
Yani bu surumde su ozellikler yok:
- custom auth header
- bearer token config
- custom TLS client cert config

Bu nedenle remote Prometheus senaryosu bugun en temiz sekilde su kosullarda calisir:
- ic agda erisilebilir Prometheus
- auth gerektirmeyen veya network ile korunmus endpoint

Eger sende auth/TLS zorunlu Prometheus varsa exporter'a bir sonraki adimda auth destegi eklememiz gerekir.

## 9. Onerilen production yolu
1. Plugin'i kur
2. Exporter'i `EXPORTER_LISTEN_HOST=0.0.0.0` ile kur
3. Remote Prometheus'a scrape job ekle
4. Grafana panelinde sync yap
5. Ayni mevcut Prometheus datasource'u ile alert yaz
