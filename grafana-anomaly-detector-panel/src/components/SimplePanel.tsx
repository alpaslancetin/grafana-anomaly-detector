import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dateTimeFormat, FieldType, PanelProps, timeZoneAbbrevation, TimeZone } from '@grafana/data';
import { css } from '@emotion/css';
import { useTheme2 } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import {
  BucketSpan,
  DetectionAlgorithm,
  DetectionMode,
  MarkerShapeMode,
  MetricPreset,
  ScoreFeedMode,
  ScoreFeedTarget,
  SeasonalRefinement,
  SetupMode,
  SeverityPreset,
  SimpleOptions,
  TimeAxisDensity,
  TimeAxisPlacement,
} from '../types';
import { analyzePoints as analyzeCanonicalPoints, resolveValueDomain } from '../scoring';

interface Props extends PanelProps<SimpleOptions> {}

type VectorLike = {
  length?: number;
  get?: (index: number) => unknown;
  [key: number]: unknown;
};

type SeverityLabel = 'normal' | 'low' | 'medium' | 'high' | 'critical';
type ConfidenceLabel = 'low' | 'medium' | 'high';
type DataQualityLabel = 'healthy' | 'thin' | 'flatline' | 'gappy';
type EffectiveMetricPreset = Exclude<MetricPreset, 'auto' | 'custom'>;
type AutoMatchConfidence = 'matched' | 'weak' | 'fallback';
type RecommendationSource = 'auto' | 'selected' | 'manual';
type MarkerShape = 'circle' | 'diamond' | 'triangle' | 'square';

type SelectionToken =
  | { kind: 'point'; seriesKey: string; time: number }
  | { kind: 'event'; time: number };

interface SeverityState {
  severityScore: number;
  severityLabel: SeverityLabel;
}

interface ConfidenceState {
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  dataQualityLabel: DataQualityLabel;
}

interface RawPoint {
  time: number;
  value: number;
  bucketStart: number;
  bucketEnd: number;
  sampleCount: number;
  minValue: number;
  maxValue: number;
}

interface SamplePoint extends RawPoint, SeverityState, ConfidenceState {
  expected: number | null;
  upper: number | null;
  lower: number | null;
  score: number;
  pointScore: number;
  windowScore: number;
  scoreDriver: 'point' | 'window';
  isAnomaly: boolean;
}

interface SeriesAnalysis {
  key: string;
  label: string;
  color: string;
  points: SamplePoint[];
  allPoints: SamplePoint[];
  anomalyCount: number;
  maxScore: number;
  maxSeverityScore: number;
  maxSeverityLabel: SeverityLabel;
  sourcePointCount: number;
  aggregatedPointCount: number;
  processedPointCount: number;
}

interface MultiMetricEvent extends SeverityState, ConfidenceState {
  time: number;
  bucketStart: number;
  bucketEnd: number;
  score: number;
  contributors: string[];
  activeSeries: number;
  isAnomaly: boolean;
}

interface SummaryItem extends SeverityState, ConfidenceState {
  key: string;
  time: number;
  title: string;
  subtitle: string;
  detail: string;
  score: number;
  selection: SelectionToken;
}

interface DetailMetricRow extends SeverityState, ConfidenceState {
  label: string;
  color: string;
  actual: number;
  expected: number | null;
  deviation: number | null;
  rangeLower: number | null;
  rangeUpper: number | null;
  score: number;
  pointScore: number;
  windowScore: number;
  scoreDriver: 'point' | 'window';
}

interface PointSelectionDetail extends SeverityState, ConfidenceState {
  kind: 'point';
  title: string;
  subtitle: string;
  seriesKey: string;
  seriesLabel: string;
  color: string;
  time: number;
  bucketStart: number;
  bucketEnd: number;
  actual: number;
  expected: number | null;
  deviation: number | null;
  deviationPercent: number | null;
  rangeLower: number | null;
  rangeUpper: number | null;
  sampleCount: number;
  minValue: number;
  maxValue: number;
  score: number;
  pointScore: number;
  windowScore: number;
  scoreDriver: 'point' | 'window';
}

interface EventSelectionDetail extends SeverityState, ConfidenceState {
  kind: 'event';
  title: string;
  subtitle: string;
  time: number;
  bucketStart: number;
  bucketEnd: number;
  score: number;
  activeSeries: number;
  contributors: string[];
  breakdown: DetailMetricRow[];
}

type SelectionDetail = PointSelectionDetail | EventSelectionDetail;

interface MetricPresetConfig {
  algorithm: DetectionAlgorithm;
  sensitivity: number;
  baselineWindow: number;
  seasonalitySamples: number;
  seasonalRefinement: SeasonalRefinement;
  severityPreset: SeverityPreset;
  badge: string;
  why: string;
}

interface MetricPresetRecommendation {
  source: RecommendationSource;
  badge: string;
  title: string;
  reason: string;
  matchedNames: string[];
  confidence: AutoMatchConfidence;
}

interface AutoPresetMatch {
  preset: EffectiveMetricPreset;
  matchedNames: string[];
  confidence: AutoMatchConfidence;
}

interface ResolvedOptions {
  setupMode: SetupMode;
  metricPreset: MetricPreset;
  effectiveMetricPreset: EffectiveMetricPreset | 'custom';
  detectionMode: DetectionMode;
  algorithm: DetectionAlgorithm;
  sensitivity: number;
  baselineWindow: number;
  seasonalitySamples: number;
  seasonalRefinement: SeasonalRefinement;
  severityPreset: SeverityPreset;
  bucketSpan: BucketSpan;
  showExpectedLine: boolean;
  showInlineSeriesLabels: boolean;
  showFocusBand: boolean;
  timeAxisDensity: TimeAxisDensity;
  timeAxisPlacement: TimeAxisPlacement;
  markerShapeMode: MarkerShapeMode;
  recommendation: MetricPresetRecommendation;
  maxAnomalies: number;
}

interface InlineSeriesLabel {
  key: string;
  label: string;
  color: string;
  targetY: number;
  labelY: number;
  anchorX: number;
  lastX: number;
  lastY: number;
  width: number;
  value: number;
}

interface FocusBandSeries {
  key: string;
  label: string;
  color: string;
  points: SamplePoint[];
}

interface FocusBandModel {
  startTime: number;
  endTime: number;
  selectedTime: number;
  bucketStart: number;
  bucketEnd: number;
  title: string;
  series: FocusBandSeries[];
  minValue: number;
  maxValue: number;
}

interface IncidentRibbonSegment extends SeverityState {
  key: string;
  start: number;
  end: number;
  center: number;
  count: number;
  label: string;
  selection: SelectionToken;
}

interface HoverSeriesSnapshot extends SeverityState, ConfidenceState {
  key: string;
  label: string;
  color: string;
  actual: number;
  expected: number | null;
  score: number;
  isAnomaly: boolean;
}

interface HoverSnapshot extends SeverityState {
  time: number;
  event: MultiMetricEvent | null;
  series: HoverSeriesSnapshot[];
  anomalyCount: number;
}

interface ChartFrame {
  width: number;
  height: number;
}

interface PreparedSeries {
  key: string;
  label: string;
  preservesGrafanaDisplayName: boolean;
  color: string;
  rawPoints: RawPoint[];
}

interface SeriesDisplayNameField {
  name?: string;
  config?: {
    displayNameFromDS?: string;
    displayName?: string;
  };
  state?: {
    displayName?: string | null;
  } | null;
}

interface SectionVisibility {
  initialLabels: boolean;
  statistics: boolean;
  mainChart: boolean;
  inspector: boolean;
  anomalyFeed: boolean;
  seriesSummary: boolean;
  scoreFeed: boolean;
  detectionProfile: boolean;
  exports: boolean;
}

interface AnalysisBuildResult {
  analyses: SeriesAnalysis[];
  effectiveBucketSpanMs: number | null;
}

interface FeedQueryTarget {
  refId: string;
  expr: string;
  legend: string;
  datasourceUid: string;
  datasourceType: string;
  datasourceUrl?: string;
}

type FeedSource = 'saved' | 'live';
type ScoreFeedStatusKind = 'off' | 'idle' | 'syncing' | 'synced' | 'error' | 'unsupported';

interface PanelSyncContext {
  source: FeedSource;
  dashboardUid: string;
  folderTitle?: string;
  dashboardTitle: string;
  panelTitle: string;
  targets: FeedQueryTarget[];
  panelOptions: Partial<SimpleOptions>;
  rangeSeconds?: number;
  stepSeconds?: number;
}

interface ScoreFeedRule {
  rule: string;
  query: string;
  perSeriesQuery: string;
  target?: ScoreFeedTarget | string;
  queryLanguage?: string;
  datasourceType?: string;
  queryVariants?: ScoreFeedQueryVariant[];
}

interface ScoreFeedQueryVariant {
  target: ScoreFeedTarget | string;
  queryLanguage: string;
  datasourceType: string;
  query: string;
  perSeriesQuery: string;
}

interface ScoreFeedState {
  kind: ScoreFeedStatusKind;
  message: string;
  source: FeedSource | null;
  registered: ScoreFeedRule[];
  removed: string[];
  lastSyncedAt: number | null;
  syncHash: string;
}

interface ScoreFeedHookInput {
  panelId: number;
  panelTitle: string;
  options: SimpleOptions;
  resolvedOptions: ResolvedOptions;
  liveTargets: FeedQueryTarget[];
  analyses: SeriesAnalysis[];
  timeRangeSeconds: number;
  queryStepSeconds: number;
}

interface ScoreFeedController extends ScoreFeedState {
  syncNow: () => Promise<void>;
}

interface ComputedScoreFeedSeriesPayload {
  key: string;
  label: string;
  timestamp: number;
  value: number;
  expected: number | null;
  lower: number | null;
  upper: number | null;
  deviation: number | null;
  rawScore: number;
  pointRawScore: number;
  windowRawScore: number;
  scoreDriver: 'point' | 'window';
  normalizedScore: number;
  severityLabel: SeverityLabel;
  isAnomaly: boolean;
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  dataQualityLabel: DataQualityLabel;
  threshold: number;
}

interface ComputedScoreFeedPayload {
  dashboardUid: string;
  folderTitle?: string;
  dashboardTitle: string;
  panelId: number;
  panelTitle: string;
  ruleName: string;
  target: ScoreFeedTarget;
  source: FeedSource;
  sourceDatasources: Array<{ uid: string; type: string }>;
  series: ComputedScoreFeedSeriesPayload[];
  rule: {
    timestamp: number;
    score: number;
    rawScore: number;
    breachCount: number;
    seriesCount: number;
    activeSeries: number;
    severityLabel: SeverityLabel;
  };
  resolvedOptions: {
    algorithm: DetectionAlgorithm;
    severityPreset: SeverityPreset;
    sensitivity: number;
  };
}

interface PanelScoreFeedRegistrationPayload {
  dashboardUid: string;
  folderTitle?: string;
  dashboardTitle: string;
  panelId: number;
  panelTitle: string;
  ruleNamePrefix: string;
  target: ScoreFeedTarget;
  source: FeedSource;
  syncHash: string;
  targets: FeedQueryTarget[];
  resolvedOptions: {
    setupMode: SetupMode;
    metricPreset: MetricPreset;
    effectiveMetricPreset: EffectiveMetricPreset | 'custom';
    detectionMode: DetectionMode;
    algorithm: DetectionAlgorithm;
    sensitivity: number;
    baselineWindow: number;
    seasonalitySamples: number;
    seasonalRefinement: SeasonalRefinement;
    severityPreset: SeverityPreset;
    rangeSeconds: number;
    stepSeconds: number;
    bucketSpanSeconds: number;
  };
}

interface ActionToast {
  tone: 'success' | 'error';
  message: string;
}

interface AlertRuleDraftContext {
  dashboardUid: string;
  folderTitle?: string;
  dashboardTitle: string;
  panelId: number;
  panelTitle: string;
  ruleName: string;
  queryLanguage: string;
  alertQuery: string;
  threshold: number;
  target: ScoreFeedTarget | string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

interface GrafanaAnnotationPayload {
  dashboardUID?: string;
  dashboardUid?: string;
  panelId?: number;
  time: number;
  timeEnd?: number;
  isRegion?: boolean;
  tags: string[];
  text: string;
}
const SERIES_COLORS = ['#7EB26D', '#EAB839', '#6ED0E0', '#EF843C', '#E24D42', '#1F78C1'];
const MAX_RENDER_POINTS = 720;
const AUTO_TARGET_POINTS = 640;
const PADDING = { top: 18, right: 20, bottom: 42, left: 64 };

const BUCKET_SPAN_MS: Record<Exclude<BucketSpan, 'auto' | 'raw'>, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

const EXPLICIT_BUCKET_SPANS = Object.values(BUCKET_SPAN_MS).sort((left, right) => left - right);

const SETUP_MODE_LABELS: Record<SetupMode, string> = {
  recommended: 'Recommended',
  advanced: 'Advanced',
};

const ALGORITHM_LABELS: Record<DetectionAlgorithm, string> = {
  zscore: 'Rolling z-score',
  mad: 'Rolling MAD',
  ewma: 'EWMA baseline',
  seasonal: 'Seasonal baseline',
  level_shift: 'Level shift detector',
};

const METRIC_PRESET_LABELS: Record<MetricPreset, string> = {
  auto: 'Auto',
  custom: 'Custom',
  traffic: 'Traffic / throughput',
  latency: 'Latency / duration',
  error_rate: 'Error rate',
  resource: 'Resource usage',
  business: 'Business KPI',
  level_shift: 'Subtle level shift',
};

const BUCKET_SPAN_LABELS: Record<BucketSpan, string> = {
  auto: 'Auto',
  raw: 'Raw samples',
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
};

const METRIC_PRESET_CONFIGS: Record<EffectiveMetricPreset, MetricPresetConfig> = {
  traffic: {
    algorithm: 'ewma',
    sensitivity: 4.5,
    baselineWindow: 30,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'warning_first',
    badge: 'Stable default',
    why: 'Traffic and throughput metrics drift with load, so EWMA is usually the safest default for live dashboards.',
  },
  latency: {
    algorithm: 'mad',
    sensitivity: 4.0,
    baselineWindow: 12,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'page_first',
    badge: 'Noisy data',
    why: 'Latency metrics are often spiky and outlier-heavy, so MAD is more robust than a mean-based baseline.',
  },
  error_rate: {
    algorithm: 'mad',
    sensitivity: 4.5,
    baselineWindow: 12,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'page_first',
    badge: 'Burst errors',
    why: 'Error metrics often stay low and then jump sharply, so MAD isolates bursts without letting them poison the baseline.',
  },
  resource: {
    algorithm: 'ewma',
    sensitivity: 4.5,
    baselineWindow: 24,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'balanced',
    badge: 'Drifting baseline',
    why: 'CPU, memory, and load metrics usually move gradually, so EWMA follows the baseline smoothly without overreacting.',
  },
  business: {
    algorithm: 'seasonal',
    sensitivity: 4.5,
    baselineWindow: 8,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'balanced',
    badge: 'Seasonal data',
    why: 'Business KPIs often repeat by hour or weekday, so seasonal matching reduces false positives on recurring patterns.',
  },
  level_shift: {
    algorithm: 'level_shift',
    sensitivity: 6.0,
    baselineWindow: 30,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'balanced',
    badge: 'Sustained change',
    why: 'When the baseline shifts gradually or steps into a new level, a level-shift detector is better than a pure spike detector.',
  },
};
const AUTO_PRESET_PRIORITY: EffectiveMetricPreset[] = ['latency', 'error_rate', 'level_shift', 'resource', 'business', 'traffic'];

const AUTO_PRESET_RULES: Array<{ preset: EffectiveMetricPreset; patterns: RegExp[] }> = [
  {
    preset: 'latency',
    patterns: [/latency/i, /duration/i, /response/i, /p95/i, /p99/i, /p90/i, /quantile/i, /delay/i, /ms/i, /seconds?/i],
  },
  {
    preset: 'error_rate',
    patterns: [/error/i, /errors/i, /failure/i, /fail/i, /exception/i, /timeout/i, /reject/i, /5xx/i, /4xx/i],
  },
  {
    preset: 'resource',
    patterns: [/cpu/i, /memory/i, /load/i, /utili/i, /usage/i, /heap/i, /rss/i, /disk/i, /iops/i, /saturation/i, /throttle/i],
  },
  {
    preset: 'level_shift',
    patterns: [/queue/i, /backlog/i, /pending/i, /session/i, /connection/i, /thread/i, /pool/i, /worker/i, /lag/i, /offset/i, /buffer/i, /inflight/i, /active/i],
  },
  {
    preset: 'business',
    patterns: [/revenue/i, /order/i, /orders/i, /signup/i, /conversion/i, /checkout/i, /cart/i, /booking/i, /payment/i, /sales/i, /gmv/i],
  },
  {
    preset: 'traffic',
    patterns: [/request/i, /requests/i, /throughput/i, /traffic/i, /volume/i, /events?/i, /rps/i, /qps/i, /ops/i, /hits?/i, /ingress/i, /egress/i, /count/i],
  },
];

const SEASONAL_REFINEMENT_LABELS: Record<SeasonalRefinement, string> = {
  cycle: 'Cycle only',
  hour_of_day: 'Hour of day',
  weekday_hour: 'Weekday + hour',
};

const SEVERITY_PRESET_LABELS: Record<SeverityPreset, string> = {
  balanced: 'Balanced',
  warning_first: 'Warning first',
  page_first: 'Page first',
};

const SEVERITY_LABELS: Record<SeverityLabel, string> = {
  normal: 'Normal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const SEVERITY_COLORS: Record<SeverityLabel, string> = {
  normal: '#94A3B8',
  low: '#EAB308',
  medium: '#F59E0B',
  high: '#F97316',
  critical: '#DC2626',
};

const CONFIDENCE_LABELS: Record<ConfidenceLabel, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

const CONFIDENCE_COLORS: Record<ConfidenceLabel, string> = {
  low: '#F59E0B',
  medium: '#2563EB',
  high: '#16A34A',
};

const INLINE_SERIES_LABEL_LIMIT = 4;
const LEGEND_ROW_LIMIT = 8;

const DATA_QUALITY_LABELS: Record<DataQualityLabel, string> = {
  healthy: 'Healthy data',
  thin: 'Thin history',
  flatline: 'Flatline risk',
  gappy: 'Gappy sampling',
};

const getStyles = (isDark: boolean) => ({
  wrapper: css`
    width: 100%;
    height: 100%;
    min-height: 0;
    container-type: inline-size;
    padding: 10px;
    box-sizing: border-box;
    overflow: auto;
    font-family: 'Segoe UI', sans-serif;
    color: ${isDark ? '#F3F4F6' : '#111827'};
    background: ${isDark ? 'radial-gradient(circle at 8% 0%, rgba(220,38,38,0.12), transparent 26%), linear-gradient(180deg, #060A12 0%, #0B111C 100%)' : 'linear-gradient(180deg, #F8FAFC 0%, #EEF4FF 100%)'};
  `,
  operationalCanvas: css`
    width: 100%;
    min-height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
    gap: 12px;
    align-items: stretch;
    @media (max-width: 1100px) {
      grid-template-columns: 1fr;
    }
    @container (max-width: 1040px) {
      grid-template-columns: 1fr;
    }
  `,
  workspacePane: css`
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  inspectorRail: css`
    min-width: 0;
    min-height: 0;
    @media (min-width: 1101px) {
      position: sticky;
      top: 0;
      align-self: start;
      max-height: calc(100vh - 24px);
      overflow: auto;
    }
    @container (max-width: 1040px) {
      position: static;
      max-height: none;
      overflow: visible;
    }
  `,
  header: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  `,
  statusHeader: css`
    position: relative;
    display: grid;
    grid-template-columns: minmax(260px, 0.9fr) minmax(340px, 1.1fr);
    gap: 18px;
    align-items: stretch;
    padding: 14px 16px 14px 22px;
    border-radius: 18px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(135deg, rgba(17,24,39,0.94) 0%, rgba(12,18,29,0.98) 62%, rgba(8,13,22,0.98) 100%)' : 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)'};
    overflow: hidden;
    box-shadow: ${isDark ? '0 22px 70px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)' : '0 16px 34px rgba(15,23,42,0.06)'};
    @media (max-width: 920px) {
      grid-template-columns: 1fr;
    }
  `,
  statusRail: css`
    position: absolute;
    inset: 0 auto 0 0;
    width: 5px;
    border-radius: 18px 0 0 18px;
  `,
  statusMain: css`
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
    padding-left: 48px;
    @media (max-width: 700px) {
      padding-left: 34px;
    }
  `,
  statusIcon: css`
    position: absolute;
    left: 18px;
    top: 50%;
    width: 30px;
    height: 30px;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    border-radius: 999px;
    color: #FCA5A5;
    border: 1px solid rgba(248,113,113,0.62);
    background: rgba(127,29,29,0.22);
    box-shadow: 0 0 0 5px rgba(220,38,38,0.08);
  `,
  statusIconSvg: css`
    width: 18px;
    height: 18px;
    overflow: visible;
  `,
  statusTitleRow: css`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  `,
  statusBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 1px solid currentColor;
  `,
  statusDot: css`
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 0 3px ${isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.10)'};
  `,
  titleBlock: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  title: css`
    font-size: clamp(22px, 1.65vw, 30px);
    font-weight: 800;
    letter-spacing: 0.01em;
  `,
  subtitle: css`
    font-size: 12px;
    color: ${isDark ? '#94A3B8' : '#475569'};
    line-height: 1.5;
  `,
  headerMetaGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(140px, max-content));
    gap: 8px 24px;
    color: ${isDark ? '#C7D2E4' : '#334155'};
    font-size: 12px;
    font-weight: 700;
    @media (max-width: 700px) {
      grid-template-columns: 1fr;
    }
  `,
  metaAccent: css`
    color: #F87171;
    font-weight: 900;
  `,
  recommendationBanner: css`
    display: none;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
  `,
  recommendationBadge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 78px;
    padding: 6px 10px;
    border-radius: 999px;
    background: ${isDark ? '#172554' : '#DBEAFE'};
    color: ${isDark ? '#BFDBFE' : '#1D4ED8'};
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  `,
  recommendationCopy: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  recommendationTitle: css`
    font-size: 13px;
    font-weight: 700;
    color: ${isDark ? '#F8FAFC' : '#0F172A'};
  `,
  recommendationText: css`
    font-size: 12px;
    line-height: 1.55;
    color: ${isDark ? '#CBD5E1' : '#334155'};
  `,
  stats: css`
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  `,
  statusStats: css`
    display: grid;
    grid-template-columns: 1.18fr repeat(3, minmax(82px, 1fr));
    gap: 10px;
    align-content: stretch;
    min-width: 0;
    @media (max-width: 700px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  statCard: css`
    min-width: 0;
    padding: 12px 13px;
    border-radius: 12px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.12)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, rgba(30,41,59,0.62), rgba(15,23,42,0.82))' : '#F8FAFC'};
    box-shadow: ${isDark ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'none'};
  `,
  statCardPrimary: css`
    border-color: rgba(248,113,113,0.38);
    background: linear-gradient(145deg, #B91C1C 0%, #7F1D1D 100%);
    color: #FFFFFF !important;
    box-shadow: 0 12px 26px rgba(220,38,38,0.22), inset 0 1px 0 rgba(255,255,255,0.12);
  `,
  statLabel: css`
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${isDark ? '#94A3B8' : '#64748B'};
  `,
  statValue: css`
    margin-top: 6px;
    font-size: clamp(18px, 1.35vw, 22px);
    font-weight: 850;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  statCaption: css`
    margin-top: 3px;
    font-size: 11px;
    color: ${isDark ? '#94A3B8' : '#64748B'};
    font-weight: 800;
  `,
  chartCard: css`
    flex: 1 1 auto;
    min-height: clamp(340px, 45vh, 520px);
    position: relative;
    border-radius: 12px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, #0A1321 0%, #07101D 100%)' : '#FFFFFF'};
    overflow: hidden;
    box-shadow: ${isDark ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 44px rgba(0,0,0,0.22)' : '0 14px 28px rgba(15,23,42,0.05)'};
    outline: none;
    &:focus-visible {
      border-color: ${isDark ? '#60A5FA' : '#2563EB'};
      box-shadow: ${isDark ? '0 0 0 1px rgba(96,165,250,0.55), inset 0 1px 0 rgba(148,163,184,0.05)' : '0 0 0 1px rgba(37,99,235,0.35), 0 14px 28px rgba(15,23,42,0.05)'};
    }
  `,
  incidentRibbonPanel: css`
    position: relative;
    min-height: 34px;
    padding: 5px 10px;
    border-radius: 13px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(8,13,22,0.98))' : '#FFFFFF'};
    box-shadow: ${isDark ? 'inset 0 1px 0 rgba(255,255,255,0.035)' : '0 10px 22px rgba(15,23,42,0.04)'};
  `,
  incidentRibbonEmpty: css`
    display: flex;
    align-items: center;
    min-height: 24px;
    padding: 0 4px;
    color: ${isDark ? '#94A3B8' : '#64748B'};
    font-size: 12px;
    font-weight: 700;
  `,
  legend: css`
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  `,
  legendTable: css`
    border-radius: 12px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, rgba(15,23,42,0.94), rgba(10,16,26,0.98))' : '#FFFFFF'};
    overflow: hidden;
    min-width: 0;
  `,
  legendTableHeader: css`
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 96px 84px 104px;
    gap: 10px;
    padding: 8px 12px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${isDark ? '#94A3B8' : '#64748B'};
    border-bottom: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    @media (max-width: 700px) {
      grid-template-columns: minmax(0, 1fr) 72px 72px;
      & > span:last-child {
        display: none;
      }
    }
  `,
  legendTableRow: css`
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 96px 84px 104px;
    gap: 10px;
    align-items: center;
    padding: 9px 12px;
    border-bottom: 1px solid ${isDark ? 'rgba(30,41,59,0.7)' : 'rgba(215,227,244,0.8)'};
    font-size: 12px;
    &:last-child {
      border-bottom: 0;
    }
    @media (max-width: 700px) {
      grid-template-columns: minmax(0, 1fr) 72px 72px;
      & > span:last-child {
        display: none;
      }
    }
  `,
  legendTableFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    border-top: 1px solid ${isDark ? 'rgba(30,41,59,0.8)' : 'rgba(215,227,244,0.9)'};
    color: ${isDark ? '#94A3B8' : '#64748B'};
    font-size: 11px;
    font-weight: 750;
  `,
  legendSeriesName: css`
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    color: ${isDark ? '#E2E8F0' : '#0F172A'};
  `,
  legendValue: css`
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    color: ${isDark ? '#CBD5E1' : '#334155'};
  `,
  legendItem: css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    min-width: 0;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 999px;
    background: ${isDark ? '#111827' : '#EFF6FF'};
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  legendSwatch: css`
    width: 10px;
    height: 10px;
    border-radius: 999px;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 12px;
  `,
  bottomDock: css`
    display: grid;
    grid-template-columns: minmax(360px, 1.1fr) minmax(280px, 0.9fr);
    gap: 10px;
    align-items: stretch;
    @media (max-width: 920px) {
      grid-template-columns: 1fr;
    }
  `,
  secondaryDock: css`
    display: grid;
    grid-template-columns: minmax(420px, 1.35fr) minmax(260px, 0.65fr);
    gap: 10px;
    align-items: start;
    @media (max-width: 920px) {
      grid-template-columns: 1fr;
    }
  `,
  sideUtilityStack: css`
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  card: css`
    border-radius: 12px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, rgba(15,23,42,0.94), rgba(10,16,26,0.98))' : '#FFFFFF'};
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    box-shadow: ${isDark ? 'inset 0 1px 0 rgba(255,255,255,0.035)' : '0 10px 24px rgba(15,23,42,0.045)'};
  `,
  cardTitle: css`
    font-size: 15px;
    font-weight: 700;
    line-height: 1.4;
  `,
  summaryList: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: min(360px, 42vh);
    overflow-y: auto;
    padding-right: 4px;
  `,
  summaryTimeline: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
    border-radius: 14px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#0F172A' : '#F8FAFC'};
  `,
  summaryRow: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
    cursor: pointer;
    transition: transform 120ms ease, border-color 120ms ease;
    &:hover {
      transform: translateY(-1px);
      border-color: ${isDark ? '#334155' : '#93C5FD'};
    }
  `,
  summaryRowSelected: css`
    border-color: ${isDark ? '#3B82F6' : '#2563EB'};
    box-shadow: inset 0 0 0 1px ${isDark ? '#3B82F6' : '#2563EB'};
  `,
  summaryTitle: css`
    font-size: 13px;
    font-weight: 700;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  `,
  summaryMeta: css`
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 12px;
    color: ${isDark ? '#94A3B8' : '#475569'};
  `,
  severityBadge: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  compactHealthStrip: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
    gap: 8px;
  `,
  scoreFeedTargetGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
    gap: 8px;
  `,
  scoreFeedTargetCard: css`
    min-width: 0;
    min-height: 96px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 7px;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, rgba(15,23,42,0.82) 0%, rgba(8,13,22,0.72) 100%)' : 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)'};
  `,
  scoreFeedTargetTop: css`
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
  `,
  scoreFeedTargetIcon: css`
    flex: 0 0 auto;
    width: 27px;
    height: 27px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: ${isDark ? 'rgba(15,23,42,0.92)' : '#F8FAFC'};
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.16)' : '#D7E3F4'};
    font-size: 16px;
    font-weight: 900;
    line-height: 1;

    svg {
      display: block;
      width: 18px;
      height: 18px;
    }
  `,
  scoreFeedTargetTitle: css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 850;
    color: ${isDark ? '#E2E8F0' : '#0F172A'};
  `,
  scoreFeedTargetStatus: css`
    align-self: flex-start;
    min-width: 62px;
    display: inline-flex;
    justify-content: center;
    padding: 5px 10px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 850;
  `,
  scoreFeedTargetMeta: css`
    font-size: 11px;
    font-weight: 750;
    color: ${isDark ? '#AAB7CA' : '#64748B'};
  `,
  healthChip: css`
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    gap: 6px;
    min-height: 68px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, rgba(15,23,42,0.82) 0%, rgba(8,13,22,0.68) 100%)' : 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)'};
  `,
  healthChipCompact: css`
    min-height: 58px;
    padding: 9px 10px;
  `,
  healthChipText: css`
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  healthChipLabel: css`
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: ${isDark ? '#94A3B8' : '#64748B'};
  `,
  healthChipValue: css`
    font-size: 12px;
    font-weight: 800;
    color: ${isDark ? '#E2E8F0' : '#0F172A'};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  targetBadge: css`
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
  `,
  targetIcon: css`
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: ${isDark ? 'rgba(37,99,235,0.18)' : '#EFF6FF'};
    border: 1px solid ${isDark ? 'rgba(96,165,250,0.22)' : '#BFDBFE'};
    font-size: 15px;
    line-height: 1;

    svg {
      display: block;
      width: 18px;
      height: 18px;
    }
  `,
  targetText: css`
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  `,
  targetName: css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 850;
    color: ${isDark ? '#E2E8F0' : '#0F172A'};
  `,
  targetLanguage: css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 750;
    color: ${isDark ? '#94A3B8' : '#64748B'};
  `,
  labelChipGrid: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  labelChip: css`
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    border-radius: 999px;
    border: 1px solid ${isDark ? 'rgba(96,165,250,0.24)' : '#BFDBFE'};
    background: ${isDark ? 'rgba(30,64,175,0.24)' : '#EFF6FF'};
    color: ${isDark ? '#DBEAFE' : '#1D4ED8'};
    font-size: 11px;
    font-weight: 800;
  `,
  labelChipKey: css`
    opacity: 0.72;
  `,
  labelChipValue: css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  staleBanner: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: 14px;
    border: 1px solid ${isDark ? '#92400E' : '#FDBA74'};
    background: ${isDark ? 'rgba(146,64,14,0.22)' : '#FFF7ED'};
    color: ${isDark ? '#FDBA74' : '#9A3412'};
    font-size: 12px;
    font-weight: 700;
  `,
  incidentHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 8px 0;
    flex-wrap: wrap;
  `,
  severityLegend: css`
    display: inline-flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
    font-size: 12px;
    font-weight: 800;
    color: ${isDark ? '#AAB7CA' : '#475569'};
  `,
  severityLegendItem: css`
    display: inline-flex;
    align-items: center;
    gap: 7px;
  `,
  severityLegendSwatch: css`
    width: 10px;
    height: 10px;
    border-radius: 2px;
  `,
  inlineInspectorLegacy: css`
    display: none;
  `,
  inspectorCard: css`
    min-height: 100%;
    border-radius: 16px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.15)' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, rgba(15,23,42,0.98), rgba(8,13,22,0.99))' : '#FFFFFF'};
    box-shadow: ${isDark ? '0 24px 70px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.045)' : '0 18px 34px rgba(15,23,42,0.08)'};
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  inspectorTop: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  `,
  inspectorTitle: css`
    font-size: 20px;
    font-weight: 850;
    letter-spacing: -0.01em;
  `,
  inspectorClose: css`
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: ${isDark ? '#94A3B8' : '#64748B'};
    font-size: 22px;
    cursor: default;
  `,
  inspectorTimestamp: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#E2E8F0'};
    color: ${isDark ? '#D6DEEB' : '#334155'};
    font-size: 15px;
    font-weight: 800;
  `,
  inspectorRows: css`
    display: grid;
    gap: 10px;
    padding-bottom: 12px;
    border-bottom: 1px solid ${isDark ? 'rgba(148,163,184,0.13)' : '#E2E8F0'};
  `,
  inspectorRow: css`
    display: grid;
    grid-template-columns: minmax(110px, 0.72fr) minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    font-size: 13px;
  `,
  inspectorRowLabel: css`
    color: ${isDark ? '#94A3B8' : '#64748B'};
    font-weight: 750;
  `,
  inspectorRowValue: css`
    min-width: 0;
    color: ${isDark ? '#E2E8F0' : '#0F172A'};
    font-weight: 800;
    text-align: right;
    overflow-wrap: anywhere;
  `,
  inspectorSectionTitle: css`
    font-size: 14px;
    font-weight: 850;
    color: ${isDark ? '#EEF2FF' : '#0F172A'};
  `,
  inspectorHealthRow: css`
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
  `,
  inspectorPill: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px 9px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 850;
  `,
  inspectorActionStack: css`
    display: grid;
    gap: 8px;
  `,
  inspectorActionButton: css`
    display: inline-flex;
    align-items: center;
    width: 100%;
    min-height: 42px;
    justify-content: center;
    border-radius: 9px;
    font-size: 13px;
    box-shadow: none;
  `,
  inspectorActionButtonPrimary: css`
    border-color: #2563EB;
    background: linear-gradient(180deg, #3B82F6 0%, #2563EB 100%);
    color: #FFFFFF;
  `,
  inspectorActionButtonSecondary: css`
    border-color: ${isDark ? 'rgba(148,163,184,0.18)' : '#CBD5E1'};
    background: ${isDark ? 'rgba(15,23,42,0.72)' : '#F8FAFC'};
    color: ${isDark ? '#D6DEEB' : '#334155'};
  `,
  queryPreview: css`
    max-height: 170px;
    overflow: auto;
    margin: 0;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid ${isDark ? 'rgba(148,163,184,0.14)' : '#D7E3F4'};
    background: ${isDark ? '#101820' : '#F8FAFC'};
    color: ${isDark ? '#FBBF24' : '#92400E'};
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: 10.5px;
    line-height: 1.5;
    white-space: pre-wrap;
  `,
  scoreFeedCard: css`
    min-width: 0;
    position: relative;
    overflow: hidden;
    &::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: ${isDark ? 'linear-gradient(180deg, #38BDF8 0%, #2563EB 55%, #22C55E 100%)' : 'linear-gradient(180deg, #0EA5E9 0%, #2563EB 55%, #16A34A 100%)'};
      opacity: 0.9;
    }
  `,
  profileCard: css`
    gap: 10px;
  `,
  profileSummary: css`
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  profileDetailGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    @media (max-width: 520px) {
      grid-template-columns: 1fr;
    }
  `,
  handoffCard: css`
    padding: 12px;
    gap: 10px;
    background: ${isDark ? 'linear-gradient(180deg, rgba(8,13,22,0.88), rgba(6,10,18,0.96))' : 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)'};
  `,
  handoffHeader: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  `,
  detailGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  `,
  detailStat: css`
    min-width: 0;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
  `,
  detailLabel: css`
    font-size: 11px;
    color: ${isDark ? '#94A3B8' : '#64748B'};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  detailValue: css`
    margin-top: 6px;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.4;
    overflow-wrap: anywhere;
  `,
  detailTable: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  metricBreakdownList: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  metricBreakdownCard: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 14px;
    border: 1px solid ${isDark ? '#22314A' : '#D7E3F4'};
    background: ${isDark ? 'linear-gradient(180deg, #101A2B 0%, #0E1625 100%)' : 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)'};
  `,
  metricBreakdownHeader: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  `,
  metricBreakdownTitle: css`
    font-size: 13px;
    font-weight: 700;
    line-height: 1.35;
  `,
  metricBreakdownReason: css`
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.45;
    color: ${isDark ? '#94A3B8' : '#64748B'};
  `,
  metricBreakdownGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
    gap: 8px;
  `,
  metricBreakdownStat: css`
    min-width: 0;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid ${isDark ? '#1E293B' : '#E2E8F0'};
    background: ${isDark ? 'rgba(2, 6, 23, 0.58)' : 'rgba(255, 255, 255, 0.82)'};
  `,
  metricBreakdownStatLabel: css`
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: ${isDark ? '#94A3B8' : '#64748B'};
  `,
  metricBreakdownStatValue: css`
    margin-top: 5px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.35;
    color: ${isDark ? '#F8FAFC' : '#0F172A'};
    overflow-wrap: anywhere;
  `,
  actionRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  `,
  actionButton: css`
    border: 1px solid ${isDark ? '#1D4ED8' : '#93C5FD'};
    background: ${isDark ? '#172554' : '#EFF6FF'};
    color: ${isDark ? '#DBEAFE' : '#1D4ED8'};
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 120ms ease, transform 120ms ease;
    &:hover:enabled {
      transform: translateY(-1px);
    }
    &:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
  `,
  actionButtonSecondary: css`
    border: 1px solid ${isDark ? '#334155' : '#CBD5E1'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
    color: ${isDark ? '#E2E8F0' : '#334155'};
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 120ms ease, transform 120ms ease;
    &:hover:enabled {
      transform: translateY(-1px);
    }
    &:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
  `,
  actionNotice: css`
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
  `,
  feedRuleList: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  wideCard: css`
    grid-column: 1 / -1;
  `,
  feedRuleCard: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
  `,
  codeLine: css`
    border-radius: 10px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#020617' : '#F8FAFC'};
    padding: 10px 12px;
    font-family: 'Cascadia Code', 'Consolas', monospace;
    font-size: 11px;
    line-height: 1.55;
    word-break: break-word;
  `,
  detailRow: css`
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) repeat(4, minmax(0, 1fr));
    gap: 10px;
    align-items: center;
    font-size: 12px;
  `,
  detailHeaderRow: css`
    color: ${isDark ? '#94A3B8' : '#64748B'};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
  `,
  monoBlock: css`
    width: 100%;
    min-height: 170px;
    max-height: 320px;
    overflow: auto;
    border-radius: 12px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#020617' : '#F8FAFC'};
    padding: 12px;
    box-sizing: border-box;
    font-family: 'Cascadia Code', 'Consolas', monospace;
    font-size: 11px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  `,
  emptyState: css`
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 240px;
    border-radius: 16px;
    border: 1px dashed ${isDark ? '#334155' : '#CBD5E1'};
    background: ${isDark ? '#020617' : '#FFFFFF'};
    color: ${isDark ? '#94A3B8' : '#64748B'};
    text-align: center;
    padding: 20px;
    line-height: 1.6;
  `,
  skeletonShell: css`
    display: grid;
    grid-template-rows: auto minmax(240px, 1fr) auto;
    gap: 12px;
  `,
  skeletonBlock: css`
    position: relative;
    overflow: hidden;
    min-height: 20px;
    border-radius: 14px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      transform: translateX(-100%);
      background: linear-gradient(90deg, transparent, ${isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.22)'}, transparent);
      animation: anomaly-shimmer 1.45s infinite;
    }
    @keyframes anomaly-shimmer {
      100% {
        transform: translateX(100%);
      }
    }
  `,
  skeletonHeader: css`
    height: 86px;
  `,
  skeletonChart: css`
    min-height: 320px;
  `,
  skeletonRows: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  `,
  skeletonRow: css`
    height: 128px;
  `,
});

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const getVectorValue = (values: VectorLike | undefined, index: number): unknown => {
  if (!values) {
    return undefined;
  }

  if (typeof values.get === 'function') {
    return values.get(index);
  }

  return values[index];
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const formatValue = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }

  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  if (absolute >= 10) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

