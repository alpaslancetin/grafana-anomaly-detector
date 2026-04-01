# 350-400 Detector Soak Test Paketi

Bu klasorun amaci, 350-400 dynamic detector seviyesinde ayni anda su akislari gozlemlemektir:

- anomaly detector score feed
- alert-path sorgulari
- dashboard sayfasi erisimi
- render endpoint erisimi

## Dosyalar

| Dosya | Amac |
| --- | --- |
| `run_soak_package.py` | Soak test runner |
| `soak_profile_350.example.json` | 350 detector icin ornek profil |
| `soak_profile_400.example.json` | 400 detector icin ornek profil |

## Ne yapar?

Runner su adimlari uygular:

1. Exporter state dosyasini yedekler
2. Hedef detector sayisina kadar dynamic rule sync eder
3. Belirlenen sure boyunca ornekleme yapar
4. Her orneklemede:
   - Grafana health
   - exporter metrics
   - Prometheus sorgulari
   - alert-path sorgulari
   - dashboard page erisimi
   - render URL erisimi
   - process RSS / CPU snapshot
5. Test bitince dynamic rule state'ini geri alir

## Neden auth alanlari bos?

Lokal ortamda dashboard page ve render URL cagirilari auth gerektirebilir.

Bu nedenle profil icinde:

- `basic_auth`
- `headers`

alanlari bos geliyor. Stage veya prod benzeri ortamda bunlari doldurman gerekir.

## Ornek calistirma

350 detector:

```bash
python benchmarks/soak/run_soak_package.py --config benchmarks/soak/soak_profile_350.example.json
```

400 detector:

```bash
python benchmarks/soak/run_soak_package.py --config benchmarks/soak/soak_profile_400.example.json
```

## Ciktilar

- `outputs/<profile>.summary.json`
- `outputs/<profile>.report.md`

## Onemli not

Bu paket Grafana alert rule'larini otomatik olusturmaz.

Beklenen kullanim:

1. Panelde `Prometheus score feed` acik ve sync edilmis olacak
2. Gerekli alert query panelden alinmis olacak
3. Grafana Alerting tarafinda rule daha once olusturulmus olacak
4. Soak paketi, bu akislarin saglikli kaldigini birlikte gozlemlemek icin kosulacak

Ilgili panel/export anlatimi:

- [Anomaly_Detector_End_to_End_TR.html](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/tutorial/Anomaly_Detector_End_to_End_TR.html)
