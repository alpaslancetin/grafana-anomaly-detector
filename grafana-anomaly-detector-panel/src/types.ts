export type SetupMode = 'recommended' | 'advanced';
export type DetectionMode = 'single' | 'multi';
export type DetectionAlgorithm = 'zscore' | 'mad' | 'ewma' | 'seasonal' | 'level_shift';
export type SeasonalRefinement = 'cycle' | 'hour_of_day' | 'weekday_hour';
export type SeverityPreset = 'balanced' | 'warning_first' | 'page_first';
export type MetricPreset = 'auto' | 'custom' | 'traffic' | 'latency' | 'error_rate' | 'resource' | 'business' | 'level_shift';
export type BucketSpan = 'auto' | 'raw' | '1m' | '5m' | '15m' | '1h';
export type ScoreFeedMode = 'off' | 'manual' | 'auto';
export type ScoreFeedTarget = 'prometheus' | 'loki' | 'influxdb' | 'postgresql' | 'clickhouse' | 'elasticsearch';
export type TimeAxisDensity = 'auto' | 'compact' | 'balanced' | 'dense';
export type TimeAxisPlacement = 'bottom' | 'top_and_bottom';
export type MarkerShapeMode = 'classic' | 'severity';

export const ANOMALY_THRESHOLD_MIN = 0.2;
export const ANOMALY_THRESHOLD_MAX = 10;
export const ANOMALY_THRESHOLD_STEP = 0.1;
export const ANOMALY_THRESHOLD_DEFAULT = 4;

export interface SimpleOptions {
  title: string;
  setupMode: SetupMode;
  metricPreset: MetricPreset;
  detectionMode: DetectionMode;
  algorithm: DetectionAlgorithm;
  sensitivity: number;
  baselineWindow: number;
  seasonalitySamples: number;
  seasonalRefinement: SeasonalRefinement;
  severityPreset: SeverityPreset;
  bucketSpan: BucketSpan;
  maxAnomalies: number;
  showBands: boolean;
  showExpectedLine: boolean;
  /** Kept so dashboards saved before section-level controls retain their layout. */
  showSummary: boolean;
  showInitialLabels: boolean;
  showStatistics: boolean;
  showMainChart: boolean;
  showInspector: boolean;
  showAnomalyFeed: boolean;
  showSeriesSummary: boolean;
  showScoreFeed: boolean;
  showDetectionProfile: boolean;
  showExports: boolean;
  showInlineSeriesLabels: boolean;
  showFocusBand: boolean;
  timeAxisDensity: TimeAxisDensity;
  timeAxisPlacement: TimeAxisPlacement;
  markerShapeMode: MarkerShapeMode;
  scoreFeedMode: ScoreFeedMode;
  scoreFeedTarget: ScoreFeedTarget;
  scoreFeedEndpoint: string;
  scoreFeedRuleNamePrefix: string;
}
