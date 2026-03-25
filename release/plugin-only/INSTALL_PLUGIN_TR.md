# Plugin-only kurulum

Bu paket build gerektirmez. RHEL uzerinde en pratik yol `install-rhel-plugin.sh` scriptini calistirmaktir.

## RHEL hizli kurulum

```bash
sudo ./install-rhel-plugin.sh
```

Script su isleri yapar:
- plugin dosyalarini `/var/lib/grafana/plugins/alpas-anomalydetector-panel` altina kopyalar
- `/etc/grafana/grafana.ini` icine `allow_loading_unsigned_plugins = alpas-anomalydetector-panel` ayarini ekler veya gunceller
- `grafana-server` servisini yeniden baslatir

## Elle kurulum istersen

### 1. Plugin klasoru
- `alpas-anomalydetector-panel/`

### 2. Grafana plugin dizinine kopyala
```bash
sudo cp -R alpas-anomalydetector-panel /var/lib/grafana/plugins/
```

### 3. Unsigned plugin izni ver
`/etc/grafana/grafana.ini` altinda:
```ini
[plugins]
allow_loading_unsigned_plugins = alpas-anomalydetector-panel
```

### 4. Grafana'yi yeniden baslat
```bash
sudo systemctl restart grafana-server
```

## Not
Bu plugin tek basina calisir.
Exporter sadece anomaly score ile alert rule yazmak istiyorsan gereklidir.