const formatScoreValue = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }

  return Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const formatAxisValue = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '';
  }

  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    return value.toLocaleString(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
  }

  if (absolute >= 100) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  if (absolute >= 10) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  if (absolute >= 1) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

const formatPercent = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }

  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
};

const formatRange = (lower: number | null, upper: number | null): string => {
  if (lower === null || upper === null) {
    return 'n/a';
  }

  return `${formatValue(lower)} - ${formatValue(upper)}`;
};

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDuration = (durationMs: number): string => {
  const minutes = Math.round(durationMs / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round((durationMs / (60 * 60000)) * 10) / 10;
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.round((durationMs / (24 * 60 * 60000)) * 10) / 10;
  return `${days}d`;
};

const formatBucketWindow = (start: number, end: number): string => {
  if (end <= start) {
    return formatTime(start);
  }

  return `${formatTime(start)} - ${formatTime(end)}`;
};

const truncateLabel = (value: string, maxLength = 26): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
};

const resolveTimeAxisDensity = (density: TimeAxisDensity, totalRangeMs: number): Exclude<TimeAxisDensity, 'auto'> => {
  if (density !== 'auto') {
    return density;
  }

  if (totalRangeMs <= 6 * 60 * 60 * 1000) {
    return 'dense';
  }

  if (totalRangeMs <= 36 * 60 * 60 * 1000) {
    return 'balanced';
  }

  return 'compact';
};

const getTimeTickCount = (
  chartWidth: number,
  detectionMode: DetectionMode,
  density: TimeAxisDensity,
  totalRangeMs: number
): number => {
  const resolvedDensity = resolveTimeAxisDensity(density, totalRangeMs);
  const base = detectionMode === 'multi' ? chartWidth / 235 : chartWidth / 205;
  const multiplier = resolvedDensity === 'compact' ? 0.76 : resolvedDensity === 'dense' ? 1.35 : 1;
  const raw = Math.round(base * multiplier);
  const minTicks = resolvedDensity === 'dense' ? 5 : 4;
  const maxTicks = resolvedDensity === 'dense' ? 10 : resolvedDensity === 'compact' ? 7 : 8;
  return Math.max(minTicks, Math.min(maxTicks, raw));
};

const getGrafanaTimeAxisFormat = (totalRangeMs: number, density: TimeAxisDensity): string => {
  const resolvedDensity = resolveTimeAxisDensity(density, totalRangeMs);

  if (totalRangeMs <= 12 * 60 * 60 * 1000 || resolvedDensity === 'dense') {
    return 'HH:mm';
  }

  if (totalRangeMs <= 72 * 60 * 60 * 1000) {
    return 'DD/MM HH:mm';
  }

  return 'DD/MM';
};

const formatTimeAxisLabel = (timestamp: number, totalRangeMs: number, density: TimeAxisDensity, timeZone: TimeZone): string => {
  return dateTimeFormat(timestamp, {
    format: getGrafanaTimeAxisFormat(totalRangeMs, density),
    timeZone,
  });
};

const formatTimeAxisContextLabel = (timestamp: number, totalRangeMs: number, timeZone: TimeZone): string => {
  if (totalRangeMs <= 72 * 60 * 60 * 1000) {
    return dateTimeFormat(timestamp, {
      format: 'ddd DD/MM',
      timeZone,
    });
  }

  return dateTimeFormat(timestamp, {
    format: 'DD/MM/YYYY',
    timeZone,
  });
};

const formatTooltipTime = (timestamp: number, totalRangeMs: number, timeZone: TimeZone): string =>
  dateTimeFormat(timestamp, {
    format: totalRangeMs <= 72 * 60 * 60 * 1000 ? 'DD/MM HH:mm' : 'DD/MM/YYYY HH:mm',
    timeZone,
  });

const getSeverityMarkerShape = (severityLabel: SeverityLabel, mode: MarkerShapeMode): MarkerShape => {
  if (mode === 'classic') {
    return 'circle';
  }

  switch (severityLabel) {
    case 'medium':
      return 'diamond';
    case 'high':
      return 'triangle';
    case 'critical':
      return 'square';
    default:
      return 'circle';
  }
};

const buildMarkerPath = (shape: Exclude<MarkerShape, 'circle' | 'square'>, x: number, y: number, size: number): string => {
  if (shape === 'diamond') {
    return `M ${x} ${y - size} L ${x + size} ${y} L ${x} ${y + size} L ${x - size} ${y} Z`;
  }

  return `M ${x} ${y - size} L ${x + size * 0.92} ${y + size * 0.9} L ${x - size * 0.92} ${y + size * 0.9} Z`;
};

const renderMarkerGlyph = (
  shape: MarkerShape,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke?: string,
  strokeWidth = 0,
  opacity?: number
): React.ReactNode => {
  if (shape === 'circle') {
    return <circle cx={x} cy={y} r={size} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} />;
  }

  if (shape === 'square') {
    return (
      <rect
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        rx={Math.max(1.5, size * 0.32)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  }

  return <path d={buildMarkerPath(shape, x, y, size)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} />;
};

const normalizeBucketSpan = (requested: BucketSpan | undefined): BucketSpan => {
  if (!requested) {
    return 'auto';
  }

  return requested;
};

const detectAutoMetricPreset = (names: string[]): AutoPresetMatch => {
  const collected = new Map<EffectiveMetricPreset, string[]>();

  for (const name of names) {
    for (const rule of AUTO_PRESET_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(name))) {
        const existing = collected.get(rule.preset) ?? [];
        existing.push(name);
        collected.set(rule.preset, existing);
      }
    }
  }

  for (const preset of AUTO_PRESET_PRIORITY) {
    const matches = collected.get(preset) ?? [];
    if (matches.length > 0) {
      return {
        preset,
        matchedNames: matches,
        confidence: matches.length >= 2 ? 'matched' : 'weak',
      };
    }
  }

  return {
    preset: 'traffic',
    matchedNames: [],
    confidence: 'fallback',
  };
};

const buildRecommendation = (
  resolved: Omit<ResolvedOptions, 'recommendation'>,
  match: AutoPresetMatch | null
): MetricPresetRecommendation => {
  if (resolved.setupMode === 'advanced' || resolved.effectiveMetricPreset === 'custom') {
    return {
      source: 'manual',
      badge: 'Manual tuning',
      title: 'Advanced controls are active',
      reason: `Algorithm ${ALGORITHM_LABELS[resolved.algorithm]} with ${SEVERITY_PRESET_LABELS[resolved.severityPreset]} severity mapping is applied directly.`,
      matchedNames: [],
      confidence: 'matched',
    };
  }

  const config = METRIC_PRESET_CONFIGS[resolved.effectiveMetricPreset as EffectiveMetricPreset];
  const source = resolved.metricPreset === 'auto' ? 'auto' : 'selected';
  const title =
    source === 'auto'
      ? `Auto selected ${METRIC_PRESET_LABELS[resolved.effectiveMetricPreset]}`
      : `${METRIC_PRESET_LABELS[resolved.effectiveMetricPreset]} preset is active`;

  return {
    source,
    badge: config.badge,
    title,
    reason: config.why,
    matchedNames: match?.matchedNames ?? [],
    confidence: match?.confidence ?? 'matched',
  };
};

const resolveOptions = (options: SimpleOptions, metricNames: string[]): ResolvedOptions => {
  const setupMode = options.setupMode ?? 'recommended';
  const metricPreset = options.metricPreset ?? 'auto';
  const maxAnomalies = Math.max(3, Math.min(20, Math.round(options.maxAnomalies ?? 8)));
  const bucketSpan = normalizeBucketSpan(options.bucketSpan);

  if (setupMode === 'advanced' || metricPreset === 'custom') {
    const partial: Omit<ResolvedOptions, 'recommendation'> = {
      setupMode,
      metricPreset,
      effectiveMetricPreset: 'custom',
      detectionMode: options.detectionMode ?? 'single',
      algorithm: options.algorithm ?? 'zscore',
      sensitivity: Math.max(0.2, options.sensitivity ?? 4.0),
      baselineWindow: Math.max(3, Math.round(options.baselineWindow ?? 12)),
      seasonalitySamples: Math.max(2, Math.round(options.seasonalitySamples ?? 24)),
      seasonalRefinement: options.seasonalRefinement ?? 'cycle',
      severityPreset: options.severityPreset ?? 'balanced',
      bucketSpan,
      showExpectedLine: options.showExpectedLine !== false,
      showInlineSeriesLabels: options.showInlineSeriesLabels !== false,
      showFocusBand: options.showFocusBand === true,
      timeAxisDensity: options.timeAxisDensity ?? 'auto',
      timeAxisPlacement: options.timeAxisPlacement ?? 'top_and_bottom',
      markerShapeMode: options.markerShapeMode ?? 'severity',
      maxAnomalies,
    };

    return {
      ...partial,
      recommendation: buildRecommendation(partial, null),
    };
  }

  const autoMatch = metricPreset === 'auto' ? detectAutoMetricPreset(metricNames) : null;
  const effectiveMetricPreset = (metricPreset === 'auto' ? autoMatch?.preset : metricPreset) as EffectiveMetricPreset;
  const config = METRIC_PRESET_CONFIGS[effectiveMetricPreset];

  const partial: Omit<ResolvedOptions, 'recommendation'> = {
    setupMode,
    metricPreset,
    effectiveMetricPreset,
    detectionMode: options.detectionMode ?? 'single',
    algorithm: config.algorithm,
    sensitivity: config.sensitivity,
    baselineWindow: config.baselineWindow,
    seasonalitySamples: config.seasonalitySamples,
    seasonalRefinement: config.seasonalRefinement,
    severityPreset: config.severityPreset,
    bucketSpan,
    showExpectedLine: options.showExpectedLine !== false,
    showInlineSeriesLabels: options.showInlineSeriesLabels !== false,
    showFocusBand: options.showFocusBand === true,
    timeAxisDensity: options.timeAxisDensity ?? 'auto',
    timeAxisPlacement: options.timeAxisPlacement ?? 'top_and_bottom',
    markerShapeMode: options.markerShapeMode ?? 'severity',
    maxAnomalies,
  };

  return {
    ...partial,
    recommendation: buildRecommendation(partial, autoMatch),
  };
};
const selectionKey = (selection: SelectionToken | null): string => {
  if (!selection) {
    return 'none';
  }

  return selection.kind === 'point' ? `point:${selection.seriesKey}:${selection.time}` : `event:${selection.time}`;
};

const severityRank = (severityLabel: SeverityLabel): number => ['normal', 'low', 'medium', 'high', 'critical'].indexOf(severityLabel);

const pickHigherSeverity = (current: SeverityState, candidate: SeverityState): SeverityState => {
  if (severityRank(candidate.severityLabel) > severityRank(current.severityLabel)) {
    return candidate;
  }

  if (severityRank(candidate.severityLabel) === severityRank(current.severityLabel) && candidate.severityScore > current.severityScore) {
    return candidate;
  }

  return current;
};

const pickWorseDataQuality = (current: DataQualityLabel, candidate: DataQualityLabel): DataQualityLabel => {
  const rank: DataQualityLabel[] = ['healthy', 'gappy', 'thin', 'flatline'];
  return rank.indexOf(candidate) > rank.indexOf(current) ? candidate : current;
};

const getDriverLabel = (scoreDriver: 'point' | 'window', algorithm: DetectionAlgorithm): string => {
  if (algorithm === 'level_shift') {
    return scoreDriver === 'window' ? 'Sustained baseline shift' : 'Fresh step change';
  }

  if (algorithm === 'seasonal') {
    return 'Seasonal pattern break';
  }

  if (scoreDriver === 'window') {
    return algorithm === 'ewma' ? 'Short sustained drift' : 'Sustained deviation';
  }

  return 'Sharp point deviation';
};

const buildIncidentHeadline = (label: string, algorithm: DetectionAlgorithm, scoreDriver: 'point' | 'window'): string => {
  const reason = getDriverLabel(scoreDriver, algorithm);
  return `${reason} in ${label}`;
};

const buildSignalStory = (detail: SelectionDetail, algorithm: DetectionAlgorithm): string => {
  const confidenceText = CONFIDENCE_LABELS[detail.confidenceLabel].replace('confidence', 'signal confidence');
  const dataQualityText = DATA_QUALITY_LABELS[detail.dataQualityLabel].toLowerCase();

  if (detail.kind === 'event') {
    return `${detail.activeSeries} metric agreed on this combined anomaly. Strongest reason: ${detail.breakdown[0] ? getDriverLabel(detail.breakdown[0].scoreDriver, algorithm) : 'Cross-metric deviation'}. ${confidenceText}, data quality is ${dataQualityText}.`;
  }

  const driverText = getDriverLabel(detail.scoreDriver, algorithm);
  const direction =
    detail.deviation === null
      ? 'moved away from baseline'
      : detail.deviation > 0
        ? 'moved above its baseline'
        : detail.deviation < 0
          ? 'fell below its baseline'
          : 'stayed close to its baseline';

  return `${detail.seriesLabel} ${direction}. Main reason: ${driverText}. ${confidenceText}, data quality is ${dataQualityText}.`;
};

const buildAlertGuidance = (severity: SeverityState & Partial<ConfidenceState>, severityPreset: SeverityPreset): string => {
  const presetHint =
    severityPreset === 'warning_first'
      ? 'Warning-first preset surfaces operator-visible severity earlier.'
      : severityPreset === 'page_first'
        ? 'Page-first preset keeps high and critical stricter for paging workflows.'
        : 'Balanced preset aims to work for both dashboards and alert handoff.';
  const confidenceHint =
    severity.confidenceLabel === 'low'
      ? ' Confidence is still low, so verify with nearby metrics before paging.'
      : severity.dataQualityLabel === 'thin'
        ? ' History is still thin, so treat this as early signal rather than hard evidence.'
        : severity.dataQualityLabel === 'flatline'
          ? ' The series looks nearly flat, so verify the metric is still reporting healthy samples.'
          : severity.dataQualityLabel === 'gappy'
            ? ' Recent samples are gappy, so confirm the data source timing before escalating.'
            : '';

  if (severity.severityLabel === 'critical' || severity.severityLabel === 'high') {
    return `${presetHint} This anomaly is already in the investigate-now range.${confidenceHint}`;
  }

  if (severity.severityLabel === 'medium') {
    return `${presetHint} This anomaly looks strong enough for triage or warning workflows.${confidenceHint}`;
  }

  return `${presetHint} This anomaly is currently better suited to watchlists or dashboard review.${confidenceHint}`;
};

const dedupeConsecutivePoints = (points: RawPoint[]): RawPoint[] => {
  const merged: RawPoint[] = [];

  for (const point of points) {
    const previous = merged[merged.length - 1];
    if (previous && previous.time === point.time) {
      const count = previous.sampleCount + point.sampleCount;
      previous.value = (previous.value * previous.sampleCount + point.value * point.sampleCount) / count;
      previous.sampleCount = count;
      previous.minValue = Math.min(previous.minValue, point.minValue);
      previous.maxValue = Math.max(previous.maxValue, point.maxValue);
      previous.bucketStart = Math.min(previous.bucketStart, point.bucketStart);
      previous.bucketEnd = Math.max(previous.bucketEnd, point.bucketEnd);
      continue;
    }

    merged.push({ ...point });
  }

  return merged;
};

