# RHEL Kurulum Runbook

Bu runbook, Grafana Anomaly Detector plugin'ini ve alert-ready anomaly exporter'i Red Hat tabanli bir Linux sunucusunda uctan uca kurmak icindir.

Bu akisin hedefi:
- plugin'i Grafana'ya kurmak
- exporter'i native systemd servisi olarak calistirmak
- Prometheus'un exporter metric'lerini scrape etmesini saglamak
- Grafana Alerting tarafinda `grafana_anomaly_rule_score` ile alarm yazabilmek

Not:
- Paketler Ubuntu uzerinde systemd ile gercek akista test edildi.
- RHEL 8 ve RHEL 9 icin tasarlanmistir.
- SELinux policy ve servis adlari ortama gore degisebilir.

## 1. On kosullar

Sunucuda sunlar hazir olmali:
- Grafana kurulu ve calisiyor olmali
- Prometheus kurulu ve calisiyor olmali
- root veya sudo yetkili shell erisimi olmali
- `python3`, `curl`, `unzip` komutlari kurulu olmali

Gerekirse:
```bash
sudo dnf install -y python3 curl unzip
```

## 2. Paketleri sunucuya kopyala

Su iki zip dosyasini sunucuya kopyala:
- `alpas-anomalydetector-panel-plugin-only.zip`
- `alpas-anomaly-alert-bundle.zip`

Ornek hedef dizin:
```bash
sudo mkdir -p /opt/grafana-anomaly-release
sudo chown $USER:$USER /opt/grafana-anomaly-release
cd /opt/grafana-anomaly-release
```

Zip dosyalarini actiktan sonra bu yapiyi goreceksin:
- `plugin-only/`
- `alert-bundle/`

## 3. Plugin kurulumu

Plugin kurulum klasorune gir:
```bash
cd /opt/grafana-anomaly-release/plugin-only
```

Native RHEL plugin installer'i calistir:
```bash
sudo ./install-rhel-plugin.sh
```

Bu script su isleri yapar:
- plugin'i `/var/lib/grafana/plugins/alpas-anomalydetector-panel` altina kopyalar
- `/etc/grafana/grafana.ini` icinde `allow_loading_unsigned_plugins = alpas-anomalydetector-panel` ayarini ekler veya gunceller
- `grafana-server` servisini yeniden baslatir

Dogrulama:
```bash
sudo systemctl status grafana-server --no-pager
sudo grep -n 'allow_loading_unsigned_plugins' /etc/grafana/grafana.ini
sudo ls -la /var/lib/grafana/plugins/alpas-anomalydetector-panel
```

## 4. Exporter kurulumu

Exporter klasorune gir:
```bash
cd /opt/grafana-anomaly-release/alert-bundle
```

Eger Prometheus ayni hostta `9090` portunda calisiyorsa:
```bash
sudo ./install-exporter-rhel.sh http://127.0.0.1:9090
```

Eger Prometheus farkli hostta ise ornek:
```bash
sudo ./install-exporter-rhel.sh http://prometheus.example.internal:9090
```

Bu script su isleri yapar:
- exporter kodunu `/opt/grafana-anomaly-exporter` altina kurar
- config dosyalarini `/etc/grafana-anomaly-exporter` altina yazar
- state dizinini `/var/lib/grafana-anomaly-exporter` altina kurar
- log dizinini `/var/log/grafana-anomaly-exporter` altina kurar
- `grafana-anomaly-exporter.service` systemd servisini enable ve start eder

Dogrulama:
```bash
sudo systemctl status grafana-anomaly-exporter --no-pager
curl -s http://127.0.0.1:9110/metrics | sed -n '1,20p'
sudo cat /etc/grafana-anomaly-exporter/exporter.env
```

Beklenen temel metric'ler:
- `grafana_anomaly_exporter_up`
- `grafana_anomaly_last_scrape_success`
- `grafana_anomaly_dynamic_rule_count`

## 5. Prometheus scrape aktif etme

### Local Prometheus ayni hostta ise
```bash
cd /opt/grafana-anomaly-release/alert-bundle
sudo ./enable-local-prometheus-scrape-rhel.sh
```

Bu script local `/etc/prometheus/prometheus.yml` dosyasina su scrape job'i ekler:
```yaml
  - job_name: grafana-anomaly-exporter
    scrape_interval: 10s
    static_configs:
      - targets:
          - 127.0.0.1:9110
```

Dogrulama:
```bash
sudo grep -n 'grafana-anomaly-exporter' /etc/prometheus/prometheus.yml
curl -s http://127.0.0.1:9090/-/ready
```

### Prometheus remote hostta ise
Bu durumda local script yerine bundle icindeki snippet'i Prometheus hostuna uygula:
```bash
cat /opt/grafana-anomaly-release/alert-bundle/prometheus-scrape-job.yml.snippet
```

Sonra remote Prometheus config'ine exporter target'ini ekle. Exporter hostu firewall arkasindaysa `9110/tcp` erisimi acik olmali.

## 6. Grafana tarafinda ilk panel

