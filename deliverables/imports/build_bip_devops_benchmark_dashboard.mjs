import fs from 'node:fs';
import path from 'node:path';

const repoRoot = 'C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab';
const desktopRoot = 'C:/Users/alpas/Desktop/Grafana_upgrade/anomaly_detector';
const exporterEndpoint = 'http://192.168.51.45:9110';
const outputs = [
  path.join(repoRoot, 'deliverables', 'imports', 'BiP_Devops_Anomaly_Detector_Benchmark.dashboard.json'),
  path.join(desktopRoot, 'imports', 'BiP_Devops_Anomaly_Detector_Benchmark.dashboard.json'),
];

const metrics = [
  {
    record: 'xmpp_p2p',
    job: 'elastic-ml-xmpp-p2p',
    title: 'xmpp_p2p',
    preset: 'traffic',
    severity: 'warning_first',
    query: 'sum(increase(xmpp_messages_total{name="O_P2P"}[5m]))',
  },
  {
    record: 'xmpp_online',
    job: 'elastic-ml-xmpp_online',
    title: 'xmpp_online',
    preset: 'traffic',
    severity: 'balanced',
    query: 'sum(xmpp_online{name="online"})',
  },
  {
    record: 'xmpp_available',
    job: 'elastic-ml-xmpp_available',
    title: 'xmpp_available',
    preset: 'traffic',
    severity: 'balanced',
    query: 'sum(xmpp_online{name="available"})',
  },
  {
    record: 'xmpp_threads',
    job: 'elastic-ml-xmpp_threads',
    title: 'xmpp_threads',
    preset: 'resource',
    severity: 'balanced',
    query: 'sum(xmpp_threads{name="client", param="active"})',
  },
  {
    record: 'xmpp_MessageRouter',
    job: 'elastic-ml-xmpp_MessageRouter',
    title: 'xmpp_MessageRouter',
    preset: 'resource',
    severity: 'balanced',
    query: 'sum(xmpp_threads{name="MessageRouter", param="active"})',
  },
  {
    record: 'xmpp_routepacket_count',
    job: 'elastic-ml-xmpp_routepacket_count',
    title: 'xmpp_routepacket_count',
    preset: 'traffic',
    severity: 'warning_first',
    query: 'sum(increase(xmpp_stats_total{name="ROUTEPACKET_COUNT"}[5m]))',
  },
  {
    record: 'xmpp_group_create',
    job: 'elastic-ml-xmpp_group_create',
    title: 'xmpp_group_create',
    preset: 'business',
    severity: 'balanced',
    query: 'sum(increase(xmpp_stats_total{name="ROOM_CREATED_COUNT"}[5m]))',
  },
  {
    record: 'imos_total_register',
    job: 'elastic-ml-imos_total_register',
    title: 'imos_total_register',
    preset: 'traffic',
    severity: 'balanced',
    query: 'sum(increase(location_imos_request_received_count{country="90"}[5m]))',
  },
  {
    record: 'imos_unsuccessfull_register',
    job: 'elastic-ml-imos_unsuccessfull_register',
    title: 'imos_unsuccessfull_register',
    preset: 'error_rate',
    severity: 'page_first',
    query: 'sum(increase(counter_action{job="imos",endpoint=~"REST", action="create", result!~"200|201"}[5m]))',
  },
  {
    record: 'pnsender_android_total_pn',
    job: 'elastic-ml-pnsender_android_total_pn',
    title: 'pnsender_android_total_pn',
    preset: 'traffic',
    severity: 'warning_first',
    query: 'sum(increase(counter_pn_action{os="android", action="request", status="received"}[5m]))',
  },
  {
    record: 'pnsender_ios_total_pn',
    job: 'elastic-ml-pnsender_ios_total_pn',
    title: 'pnsender_ios_total_pn',
    preset: 'traffic',
    severity: 'warning_first',
    query: 'sum(increase(counter_pn_action{os="ios", action="request", status="received"}[5m]))',
  },
  {
    record: 'otp_tr_suc_rate',
    job: 'elastic-ml-otp_tr_suc_rate',
    title: 'otp_tr_suc_rate',
    preset: 'business',
    severity: 'page_first',
    query:
      '(sum(increase(stos_send_otp_counter{region="90", action="verified"}[10m]))*100) / sum(increase(stos_send_otp_counter{region="90", action="processed"}[10m]))',
  },
];

