import { PanelPlugin } from '@grafana/data';
import {
  BucketSpan,
  DetectionAlgorithm,
  DetectionMode,
  MarkerShapeMode,
  MetricPreset,
  ScoreFeedMode,
  SeasonalRefinement,
  SetupMode,
  SeverityPreset,
  SimpleOptions,
  TimeAxisDensity,
  TimeAxisPlacement,
} from './types';
import { SimplePanel } from './components/SimplePanel';

const generalCategory = ['Configuration'];
const feedCategory = ['Prometheus score feed'];
const analysisCategory = ['Analysis'];
const advancedCategory = ['Advanced tuning'];
const displayCategory = ['Display'];

const setupModes: Array<{ label: string; value: SetupMode; description: string }> = [
  {
    label: 'Recommended',
    value: 'recommended',
    description: 'Pick the metric type and let the plugin choose the algorithm and severity tuning.',
  },
  {
    label: 'Advanced',
    value: 'advanced',
    description: 'Expose manual algorithm, threshold, and severity controls.',
  },
];

const detectionModes: Array<{ label: string; value: DetectionMode }> = [
  { label: 'Single metric', value: 'single' },
  { label: 'Multi metric', value: 'multi' },
];

const scoreFeedModes: Array<{ label: string; value: ScoreFeedMode; description: string }> = [
  {
    label: 'Auto sync (Recommended)',
    value: 'auto',
    description: 'Read the saved dashboard definition and keep Prometheus score rules in sync automatically.',
  },
  {
    label: 'Manual sync',
    value: 'manual',
    description: 'Show a sync button so users can publish alert-ready score rules on demand.',
  },
  {
    label: 'Off',
    value: 'off',
    description: 'Disable Prometheus score feed for this panel.',
  },
];

const metricPresets: Array<{ label: string; value: Exclude<MetricPreset, 'custom'>; description: string }> = [
  {
    label: 'Auto (Recommended)',
    value: 'auto',
    description: 'Inspect the metric names and choose the safest starting algorithm automatically.',
  },
  {
    label: 'Traffic / throughput',
    value: 'traffic',
    description: 'Good starting point for request rate, throughput, and volume metrics.',
  },
  {
    label: 'Latency / duration',
    value: 'latency',
    description: 'Tuned for latency, p95, and response-time style metrics.',
  },
  {
    label: 'Error rate',
    value: 'error_rate',
    description: 'Tuned for error percentage and error-count spikes.',
  },
  {
    label: 'Resource usage',
    value: 'resource',
    description: 'Useful for CPU, memory, load, saturation, and host metrics.',
  },
  {
    label: 'Business KPI',
    value: 'business',
    description: 'Useful for revenue, signups, conversions, and other cyclical business metrics.',
  },
  {
    label: 'Subtle level shift / drift',
    value: 'level_shift',
    description: 'Best when the baseline changes gradually or steps up/down without a single sharp spike.',
  },
];

const bucketSpans: Array<{ label: string; value: BucketSpan; description: string }> = [
  {
    label: 'Auto',
    value: 'auto',
    description: 'Choose an efficient pre-aggregation span automatically on dense or live data.',
  },
  {
    label: 'Raw samples',
    value: 'raw',
    description: 'Analyze every incoming sample without pre-aggregation.',
  },
  {
    label: '1 minute',
    value: '1m',
    description: 'Aggregate close samples into 1-minute buckets before scoring.',
  },
  {
    label: '5 minutes',
    value: '5m',
    description: 'Aggregate samples into 5-minute buckets before scoring.',
  },
  {
    label: '15 minutes',
    value: '15m',
    description: 'Aggregate samples into 15-minute buckets before scoring.',
  },
  {
    label: '1 hour',
    value: '1h',
    description: 'Aggregate samples into 1-hour buckets before scoring.',
  },
];

const algorithms: Array<{ label: string; value: DetectionAlgorithm; description: string }> = [
  {
    label: 'Rolling z-score',
    value: 'zscore',
    description: 'Fast default for spikes and dips in streaming metrics.',
  },
  {
    label: 'Rolling MAD',
    value: 'mad',
    description: 'Robust against noisy outliers and uneven distributions.',
  },
  {
    label: 'EWMA baseline',
    value: 'ewma',
    description: 'Tracks gradual baseline shifts while still catching sudden jumps.',
  },
  {
    label: 'Seasonal baseline',
    value: 'seasonal',
    description: 'Compares each point with similar positions from earlier cycles.',
  },
  {
    label: 'Level shift detector',
    value: 'level_shift',
    description: 'Looks for sustained baseline changes and subtle step-ups that build over several buckets.',
  },
];

