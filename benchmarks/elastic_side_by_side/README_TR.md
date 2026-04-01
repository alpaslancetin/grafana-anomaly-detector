# Elastic Side-by-Side Benchmark Akisi

Bu klasorun amaci, ayni labeled benchmark senaryolarini hem bizim anomaly detector hem de Elastic anomaly detection tarafinda kosturup sonuclari yan yana karsilastirmaktir.

## Hedef

- Ayni dataset
- Ayni anomaly label'lari
- Ayni senaryo isimleri
- Bizim detector ve Elastic anomaly result'larini ayni raporda yan yana gostermek

## Dosyalar

| Dosya | Amac |
| --- | --- |
| `export_labeled_scenarios_for_elastic.py` | Benchmark senaryolarini Elastic'e uygun NDJSON dataset olarak uretir |
| `run_local_elastic_benchmark.py` | Local Elastic trial cluster'a tum senaryolari post edip gerçek side-by-side ciktilari uretir |
| `normalize_elastic_records.py` | Elastic records export'unu ortak rapor formatina cevirir |
| `build_side_by_side_visual_report.py` | Bizim detector ve Elastic davranisini gorsel rapora donusturur |
| `score_side_by_side_metrics.py` | Default / tuned / Elastic precision-recall-F1 tablolarini ayni raporda hesaplar |

## 1. Dataset uret

```bash
python benchmarks/elastic_side_by_side/export_labeled_scenarios_for_elastic.py
```

Uretilen ana ciktilar:

- `outputs/labeled_scenarios/all_scenarios.ndjson`
- `outputs/labeled_scenarios/<scenario>.ndjson`
- `outputs/labeled_scenarios/scenario_manifest.json`
- `outputs/labeled_scenarios/job_templates/<scenario>.job.json`

## 2. Elastic tarafinda benchmark job'larini kostur

Hizli lab akisi:

1. Her senaryo icin job template'i kullanarak anomaly detection job olustur
2. Job'i ac
3. Ayni senaryonun NDJSON verisini job'a yukle veya index'e alip datafeed ile okut
4. Job tamamlaninca records export al

Elastic resmi referanslari:

- Anomaly detection genel bakis:
  [overview](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection)
- Job tipleri:
  [job types](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-anomaly-detection-job-types)
- Population analysis:
  [population analysis](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-configuring-populations)
- Forecast:
  [forecast](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-ad-forecast)
- Explainability:
  [explainability](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-ad-explain)

### Local Elastic trial runner

Bu repo artik local Elastic trial cluster icin dogrudan calisabilen bir benchmark runner da icerir.

1. Elasticsearch trial node'unu kaldir:

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

2. Tum suite'i local Elastic uzerinde kostur:

```bash
python benchmarks/elastic_side_by_side/run_local_elastic_benchmark.py \
  --elastic-url http://localhost:9200 \
  --standard-threshold 25 \
  --threshold-candidates 1,2,3,5,7.5,10,15,20,25,30,40,50,60,75
```

Bu komut sirasiyla:

- functional benchmark ve tuning sweep ciktilarini tazeler
- Elastic'e ayni labeled senaryolari post eder
- records ve bucket export alir
- Elastic normalized ciktiyi uretir
- side-by-side gorsel ve sayisal raporu yeniler

## 3. Elastic result export formati

Her senaryo icin Elastic records export'unu bir JSON dosyasi olarak sakla.

Pratik isimlendirme:

- `latency_spike_mad.records.json`
- `error_burst_mad.records.json`
- `traffic_drop_ewma.records.json`
- `seasonal_hourly_spike.records.json`
- `resource_step_ewma.records.json`

## 4. Elastic records'u normalize et

```bash
python benchmarks/elastic_side_by_side/normalize_elastic_records.py \
  --input-dir benchmarks/elastic_side_by_side/raw_elastic_records \
  --output benchmarks/elastic_side_by_side/outputs/elastic_records_normalized.json
```

## 5. Side-by-side gorsel raporu uret

Elastic sonuclari hazirsa:

```bash
python benchmarks/elastic_side_by_side/build_side_by_side_visual_report.py \
  --elastic-normalized benchmarks/elastic_side_by_side/outputs/elastic_records_normalized.json
```

Elastic sonuclari henuz yoksa:

```bash
python benchmarks/elastic_side_by_side/build_side_by_side_visual_report.py
```

Bu durumda rapor bizim detector gorsellerini uretir ve Elastic alani icin placeholder bir panel koyar.

## 6. Side-by-side metrik raporu uret

Elastic sonuclari hazirsa:

```bash
python benchmarks/elastic_side_by_side/score_side_by_side_metrics.py \
  --elastic-normalized benchmarks/elastic_side_by_side/outputs/elastic_records_normalized.json
```

Elastic sonuclari henuz yoksa:

```bash
python benchmarks/elastic_side_by_side/score_side_by_side_metrics.py
```

Bu durumda default ve tuned detector skorlarini yazar, Elastic kolonu ise bos veriyle kalir.

## Rapor ciktilari

- `outputs/visual_report/side_by_side_visual_report.html`
- `outputs/visual_report/*.svg`
- `outputs/visual_report/side_by_side_visual_summary.json`
- `outputs/scored_comparisons/side_by_side_metrics.json`
- `outputs/scored_comparisons/side_by_side_metrics.md`
- `outputs/local_elastic_benchmark_report.md`
- `outputs/local_elastic_benchmark_summary.json`
- `outputs/elastic_cluster_info.json`
- `outputs/raw_elastic_records/*.json`
- `outputs/raw_elastic_buckets/*.json`

## Beklenen karar ciktilari

Bu akistan sonra su sorulara daha net cevap verilebilir:

- Elastic hangi senaryoda daha az false positive uretiyor?
- Biz hangi use case'lerde Elastic'e yaklasiyoruz?
- Seasonal senaryoda fark sadece tuning mi, yoksa model capability acigi mi?
- Alert-ready score tarafinda operasyonel kalite farki ne kadar?
