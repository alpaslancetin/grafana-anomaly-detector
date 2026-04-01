# Anomaly Detector Benchmark Runbook

Bu runbook, Grafana Anomaly Detector benchmark paketini bastan sona yeniden uretmek icin gereken adimlari toplar.

## 1. Local Elastic trial runtime'i kaldir

WSL Docker veya Linux Docker uzerinden:

```bash
docker run -d \
  --name elastic-benchmark \
  -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.license.self_generated.type=trial \
  -e xpack.security.enabled=false \
  -e xpack.ml.use_auto_machine_memory_percent=true \
  -e ES_JAVA_OPTS="-Xms1g -Xmx1g" \
  docker.elastic.co/elasticsearch/elasticsearch:9.3.2
```

Alternatif olarak:

```bash
docker compose -f benchmarks/elastic_side_by_side/runtime/docker-compose.yml up -d
```

Opsiyonel Kibana UI icin:

```bash
docker compose -f benchmarks/elastic_side_by_side/runtime/docker-compose.yml --profile ui up -d
```

## 2. Fonksiyonel benchmark ve Elastic side-by-side turunu kostur

Windows + WSL ortami icin dogrudan:

```bash
python3 /mnt/c/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/elastic_side_by_side/run_local_elastic_benchmark.py \
  --elastic-url http://localhost:9200 \
  --standard-threshold 25 \
  --threshold-candidates 1,2,3,5,7.5,10,15,20,25,30,40,50,60,75
```

Bu komut su ciktilari tazeler:

- `benchmarks/functional/outputs/functional_benchmark_summary.json`
- `benchmarks/functional/outputs/functional_tuning_sweep_summary.json`
- `benchmarks/elastic_side_by_side/outputs/elastic_records_normalized.json`
- `benchmarks/elastic_side_by_side/outputs/scored_comparisons/side_by_side_metrics.md`
- `benchmarks/elastic_side_by_side/outputs/visual_report/side_by_side_visual_report.html`

## 3. Performans / kapasite turlarini kostur

Tek nokta resource modeli:

```bash
python3 /mnt/c/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/performance/run_detector_scale_extended.py
```

Kisa soak:

```bash
python3 /mnt/c/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/soak/run_soak_package.py \
  --config /mnt/c/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/soak/soak_profile_300.example.json \
  --duration-seconds 60 \
  --sample-interval-seconds 20 \
  --initial-settle-seconds 10 \
  --skip-dashboard-checks \
  --skip-render-checks
```

Ayni komut `soak_profile_350.example.json` ve `soak_profile_400.example.json` icin de uygulanabilir.

## 4. Build / syntax dogrulama

Panel:

```bash
npm run typecheck
npm run build
```

Python tarafi:

```bash
python3 -m py_compile \
  prometheus-live-demo/anomaly_exporter/app/algorithms.py \
  prometheus-live-demo/anomaly_exporter/app/models.py \
  prometheus-live-demo/anomaly_exporter/app/server.py \
  benchmarks/functional/run_functional_benchmark.py \
  benchmarks/elastic_side_by_side/run_local_elastic_benchmark.py
```

## 5. Cikti kontrol listesi

- Fonksiyonel benchmark summary guncel mi?
- Tuning sweep report 6 senaryoyu kapsiyor mu?
- Elastic side-by-side report'ta placeholder degil gercek Elastic SVG'leri var mi?
- 300 detector soak `pass`, 350 ve 400 `risk` olarak raporlaniyor mu?
- `npm run build` ve `npm run typecheck` temiz mi?

## 6. Operasyonel yorumlama

- Product parity icin ana karar dosyasi: `benchmarks/Final_Benchmark_Raporu_TR.md`
- Elastic sayisal kiyas: `benchmarks/elastic_side_by_side/outputs/scored_comparisons/side_by_side_metrics.md`
- Gorsel kiyas: `benchmarks/elastic_side_by_side/outputs/visual_report/side_by_side_visual_report.html`
- Kapasite ve soak: `benchmarks/soak/outputs/*.report.md`
