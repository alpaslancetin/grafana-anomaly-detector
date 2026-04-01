# v1.2.0 Release Planı

Bu dosya, `v1.2.0` sürümünün GitHub tarafında etiketlenmesi ve paylaşılması için kısa operasyon planını içerir.

## 1. Release kimliği

- Repo: `https://github.com/alpaslancetin/grafana-anomaly-detector`
- Sürüm etiketi: `v1.2.0`
- Referans commit: `728e4a3`

## 2. Tag stratejisi

- Annotated tag kullanılmalı
- Tag adı:

```text
v1.2.0
```

- Önerilen tag mesajı:

```text
Release v1.2.0
```

## 3. GitHub release başlığı

```text
Grafana Anomaly Detector v1.2.0
```

## 4. Release gövdesi

GitHub release body olarak:

```text
release/GITHUB_RELEASE_NOTES_v1.2.0.md
```

dosyasındaki içerik kullanılmalı.

## 5. Eklenmesi önerilen artifact'lar

- `release/alpas-anomalydetector-panel-plugin-only.zip`
- `release/alpas-anomaly-alert-bundle.zip`
- `release/alpas-anomaly-alert-bundle-python39-compatible.zip`
- `tutorial/Anomaly_Detector_End_to_End_TR.pdf`
- benchmark deck:
  - `benchmarks/presentation/output/Grafana_Anomaly_Detector_Benchmark_TR.pptx`
  - isteğe bağlı alternatif deck'ler

## 6. Yayın öncesi kontrol listesi

1. `main` branch güncel mi kontrol et
2. `package.json` sürümü `1.2.0` mı kontrol et
3. `release/plugin-only/.../plugin.json` içinde sürüm `1.2.0` mı kontrol et
4. ZIP dosyaları açılıyor mu kontrol et
5. Tutorial PDF güncel mi kontrol et
6. Benchmark deck açılıyor mu kontrol et

## 7. Yayın akışı

1. `v1.2.0` annotated tag oluştur
2. Tag'i remote'a push et
3. GitHub üzerinde yeni release aç
4. Başlık, release notes ve artifact'ları ekle
5. Release'i publish et

## 8. Yayın sonrası önerilen kısa duyuru

- Repo linki
- `v1.2.0` yenilik özeti
- plugin-only ve alert-bundle paketleri
- tutorial ve benchmark deck referansları
