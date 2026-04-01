# Anomaly Detector 1.2.0 Prod Upgrade Runbook

Bu runbook, prod ortaminda zaten calisan `alpas-anomalydetector-panel` plugin'ini son surum `1.2.0` paketine guncellemek icin hazirlandi.

## 1. Ne guncelleniyor?

- Plugin surumu: `1.2.0`
- Plugin ID: `alpas-anomalydetector-panel`
- Yeni dikkat ceken alanlar:
  - `Subtle level shift / drift` preset'i
  - `Level shift detector`
  - `Confidence`, `Data quality` ve `Main reason` alanlari
  - Daha guclu chart marker'lari, inline series label'lari, focus band ve pinned tooltip
  - Exporter tarafinda `grafana_anomaly_confidence_score`

## 2. Upgrade oncesi alinacak yedek

1. Mevcut plugin klasorunun yedegini alin.
2. Score feed kullaniyorsaniz exporter config ve state klasorlerini yedekleyin.
3. Mevcut Grafana config icinde su izin satirinin aktif oldugunu teyit edin:

```ini
[plugins]
allow_loading_unsigned_plugins = alpas-anomalydetector-panel
```

## 3. Sadece plugin UI guncellenecekse

### Paket

- `packages/alpas-anomalydetector-panel-plugin-only.zip`
- veya acilmis hali: `packages/plugin-only/alpas-anomalydetector-panel/`

### Adimlar

1. Grafana plugin dizininde mevcut klasoru yedekleyin:

```bash
sudo cp -R /var/lib/grafana/plugins/alpas-anomalydetector-panel /var/lib/grafana/plugins/alpas-anomalydetector-panel.bak_20260328
```

2. Yeni plugin klasorunu kopyalayin:

```bash
sudo rm -rf /var/lib/grafana/plugins/alpas-anomalydetector-panel
sudo cp -R alpas-anomalydetector-panel /var/lib/grafana/plugins/
```

3. Gerekliyse Grafana config icinde unsigned plugin iznini koruyun:

```ini
[plugins]
allow_loading_unsigned_plugins = alpas-anomalydetector-panel
```

4. Grafana servisini yeniden baslatin:

```bash
sudo systemctl restart grafana-server
```

5. Tarayicida sert yenileme yapin:

```text
Ctrl+F5 veya cache temiz hard refresh
```

## 4. Score feed / exporter da guncellenecekse

### Paket

- `packages/alpas-anomaly-alert-bundle.zip`
- veya acilmis hali: `packages/alert-bundle/`

### Adimlar

1. Exporter dosyalarini yeni paketle degistirin.
2. Exporter servisini yeniden baslatin.
3. `/metrics` altinda yeni confidence metriğini dogrulayin:

```promql
grafana_anomaly_confidence_score
```

## 5. Upgrade sonrasi minimum smoke test

1. Grafana'da panel edit ekranini acin.
2. Plugin surumunun `1.2.0` oldugunu teyit edin.
3. `Subtle level shift / drift` preset'inin geldigi kontrol edin.
4. Bir anomaly secip su alanlarin geldigi kontrol edin:
   - `Detection strength`
   - `Confidence`
   - `Data quality`
   - `Main reason`
5. Chart tarafinda su iyilestirmeleri gorun:
   - daha net anomaly marker'lari
   - inline series label
   - focus band
   - hover crosshair
   - pinned tooltip
6. Score feed kullaniyorsaniz `Sync score feed` calistirin.
7. `Show score rules` altinda query'lerin geldigini kontrol edin.
8. `grafana_anomaly_rule_score` ve `grafana_anomaly_confidence_score` scrape ediliyor mu bakın.

## 6. Rollback

Sorun gorulurse:

1. Yeni plugin klasorunu kaldirin.
2. Yedek plugin klasorunu eski ismine geri alin.
3. Gerekirse exporter'in onceki kopyasini geri yukleyin.
4. Grafana ve exporter servislerini yeniden baslatin.

## 7. Referans dosyalar

- `README_TR.md`
- `RELEASE_NOTES_1.2.0_TR.md`
- `UPGRADE_CHECKLIST_1.2.0_TR.md`
- `GUNCEL_DOSYA_HARITASI_1.2.0_TR.md`