Grafana'da:
1. Yeni dashboard veya mevcut dashboard ac
2. Datasource olarak Prometheus sec
3. Metric query yaz
4. Visualization olarak `Anomaly Detector` sec
5. `Setup mode = Recommended` ile basla
6. `Score feed mode = Auto sync` veya `Manual sync` sec

Ornek PromQL:
```promql
rate(http_requests_total[5m])
```
veya latency icin:
```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, job))
```

## 7. Score feed sync

Paneli kaydedip `Auto sync` kullanabilir veya panel icinden `Sync score feed` butonuna basabilirsin.

Exporter tarafinda sync sonucu gormek icin:
```bash
curl -s http://127.0.0.1:9110/api/sync/rules
```

Beklenen cikti icinde sunlar gorunur:
- `rule`
- `query`
- `alertQuery`
- `perSeriesQuery`

En onemli alan genelde su olur:
```promql
grafana_anomaly_rule_score{rule="..."}
```

## 8. Ilk alert rule

Grafana icinde:
1. `Alerting -> Alert rules -> New alert rule`
2. Datasource olarak ilgili Prometheus'u sec
3. Query alanina panelin verdigi rule-level query'yi yaz
4. Condition olarak esik ekle

Ornek query:
```promql
grafana_anomaly_rule_score{rule="checkout_latency_panel"}
```

Ornek condition:
- `WHEN QUERY IS ABOVE 75`
- `For = 2m`

Pratik esik onerileri:
- `> 60` warning
- `> 75` high
- `> 90` critical

## 9. Operasyon komutlari

Plugin dogrulama:
```bash
sudo systemctl status grafana-server --no-pager
sudo journalctl -u grafana-server -n 50 --no-pager
```

Exporter dogrulama:
```bash
sudo systemctl status grafana-anomaly-exporter --no-pager
sudo journalctl -u grafana-anomaly-exporter -n 100 --no-pager
curl -s http://127.0.0.1:9110/metrics | grep grafana_anomaly_rule_score | head
```

Prometheus dogrulama:
```bash
curl -s 'http://127.0.0.1:9090/api/v1/query?query=grafana_anomaly_rule_score' | jq .
```

## 10. Guncelleme akisi

Plugin guncelleme:
```bash
cd /opt/grafana-anomaly-release/plugin-only
sudo ./install-rhel-plugin.sh
```

Exporter guncelleme:
```bash
cd /opt/grafana-anomaly-release/alert-bundle
sudo ./install-exporter-rhel.sh http://127.0.0.1:9090
```

Scriptler mevcut dosyalari yeniden kopyalayip servisleri gunceller.

## 11. Kaldirma

Plugin kaldirma:
```bash
cd /opt/grafana-anomaly-release/plugin-only
sudo ./uninstall-rhel-plugin.sh
```

Exporter kaldirma:
```bash
cd /opt/grafana-anomaly-release/alert-bundle
sudo ./uninstall-exporter-rhel.sh
```

Not:
- Prometheus icine eklenen scrape job'i script otomatik temizlemez
- gerekirse `prometheus.yml` icinden `grafana-anomaly-exporter` job'ini manuel kaldir

## 12. Troubleshooting

### Plugin Grafana'da gorunmuyor
Kontrol et:
```bash
sudo grep -n 'allow_loading_unsigned_plugins' /etc/grafana/grafana.ini
sudo journalctl -u grafana-server -n 100 --no-pager | grep -i plugin
```

### Exporter servisi acilmiyor
Kontrol et:
```bash
sudo journalctl -u grafana-anomaly-exporter -n 100 --no-pager
sudo cat /etc/grafana-anomaly-exporter/exporter.env
```

### Prometheus score metric'leri gormuyor
Kontrol et:
```bash
curl -s http://127.0.0.1:9110/metrics | head
curl -s 'http://127.0.0.1:9090/api/v1/query?query=grafana_anomaly_exporter_up'
```

### SELinux nedeniyle erisim sorunu
Gerekirse:
```bash
sudo restorecon -Rv /var/lib/grafana/plugins
sudo restorecon -Rv /opt/grafana-anomaly-exporter /etc/grafana-anomaly-exporter /var/lib/grafana-anomaly-exporter /var/log/grafana-anomaly-exporter
```

### Remote Prometheus scrape yapamiyor
Kontrol et:
- exporter hostunda `9110/tcp` acik mi
- remote Prometheus target dogru mu
- firewall veya security group kuralinda izin var mi

## 13. Onerilen production akisi

En stabil akis su:
1. Plugin'i native RHEL script ile kur
2. Exporter'i native systemd servis olarak kur
3. Prometheus scrape job'i aktif et
4. Panelden score feed sync yap
5. Grafana Alerting'de `grafana_anomaly_rule_score` ile alert yaz

Bu yol su avantajlari saglar:
- Docker zorunlulugu yok
- servisler host restart sonrasi otomatik kalkar
- exporter kalici state tutar
- alerting paneldeki anomaly mantigi ile hizali kalir

## Remote Prometheus senaryosu
- Mevcut Prometheus ayri hostta ise RHEL_REMOTE_PROMETHEUS_RUNBOOK_TR.md dosyasini izle.

