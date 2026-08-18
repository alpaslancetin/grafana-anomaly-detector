jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    post: jest.fn(),
  }),
}));

import { FieldType } from '@grafana/data';
import {
  ANOMALY_THRESHOLD_DEFAULT,
  ANOMALY_THRESHOLD_MAX,
  ANOMALY_THRESHOLD_MIN,
  ANOMALY_THRESHOLD_STEP,
} from '../types';
import { __testables } from './SimplePanel';

const {
  resolveSeriesDisplayName,
  collectPreparedSeries,
  resolveSectionVisibility,
  normalizeScoreFeedEndpoint,
  extractPrometheusTargets,
  buildMetricHintNames,
  buildScoreFeedSyncHash,
  buildPanelScoreFeedRegistrationPayload,
  buildAlertQuery,
  getAlertQueryLanguage,
  buildSelectedAnnotationPayload,
  buildGrafanaErrorMessage,
} = __testables;

describe('SimplePanel helpers', () => {
  it('uses Grafana datasource legend before display overrides and raw metric names', () => {
    expect(
      resolveSeriesDisplayName(
        {
          name: 'login_success_rate',
          config: { displayNameFromDS: 'BIP Login Success Rate', displayName: 'Local override' },
          state: { displayName: 'Generated label' },
        },
        'Query A'
      )
    ).toBe('BIP Login Success Rate');
  });

  it('preserves individual Grafana legends for multiple returned series', () => {
    const prepared = collectPreparedSeries([
      {
        name: 'Login rate',
        fields: [
          { name: 'Time', type: FieldType.time, values: [1, 2], config: {} },
          { name: 'value_a', type: FieldType.number, values: [10, 11], config: { displayNameFromDS: 'Server A - Login Rate' } },
          { name: 'value_b', type: FieldType.number, values: [20, 21], config: { displayNameFromDS: 'Server B - Login Rate' } },
          { name: 'value_c', type: FieldType.number, values: [30, 31], config: { displayNameFromDS: 'Server C - Login Rate' } },
        ],
      },
    ] as any);

    expect(prepared.map((series) => series.label)).toEqual([
      'Server A - Login Rate',
      'Server B - Login Rate',
      'Server C - Login Rate',
    ]);
  });

  it('keeps the existing raw-name fallback when Grafana provides no display label', () => {
    expect(resolveSeriesDisplayName({ name: 'login_success_rate', config: {} }, 'Query A')).toBe('login_success_rate');
  });

  it('defaults legacy dashboards to visible sections and honors mixed visibility', () => {
    expect(resolveSectionVisibility({})).toMatchObject({
      initialLabels: true,
      statistics: true,
      mainChart: true,
      inspector: true,
      anomalyFeed: true,
      seriesSummary: true,
      scoreFeed: true,
      detectionProfile: true,
      exports: true,
    });
    expect(
      resolveSectionVisibility({
        showInspector: false,
        showAnomalyFeed: false,
        showInitialLabels: false,
        showMainChart: true,
      })
    ).toMatchObject({ inspector: false, anomalyFeed: false, initialLabels: false, mainChart: true });
    expect(resolveSectionVisibility({ showSummary: false })).toMatchObject({
      anomalyFeed: false,
      detectionProfile: false,
      exports: false,
    });
  });

  it('uses the supported threshold slider range without changing the stored number type', () => {
    expect({
      min: ANOMALY_THRESHOLD_MIN,
      max: ANOMALY_THRESHOLD_MAX,
      step: ANOMALY_THRESHOLD_STEP,
      defaultValue: ANOMALY_THRESHOLD_DEFAULT,
    }).toEqual({ min: 0.2, max: 10, step: 0.1, defaultValue: 4 });
    expect(typeof ANOMALY_THRESHOLD_DEFAULT).toBe('number');
  });

  it('normalizes score feed endpoints and falls back to the default', () => {
    expect(normalizeScoreFeedEndpoint(' http://localhost:9110/// ')).toBe('http://localhost:9110');
    expect(normalizeScoreFeedEndpoint('   ')).toBe('http://127.0.0.1:9110');
    expect(normalizeScoreFeedEndpoint(undefined)).toBe('http://127.0.0.1:9110');
  });

  it('extracts visible datasource targets and removes duplicates', () => {
    const targets = extractPrometheusTargets([
      null,
      { refId: 'A', expr: 'rate(http_requests_total[5m])', datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'A', expr: 'rate(http_requests_total[5m])', datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'B', expr: 'sum(errors)', hide: true, datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'C', expr: '', datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'D', expr: 'sum(rate({app="api"}[5m]))', datasource: { uid: 'logs', type: 'loki' } },
      { refId: 'E', expr: '$A + $B', datasourceUid: '__expr__', datasourceType: '__expr__' },
      { refId: 'F', expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))', legendFormat: 'p95 latency', datasource: { uid: 'prom-latency', type: 'prometheus' } },
      { refId: 'G', rawSql: 'select ts, value from service_latency', datasource: { uid: 'pg-main', type: 'postgres' } },
    ]);

    expect(targets).toEqual([
      {
        refId: 'A',
        expr: 'rate(http_requests_total[5m])',
        legend: '',
        datasourceUid: 'prom-main',
        datasourceType: 'prometheus',
        datasourceUrl: '',
      },
      {
        refId: 'D',
        expr: 'sum(rate({app="api"}[5m]))',
        legend: '',
        datasourceUid: 'logs',
        datasourceType: 'loki',
        datasourceUrl: '',
      },
      {
        refId: 'F',
        expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
        legend: 'p95 latency',
        datasourceUid: 'prom-latency',
        datasourceType: 'prometheus',
        datasourceUrl: '',
      },
      {
        refId: 'G',
        expr: 'select ts, value from service_latency',
        legend: '',
        datasourceUid: 'pg-main',
        datasourceType: 'postgres',
        datasourceUrl: '',
      },
    ]);
  });

  it('builds metric hints from labels, legends, and expressions without duplicates', () => {
    const hints = buildMetricHintNames(
      ['demo_latency_ms', 'demo_latency_ms', ' request_rate '],
      [
        {
          refId: 'A',
          expr: 'rate(http_requests_total[5m])',
          legend: 'requests',
          datasourceUid: 'prom-main',
          datasourceType: 'prometheus',
        },
        {
          refId: 'B',
          expr: 'rate(http_requests_total[5m])',
          legend: 'requests',
          datasourceUid: 'prom-main',
          datasourceType: 'prometheus',
        },
      ]
    );

    expect(hints).toEqual(['demo_latency_ms', 'request_rate', 'requests', 'rate(http_requests_total[5m])']);
  });

  it('serializes the score feed sync hash with target and resolved option details', () => {
    const hash = buildScoreFeedSyncHash(
      {
        source: 'saved',
        dashboardUid: 'ops-main',
        dashboardTitle: 'Operations',
        panelTitle: 'API latency',
        panelOptions: {},
        targets: [
          {
            refId: 'A',
            expr: 'demo_latency_ms',
            legend: 'latency',
            datasourceUid: 'prom-main',
            datasourceType: 'prometheus',
            datasourceUrl: 'http://prometheus:9090',
          },
        ],
      } as any,
      {
        setupMode: 'recommended',
        metricPreset: 'latency',
        effectiveMetricPreset: 'latency',
        detectionMode: 'single',
        algorithm: 'mad',
        sensitivity: 4.0,
        baselineWindow: 12,
        seasonalitySamples: 24,
        seasonalRefinement: 'cycle',
        severityPreset: 'page_first',
        bucketSpan: 'auto',
        showExpectedLine: true,
        recommendation: {
          source: 'selected',
          badge: 'Noisy data',
          title: 'Latency / duration preset is active',
          reason: 'Latency metrics are often spiky.',
          matchedNames: ['demo_latency_ms'],
          confidence: 'matched',
        },
        maxAnomalies: 8,
      } as any,
      'prod',
      'prometheus'
    );

    expect(JSON.parse(hash)).toMatchObject({
      dashboardUid: 'ops-main',
      panelTitle: 'API latency',
      ruleNamePrefix: 'prod',
      source: 'saved',
      target: 'prometheus',
      targets: [
        {
          refId: 'A',
          expr: 'demo_latency_ms',
          datasourceUid: 'prom-main',
          datasourceType: 'prometheus',
          datasourceUrl: 'http://prometheus:9090',
        },
      ],
      resolvedOptions: {
        algorithm: 'mad',
        detectionMode: 'single',
        severityPreset: 'page_first',
      },
    });
  });

  it('builds a backend panel registration payload for dashboard-closed score feed recompute', () => {
    const registration = buildPanelScoreFeedRegistrationPayload(
      {
        source: 'saved',
        dashboardUid: 'ops-main',
        folderTitle: 'BiP Devops',
        dashboardTitle: 'Source Matrix',
        panelTitle: 'Prometheus source -> Prometheus metrics',
        panelOptions: {},
        rangeSeconds: 1800,
        targets: [
          {
            refId: 'A',
            expr: 'demo_latency_ms',
            legend: 'latency',
            datasourceUid: 'prom-main',
            datasourceType: 'prometheus',
            datasourceUrl: 'http://prometheus:9090',
          },
        ],
      } as any,
      7,
      '[Anomaly]',
      'loki',
      {
        setupMode: 'recommended',
        metricPreset: 'latency',
        effectiveMetricPreset: 'latency',
        detectionMode: 'single',
        algorithm: 'mad',
        sensitivity: 4,
        baselineWindow: 12,
        seasonalitySamples: 24,
        seasonalRefinement: 'cycle',
        severityPreset: 'page_first',
        bucketSpan: '1m',
      } as any,
      'hash-1'
    );

    expect(registration).toMatchObject({
      dashboardUid: 'ops-main',
      panelId: 7,
      panelTitle: 'Prometheus source -> Prometheus metrics',
      target: 'loki',
      ruleNamePrefix: 'anomaly_prometheus_source_prometheus_metrics',
      syncHash: 'hash-1',
      resolvedOptions: {
        algorithm: 'mad',
        sensitivity: 4,
        stepSeconds: 60,
        bucketSpanSeconds: 60,
        rangeSeconds: 1800,
      },
      targets: [{ refId: 'A', legend: 'latency' }],
    });
  });

  it('uses the registered target-specific alert query instead of forcing PromQL', () => {
    const fluxQuery = 'from(bucket: "anomaly") |> range(start: -5m) |> filter(fn: (r) => r.rule == "checkout")';

    expect(
      buildAlertQuery([
        {
          rule: 'checkout',
          target: 'influxdb',
          queryLanguage: 'Flux',
          datasourceType: 'influxdb',
          query: fluxQuery,
          perSeriesQuery: `${fluxQuery} |> filter(fn: (r) => r.record_type == "series")`,
        },
      ])
    ).toBe(fluxQuery);
    expect(
      getAlertQueryLanguage([
        {
          rule: 'checkout',
          target: 'influxdb',
          queryLanguage: 'Flux',
          datasourceType: 'influxdb',
          query: fluxQuery,
          perSeriesQuery: fluxQuery,
        },
      ])
    ).toBe('Flux');
  });

  it('keeps combined PromQL for multiple Prometheus score-feed rules', () => {
    expect(
      buildAlertQuery([
        {
          rule: 'checkout_latency',
          target: 'prometheus',
          queryLanguage: 'PromQL',
          datasourceType: 'prometheus',
          query: 'max_over_time(grafana_anomaly_rule_score{rule="checkout_latency"}[5m])',
          perSeriesQuery: 'grafana_anomaly_score{rule="checkout_latency"}',
        },
        {
          rule: 'checkout_errors',
          target: 'prometheus',
          queryLanguage: 'PromQL',
          datasourceType: 'prometheus',
          query: 'max_over_time(grafana_anomaly_rule_score{rule="checkout_errors"}[5m])',
          perSeriesQuery: 'grafana_anomaly_score{rule="checkout_errors"}',
        },
      ])
    ).toBe('max(max_over_time(grafana_anomaly_rule_score{rule=~"checkout_latency|checkout_errors"}[5m]))');
  });

  it('builds a region annotation payload for a selected point anomaly', () => {
    const payload = buildSelectedAnnotationPayload(
      {
        kind: 'point',
        title: 'Latency spike',
        subtitle: 'API p95 latency',
        seriesKey: 'latency',
        seriesLabel: 'API latency',
        color: '#EAB839',
        time: 1710612000000,
        bucketStart: 1710612000000,
        bucketEnd: 1710612060000,
        actual: 420,
        expected: 215,
        deviation: 205,
        deviationPercent: 95.3,
        rangeLower: 180,
        rangeUpper: 250,
        sampleCount: 1,
        minValue: 420,
        maxValue: 420,
        score: 82.4,
        severityScore: 88,
        severityLabel: 'high',
        confidenceScore: 96,
        confidenceLabel: 'high',
        dataQualityLabel: 'healthy',
      } as any,
      7,
      'ops-main',
      '5 minutes'
    );

    expect(payload).toMatchObject({
      dashboardUID: 'ops-main',
      dashboardUid: 'ops-main',
      panelId: 7,
      time: 1710612000000,
      timeEnd: 1710612060000,
      isRegion: true,
    });
    expect(payload?.tags).toEqual(expect.arrayContaining(['anomaly-detector', 'high', 'healthy', 'point']));
    expect(new Set(payload?.tags).size).toBe(payload?.tags.length);
    expect(payload?.text).toContain('Raw detection score: 82.4');
    expect(payload?.text).toContain('Alert score (0-100): High 88');
    expect(payload?.text).toContain('Expected range: 180 to 250');
    expect(payload?.text).toContain('Window:');
  });

  it('extracts helpful Grafana API error messages', () => {
    expect(buildGrafanaErrorMessage({ data: { message: 'Forbidden' }, status: 403 }, 'fallback')).toBe('Forbidden (HTTP 403)');
    expect(buildGrafanaErrorMessage(new Error('Boom'), 'fallback')).toBe('Boom');
    expect(buildGrafanaErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