const ds = { type: 'prometheus', uid: '${DS_PROMETHEUS}' };

const buildTextPanel = () => ({
  id: 1,
  type: 'text',
  title: 'Import Notes',
  gridPos: { h: 5, w: 24, x: 0, y: 0 },
  options: {
    mode: 'markdown',
    content: [
      '# BiP Devops / Anomaly Detector Benchmark',
      '',
      '- Bu dashboard `BiP Devops` klasoru altina import edilmek uzere hazirlandi.',
      '- Datasource secimi import sirasinda Prometheus olarak yapilmalidir.',
      '- Panel queryleri, verdigin ham PromQL ifadelerini dogrudan kullanir.',
      `- Score feed \`Auto sync\` olarak acik gelir; exporter endpoint varsayilani \`${exporterEndpoint}\``,
      '- Import sonrasi dashboard kaydedilip anomaly panel kartlarindan score feed rule sync dogrulanmalidir.',
    ].join('\n'),
  },
  transparent: false,
});

const buildPanel = (metric, index) => {
  const jobSlug = metric.job.replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase();
  const panelTitle = `${metric.record} | ${metric.job}`;
  const panelHeight = 14;
  const topOffset = 5;
  return {
    datasource: ds,
    description: metric.query,
    gridPos: {
      h: panelHeight,
      w: 24,
      x: 0,
      y: topOffset + index * panelHeight,
    },
    id: index + 2,
    options: {
      title: panelTitle,
      setupMode: 'recommended',
      metricPreset: metric.preset,
      detectionMode: 'single',
      algorithm: 'mad',
      sensitivity: 2.8,
      baselineWindow: 12,
      seasonalitySamples: 24,
      seasonalRefinement: 'cycle',
      severityPreset: metric.severity,
      bucketSpan: 'auto',
      maxAnomalies: 6,
      showBands: true,
      showExpectedLine: true,
      showSummary: true,
      showExports: false,
      showInlineSeriesLabels: true,
      showFocusBand: true,
      timeAxisDensity: 'auto',
      timeAxisPlacement: 'top_and_bottom',
      markerShapeMode: 'severity',
      scoreFeedMode: 'auto',
      scoreFeedEndpoint: exporterEndpoint,
      scoreFeedRuleNamePrefix: `bip_devops_${metric.record.toLowerCase()}_${jobSlug}`,
    },
    targets: [
      {
        datasource: ds,
        editorMode: 'code',
        expr: metric.query,
        legendFormat: metric.record,
        range: true,
        refId: 'A',
      },
    ],
    title: panelTitle,
    type: 'alpas-anomalydetector-panel',
  };
};

const dashboard = {
  __inputs: [
    {
      name: 'DS_PROMETHEUS',
      label: 'Prometheus',
      description: 'BiP Devops benchmark datasource',
      type: 'datasource',
      pluginId: 'prometheus',
      pluginName: 'Prometheus',
    },
  ],
  __requires: [
    {
      type: 'grafana',
      id: 'grafana',
      name: 'Grafana',
      version: '12.4.1',
    },
    {
      type: 'panel',
      id: 'alpas-anomalydetector-panel',
      name: 'Anomaly Detector',
      version: '1.2.0',
    },
    {
      type: 'datasource',
      id: 'prometheus',
      name: 'Prometheus',
      version: '1.0.0',
    },
  ],
  annotations: {
    list: [
      {
        builtIn: 1,
        datasource: {
          type: 'grafana',
          uid: '-- Grafana --',
        },
        enable: true,
        hide: true,
        iconColor: 'rgba(0, 211, 255, 1)',
        name: 'Annotations & Alerts',
        type: 'dashboard',
      },
    ],
  },
  editable: true,
  fiscalYearStartMonth: 0,
  graphTooltip: 1,
  id: null,
  links: [],
  liveNow: false,
  panels: [buildTextPanel(), ...metrics.map(buildPanel)],
  refresh: '1m',
  schemaVersion: 39,
  tags: ['bip', 'devops', 'anomaly', 'benchmark', 'elastic-ml'],
  templating: { list: [] },
  time: { from: 'now-24h', to: 'now' },
  timepicker: {},
  timezone: 'browser',
  title: 'Anomaly Detector Benchmark',
  uid: 'bip-devops-anomaly-benchmark',
  version: 1,
  weekStart: '',
};

for (const output of outputs) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');
}

console.log(outputs.join('\n'));
