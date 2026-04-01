jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    post: jest.fn(),
  }),
}));

import { __testables } from './SimplePanel';

const {
  normalizeScoreFeedEndpoint,
  extractPrometheusTargets,
  buildMetricHintNames,
  buildScoreFeedSyncHash,
  buildSelectedAnnotationPayload,
  buildGrafanaErrorMessage,
} = __testables;

describe('SimplePanel helpers', () => {
  it('normalizes score feed endpoints and falls back to the default', () => {
    expect(normalizeScoreFeedEndpoint(' http://localhost:9110/// ')).toBe('http://localhost:9110');
    expect(normalizeScoreFeedEndpoint('   ')).toBe('http://127.0.0.1:9110');
    expect(normalizeScoreFeedEndpoint(undefined)).toBe('http://127.0.0.1:9110');
  });

  it('extracts only supported Prometheus targets and removes duplicates', () => {
    const targets = extractPrometheusTargets([
      null,
      { refId: 'A', expr: 'rate(http_requests_total[5m])', datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'A', expr: 'rate(http_requests_total[5m])', datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'B', expr: 'sum(errors)', hide: true, datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'C', expr: '', datasource: { uid: 'prom-main', type: 'prometheus' } },
      { refId: 'D', expr: 'sum(rate({app="api"}[5m]))', datasource: { uid: 'logs', type: 'loki' } },
      { refId: 'E', expr: '$A + $B', datasourceUid: '__expr__', datasourceType: '__expr__' },
      { refId: 'F', expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))', legendFormat: 'p95 latency', datasource: { uid: 'prom-latency', type: 'prometheus' } },
    ]);

    expect(targets).toEqual([
      {
        refId: 'A',
        expr: 'rate(http_requests_total[5m])',
        legend: '',
        datasourceUid: 'prom-main',
        datasourceType: 'prometheus',
      },
      {
        refId: 'F',
        expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
        legend: 'p95 latency',
        datasourceUid: 'prom-latency',
        datasourceType: 'prometheus',
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
          },
        ],
      } as any,
      {
        setupMode: 'recommended',
        metricPreset: 'latency',
        effectiveMetricPreset: 'latency',
        detectionMode: 'single',
        algorithm: 'mad',
        sensitivity: 2.4,
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
      'prod'
    );

    expect(JSON.parse(hash)).toMatchObject({
      dashboardUid: 'ops-main',
      panelTitle: 'API latency',
      ruleNamePrefix: 'prod',
      source: 'saved',
      targets: [
        {
          refId: 'A',
          expr: 'demo_latency_ms',
          datasourceUid: 'prom-main',
          datasourceType: 'prometheus',
        },
      ],
      resolvedOptions: {
        algorithm: 'mad',
        detectionMode: 'single',
        severityPreset: 'page_first',
      },
    });
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
        severityScore: 100,
        severityLabel: 'critical',
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
    expect(payload?.tags).toEqual(expect.arrayContaining(['anomaly-detector', 'critical', 'point']));
    expect(payload?.text).toContain('Expected range: 180 to 250');
    expect(payload?.text).toContain('Window:');
  });

  it('extracts helpful Grafana API error messages', () => {
    expect(buildGrafanaErrorMessage({ data: { message: 'Forbidden' }, status: 403 }, 'fallback')).toBe('Forbidden (HTTP 403)');
    expect(buildGrafanaErrorMessage(new Error('Boom'), 'fallback')).toBe('Boom');
    expect(buildGrafanaErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