const seasonalRefinements: Array<{ label: string; value: SeasonalRefinement; description: string }> = [
  {
    label: 'Cycle only',
    value: 'cycle',
    description: 'Uses a fixed sample lag such as 24 or 288 samples.',
  },
  {
    label: 'Hour of day',
    value: 'hour_of_day',
    description: 'Matches earlier values from the same hour bucket.',
  },
  {
    label: 'Weekday + hour',
    value: 'weekday_hour',
    description: 'Matches earlier values from the same weekday and hour bucket.',
  },
];

const severityPresets: Array<{ label: string; value: SeverityPreset; description: string }> = [
  {
    label: 'Balanced',
    value: 'balanced',
    description: 'General-purpose default for dashboards and alert handoff.',
  },
  {
    label: 'Warning first',
    value: 'warning_first',
    description: 'Promotes warning and medium severity earlier for watchlist-heavy teams.',
  },
  {
    label: 'Page first',
    value: 'page_first',
    description: 'Keeps high and critical severities stricter for paging workflows.',
  },
];

const timeAxisDensities: Array<{ label: string; value: TimeAxisDensity; description: string }> = [
  {
    label: 'Auto (Recommended)',
    value: 'auto',
    description: 'Choose a readable time tick density automatically from the panel width and visible range.',
  },
  {
    label: 'Compact',
    value: 'compact',
    description: 'Use fewer time labels for dense dashboards and smaller panels.',
  },
  {
    label: 'Balanced',
    value: 'balanced',
    description: 'Keep a mid-density time axis for general dashboard use.',
  },
  {
    label: 'Dense',
    value: 'dense',
    description: 'Show more time labels for close operational tracking.',
  },
];

const timeAxisPlacements: Array<{ label: string; value: TimeAxisPlacement; description: string }> = [
  {
    label: 'Bottom only',
    value: 'bottom',
    description: 'Show time labels only on the bottom axis.',
  },
  {
    label: 'Top + bottom',
    value: 'top_and_bottom',
    description: 'Add a second time guide on top for faster cross-checking during incident review.',
  },
];

const markerShapeModes: Array<{ label: string; value: MarkerShapeMode; description: string }> = [
  {
    label: 'Severity shapes (Recommended)',
    value: 'severity',
    description: 'Use different marker shapes for low, medium, high, and critical anomalies.',
  },
  {
    label: 'Classic circles',
    value: 'classic',
    description: 'Keep the previous circle-style anomaly markers.',
  },
];

