# Benchmark Presentation Paketi

Bu klasor, benchmark sunumu icin gereken tum guncel artefact'lari bir arada tutar.

## Icerik

- `assets/screenshots/`
  Gercek Grafana ve side-by-side benchmark screenshot'lari
- `source/build_benchmark_deck.js`
  PPTX sunumunu yeniden ureten kaynak dosya
- `source/package.json`
  Sunum workspace bagimliliklari
- `output/Grafana_Anomaly_Detector_Benchmark_TR.pptx`
  Guncel final sunum
- `output/rendered/`
  Slayt onizleme PNG'leri

## Sunumu yeniden uretmek

`benchmarks/presentation/source` altinda:

```powershell
npm install
npm run build
```

## Bu sunumun amaci

Bu deck, teknik olmayan paydaslarin da anlayacagi sekilde su uc seyi ayni yerde gostermek icin hazirlandi:

1. Grafana Anomaly Detector'in guncel urun gorunumu
2. Ayni dataset uzerinde Elastic ML ile gercek benchmark kiyaslamasi
3. Kisa operasyonel kapasite ve soak sonucu