const estimateStepMs = (points: RawPoint[]): number | null => {
  if (points.length < 2) {
    return null;
  }

  const diffs: number[] = [];
  for (let index = 1; index < points.length && diffs.length < 120; index += 1) {
    const diff = points[index].time - points[index - 1].time;
    if (diff > 0) {
      diffs.push(diff);
    }
  }

  return diffs.length > 0 ? median(diffs) : null;
};

const resolveBucketSpanMs = (series: PreparedSeries[], requested: BucketSpan): number | null => {
  if (requested === 'raw') {
    return null;
  }

  if (requested !== 'auto') {
    return BUCKET_SPAN_MS[requested];
  }

  const lengths = series.map((item) => item.rawPoints.length).filter((value) => value > 0);
  if (lengths.length === 0) {
    return null;
  }

  const maxLength = Math.max(...lengths);
  const allTimes = series.flatMap((item) => item.rawPoints.map((point) => point.time));
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const rangeMs = Math.max(maxTime - minTime, 0);
  const estimatedSteps = series.map((item) => estimateStepMs(item.rawPoints)).filter((value): value is number => value !== null);
  const stepMs = estimatedSteps.length > 0 ? median(estimatedSteps) : null;

  if (maxLength <= AUTO_TARGET_POINTS || rangeMs <= 0) {
    return null;
  }

  const targetSpan = Math.ceil(rangeMs / AUTO_TARGET_POINTS);
  const minimumUsefulSpan = stepMs ? Math.max(stepMs * 1.5, targetSpan) : targetSpan;
  const selected = EXPLICIT_BUCKET_SPANS.find((candidate) => candidate >= minimumUsefulSpan);
  return selected ?? EXPLICIT_BUCKET_SPANS[EXPLICIT_BUCKET_SPANS.length - 1];
};

const aggregateRawPoints = (points: RawPoint[], bucketSpanMs: number | null): RawPoint[] => {
  if (!bucketSpanMs || points.length === 0) {
    return dedupeConsecutivePoints(points.map((point) => ({ ...point })));
  }

  const buckets = new Map<number, { sum: number; count: number; min: number; max: number; end: number }>();

  for (const point of points) {
    const bucketStart = Math.floor(point.time / bucketSpanMs) * bucketSpanMs;
    const entry = buckets.get(bucketStart) ?? { sum: 0, count: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, end: bucketStart + bucketSpanMs };
    entry.sum += point.value;
    entry.count += point.sampleCount;
    entry.min = Math.min(entry.min, point.minValue);
    entry.max = Math.max(entry.max, point.maxValue);
    buckets.set(bucketStart, entry);
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucketStart, entry]) => ({
      time: bucketStart + Math.round(bucketSpanMs / 2),
      value: entry.sum / entry.count,
      bucketStart,
      bucketEnd: entry.end,
      sampleCount: entry.count,
      minValue: entry.min,
      maxValue: entry.max,
    }));
};

const buildRawPoint = (time: number, value: number): RawPoint => ({
  time,
  value,
  bucketStart: time,
  bucketEnd: time,
  sampleCount: 1,
  minValue: value,
  maxValue: value,
});

const nonBlankDisplayName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim().length > 0 ? value : null;
};

const resolveSeriesDisplayName = (field: SeriesDisplayNameField, frameName?: string, fallback = 'Series'): string => {
  return (
    nonBlankDisplayName(field.config?.displayNameFromDS) ??
    nonBlankDisplayName(field.config?.displayName) ??
    nonBlankDisplayName(field.state?.displayName) ??
    nonBlankDisplayName(field.name) ??
    nonBlankDisplayName(frameName) ??
    fallback
  );
};

const hasGrafanaDisplayName = (field: SeriesDisplayNameField): boolean =>
  Boolean(
    nonBlankDisplayName(field.config?.displayNameFromDS) ??
      nonBlankDisplayName(field.config?.displayName) ??
      nonBlankDisplayName(field.state?.displayName)
  );

const resolveSectionVisibility = (options: Partial<SimpleOptions>): SectionVisibility => {
  const legacySummaryVisible = options.showSummary !== false;
  return {
    initialLabels: options.showInitialLabels !== false,
    statistics: options.showStatistics !== false,
    mainChart: options.showMainChart !== false,
    inspector: options.showInspector !== false,
    anomalyFeed: legacySummaryVisible && options.showAnomalyFeed !== false,
    seriesSummary: options.showSeriesSummary !== false,
    scoreFeed: options.showScoreFeed !== false,
    detectionProfile: legacySummaryVisible && options.showDetectionProfile !== false,
    exports: legacySummaryVisible && options.showExports !== false,
  };
};

const collectPreparedSeries = (series: Props['data']['series']): PreparedSeries[] => {
  const prepared: PreparedSeries[] = [];

  series.forEach((frame, frameIndex) => {
    const timeField = frame.fields.find((field) => field.type === FieldType.time);
    if (!timeField) {
      return;
    }

    const numericFields = frame.fields.filter((field) => field.type === FieldType.number);
    numericFields.forEach((field, fieldIndex) => {
      const points: RawPoint[] = [];
      const length = Math.min(timeField.values.length ?? 0, field.values.length ?? 0);
      for (let index = 0; index < length; index += 1) {
        const timeValue = asNumber(getVectorValue(timeField.values as VectorLike, index));
        const numericValue = asNumber(getVectorValue(field.values as VectorLike, index));
        if (timeValue === null || numericValue === null) {
          continue;
        }

        points.push(buildRawPoint(timeValue, numericValue));
      }

      if (points.length === 0) {
        return;
      }

      points.sort((left, right) => left.time - right.time);
      const label = resolveSeriesDisplayName(field, frame.name, `Series ${prepared.length + 1}`);
      const fixedColor = field.config.color?.fixedColor;
      prepared.push({
        key: `${frame.name ?? frameIndex}-${field.name ?? fieldIndex}-${frameIndex}-${fieldIndex}`,
        label,
        preservesGrafanaDisplayName: hasGrafanaDisplayName(field),
        color: fixedColor || SERIES_COLORS[prepared.length % SERIES_COLORS.length],
        rawPoints: dedupeConsecutivePoints(points),
      });
    });
  });

  const labelTotals = new Map<string, number>();
  prepared.forEach((item) => {
    labelTotals.set(item.label, (labelTotals.get(item.label) ?? 0) + 1);
  });

  const seenLabels = new Map<string, number>();
  return prepared.map((item) => {
    const total = labelTotals.get(item.label) ?? 1;
    if (total <= 1 || item.preservesGrafanaDisplayName) {
      return item;
    }

    const index = (seenLabels.get(item.label) ?? 0) + 1;
    seenLabels.set(item.label, index);
    return {
      ...item,
      label: `${item.label} (${index})`,
    };
  });
};

const downsamplePoints = (points: SamplePoint[]): SamplePoint[] => {
  if (points.length <= MAX_RENDER_POINTS) {
    return points;
  }

  const keep = new Set<number>();
  const step = (points.length - 1) / (MAX_RENDER_POINTS - 1);

  for (let index = 0; index < MAX_RENDER_POINTS; index += 1) {
    keep.add(Math.round(index * step));
  }

  points.forEach((point, index) => {
    if (point.isAnomaly) {
      keep.add(index);
    }
  });

  return [...keep]
    .sort((left, right) => left - right)
    .slice(0, MAX_RENDER_POINTS + Math.min(60, points.filter((point) => point.isAnomaly).length))
    .map((index) => points[index]);
};

const analyzePoints = (points: RawPoint[], options: ResolvedOptions): SamplePoint[] => {
  return analyzeCanonicalPoints(points, {
    algorithm: options.algorithm,
    sensitivity: options.sensitivity,
    baselineWindow: options.baselineWindow,
    seasonalitySamples: options.seasonalitySamples,
    seasonalRefinement: options.seasonalRefinement,
    severityPreset: options.severityPreset,
  });
};

const buildAnalyses = (preparedSeries: PreparedSeries[], options: ResolvedOptions): AnalysisBuildResult => {
  const effectiveBucketSpanMs = resolveBucketSpanMs(preparedSeries, options.bucketSpan);

  const analyses = preparedSeries.map((series) => {
    const aggregated = aggregateRawPoints(series.rawPoints, effectiveBucketSpanMs);
    const allPoints = analyzePoints(aggregated, options);
    const points = downsamplePoints(allPoints);
    const anomalyPoints = allPoints.filter((point) => point.isAnomaly);
    const highestSeverity = anomalyPoints.reduce<SeverityState>(
      (current, point) => pickHigherSeverity(current, point),
      { severityLabel: 'normal', severityScore: 0 }
    );

    return {
      key: series.key,
      label: series.label,
      color: series.color,
      points,
      allPoints,
      anomalyCount: anomalyPoints.length,
      maxScore: anomalyPoints.reduce((max, point) => Math.max(max, point.score), 0),
      maxSeverityScore: highestSeverity.severityScore,
      maxSeverityLabel: highestSeverity.severityLabel,
      sourcePointCount: series.rawPoints.length,
      aggregatedPointCount: aggregated.length,
      processedPointCount: allPoints.length,
    };
  });

  return { analyses, effectiveBucketSpanMs };
};

const buildMultiMetricEvents = (analyses: SeriesAnalysis[], options: ResolvedOptions): MultiMetricEvent[] => {
  const grouped = new Map<number, Array<{ point: SamplePoint; label: string }>>();

  analyses.forEach((analysis) => {
    analysis.allPoints.forEach((point) => {
      if (point.expected === null) {
        return;
      }

      const bucket = grouped.get(point.time) ?? [];
      bucket.push({ point, label: analysis.label });
      grouped.set(point.time, bucket);
    });
  });

  return [...grouped.entries()]
    .map(([time, entries]) => {
      const top = [...entries].sort((left, right) => right.point.score - left.point.score);
      const score = top.slice(0, Math.min(3, top.length)).reduce((sum, item) => sum + item.point.score, 0) / Math.min(3, top.length || 1);
      const severity = top.reduce<SeverityState>((current, item) => pickHigherSeverity(current, item.point), { severityLabel: 'normal', severityScore: 0 });
      const strongest = top[0];
      const confidenceScore = top.slice(0, Math.min(3, top.length)).reduce((sum, item) => sum + item.point.confidenceScore, 0) / Math.min(3, top.length || 1);
      const confidenceLabel: ConfidenceLabel = confidenceScore >= 80 ? 'high' : confidenceScore >= 55 ? 'medium' : 'low';
      const dataQualityLabel = top.reduce<DataQualityLabel>((current, item) => pickWorseDataQuality(current, item.point.dataQualityLabel), 'healthy');

      return {
        time,
        bucketStart: strongest?.point.bucketStart ?? time,
        bucketEnd: strongest?.point.bucketEnd ?? time,
        score,
        contributors: top.filter((item) => item.point.isAnomaly).map((item) => item.label).slice(0, 4),
        activeSeries: entries.length,
        isAnomaly: score >= options.sensitivity || top.some((item) => item.point.isAnomaly),
        severityLabel: severity.severityLabel,
        severityScore: severity.severityScore,
        confidenceScore: Math.round(confidenceScore * 10) / 10,
        confidenceLabel,
        dataQualityLabel,
      };
    })
    .sort((left, right) => left.time - right.time);
};

const formatEffectiveBucketSpanLabel = (requested: BucketSpan, effectiveMs: number | null): string => {
  if (requested === 'raw') {
    return BUCKET_SPAN_LABELS.raw;
  }

  if (requested !== 'auto') {
    return BUCKET_SPAN_LABELS[requested];
  }

  if (!effectiveMs) {
    return 'Auto -> raw';
  }

  return `Auto -> ${formatDuration(effectiveMs)}`;
};

const buildLinePath = (points: SamplePoint[], getX: (time: number) => number, getY: (value: number) => number, valueSelector: (point: SamplePoint) => number | null): string => {
  let path = '';

  points.forEach((point) => {
    const value = valueSelector(point);
    if (value === null || !Number.isFinite(value)) {
      return;
    }

    const command = path.length === 0 ? 'M' : 'L';
    path += `${command}${getX(point.time).toFixed(2)},${getY(value).toFixed(2)} `;
  });

  return path.trim();
};

const buildAreaPath = (points: SamplePoint[], getX: (time: number) => number, getY: (value: number) => number): string => {
  const valid = points.filter((point) => point.lower !== null && point.upper !== null);
  if (valid.length < 2) {
    return '';
  }

  const upper = valid.map((point) => `${getX(point.time).toFixed(2)},${getY(point.upper as number).toFixed(2)}`);
  const lower = [...valid].reverse().map((point) => `${getX(point.time).toFixed(2)},${getY(point.lower as number).toFixed(2)}`);
  return `M${upper.join(' L')} L${lower.join(' L')} Z`;
};

const buildLinearTicks = (min: number, max: number, count: number): number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  if (count <= 1 || max === min) {
    return [min];
  }

  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
};

const selectVisibleMarkers = <T extends { time: number; score: number }>(
  items: T[],
  getX: (time: number) => number,
  minGapPx: number,
  selectedTime: number | null = null
): T[] => {
  if (items.length <= 1) {
    return items;
  }

  const visible: T[] = [];
  let cluster: T[] = [];
  let clusterStartX = Number.NEGATIVE_INFINITY;

  const flushCluster = () => {
    if (cluster.length === 0) {
      return;
    }

    let preferred = cluster[0];
    for (const item of cluster) {
      if (selectedTime !== null && item.time === selectedTime) {
        preferred = item;
        break;
      }

      if (item.score > preferred.score) {
        preferred = item;
      }
    }

    visible.push(preferred);
    cluster = [];
  };

  for (const item of items) {
    const x = getX(item.time);
    if (cluster.length === 0) {
      cluster = [item];
      clusterStartX = x;
      continue;
    }

    if (x - clusterStartX < minGapPx) {
      cluster.push(item);
      continue;
    }

    flushCluster();
    cluster = [item];
    clusterStartX = x;
  }

  flushCluster();

  if (selectedTime !== null && !visible.some((item) => item.time === selectedTime)) {
    const selected = items.find((item) => item.time === selectedTime);
    if (selected) {
      visible.push(selected);
      visible.sort((left, right) => left.time - right.time);
    }
  }

  return visible;
};

const findNearestTimeIndex = (times: number[], target: number): number => {
  if (times.length === 0) {
    return -1;
  }

  let closestIndex = 0;
  let closestDistance = Math.abs(times[0] - target);

  for (let index = 1; index < times.length; index += 1) {
    const distance = Math.abs(times[index] - target);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
};

const buildInlineSeriesLabels = (
  analyses: SeriesAnalysis[],
  getX: (time: number) => number,
  getY: (value: number) => number,
  top: number,
  bottom: number,
  anchorX: number
): InlineSeriesLabel[] => {
  const candidates = analyses
    .map((analysis) => {
      const point = [...analysis.points].reverse().find((item) => Number.isFinite(item.value));
      if (!point) {
        return null;
      }

      const labelText = truncateLabel(`${analysis.label} • ${formatValue(point.value)}`, 28);
      return {
        key: analysis.key,
        label: labelText,
        color: analysis.color,
        targetY: getY(point.value),
        labelY: getY(point.value),
        anchorX,
        lastX: getX(point.time),
        lastY: getY(point.value),
        width: Math.max(84, Math.min(168, labelText.length * 6.6 + 18)),
        value: point.value,
      };
    })
    .filter((item): item is InlineSeriesLabel => item !== null)
    .sort((left, right) => left.targetY - right.targetY);

  if (candidates.length === 0) {
    return [];
  }

  const minGap = 20;
  let cursor = top + 14;
  for (const label of candidates) {
    label.labelY = Math.max(label.targetY, cursor);
    cursor = label.labelY + minGap;
  }

  cursor = bottom - 12;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const label = candidates[index];
    label.labelY = Math.min(label.labelY, cursor);
    cursor = label.labelY - minGap;
  }

  return candidates.map((label) => ({
    ...label,
    labelY: Math.max(top + 14, Math.min(bottom - 12, label.labelY)),
  }));
};

const buildFocusBandModel = (
  selectionDetail: SelectionDetail | null,
  analyses: SeriesAnalysis[],
  times: number[]
): FocusBandModel | null => {
  if (!selectionDetail || times.length < 2) {
    return null;
  }

  const centerIndex = findNearestTimeIndex(times, selectionDetail.time);
  if (centerIndex < 0) {
    return null;
  }

  const radius = Math.max(3, Math.min(5, Math.floor(times.length / 10) || 3));
  const startIndex = Math.max(0, centerIndex - radius);
  const endIndex = Math.min(times.length - 1, centerIndex + radius);
  const startTime = times[startIndex];
  const endTime = times[endIndex];

  if (endTime <= startTime) {
    return null;
  }

  const series = analyses
    .map((analysis) => ({
      key: analysis.key,
      label: analysis.label,
      color: analysis.color,
      points: analysis.allPoints.filter((point) => point.time >= startTime && point.time <= endTime),
    }))
    .filter((analysis) => analysis.points.length > 0);

  if (series.length === 0) {
    return null;
  }

  const values = series.flatMap((analysis) =>
    analysis.points.flatMap((point) => [point.value, point.expected].filter((value): value is number => value !== null && Number.isFinite(value)))
  );

  if (values.length === 0) {
    return null;
  }

  return {
    startTime,
    endTime,
    selectedTime: selectionDetail.time,
    bucketStart: selectionDetail.bucketStart,
    bucketEnd: selectionDetail.bucketEnd,
    title: selectionDetail.kind === 'event' ? 'Focused incident window' : `Focused view for ${selectionDetail.seriesLabel}`,
    series,
    minValue: Math.min(...values),
    maxValue: Math.max(...values),
  };
};

const buildIncidentRibbonSegments = (
  analyses: SeriesAnalysis[],
  events: MultiMetricEvent[],
  mode: DetectionMode,
  times: number[]
): IncidentRibbonSegment[] => {
  const timeStepMs =
    times.length >= 2
      ? median(
          times.slice(1).map((time, index) => {
            return Math.max(time - times[index], 1);
          })
        )
      : 60 * 1000;
  const clusterGapMs = Math.max(timeStepMs * 1.25, 30 * 1000);

  const rawSegments =
    mode === 'multi'
      ? events
          .filter((event) => event.isAnomaly)
          .map((event) => ({
            start: event.bucketStart,
            end: Math.max(event.bucketEnd, event.time),
            center: event.time,
            severityLabel: event.severityLabel,
            severityScore: event.severityScore,
            selection: { kind: 'event', time: event.time } as SelectionToken,
          }))
      : analyses.flatMap((analysis) =>
          analysis.allPoints
            .filter((point) => point.isAnomaly)
            .map((point) => ({
              start: point.bucketStart,
              end: Math.max(point.bucketEnd, point.time),
              center: point.time,
              severityLabel: point.severityLabel,
              severityScore: point.severityScore,
              selection: { kind: 'point', seriesKey: analysis.key, time: point.time } as SelectionToken,
            }))
        );

  if (rawSegments.length === 0) {
    return [];
  }

  rawSegments.sort((left, right) => left.start - right.start);
  const grouped: IncidentRibbonSegment[] = [];
  let cluster = [rawSegments[0]];

  const flushCluster = () => {
    if (cluster.length === 0) {
      return;
    }

    const strongest = cluster.reduce<SeverityState & { selection: SelectionToken; center: number }>(
      (current, item) => {
        const candidate = pickHigherSeverity(current, item);
        return candidate === current ? current : item;
      },
      cluster[0]
    );

    const start = Math.min(...cluster.map((item) => item.start));
    const end = Math.max(...cluster.map((item) => item.end));
    grouped.push({
      key: `ribbon-${start}-${end}-${grouped.length}`,
      start,
      end,
      center: strongest.center,
      count: cluster.length,
      label: cluster.length === 1 ? '1 incident' : `${cluster.length} incidents`,
      severityLabel: strongest.severityLabel,
      severityScore: strongest.severityScore,
      selection: strongest.selection,
    });
    cluster = [];
  };

  for (let index = 1; index < rawSegments.length; index += 1) {
    const current = rawSegments[index];
    const last = cluster[cluster.length - 1];
    if (current.start <= last.end + clusterGapMs) {
      cluster.push(current);
      continue;
    }
    flushCluster();
    cluster = [current];
  }

  flushCluster();
  return grouped;
};

const buildHoverSnapshot = (
  hoverTime: number | null,
  analyses: SeriesAnalysis[],
  events: MultiMetricEvent[]
): HoverSnapshot | null => {
  if (hoverTime === null) {
    return null;
  }

  const series = analyses
    .map((analysis) => {
      const point = analysis.allPoints.find((item) => item.time === hoverTime);
      if (!point) {
        return null;
      }

      return {
        key: analysis.key,
        label: analysis.label,
        color: analysis.color,
        actual: point.value,
        expected: point.expected,
        score: point.score,
        isAnomaly: point.isAnomaly,
        severityLabel: point.severityLabel,
        severityScore: point.severityScore,
        confidenceScore: point.confidenceScore,
        confidenceLabel: point.confidenceLabel,
        dataQualityLabel: point.dataQualityLabel,
      };
    })
    .filter((item): item is HoverSeriesSnapshot => item !== null)
    .sort((left, right) => right.score - left.score);

  if (series.length === 0) {
    return null;
  }

  const event = events.find((item) => item.time === hoverTime) ?? null;
  const strongest = event
    ? { severityLabel: event.severityLabel, severityScore: event.severityScore }
    : series.reduce<SeverityState>((current, item) => pickHigherSeverity(current, item), { severityLabel: 'normal', severityScore: 0 });

  return {
    time: hoverTime,
    event,
    series,
    anomalyCount: series.filter((item) => item.isAnomaly).length + (event?.isAnomaly ? 1 : 0),
    severityLabel: strongest.severityLabel,
    severityScore: strongest.severityScore,
  };
};

const limitMarkerCount = <T extends { time: number; score: number }>(
  items: T[],
  maxCount: number,
  selectedTime: number | null = null
): T[] => {
  if (items.length <= maxCount) {
    return items;
  }

  const selected = selectedTime !== null ? items.find((item) => item.time === selectedTime) ?? null : null;
  const prioritized = [...items].sort((left, right) => right.score - left.score || left.time - right.time);
  const kept: T[] = [];

  if (selected) {
    kept.push(selected);
  }

  for (const item of prioritized) {
    if (kept.length >= maxCount) {
      break;
    }

    if (!kept.some((entry) => entry.time === item.time)) {
      kept.push(item);
    }
  }

  return kept.sort((left, right) => left.time - right.time);
};

const buildHowItWorksText = (options: ResolvedOptions, effectiveBucketSpanMs: number | null): string => {
  const bucketText = formatEffectiveBucketSpanLabel(options.bucketSpan, effectiveBucketSpanMs);
  const profileText =
    options.effectiveMetricPreset === 'custom'
      ? 'Custom profile is active.'
      : `${METRIC_PRESET_LABELS[options.effectiveMetricPreset]} profile is active.`;
  const algorithmText =
    options.algorithm === 'level_shift'
      ? `It focuses on sustained baseline shifts over the last ${options.baselineWindow} buckets.`
      : options.algorithm === 'seasonal'
        ? `It compares each point with similar historical positions using ${SEASONAL_REFINEMENT_LABELS[options.seasonalRefinement].toLowerCase()} refinement and ${options.seasonalitySamples} seasonal samples.`
        : options.algorithm === 'ewma'
          ? `It keeps a moving baseline over ${options.baselineWindow} buckets and reacts when the live metric keeps pulling away from that baseline.`
          : options.algorithm === 'mad'
            ? `It uses a robust median-based spread over ${options.baselineWindow} buckets so noisy data does not create too many false alarms.`
            : `It compares each point with a rolling average over ${options.baselineWindow} buckets.`;
  const bucketMessage = effectiveBucketSpanMs
    ? `Dense data is first summarized into ${bucketText} buckets so the panel stays fast.`
    : 'Incoming samples are scored directly for maximum detail.';

  return `${profileText} ${algorithmText} Current threshold is ${options.sensitivity.toFixed(2)}. ${bucketMessage}`;
};

const buildIncidentGroups = (points: SamplePoint[]): SamplePoint[][] => {
  const anomalies = points.filter((point) => point.isAnomaly).sort((left, right) => left.time - right.time);
  if (anomalies.length === 0) {
    return [];
  }

  const groups: SamplePoint[][] = [];
  let currentGroup: SamplePoint[] = [anomalies[0]];

  for (let index = 1; index < anomalies.length; index += 1) {
    const previous = currentGroup[currentGroup.length - 1];
    const candidate = anomalies[index];
    const previousSpan = Math.max(previous.bucketEnd - previous.bucketStart, 1);
    const candidateSpan = Math.max(candidate.bucketEnd - candidate.bucketStart, 1);
    const mergeGap = Math.max(previousSpan, candidateSpan) * 1.25;

    if (candidate.bucketStart <= previous.bucketEnd + mergeGap) {
      currentGroup.push(candidate);
      continue;
    }

    groups.push(currentGroup);
    currentGroup = [candidate];
  }

  groups.push(currentGroup);
  return groups;
};

const buildSummaryItems = (analyses: SeriesAnalysis[], events: MultiMetricEvent[], options: ResolvedOptions): SummaryItem[] => {
  if (options.detectionMode === 'multi') {
    return events
      .filter((event) => event.isAnomaly)
      .sort((left, right) => right.score - left.score)
      .slice(0, options.maxAnomalies)
      .map((event, index) => ({
        key: `event-${event.time}-${index}`,
        time: event.time,
        title: `Cross-metric incident at ${formatTime(event.time)}`,
        subtitle: `${event.activeSeries} metric${event.activeSeries === 1 ? '' : 's'} aligned${event.contributors.length > 0 ? ` | ${event.contributors.join(', ')}` : ''}`,
        detail: `${SEVERITY_LABELS[event.severityLabel]} ${event.severityScore} | ${CONFIDENCE_LABELS[event.confidenceLabel]} | ${DATA_QUALITY_LABELS[event.dataQualityLabel]}`,
        score: event.score,
        severityLabel: event.severityLabel,
        severityScore: event.severityScore,
        confidenceScore: event.confidenceScore,
        confidenceLabel: event.confidenceLabel,
        dataQualityLabel: event.dataQualityLabel,
        selection: { kind: 'event' as const, time: event.time },
      }));
  }

  return analyses
    .flatMap((analysis) =>
      buildIncidentGroups(analysis.allPoints).map((incident, index) => {
        const peak = incident.reduce((current, point) => (point.score > current.score ? point : current));
        const incidentStart = incident[0].bucketStart;
        const incidentEnd = incident[incident.length - 1].bucketEnd;
        return {
          key: `${analysis.key}-${peak.time}-${index}`,
          time: peak.time,
          title: buildIncidentHeadline(analysis.label, options.algorithm, peak.scoreDriver),
          subtitle: incident.length > 1 ? `${incident.length} consecutive buckets | ${formatBucketWindow(incidentStart, incidentEnd)}` : formatBucketWindow(incidentStart, incidentEnd),
          detail: `${SEVERITY_LABELS[peak.severityLabel]} ${peak.severityScore} | ${CONFIDENCE_LABELS[peak.confidenceLabel]} | Current ${formatValue(peak.value)} vs expected ${formatValue(peak.expected)}`,
          score: peak.score,
          severityLabel: peak.severityLabel,
          severityScore: peak.severityScore,
          confidenceScore: peak.confidenceScore,
          confidenceLabel: peak.confidenceLabel,
          dataQualityLabel: peak.dataQualityLabel,
          selection: { kind: 'point' as const, seriesKey: analysis.key, time: peak.time },
        };
      })
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, options.maxAnomalies);
};

const isKeyboardNavigationTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(target.tagName) || target.isContentEditable;
};

const selectionExists = (selection: SelectionToken | null, analyses: SeriesAnalysis[], events: MultiMetricEvent[]): boolean => {
  if (!selection) {
    return false;
  }

  if (selection.kind === 'event') {
    return events.some((event) => event.time === selection.time);
  }

  return analyses.some((analysis) => analysis.key === selection.seriesKey && analysis.allPoints.some((point) => point.time === selection.time));
};

const findClosestSelectionPoint = (
  selection: Extract<SelectionToken, { kind: 'point' }>,
  analyses: SeriesAnalysis[]
): { analysis: SeriesAnalysis; point: SamplePoint } | null => {
  const preferred = analyses.find((item) => item.key === selection.seriesKey) ?? null;
  const candidates = preferred ? [preferred, ...analyses.filter((item) => item.key !== preferred.key)] : analyses;

  for (const analysis of candidates) {
    const exact = analysis.allPoints.find((item) => item.time === selection.time);
    if (exact) {
      return { analysis, point: exact };
    }
  }

  let closest: { analysis: SeriesAnalysis; point: SamplePoint; distance: number } | null = null;
  let fallback: { analysis: SeriesAnalysis; point: SamplePoint; distance: number } | null = null;
  for (const analysis of candidates) {
    for (const point of analysis.allPoints) {
      const bucketSpan = Math.max(point.bucketEnd - point.bucketStart, 1);
      const distance = Math.abs(point.time - selection.time);
      if (point.isAnomaly && (!fallback || distance < fallback.distance)) {
        fallback = { analysis, point, distance };
      }
      if (distance <= bucketSpan * 1.5 && (!closest || distance < closest.distance)) {
        closest = { analysis, point, distance };
      }
    }
  }

  const match = closest ?? fallback;
  return match ? { analysis: match.analysis, point: match.point } : null;
};

const buildSelectionDetail = (selection: SelectionToken | null, analyses: SeriesAnalysis[], events: MultiMetricEvent[]): SelectionDetail | null => {
  if (!selection) {
    return null;
  }

  if (selection.kind === 'point') {
    const match = findClosestSelectionPoint(selection, analyses);
    if (!match) {
      return null;
    }
    const { analysis, point } = match;

    const deviation = point.expected === null ? null : point.value - point.expected;
    const deviationPercent = point.expected && Math.abs(point.expected) > 1e-9 ? (deviation! / point.expected) * 100 : null;

    return {
      kind: 'point',
      title: `${point.scoreDriver === 'window' ? 'Sustained change' : 'Sharp change'} in ${analysis.label}`,
      subtitle: formatBucketWindow(point.bucketStart, point.bucketEnd),
      seriesKey: analysis.key,
      seriesLabel: analysis.label,
      color: analysis.color,
      time: point.time,
      bucketStart: point.bucketStart,
      bucketEnd: point.bucketEnd,
      actual: point.value,
      expected: point.expected,
      deviation,
      deviationPercent,
      rangeLower: point.lower,
      rangeUpper: point.upper,
      sampleCount: point.sampleCount,
      minValue: point.minValue,
      maxValue: point.maxValue,
      score: point.score,
      pointScore: point.pointScore,
      windowScore: point.windowScore,
      scoreDriver: point.scoreDriver,
      severityLabel: point.severityLabel,
      severityScore: point.severityScore,
      confidenceScore: point.confidenceScore,
      confidenceLabel: point.confidenceLabel,
      dataQualityLabel: point.dataQualityLabel,
    };
  }

  const event = events.find((item) => item.time === selection.time);
  if (!event) {
    return null;
  }

  const breakdown = analyses
    .map((analysis) => {
      const point = analysis.allPoints.find((item) => item.time === event.time);
      if (!point) {
        return null;
      }

      return {
        label: analysis.label,
        color: analysis.color,
        actual: point.value,
        expected: point.expected,
        deviation: point.expected === null ? null : point.value - point.expected,
        rangeLower: point.lower,
        rangeUpper: point.upper,
        score: point.score,
        pointScore: point.pointScore,
        windowScore: point.windowScore,
        scoreDriver: point.scoreDriver,
        severityLabel: point.severityLabel,
        severityScore: point.severityScore,
        confidenceScore: point.confidenceScore,
        confidenceLabel: point.confidenceLabel,
        dataQualityLabel: point.dataQualityLabel,
      } as DetailMetricRow;
    })
    .filter((item): item is DetailMetricRow => item !== null)
    .sort((left, right) => right.score - left.score);

  return {
    kind: 'event',
    title: `Cross-metric incident at ${formatTime(event.time)}`,
    subtitle: formatBucketWindow(event.bucketStart, event.bucketEnd),
    time: event.time,
    bucketStart: event.bucketStart,
    bucketEnd: event.bucketEnd,
    score: event.score,
    activeSeries: event.activeSeries,
    contributors: event.contributors,
    breakdown,
    severityLabel: event.severityLabel,
    severityScore: event.severityScore,
    confidenceScore: event.confidenceScore,
    confidenceLabel: event.confidenceLabel,
    dataQualityLabel: event.dataQualityLabel,
  };
};

const buildFallbackSelectionDetail = (item: SummaryItem | null): SelectionDetail | null => {
  if (!item) {
    return null;
  }

  return {
    kind: 'point',
    title: item.title,
    subtitle: item.subtitle,
    seriesKey: selectionKey(item.selection),
    seriesLabel: item.title,
    color: SEVERITY_COLORS[item.severityLabel],
    time: item.time,
    bucketStart: item.time,
    bucketEnd: item.time + 1,
    actual: item.score,
    expected: null,
    deviation: null,
    deviationPercent: null,
    rangeLower: null,
    rangeUpper: null,
    sampleCount: 1,
    minValue: item.score,
    maxValue: item.score,
    score: item.score,
    pointScore: item.score,
    windowScore: 0,
    scoreDriver: 'point',
    severityLabel: item.severityLabel,
    severityScore: item.severityScore,
    confidenceScore: item.confidenceScore,
    confidenceLabel: item.confidenceLabel,
    dataQualityLabel: item.dataQualityLabel,
  };
};

const uniqueTagValues = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  return values
    .map((value) => (value ?? '').trim())
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
};

const buildAnnotationExport = (items: SummaryItem[], bucketSpanLabel: string): string =>
  JSON.stringify(
    items.map((item) => ({
      time: item.time,
      text: item.title,
      tags: uniqueTagValues(['anomaly-detector', item.severityLabel, item.confidenceLabel, item.dataQualityLabel, bucketSpanLabel]),
      detail: item.detail,
      raw_score: item.score,
      alarm_score_0_100: item.severityScore,
      alarm_severity: item.severityLabel,
      confidence_score: item.confidenceScore,
      confidence_label: item.confidenceLabel,
      data_quality: item.dataQualityLabel,
    })),
    null,
    2
  );

const getRecommendedAlertThreshold = (severityPreset: SeverityPreset): number => {
  switch (severityPreset) {
    case 'warning_first':
      return 60;
    case 'page_first':
      return 75;
    default:
      return 70;
  }
};

const GRAFANA_ALERT_RULE_BUILDER_PATH = '/alerting/new';
const ALERT_DRAFT_STORAGE_KEY = 'grafana-anomaly-alert-draft';

const formatLabelPairs = (labels: Record<string, string>): string =>
  Object.entries(labels)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

const setFormControlValue = (targetWindow: Window, selector: string, value: string): boolean => {
  const element = targetWindow.document.querySelector(selector);
  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName !== 'input' && tagName !== 'textarea') {
    return false;
  }

  const control = element as HTMLInputElement | HTMLTextAreaElement;
  control.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};

const tryPrefillGrafanaAlertBuilder = (builderWindow: Window, draft: AlertRuleDraftContext): void => {
  let attempts = 0;
  const fill = () => {
    attempts += 1;

    try {
      const doc = builderWindow.document;
      if (!doc || builderWindow.closed) {
        return;
      }

      setFormControlValue(builderWindow, '[data-testid="data-testid alert-rule name-field"], input[name="name"], input[placeholder="Give your alert rule a name"]', draft.ruleName);
      setFormControlValue(builderWindow, 'input[type="number"]', String(draft.threshold));
      setFormControlValue(builderWindow, '[data-testid="annotation-value-0"], textarea[name="annotations.0.value"]', draft.annotations.summary ?? draft.ruleName);
      setFormControlValue(builderWindow, '[data-testid="annotation-value-1"], textarea[name="annotations.1.value"]', draft.annotations.description ?? '');

      if (draft.queryLanguage.toLowerCase() === 'promql') {
        const codeMode = doc.querySelector('input[id^="option-code-radiogroup"]');
        if (codeMode && attempts <= 2 && typeof (codeMode as HTMLElement).click === 'function') {
          (codeMode as HTMLElement).click();
        }

        const querySelector = [
          'textarea[placeholder*="PromQL"]',
          'textarea[aria-label*="Query"]',
          'textarea[aria-label*="Editor content"]',
          'input[placeholder*="PromQL"]',
          'input[aria-label*="Query"]',
          'textarea[name*="expr"]',
          'input[name*="expr"]',
        ].join(',');
        setFormControlValue(builderWindow, querySelector, draft.alertQuery);
      }
    } catch {
      // Grafana owns the builder route. Prefill is best-effort and must not break the panel flow.
    }

    if (attempts < 18 && !builderWindow.closed) {
      builderWindow.setTimeout(fill, 450);
    }
  };

  builderWindow.setTimeout(fill, 450);
};

const openGrafanaAlertRuleBuilder = (draft: AlertRuleDraftContext): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const builderUrl = new URL(GRAFANA_ALERT_RULE_BUILDER_PATH, window.location.origin);
  const currentOrgId = new URLSearchParams(window.location.search).get('orgId');
  if (currentOrgId) {
    builderUrl.searchParams.set('orgId', currentOrgId);
  }

  if (draft.dashboardUid) {
    builderUrl.searchParams.set('dashboardUid', draft.dashboardUid);
  }

  if (draft.panelId > 0) {
    builderUrl.searchParams.set('panelId', String(draft.panelId));
  }

  builderUrl.searchParams.set('title', draft.ruleName);
  builderUrl.searchParams.set('ruleName', draft.ruleName);
  if (draft.folderTitle) {
    builderUrl.searchParams.set('folderTitle', draft.folderTitle);
  }
  builderUrl.searchParams.set('dashboardTitle', draft.dashboardTitle);
  builderUrl.searchParams.set('panelTitle', draft.panelTitle);
  builderUrl.searchParams.set('queryLanguage', draft.queryLanguage);
  builderUrl.searchParams.set('threshold', String(draft.threshold));
  builderUrl.searchParams.set('for', '10m');
  builderUrl.searchParams.set('evaluateEvery', '3m');
  builderUrl.searchParams.set('labels', formatLabelPairs(draft.labels));

  Object.entries(draft.labels).forEach(([key, value]) => {
    if (value) {
      builderUrl.searchParams.set(`label_${key}`, value);
    }
  });

  if (draft.alertQuery && draft.alertQuery.length <= 1400) {
    builderUrl.searchParams.set('query', draft.alertQuery);
  }

  builderUrl.searchParams.set('returnTo', `${window.location.pathname}${window.location.search}`);

  try {
    window.sessionStorage.setItem(ALERT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Session storage can be disabled in hardened browser contexts. The URL and clipboard still carry the draft.
  }

  const builderWindow = window.open(builderUrl.toString(), '_blank');
  if (!builderWindow) {
    return false;
  }

  tryPrefillGrafanaAlertBuilder(builderWindow, draft);
  return true;
};

const escapePrometheusRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isPrometheusFeedRule = (rule: ScoreFeedRule): boolean => {
  const language = (rule.queryLanguage ?? '').toLowerCase();
  const target = (rule.target ?? '').toLowerCase();
  return language === 'promql' || target === 'prometheus' || (!language && rule.query.includes('grafana_anomaly_rule_score'));
};

const buildAlertQuery = (registeredRules: ScoreFeedRule[]): string => {
  if (registeredRules.length === 0) {
    return '';
  }

  if (registeredRules.length === 1) {
    return registeredRules[0].query;
  }

  if (!registeredRules.every(isPrometheusFeedRule)) {
    return registeredRules.map((rule) => rule.query).join('\n\n');
  }

  const matcher = registeredRules.map((rule) => escapePrometheusRegex(rule.rule)).join('|');
  return `max(max_over_time(grafana_anomaly_rule_score{rule=~"${matcher}"}[5m]))`;
};

const getAlertQueryLanguage = (registeredRules: ScoreFeedRule[]): string => {
  if (registeredRules.length === 0) {
    return 'query';
  }

  const languages = Array.from(new Set(registeredRules.map((rule) => rule.queryLanguage).filter((value): value is string => Boolean(value))));
  if (languages.length === 1) {
    return languages[0];
  }

  if (registeredRules.every(isPrometheusFeedRule)) {
    return 'PromQL';
  }

  return 'target-specific query';
};

const SCORE_FEED_TARGET_VALUES: ScoreFeedTarget[] = ['prometheus', 'loki', 'influxdb', 'postgresql', 'clickhouse', 'elasticsearch'];

const normalizeScoreFeedTarget = (target?: ScoreFeedTarget | string): ScoreFeedTarget => {
  const normalized = String(target ?? '').toLowerCase();
  return SCORE_FEED_TARGET_VALUES.includes(normalized as ScoreFeedTarget) ? (normalized as ScoreFeedTarget) : 'prometheus';
};

const getAlertQueryTargetLabel = (rule: ScoreFeedRule | ScoreFeedQueryVariant): string => {
  const target = normalizeScoreFeedTarget(rule.target);
  const targetLabel = SCORE_FEED_TARGET_LABELS[target];
  return `${targetLabel}${rule.queryLanguage ? ` (${rule.queryLanguage})` : ''}`;
};

const buildAlertRuleLabels = (dashboardUid: string, panelId: number, target: ScoreFeedTarget | string): Record<string, string> => ({
  alert_family: 'anomaly_detector',
  severity: 'major',
  dashboard_uid: dashboardUid || 'unsaved_dashboard',
  panel_id: panelId > 0 ? String(panelId) : 'unknown_panel',
  score_target: normalizeScoreFeedTarget(target),
});

const buildAlertRuleDescription = (detail: SelectionDetail | null, panelTitle: string): string => {
  if (!detail) {
    return `Anomaly score alert for ${panelTitle}.`;
  }

  if (detail.kind === 'point') {
    return `${detail.title}. Raw detection score ${formatValue(detail.score)}; alert score ${detail.severityScore}/100 (${SEVERITY_LABELS[detail.severityLabel]}). Current ${formatValue(detail.actual)} vs expected ${formatValue(detail.expected)}.`;
  }

  return `${detail.title}. Raw detection score ${formatValue(detail.score)} across ${detail.activeSeries} active series; alert score ${detail.severityScore}/100 (${SEVERITY_LABELS[detail.severityLabel]}): ${detail.contributors.slice(0, 4).join(', ')}.`;
};

const buildAlertRuleAnnotations = (detail: SelectionDetail | null, draft: Pick<AlertRuleDraftContext, 'dashboardUid' | 'folderTitle' | 'dashboardTitle' | 'panelId' | 'panelTitle' | 'ruleName'>): Record<string, string> => ({
  summary: detail ? detail.title : draft.ruleName,
  description: buildAlertRuleDescription(detail, draft.panelTitle),
  folder_title: draft.folderTitle ?? '',
  dashboard_title: draft.dashboardTitle,
  panel_title: draft.panelTitle,
  __dashboardUid__: draft.dashboardUid,
  __panelId__: draft.panelId > 0 ? String(draft.panelId) : '',
});

const buildAlertExport = (
  detail: SelectionDetail | null,
  options: ResolvedOptions,
  bucketSpanLabel: string,
  registeredRules: ScoreFeedRule[],
  draft: AlertRuleDraftContext
): string => {
  const threshold = getRecommendedAlertThreshold(options.severityPreset);
  const alertQuery = buildAlertQuery(registeredRules);
  const queryLanguage = getAlertQueryLanguage(registeredRules);

  return JSON.stringify(
    {
      title: draft.ruleName,
      folder_name: draft.folderTitle ?? '',
      dashboard_name: draft.dashboardTitle,
      dashboard_uid: draft.dashboardUid,
      panel_title: draft.panelTitle,
      panel_id: draft.panelId,
      score_feed_ready: registeredRules.length > 0,
      paste_into: `Grafana Alerting query editor (${queryLanguage})`,
      query_language: queryLanguage,
      alert_query: alertQuery || 'Sync anomaly score feed first to generate an alert-ready score query.',
      grafana_condition: alertQuery ? `WHEN QUERY IS ABOVE ${threshold}` : 'Sync anomaly score feed first',
      for: '10m',
      evaluate_every: '3m',
      no_data_state: 'Alerting',
      exec_err_state: 'Error',
      threshold,
      suggested_labels: draft.labels,
      suggested_label_pairs: formatLabelPairs(draft.labels),
      suggested_annotations: draft.annotations,
      synced_rules: registeredRules.map((rule) => ({
        rule: rule.rule,
        target: rule.target ?? 'prometheus',
        query_language: rule.queryLanguage ?? queryLanguage,
        datasource_type: rule.datasourceType ?? '',
        query: rule.query,
        per_series_query: rule.perSeriesQuery,
        query_variants: rule.queryVariants ?? [],
      })),
      rule_scope: registeredRules.length > 1 ? 'Combined max across synced panel rules' : 'Single synced panel rule',
      mode: options.detectionMode,
      algorithm: options.algorithm,
      bucket_span: bucketSpanLabel,
      history_window: options.baselineWindow,
      severity_preset: options.severityPreset,
      selected_severity: detail ? detail.severityLabel : 'normal',
      selected_score: detail ? detail.score : 0,
      selected_raw_score: detail ? detail.score : 0,
      selected_alarm_score_0_100: detail ? detail.severityScore : 0,
      selected_alarm_severity: detail ? detail.severityLabel : 'normal',
      score_scale_note: 'Alert queries use the normalized 0-100 alarm score, not the raw detection score.',
      selected_confidence: detail ? detail.confidenceLabel : 'low',
      selected_confidence_score: detail ? detail.confidenceScore : 0,
      selected_data_quality: detail ? detail.dataQualityLabel : 'thin',
      guidance: detail ? buildAlertGuidance(detail, options.severityPreset) : 'Select an anomaly to generate a focused alert draft.',
    },
    null,
    2
  );
};

const slugifyTagValue = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'metric';
};

const buildSelectedAnnotationPayload = (
  detail: SelectionDetail | null,
  panelId: number,
  dashboardUid: string,
  bucketSpanLabel: string
): GrafanaAnnotationPayload | null => {
  if (!detail) {
    return null;
  }

  const tags = uniqueTagValues(['anomaly-detector', detail.severityLabel, detail.confidenceLabel, detail.dataQualityLabel, slugifyTagValue(bucketSpanLabel), detail.kind]);
  const payload: GrafanaAnnotationPayload = {
    time: detail.bucketStart,
    tags,
    text: '',
  };

  if (dashboardUid) {
    payload.dashboardUID = dashboardUid;
    payload.dashboardUid = dashboardUid;
  }

  if (panelId > 0) {
    payload.panelId = panelId;
  }

  if (detail.bucketEnd > detail.bucketStart) {
    payload.timeEnd = detail.bucketEnd;
    payload.isRegion = true;
  }

  if (detail.kind === 'point') {
    const seriesTag = slugifyTagValue(detail.seriesLabel);
    if (!tags.includes(seriesTag)) {
      tags.push(seriesTag);
    }
    payload.text = [
      detail.title,
      `Window: ${formatBucketWindow(detail.bucketStart, detail.bucketEnd)}`,
      `Raw detection score: ${formatValue(detail.score)}`,
      `Alert score (0-100): ${SEVERITY_LABELS[detail.severityLabel]} ${detail.severityScore}`,
      `Confidence: ${CONFIDENCE_LABELS[detail.confidenceLabel]} (${formatValue(detail.confidenceScore)})`,
      `Data quality: ${DATA_QUALITY_LABELS[detail.dataQualityLabel]}`,
      `Actual: ${formatValue(detail.actual)} | Expected: ${formatValue(detail.expected)}`,
      `Deviation: ${formatValue(detail.deviation)}${detail.deviationPercent === null ? '' : ` (${formatValue(detail.deviationPercent)}%)`}`,
      `Expected range: ${formatValue(detail.rangeLower)} to ${formatValue(detail.rangeUpper)}`,
    ].join('\n');
    return payload;
  }

  payload.text = [
    detail.title,
    `Window: ${formatBucketWindow(detail.bucketStart, detail.bucketEnd)}`,
    `Raw detection score: ${formatValue(detail.score)}`,
    `Alert score (0-100): ${SEVERITY_LABELS[detail.severityLabel]} ${detail.severityScore}`,
    `Confidence: ${CONFIDENCE_LABELS[detail.confidenceLabel]} (${formatValue(detail.confidenceScore)})`,
    `Data quality: ${DATA_QUALITY_LABELS[detail.dataQualityLabel]}`,
    `Active series: ${detail.activeSeries}`,
    `Top contributors: ${detail.contributors.join(', ') || 'No contributors found'}`,
  ].join('\n');
  return payload;
};

const copyTextToClipboard = async (value: string): Promise<void> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise<never>((_, reject) => {
          const setTimer = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
          setTimer(() => reject(new Error('Clipboard API timed out.')), 900);
        }),
      ]);
      return;
    } catch {
      // Grafana panels often run inside iframes where Clipboard API can be denied or hang.
      // Fall through to the textarea copy path so inspector actions still give feedback.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard access is not available in this environment.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Clipboard API fallback for older browser contexts. 
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('The browser blocked clipboard access.');
  }
};

const buildGrafanaErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const data = record.data;
    const dataRecord = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const candidate =
      (typeof dataRecord?.message === 'string' && dataRecord.message) ||
      (typeof record.statusText === 'string' && record.statusText) ||
      (typeof record.message === 'string' && record.message) ||
      '';
    const statusSuffix = typeof record.status === 'number' && !String(candidate).includes(String(record.status)) ? ` (HTTP ${record.status})` : '';
    if (candidate) {
      return `${candidate}${statusSuffix}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};

const createGrafanaAnnotation = async (payload: GrafanaAnnotationPayload): Promise<void> => {
  try {
    await getBackendSrv().post('/api/annotations', payload);
  } catch (error) {
    throw new Error(buildGrafanaErrorMessage(error, 'Failed to create the Grafana annotation.'));
  }
};
const DEFAULT_SCORE_FEED_ENDPOINT = 'http://127.0.0.1:9110';
const AUTO_SCORE_FEED_SYNC_MS = 15000;

const SCORE_FEED_MODE_LABELS: Record<ScoreFeedMode, string> = {
  off: 'Off',
  manual: 'Manual sync',
  auto: 'Auto sync',
};

const SCORE_FEED_TARGET_LABELS: Record<ScoreFeedTarget, string> = {
  prometheus: 'Prometheus metrics',
  loki: 'Loki',
  influxdb: 'InfluxDB',
  postgresql: 'PostgreSQL',
  clickhouse: 'ClickHouse',
  elasticsearch: 'Elasticsearch',
};

const SCORE_FEED_TARGET_SHORT_LABELS: Record<ScoreFeedTarget, string> = {
  prometheus: 'Prometheus',
  loki: 'Loki',
  influxdb: 'InfluxDB',
  postgresql: 'PostgreSQL',
  clickhouse: 'ClickHouse',
  elasticsearch: 'Elastic',
};

const SCORE_FEED_TARGET_COLORS: Record<ScoreFeedTarget, string> = {
  prometheus: '#94A3B8',
  loki: '#F59E0B',
  influxdb: '#3B82F6',
  postgresql: '#60A5FA',
  clickhouse: '#FACC15',
  elasticsearch: '#22D3EE',
};

const getScoreFeedTargetShortLabel = (target?: ScoreFeedTarget | string): string => {
  return SCORE_FEED_TARGET_SHORT_LABELS[normalizeScoreFeedTarget(target)];
};

const ScoreFeedTargetIcon = ({ target }: { target?: ScoreFeedTarget | string }): React.ReactElement => {
  switch (normalizeScoreFeedTarget(target)) {
    case 'loki':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 20V7.6l3.3-.9V20H7Z" fill="#D97706" />
          <path d="M11.3 20V3.8l3.4-.9V20h-3.4Z" fill="#F59E0B" />
          <path d="M15.8 20V10.2l3.2-.86V20h-3.2Z" fill="#FBBF24" />
          <path d="M5.2 20.4h15.1" stroke="#B45309" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'influxdb':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 2.8 20 7.3v9.4l-8 4.5-8-4.5V7.3l8-4.5Z" fill="none" stroke="#3B82F6" strokeWidth="1.8" />
          <path d="m12 2.8 3.9 7.1L12 21.2 8.1 9.9 12 2.8Z" fill="none" stroke="#60A5FA" strokeWidth="1.3" />
          <path d="M4 7.3 12 12l8-4.7M4 16.7 12 12l8 4.7" fill="none" stroke="#2563EB" strokeWidth="1.2" />
        </svg>
      );
    case 'postgresql':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M6.2 10.6c0-4.4 2.4-7 6.1-7 3.9 0 6.5 2.7 6.5 7 0 2.9-1.2 5.1-3.3 6.3l.3 3.1-2.9-1.8c-.8.15-1.7.15-2.6-.03L7.2 20l.43-3.35c-.95-.7-1.43-2.55-1.43-6.05Z"
            fill="#3B82F6"
            opacity="0.9"
          />
          <path d="M9 10.1c.45-.5 1.25-.5 1.7 0M14 10.1c.45-.5 1.25-.5 1.7 0" stroke="#DBEAFE" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M12.8 11.3c-.4 1.2-.15 2.1.75 2.7.85.6.95 1.55.15 2.45" fill="none" stroke="#DBEAFE" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case 'clickhouse':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 4h3v16H4V4Zm5 0h3v16H9V4Zm5 0h3v16h-3V4Z" fill="#FACC15" />
          <path d="M19 4h1.8v16H19V4Z" fill="#EF4444" />
        </svg>
      );
    case 'elasticsearch':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="9" cy="7" r="4" fill="#F59E0B" />
          <circle cx="15.2" cy="7.7" r="3.3" fill="#22C55E" />
          <circle cx="16.1" cy="14.8" r="4" fill="#06B6D4" />
          <circle cx="8.2" cy="15.5" r="3.5" fill="#EF4444" />
          <circle cx="12" cy="11.5" r="3.3" fill="#64748B" opacity="0.72" />
        </svg>
      );
    case 'prometheus':
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <ellipse cx="12" cy="5.4" rx="7.2" ry="3.1" fill="#64748B" />
          <path d="M4.8 5.4v4.5c0 1.7 3.2 3.1 7.2 3.1s7.2-1.4 7.2-3.1V5.4" fill="#475569" />
          <ellipse cx="12" cy="9.9" rx="7.2" ry="3.1" fill="#94A3B8" />
          <path d="M4.8 9.9v4.5c0 1.7 3.2 3.1 7.2 3.1s7.2-1.4 7.2-3.1V9.9" fill="#475569" />
          <ellipse cx="12" cy="14.4" rx="7.2" ry="3.1" fill="#CBD5E1" />
        </svg>
      );
  }
};

const getScoreFeedTargetIcon = (target?: ScoreFeedTarget | string): React.ReactNode => {
  return <ScoreFeedTargetIcon target={target} />;
};

const getScoreFeedTargetColor = (target?: ScoreFeedTarget | string): string => {
  return SCORE_FEED_TARGET_COLORS[normalizeScoreFeedTarget(target)];
};

const normalizeScoreFeedEndpoint = (value?: string): string => {
  const trimmed = (value ?? DEFAULT_SCORE_FEED_ENDPOINT).trim();
  const normalized = trimmed.replace(/\/+$/, '');
  return normalized || DEFAULT_SCORE_FEED_ENDPOINT;
};

const sanitizeRuleName = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || 'anomaly_panel';
};

const buildComputedRuleName = (panelTitle: string, prefix?: string): string => {
  const base = sanitizeRuleName(panelTitle || 'anomaly_panel');
  const normalizedPrefix = sanitizeRuleName(prefix ?? '');
  return normalizedPrefix ? `${normalizedPrefix}_${base}` : base;
};

const getDashboardUidFromLocation = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  const match = window.location.pathname.match(/\/d\/([^/]+)/);
  return match?.[1] ?? '';
};

const inferDashboardTitle = (): string => {
  if (typeof document === 'undefined') {
    return '';
  }

  return document.title
    .replace(/\s+-\s+Grafana$/i, '')
    .replace(/^View panel\s+-\s+/i, '')
    .replace(/^Edit panel\s+-\s+/i, '')
    .replace(/\s+-\s+Dashboards$/i, '')
    .trim();
};

const inferDashboardFolderTitle = (): string => {
  if (typeof document === 'undefined') {
    return '';
  }

  const breadcrumbs = Array.from(document.querySelectorAll('nav[aria-label="Breadcrumbs"] a'))
    .map((item) => item.textContent?.trim() ?? '')
    .filter(Boolean);

  if (breadcrumbs.length >= 3 && breadcrumbs[0].toLowerCase() === 'dashboards') {
    return breadcrumbs[1];
  }

  return '';
};

const buildAlertRuleDisplayName = (folderTitle: string, dashboardTitle: string, panelTitle: string): string => {
  const cleanFolderTitle = folderTitle.trim();
  let cleanDashboardTitle = dashboardTitle.trim();

  if (cleanFolderTitle && cleanDashboardTitle.toLowerCase().endsWith(` - ${cleanFolderTitle}`.toLowerCase())) {
    cleanDashboardTitle = cleanDashboardTitle.slice(0, cleanDashboardTitle.length - cleanFolderTitle.length - 3).trim();
  }

  return [cleanFolderTitle, cleanDashboardTitle, panelTitle.trim()]
    .filter((value, index, values) => value.length > 0 && values.findIndex((candidate) => candidate === value) === index)
    .join(' - ');
};

const extractDatasourceInfo = (value: unknown): { uid: string; type: string; url: string } => {
  if (typeof value === 'string') {
    return { uid: value, type: '', url: '' };
  }

  if (!value || typeof value !== 'object') {
    return { uid: '', type: '', url: '' };
  }

  const record = value as Record<string, unknown>;
  return {
    uid: String(record.uid ?? record.name ?? ''),
    type: String(record.type ?? ''),
    url: String(record.url ?? ''),
  };
};

const normalizeDatasourceUrlForExporter = (url: string, datasourceType: string): string => {
  const value = url.trim();
  const type = datasourceType.trim().toLowerCase();
  if (!value) {
    return '';
  }

  if ((type === 'postgres' || type === 'postgresql' || type.includes('postgresql')) && !/^postgres(?:ql)?:\/\//i.test(value)) {
    return '';
  }

  return value;
};

const extractPrometheusTargets = (targets: unknown[]): FeedQueryTarget[] => {
  return targets
    .flatMap((target, index) => {
      if (!target || typeof target !== 'object') {
        return [];
      }

      const record = target as Record<string, unknown>;
      if (record.hide === true) {
        return [];
      }

      const datasource = extractDatasourceInfo(record.datasource);
      const datasourceUid = String(record.datasourceUid ?? datasource.uid ?? '').trim();
      const datasourceType = String(record.datasourceType ?? datasource.type ?? '').trim().toLowerCase();
      const datasourceUrl = normalizeDatasourceUrlForExporter(String(record.datasourceUrl ?? record.url ?? datasource.url ?? '').trim(), datasourceType);
      const rawExpr = String(record.expr ?? record.expression ?? record.query ?? record.rawSql ?? record.rawQuery ?? '').trim();
      const expr =
        datasourceType === 'elasticsearch' && (record.metrics || record.bucketAggs || record.timeField)
          ? JSON.stringify({
              query: rawExpr,
              metrics: record.metrics ?? [],
              bucketAggs: record.bucketAggs ?? [],
              timeField: record.timeField ?? '@timestamp',
            })
          : rawExpr;
      if (!expr) {
        return [];
      }

      if (datasourceUid === '__expr__' || datasourceType === '__expr__' || datasourceType === 'expression') {
        return [];
      }

      return [
        {
          refId: String(record.refId ?? `Q${index + 1}`).trim() || `Q${index + 1}`,
          expr,
          legend: String(record.legendFormat ?? record.legend ?? '').trim(),
          datasourceUid,
          datasourceType,
          datasourceUrl,
        },
      ];
    })
    .filter((target, index, items) => items.findIndex((item) => item.refId === target.refId && item.expr === target.expr) === index);
};

const readGrafanaDatasourceUrl = async (uid: string, datasourceType: string): Promise<string> => {
  if (!uid || uid === '__expr__' || typeof fetch === 'undefined') {
    return '';
  }

  try {
    const response = await fetch(`/api/datasources/uid/${encodeURIComponent(uid)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return '';
    }
    const payload = (await response.json()) as { url?: unknown; type?: unknown };
    return normalizeDatasourceUrlForExporter(String(payload.url ?? '').trim(), String(payload.type ?? datasourceType));
  } catch {
    return '';
  }
};