export const plugin = new PanelPlugin<SimpleOptions>(SimplePanel).setPanelOptions((builder) => {
  return builder
    .addTextInput({
      path: 'title',
      name: 'Panel title',
      description: 'Short label shown above the anomaly chart.',
      defaultValue: 'Anomaly detector',
      category: generalCategory,
    })
    .addRadio({
      path: 'setupMode',
      name: 'Setup mode',
      description: 'Recommended mode keeps the UI simple. Advanced mode unlocks manual algorithm controls.',
      defaultValue: 'recommended',
      settings: {
        options: setupModes,
      },
      category: generalCategory,
    })
    .addSelect({
      path: 'metricPreset',
      name: 'Metric type',
      description: 'Start with Auto unless you already know the metric family.',
      defaultValue: 'auto',
      settings: {
        options: metricPresets,
      },
      category: generalCategory,
      showIf: (config) => config.setupMode !== 'advanced' && config.metricPreset !== 'custom',
    })
    .addRadio({
      path: 'detectionMode',
      name: 'Detection mode',
      description: 'Single metric scores each series independently. Multi metric combines same-timestamp signals into one event score.',
      defaultValue: 'single',
      settings: {
        options: detectionModes,
      },
      category: generalCategory,
    })
    .addSelect({
      path: 'scoreFeedMode',
      name: 'Score feed mode',
      description: 'Turn this panel into alert-ready Prometheus anomaly score metrics without editing Prometheus YAML.',
      defaultValue: 'auto',
      settings: {
        options: scoreFeedModes,
      },
      category: feedCategory,
    })
    .addTextInput({
      path: 'scoreFeedEndpoint',
      name: 'Exporter endpoint',
      description: 'Browser-side endpoint for the anomaly exporter. The plugin syncs panel rules here and the exporter exposes Prometheus metrics.',
      defaultValue: 'http://127.0.0.1:9110',
      category: feedCategory,
      showIf: (config) => config.scoreFeedMode !== 'off',
    })
    .addTextInput({
      path: 'scoreFeedRuleNamePrefix',
      name: 'Rule name prefix',
      description: 'Optional short prefix used when generating Prometheus anomaly score rule names for this panel.',
      defaultValue: '',
      category: feedCategory,
      showIf: (config) => config.scoreFeedMode !== 'off',
    })
    .addSelect({
      path: 'bucketSpan',
      name: 'Bucket span',
      description: 'Optional pre-aggregation before anomaly scoring. Auto keeps the panel responsive on large or live queries.',
      defaultValue: 'auto',
      settings: {
        options: bucketSpans,
      },
      category: analysisCategory,
    })
    .addSelect({
      path: 'algorithm',
      name: 'Algorithm',
      description: 'Visible in Advanced mode when you want to pick the scoring strategy yourself.',
      defaultValue: 'zscore',
      settings: {
        options: algorithms,
      },
      category: advancedCategory,
      showIf: (config) => config.setupMode === 'advanced' || config.metricPreset === 'custom',
    })
    .addNumberInput({
      path: 'sensitivity',
      name: 'Anomaly threshold',
      description: 'Higher values flag fewer anomalies across all algorithms.',
      defaultValue: 2.8,
      category: advancedCategory,
      showIf: (config) => config.setupMode === 'advanced' || config.metricPreset === 'custom',
    })
    .addNumberInput({
      path: 'baselineWindow',
      name: 'History window',
      description: 'Lookback for z-score and MAD, smoothing horizon for EWMA, and peer depth for seasonal mode.',
      defaultValue: 12,
      category: advancedCategory,
      showIf: (config) => config.setupMode === 'advanced' || config.metricPreset === 'custom',
    })
    .addNumberInput({
      path: 'seasonalitySamples',
      name: 'Season length (samples)',
      description: 'Used by cycle-based seasonal mode. Example: 24 for an hourly pattern or 288 for a daily pattern in 5-minute data.',
      defaultValue: 24,
      category: advancedCategory,
      showIf: (config) => (config.setupMode === 'advanced' || config.metricPreset === 'custom') && config.algorithm === 'seasonal',
    })
    .addSelect({
      path: 'seasonalRefinement',
      name: 'Seasonal refinement',
      description: 'Choose whether seasonal matching is based on fixed cycles, hour-of-day, or weekday plus hour.',
      defaultValue: 'cycle',
      settings: {
        options: seasonalRefinements,
      },
      category: advancedCategory,
      showIf: (config) => (config.setupMode === 'advanced' || config.metricPreset === 'custom') && config.algorithm === 'seasonal',
    })
    .addSelect({
      path: 'severityPreset',
      name: 'Severity preset',
      description: 'Controls how severity scores are translated into warning, high, and critical style labels.',
      defaultValue: 'balanced',
      settings: {
        options: severityPresets,
      },
      category: advancedCategory,
      showIf: (config) => config.setupMode === 'advanced' || config.metricPreset === 'custom',
    })
    .addNumberInput({
      path: 'maxAnomalies',
      name: 'Max anomalies in summary',
      description: 'Limits the number of highest scoring anomalies listed below the chart.',
      defaultValue: 8,
      category: displayCategory,
    })
    .addBooleanSwitch({
      path: 'showBands',
      name: 'Show expected band',
      defaultValue: true,
      category: displayCategory,
    })
    .addBooleanSwitch({
      path: 'showExpectedLine',
      name: 'Show expected line',
      defaultValue: true,
      category: displayCategory,
    })
    .addBooleanSwitch({
      path: 'showSummary',
      name: 'Show anomaly summary',
      defaultValue: true,
      category: displayCategory,
    })
    .addBooleanSwitch({
      path: 'showInlineSeriesLabels',
      name: 'Show inline series labels',
      description: 'Show each series name at the right edge of the chart so the line identity stays visible without scanning the legend.',
      defaultValue: true,
      category: displayCategory,
    })
    .addBooleanSwitch({
      path: 'showFocusBand',
      name: 'Show anomaly focus band',
      description: 'Render a zoomed local band around the selected anomaly for faster incident review.',
      defaultValue: true,
      category: displayCategory,
    })
    .addSelect({
      path: 'timeAxisDensity',
      name: 'Time axis density',
      description: 'Control how many time labels are shown on the chart.',
      defaultValue: 'auto',
      settings: {
        options: timeAxisDensities,
      },
      category: displayCategory,
    })
    .addSelect({
      path: 'timeAxisPlacement',
      name: 'Time axis placement',
      description: 'Choose whether time labels are shown only at the bottom or on both top and bottom edges.',
      defaultValue: 'top_and_bottom',
      settings: {
        options: timeAxisPlacements,
      },
      category: displayCategory,
    })
    .addSelect({
      path: 'markerShapeMode',
      name: 'Anomaly marker style',
      description: 'Choose whether severity is communicated with different marker shapes or with classic circular markers.',
      defaultValue: 'severity',
      settings: {
        options: markerShapeModes,
      },
      category: displayCategory,
    })
    .addBooleanSwitch({
      path: 'showExports',
      name: 'Show export blocks',
      defaultValue: true,
      category: displayCategory,
      showIf: (config) => config.showSummary !== false,
    });
});
