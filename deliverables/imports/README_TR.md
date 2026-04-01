# BiP Devops Import Paketi

Bu klasor, `BiP Devops` altina import edilmek uzere hazirlanan anomaly benchmark dashboard dosyasini icerir.

## Dosyalar

- `BiP_Devops_Anomaly_Detector_Benchmark.dashboard.json`

## Import sirasi

1. Grafana'da dashboard import ekranindan `BiP_Devops_Anomaly_Detector_Benchmark.dashboard.json` dosyasini import et.
2. Folder olarak `BiP Devops` sec.
3. Datasource olarak hedef Prometheus'u sec.
4. Dashboard'u kaydet.
5. Gerekirse anomaly panel kartlarindan score feed sync'i kontrol et.

## Notlar

- Dashboard, verdigin ham PromQL sorgularini dogrudan kullanir.
- Panel basliklari `record | job` mantigiyla okunur tutulur.
- Score feed prefix'i de `record + job` uzerinden duzenlenmistir.
- Score feed varsayilan endpoint'i `http://192.168.51.45:9110`
- Tum paneller `Anomaly Detector 1.2.0` ile uyumlu seceneklerle gelir.
