# Benchmark ve Test Paketi

Bu klasor, Grafana Anomaly Detector icin son benchmark turunun yeniden uretilebilir artefact'larini, gorsel raporlarini ve karar dokumanlarini icerir.

Bu son revizyonda benchmark paketi artik sadece sayisal raporlardan olusmuyor. Paket icinde:

- guncel final runtime sonuclari
- gercek Elastic ML side-by-side benchmark
- gercek Grafana ekran goruntuleri
- gorsel benchmark HTML raporu
- kapasite ve soak ciktilari
- yeniden kosum runbook'u

birlikte bulunur.

## Bu klasorde neler var?

| Yol | Icerik | Ne icin kullanilir? |
| --- | --- | --- |
| `Final_Benchmark_Raporu_TR.md` | Tek yerde toplanmis final karar raporu | Yonetim ve teknik ekip icin ana ozet |
| `Benchmark_Runbook_TR.md` | Benchmark'i bastan sona yeniden uretme adimlari | Tekrar kosum ve yeniden dogrulama |
| `KOD_VE_TESLIM_NOTLARI_TR.md` | Urune giren benchmark kaynakli degisiklikler | Hangi iyilestirmelerin koda tasindigini gormek |
| `functional/` | Labeled senaryolar ve sayisal kalite olcumleri | Precision / recall / F1 takibi |
| `elastic_side_by_side/` | Gercek Elastic side-by-side benchmark akisi, export ve gorsel raporlar | Bizim detector ile Elastic'i 1-1 karsilastirmak |
| `performance/` | Kademeli detector yuk testi ve kaynak modeli | Teknik limit ve kaynak modeli cikarmak |
| `soak/` | 300 / 350 / 400 detector smoke soak paketleri | Kisa operasyonel dogrulama almak |
| `presentation/` | Sunum icin kullanilan gercek screenshot seti ve deck kaynagi | Benchmark sunumu hazirlamak |

## Final ozet

### Fonksiyonel kalite

Son functional benchmark sonucuna gore:

- Final runtime: `6/6` senaryo pass
- Mean precision: `1.0`
- Mean recall: `1.0`
- Mean F1: `1.0`
- Mean false positive rate: `0.0`

### Elastic side-by-side

Ayni labeled dataset uzerinde:

- Bizim final detector mean precision: `1.0`
- Elastic standard threshold=25 mean precision: `0.3333`
- Elastic best threshold mean precision: `0.8043`
- Bizim final detector mean F1: `1.0`
- Elastic standard mean F1: `0.1367`
- Elastic best mean F1: `0.7067`

Bu benchmark turunda bizim detector, ayni veri setinde Elastic trial ML runtime'inin onune gecmistir.

### Performans / kapasite

- Tek snapshot teknik dogrulama: `400` dynamic detector `1.020447s`
- `75s` smoke soak: `300`, `350` ve `400` detector seviyeleri `pass`
- `400` detector soak icinde gorulen maksimum eval suresi: `1.326382s`
- Dashboard + render + alert query akisi kisa smoke boyunca kesintisiz calismistir

Bu nedenle bugunku ifade su olmali:

`400 detector seviyesine kadar kisa lokal smoke temiz; uzun prod soak halen gereklidir.`

## Hangi ciktiya nereden bakmaliyim?

| Ihtiyac | Dosya |
| --- | --- |
| Final karar ozeti | `Final_Benchmark_Raporu_TR.md` |
| Gercek Elastic sayisal kiyas | `elastic_side_by_side/outputs/scored_comparisons/side_by_side_metrics.md` |
| Gercek Elastic gorsel kiyas | `elastic_side_by_side/outputs/visual_report/side_by_side_visual_report.html` |
| Grafana premium panel screenshot'lari | `presentation/assets/screenshots/` |
| Functional benchmark sonuclari | `functional/outputs/functional_benchmark_summary.json` |
| Tuning sweep sonucu | `functional/outputs/functional_tuning_sweep_summary.json` |
| Detector scale sonucu | `performance/outputs/detector_scale_extended_summary.json` |
| 300 / 350 / 400 soak raporlari | `soak/outputs/soak_profile_*.example.report.md` |

## Gorsel benchmark

Bu revizyonda benchmark paketi su iki gorsel katmani birlikte sunar:

1. Gercek Grafana urun deneyimi
2. Ayni dataset uzerinde bizim detector ile Elastic davranisinin 1-1 karsilastirmasi

En onemli gorsel artefact'lar:

- `presentation/assets/screenshots/grafana-multi-metric-premium.png`
- `presentation/assets/screenshots/grafana-single-metric-premium.png`
- `presentation/assets/screenshots/benchmark-side-by-side-latency.png`
- `presentation/assets/screenshots/benchmark-side-by-side-level-shift.png`
- `elastic_side_by_side/outputs/visual_report/side_by_side_visual_report.html`

Bu gorseller, benchmark sunumunun ve yonetim ozetinin temel malzemesi olarak kullanilmalidir.

## En onemli urun bulgusu

Bu turdaki en kritik sonuclar:

- onceki zayif halka olan `subtle_level_shift` use case'i kapanmistir
- premium chart UX ve inspector davranisi urune alinmistir
- ayni dataset uzerinde Elastic'e karsi hem gorsel hem sayisal benchmark tamamlanmistir

Artik ana odak algoritmik acik degil, daha uzun sureli operasyonel soak ve daha genis benchmark ailesidir.

## Benchmark'i yeniden kosmak istersem

1. `Benchmark_Runbook_TR.md` dosyasini ac
2. Local Elastic trial runtime'i ayakta tut
3. `run_local_elastic_benchmark.py` ile same-dataset Elastic benchmark turunu kostur
4. `run_detector_scale_extended.py` ve `run_soak_package.py` ile kapasite turlarini yenile
5. Panel tarafinda `npm run typecheck`, `npm run test:ci`, `npm run build` ve `npm run e2e` dogrulamalarini tekrar al
6. `tests/capture_benchmark_screenshots.mjs` ile guncel screenshot setini yeniden uret

## Bu benchmark paketi nasil kullanilmali?

- Yonetim sunumu icin:
  `Final_Benchmark_Raporu_TR.md` + `presentation/`
- Teknik karar icin:
  `Final_Benchmark_Raporu_TR.md` + `KOD_VE_TESLIM_NOTLARI_TR.md`
- Gorsel demo icin:
  `elastic_side_by_side/outputs/visual_report/side_by_side_visual_report.html`
- Rerun / audit icin:
  `Benchmark_Runbook_TR.md`
