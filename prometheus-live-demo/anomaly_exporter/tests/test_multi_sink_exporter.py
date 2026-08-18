from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from app.alert_queries import build_score_feed_registration
from app import config_loader
from app.algorithms import evaluate_series
from app.canonical import RawPoint, score_points
from app.dynamic_rules import DynamicRuleRegistry, RegistrationError
from app.display_names import resolve_series_display_name
from app.models import AppConfig, GlobalConfig, RuleConfig, RuleSnapshot, SeriesSnapshot, SeriesState, SinkDefinition
from app.server import ExporterRuntime, next_cycle_sleep_seconds
from app.sinks import build_sink_manager
from app.sinks import postgresql as postgresql_sink_module
from app.sinks.base import AnomalySink, SinkBatch, SinkManager
from app.sinks.clickhouse import ClickHouseSink
from app.sinks.elasticsearch import ElasticsearchSink
from app.sinks.influxdb import InfluxDBSink
from app.sinks.loki import LokiSink
from app.sinks.postgresql import PostgreSQLSink


def sample_batch() -> SinkBatch:
    series = SeriesSnapshot(
        rule_name='checkout_latency',
        source_metric='demo_latency_ms',
        labels={'service': 'checkout', 'instance': 'api-1'},
        value=123.4,
        expected=100.0,
        lower=80.0,
        upper=120.0,
        deviation=23.4,
        raw_score=3.1,
        point_raw_score=3.1,
        window_raw_score=1.0,
        score_driver='point',
        normalized_score=91,
        severity_label='critical',
        is_anomaly=True,
        confidence_score=88.0,
        confidence_label='high',
        data_quality_label='healthy',
        threshold=4.0,
        algorithm='mad',
        severity_preset='page_first',
        timestamp=1710000000.123,
    )
    rule = RuleSnapshot(
        name='checkout_latency',
        algorithm='mad',
        severity_preset='page_first',
        query='demo_latency_ms',
        series_count=1,
        breach_count=1,
        max_raw_score=3.1,
        max_score=91,
        max_severity_label='critical',
        active_series=1,
        timestamp=1710000000.123,
    )
    return SinkBatch([series], [rule], 1710000000.123)


class CaptureHandler(BaseHTTPRequestHandler):
    requests: list[tuple[str, dict[str, str], bytes]] = []
    prometheus_response = {
        'status': 'success',
        'data': {
            'resultType': 'vector',
            'result': [
                {'metric': {'__name__': 'demo_latency_ms', 'instance': 'api-1'}, 'value': [1710000000.0, '123.4']}
            ],
        },
    }

    def do_GET(self) -> None:
        body = json.dumps(self.prometheus_response).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.requests.append((self.path, {str(k): str(v) for k, v in self.headers.items()}, body))
        self.send_response(200 if self.path == '/_bulk' else 204)
        if self.path == '/_bulk':
            self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if self.path == '/_bulk':
            self.wfile.write(b'{"errors":false}')

    def log_message(self, format: str, *args: object) -> None:
        return