const enrichTargetsWithDatasourceUrls = async (targets: FeedQueryTarget[]): Promise<FeedQueryTarget[]> => {
  if (targets.length === 0) {
    return targets;
  }

  const datasourceKeys = Array.from(
    new Set(
      targets
        .filter((target) => !target.datasourceUrl && target.datasourceUid)
        .map((target) => `${target.datasourceUid}:::${target.datasourceType}`)
    )
  );
  const urlEntries = await Promise.all(
    datasourceKeys.map(async (key) => {
      const [uid, datasourceType] = key.split(':::');
      return [uid, await readGrafanaDatasourceUrl(uid, datasourceType)] as const;
    })
  );
  const urlByUid = new Map(urlEntries);

  return targets.map((target) => ({
    ...target,
    datasourceUrl: target.datasourceUrl || urlByUid.get(target.datasourceUid) || '',
  }));
};

const flattenPanels = (items: unknown[]): Array<Record<string, unknown>> => {
  const flattened: Array<Record<string, unknown>> = [];

  items.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const panel = item as Record<string, unknown>;
    if (panel.id !== undefined) {
      flattened.push(panel);
    }

    if (Array.isArray(panel.panels)) {
      flattened.push(...flattenPanels(panel.panels));
    }
  });

  return flattened;
};

const buildLiveSyncContext = (panelId: number, panelTitle: string, liveTargets: FeedQueryTarget[], rangeSeconds: number, stepSeconds: number): PanelSyncContext => {
  const dashboardUid = getDashboardUidFromLocation() || 'local_dashboard';
  return {
    source: 'live',
    dashboardUid,
    folderTitle: inferDashboardFolderTitle(),
    dashboardTitle: inferDashboardTitle() || 'Grafana dashboard',
    panelTitle,
    targets: liveTargets,
    panelOptions: {},
    rangeSeconds,
    stepSeconds,
  };
};

