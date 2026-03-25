# Alert-ready exporter bundle

Bu bundle RHEL icin native anomaly score alerting kurulumunu hedefler.
Onerilen mod Docker degil, systemd ile calisan native exporter modudur.

## Rootsuz en pratik yol

Eger root yetkin yoksa exporter'i ayni klasorden portable modda calistirabilirsin:

```bash
chmod +x portable-exporter.sh
./portable-exporter.sh start http://truva01.turkcell.tgc:9090/
```

Bu mod:
- systemd istemez
- `/opt`, `/etc`, `/var` yazmaz
- runtime dosyalarini `alert-bundle/.portable-runtime/` altina koyar
- exporter'i `0.0.0.0:9110` uzerinden acmaya calisir

Faydali komutlar:

```bash
./portable-exporter.sh status
./portable-exporter.sh logs
./portable-exporter.sh stop
```

Notlar:
- yalnizca sistemdeki python3 ile calisir, PyPI veya pip erisimi istemez
- Prometheus tarafinda yine `172.18.201.39:9110` scrape edilmelidir
- Grafana panelinde exporter endpoint olarak `http://172.18.201.39:9110` kullanilmalidir

## RHEL uzerinde en hizli akis

### 1. Exporter'i kur
```bash
sudo ./install-exporter-rhel.sh http://127.0.0.1:9090
```

Bu script:
- exporter dosyalarini `/opt/grafana-anomaly-exporter` altina kurar
- config'i `/etc/grafana-anomaly-exporter/exporter.env` altina yazar
- state'i `/var/lib/grafana-anomaly-exporter` altina koyar
- loglari `/var/log/grafana-anomaly-exporter` altina yazar
- `grafana-anomaly-exporter.service` systemd servisini enable + start eder

### 2. Local Prometheus scrape'i ac
```bash
sudo ./enable-local-prometheus-scrape-rhel.sh
```

Bu script local `/etc/prometheus/prometheus.yml` dosyasina su job'i ekler:
```yaml
  - job_name: grafana-anomaly-exporter
    scrape_interval: 10s
    static_configs:
      - targets:
          - 127.0.0.1:9110
```

### 3. Grafana panel sync
- Panelde `Score feed mode = Auto sync` kullan veya `Sync score feed` butonuna bas.

### 4. Alert yaz
Grafana Alerting icinde mevcut Prometheus datasource'unu kullan ve panelin verdigi query'yi yaz:
```promql
grafana_anomaly_rule_score{rule="..."}
```

## Servis ve dizinler
- systemd service: `/etc/systemd/system/grafana-anomaly-exporter.service`
- install root: `/opt/grafana-anomaly-exporter`
- config: `/etc/grafana-anomaly-exporter/exporter.env`
- state: `/var/lib/grafana-anomaly-exporter`
- logs: `/var/log/grafana-anomaly-exporter/exporter.log`

## Remote Prometheus senaryosu
Eger source Prometheus baska bir hostta ise:
1. `install-exporter-rhel.sh` komutuna remote Prometheus URL ver.
2. Remote Prometheus tarafinda `prometheus-scrape-job.yml.snippet` icindeki scrape job'i ekle.
3. Grafana Alerting'de o Prometheus datasource'unu kullan.

## Istege bagli Docker modu
Docker ile gitmek istersen Linux shell uzerinden su scriptler de var:
- `start-alert-bundle.sh`
- `stop-alert-bundle.sh`

Bu mod source Prometheus scrape config'ini degistirmeden ayri bir score Prometheus acar.
Ama RHEL hedefi icin varsayilan yol native systemd exporter kurulumudur.

## Dahil dosyalar
- `install-exporter-rhel.sh`
- `uninstall-exporter-rhel.sh`
- `enable-local-prometheus-scrape-rhel.sh`
- `disable-local-prometheus-scrape-rhel.sh`
- `portable-exporter.sh`
- `grafana-anomaly-exporter.service`
- `grafana-anomaly-exporter.env.example`
- `prometheus-scrape-job.yml.snippet`
- `start-alert-bundle.sh`
- `stop-alert-bundle.sh`
- `exporter/`

## Tam runbook
- Daha genis adimlar ve ilk alert olusturma akisi icin ../RHEL_KURULUM_RUNBOOK_TR.md dosyasini kullan.

## Remote Prometheus notu
- Remote Prometheus senaryosu icin prometheus-scrape-job.remote.yml.snippet ve ../RHEL_REMOTE_PROMETHEUS_RUNBOOK_TR.md dosyalarini kullan.