class MultiSinkExporterTest(unittest.TestCase):
    def setUp(self) -> None:
        CaptureHandler.requests = []
        self.server = HTTPServer(('127.0.0.1', 0), CaptureHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_series_display_name_preserves_constant_grafana_legend(self) -> None:
        self.assertEqual(
            resolve_series_display_name('BIP Login Success Rate', {'instance': 'server01'}, 'login_success_rate', 'query_a'),
            'BIP Login Success Rate',
        )

    def test_series_display_name_renders_each_grafana_legend_template(self) -> None:
        self.assertEqual(
            resolve_series_display_name('Server {{instance}} - Login Rate', {'instance': 'A'}, 'login_success_rate', 'query_a'),
            'Server A - Login Rate',
        )
        self.assertEqual(
            resolve_series_display_name('', {'instance': 'A'}, 'login_success_rate', 'query_a'),
            'login_success_rate',
        )

    def test_yaml_fallback_parses_sinks(self) -> None:
        raw = '''
global:
  prometheus_url: http://prometheus:9090
sinks:
  loki:
    enabled: true
    url: http://loki:3100
    labels: { job: grafana_anomaly_exporter, env: demo }
rules:
  - name: checkout
    query: up
    labels:
      team: platform
'''
        previous_yaml = config_loader.yaml
        config_loader.yaml = None
        try:
            parsed = config_loader._load_yaml_with_fallback(raw)
        finally:
            config_loader.yaml = previous_yaml

        self.assertTrue(parsed['sinks']['loki']['enabled'])
        self.assertEqual(parsed['sinks']['loki']['labels']['job'], 'grafana_anomaly_exporter')
        self.assertEqual(parsed['rules'][0]['labels']['team'], 'platform')

    def test_http_sinks_write_expected_payloads(self) -> None:
        batch = sample_batch()

        self.assertEqual(LokiSink({'url': self.base_url, 'labels': {'job': 'test'}}).write(batch), 2)
        self.assertEqual(CaptureHandler.requests[-1][0], '/loki/api/v1/push')
        loki_payload = json.loads(CaptureHandler.requests[-1][2].decode('utf-8'))
        loki_stream = loki_payload['streams'][0]['stream']
        self.assertEqual(loki_stream['rule'], 'checkout_latency')
        self.assertEqual(loki_stream['record_type'], 'series')
        self.assertNotIn('severity_label', loki_stream)
        self.assertNotIn('is_anomaly', loki_stream)
        self.assertIn('"severity_label":"critical"', loki_payload['streams'][0]['values'][0][1])
        self.assertIn('"is_anomaly":true', loki_payload['streams'][0]['values'][0][1])

        self.assertEqual(InfluxDBSink({'url': self.base_url, 'version': 1, 'database': 'demo'}).write(batch), 2)
        self.assertTrue(CaptureHandler.requests[-1][0].startswith('/write?'))
        self.assertIn(b'grafana_anomaly', CaptureHandler.requests[-1][2])

        self.assertEqual(ClickHouseSink({'url': self.base_url, 'database': 'default', 'table': 'grafana_anomaly_scores'}).write(batch), 2)
        self.assertTrue(any('/?query=INSERT' in item[0] for item in CaptureHandler.requests))

        self.assertEqual(ElasticsearchSink({'url': self.base_url, 'index_prefix': 'grafana-anomaly'}).write(batch), 2)
        self.assertEqual(CaptureHandler.requests[-1][0], '/_bulk')
        self.assertIn(b'@timestamp', CaptureHandler.requests[-1][2])

    def test_postgresql_driver_missing_disables_sink_without_crashing(self) -> None:
        previous_psycopg = postgresql_sink_module.psycopg
        previous_psycopg2 = postgresql_sink_module.psycopg2
        postgresql_sink_module.psycopg = None
        postgresql_sink_module.psycopg2 = None
        try:
            manager = build_sink_manager(
                {'postgresql': SinkDefinition(name='postgresql', enabled=True, settings={'dsn_env': 'ANOMALY_SINK_PG_DSN'})}
            )
            status = manager.statuses()[0]
            self.assertEqual(status.sink, 'postgresql')
            self.assertEqual(status.up, 0)
            self.assertGreaterEqual(status.errors_total, 1)
            self.assertIn('requires optional', status.last_error)
        finally:
            manager.close()
            postgresql_sink_module.psycopg = previous_psycopg
            postgresql_sink_module.psycopg2 = previous_psycopg2

    def test_postgresql_sink_reconnects_after_closed_connection(self) -> None:
        class FakeCursor:
            def __init__(self, connection: 'FakeConnection') -> None:
                self.connection = connection

            def __enter__(self) -> 'FakeCursor':
                if self.connection.fail:
                    self.connection.fail = False
                    raise RuntimeError('the connection is closed')
                return self

            def __exit__(self, exc_type, exc, tb) -> None:
                return None

            def execute(self, *_args, **_kwargs) -> None:
                return None

            def executemany(self, *_args, **_kwargs) -> None:
                return None

        class FakeConnection:
            def __init__(self, fail: bool) -> None:
                self.fail = fail
                self.closed = False

            def cursor(self) -> FakeCursor:
                return FakeCursor(self)

            def commit(self) -> None:
                return None

            def close(self) -> None:
                self.closed = True

        class FakePsycopg:
            connections: list[FakeConnection] = []

            @classmethod
            def connect(cls, *_args, **_kwargs) -> FakeConnection:
                connection = FakeConnection(fail=len(cls.connections) == 0)
                cls.connections.append(connection)
                return connection

        previous_psycopg = postgresql_sink_module.psycopg
        previous_psycopg2 = postgresql_sink_module.psycopg2
        previous_env = __import__('os').environ.get('ANOMALY_SINK_PG_DSN')
        postgresql_sink_module.psycopg = FakePsycopg
        postgresql_sink_module.psycopg2 = None
        __import__('os').environ['ANOMALY_SINK_PG_DSN'] = 'postgresql://example'
        try:
            sink = PostgreSQLSink({'dsn_env': 'ANOMALY_SINK_PG_DSN'})
            with self.assertRaisesRegex(RuntimeError, 'connection is closed'):
                sink.write(sample_batch())
            self.assertIsNone(sink.connection)
            self.assertTrue(FakePsycopg.connections[0].closed)

            self.assertEqual(sink.write(sample_batch()), 2)
            self.assertEqual(len(FakePsycopg.connections), 2)
        finally:
            postgresql_sink_module.psycopg = previous_psycopg
            postgresql_sink_module.psycopg2 = previous_psycopg2
            if previous_env is None:
                __import__('os').environ.pop('ANOMALY_SINK_PG_DSN', None)
            else:
                __import__('os').environ['ANOMALY_SINK_PG_DSN'] = previous_env

    def test_sink_manager_reports_queue_backpressure(self) -> None:
        class SlowSink(AnomalySink):
            def __init__(self) -> None:
                super().__init__('slow')

            def write(self, batch: SinkBatch) -> int:
                time.sleep(0.2)
                return len(batch.series_snapshots) + len(batch.rule_snapshots)

        manager = SinkManager([SlowSink()], queue_size=1)
        try:
            results = [
                manager.enqueue(sample_batch().series_snapshots, sample_batch().rule_snapshots, time.time(), target_sinks={'slow'})
                for _ in range(20)
            ]
            self.assertTrue(any(result.queued for result in results))
            dropped = [result for result in results if result.dropped]
            self.assertTrue(dropped)
            self.assertIn('sink queue full', dropped[-1].reason)
            self.assertGreaterEqual(dropped[-1].dropped_batches_total, 1)
        finally:
            manager.close()

    def test_canonical_scorer_skips_nan_points(self) -> None:
        rule = RuleConfig(
            name='bad_input',
            query='demo',
            algorithm='mad',
            threshold=4.0,
            baseline_window=3,
            severity_preset='balanced',
        )
        points = [
            RawPoint(1, 10, 1, 1, 1, 10, 10),
            RawPoint(2, float('nan'), 2, 2, 1, float('nan'), float('nan')),
            RawPoint(3, 11, 3, 3, 1, 11, 11),
            RawPoint(float('inf'), 12, 4, 4, 1, 12, 12),
            RawPoint(4, 50, 4, 4, 1, 50, 50),
        ]

        snapshots = score_points(rule, 'demo', {}, points)
        self.assertEqual([snapshot.timestamp for snapshot in snapshots], [1, 3, 4])

    def test_canonical_scorer_classifies_flatline_and_irregular_cadence(self) -> None:
        rule = RuleConfig(name='quality', query='demo', algorithm='zscore', threshold=4.0, baseline_window=6)
        flat = [RawPoint(index, 0, index, index, 1, 0, 0) for index in range(8)]
        irregular_times = [0, 1, 2, 4, 5, 7, 8, 10]
        irregular = [RawPoint(timestamp, 100 + index, timestamp, timestamp, 1, 100 + index, 100 + index) for index, timestamp in enumerate(irregular_times)]
        regular = [RawPoint(index, 100 + index, index, index, 1, 100 + index, 100 + index) for index in range(8)]

        self.assertEqual(score_points(rule, 'flat', {}, flat)[-1].data_quality_label, 'flatline')
        self.assertEqual(score_points(rule, 'irregular', {}, irregular)[-1].data_quality_label, 'gappy')
        self.assertEqual(score_points(rule, 'regular', {}, regular)[-1].data_quality_label, 'healthy')

    def test_cycle_scheduler_preserves_requested_start_interval(self) -> None:
        self.assertAlmostEqual(next_cycle_sleep_seconds(5, 1.25), 3.75)
        self.assertEqual(next_cycle_sleep_seconds(5, 8), 0.05)

    def test_config_and_dynamic_rules_reject_non_finite_thresholds(self) -> None:
        with self.assertRaises(config_loader.ConfigError):
            config_loader._as_positive_float(float('inf'), 'threshold', 4.0)

        with tempfile.TemporaryDirectory() as tempdir:
            registry = DynamicRuleRegistry(str(Path(tempdir) / 'rules.json'))
            payload = {
                'dashboardUid': 'demo',
                'panelId': 1,
                'targets': [{'refId': 'A', 'expr': 'up'}],
                'resolvedOptions': {'algorithm': 'mad', 'sensitivity': float('nan')},
            }
            with self.assertRaises(RegistrationError):
                registry.upsert_panel_registration(payload)

    def test_canonical_scorer_suppresses_range_boundary_false_positives(self) -> None:
        values = [100, 100.2, 99.8, 106, 100.1, 99.9, 100.3, 99.7, 100.2, 99.8, 100.1, 99.9, 130]
        points = [RawPoint(index, value, index, index, 1, value, value) for index, value in enumerate(values)]

        for algorithm in ('zscore', 'mad', 'ewma', 'level_shift'):
            with self.subTest(algorithm=algorithm):
                rule = RuleConfig(
                    name=f'boundary_{algorithm}',
                    query='demo',
                    algorithm=algorithm,
                    threshold=4.0,
                    baseline_window=12,
                    severity_preset='balanced',
                )
                snapshots = score_points(rule, 'demo', {}, points)

                self.assertTrue(all(not snapshot.is_anomaly for snapshot in snapshots[:12]))
                self.assertTrue(all(snapshot.expected is None for snapshot in snapshots[:12]))
                self.assertTrue(snapshots[12].is_anomaly)

    def test_streaming_scorer_uses_the_same_startup_warmup(self) -> None:
        values = [100, 100.2, 99.8, 106, 100.1, 99.9, 100.3, 99.7, 100.2, 99.8, 100.1, 99.9, 130]

        for algorithm in ('zscore', 'mad', 'ewma', 'level_shift'):
            with self.subTest(algorithm=algorithm):
                rule = RuleConfig(
                    name=f'streaming_{algorithm}',
                    query='demo',
                    algorithm=algorithm,
                    threshold=4.0,
                    baseline_window=12,
                    severity_preset='balanced',
                )
                state = SeriesState.create(history_limit=rule.history_limit, seasonal_window=rule.baseline_window)
                snapshots = [
                    evaluate_series(state, rule, 'demo', {}, value, float(index))
                    for index, value in enumerate(values)
                ]

                self.assertTrue(all(not snapshot.is_anomaly for snapshot in snapshots[:12]))
                self.assertTrue(all(snapshot.expected is None for snapshot in snapshots[:12]))
                self.assertTrue(snapshots[12].is_anomaly)

    def test_level_shift_keeps_older_reference_for_persistent_shift(self) -> None:
        rule = RuleConfig(
            name='service_level_shift',
            query='demo',
            algorithm='level_shift',
            threshold=6.0,
            baseline_window=30,
            severity_preset='page_first',
        )
        baseline = [RawPoint(index, 100.0, index, index, 1, 100.0, 100.0) for index in range(40)]
        shifted = [RawPoint(index, 130.0, index, index, 1, 130.0, 130.0) for index in range(40, 90)]

        snapshots = score_points(rule, 'demo', {}, baseline + shifted)
        last_shifted = snapshots[-1]

        self.assertTrue(last_shifted.is_anomaly)
        self.assertGreaterEqual(last_shifted.raw_score, rule.threshold)
        self.assertAlmostEqual(last_shifted.expected or 0, 100.0, delta=0.1)

    def test_runtime_keeps_prometheus_metrics_and_writes_loki(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            config = Path(tempdir) / 'rules.yml'
            state = Path(tempdir) / 'dynamic.json'
            config.write_text(
                f'''
global:
  prometheus_url: {self.base_url}
  evaluation_interval_seconds: 1
sinks:
  loki:
    enabled: true
    url: {self.base_url}
    labels: {{ job: test_exporter }}
rules:
  - name: demo
    query: demo_latency_ms
    legend: Server {{{{instance}}}} - Login Rate
    algorithm: mad
''',
                encoding='utf-8',
            )

            runtime = ExporterRuntime(str(config), str(state))
            try:
                runtime.run_once()
                time.sleep(0.3)
                runtime.run_once()
                metrics = runtime.read_metrics().decode('utf-8')
            finally:
                runtime.sink_manager.close()

        self.assertIn('grafana_anomaly_score{', metrics)
        self.assertIn('grafana_anomaly_rule_score{', metrics)
        self.assertIn('grafana_anomaly_severity_level{', metrics)
        self.assertIn('grafana_anomaly_data_quality_level{', metrics)
        self.assertIn('grafana_anomaly_score_driver_window{', metrics)
        self.assertNotIn('severity_label=', metrics)
        self.assertNotIn('confidence_label=', metrics)
        self.assertNotIn('data_quality=', metrics)
        self.assertNotIn('score_driver=', metrics)
        self.assertIn('grafana_anomaly_build_info{version="1.4.0"} 1', metrics)
        self.assertIn('source_metric="Server api-1 - Login Rate"', metrics)
        self.assertIn('grafana_anomaly_sink_up{sink="loki"} 1', metrics)
        self.assertTrue(any(path == '/loki/api/v1/push' for path, _, _ in CaptureHandler.requests))

    def test_prometheus_series_labels_drop_dynamic_state_from_source_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            config = Path(tempdir) / 'rules.yml'
            config.write_text('rules: []\n', encoding='utf-8')
            runtime = ExporterRuntime(str(config))
            snapshot = sample_batch().series_snapshots[0]
            snapshot.labels = {
                **snapshot.labels,
                'severity_label': 'critical',
                'confidence_label': 'high',
                'data_quality': 'healthy',
                'score_driver': 'window',
            }
            try:
                labels = runtime._build_series_labels(snapshot)
            finally:
                runtime.sink_manager.close()

        self.assertEqual(labels['instance'], 'api-1')
        self.assertNotIn('severity_label', labels)
        self.assertNotIn('confidence_label', labels)
        self.assertNotIn('data_quality', labels)
        self.assertNotIn('score_driver', labels)

    def test_runtime_accepts_plugin_computed_score_feed_for_selected_sink(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            config = Path(tempdir) / 'rules.yml'
            state = Path(tempdir) / 'dynamic.json'
            config.write_text(
                f'''
global:
  prometheus_url: {self.base_url}
sinks:
  loki:
    enabled: true
    url: {self.base_url}
  elasticsearch:
    enabled: true
    url: {self.base_url}
    index_prefix: grafana-anomaly-test
rules: []
''',
                encoding='utf-8',
            )

            runtime = ExporterRuntime(str(config), str(state))
            try:
                result = runtime.ingest_score_feed(
                    {
                        'target': 'elasticsearch',
                        'dashboardUid': 'demo_dashboard',
                        'dashboardTitle': 'Demo Dashboard',
                        'panelId': 7,
                        'panelTitle': 'PostgreSQL service latency',
                        'ruleName': 'postgresql_service_latency',
                        'sourceDatasources': [{'uid': 'pg-main', 'type': 'postgres'}],
                        'resolvedOptions': {'algorithm': 'mad', 'severityPreset': 'page_first', 'sensitivity': 4.0},
                        'series': [
                            {
                                'key': 'series-a',
                                'label': 'checkout latency',
                                'timestamp': 1710000000.123,
                                'value': 143.0,
                                'expected': 100.0,
                                'lower': 80.0,
                                'upper': 120.0,
                                'deviation': 43.0,
                                'rawScore': 3.6,
                                'pointRawScore': 3.6,
                                'windowRawScore': 1.1,
                                'scoreDriver': 'point',
                                'normalizedScore': 96,
                                'severityLabel': 'critical',
                                'isAnomaly': True,
                                'confidenceScore': 91,
                                'confidenceLabel': 'high',
                                'dataQualityLabel': 'healthy',
                            }
                        ],
                        'rule': {
                            'timestamp': 1710000000.123,
                            'score': 96,
                            'rawScore': 3.6,
                            'breachCount': 1,
                            'seriesCount': 1,
                            'activeSeries': 1,
                            'severityLabel': 'critical',
                        },
                    }
                )
                time.sleep(0.3)
                metrics = runtime.read_metrics().decode('utf-8')
            finally:
                runtime.sink_manager.close()

        self.assertEqual(result['target'], 'elasticsearch')
        self.assertEqual(result['acceptedSeries'], 1)
        self.assertEqual(result['registered'][0]['target'], 'elasticsearch')
        self.assertEqual(result['registered'][0]['queryLanguage'], 'Elasticsearch')
        self.assertIn('"index":"grafana-anomaly-test-*"', result['registered'][0]['query'])
        self.assertIn('record_type:rule', result['registered'][0]['query'])
        self.assertNotIn('grafana_anomaly_rule_score', result['registered'][0]['query'])
        self.assertIn('grafana_anomaly_rule_score{', metrics)
        self.assertIn('feed_source="plugin"', metrics)
        self.assertIn('feed_target="elasticsearch"', metrics)
        self.assertIn('source_datasource_type="postgres"', metrics)
        self.assertTrue(any(path == '/_bulk' for path, _, _ in CaptureHandler.requests))
        self.assertFalse(any(path == '/loki/api/v1/push' for path, _, _ in CaptureHandler.requests))

    def test_panel_registration_targets_selected_sink_for_closed_dashboard_recompute(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            config = Path(tempdir) / 'rules.yml'
            state = Path(tempdir) / 'dynamic.json'
            config.write_text(
                f'''
global:
  prometheus_url: {self.base_url}
sinks:
  influxdb:
    enabled: false
    url: http://influxdb:8086
    bucket: anomaly
rules: []
''',
                encoding='utf-8',
            )

            runtime = ExporterRuntime(str(config), str(state))
            try:
                result = runtime.register_panel_sync(
                    {
                        'dashboardUid': 'dash-1',
                        'panelId': 7,
                        'dashboardTitle': 'Source Matrix',
                        'panelTitle': 'Prometheus source -> Influx metrics',
                        'ruleNamePrefix': 'source_matrix_influx',
                        'target': 'influxdb',
                        'syncHash': 'sync-1',
                        'targets': [
                            {
                                'refId': 'A',
                                'expr': 'demo_latency_ms',
                                'legend': 'Server {{instance}} - Login Rate',
                                'datasourceUid': 'prom-main',
                                'datasourceType': 'prometheus',
                                'datasourceUrl': self.base_url,
                            }
                        ],
                        'resolvedOptions': {
                            'algorithm': 'mad',
                            'sensitivity': 4,
                            'baselineWindow': 12,
                            'seasonalitySamples': 24,
                            'seasonalRefinement': 'cycle',
                            'severityPreset': 'page_first',
                            'detectionMode': 'single',
                            'rangeSeconds': 3600,
                            'stepSeconds': 60,
                            'bucketSpanSeconds': 60,
                        },
                    }
                )

                record = runtime.dynamic_registry.list_records()[0]
                self.assertEqual(record.target, 'influxdb')
                self.assertEqual(record.rule.target_sinks, ['influxdb'])
                self.assertEqual(record.rule.datasource_url, self.base_url)
                self.assertEqual(record.rule.range_seconds, 3600)
                self.assertEqual(record.rule.legend, 'Server {{instance}} - Login Rate')
                self.assertEqual(json.loads(state.read_text(encoding='utf-8'))['rules'][0]['rule']['legend'], 'Server {{instance}} - Login Rate')
                self.assertEqual(result['registered'][0]['target'], 'influxdb')
                self.assertEqual(result['registered'][0]['queryLanguage'], 'Flux')

                prometheus_result = runtime.register_panel_sync(
                    {
                        'dashboardUid': 'dash-1',
                        'panelId': 7,
                        'dashboardTitle': 'Source Matrix',
                        'panelTitle': 'Prometheus source -> Prometheus metrics',
                        'ruleNamePrefix': 'source_matrix_prom',
                        'target': 'prometheus',
                        'syncHash': 'sync-2',
                        'targets': [
                            {
                                'refId': 'A',
                                'expr': 'demo_latency_ms',
                                'datasourceUid': 'prom-main',
                                'datasourceType': 'prometheus',
                                'datasourceUrl': self.base_url,
                            }
                        ],
                        'resolvedOptions': {
                            'algorithm': 'mad',
                            'sensitivity': 4,
                            'baselineWindow': 12,
                            'seasonalitySamples': 24,
                            'seasonalRefinement': 'cycle',
                            'severityPreset': 'page_first',
                            'detectionMode': 'single',
                        },
                    }
                )
                prometheus_record = runtime.dynamic_registry.list_records()[0]
                self.assertEqual(prometheus_record.target, 'prometheus')
                self.assertEqual(prometheus_record.rule.target_sinks, [])
                self.assertNotIn('feed_source=', prometheus_result['registered'][0]['query'])
            finally:
                runtime.sink_manager.close()

    def test_closed_recompute_rule_snapshot_wins_over_panel_push_preview(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            config = Path(tempdir) / 'rules.yml'
            state = Path(tempdir) / 'dynamic.json'
            config.write_text('rules: []\n', encoding='utf-8')
            runtime = ExporterRuntime(str(config), str(state))
            closed_rule = RuleSnapshot(
                name='panel_rule',
                algorithm='mad',
                severity_preset='page_first',
                query='source-query',
                series_count=1,
                breach_count=0,
                max_raw_score=0.0,
                max_score=0,
                max_severity_label='normal',
                active_series=1,
                timestamp=1710000005,
            )
            pushed_rule = RuleSnapshot(
                name='panel_rule',
                algorithm='mad',
                severity_preset='page_first',
                query='plugin-computed-score-feed',
                series_count=1,
                breach_count=1,
                max_raw_score=4.2,
                max_score=96,
                max_severity_label='critical',
                active_series=1,
                timestamp=1710000000,
            )
            other_pushed_rule = RuleSnapshot(
                name='push_only_rule',
                algorithm='mad',
                severity_preset='page_first',
                query='plugin-computed-score-feed',
                series_count=1,
                breach_count=1,
                max_raw_score=4.2,
                max_score=96,
                max_severity_label='critical',
                active_series=1,
                timestamp=1710000000,
            )
            try:
                runtime.rule_snapshots = [closed_rule]
                runtime.pushed_feeds = {
                    'dash:1:panel_rule': ([], [pushed_rule], 1710000000),
                    'dash:2:push_only_rule': ([], [other_pushed_rule], 1710000000),
                }

                merged = runtime._merged_rule_snapshots_locked()
            finally:
                runtime.sink_manager.close()

        self.assertEqual([snapshot.name for snapshot in merged], ['panel_rule', 'push_only_rule'])
        self.assertEqual(merged[0].max_score, 0)
        self.assertEqual(merged[1].max_score, 96)

    def test_registered_panel_feed_preview_does_not_write_duplicate_sink_records(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            config = Path(tempdir) / 'rules.yml'
            state = Path(tempdir) / 'dynamic.json'
            config.write_text(
                f'''
global:
  prometheus_url: {self.base_url}
sinks:
  elasticsearch:
    enabled: true
    url: {self.base_url}
    index_prefix: grafana-anomaly-test
rules: []
''',
                encoding='utf-8',
            )

            runtime = ExporterRuntime(str(config), str(state))
            try:
                runtime.register_panel_sync(
                    {
                        'dashboardUid': 'demo_dashboard',
                        'panelId': 7,
                        'dashboardTitle': 'Demo Dashboard',
                        'panelTitle': 'PostgreSQL service latency',
                        'ruleNamePrefix': 'postgresql_service_latency',
                        'target': 'elasticsearch',
                        'syncHash': 'sync-1',
                        'targets': [
                            {
                                'refId': 'A',
                                'expr': 'demo_latency_ms',
                                'datasourceUid': 'prom-main',
                                'datasourceType': 'prometheus',
                                'datasourceUrl': self.base_url,
                            }
                        ],
                        'resolvedOptions': {
                            'algorithm': 'mad',
                            'sensitivity': 4,
                            'baselineWindow': 12,
                            'seasonalitySamples': 24,
                            'seasonalRefinement': 'cycle',
                            'severityPreset': 'page_first',
                            'detectionMode': 'single',
                            'rangeSeconds': 3600,
                            'stepSeconds': 60,
                        },
                    }
                )
                result = runtime.ingest_score_feed(
                    {
                        'target': 'elasticsearch',
                        'dashboardUid': 'demo_dashboard',
                        'dashboardTitle': 'Demo Dashboard',
                        'panelId': 7,
                        'panelTitle': 'PostgreSQL service latency',
                        'ruleName': 'postgresql_service_latency',
                        'sourceDatasources': [{'uid': 'pg-main', 'type': 'postgres'}],
                        'resolvedOptions': {'algorithm': 'mad', 'severityPreset': 'page_first', 'sensitivity': 4.0},
                        'series': [
                            {
                                'key': 'series-a',
                                'label': 'checkout latency',
                                'timestamp': 1710000000.123,
                                'value': 143.0,
                                'expected': 100.0,
                                'lower': 80.0,
                                'upper': 120.0,
                                'deviation': 43.0,
                                'rawScore': 3.6,
                                'pointRawScore': 3.6,
                                'windowRawScore': 1.1,
                                'scoreDriver': 'point',
                                'normalizedScore': 96,
                                'severityLabel': 'critical',
                                'isAnomaly': True,
                                'confidenceScore': 91,
                                'confidenceLabel': 'high',
                                'dataQualityLabel': 'healthy',
                            }
                        ],
                        'rule': {
                            'timestamp': 1710000000.123,
                            'score': 96,
                            'rawScore': 3.6,
                            'breachCount': 1,
                            'seriesCount': 1,
                            'activeSeries': 1,
                            'severityLabel': 'critical',
                        },
                    }
                )
            finally:
                runtime.sink_manager.close()

        self.assertFalse(result['sinkEnqueue']['queued'])
        self.assertIn('backend recompute', result['sinkEnqueue']['reason'])
        self.assertFalse(any(path == '/_bulk' for path, _, _ in CaptureHandler.requests))

    def test_score_feed_registrations_match_selected_store(self) -> None:
        config = AppConfig(
            global_config=GlobalConfig(),
            rules=[],
            sinks={
                'loki': SinkDefinition(name='loki', enabled=True, settings={'url': 'http://loki:3100'}),
                'influxdb': SinkDefinition(name='influxdb', enabled=True, settings={'bucket': 'anomaly', 'measurement': 'grafana_anomaly'}),
                'postgresql': SinkDefinition(name='postgresql', enabled=True, settings={'table': 'grafana_anomaly_scores'}),
                'clickhouse': SinkDefinition(name='clickhouse', enabled=True, settings={'database': 'default', 'table': 'grafana_anomaly_scores'}),
                'elasticsearch': SinkDefinition(name='elasticsearch', enabled=True, settings={'index_prefix': 'grafana-anomaly'}),
            },
        )

        cases = {
            'prometheus': ('PromQL', 'grafana_anomaly_rule_score'),
            'loki': ('LogQL', 'unwrap normalized_score'),
            'influxdb': ('Flux', 'from(bucket: "anomaly")'),
            'postgresql': ('SQL', 'FROM grafana_anomaly_scores'),
            'clickhouse': ('SQL', 'FROM default.grafana_anomaly_scores'),
            'elasticsearch': ('Elasticsearch', '"index":"grafana-anomaly-*"'),
        }
        for target, (language, query_fragment) in cases.items():
            with self.subTest(target=target):
                registration = build_score_feed_registration('checkout_latency', target, config)
                self.assertEqual(registration['target'], target)
                self.assertEqual(registration['queryLanguage'], language)
                self.assertIn(query_fragment, registration['query'])
                self.assertIn('checkout_latency', registration['query'])
                if target == 'loki':
                    self.assertIn('| json normalized_score="normalized_score"', registration['query'])
                    self.assertNotIn('| json | unwrap', registration['query'])

        all_registration = build_score_feed_registration('checkout_latency', 'all', config)
        self.assertEqual(all_registration['target'], 'all')
        self.assertEqual(all_registration['queryLanguage'], 'PromQL')
        self.assertGreaterEqual(len(all_registration['queryVariants']), 6)

    def test_distributed_config_templates_are_loadable_and_feedback_safe(self) -> None:
        exporter_root = Path(__file__).resolve().parents[1]
        default_config = config_loader.load_config(exporter_root / 'config.yml')
        prometheus_config = config_loader.load_config(exporter_root / 'examples' / 'config.prometheus.yml')
        influx_config = config_loader.load_config(exporter_root / 'examples' / 'config.influxdb.yml')
        initial_state = json.loads((exporter_root / 'state' / 'dynamic_rules.json').read_text(encoding='utf-8'))

        self.assertEqual(default_config.rules[0].source_type, 'prometheus')
        self.assertEqual(prometheus_config.rules[0].source_type, 'prometheus')
        self.assertTrue(influx_config.sinks['influxdb'].enabled)
        self.assertEqual(influx_config.rules[0].source_type, 'influxdb')
        self.assertEqual(influx_config.rules[0].target_sinks, ['influxdb'])
        self.assertNotEqual('source-metrics', influx_config.sinks['influxdb'].settings['bucket'])
        self.assertEqual(initial_state, {'version': 1, 'rules': []})


if __name__ == '__main__':
    unittest.main()
