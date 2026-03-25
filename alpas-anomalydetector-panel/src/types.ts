export type SetupMode = 'recommended' | 'advanced';
export type DetectionMode = 'single' | 'multi';
export type DetectionAlgorithm = 'zscore' | 'mad' | 'ewma' | 'seasonal';
export type SeasonalRefinement = 'cycle' | 'hour_of_day' | 'weekday_hour';
export type SeverityPreset = 'balanced' | 'warning_first' | 'page_first';
export type MetricPreset = 'auto' | 'custom' | 'traffic' | 'latency' | 'error_rate' | 'resource' | 'business';
export type BucketSpan = 'auto' | 'raw' | '1m' | '5m' | '15m' | '1h';
export type ScoreFeedMode = 'off' | 'manual' | 'auto';

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
  showSummary: boolean;
  showExports: boolean;
  scoreFeedMode: ScoreFeedMode;
  scoreFeedEndpoint: string;
  scoreFeedRuleNamePrefix: string;
}