const loadSavedSyncContext = async (panelId: number, fallbackTitle: string): Promise<PanelSyncContext | null> => {
  const dashboardUid = getDashboardUidFromLocation();
  if (!dashboardUid || typeof fetch === 'undefined') {
    return null;
  }

  const response = await fetch(`/api/dashboards/uid/${encodeURIComponent(dashboardUid)}`, {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Could not read the saved dashboard definition (${response.status}).`);
  }

  const payload = (await response.json()) as {
    dashboard?: { title?: unknown; panels?: unknown[] };
    meta?: { folderTitle?: unknown };
  };
  const dashboard = payload.dashboard ?? {};
  const folderTitle = String(payload.meta?.folderTitle ?? inferDashboardFolderTitle() ?? '').trim();
  const savedPanels = flattenPanels(Array.isArray(dashboard.panels) ? dashboard.panels : []);
  const panel = savedPanels.find((item) => Number(item.id ?? -1) === panelId);
  if (!panel) {
    return null;
  }

  const targets = await enrichTargetsWithDatasourceUrls(extractPrometheusTargets(Array.isArray(panel.targets) ? panel.targets : []));
  return {
    source: 'saved',
    dashboardUid,
    folderTitle,
    dashboardTitle: String(dashboard.title ?? inferDashboardTitle() ?? dashboardUid).trim() || dashboardUid,
    panelTitle: String(panel.title ?? fallbackTitle).trim() || fallbackTitle,
    targets,
    panelOptions: ((panel.options as Partial<SimpleOptions> | undefined) ?? {}),
  };
};

const buildMetricHintNames = (metricNames: string[], targets: FeedQueryTarget[]): string[] => {
  return Array.from(
    new Set(
      [...metricNames, ...targets.map((target) => target.legend).filter((value) => value.length > 0), ...targets.map((target) => target.expr)]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
};

const buildScoreFeedSyncHash = (
  context: PanelSyncContext,
  resolvedOptions: ResolvedOptions,
  ruleNamePrefix: string,
  target: ScoreFeedTarget
): string => {
  return JSON.stringify({
    dashboardUid: context.dashboardUid,
    panelTitle: context.panelTitle,
    source: context.source,
    ruleNamePrefix,
    target,
    rangeSeconds: context.rangeSeconds ?? 0,
    stepSeconds: context.stepSeconds ?? 0,
    targets: context.targets.map((target) => ({
      refId: target.refId,
      expr: target.expr,
      datasourceUid: target.datasourceUid,
      datasourceType: target.datasourceType,
      datasourceUrl: target.datasourceUrl ?? '',
    })),
    resolvedOptions: {
      setupMode: resolvedOptions.setupMode,
      metricPreset: resolvedOptions.metricPreset,
      effectiveMetricPreset: resolvedOptions.effectiveMetricPreset,
      detectionMode: resolvedOptions.detectionMode,
      algorithm: resolvedOptions.algorithm,
      sensitivity: resolvedOptions.sensitivity,
      baselineWindow: resolvedOptions.baselineWindow,
      seasonalitySamples: resolvedOptions.seasonalitySamples,
      seasonalRefinement: resolvedOptions.seasonalRefinement,
      severityPreset: resolvedOptions.severityPreset,
    },
  });
};

const bucketSpanToSeconds = (bucketSpan: BucketSpan): number => {
  switch (bucketSpan) {
    case '1m':
      return 60;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '1h':
      return 3600;
    case 'raw':
    case 'auto':
    default:
      return 0;
  }
};

const buildPanelScoreFeedRegistrationPayload = (
  context: PanelSyncContext,
  panelId: number,
  ruleNamePrefix: string,
  target: ScoreFeedTarget,
  resolvedOptions: ResolvedOptions,
  syncHash: string
): PanelScoreFeedRegistrationPayload | null => {
  const validTargets = context.targets.filter((item) => item.expr.trim().length > 0);
  if (validTargets.length === 0) {
    return null;
  }

  const bucketSpanSeconds = bucketSpanToSeconds(resolvedOptions.bucketSpan);
  const contextStepSeconds = Math.max(0, Math.round(context.stepSeconds ?? 0));
  const stepSeconds = contextStepSeconds > 0 ? contextStepSeconds : bucketSpanSeconds > 0 ? Math.max(5, Math.min(bucketSpanSeconds, 60)) : 30;
  const historyPoints = Math.max(256, resolvedOptions.baselineWindow * Math.max(resolvedOptions.seasonalitySamples, 1) + 8, resolvedOptions.baselineWindow * 6);
  const panelRangeSeconds = Math.max(0, Math.round(context.rangeSeconds ?? 0));
  const fallbackRangeSeconds = Math.max(3600, historyPoints * stepSeconds);

  return {
    dashboardUid: context.dashboardUid,
    folderTitle: context.folderTitle,
    dashboardTitle: context.dashboardTitle,
    panelId,
    panelTitle: context.panelTitle,
    ruleNamePrefix: buildComputedRuleName(context.panelTitle, ruleNamePrefix),
    target,
    source: context.source,
    syncHash,
    targets: validTargets.map((item) => ({
      refId: item.refId,
      expr: item.expr,
      legend: item.legend,
      datasourceUid: item.datasourceUid,
      datasourceType: item.datasourceType,
      datasourceUrl: item.datasourceUrl ?? '',
    })),
    resolvedOptions: {
      setupMode: resolvedOptions.setupMode,
      metricPreset: resolvedOptions.metricPreset,
      effectiveMetricPreset: resolvedOptions.effectiveMetricPreset,
      detectionMode: resolvedOptions.detectionMode,
      algorithm: resolvedOptions.algorithm,
      sensitivity: resolvedOptions.sensitivity,
      baselineWindow: resolvedOptions.baselineWindow,
      seasonalitySamples: resolvedOptions.seasonalitySamples,
      seasonalRefinement: resolvedOptions.seasonalRefinement,
      severityPreset: resolvedOptions.severityPreset,
      rangeSeconds: panelRangeSeconds > 0 ? Math.max(stepSeconds * 4, panelRangeSeconds) : fallbackRangeSeconds,
      stepSeconds,
      bucketSpanSeconds,
    },
  };
};

const buildComputedScoreFeedPayload = (
  context: PanelSyncContext,
  panelId: number,
  ruleNamePrefix: string,
  target: ScoreFeedTarget,
  resolvedOptions: ResolvedOptions,
  analyses: SeriesAnalysis[]
): ComputedScoreFeedPayload | null => {
  const series = analyses.flatMap<ComputedScoreFeedSeriesPayload>((analysis) => {
    const point = [...analysis.allPoints].reverse().find((candidate) => candidate.expected !== null) ?? analysis.allPoints[analysis.allPoints.length - 1];
    if (!point) {
      return [];
    }

    return [
      {
        key: analysis.key,
        label: analysis.label,
        timestamp: point.time / 1000,
        value: point.value,
        expected: point.expected,
        lower: point.lower,
        upper: point.upper,
        deviation: point.expected === null ? null : point.value - point.expected,
        rawScore: point.score,
        pointRawScore: point.pointScore,
        windowRawScore: point.windowScore,
        scoreDriver: point.scoreDriver,
        normalizedScore: point.severityScore,
        severityLabel: point.severityLabel,
        isAnomaly: point.isAnomaly,
        confidenceScore: point.confidenceScore,
        confidenceLabel: point.confidenceLabel,
        dataQualityLabel: point.dataQualityLabel,
        threshold: resolvedOptions.sensitivity,
      },
    ];
  });

  if (series.length === 0) {
    return null;
  }

  const ordered = [...series].sort((left, right) => right.normalizedScore - left.normalizedScore);
  const top = ordered[0];
  const sourceDatasources = Array.from(
    new Map(
      context.targets.map((item) => [
        `${item.datasourceUid || 'unknown'}:${item.datasourceType || 'unknown'}`,
        { uid: item.datasourceUid || 'unknown', type: item.datasourceType || 'unknown' },
      ])
    ).values()
  );

  return {
    dashboardUid: context.dashboardUid,
    folderTitle: context.folderTitle,
    dashboardTitle: context.dashboardTitle,
    panelId,
    panelTitle: context.panelTitle,
    ruleName: buildComputedRuleName(context.panelTitle, ruleNamePrefix),
    target,
    source: context.source,
    sourceDatasources,
    series,
    rule: {
      timestamp: Math.max(...series.map((item) => item.timestamp)),
      score: top.normalizedScore,
      rawScore: top.rawScore,
      breachCount: series.filter((item) => item.isAnomaly).length,
      seriesCount: series.length,
      activeSeries: series.length,
      severityLabel: top.severityLabel,
    },
    resolvedOptions: {
      algorithm: resolvedOptions.algorithm,
      severityPreset: resolvedOptions.severityPreset,
      sensitivity: resolvedOptions.sensitivity,
    },
  };
};

const buildInitialScoreFeedState = (mode: ScoreFeedMode): ScoreFeedState => {
  if (mode === 'off') {
    return {
      kind: 'off',
      message: 'Anomaly score feed is turned off for this panel.',
      source: null,
      registered: [],
      removed: [],
      lastSyncedAt: null,
      syncHash: '',
    };
  }

  if (mode === 'manual') {
    return {
      kind: 'idle',
      message: 'Manual sync is ready. Use the button to publish plugin-computed anomaly scores for this panel.',
      source: null,
      registered: [],
      removed: [],
      lastSyncedAt: null,
      syncHash: '',
    };
  }

  return {
    kind: 'idle',
    message: 'Auto sync watches this panel and republishes plugin-computed anomaly scores shortly after data is returned.',
    source: null,
    registered: [],
    removed: [],
    lastSyncedAt: null,
    syncHash: '',
  };
};

const buildUnsupportedScoreFeedState = (message: string): ScoreFeedState => ({
  kind: 'unsupported',
  message,
  source: null,
  registered: [],
  removed: [],
  lastSyncedAt: null,
  syncHash: '',
});

const mergeScoreFeedRules = (base: ScoreFeedRule[], overrides: ScoreFeedRule[]): ScoreFeedRule[] => {
  const merged = new Map<string, ScoreFeedRule>();
  base.forEach((rule) => merged.set(`${rule.rule}:${rule.target ?? ''}`, rule));
  overrides.forEach((rule) => merged.set(`${rule.rule}:${rule.target ?? ''}`, rule));
  return Array.from(merged.values());
};

const getScoreFeedStatusLabel = (kind: ScoreFeedStatusKind): string => {
  switch (kind) {
    case 'synced':
      return 'Synced';
    case 'syncing':
      return 'Syncing';
    case 'error':
      return 'Error';
    case 'unsupported':
      return 'Action needed';
    case 'off':
      return 'Off';
    case 'idle':
    default:
      return 'Ready';
  }
};

const getScoreFeedStatusColor = (kind: ScoreFeedStatusKind, isDark: boolean): string => {
  switch (kind) {
    case 'synced':
      return isDark ? '#34D399' : '#047857';
    case 'syncing':
      return isDark ? '#FBBF24' : '#B45309';
    case 'error':
      return isDark ? '#F87171' : '#B91C1C';
    case 'unsupported':
      return isDark ? '#F59E0B' : '#B45309';
    case 'off':
      return isDark ? '#94A3B8' : '#64748B';
    case 'idle':
    default:
      return isDark ? '#60A5FA' : '#1D4ED8';
  }
};

const formatSyncMoment = (timestamp: number | null): string => {
  if (!timestamp) {
    return 'Not synced yet';
  }

  return new Date(timestamp).toLocaleString();
};

const isPanelDataLoading = (state: unknown): boolean => {
  const value = String(state ?? '').toLowerCase();
  return value.includes('loading') || value.includes('streaming') || value.includes('notstarted');
};

const useScoreFeedSync = ({
  panelId,
  panelTitle,
  options,
  resolvedOptions,
  liveTargets,
  analyses,
  timeRangeSeconds,
  queryStepSeconds,
}: ScoreFeedHookInput): ScoreFeedController => {
  const [state, setState] = useState<ScoreFeedState>(() => buildInitialScoreFeedState(options.scoreFeedMode ?? 'auto'));
  const [lastSyncedHash, setLastSyncedHash] = useState('');
  const scoreFeedMode = options.scoreFeedMode ?? 'auto';

  const publish = useCallback(
    async (trigger: 'manual' | 'auto' = 'manual'): Promise<void> => {
      if (scoreFeedMode === 'off') {
        setState(buildInitialScoreFeedState('off'));
        return;
      }

      try {
        let context = buildLiveSyncContext(panelId, panelTitle, liveTargets, timeRangeSeconds, queryStepSeconds);
        let effectivePanelOptions = options;
        let endpoint = normalizeScoreFeedEndpoint(options.scoreFeedEndpoint);

        if (trigger === 'auto') {
          const savedContext = await loadSavedSyncContext(panelId, panelTitle).catch(() => null);
          if (savedContext) {
            effectivePanelOptions = { ...options, ...savedContext.panelOptions };
            context = {
              ...savedContext,
              targets: liveTargets.length > 0 ? liveTargets : savedContext.targets,
              source: liveTargets.length > 0 ? 'live' : savedContext.source,
              rangeSeconds: timeRangeSeconds,
              stepSeconds: queryStepSeconds,
            };
            endpoint = normalizeScoreFeedEndpoint(effectivePanelOptions.scoreFeedEndpoint);
          }
        }

        const ruleNamePrefix = (trigger === 'auto' ? effectivePanelOptions.scoreFeedRuleNamePrefix : options.scoreFeedRuleNamePrefix) ?? '';
        const target = normalizeScoreFeedTarget(trigger === 'auto' ? effectivePanelOptions.scoreFeedTarget : options.scoreFeedTarget);
        context = {
          ...context,
          targets: await enrichTargetsWithDatasourceUrls(context.targets),
          rangeSeconds: timeRangeSeconds,
          stepSeconds: queryStepSeconds,
        };
        const registrationHash = buildScoreFeedSyncHash(context, resolvedOptions, ruleNamePrefix, target);
        const registrationPayload = buildPanelScoreFeedRegistrationPayload(context, panelId, ruleNamePrefix, target, resolvedOptions, registrationHash);
        const payload = buildComputedScoreFeedPayload(context, panelId, ruleNamePrefix, target, resolvedOptions, analyses);

        if (!registrationPayload && !payload) {
          setState(buildUnsupportedScoreFeedState('This panel has no query target or computed anomaly score points to publish yet. Refresh the panel after data is returned.'));
          return;
        }

        const syncHash = JSON.stringify({
          registrationHash,
          target,
          ruleName: payload?.ruleName ?? registrationPayload?.ruleNamePrefix ?? '',
          ruleScore: payload?.rule.score ?? null,
          ruleTimestamp: payload?.rule.timestamp ?? null,
          series: payload?.series.map((item) => [item.key, item.timestamp, item.normalizedScore, item.isAnomaly]) ?? [],
          algorithm: resolvedOptions.algorithm,
          severityPreset: resolvedOptions.severityPreset,
        });

        if (trigger === 'auto' && syncHash === lastSyncedHash) {
          setState((current) => ({
            ...current,
            kind: current.kind === 'error' ? current.kind : 'synced',
            message:
              current.lastSyncedAt !== null
                ? current.message
                : `Auto sync is active. Latest plugin-computed scores are published to ${SCORE_FEED_TARGET_LABELS[target]}.`,
            source: context.source,
            syncHash,
          }));
          return;
        }

        setState((current) => ({
          ...current,
          kind: 'syncing',
          message:
            trigger === 'auto'
              ? `Registering panel score feed and publishing latest scores to ${SCORE_FEED_TARGET_LABELS[target]}.`
              : `Registering panel score feed and publishing scores to ${SCORE_FEED_TARGET_LABELS[target]}.`,
          source: context?.source ?? current.source,
        }));

        let registrationResponsePayload: {
          error?: string;
          registered?: ScoreFeedRule[];
          removed?: string[];
          target?: ScoreFeedTarget;
        } = {};

        if (registrationPayload) {
          const registrationResponse = await fetch(`${endpoint}/api/sync/panel`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(registrationPayload),
          });

          registrationResponsePayload = (await registrationResponse.json()) as {
            error?: string;
            registered?: ScoreFeedRule[];
            removed?: string[];
            target?: ScoreFeedTarget;
          };

          if (!registrationResponse.ok) {
            throw new Error(registrationResponsePayload.error || `Panel registration failed with status ${registrationResponse.status}.`);
          }
        }

        let responsePayload: {
          error?: string;
          registered?: ScoreFeedRule[];
          removed?: string[];
          target?: ScoreFeedTarget;
          acceptedSeries?: number;
        } = {};

        if (payload) {
          const response = await fetch(`${endpoint}/api/feed/scores`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          responsePayload = (await response.json()) as {
            error?: string;
            registered?: ScoreFeedRule[];
            removed?: string[];
            target?: ScoreFeedTarget;
            acceptedSeries?: number;
          };

          if (!response.ok) {
            throw new Error(responsePayload.error || `Sync failed with status ${response.status}.`);
          }
        }

        const registered = mergeScoreFeedRules(
          Array.isArray(responsePayload.registered) ? responsePayload.registered : [],
          Array.isArray(registrationResponsePayload.registered) ? registrationResponsePayload.registered : []
        );
        const removed = [
          ...(Array.isArray(registrationResponsePayload.removed) ? registrationResponsePayload.removed : []),
          ...(Array.isArray(responsePayload.removed) ? responsePayload.removed : []),
        ];
        const sourceLabel = context.source === 'saved' ? 'saved dashboard' : 'live panel';
        const acceptedSeries = Math.max(0, Math.round(responsePayload.acceptedSeries ?? payload?.series.length ?? registered.length));

        setLastSyncedHash(syncHash);
        setState({
          kind: 'synced',
          message:
            registered.length > 0
              ? payload
                ? `Published ${acceptedSeries} plugin-computed score series and registered backend recompute from the ${sourceLabel} to ${SCORE_FEED_TARGET_LABELS[target]}.`
                : `Registered backend recompute from the ${sourceLabel} to ${SCORE_FEED_TARGET_LABELS[target]}; scores will continue while the dashboard is closed.`
              : removed.length > 0
                ? `Removed ${removed.length} previous score feed registration${removed.length === 1 ? '' : 's'} because this panel no longer exposes computed score data.`
                : `Score feed is active for this panel and targets ${SCORE_FEED_TARGET_LABELS[target]}.`,
          source: context.source,
          registered,
          removed,
          lastSyncedAt: Date.now(),
          syncHash,
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          kind: 'error',
          message: error instanceof Error ? error.message : 'Score feed sync failed unexpectedly.',
        }));
      }
    },
    [analyses, liveTargets, lastSyncedHash, options, panelId, panelTitle, queryStepSeconds, resolvedOptions, scoreFeedMode, timeRangeSeconds]
  );

  useEffect(() => {
    if (scoreFeedMode === 'off') {
      setState(buildInitialScoreFeedState('off'));
      return;
    }

    if (scoreFeedMode === 'manual') {
      setState((current) => ({
        ...(current.kind === 'synced'
          ? current
          : {
              ...buildInitialScoreFeedState('manual'),
              source: current.source,
              registered: current.registered,
              removed: current.removed,
              lastSyncedAt: current.lastSyncedAt,
              syncHash: current.syncHash,
            }),
      }));
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    let disposed = false;
    let busy = false;

    const run = async () => {
      if (disposed || busy) {
        return;
      }

      busy = true;
      try {
        await publish('auto');
      } finally {
        busy = false;
      }
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, AUTO_SCORE_FEED_SYNC_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [publish, scoreFeedMode]);

  return {
    ...state,
    syncNow: () => publish('manual'),
  };
};

export const SimplePanel: React.FC<Props> = ({ id, options, data, width, height, timeRange, timeZone }) => {
  const theme = useTheme2();
  const styles = getStyles(theme.isDark);
  const incomingPreparedSeries = useMemo(() => collectPreparedSeries(data.series), [data.series]);
  const isDataLoading = isPanelDataLoading(data.state);
  const [stalePreparedSeries, setStalePreparedSeries] = useState<PreparedSeries[]>([]);
  useEffect(() => {
    if (incomingPreparedSeries.length === 0 || typeof window === 'undefined') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setStalePreparedSeries(incomingPreparedSeries);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [incomingPreparedSeries]);
  const preparedSeries = incomingPreparedSeries.length > 0 ? incomingPreparedSeries : isDataLoading ? stalePreparedSeries : incomingPreparedSeries;
  const isUsingStaleData = isDataLoading && incomingPreparedSeries.length === 0 && stalePreparedSeries.length > 0;
  const isInitialLoading = isDataLoading && preparedSeries.length === 0;
  const metricLabels = useMemo(() => preparedSeries.map((series) => series.label), [preparedSeries]);
  const resolvedOptions = useMemo(() => resolveOptions(options, metricLabels), [options, metricLabels]);
  const sectionVisibility = useMemo(() => resolveSectionVisibility(options), [options]);
  const panelFallbackTitle = options.title || 'Anomaly detector';
  const dashboardUid = getDashboardUidFromLocation();
  const [savedDashboardContext, setSavedDashboardContext] = useState<PanelSyncContext | null>(null);
  const liveTargets = useMemo(
    () => extractPrometheusTargets((((data as unknown as { request?: { targets?: unknown[] } }).request?.targets) ?? []) as unknown[]),
    [data]
  );
  useEffect(() => {
    let cancelled = false;

    if (!dashboardUid) {
      return () => {
        cancelled = true;
      };
    }

    loadSavedSyncContext(id ?? 0, panelFallbackTitle)
      .then((context) => {
        if (!cancelled) {
          setSavedDashboardContext(context);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedDashboardContext(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dashboardUid, id, panelFallbackTitle]);
  const { analyses, effectiveBucketSpanMs } = useMemo(
    () => buildAnalyses(preparedSeries, resolvedOptions),
    [preparedSeries, resolvedOptions]
  );
  const events = useMemo(
    () => (resolvedOptions.detectionMode === 'multi' ? buildMultiMetricEvents(analyses, resolvedOptions) : []),
    [analyses, resolvedOptions]
  );
  const panelTimeRangeSeconds = useMemo(() => {
    const from = timeRange?.from?.valueOf?.() ?? 0;
    const to = timeRange?.to?.valueOf?.() ?? 0;
    return from > 0 && to > from ? Math.max(60, Math.round((to - from) / 1000)) : 0;
  }, [timeRange]);
  const panelQueryStepSeconds = useMemo(() => {
    const request = (data as unknown as { request?: { intervalMs?: number } }).request;
    const intervalMs = Number(request?.intervalMs ?? 0);
    return Number.isFinite(intervalMs) && intervalMs > 0 ? Math.max(1, Math.round(intervalMs / 1000)) : 0;
  }, [data]);
  const scoreFeed = useScoreFeedSync({
    panelId: id ?? 0,
    panelTitle: panelFallbackTitle,
    options,
    resolvedOptions,
    liveTargets,
    analyses,
    timeRangeSeconds: panelTimeRangeSeconds,
    queryStepSeconds: panelQueryStepSeconds,
  });
  const summaryItems = useMemo(
    () => (sectionVisibility.anomalyFeed ? buildSummaryItems(analyses, events, resolvedOptions) : []),
    [analyses, events, resolvedOptions, sectionVisibility.anomalyFeed]
  );
  const [selection, setSelection] = useState<SelectionToken | null>(null);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [pinnedTime, setPinnedTime] = useState<number | null>(null);
  const [actionToast, setActionToast] = useState<ActionToast | null>(null);
  const [scoreFeedExpanded, setScoreFeedExpanded] = useState(false);
  const [exportsExpanded, setExportsExpanded] = useState(false);
  const chartCardRef = useRef<HTMLDivElement | null>(null);
  const [chartFrame, setChartFrame] = useState<ChartFrame>({ width: 0, height: 0 });
  const activeSelection = useMemo(
    () => (selectionExists(selection, analyses, events) ? selection : summaryItems[0]?.selection ?? null),
    [analyses, events, selection, summaryItems]
  );
  const orderedSummaryItems = useMemo(() => [...summaryItems].sort((left, right) => left.time - right.time), [summaryItems]);
  const activeSelectionToken = selectionKey(activeSelection);

  useLayoutEffect(() => {
    const element = chartCardRef.current;
    if (!element) {
      return;
    }

    let frameHandle = 0;

    const measure = () => {
      if (typeof window === 'undefined') {
        return;
      }

      window.cancelAnimationFrame(frameHandle);
      frameHandle = window.requestAnimationFrame(() => {
        const next: ChartFrame = {
          width: Math.round(element.clientWidth),
          height: Math.round(element.clientHeight),
        };

        setChartFrame((current) => (current.width === next.width && current.height === next.height ? current : next));
      });
    };

    measure();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        measure();
      });
      resizeObserver.observe(element);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameHandle);
        window.removeEventListener('resize', measure);
      }
      resizeObserver?.disconnect();
    };
  }, [width, height, sectionVisibility.inspector, sectionVisibility.mainChart]);

  useEffect(() => {
    if (!actionToast || typeof window === 'undefined') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setActionToast(null);
    }, 3200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [actionToast]);

  const selectSummaryItem = (item: SummaryItem | null): void => {
    if (!item) {
      return;
    }

    setSelection(item.selection);
    setPinnedTime(item.time);
    setHoveredTime(item.time);
  };

  const selectionDetail = useMemo(() => {
    const detail = buildSelectionDetail(activeSelection, analyses, events);
    if (detail) {
      return detail;
    }

    const activeSummary = summaryItems.find((item) => selectionKey(item.selection) === activeSelectionToken) ?? summaryItems[0] ?? null;
    return buildFallbackSelectionDetail(activeSummary);
  }, [activeSelection, activeSelectionToken, analyses, events, summaryItems]);
  const allPoints = useMemo(() => analyses.flatMap((analysis) => analysis.allPoints), [analyses]);
  const interactionTime = pinnedTime ?? hoveredTime;
  const hoverSnapshot = useMemo(() => buildHoverSnapshot(interactionTime, analyses, events), [interactionTime, analyses, events]);
  const scoreFeedStatusColor = getScoreFeedStatusColor(scoreFeed.kind, theme.isDark);
  const alertQueryLanguage = getAlertQueryLanguage(scoreFeed.registered);
  const selectedScoreFeedTarget = normalizeScoreFeedTarget(scoreFeed.registered[0]?.target ?? options.scoreFeedTarget);
  const selectedScoreFeedStatus =
    scoreFeed.kind === 'error'
      ? 'Error'
      : scoreFeed.kind === 'syncing'
      ? 'Syncing'
      : scoreFeed.kind === 'synced'
      ? 'Up'
      : 'Ready';
  const selectedScoreFeedStatusColor =
    selectedScoreFeedStatus === 'Up'
      ? '#22C55E'
      : selectedScoreFeedStatus === 'Syncing'
      ? '#60A5FA'
      : selectedScoreFeedStatus === 'Error'
      ? '#EF4444'
      : '#F59E0B';
  const selectedScoreFeedMeta =
    selectedScoreFeedStatus === 'Up'
      ? formatSyncMoment(scoreFeed.lastSyncedAt)
      : selectedScoreFeedStatus === 'Syncing'
      ? 'Publishing'
      : selectedScoreFeedStatus === 'Error'
      ? 'Check exporter'
      : 'Selected target';
  const scoreFeedHeadlineStatus = scoreFeed.kind === 'synced' ? `${getScoreFeedTargetShortLabel(selectedScoreFeedTarget)} healthy` : getScoreFeedStatusLabel(scoreFeed.kind);
  const scoreFeedCard =
    options.scoreFeedMode !== 'off' ? (
      <div className={`${styles.card} ${styles.scoreFeedCard}`}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <div className={styles.cardTitle}>Anomaly score feed</div>
            <div className={styles.subtitle}>{scoreFeed.message}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={styles.recommendationBadge} style={{ background: `${scoreFeedStatusColor}22`, color: scoreFeedStatusColor }}>
              {scoreFeedHeadlineStatus}
            </span>
            <button
              type="button"
              onClick={() => {
                void scoreFeed.syncNow();
              }}
              disabled={scoreFeed.kind === 'syncing'}
              style={{
                border: `1px solid ${theme.isDark ? '#1D4ED8' : '#93C5FD'}`,
                background: theme.isDark ? '#172554' : '#EFF6FF',
                color: theme.isDark ? '#DBEAFE' : '#1D4ED8',
                borderRadius: 999,
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 700,
                cursor: scoreFeed.kind === 'syncing' ? 'wait' : 'pointer',
                opacity: scoreFeed.kind === 'syncing' ? 0.72 : 1,
              }}
            >
              {scoreFeed.kind === 'syncing' ? 'Syncing...' : 'Sync score feed'}
            </button>
          </div>
        </div>
        <div className={styles.scoreFeedTargetGrid} aria-label="Score feed target health">
          <div className={`${styles.healthChip} ${styles.healthChipCompact}`}>
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: selectedScoreFeedStatusColor,
                boxShadow: `0 0 0 4px ${selectedScoreFeedStatusColor}1f`,
              }}
            />
            <div className={styles.healthChipText}>
              <span className={styles.healthChipLabel}>Status</span>
              <span className={styles.healthChipValue}>{getScoreFeedStatusLabel(scoreFeed.kind)}</span>
            </div>
          </div>
          <div className={`${styles.healthChip} ${styles.healthChipCompact}`}>
            <div className={styles.healthChipText}>
              <span className={styles.healthChipLabel}>Mode</span>
              <span className={styles.healthChipValue}>{SCORE_FEED_MODE_LABELS[options.scoreFeedMode ?? 'auto']}</span>
            </div>
          </div>
          <div className={`${styles.healthChip} ${styles.healthChipCompact}`}>
            <div className={styles.scoreFeedTargetTop}>
              <span className={styles.scoreFeedTargetIcon} style={{ color: getScoreFeedTargetColor(selectedScoreFeedTarget) }}>
                {getScoreFeedTargetIcon(selectedScoreFeedTarget)}
              </span>
              <div className={styles.healthChipText}>
                <span className={styles.scoreFeedTargetTitle}>{getScoreFeedTargetShortLabel(selectedScoreFeedTarget)}</span>
                <span className={styles.scoreFeedTargetMeta}>Score target</span>
              </div>
            </div>
          </div>
          <div className={`${styles.healthChip} ${styles.healthChipCompact}`}>
            <div className={styles.healthChipText}>
              <span className={styles.healthChipLabel}>Last sync</span>
              <span className={styles.healthChipValue}>{selectedScoreFeedMeta}</span>
            </div>
          </div>
          <div className={`${styles.healthChip} ${styles.healthChipCompact}`}>
            <div className={styles.healthChipText}>
              <span className={styles.healthChipLabel}>Feed series</span>
              <span className={styles.healthChipValue}>{scoreFeed.registered.length > 0 ? scoreFeed.registered.length : 'Waiting'}</span>
            </div>
          </div>
        </div>
        {scoreFeed.registered.length > 0 ? (
          <>
            <div className={styles.subtitle}>Published score feed records are ready for alerting from the selected target. Queries below match the store selected in Score feed target.</div>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.actionButtonSecondary}
                onClick={() => setScoreFeedExpanded((current) => !current)}
              >
                {scoreFeedExpanded ? 'Hide synced rules' : 'Show synced rules'}
              </button>
            </div>
            {scoreFeedExpanded ? (
              <div className={styles.feedRuleList}>
                {scoreFeed.registered.map((item) => (
                  <div key={item.rule} className={styles.feedRuleCard}>
                    <div className={styles.handoffHeader}>
                      <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                        <div className={styles.summaryTitle}>{item.rule}</div>
                        <div className={styles.subtitle}>Alert rule query</div>
                      </div>
                      <span className={styles.targetBadge} title={getAlertQueryTargetLabel(item)}>
                        <span className={styles.targetIcon}>{getScoreFeedTargetIcon(item.target ?? 'prometheus')}</span>
                        <span className={styles.targetText}>
                          <span className={styles.targetName}>{getScoreFeedTargetShortLabel(item.target ?? 'prometheus')}</span>
                          <span className={styles.targetLanguage}>{item.queryLanguage ?? alertQueryLanguage}</span>
                        </span>
                      </span>
                    </div>
                    <div className={styles.codeLine}>{item.query}</div>
                    <div className={styles.subtitle}>Per-series drilldown query</div>
                    <div className={styles.codeLine}>{item.perSeriesQuery}</div>
                    {item.queryVariants && item.queryVariants.length > 0 ? (
                      <div className={styles.feedRuleList}>
                        {item.queryVariants.map((variant) => (
                          <div key={`${item.rule}-${variant.target}-${variant.queryLanguage}`} className={styles.feedRuleCard}>
                            <div className={styles.handoffHeader}>
                              <div className={styles.subtitle}>Variant query</div>
                              <span className={styles.targetBadge} title={getAlertQueryTargetLabel(variant)}>
                                <span className={styles.targetIcon}>{getScoreFeedTargetIcon(variant.target)}</span>
                                <span className={styles.targetText}>
                                  <span className={styles.targetName}>{getScoreFeedTargetShortLabel(variant.target)}</span>
                                  <span className={styles.targetLanguage}>{variant.queryLanguage}</span>
                                </span>
                              </span>
                            </div>
                            <div className={styles.codeLine}>{variant.query}</div>
                            <div className={styles.codeLine}>{variant.perSeriesQuery}</div>
                            <div className={styles.actionRow}>
                              <button
                                type="button"
                                className={styles.actionButtonSecondary}
                                onClick={() => {
                                  void copyTextToClipboard(variant.query)
                                    .then(() => setActionToast({ tone: 'success', message: `Copied ${getAlertQueryTargetLabel(variant)} query for ${item.rule}.` }))
                                    .catch((error: unknown) =>
                                      setActionToast({
                                        tone: 'error',
                                        message: error instanceof Error ? error.message : 'Failed to copy the target query.',
                                      })
                                    );
                                }}
                              >
                                Copy variant query
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className={styles.actionRow}>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => {
                          void copyTextToClipboard(item.query)
                            .then(() => setActionToast({ tone: 'success', message: `Copied alert query for ${item.rule}.` }))
                            .catch((error: unknown) =>
                              setActionToast({
                                tone: 'error',
                                message: error instanceof Error ? error.message : 'Failed to copy the alert query.',
                              })
                            );
                        }}
                      >
                        Copy alert query
                      </button>
                      <button
                        type="button"
                        className={styles.actionButtonSecondary}
                        onClick={() => {
                          void copyTextToClipboard(item.perSeriesQuery)
                            .then(() => setActionToast({ tone: 'success', message: `Copied per-series query for ${item.rule}.` }))
                            .catch((error: unknown) =>
                              setActionToast({
                                tone: 'error',
                                message: error instanceof Error ? error.message : 'Failed to copy the per-series query.',
                              })
                            );
                        }}
                      >
                        Copy series query
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    ) : null;

  if (isInitialLoading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.skeletonShell} aria-label="Anomaly detector is loading">
          <div className={`${styles.skeletonBlock} ${styles.skeletonHeader}`} />
          <div className={`${styles.skeletonBlock} ${styles.skeletonChart}`} />
          <div className={styles.skeletonRows}>
            <div className={`${styles.skeletonBlock} ${styles.skeletonRow}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonRow}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonRow}`} />
          </div>
        </div>
      </div>
    );
  }

  if (preparedSeries.length === 0 || allPoints.length === 0) {
    return (
      <div className={styles.wrapper}>
        {sectionVisibility.scoreFeed ? scoreFeedCard : null}
        <div className={styles.emptyState}>Add a time series query with at least one numeric field to start anomaly analysis.</div>
      </div>
    );
  }

  const seriesCount = analyses.length;
  const anomalyCount = resolvedOptions.detectionMode === 'multi' ? events.filter((event) => event.isAnomaly).length : analyses.reduce((sum, analysis) => sum + analysis.anomalyCount, 0);
  const peakScoreCandidates =
    resolvedOptions.detectionMode === 'multi'
      ? events.map((event) => event.severityScore)
      : analyses.map((analysis) => analysis.maxSeverityScore);
  const peakScore = Math.max(...peakScoreCandidates, 0);
  const peakSeverity = analyses.reduce<SeverityState>((current, analysis) => pickHigherSeverity(current, { severityLabel: analysis.maxSeverityLabel, severityScore: analysis.maxSeverityScore }), {
    severityLabel: 'normal',
    severityScore: 0,
  });

  const allTimes = allPoints.map((point) => point.time);
  const uniqueTimes = [...new Set(allTimes)].sort((left, right) => left - right);
  const allValues = allPoints.flatMap((point) => [point.value, point.expected, point.lower, point.upper]).filter((value): value is number => value !== null && Number.isFinite(value));
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const dataRangeMs = Math.max(maxTime - minTime, 1);
  const dashboardRangeMs = Math.max((timeRange.to?.valueOf?.() ?? maxTime) - (timeRange.from?.valueOf?.() ?? minTime), 1);
  const timeRangeMs = Math.max(dataRangeMs, dashboardRangeMs);
  const actualValues = allPoints.map((point) => point.value).filter(Number.isFinite);
  const valueDomain = resolveValueDomain(allValues, actualValues);
  const domainMin = valueDomain.min;
  const domainMax = valueDomain.max;
  const timeZoneLabel = timeZoneAbbrevation(maxTime, { timeZone }) || (typeof timeZone === 'string' ? timeZone : 'local');
  const peakSeverityColor = SEVERITY_COLORS[peakSeverity.severityLabel];
  const showStatusHeader = sectionVisibility.initialLabels || sectionVisibility.statistics;
  const showSideUtilities = sectionVisibility.detectionProfile || sectionVisibility.exports;
  const showSecondaryDock = sectionVisibility.anomalyFeed || showSideUtilities;
  const showBottomDock = sectionVisibility.seriesSummary || (sectionVisibility.scoreFeed && Boolean(scoreFeedCard));

  const fallbackChartWidth = Math.max(width - 24, 320);
  const fallbackChartHeight = Math.max(Math.min(showSecondaryDock ? height * 0.54 : height - 72, 500), 340);
  const chartWidth = chartFrame.width > 0 ? Math.max(chartFrame.width, 260) : fallbackChartWidth;
  const chartHeight = chartFrame.height > 0 ? Math.max(chartFrame.height, 220) : fallbackChartHeight;
  const chartPadding = {
    ...PADDING,
    top: chartHeight < 280 ? 18 : 24,
    right: resolvedOptions.detectionMode === 'multi' ? 28 : 24,
    bottom: chartHeight < 280 ? 42 : 54,
    left: resolvedOptions.detectionMode === 'multi' ? (chartWidth < 720 ? 80 : 92) : chartWidth < 720 ? 72 : 84,
  };
  const innerWidth = Math.max(chartWidth - chartPadding.left - chartPadding.right, 40);
  const innerHeight = Math.max(chartHeight - chartPadding.top - chartPadding.bottom, 40);

  const getX = (time: number): number => {
    if (maxTime === minTime) {
      return chartPadding.left + innerWidth / 2;
    }

    return chartPadding.left + ((time - minTime) / (maxTime - minTime)) * innerWidth;
  };

  const getY = (value: number): number => {
    if (domainMax === domainMin) {
      return chartPadding.top + innerHeight / 2;
    }

    return chartPadding.top + innerHeight - ((value - domainMin) / (domainMax - domainMin)) * innerHeight;
  };

  const getTimeFromX = (x: number): number => {
    if (maxTime === minTime) {
      return minTime;
    }

    const ratio = Math.max(0, Math.min(1, (x - chartPadding.left) / innerWidth));
    return minTime + ratio * (maxTime - minTime);
  };

  const xTickCount = getTimeTickCount(chartWidth, resolvedOptions.detectionMode, resolvedOptions.timeAxisDensity, timeRangeMs);
  const yTickCount = Math.max(5, Math.min(6, Math.round(innerHeight / 72)));
  const xTicks = buildLinearTicks(minTime, maxTime, xTickCount);
  const topAxisTicks =
    resolvedOptions.timeAxisPlacement === 'top_and_bottom'
      ? xTicks.filter((_, index) => index === 0 || index === xTicks.length - 1 || index % Math.max(1, Math.ceil(xTicks.length / 3)) === 0)
      : [];
  const yTicks = buildLinearTicks(domainMin, domainMax, yTickCount);
  const eventMarkerGap = Math.max(64, innerWidth / 10);
  const visibleEvents =
    resolvedOptions.detectionMode === 'multi'
      ? limitMarkerCount(
          selectVisibleMarkers(events.filter((event) => event.isAnomaly), getX, eventMarkerGap, activeSelection?.kind === 'event' ? activeSelection.time : null),
          8,
          activeSelection?.kind === 'event' ? activeSelection.time : null
        )
      : [];
  const focusBand = resolvedOptions.showFocusBand ? buildFocusBandModel(selectionDetail, analyses, uniqueTimes) : null;
  const incidentRibbonSegments = buildIncidentRibbonSegments(analyses, events, resolvedOptions.detectionMode, uniqueTimes);
  const focusBandHeight = focusBand ? Math.max(54, Math.min(76, innerHeight * 0.2)) : 0;
  const focusBandY = focusBand ? chartPadding.top + innerHeight - focusBandHeight - 10 : chartPadding.top + innerHeight;
  const plotContentBottom = focusBand ? focusBandY - 8 : chartPadding.top + innerHeight;
  const isDenseSeriesView = analyses.length > LEGEND_ROW_LIMIT;
  const inlineLabelAnalyses =
    isDenseSeriesView
      ? []
      : analyses.length > INLINE_SERIES_LABEL_LIMIT
      ? [...analyses]
          .sort((left, right) => right.maxSeverityScore - left.maxSeverityScore || right.anomalyCount - left.anomalyCount || left.label.localeCompare(right.label))
          .slice(0, INLINE_SERIES_LABEL_LIMIT)
      : analyses;
  const inlineSeriesLabels = resolvedOptions.showInlineSeriesLabels && !isDenseSeriesView
    ? buildInlineSeriesLabels(inlineLabelAnalyses, getX, getY, chartPadding.top + 12, plotContentBottom - 10, chartWidth - chartPadding.right - 10)
    : [];

  const bucketSpanLabel = formatEffectiveBucketSpanLabel(resolvedOptions.bucketSpan, effectiveBucketSpanMs);
  const howItWorks = buildHowItWorksText(resolvedOptions, effectiveBucketSpanMs);
  const inspectorStory = selectionDetail ? buildSignalStory(selectionDetail, resolvedOptions.algorithm) : '';
  const annotationExport = buildAnnotationExport(summaryItems, bucketSpanLabel);
  const alertQuery = buildAlertQuery(scoreFeed.registered);
  const alertThreshold = getRecommendedAlertThreshold(resolvedOptions.severityPreset);
  const currentFolderTitle = savedDashboardContext?.folderTitle || inferDashboardFolderTitle();
  const currentPanelTitle = savedDashboardContext?.panelTitle || panelFallbackTitle;
  const currentDashboardTitle = savedDashboardContext?.dashboardTitle || inferDashboardTitle() || 'Grafana dashboard';
  const alertTarget = normalizeScoreFeedTarget(scoreFeed.registered[0]?.target ?? options.scoreFeedTarget);
  const alertRuleName = buildAlertRuleDisplayName(currentFolderTitle, currentDashboardTitle, currentPanelTitle) || currentPanelTitle;
  const alertLabels = buildAlertRuleLabels(dashboardUid, id ?? 0, alertTarget);
  const alertAnnotations = buildAlertRuleAnnotations(selectionDetail, {
    dashboardUid,
    folderTitle: currentFolderTitle,
    dashboardTitle: currentDashboardTitle,
    panelId: id ?? 0,
    panelTitle: currentPanelTitle,
    ruleName: alertRuleName,
  });
  const alertDraftContext: AlertRuleDraftContext = {
    dashboardUid,
    folderTitle: currentFolderTitle,
    dashboardTitle: currentDashboardTitle,
    panelId: id ?? 0,
    panelTitle: currentPanelTitle,
    ruleName: alertRuleName,
    queryLanguage: alertQueryLanguage,
    alertQuery,
    threshold: alertThreshold,
    target: alertTarget,
    labels: alertLabels,
    annotations: alertAnnotations,
  };
  const alertLabelPairs = formatLabelPairs(alertLabels);
  const alertExport = buildAlertExport(selectionDetail, resolvedOptions, bucketSpanLabel, scoreFeed.registered, alertDraftContext);
  const selectedAnnotationPayload = buildSelectedAnnotationPayload(selectionDetail, id ?? 0, dashboardUid, bucketSpanLabel);
  const selectedAnnotationExport = selectedAnnotationPayload ? JSON.stringify(selectedAnnotationPayload, null, 2) : '';
  const selectedIncidentIndex = selectionDetail
    ? Math.max(1, summaryItems.findIndex((item) => selectionKey(item.selection) === activeSelectionToken) + 1)
    : 0;
  const selectedSeriesLabel =
    selectionDetail?.kind === 'point'
      ? selectionDetail.seriesLabel
      : selectionDetail?.kind === 'event'
        ? selectionDetail.contributors.slice(0, 2).join(', ') || `${selectionDetail.activeSeries} active series`
        : analyses[0]?.label ?? 'n/a';
  const selectedValueLabel =
    selectionDetail?.kind === 'point'
      ? formatValue(selectionDetail.actual)
      : selectionDetail?.kind === 'event'
        ? `${selectionDetail.activeSeries} active`
        : 'n/a';
  const selectedExpectedLabel =
    selectionDetail?.kind === 'point'
      ? formatValue(selectionDetail.expected)
      : selectionDetail?.kind === 'event'
        ? `${selectionDetail.breakdown.length} contributors`
        : 'n/a';
  const selectedDeviationLabel =
    selectionDetail?.kind === 'point'
      ? selectionDetail.deviationPercent !== null
        ? formatPercent(selectionDetail.deviationPercent)
        : formatValue(selectionDetail.deviation)
      : selectionDetail?.kind === 'event'
        ? formatValue(selectionDetail.score)
        : 'n/a';
  const selectedRawScoreLabel = selectionDetail ? formatValue(selectionDetail.score) : 'n/a';
  const selectedAlarmScoreLabel = selectionDetail ? `${SEVERITY_LABELS[selectionDetail.severityLabel]} ${selectionDetail.severityScore}` : 'n/a';
  const selectedConfidenceLabel = selectionDetail ? CONFIDENCE_LABELS[selectionDetail.confidenceLabel] : 'n/a';
  const selectedConfidenceScore = selectionDetail ? formatScoreValue(selectionDetail.confidenceScore) : 'n/a';
  const selectedDataQualityLabel = selectionDetail
    ? selectionDetail.dataQualityLabel === 'healthy'
      ? 'Good'
      : DATA_QUALITY_LABELS[selectionDetail.dataQualityLabel].replace(' data', '')
    : 'n/a';
  const selectedDataQualityScore = selectionDetail ? formatScoreValue(selectionDetail.confidenceScore) : 'n/a';
  const headerDatasourceLabel = liveTargets[0]?.datasourceType
    ? liveTargets[0].datasourceType.charAt(0).toUpperCase() + liveTargets[0].datasourceType.slice(1)
    : SCORE_FEED_TARGET_LABELS[normalizeScoreFeedTarget(options.scoreFeedTarget)];
  const severityLegendEntries: SeverityLabel[] = ['critical', 'high', 'medium', 'low'];
  const legendAnalyses =
    analyses.length > LEGEND_ROW_LIMIT
      ? [...analyses]
          .sort((left, right) => right.anomalyCount - left.anomalyCount || right.maxSeverityScore - left.maxSeverityScore || left.label.localeCompare(right.label))
          .slice(0, LEGEND_ROW_LIMIT)
      : analyses;
  const hiddenLegendCount = Math.max(0, analyses.length - legendAnalyses.length);
  const selectedRect = selectionDetail
    ? {
        x: getX(selectionDetail.bucketStart),
        height: Math.max(24, plotContentBottom - chartPadding.top),
        width:
          selectionDetail.bucketEnd > selectionDetail.bucketStart
            ? Math.max(getX(selectionDetail.bucketEnd) - getX(selectionDetail.bucketStart), 10)
            : 12,
      }
    : null;
  const visibleEventBands = visibleEvents.map((event) => {
    const rawStart = getX(event.bucketStart);
    const rawEnd = event.bucketEnd > event.bucketStart ? getX(event.bucketEnd) : rawStart;
    const rawWidth = rawEnd - rawStart;
    const fallbackWidth = Math.max(10, Math.min(innerWidth / 80, 20));
    const width = Math.max(10, Math.min(Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : fallbackWidth, 24));
    const preferredX = rawWidth > 0 ? rawStart : getX(event.time) - width / 2;
    const x = Math.max(chartPadding.left + 2, Math.min(preferredX, chartWidth - chartPadding.right - width - 2));
    return {
      event,
      x,
      width,
      centerX: x + width / 2,
    };
  });
  const plotClipId = `anomaly-plot-${id ?? 'panel'}-${resolvedOptions.detectionMode}`;
  const axisCaptionColor = theme.isDark ? '#CBD5E1' : '#334155';
  const axisGutterFill = theme.isDark ? '#0B1628' : '#F8FAFC';
  const axisLabelFill = theme.isDark ? '#0F1C2D' : '#FFFFFF';
  const hoverX = hoverSnapshot ? getX(hoverSnapshot.time) : null;
  const tooltipLeft = hoverX === null ? 0 : Math.max(16, Math.min(hoverX + 18, chartWidth - 290));
  const tooltipAlignRight = hoverX !== null && hoverX > chartWidth * 0.62;
  const tooltipStyle = hoverX === null ? undefined : { left: tooltipAlignRight ? undefined : tooltipLeft, right: tooltipAlignRight ? Math.max(14, chartWidth - hoverX + 14) : undefined };
  const handleChartMouseMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    if (svgX < chartPadding.left || svgX > chartWidth - chartPadding.right) {
      if (pinnedTime === null) {
        setHoveredTime(null);
      }
      return;
    }

    const targetTime = getTimeFromX(svgX);
    const nearestIndex = findNearestTimeIndex(uniqueTimes, targetTime);
    setHoveredTime(nearestIndex >= 0 ? uniqueTimes[nearestIndex] : null);
  };
  const handleChartMouseLeave = (): void => {
    if (pinnedTime === null) {
      setHoveredTime(null);
    }
  };
  const handleChartClick = (): void => {
    if (hoverSnapshot) {
      setPinnedTime((current) => (current === hoverSnapshot.time ? null : hoverSnapshot.time));
    }
  };
  const handleChartKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isKeyboardNavigationTarget(event.target) || orderedSummaryItems.length === 0) {
      return;
    }

    const activeIndex = orderedSummaryItems.findIndex((item) => selectionKey(item.selection) === activeSelectionToken);
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = orderedSummaryItems[(currentIndex + 1) % orderedSummaryItems.length];
      selectSummaryItem(next);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = orderedSummaryItems[(currentIndex - 1 + orderedSummaryItems.length) % orderedSummaryItems.length];
      selectSummaryItem(next);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      const selected = orderedSummaryItems[currentIndex];
      if (!selected) {
        return;
      }

      event.preventDefault();
      setPinnedTime((current) => (current === selected.time ? null : selected.time));
      setHoveredTime(selected.time);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setPinnedTime(null);
      setHoveredTime(null);
    }
  };

  const inspectorPanel = (
    <aside className={styles.inspectorCard} aria-label="Anomaly inspector">
      <div className={styles.inspectorTop}>
        <div className={styles.inspectorTitle}>Anomaly inspector</div>
        <button type="button" className={styles.inspectorClose} aria-label="Inspector is pinned in this panel">
          x
        </button>
      </div>
      {selectionDetail ? (
        <>
          <div className={styles.inspectorTimestamp}>
            <span>{formatTooltipTime(selectionDetail.time, timeRangeMs, timeZone)}</span>
            <span aria-hidden="true">•</span>
            <span style={{ color: SEVERITY_COLORS[selectionDetail.severityLabel] }}>
              {SEVERITY_LABELS[selectionDetail.severityLabel]}
            </span>
          </div>
          <div className={styles.inspectorRows}>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Series</span>
              <span className={styles.inspectorRowValue}>{truncateLabel(selectedSeriesLabel, 34)}</span>
            </div>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Value</span>
              <span className={styles.inspectorRowValue}>{selectedValueLabel}</span>
            </div>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Expected</span>
              <span className={styles.inspectorRowValue}>{selectedExpectedLabel}</span>
            </div>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Deviation</span>
              <span className={styles.inspectorRowValue}>{selectedDeviationLabel}</span>
            </div>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Raw detection score</span>
              <span className={styles.inspectorRowValue}>{selectedRawScoreLabel}</span>
            </div>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Alert score (0-100)</span>
              <span className={styles.inspectorRowValue} style={{ color: SEVERITY_COLORS[selectionDetail.severityLabel] }}>{selectedAlarmScoreLabel}</span>
            </div>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Bucket</span>
              <span className={styles.inspectorRowValue}>{bucketSpanLabel}</span>
            </div>
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorRowLabel}>Incident</span>
              <span className={styles.inspectorRowValue}>
                {selectedIncidentIndex} of {Math.max(summaryItems.length, selectedIncidentIndex)}
              </span>
            </div>
          </div>
          <div>
            <div className={styles.inspectorSectionTitle}>Why is this anomalous?</div>
            <div className={styles.recommendationText} style={{ marginTop: 10 }}>
              {inspectorStory}
            </div>
          </div>
          <div className={styles.inspectorRows}>
            <div className={styles.inspectorHealthRow}>
              <span className={styles.inspectorRowLabel}>Confidence</span>
              <span>
                <span
                  className={styles.inspectorPill}
                  style={{ background: `${CONFIDENCE_COLORS[selectionDetail.confidenceLabel]}33`, color: CONFIDENCE_COLORS[selectionDetail.confidenceLabel] }}
                >
                  {selectedConfidenceLabel}
                </span>
                <span className={styles.inspectorRowValue} style={{ marginLeft: 10 }}>
                  {selectedConfidenceScore}%
                </span>
              </span>
            </div>
            <div className={styles.inspectorHealthRow}>
              <span className={styles.inspectorRowLabel}>Data quality</span>
              <span>
                <span className={styles.inspectorPill} style={{ background: 'rgba(34,197,94,0.24)', color: '#86EFAC' }}>
                  {selectedDataQualityLabel}
                </span>
                <span className={styles.inspectorRowValue} style={{ marginLeft: 10 }}>
                  {selectedDataQualityScore}%
                </span>
              </span>
            </div>
          </div>
          <div>
            <div className={styles.inspectorSectionTitle}>Rule labels</div>
            <div className={styles.labelChipGrid} style={{ marginTop: 10 }}>
              {Object.entries(alertLabels).map(([key, value]) => (
                <span key={key} className={styles.labelChip} title={`${key}=${value}`}>
                  <span className={styles.labelChipKey}>{key}</span>
                  <span>=</span>
                  <span className={styles.labelChipValue}>{value}</span>
                </span>
              ))}
            </div>
          </div>
          <div className={styles.inspectorActionStack}>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.inspectorActionButton} ${styles.inspectorActionButtonPrimary}`}
              disabled={!alertQuery}
              onClick={() => {
                if (!alertQuery) {
                  setActionToast({ tone: 'error', message: 'Sync anomaly score feed first to generate the alert query.' });
                  return;
                }

                const openedBuilder = openGrafanaAlertRuleBuilder(alertDraftContext);
                setActionToast({
                  tone: 'success',
                  message: openedBuilder
                    ? 'Opened Grafana alert rule builder. Copying the alert query to your clipboard.'
                    : 'Copying the alert query. If the builder did not open, use Alerting > Alert rules > New alert rule.',
                });

                void copyTextToClipboard(alertQuery)
                  .then(() =>
                    setActionToast({
                      tone: 'success',
                      message: openedBuilder
                        ? 'Opened Grafana alert rule builder and copied the alert query.'
                        : 'Copied the alert query. If the builder did not open, use Alerting > Alert rules > New alert rule.',
                    })
                  )
                  .catch((error: unknown) =>
                    setActionToast({
                      tone: 'error',
                      message: error instanceof Error ? error.message : 'Failed to copy the alert query.',
                    })
                  );
              }}
            >
              Open alert rule builder
            </button>
            <button
              type="button"
              className={`${styles.actionButtonSecondary} ${styles.inspectorActionButton} ${styles.inspectorActionButtonSecondary}`}
              disabled={!alertLabelPairs}
              onClick={() => {
                void copyTextToClipboard(alertLabelPairs)
                  .then(() => setActionToast({ tone: 'success', message: 'Copied suggested alert labels.' }))
                  .catch((error: unknown) =>
                    setActionToast({
                      tone: 'error',
                      message: error instanceof Error ? error.message : 'Failed to copy alert labels.',
                    })
                  );
              }}
            >
              Copy rule labels
            </button>
            <button
              type="button"
              className={`${styles.actionButtonSecondary} ${styles.inspectorActionButton} ${styles.inspectorActionButtonSecondary}`}
              disabled={!selectedAnnotationPayload || !dashboardUid}
              onClick={() => {
                if (!selectedAnnotationPayload) {
                  setActionToast({ tone: 'error', message: 'Select an anomaly first to create an annotation.' });
                  return;
                }

                if (!dashboardUid) {
                  setActionToast({ tone: 'error', message: 'Save the dashboard once before creating Grafana annotations from the panel.' });
                  return;
                }

                void createGrafanaAnnotation(selectedAnnotationPayload)
                  .then(() => setActionToast({ tone: 'success', message: 'Created a Grafana annotation for the selected anomaly.' }))
                  .catch((error: unknown) =>
                    setActionToast({
                      tone: 'error',
                      message: error instanceof Error ? error.message : 'Failed to create the Grafana annotation.',
                    })
                  );
              }}
            >
              Create annotation
            </button>
            <button
              type="button"
              className={`${styles.actionButtonSecondary} ${styles.inspectorActionButton} ${styles.inspectorActionButtonSecondary}`}
              disabled={!alertQuery}
              onClick={() => {
                if (!alertQuery) {
                  setActionToast({ tone: 'error', message: 'Sync anomaly score feed first to generate the alert query.' });
                  return;
                }

                void copyTextToClipboard(alertQuery)
                  .then(() => setActionToast({ tone: 'success', message: 'Copied the alert query for Grafana Alerting.' }))
                  .catch((error: unknown) =>
                    setActionToast({
                      tone: 'error',
                      message: error instanceof Error ? error.message : 'Failed to copy the alert query.',
                    })
                  );
              }}
            >
              Copy alert query
            </button>
          </div>
          <div>
            <div className={styles.inspectorSectionTitle}>Query preview</div>
            <pre className={styles.queryPreview}>{alertQuery || `Sync the score feed to generate ${alertQueryLanguage}.`}</pre>
          </div>
        </>
      ) : (
        <div className={styles.subtitle}>Select a detected incident to see why it was flagged, how strong the signal is, and whether it is ready for alerting.</div>
      )}
    </aside>
  );

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.operationalCanvas}
        style={{ gridTemplateColumns: sectionVisibility.inspector ? undefined : 'minmax(0, 1fr)' }}
      >
        <main className={styles.workspacePane}>
          {showStatusHeader ? (
            <div
              className={styles.statusHeader}
              style={{ gridTemplateColumns: sectionVisibility.initialLabels && sectionVisibility.statistics ? undefined : 'minmax(0, 1fr)' }}
            >
              {sectionVisibility.initialLabels ? (
                <>
                  <div className={styles.statusRail} style={{ background: peakSeverityColor }} />
                  <div className={styles.statusIcon} aria-hidden="true">
                    <svg className={styles.statusIconSvg} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path
                        d="M2.5 12h4.1l2.1-5.7 3.9 11.4 2.1-5.7h6.8"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.4" />
                    </svg>
                  </div>
                  <div className={styles.statusMain}>
                    <div className={styles.title} role="heading" aria-level={2}>
                      Anomaly Detector
                    </div>
                    <div className={styles.headerMetaGrid}>
                      <span>
                        Algorithm: <span className={styles.metaAccent}>{resolvedOptions.algorithm}</span>
                      </span>
                      <span>Bucket: {bucketSpanLabel}</span>
                      <span>Series: {truncateLabel(selectedSeriesLabel, 34)}</span>
                      <span>Datasource: {headerDatasourceLabel}</span>
                    </div>
                    {isUsingStaleData ? (
                      <div className={styles.staleBanner}>
                        Showing the last good snapshot while Grafana refreshes the query result.
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {sectionVisibility.statistics ? <div className={styles.statusStats}>
              <div className={`${styles.statCard} ${styles.statCardPrimary}`}>
                <div className={styles.statLabel}>Severity</div>
                <div className={styles.statValue}>{SEVERITY_LABELS[peakSeverity.severityLabel]}</div>
                <div className={styles.statCaption}>
                  {selectionDetail ? `Since ${formatTooltipTime(selectionDetail.time, timeRangeMs, timeZone)}` : `Peak ${formatScoreValue(peakScore)}`}
                </div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>Confidence</div>
                <div className={styles.statValue}>{selectedConfidenceScore}%</div>
                <div className={styles.statCaption}>{selectedConfidenceLabel}</div>
              </div>
              <div className={styles.statCard} role="status" aria-live="polite" aria-atomic="true">
                <div className={styles.statLabel}>Anomalies</div>
                <div className={styles.statValue}>{anomalyCount}</div>
                <div className={styles.statCaption}>clustered</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>Data quality</div>
                <div className={styles.statValue} style={{ color: '#4ADE80' }}>
                  {selectedDataQualityLabel}
                </div>
                <div className={styles.statCaption}>{selectedDataQualityScore}%</div>
              </div>
              </div> : null}
            </div>
          ) : null}

      {sectionVisibility.initialLabels ? <div className={styles.recommendationBanner}>
        <div className={styles.recommendationBadge}>{resolvedOptions.recommendation.badge}</div>
        <div className={styles.recommendationCopy}>
          <div className={styles.recommendationTitle}>{resolvedOptions.recommendation.title}</div>
          <div className={styles.recommendationText}>
            {resolvedOptions.recommendation.reason}
            {resolvedOptions.recommendation.matchedNames.length > 0 ? ` Matched metrics: ${resolvedOptions.recommendation.matchedNames.slice(0, 3).join(', ')}.` : ''}
          </div>
        </div>
      </div> : null}

      {actionToast ? (
        <div className={styles.actionNotice}>
          <span
            className={styles.recommendationBadge}
            style={{
              background: actionToast.tone === 'success' ? `${SEVERITY_COLORS.low}22` : `${SEVERITY_COLORS.critical}22`,
              color: actionToast.tone === 'success' ? SEVERITY_COLORS.low : SEVERITY_COLORS.critical,
            }}
          >
            {actionToast.tone === 'success' ? 'Action complete' : 'Action needed'}
          </span>
          <div className={styles.recommendationCopy}>
            <div className={styles.recommendationTitle}>{actionToast.tone === 'success' ? 'Ready to continue' : 'Could not finish action'}</div>
            <div className={styles.recommendationText}>{actionToast.message}</div>
          </div>
        </div>
      ) : null}

      {sectionVisibility.anomalyFeed ? <>
      <div className={styles.incidentHeader}>
        <div className={styles.cardTitle} role="heading" aria-level={3}>
          Detected incidents
        </div>
        <div className={styles.severityLegend} aria-label="Incident severity legend">
          {severityLegendEntries.map((severity) => (
            <span key={severity} className={styles.severityLegendItem}>
              <span className={styles.severityLegendSwatch} style={{ background: SEVERITY_COLORS[severity] }} />
              {SEVERITY_LABELS[severity]}
            </span>
          ))}
        </div>
      </div>

      {incidentRibbonSegments.length > 0 ? (
        <div className={styles.incidentRibbonPanel} aria-label="Detected incident overview">
          <svg width="100%" height="34" viewBox={`0 0 ${chartWidth} 34`} preserveAspectRatio="none" role="img" aria-label="Detected incident overview">
            <rect x={chartPadding.left} y={11} width={innerWidth} height={12} rx={6} fill={theme.isDark ? '#252C38' : '#E2E8F0'} opacity={0.88} />
            {incidentRibbonSegments.map((segment) => {
              const start = Math.max(chartPadding.left, getX(segment.start));
              const end = Math.min(chartWidth - chartPadding.right, getX(segment.end));
              const segmentWidth = Math.max(8, end - start);
              const selected = selectionKey(activeSelection) === selectionKey(segment.selection);
              const color = SEVERITY_COLORS[segment.severityLabel];
              return (
                <g
                  key={`overview-${segment.key}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelection(segment.selection);
                    setPinnedTime(segment.center);
                    setHoveredTime(segment.center);
                  }}
                >
                  <title>{`${segment.label} | ${SEVERITY_LABELS[segment.severityLabel]} ${segment.severityScore} | ${formatTooltipTime(segment.center, timeRangeMs, timeZone)}`}</title>
                  <rect
                    x={start}
                    y={11}
                    width={segmentWidth}
                    height={12}
                    rx={6}
                    fill={color}
                    fillOpacity={selected ? 1 : 0.82}
                    stroke={selected ? (theme.isDark ? '#F8FAFC' : '#0F172A') : 'none'}
                    strokeWidth={selected ? 1.2 : 0}
                  />
                  {segment.count > 1 && segmentWidth >= 28 ? (
                    <g>
                      <rect x={start + segmentWidth / 2 - 13} y={2} width={26} height={18} rx={8} fill={color} stroke={theme.isDark ? '#7F1D1D' : '#FFFFFF'} strokeWidth={1} />
                      <text x={start + segmentWidth / 2} y={15} textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="900" pointerEvents="none">
                        x{segment.count}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className={styles.incidentRibbonPanel} aria-label="Detected incident overview">
          <div className={styles.incidentRibbonEmpty}>No clustered incidents in this time range.</div>
        </div>
      )}
      </> : null}

      {sectionVisibility.mainChart ? <div
        className={styles.chartCard}
        ref={chartCardRef}
        tabIndex={0}
        onKeyDown={handleChartKeyDown}
        aria-label="Anomaly chart. Use left and right arrows to move between incidents, Enter to pin, and Escape to clear."
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Anomaly chart"
          onMouseMove={handleChartMouseMove}
          onMouseLeave={handleChartMouseLeave}
          onClick={handleChartClick}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
        >
          <defs>
            <clipPath id={plotClipId}>
              <rect x={chartPadding.left} y={chartPadding.top} width={innerWidth} height={innerHeight} rx={12} />
            </clipPath>
          </defs>
          <rect x={0} y={0} width={chartWidth} height={chartHeight} fill={theme.isDark ? '#08111F' : '#FFFFFF'} />
          <rect x={8} y={chartPadding.top - 8} width={chartPadding.left - 16} height={innerHeight + 16} rx={16} fill={axisGutterFill} opacity={0.96} />
          <text transform={`translate(22 ${chartPadding.top + innerHeight / 2}) rotate(-90)`} textAnchor="middle" fill={axisCaptionColor} fontSize="11" fontWeight="700" letterSpacing="0.08em">
            VALUE
          </text>
          <text x={chartWidth - chartPadding.right} y={chartHeight - 16} textAnchor="end" fill={axisCaptionColor} fontSize="11" fontWeight="700" letterSpacing="0.08em">
            TIME ({timeZoneLabel})
          </text>
          {topAxisTicks.map((tick, index) => {
            const x = getX(tick);
            const anchor = index === 0 ? 'start' : index === topAxisTicks.length - 1 ? 'end' : 'middle';
            return (
              <g key={`top-x-${index}`}>
                <text x={x} y={chartPadding.top - 10} textAnchor={anchor} fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="10" fontWeight="700">
                  {formatTimeAxisContextLabel(tick, timeRangeMs, timeZone)}
                </text>
              </g>
            );
          })}
          {selectedRect ? (
            <rect
              x={Math.max(chartPadding.left, selectedRect.x)}
              y={chartPadding.top}
              width={Math.min(selectedRect.width, innerWidth)}
              height={selectedRect.height}
              fill={theme.isDark ? 'rgba(59,130,246,0.10)' : 'rgba(37,99,235,0.08)'}
              stroke={theme.isDark ? 'rgba(96,165,250,0.35)' : 'rgba(37,99,235,0.25)'}
              rx={8}
            />
          ) : null}
          <rect x={chartPadding.left} y={chartPadding.top} width={innerWidth} height={innerHeight} rx={12} fill={theme.isDark ? '#06101E' : '#FFFFFF'} stroke={theme.isDark ? '#142033' : '#E2E8F0'} />
          {yTicks.map((tick, index) => {
            const y = getY(tick);
            return (
              <g key={`y-${index}`}>
                <line x1={chartPadding.left} y1={y} x2={chartWidth - chartPadding.right} y2={y} stroke={theme.isDark ? '#1E293B' : '#E2E8F0'} strokeOpacity={0.78} strokeDasharray="3 6" />
                <rect x={14} y={y - 10} width={chartPadding.left - 28} height={20} rx={10} fill={axisLabelFill} opacity={theme.isDark ? 0.84 : 0.96} />
                <text x={chartPadding.left - 18} y={y + 4} textAnchor="end" fill={theme.isDark ? '#E2E8F0' : '#0F172A'} fontSize="12" fontWeight="700">
                  {formatAxisValue(tick)}
                </text>
              </g>
            );
          })}
          {xTicks.map((tick, index) => {
            const x = getX(tick);
            const anchor = index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle';
            return (
              <g key={`x-${index}`}>
                {index > 0 && index < xTicks.length - 1 ? (
                  <line x1={x} y1={chartPadding.top} x2={x} y2={chartHeight - chartPadding.bottom} stroke={theme.isDark ? '#162336' : '#E2E8F0'} strokeOpacity={0.45} />
                ) : null}
                <text x={x} y={chartHeight - 12} textAnchor={anchor} fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="11">
                  {formatTimeAxisLabel(tick, timeRangeMs, resolvedOptions.timeAxisDensity, timeZone)}
                </text>
              </g>
            );
          })}
          {hoverX !== null ? (
            <g pointerEvents="none">
              <line
                x1={hoverX}
                y1={chartPadding.top}
                x2={hoverX}
                y2={plotContentBottom}
                stroke={theme.isDark ? '#93C5FD' : '#2563EB'}
                strokeDasharray="5 5"
                strokeOpacity={0.72}
                strokeWidth={1.35}
              />
              <rect
                x={Math.max(chartPadding.left + 6, Math.min(hoverX - 52, chartWidth - chartPadding.right - 104))}
                y={chartPadding.top + 24}
                width={104}
                height={20}
                rx={10}
                fill={theme.isDark ? '#0F172A' : '#FFFFFF'}
                stroke={theme.isDark ? '#334155' : '#CBD5E1'}
              />
              <text
                x={Math.max(chartPadding.left + 58, Math.min(hoverX, chartWidth - chartPadding.right - 52))}
                y={chartPadding.top + 38}
                textAnchor="middle"
                fill={theme.isDark ? '#E2E8F0' : '#0F172A'}
                fontSize="11"
                fontWeight="700"
              >
                {formatTimeAxisLabel(hoverSnapshot?.time ?? minTime, timeRangeMs, 'dense', timeZone)}
              </text>
            </g>
          ) : null}
          {resolvedOptions.detectionMode === 'multi' && visibleEventBands.length > 0 ? (
            <g>
              {visibleEventBands.map(({ event, x, width, centerX }) => {
                const selected = activeSelection?.kind === 'event' && activeSelection.time === event.time;
                const tint = SEVERITY_COLORS[event.severityLabel];
                const markerShape = getSeverityMarkerShape(event.severityLabel, resolvedOptions.markerShapeMode);
                const confidenceOpacity = event.confidenceLabel === 'high' ? 0.18 : event.confidenceLabel === 'medium' ? 0.12 : 0.08;
                const markerY = chartPadding.top + 18;
                return (
                  <g
                    key={`event-${event.time}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSelection({ kind: 'event', time: event.time });
                      setPinnedTime(event.time);
                    }}
                  >
                    <title>{`Combined anomaly at ${formatTime(event.time)} | Score ${formatValue(event.score)} | ${SEVERITY_LABELS[event.severityLabel]} | ${CONFIDENCE_LABELS[event.confidenceLabel]}`}</title>
                    <rect x={x} y={chartPadding.top + 1} width={width} height={innerHeight - 2} rx={selected ? 10 : 8} fill={tint} fillOpacity={selected ? 0.18 : confidenceOpacity} />
                    <rect x={x} y={chartPadding.top + 4} width={width} height={4} rx={2} fill={tint} fillOpacity={selected ? 0.95 : event.confidenceLabel === 'high' ? 0.8 : 0.62} />
                    <rect x={x} y={chartPadding.top + innerHeight - 6} width={width} height={3} rx={1.5} fill={tint} fillOpacity={selected ? 0.9 : event.confidenceLabel === 'high' ? 0.72 : 0.5} />
                    <line
                      x1={centerX}
                      y1={markerY + 8}
                      x2={centerX}
                      y2={plotContentBottom - 8}
                      stroke={tint}
                      strokeOpacity={selected ? 0.74 : 0.38}
                      strokeWidth={selected ? 1.8 : 1.25}
                      strokeDasharray="4 5"
                    />
                    {renderMarkerGlyph(
                      markerShape,
                      centerX,
                      markerY,
                      selected ? 7.5 : 6.2,
                      theme.isDark ? '#08111F' : '#FFFFFF',
                      tint,
                      selected ? 2.8 : 2.2
                    )}
                    {renderMarkerGlyph(markerShape, centerX, markerY, selected ? 3 : 2.5, tint)}
                  </g>
                );
              })}
            </g>
          ) : null}
          <g clipPath={`url(#${plotClipId})`}>
          {analyses.map((analysis) => {
            const areaPath = options.showBands === false ? '' : buildAreaPath(analysis.points, getX, getY);
            const actualPath = buildLinePath(analysis.points, getX, getY, (point) => point.value);
            const expectedPath = resolvedOptions.showExpectedLine ? buildLinePath(analysis.points, getX, getY, (point) => point.expected) : '';
            const selectedPointTime = activeSelection?.kind === 'point' && activeSelection.seriesKey === analysis.key ? activeSelection.time : null;
            const markerShapeMode = resolvedOptions.markerShapeMode;
            const denseMarkerGap = Math.max(54, innerWidth / 12);
            const standardMarkerGap = Math.max(12, innerWidth / 44);
            const visiblePoints =
              resolvedOptions.detectionMode === 'multi'
                ? []
                : limitMarkerCount(
                    selectVisibleMarkers(analysis.points.filter((point) => point.isAnomaly), getX, isDenseSeriesView ? denseMarkerGap : standardMarkerGap, selectedPointTime),
                    isDenseSeriesView ? 2 : 8,
                    selectedPointTime
                  );
            return (
              <g key={analysis.key}>
                {areaPath ? <path d={areaPath} fill={analysis.color} opacity={selectionDetail && selectionDetail.kind === 'point' && selectionDetail.seriesKey === analysis.key ? 0.14 : 0.07} /> : null}
                {expectedPath ? <path d={expectedPath} fill="none" stroke={analysis.color} strokeOpacity={0.32} strokeWidth={1.3} strokeDasharray="6 6" /> : null}
                <path d={actualPath} fill="none" stroke={analysis.color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                {visiblePoints.map((point) => {
                  const selected = activeSelection?.kind === 'point' && activeSelection.seriesKey === analysis.key && activeSelection.time === point.time;
                  const x = getX(point.time);
                  const y = getY(point.value);
                  const markerShape = getSeverityMarkerShape(point.severityLabel, markerShapeMode);
                  const haloRadius = selected ? 11 : point.confidenceLabel === 'high' ? 8.4 : point.confidenceLabel === 'medium' ? 7.4 : 6.2;
                  return (
                    <g
                      key={`${analysis.key}-${point.time}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelection({ kind: 'point', seriesKey: analysis.key, time: point.time });
                        setPinnedTime(point.time);
                      }}
                    >
                      <title>{`${analysis.label} | ${formatTime(point.time)} | ${SEVERITY_LABELS[point.severityLabel]} | ${CONFIDENCE_LABELS[point.confidenceLabel]}`}</title>
                      <line
                        x1={x}
                        y1={chartPadding.top + 18}
                        x2={x}
                        y2={Math.max(chartPadding.top + 26, y - 10)}
                        stroke={SEVERITY_COLORS[point.severityLabel]}
                        strokeOpacity={selected ? 0.72 : 0.3}
                        strokeWidth={selected ? 1.7 : 1.2}
                        strokeDasharray="4 5"
                      />
                      <circle cx={x} cy={y} r={haloRadius} fill={CONFIDENCE_COLORS[point.confidenceLabel]} opacity={selected ? 0.28 : 0.18} />
                      {renderMarkerGlyph(
                        markerShape,
                        x,
                        y,
                        selected ? 7.2 : 5.4,
                        theme.isDark ? '#111827' : '#FFFFFF',
                        SEVERITY_COLORS[point.severityLabel],
                        selected ? 2.8 : 2.4
                      )}
                      {renderMarkerGlyph(markerShape, x, y, selected ? 3.2 : 2.6, SEVERITY_COLORS[point.severityLabel], undefined, 0, point.confidenceLabel === 'high' ? 0.96 : 0.8)}
                      <circle cx={x} cy={y} r={11} fill="transparent" />
                    </g>
                  );
                })}
              </g>
            );
          })}
          </g>
          {inlineSeriesLabels.map((label) => {
            const labelLeft = Math.max(chartPadding.left + 8, label.anchorX - label.width);
            const connectorEndX = labelLeft - 8;
            return (
              <g key={`inline-${label.key}`}>
                <line
                  x1={label.lastX}
                  y1={label.lastY}
                  x2={connectorEndX}
                  y2={label.labelY}
                  stroke={label.color}
                  strokeOpacity={0.78}
                  strokeWidth={1.4}
                />
                <rect
                  x={labelLeft}
                  y={label.labelY - 11}
                  width={label.width}
                  height={22}
                  rx={11}
                  fill={theme.isDark ? '#0F172A' : '#FFFFFF'}
                  stroke={label.color}
                  strokeOpacity={0.48}
                />
                <circle cx={labelLeft + 11} cy={label.labelY} r={3} fill={label.color} />
                <text x={labelLeft + 19} y={label.labelY + 4} fill={theme.isDark ? '#E2E8F0' : '#0F172A'} fontSize="11" fontWeight="700">
                  {label.label}
                </text>
              </g>
            );
          })}
          {focusBand ? (() => {
            const focusInset = 14;
            const focusX = chartPadding.left + focusInset;
            const focusWidth = Math.max(innerWidth - focusInset * 2, 48);
            const focusY = focusBandY;
            const focusInnerHeight = Math.max(focusBandHeight - 28, 18);
            const focusMin = focusBand.minValue;
            const focusMax = focusBand.maxValue;
            const focusSpread = Math.max(focusMax - focusMin, 1e-6);
            const focusGetX = (time: number) => focusX + ((time - focusBand.startTime) / Math.max(focusBand.endTime - focusBand.startTime, 1)) * focusWidth;
            const focusGetY = (value: number) => focusY + 18 + focusInnerHeight - ((value - focusMin) / focusSpread) * focusInnerHeight;
            const selectedBandStart = focusGetX(focusBand.bucketStart);
            const selectedBandEnd = focusGetX(Math.max(focusBand.bucketEnd, focusBand.selectedTime));
            return (
              <g>
                <rect
                  x={chartPadding.left + 6}
                  y={focusY}
                  width={innerWidth - 12}
                  height={focusBandHeight}
                  rx={14}
                  fill={theme.isDark ? 'rgba(8,17,31,0.92)' : 'rgba(255,255,255,0.94)'}
                  stroke={theme.isDark ? '#1E293B' : '#D7E3F4'}
                />
                <text x={focusX} y={focusY + 14} fill={theme.isDark ? '#CBD5E1' : '#334155'} fontSize="10" fontWeight="700" letterSpacing="0.08em">
                  FOCUSED ANOMALY WINDOW
                </text>
                <text x={chartWidth - chartPadding.right - 8} y={focusY + 14} textAnchor="end" fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="10" fontWeight="700">
                  {focusBand.title}
                </text>
                <rect
                  x={Math.min(selectedBandStart, selectedBandEnd)}
                  y={focusY + 18}
                  width={Math.max(Math.abs(selectedBandEnd - selectedBandStart), 8)}
                  height={focusInnerHeight}
                  rx={8}
                  fill={theme.isDark ? 'rgba(59,130,246,0.14)' : 'rgba(37,99,235,0.10)'}
                  stroke={theme.isDark ? 'rgba(96,165,250,0.28)' : 'rgba(37,99,235,0.22)'}
                />
                {focusBand.series.map((series) => {
                  const focusPath = buildLinePath(series.points, focusGetX, focusGetY, (point) => point.value);
                  return <path key={`focus-${series.key}`} d={focusPath} fill="none" stroke={series.color} strokeWidth={1.8} strokeOpacity={activeSelection?.kind === 'point' && activeSelection.seriesKey === series.key ? 1 : 0.78} strokeLinecap="round" strokeLinejoin="round" />;
                })}
                <line x1={focusGetX(focusBand.selectedTime)} y1={focusY + 18} x2={focusGetX(focusBand.selectedTime)} y2={focusY + 18 + focusInnerHeight} stroke={theme.isDark ? '#93C5FD' : '#2563EB'} strokeDasharray="4 4" strokeWidth={1.4} />
                <text x={focusX} y={focusY + focusBandHeight - 8} fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="10">
                  {formatTimeAxisLabel(focusBand.startTime, focusBand.endTime - focusBand.startTime, 'dense', timeZone)}
                </text>
                <text x={focusGetX(focusBand.selectedTime)} y={focusY + focusBandHeight - 8} textAnchor="middle" fill={theme.isDark ? '#E2E8F0' : '#0F172A'} fontSize="10" fontWeight="700">
                  {formatTimeAxisLabel(focusBand.selectedTime, focusBand.endTime - focusBand.startTime, 'dense', timeZone)}
                </text>
                <text x={chartWidth - chartPadding.right - 8} y={focusY + focusBandHeight - 8} textAnchor="end" fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="10">
                  {formatTimeAxisLabel(focusBand.endTime, focusBand.endTime - focusBand.startTime, 'dense', timeZone)}
                </text>
              </g>
            );
          })() : null}
          <rect x={chartPadding.left} y={chartPadding.top} width={innerWidth} height={innerHeight} rx={12} fill="none" stroke={theme.isDark ? '#22314A' : '#D7E3F4'} />
        </svg>
        {hoverSnapshot ? (
          <div
            style={{
              position: 'absolute',
              top: 18,
              ...(tooltipStyle ?? {}),
              width: 272,
              pointerEvents: pinnedTime !== null ? 'auto' : 'none',
              borderRadius: 16,
              border: `1px solid ${theme.isDark ? '#334155' : '#CBD5E1'}`,
              background: theme.isDark ? 'rgba(8,17,31,0.96)' : 'rgba(255,255,255,0.96)',
              boxShadow: theme.isDark ? '0 18px 42px rgba(2,6,23,0.42)' : '0 18px 42px rgba(15,23,42,0.12)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              backdropFilter: 'blur(8px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: theme.isDark ? '#F8FAFC' : '#0F172A' }}>
                  {formatTooltipTime(hoverSnapshot.time, timeRangeMs, timeZone)}
                </div>
                <div style={{ fontSize: 11, color: theme.isDark ? '#94A3B8' : '#64748B' }}>
                  {hoverSnapshot.event?.isAnomaly
                    ? `Cross-metric incident | ${hoverSnapshot.event.activeSeries} aligned metric${hoverSnapshot.event.activeSeries === 1 ? '' : 's'}`
                    : hoverSnapshot.anomalyCount > 0
                      ? `${hoverSnapshot.anomalyCount} flagged signal${hoverSnapshot.anomalyCount === 1 ? '' : 's'} at this time`
                      : 'Live metric snapshot'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 999,
                    padding: '4px 8px',
                    fontSize: 10,
                    fontWeight: 800,
                    background: `${SEVERITY_COLORS[hoverSnapshot.severityLabel]}22`,
                    color: SEVERITY_COLORS[hoverSnapshot.severityLabel],
                  }}
                >
                  {SEVERITY_LABELS[hoverSnapshot.severityLabel]} {hoverSnapshot.severityScore}
                </span>
                {pinnedTime !== null ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPinnedTime(null);
                    }}
                    style={{
                      border: `1px solid ${theme.isDark ? '#334155' : '#CBD5E1'}`,
                      background: theme.isDark ? '#0F172A' : '#F8FAFC',
                      color: theme.isDark ? '#E2E8F0' : '#334155',
                      borderRadius: 999,
                      padding: '4px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Unpin
                  </button>
                ) : null}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hoverSnapshot.series.slice(0, 4).map((series) => (
                <div
                  key={`tooltip-${series.key}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) auto auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '6px 8px',
                    borderRadius: 12,
                    background: theme.isDark ? 'rgba(15,23,42,0.72)' : '#F8FAFC',
                    border: `1px solid ${theme.isDark ? '#1E293B' : '#E2E8F0'}`,
                  }}
                >
                  <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: series.color, flex: '0 0 auto' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: theme.isDark ? '#E2E8F0' : '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncateLabel(series.label, 24)}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: theme.isDark ? '#F8FAFC' : '#0F172A' }}>{formatValue(series.actual)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: series.isAnomaly ? SEVERITY_COLORS[series.severityLabel] : theme.isDark ? '#94A3B8' : '#64748B' }}>
                    {series.isAnomaly ? SEVERITY_LABELS[series.severityLabel] : 'normal'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div> : null}

      {showBottomDock ? <div
        className={styles.bottomDock}
        style={{ gridTemplateColumns: sectionVisibility.seriesSummary && sectionVisibility.scoreFeed && scoreFeedCard ? undefined : 'minmax(0, 1fr)' }}
      >
        {sectionVisibility.seriesSummary ? <div className={styles.legendTable} aria-label="Series anomaly summary">
          <div className={styles.legendTableHeader}>
            <span>Series ({seriesCount})</span>
            <span>Flagged</span>
            <span>Max</span>
            <span>Last</span>
          </div>
          {legendAnalyses.map((analysis) => {
            const lastPoint = analysis.allPoints[analysis.allPoints.length - 1] ?? null;
            return (
              <div key={analysis.key} className={styles.legendTableRow} title={`${analysis.label} | ${analysis.anomalyCount} flagged buckets | max ${formatScoreValue(analysis.maxSeverityScore)}`}>
                <span className={styles.legendSeriesName}>
                  <span className={styles.legendSwatch} style={{ background: analysis.color }} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{analysis.label}</span>
                </span>
                <span className={styles.legendValue} style={{ color: analysis.anomalyCount > 0 ? SEVERITY_COLORS[analysis.maxSeverityLabel] : undefined }}>
                  {analysis.anomalyCount}
                </span>
                <span className={styles.legendValue}>{formatScoreValue(analysis.maxSeverityScore)}</span>
                <span className={styles.legendValue}>{lastPoint ? formatValue(lastPoint.value) : 'n/a'}</span>
              </div>
            );
          })}
          {hiddenLegendCount > 0 ? (
            <div className={styles.legendTableFooter}>
              <span>Showing top {legendAnalyses.length} active series</span>
              <span>+{hiddenLegendCount} more hidden to keep the panel readable</span>
            </div>
          ) : null}
        </div> : null}
        {sectionVisibility.scoreFeed ? scoreFeedCard : null}
      </div> : null}

      {showSecondaryDock ? (
        <div
          className={styles.secondaryDock}
          style={{ gridTemplateColumns: sectionVisibility.anomalyFeed && showSideUtilities ? undefined : 'minmax(0, 1fr)' }}
        >
          {sectionVisibility.anomalyFeed ? <>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Detected incidents</div>
            {orderedSummaryItems.length > 0 ? (
              <div className={styles.summaryTimeline}>
                <div className={styles.subtitle}>Incident timeline</div>
                <svg width="100%" height="56" viewBox="0 0 320 56" role="img" aria-label="Incident timeline overview">
                  <line x1={18} y1={28} x2={302} y2={28} stroke={theme.isDark ? '#22314A' : '#CBD5E1'} strokeWidth={4} strokeLinecap="round" />
                  {orderedSummaryItems.map((item, index) => {
                    const x =
                      maxTime === minTime ? 160 : 18 + ((item.time - minTime) / Math.max(maxTime - minTime, 1)) * (302 - 18);
                    const selected = selectionKey(item.selection) === activeSelectionToken;
                    const markerShape = getSeverityMarkerShape(item.severityLabel, resolvedOptions.markerShapeMode);
                    return (
                      <g
                        key={`summary-timeline-${item.key}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => selectSummaryItem(item)}
                      >
                        <title>{`${item.title} | ${formatTooltipTime(item.time, timeRangeMs, timeZone)}`}</title>
                        <line
                          x1={x}
                          y1={16}
                          x2={x}
                          y2={40}
                          stroke={SEVERITY_COLORS[item.severityLabel]}
                          strokeOpacity={selected ? 0.85 : 0.4}
                          strokeWidth={selected ? 2 : 1.3}
                        />
                        {renderMarkerGlyph(
                          markerShape,
                          x,
                          28,
                          selected ? 7 : 5.4,
                          theme.isDark ? '#08111F' : '#FFFFFF',
                          SEVERITY_COLORS[item.severityLabel],
                          selected ? 2.5 : 2
                        )}
                        {selected ? (
                          <circle cx={x} cy={28} r={10.5} fill="none" stroke={theme.isDark ? '#E2E8F0' : '#0F172A'} strokeOpacity={0.4} strokeWidth={1.3} />
                        ) : null}
                        {index === 0 ? (
                          <text x={x} y={50} textAnchor="start" fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="10" fontWeight="700">
                            {formatTimeAxisLabel(item.time, timeRangeMs, 'compact', timeZone)}
                          </text>
                        ) : index === orderedSummaryItems.length - 1 ? (
                          <text x={x} y={50} textAnchor="end" fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="10" fontWeight="700">
                            {formatTimeAxisLabel(item.time, timeRangeMs, 'compact', timeZone)}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : null}
            <div className={styles.summaryList}>
              {summaryItems.length === 0 ? (
                <div className={styles.subtitle}>No operationally relevant incidents crossed the active threshold in the selected time range.</div>
              ) : (
                summaryItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-label={`Detected incident ${item.title}`}
                    className={`${styles.summaryRow} ${activeSelectionToken === selectionKey(item.selection) ? styles.summaryRowSelected : ''}`}
                    onClick={() => selectSummaryItem(item)}
                    style={{ textAlign: 'left', color: 'inherit' }}
                  >
                    <div className={styles.summaryMeta}>
                      <span className={styles.summaryTitle} title={item.title}>{item.title}</span>
                      <span className={styles.severityBadge} style={{ background: `${SEVERITY_COLORS[item.severityLabel]}22`, color: SEVERITY_COLORS[item.severityLabel] }}>
                        {SEVERITY_LABELS[item.severityLabel]} {item.severityScore}
                      </span>
                    </div>
                    <div className={styles.subtitle}>{item.subtitle}</div>
                    <div className={styles.recommendationText}>{item.detail}</div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className={`${styles.card} ${styles.inlineInspectorLegacy}`}>
            <div className={styles.cardTitle}>Legacy inspector details</div>
            {selectionDetail ? (
              <>
                <div className={styles.recommendationText}>{selectionDetail.title}</div>
                <div className={styles.subtitle}>{selectionDetail.subtitle}</div>
                <div className={styles.recommendationText}>{inspectorStory}</div>
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    disabled={!selectedAnnotationPayload || !dashboardUid}
                    onClick={() => {
                      if (!selectedAnnotationPayload) {
                        setActionToast({ tone: 'error', message: 'Select an anomaly first to create an annotation.' });
                        return;
                      }

                      if (!dashboardUid) {
                        setActionToast({ tone: 'error', message: 'Save the dashboard once before creating Grafana annotations from the panel.' });
                        return;
                      }

                      void createGrafanaAnnotation(selectedAnnotationPayload)
                        .then(() => setActionToast({ tone: 'success', message: 'Created a Grafana annotation for the selected anomaly.' }))
                        .catch((error: unknown) =>
                          setActionToast({
                            tone: 'error',
                            message: error instanceof Error ? error.message : 'Failed to create the Grafana annotation.',
                          })
                        );
                    }}
                  >
                    Create annotation
                  </button>
                  <button
                    type="button"
                    className={styles.actionButtonSecondary}
                    disabled={!alertQuery}
                    onClick={() => {
                      if (!alertQuery) {
                        setActionToast({ tone: 'error', message: 'Sync anomaly score feed first to generate the alert query.' });
                        return;
                      }

                      void copyTextToClipboard(alertQuery)
                        .then(() => setActionToast({ tone: 'success', message: 'Copied the alert query for Grafana Alerting.' }))
                        .catch((error: unknown) =>
                          setActionToast({
                            tone: 'error',
                            message: error instanceof Error ? error.message : 'Failed to copy the alert query.',
                          })
                        );
                    }}
                  >
                    Copy alert query
                  </button>
                  <button
                    type="button"
                    className={styles.actionButtonSecondary}
                    onClick={() => {
                      if (!selectedAnnotationExport) {
                        setActionToast({ tone: 'error', message: 'Select an anomaly first to copy its annotation JSON.' });
                        return;
                      }

                      void copyTextToClipboard(selectedAnnotationExport)
                        .then(() => setActionToast({ tone: 'success', message: 'Copied the selected anomaly annotation JSON.' }))
                        .catch((error: unknown) =>
                          setActionToast({
                            tone: 'error',
                            message: error instanceof Error ? error.message : 'Failed to copy the annotation JSON.',
                          })
                        );
                    }}
                  >
                    Copy annotation JSON
                  </button>
                </div>
                {!dashboardUid ? <div className={styles.subtitle}>Save the dashboard once so Grafana knows which dashboard the new annotation belongs to.</div> : null}
                <div className={styles.detailGrid}>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Raw detection score</div>
                    <div className={styles.detailValue}>{formatValue(selectionDetail.score)}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Alert score (0-100)</div>
                    <div className={styles.detailValue} style={{ color: SEVERITY_COLORS[selectionDetail.severityLabel] }}>{SEVERITY_LABELS[selectionDetail.severityLabel]} {selectionDetail.severityScore}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Confidence</div>
                    <div className={styles.detailValue} style={{ color: CONFIDENCE_COLORS[selectionDetail.confidenceLabel] }}>{CONFIDENCE_LABELS[selectionDetail.confidenceLabel]}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Data quality</div>
                    <div className={styles.detailValue}>{DATA_QUALITY_LABELS[selectionDetail.dataQualityLabel]}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Bucket span</div>
                    <div className={styles.detailValue}>{formatBucketWindow(selectionDetail.bucketStart, selectionDetail.bucketEnd)}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Recommended action</div>
                    <div className={styles.detailValue}>{buildAlertGuidance(selectionDetail, resolvedOptions.severityPreset)}</div>
                  </div>
                </div>
                {selectionDetail.kind === 'point' ? (
                  <div className={styles.detailGrid}>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Current value</div><div className={styles.detailValue}>{formatValue(selectionDetail.actual)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Expected value</div><div className={styles.detailValue}>{formatValue(selectionDetail.expected)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Change</div><div className={styles.detailValue}>{formatValue(selectionDetail.deviation)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Change %</div><div className={styles.detailValue}>{formatPercent(selectionDetail.deviationPercent)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Expected range</div><div className={styles.detailValue}>{formatRange(selectionDetail.rangeLower, selectionDetail.rangeUpper)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Samples in bucket</div><div className={styles.detailValue}>{selectionDetail.sampleCount}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Instant signal</div><div className={styles.detailValue}>{formatValue(selectionDetail.pointScore)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Sustained signal</div><div className={styles.detailValue}>{formatValue(selectionDetail.windowScore)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Main reason</div><div className={styles.detailValue}>{getDriverLabel(selectionDetail.scoreDriver, resolvedOptions.algorithm)}</div></div>
                  </div>
                ) : (
                  <div className={styles.metricBreakdownList}>
                    <div className={styles.subtitle}>Metric breakdown</div>
                    {selectionDetail.breakdown.map((row) => (
                      <div
                        key={row.label}
                        className={styles.metricBreakdownCard}
                        style={{
                          borderColor: theme.isDark ? `${row.color}55` : `${row.color}66`,
                        }}
                      >
                        <div className={styles.metricBreakdownHeader}>
                          <div>
                            <div className={styles.metricBreakdownTitle} style={{ color: row.color }}>
                              {row.label}
                            </div>
                            <div className={styles.metricBreakdownReason}>
                              {getDriverLabel(row.scoreDriver, resolvedOptions.algorithm)} | {CONFIDENCE_LABELS[row.confidenceLabel]}
                            </div>
                          </div>
                          <span
                            className={styles.severityBadge}
                            style={{
                              background: `${SEVERITY_COLORS[row.severityLabel]}22`,
                              color: SEVERITY_COLORS[row.severityLabel],
                            }}
                          >
                            {SEVERITY_LABELS[row.severityLabel]} {row.severityScore}
                          </span>
                        </div>
                        <div className={styles.metricBreakdownGrid}>
                          <div className={styles.metricBreakdownStat}>
                            <div className={styles.metricBreakdownStatLabel}>Current</div>
                            <div className={styles.metricBreakdownStatValue}>{formatValue(row.actual)}</div>
                          </div>
                          <div className={styles.metricBreakdownStat}>
                            <div className={styles.metricBreakdownStatLabel}>Expected</div>
                            <div className={styles.metricBreakdownStatValue}>{formatValue(row.expected)}</div>
                          </div>
                          <div className={styles.metricBreakdownStat}>
                            <div className={styles.metricBreakdownStatLabel}>Change</div>
                            <div className={styles.metricBreakdownStatValue}>{formatValue(row.deviation)}</div>
                          </div>
                          <div className={styles.metricBreakdownStat}>
                            <div className={styles.metricBreakdownStatLabel}>Main reason</div>
                            <div className={styles.metricBreakdownStatValue}>{getDriverLabel(row.scoreDriver, resolvedOptions.algorithm)}</div>
                          </div>
                          <div className={styles.metricBreakdownStat}>
                            <div className={styles.metricBreakdownStatLabel}>Confidence</div>
                            <div className={styles.metricBreakdownStatValue} style={{ color: CONFIDENCE_COLORS[row.confidenceLabel] }}>
                              {CONFIDENCE_LABELS[row.confidenceLabel]}
                            </div>
                          </div>
                          <div className={styles.metricBreakdownStat}>
                            <div className={styles.metricBreakdownStatLabel}>Strength</div>
                            <div className={styles.metricBreakdownStatValue} style={{ color: SEVERITY_COLORS[row.severityLabel] }}>
                              {formatValue(row.score)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className={styles.subtitle}>Select a detected incident to see why it was flagged, how strong the signal is, and whether it is ready for alerting.</div>
            )}
          </div>
          </> : null}

          {showSideUtilities ? <div className={styles.sideUtilityStack}>
            {sectionVisibility.detectionProfile ? <div className={`${styles.card} ${styles.profileCard}`}>
              <div className={styles.cardTitle}>Active detection profile</div>
              <div className={`${styles.recommendationText} ${styles.profileSummary}`}>{howItWorks}</div>
              <div className={styles.profileDetailGrid}>
                <div className={styles.detailStat}><div className={styles.detailLabel}>Setup mode</div><div className={styles.detailValue}>{SETUP_MODE_LABELS[resolvedOptions.setupMode]}</div></div>
                <div className={styles.detailStat}><div className={styles.detailLabel}>Metric preset</div><div className={styles.detailValue}>{METRIC_PRESET_LABELS[resolvedOptions.metricPreset]}</div></div>
                <div className={styles.detailStat}><div className={styles.detailLabel}>Effective preset</div><div className={styles.detailValue}>{resolvedOptions.effectiveMetricPreset === 'custom' ? 'Custom' : METRIC_PRESET_LABELS[resolvedOptions.effectiveMetricPreset]}</div></div>
                <div className={styles.detailStat}><div className={styles.detailLabel}>Severity preset</div><div className={styles.detailValue}>{SEVERITY_PRESET_LABELS[resolvedOptions.severityPreset]}</div></div>
              </div>
            </div> : null}

            {sectionVisibility.exports ? (
              <div className={`${styles.card} ${styles.handoffCard}`}>
                <div className={styles.handoffHeader}>
                  <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                    <div className={styles.cardTitle}>Alerting & automation</div>
                    <div className={styles.subtitle}>Optional handoff only. Daily alert setup should use the inspector buttons; expand this when you need raw JSON.</div>
                  </div>
                  <button
                    type="button"
                    className={styles.actionButtonSecondary}
                    onClick={() => setExportsExpanded((current) => !current)}
                  >
                    {exportsExpanded ? 'Hide exports' : 'Show exports'}
                  </button>
                </div>
                {exportsExpanded ? (
                  <>
                    <div className={styles.feedRuleCard}>
                      <div className={styles.handoffHeader}>
                        <div className={styles.cardTitle}>Annotation export</div>
                        <button
                          type="button"
                          className={styles.actionButtonSecondary}
                          onClick={() => {
                            void copyTextToClipboard(annotationExport)
                              .then(() => setActionToast({ tone: 'success', message: 'Copied the annotation export JSON.' }))
                              .catch((error: unknown) =>
                                setActionToast({
                                  tone: 'error',
                                  message: error instanceof Error ? error.message : 'Failed to copy the annotation export JSON.',
                                })
                              );
                          }}
                        >
                          Copy JSON
                        </button>
                      </div>
                      <div className={styles.subtitle}>Use this JSON as a ready annotation or incident handoff payload.</div>
                      <pre className={styles.monoBlock}>{annotationExport}</pre>
                    </div>
                    <div className={styles.feedRuleCard}>
                      <div className={styles.handoffHeader}>
                        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                          <div className={styles.cardTitle}>Alert rule export</div>
                          <div className={styles.subtitle}>
                            {alertQuery
                              ? `Paste this ${alertQueryLanguage} into Grafana Alerting, then set WHEN QUERY IS ABOVE ${alertThreshold} FOR 10m and evaluate every 3m.`
                              : 'Sync anomaly score feed first to generate an alert-ready anomaly score query.'}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={styles.actionButtonSecondary}
                          disabled={!alertQuery}
                          onClick={() => {
                            if (!alertQuery) {
                              setActionToast({ tone: 'error', message: 'Sync anomaly score feed first to generate the alert query.' });
                              return;
                            }

                            void copyTextToClipboard(alertQuery)
                              .then(() => setActionToast({ tone: 'success', message: 'Copied the alert query for Grafana Alerting.' }))
                              .catch((error: unknown) =>
                                setActionToast({
                                  tone: 'error',
                                  message: error instanceof Error ? error.message : 'Failed to copy the alert query.',
                                })
                              );
                          }}
                        >
                          Copy query
                        </button>
                      </div>
                      <div>
                        <div className={styles.subtitle}>Suggested labels</div>
                        <div className={styles.labelChipGrid} style={{ marginTop: 8 }}>
                          {Object.entries(alertLabels).map(([key, value]) => (
                            <span key={key} className={styles.labelChip} title={`${key}=${value}`}>
                              <span className={styles.labelChipKey}>{key}</span>
                              <span>=</span>
                              <span className={styles.labelChipValue}>{value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className={styles.codeLine}>{alertQuery || 'Sync anomaly score feed first to generate an alert-ready query.'}</div>
                      <pre className={styles.monoBlock}>{alertExport}</pre>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div> : null}
        </div>
      ) : null}
        </main>
        {sectionVisibility.inspector ? <aside className={styles.inspectorRail}>{inspectorPanel}</aside> : null}
      </div>
    </div>
  );
};

export const __testables = {
  resolveSeriesDisplayName,
  collectPreparedSeries,
  resolveSectionVisibility,
  normalizeScoreFeedEndpoint,
  extractPrometheusTargets,
  buildMetricHintNames,
  buildScoreFeedSyncHash,
  buildPanelScoreFeedRegistrationPayload,
  bucketSpanToSeconds,
  buildAlertQuery,
  getAlertQueryLanguage,
  buildSelectedAnnotationPayload,
  buildGrafanaErrorMessage,
};






