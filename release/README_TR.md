# Grafana Anomaly Lab release ciktilari

Bu klasor son kullanici icin hazir paketleri icerir. Hedef runtime artik Red Hat tabanli Linux ortamlari olacak sekilde duzenlendi.

## Paketler

### 1. Plugin-only
- klasor: `plugin-only/`
- zip: `alpas-anomalydetector-panel-plugin-only.zip`
- kullanim: sadece anomaly panel UI'ini kullanmak isteyenler icin

### 2. Alert bundle
- klasor: `alert-bundle/`
- zip: `alpas-anomaly-alert-bundle.zip`
- kullanim: anomaly score metric uretip Grafana Alerting tarafinda score bazli alarm tanimlamak isteyenler icin
- rootsuz kullanim: `alert-bundle/portable-exporter.sh`

## RHEL icin onerilen yol

### A. Plugin kurulumu
```bash
sudo ./install-rhel-plugin.sh
```

### B. Exporter kurulumu
```bash
sudo ./install-exporter-rhel.sh http://127.0.0.1:9090
```

Root yoksa alternatif:
```bash
./portable-exporter.sh start http://127.0.0.1:9090
```

### C. Local Prometheus scrape acma
```bash
sudo ./enable-local-prometheus-scrape-rhel.sh
```

### D. Grafana kullanimi
1. Anomaly panelini olustur.
2. `Auto sync` veya `Sync score feed` ile score feed'i aktif et.
3. Alert rule icinde `grafana_anomaly_rule_score{rule="..."}` query'sini kullan.

## Istege bagli Docker yolu
RHEL uzerinde Docker ile gitmek istersen:
```bash
./start-alert-bundle.sh http://127.0.0.1:9090
```
Bu yol ikincil secenektir; varsayilan yol native systemd exporter kurulumudur.

## RHEL paketlerinin amaci
- native systemd servis kullanmak
- Docker zorunlulugunu kaldirmak
- source kod build ihtiyacini kaldirmak
- plugin ve exporter kurulumunu script ile otomatiklestirmek

## Hala manuel kalan kisimlar
- eger Prometheus remote ise scrape job remote tarafta eklenmeli
- Grafana datasource secimi ve alert threshold tasarimi user tarafinda kalir

## Detayli runbook
- [RHEL_KURULUM_RUNBOOK_TR.md](RHEL_KURULUM_RUNBOOK_TR.md) dosyasi uctan uca Red Hat kurulum akisini verir.
- [RHEL_REMOTE_PROMETHEUS_RUNBOOK_TR.md](RHEL_REMOTE_PROMETHEUS_RUNBOOK_TR.md) ayri Prometheus sunucusu olan kurulumlari adim adim anlatir.
