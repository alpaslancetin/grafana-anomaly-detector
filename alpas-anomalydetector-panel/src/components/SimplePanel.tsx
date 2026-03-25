import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FieldType, PanelProps } from '@grafana/data';
import { css } from '@emotion/css';
import { useTheme2 } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import {
  BucketSpan,
  DetectionAlgorithm,
  DetectionMode,
  MetricPreset,
  ScoreFeedMode,
  SeasonalRefinement,
  SetupMode,
  SeverityPreset,
  SimpleOptions,
} from '../types';

interface Props extends PanelProps<SimpleOptions> {}

type VectorLike = {
  length?: number;
  get?: (index: number) => unknown;
  [key: number]: unknown;
};

type SeverityLabel = 'normal' | 'low' | 'medium' | 'high' | 'critical';
type EffectiveMetricPreset = Exclude<MetricPreset, 'auto' | 'custom'>;
type AutoMatchConfidence = 'matched' | 'weak' | 'fallback';
type RecommendationSource = 'auto' | 'selected' | 'manual';

type SelectionToken =
  | { kind: 'point'; seriesKey: string; time: number }
  | { kind: 'event'; time: number };

interface SeverityState {
  severityScore: number;
  severityLabel: SeverityLabel;
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

interface SamplePoint extends RawPoint, SeverityState {
  expected: number | null;
  upper: number | null;
  lower: number | null;
  score: number;
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

interface MultiMetricEvent extends SeverityState {
  time: number;
  bucketStart: number;
  bucketEnd: number;
  score: number;
  contributors: string[];
  activeSeries: number;
  isAnomaly: boolean;
}

interface SummaryItem extends SeverityState {
  key: string;
  time: number;
  title: string;
  subtitle: string;
  detail: string;
  score: number;
  selection: SelectionToken;
}

interface DetailMetricRow extends SeverityState {
  label: string;
  color: string;
  actual: number;
  expected: number | null;
  deviation: number | null;
  rangeLower: number | null;
  rangeUpper: number | null;
  score: number;
}

interface PointSelectionDetail extends SeverityState {
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
}

interface EventSelectionDetail extends SeverityState {
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
  recommendation: MetricPresetRecommendation;
  maxAnomalies: number;
}

interface PreparedSeries {
  key: string;
  label: string;
  color: string;
  rawPoints: RawPoint[];
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
}

type FeedSource = 'saved' | 'live';
type ScoreFeedStatusKind = 'off' | 'idle' | 'syncing' | 'synced' | 'error' | 'unsupported';

interface PanelSyncContext {
  source: FeedSource;
  dashboardUid: string;
  dashboardTitle: string;
  panelTitle: string;
  targets: FeedQueryTarget[];
  panelOptions: Partial<SimpleOptions>;
}

interface ScoreFeedRule {
  rule: string;
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
  metricNames: string[];
  liveTargets: FeedQueryTarget[];
}

interface ScoreFeedController extends ScoreFeedState {
  syncNow: () => Promise<void>;
}

interface ActionToast {
  tone: 'success' | 'error';
  message: string;
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
const MIN_BASELINE_POINTS = 3;
const MIN_SEASONAL_SAMPLES = 2;
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

const MODE_LABELS: Record<DetectionMode, string> = {
  single: 'Single metric',
  multi: 'Multi metric',
};

const ALGORITHM_LABELS: Record<DetectionAlgorithm, string> = {
  zscore: 'Rolling z-score',
  mad: 'Rolling MAD',
  ewma: 'EWMA baseline',
  seasonal: 'Seasonal baseline',
};

const METRIC_PRESET_LABELS: Record<MetricPreset, string> = {
  auto: 'Auto',
  custom: 'Custom',
  traffic: 'Traffic / throughput',
  latency: 'Latency / duration',
  error_rate: 'Error rate',
  resource: 'Resource usage',
  business: 'Business KPI',
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
    sensitivity: 2.1,
    baselineWindow: 14,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'warning_first',
    badge: 'Stable default',
    why: 'Traffic and throughput metrics drift with load, so EWMA is usually the safest default for live dashboards.',
  },
  latency: {
    algorithm: 'mad',
    sensitivity: 2.4,
    baselineWindow: 12,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'page_first',
    badge: 'Noisy data',
    why: 'Latency metrics are often spiky and outlier-heavy, so MAD is more robust than a mean-based baseline.',
  },
  error_rate: {
    algorithm: 'mad',
    sensitivity: 2.6,
    baselineWindow: 18,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'page_first',
    badge: 'Burst errors',
    why: 'Error metrics often stay low and then jump sharply, so MAD isolates bursts without letting them poison the baseline.',
  },
  resource: {
    algorithm: 'ewma',
    sensitivity: 2.3,
    baselineWindow: 18,
    seasonalitySamples: 24,
    seasonalRefinement: 'cycle',
    severityPreset: 'balanced',
    badge: 'Drifting baseline',
    why: 'CPU, memory, and load metrics usually move gradually, so EWMA follows the baseline smoothly without overreacting.',
  },
  business: {
    algorithm: 'seasonal',
    sensitivity: 2.4,
    baselineWindow: 10,
    seasonalitySamples: 24,
    seasonalRefinement: 'weekday_hour',
    severityPreset: 'balanced',
    badge: 'Seasonal data',
    why: 'Business KPIs often repeat by hour or weekday, so seasonal matching reduces false positives on recurring patterns.',
  },
};
const AUTO_PRESET_PRIORITY: EffectiveMetricPreset[] = ['latency', 'error_rate', 'resource', 'business', 'traffic'];

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

const SEVERITY_THRESHOLDS: Record<SeverityPreset, { low: number; medium: number; high: number; critical: number }> = {
  warning_first: { low: 35, medium: 55, high: 72, critical: 88 },
  balanced: { low: 40, medium: 60, high: 75, critical: 90 },
  page_first: { low: 45, medium: 65, high: 82, critical: 95 },
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

const getStyles = (isDark: boolean) => ({
  wrapper: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
    overflow-y: auto;
    font-family: 'Segoe UI', sans-serif;
    color: ${isDark ? '#F3F4F6' : '#111827'};
    background: ${isDark ? '#0F172A' : '#FBFDFF'};
  `,
  header: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  `,
  titleBlock: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  title: css`
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.01em;
  `,
  subtitle: css`
    font-size: 12px;
    color: ${isDark ? '#94A3B8' : '#475569'};
    line-height: 1.5;
  `,
  recommendationBanner: css`
    display: flex;
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
  statCard: css`
    min-width: 112px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#111827' : '#F8FAFC'};
  `,
  statLabel: css`
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: ${isDark ? '#94A3B8' : '#64748B'};
  `,
  statValue: css`
    margin-top: 6px;
    font-size: 18px;
    font-weight: 700;
  `,
  chartCard: css`
    flex: 1 1 auto;
    min-height: 240px;
    border-radius: 16px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#08111F' : '#FFFFFF'};
    overflow: hidden;
  `,
  legend: css`
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
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
  card: css`
    border-radius: 16px;
    border: 1px solid ${isDark ? '#1E293B' : '#D7E3F4'};
    background: ${isDark ? '#0B1220' : '#FFFFFF'};
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
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

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const standardDeviation = (values: number[], center?: number): number => {
  if (values.length <= 1) {
    return 0;
  }

  const avg = center ?? mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const safeSpread = (spread: number, reference: number): number => {
  if (Number.isFinite(spread) && spread > 1e-9) {
    return spread;
  }

  return Math.max(Math.abs(reference) * 0.02, 1e-6);
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
      sensitivity: Math.max(0.2, options.sensitivity ?? 2.8),
      baselineWindow: Math.max(3, Math.round(options.baselineWindow ?? 12)),
      seasonalitySamples: Math.max(2, Math.round(options.seasonalitySamples ?? 24)),
      seasonalRefinement: options.seasonalRefinement ?? 'cycle',
      severityPreset: options.severityPreset ?? 'balanced',
      bucketSpan,
      showExpectedLine: options.showExpectedLine !== false,
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

const getSeverityState = (score: number, threshold: number, severityPreset: SeverityPreset): SeverityState => {
  const preset = SEVERITY_THRESHOLDS[severityPreset];
  const safeThreshold = Math.max(threshold, 0.0001);
  const ratio = score / safeThreshold;

  if (ratio < 1) {
    return {
      severityScore: Math.min(preset.low - 1, Math.round(ratio * (preset.low - 1))),
      severityLabel: 'normal',
    };
  }

  const severityScore = Math.min(100, Math.round(preset.low + (ratio - 1) * 30));

  if (severityScore >= preset.critical) {
    return { severityScore, severityLabel: 'critical' };
  }

  if (severityScore >= preset.high) {
    return { severityScore, severityLabel: 'high' };
  }

  if (severityScore >= preset.medium) {
    return { severityScore, severityLabel: 'medium' };
  }

  return { severityScore, severityLabel: 'low' };
};

const buildAlertGuidance = (severity: SeverityState, severityPreset: SeverityPreset): string => {
  const presetHint =
    severityPreset === 'warning_first'
      ? 'Warning-first preset surfaces operator-visible severity earlier.'
      : severityPreset === 'page_first'
        ? 'Page-first preset keeps high and critical stricter for paging workflows.'
        : 'Balanced preset aims to work for both dashboards and alert handoff.';

  if (severity.severityLabel === 'critical' || severity.severityLabel === 'high') {
    return `${presetHint} This anomaly is already in the investigate-now range.`;
  }

  if (severity.severityLabel === 'medium') {
    return `${presetHint} This anomaly looks strong enough for triage or warning workflows.`;
  }

  return `${presetHint} This anomaly is currently better suited to watchlists or dashboard review.`;
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
const buildEmptyPoint = (point: RawPoint): SamplePoint => ({
  ...point,
  expected: null,
  upper: null,
  lower: null,
  score: 0,
  isAnomaly: false,
  severityLabel: 'normal',
  severityScore: 0,
});

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
      const label = field.config.displayName || field.state?.displayName || field.name || frame.name || `Series ${prepared.length + 1}`;
      const fixedColor = field.config.color?.fixedColor;
      prepared.push({
        key: `${frame.name ?? frameIndex}-${field.name ?? fieldIndex}`,
        label,
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
    if (total <= 1) {
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

const buildZScorePoints = (points: RawPoint[], threshold: number, window: number, severityPreset: SeverityPreset): SamplePoint[] =>
  points.map((point, index) => {
    const history = points.slice(Math.max(0, index - window), index).map((entry) => entry.value);
    if (history.length < MIN_BASELINE_POINTS) {
      return buildEmptyPoint(point);
    }

    const expected = mean(history);
    const spread = safeSpread(standardDeviation(history, expected), expected);
    const score = Math.abs(point.value - expected) / spread;
    const severity = getSeverityState(score, threshold, severityPreset);

    return {
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      isAnomaly: score >= threshold,
      ...severity,
    };
  });

const buildMadPoints = (points: RawPoint[], threshold: number, window: number, severityPreset: SeverityPreset): SamplePoint[] =>
  points.map((point, index) => {
    const history = points.slice(Math.max(0, index - window), index).map((entry) => entry.value);
    if (history.length < MIN_BASELINE_POINTS) {
      return buildEmptyPoint(point);
    }

    const expected = median(history);
    const deviationHistory = history.map((value) => Math.abs(value - expected));
    const mad = median(deviationHistory) * 1.4826;
    const spread = safeSpread(mad, expected);
    const score = Math.abs(point.value - expected) / spread;
    const severity = getSeverityState(score, threshold, severityPreset);

    return {
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      isAnomaly: score >= threshold,
      ...severity,
    };
  });

const buildEwmaPoints = (points: RawPoint[], threshold: number, window: number, severityPreset: SeverityPreset): SamplePoint[] => {
  const results: SamplePoint[] = [];
  const alpha = 2 / (Math.max(window, 2) + 1);
  let smoothed: number | null = null;
  const residualHistory: number[] = [];

  points.forEach((point, index) => {
    if (index === 0 || smoothed === null) {
      smoothed = point.value;
      results.push(buildEmptyPoint(point));
      return;
    }

    const expected = smoothed;
    const spread = safeSpread(median(residualHistory.slice(-window)) || standardDeviation(points.slice(Math.max(0, index - window), index).map((entry) => entry.value)), expected);
    const score = Math.abs(point.value - expected) / spread;
    const severity = getSeverityState(score, threshold, severityPreset);
    residualHistory.push(Math.abs(point.value - expected));
    smoothed = alpha * point.value + (1 - alpha) * expected;

    results.push({
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      isAnomaly: score >= threshold,
      ...severity,
    });
  });

  return results;
};

const buildSeasonalPoints = (
  points: RawPoint[],
  threshold: number,
  window: number,
  seasonalitySamples: number,
  refinement: SeasonalRefinement,
  severityPreset: SeverityPreset
): SamplePoint[] => {
  const historyMap = new Map<string, number[]>();

  return points.map((point, index) => {
    let peers: number[] = [];
    if (refinement === 'cycle') {
      for (let cursor = index - seasonalitySamples; cursor >= 0 && peers.length < window; cursor -= seasonalitySamples) {
        peers.push(points[cursor].value);
      }
    } else {
      const date = new Date(point.time);
      const key = refinement === 'hour_of_day' ? `${date.getHours()}` : `${date.getDay()}-${date.getHours()}`;
      peers = [...(historyMap.get(key) ?? [])].slice(-window).reverse();
      const stored = historyMap.get(key) ?? [];
      stored.push(point.value);
      historyMap.set(key, stored);
    }

    if (peers.length < MIN_SEASONAL_SAMPLES) {
      return buildEmptyPoint(point);
    }

    const expected = mean(peers);
    const spread = safeSpread(standardDeviation(peers, expected), expected);
    const score = Math.abs(point.value - expected) / spread;
    const severity = getSeverityState(score, threshold, severityPreset);

    return {
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      isAnomaly: score >= threshold,
      ...severity,
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
  const window = Math.max(options.baselineWindow, 3);
  const threshold = Math.max(options.sensitivity, 0.2);

  switch (options.algorithm) {
    case 'mad':
      return buildMadPoints(points, threshold, window, options.severityPreset);
    case 'ewma':
      return buildEwmaPoints(points, threshold, window, options.severityPreset);
    case 'seasonal':
      return buildSeasonalPoints(points, threshold, window, Math.max(options.seasonalitySamples, 2), options.seasonalRefinement, options.severityPreset);
    case 'zscore':
    default:
      return buildZScorePoints(points, threshold, window, options.severityPreset);
  }
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
  const base = `${MODE_LABELS[options.detectionMode]} uses ${ALGORITHM_LABELS[options.algorithm]} with threshold ${options.sensitivity.toFixed(2)} and history window ${options.baselineWindow}.`;
  const seasonal =
    options.algorithm === 'seasonal'
      ? ` Seasonal refinement is ${SEASONAL_REFINEMENT_LABELS[options.seasonalRefinement]} with ${options.seasonalitySamples} seasonal samples.`
      : '';

  return `${base}${seasonal} Bucket span is ${bucketText}, which means the detector ${effectiveBucketSpanMs ? 'pre-aggregates dense data before scoring to stay fast on live dashboards.' : 'scores raw incoming points directly for the most detailed analysis.'}`;
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
        title: `Combined anomaly at ${formatTime(event.time)}`,
        subtitle: `${event.activeSeries} active series${event.contributors.length > 0 ? ` | ${event.contributors.join(', ')}` : ''}`,
        detail: `Score ${formatValue(event.score)} | ${SEVERITY_LABELS[event.severityLabel]} ${event.severityScore}`,
        score: event.score,
        severityLabel: event.severityLabel,
        severityScore: event.severityScore,
        selection: { kind: 'event' as const, time: event.time },
      }));
  }

  return analyses
    .flatMap((analysis) =>
      analysis.allPoints
        .filter((point) => point.isAnomaly)
        .map((point, index) => ({
          key: `${analysis.key}-${point.time}-${index}`,
          time: point.time,
          title: `${analysis.label} anomaly`,
          subtitle: formatBucketWindow(point.bucketStart, point.bucketEnd),
          detail: `Actual ${formatValue(point.value)} | expected ${formatValue(point.expected)} | score ${formatValue(point.score)}`,
          score: point.score,
          severityLabel: point.severityLabel,
          severityScore: point.severityScore,
          selection: { kind: 'point' as const, seriesKey: analysis.key, time: point.time },
        }))
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, options.maxAnomalies);
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

const buildSelectionDetail = (selection: SelectionToken | null, analyses: SeriesAnalysis[], events: MultiMetricEvent[]): SelectionDetail | null => {
  if (!selection) {
    return null;
  }

  if (selection.kind === 'point') {
    const analysis = analyses.find((item) => item.key === selection.seriesKey);
    const point = analysis?.allPoints.find((item) => item.time === selection.time);
    if (!analysis || !point) {
      return null;
    }

    const deviation = point.expected === null ? null : point.value - point.expected;
    const deviationPercent = point.expected && Math.abs(point.expected) > 1e-9 ? (deviation! / point.expected) * 100 : null;

    return {
      kind: 'point',
      title: `${analysis.label} selected anomaly`,
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
      severityLabel: point.severityLabel,
      severityScore: point.severityScore,
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
        severityLabel: point.severityLabel,
        severityScore: point.severityScore,
      } as DetailMetricRow;
    })
    .filter((item): item is DetailMetricRow => item !== null)
    .sort((left, right) => right.score - left.score);

  return {
    kind: 'event',
    title: `Combined anomaly at ${formatTime(event.time)}`,
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
  };
};

const buildAnnotationExport = (items: SummaryItem[], bucketSpanLabel: string): string =>
  JSON.stringify(
    items.map((item) => ({
      time: item.time,
      text: item.title,
      tags: ['anomaly-detector', item.severityLabel, bucketSpanLabel],
      detail: item.detail,
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

const escapePrometheusRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildAlertPromQuery = (registeredRules: ScoreFeedRule[]): string => {
  if (registeredRules.length === 0) {
    return '';
  }

  if (registeredRules.length === 1) {
    return `max_over_time(grafana_anomaly_rule_score{rule="${registeredRules[0].rule}"}[5m])`;
  }

  const matcher = registeredRules.map((rule) => escapePrometheusRegex(rule.rule)).join('|');
  return `max(max_over_time(grafana_anomaly_rule_score{rule=~"${matcher}"}[5m]))`;
};

const buildAlertExport = (detail: SelectionDetail | null, options: ResolvedOptions, bucketSpanLabel: string, registeredRules: ScoreFeedRule[]): string => {
  const threshold = getRecommendedAlertThreshold(options.severityPreset);
  const alertQuery = buildAlertPromQuery(registeredRules);

  return JSON.stringify(
    {
      title: detail ? detail.title : 'Anomaly detector score alert',
      score_feed_ready: registeredRules.length > 0,
      paste_into: 'Grafana Alerting query editor',
      prometheus_query: alertQuery || 'Sync Prometheus score feed first to generate an alert-ready score query.',
      grafana_condition: alertQuery ? `WHEN QUERY IS ABOVE ${threshold}` : 'Sync Prometheus score feed first',
      for: '2m',
      evaluate_every: '30s',
      no_data_state: 'NoData',
      exec_err_state: 'Alerting',
      threshold,
      synced_rules: registeredRules.map((rule) => rule.rule),
      rule_scope: registeredRules.length > 1 ? 'Combined max across synced panel rules' : 'Single synced panel rule',
      mode: options.detectionMode,
      algorithm: options.algorithm,
      bucket_span: bucketSpanLabel,
      history_window: options.baselineWindow,
      severity_preset: options.severityPreset,
      selected_severity: detail ? detail.severityLabel : 'normal',
      selected_score: detail ? detail.score : 0,
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

  const tags = ['anomaly-detector', detail.severityLabel, slugifyTagValue(bucketSpanLabel), detail.kind];
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
    tags.push(slugifyTagValue(detail.seriesLabel));
    payload.text = [
      detail.title,
      `Window: ${formatBucketWindow(detail.bucketStart, detail.bucketEnd)}`,
      `Score: ${formatValue(detail.score)} | Severity: ${SEVERITY_LABELS[detail.severityLabel]} ${detail.severityScore}`,
      `Actual: ${formatValue(detail.actual)} | Expected: ${formatValue(detail.expected)}`,
      `Deviation: ${formatValue(detail.deviation)}${detail.deviationPercent === null ? '' : ` (${formatValue(detail.deviationPercent)}%)`}`,
      `Expected range: ${formatValue(detail.rangeLower)} to ${formatValue(detail.rangeUpper)}`,
    ].join('\n');
    return payload;
  }

  payload.text = [
    detail.title,
    `Window: ${formatBucketWindow(detail.bucketStart, detail.bucketEnd)}`,
    `Score: ${formatValue(detail.score)} | Severity: ${SEVERITY_LABELS[detail.severityLabel]} ${detail.severityScore}`,
    `Active series: ${detail.activeSeries}`,
    `Top contributors: ${detail.contributors.join(', ') || 'No contributors found'}`,
  ].join('\n');
  return payload;
};

const copyTextToClipboard = async (value: string): Promise<void> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
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

const normalizeScoreFeedEndpoint = (value?: string): string => {
  const trimmed = (value ?? DEFAULT_SCORE_FEED_ENDPOINT).trim();
  const normalized = trimmed.replace(/\/+$/, '');
  return normalized || DEFAULT_SCORE_FEED_ENDPOINT;
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

  return document.title.replace(/\s+-\s+Grafana$/i, '').trim();
};

const extractDatasourceInfo = (value: unknown): { uid: string; type: string } => {
  if (typeof value === 'string') {
    return { uid: value, type: '' };
  }

  if (!value || typeof value !== 'object') {
    return { uid: '', type: '' };
  }

  const record = value as Record<string, unknown>;
  return {
    uid: String(record.uid ?? record.name ?? ''),
    type: String(record.type ?? ''),
  };
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

      const expr = String(record.expr ?? record.expression ?? record.query ?? '').trim();
      if (!expr) {
        return [];
      }

      const datasource = extractDatasourceInfo(record.datasource);
      const datasourceUid = String(record.datasourceUid ?? datasource.uid ?? '').trim();
      const datasourceType = String(record.datasourceType ?? datasource.type ?? '').trim().toLowerCase();

      if (datasourceUid === '__expr__' || datasourceType === '__expr__' || datasourceType === 'expression') {
        return [];
      }

      if (datasourceType && datasourceType !== 'prometheus') {
        return [];
      }

      return [
        {
          refId: String(record.refId ?? `Q${index + 1}`).trim() || `Q${index + 1}`,
          expr,
          legend: String(record.legendFormat ?? record.legend ?? '').trim(),
          datasourceUid,
          datasourceType,
        },
      ];
    })
    .filter((target, index, items) => items.findIndex((item) => item.refId === target.refId && item.expr === target.expr) === index);
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

const buildLiveSyncContext = (panelId: number, panelTitle: string, liveTargets: FeedQueryTarget[]): PanelSyncContext | null => {
  if (liveTargets.length === 0) {
    return null;
  }

  const dashboardUid = getDashboardUidFromLocation() || 'local_dashboard';
  return {
    source: 'live',
    dashboardUid,
    dashboardTitle: inferDashboardTitle() || 'Grafana dashboard',
    panelTitle,
    targets: liveTargets,
    panelOptions: {},
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
  };
  const dashboard = payload.dashboard ?? {};
  const savedPanels = flattenPanels(Array.isArray(dashboard.panels) ? dashboard.panels : []);
  const panel = savedPanels.find((item) => Number(item.id ?? -1) === panelId);
  if (!panel) {
    return null;
  }

  const targets = extractPrometheusTargets(Array.isArray(panel.targets) ? panel.targets : []);
  return {
    source: 'saved',
    dashboardUid,
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
  ruleNamePrefix: string
): string => {
  return JSON.stringify({
    dashboardUid: context.dashboardUid,
    panelTitle: context.panelTitle,
    source: context.source,
    ruleNamePrefix,
    targets: context.targets.map((target) => ({
      refId: target.refId,
      expr: target.expr,
      datasourceUid: target.datasourceUid,
      datasourceType: target.datasourceType,
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

const buildInitialScoreFeedState = (mode: ScoreFeedMode): ScoreFeedState => {
  if (mode === 'off') {
    return {
      kind: 'off',
      message: 'Prometheus score feed is turned off for this panel.',
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
      message: 'Manual sync is ready. Use the button to publish alert-ready anomaly score rules for this panel.',
      source: null,
      registered: [],
      removed: [],
      lastSyncedAt: null,
      syncHash: '',
    };
  }

  return {
    kind: 'idle',
    message: 'Auto sync watches the saved dashboard definition and republishes Prometheus score rules shortly after you save.',
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

const useScoreFeedSync = ({
  panelId,
  panelTitle,
  options,
  resolvedOptions,
  metricNames,
  liveTargets,
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
        let context: PanelSyncContext | null = null;
        let effectivePanelOptions = options;
        let effectiveResolvedOptions = resolvedOptions;
        let endpoint = normalizeScoreFeedEndpoint(options.scoreFeedEndpoint);

        if (trigger === 'auto') {
          context = await loadSavedSyncContext(panelId, panelTitle);
          if (!context) {
            setState({
              ...buildInitialScoreFeedState('auto'),
              message: 'Save the dashboard once to let auto sync publish Prometheus score rules for this panel.',
            });
            return;
          }

          effectivePanelOptions = { ...options, ...context.panelOptions };
          if ((effectivePanelOptions.scoreFeedMode ?? 'off') !== 'auto') {
            setState({
              ...buildInitialScoreFeedState('auto'),
              message: 'The saved dashboard version is not in Auto sync mode yet. Save the dashboard to activate automatic score feed publishing.',
            });
            return;
          }

          if (context.targets.length === 0) {
            setState(buildUnsupportedScoreFeedState('The saved panel does not have a Prometheus query target yet. Save a Prometheus query first.'));
            return;
          }

          const metricHints = buildMetricHintNames(metricNames, context.targets);
          effectiveResolvedOptions = resolveOptions(effectivePanelOptions, metricHints);
          endpoint = normalizeScoreFeedEndpoint(effectivePanelOptions.scoreFeedEndpoint);
        } else {
          context = buildLiveSyncContext(panelId, panelTitle, liveTargets);
          if (!context) {
            context = await loadSavedSyncContext(panelId, panelTitle);
          }

          if (!context) {
            setState(buildUnsupportedScoreFeedState('No Prometheus query targets were found for this panel yet. Add a Prometheus query and refresh the panel first.'));
            return;
          }

          if (context.targets.length === 0) {
            setState(buildUnsupportedScoreFeedState('This panel does not currently expose a Prometheus query target to sync.'));
            return;
          }

          const metricHints = buildMetricHintNames(metricNames, context.targets);
          effectiveResolvedOptions = resolveOptions(options, metricHints);
        }

        const ruleNamePrefix = (trigger === 'auto' ? effectivePanelOptions.scoreFeedRuleNamePrefix : options.scoreFeedRuleNamePrefix) ?? '';
        const syncHash = buildScoreFeedSyncHash(context, effectiveResolvedOptions, ruleNamePrefix);

        if (trigger === 'auto' && syncHash === lastSyncedHash) {
          setState((current) => ({
            ...current,
            kind: current.kind === 'error' ? current.kind : 'synced',
            message:
              current.lastSyncedAt !== null
                ? current.message
                : 'Auto sync is active and watching the saved dashboard definition. Save the dashboard to publish future target changes.',
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
              ? 'Saving changes detected. Publishing updated Prometheus score rules from the saved dashboard definition.'
              : 'Publishing Prometheus anomaly score rules for this panel.',
          source: context?.source ?? current.source,
        }));

        const response = await fetch(`${endpoint}/api/sync/panel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dashboardUid: context.dashboardUid,
            dashboardTitle: context.dashboardTitle,
            panelId,
            panelTitle: context.panelTitle,
            ruleNamePrefix,
            syncHash,
            targets: context.targets,
            resolvedOptions: {
              setupMode: effectiveResolvedOptions.setupMode,
              metricPreset: effectiveResolvedOptions.metricPreset,
              effectiveMetricPreset: effectiveResolvedOptions.effectiveMetricPreset,
              detectionMode: effectiveResolvedOptions.detectionMode,
              algorithm: effectiveResolvedOptions.algorithm,
              sensitivity: effectiveResolvedOptions.sensitivity,
              baselineWindow: effectiveResolvedOptions.baselineWindow,
              seasonalitySamples: effectiveResolvedOptions.seasonalitySamples,
              seasonalRefinement: effectiveResolvedOptions.seasonalRefinement,
              severityPreset: effectiveResolvedOptions.severityPreset,
            },
          }),
        });

        const payload = (await response.json()) as {
          error?: string;
          registered?: ScoreFeedRule[];
          removed?: string[];
          evaluationIntervalSeconds?: number;
        };

        if (!response.ok) {
          throw new Error(payload.error || `Sync failed with status ${response.status}.`);
        }

        const registered = Array.isArray(payload.registered) ? payload.registered : [];
        const removed = Array.isArray(payload.removed) ? payload.removed : [];
        const evaluationInterval = Math.max(1, Math.round(payload.evaluationIntervalSeconds ?? 5));
        const sourceLabel = context.source === 'saved' ? 'saved dashboard' : 'live panel';

        setLastSyncedHash(syncHash);
        setState({
          kind: 'synced',
          message:
            registered.length > 0
              ? `Synced ${registered.length} alert-ready Prometheus score rule${registered.length === 1 ? '' : 's'} from the ${sourceLabel}. Metrics refresh about every ${evaluationInterval} seconds.`
              : removed.length > 0
                ? `Removed ${removed.length} previous score rule${removed.length === 1 ? '' : 's'} because this panel no longer exposes an active Prometheus target.`
                : `Prometheus score feed is active for this panel. Metrics refresh about every ${evaluationInterval} seconds.`,
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
    [liveTargets, lastSyncedHash, metricNames, options, panelId, panelTitle, resolvedOptions, scoreFeedMode]
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

export const SimplePanel: React.FC<Props> = ({ id, options, data, width, height }) => {
  const theme = useTheme2();
  const styles = getStyles(theme.isDark);
  const preparedSeries = useMemo(() => collectPreparedSeries(data.series), [data.series]);
  const metricLabels = useMemo(() => preparedSeries.map((series) => series.label), [preparedSeries]);
  const resolvedOptions = useMemo(() => resolveOptions(options, metricLabels), [options, metricLabels]);
  const dashboardUid = getDashboardUidFromLocation();
  const liveTargets = useMemo(
    () => extractPrometheusTargets((((data as unknown as { request?: { targets?: unknown[] } }).request?.targets) ?? []) as unknown[]),
    [data]
  );
  const scoreFeed = useScoreFeedSync({
    panelId: id ?? 0,
    panelTitle: options.title || 'Anomaly detector',
    options,
    resolvedOptions,
    metricNames: metricLabels,
    liveTargets,
  });
  const { analyses, effectiveBucketSpanMs } = useMemo(
    () => buildAnalyses(preparedSeries, resolvedOptions),
    [preparedSeries, resolvedOptions]
  );
  const events = useMemo(
    () => (resolvedOptions.detectionMode === 'multi' ? buildMultiMetricEvents(analyses, resolvedOptions) : []),
    [analyses, resolvedOptions]
  );
  const summaryItems = useMemo(
    () => (options.showSummary === false ? [] : buildSummaryItems(analyses, events, resolvedOptions)),
    [analyses, events, options.showSummary, resolvedOptions]
  );
  const [selection, setSelection] = useState<SelectionToken | null>(null);
  const [actionToast, setActionToast] = useState<ActionToast | null>(null);
  const [scoreFeedExpanded, setScoreFeedExpanded] = useState(false);
  const [exportsExpanded, setExportsExpanded] = useState(false);
  const activeSelection = useMemo(
    () => (selectionExists(selection, analyses, events) ? selection : summaryItems[0]?.selection ?? null),
    [analyses, events, selection, summaryItems]
  );

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

  const selectionDetail = useMemo(() => buildSelectionDetail(activeSelection, analyses, events), [activeSelection, analyses, events]);
  const allPoints = useMemo(() => analyses.flatMap((analysis) => analysis.allPoints), [analyses]);
  const scoreFeedStatusColor = getScoreFeedStatusColor(scoreFeed.kind, theme.isDark);
  const scoreFeedCard =
    options.scoreFeedMode !== 'off' ? (
      <div className={`${styles.card} ${styles.wideCard}`}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <div className={styles.cardTitle}>Prometheus score feed</div>
            <div className={styles.subtitle}>{scoreFeed.message}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={styles.recommendationBadge} style={{ background: `${scoreFeedStatusColor}22`, color: scoreFeedStatusColor }}>
              {getScoreFeedStatusLabel(scoreFeed.kind)}
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
        <div className={styles.detailGrid}>
          <div className={styles.detailStat}><div className={styles.detailLabel}>Mode</div><div className={styles.detailValue}>{SCORE_FEED_MODE_LABELS[options.scoreFeedMode]}</div></div>
          <div className={styles.detailStat}><div className={styles.detailLabel}>Rules</div><div className={styles.detailValue}>{scoreFeed.registered.length}</div></div>
          <div className={styles.detailStat}><div className={styles.detailLabel}>Last sync</div><div className={styles.detailValue}>{formatSyncMoment(scoreFeed.lastSyncedAt)}</div></div>
          <div className={styles.detailStat}><div className={styles.detailLabel}>Alert metric</div><div className={styles.detailValue}>{scoreFeed.registered.length > 0 ? 'grafana_anomaly_rule_score' : 'Waiting for sync'}</div></div>
        </div>
        {scoreFeed.registered.length > 0 ? (
          <>
            <div className={styles.subtitle}>Synced score rules are ready for alerting. Keep this collapsed during analysis, then expand only when you need the underlying PromQL.</div>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.actionButtonSecondary}
                onClick={() => setScoreFeedExpanded((current) => !current)}
              >
                {scoreFeedExpanded ? 'Hide score rules' : 'Show score rules'}
              </button>
            </div>
            {scoreFeedExpanded ? (
              <div className={styles.feedRuleList}>
                {scoreFeed.registered.map((item) => (
                  <div key={item.rule} className={styles.feedRuleCard}>
                    <div className={styles.summaryTitle}>{item.rule}</div>
                    <div className={styles.subtitle}>Alert rule query</div>
                    <div className={styles.codeLine}>{item.query}</div>
                    <div className={styles.subtitle}>Per-series drilldown query</div>
                    <div className={styles.codeLine}>{item.perSeriesQuery}</div>
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

  if (preparedSeries.length === 0 || allPoints.length === 0) {
    return (
      <div className={styles.wrapper}>
        {scoreFeedCard}
        <div className={styles.emptyState}>Add a time series query with at least one numeric field to start anomaly analysis.</div>
      </div>
    );
  }

  const seriesCount = analyses.length;
  const anomalyCount = resolvedOptions.detectionMode === 'multi' ? events.filter((event) => event.isAnomaly).length : analyses.reduce((sum, analysis) => sum + analysis.anomalyCount, 0);
  const peakScoreCandidates = resolvedOptions.detectionMode === 'multi' ? events.map((event) => event.score) : analyses.map((analysis) => analysis.maxScore);
  const peakScore = Math.max(...peakScoreCandidates, 0);
  const peakSeverity = analyses.reduce<SeverityState>((current, analysis) => pickHigherSeverity(current, { severityLabel: analysis.maxSeverityLabel, severityScore: analysis.maxSeverityScore }), {
    severityLabel: 'normal',
    severityScore: 0,
  });

  const allTimes = allPoints.map((point) => point.time);
  const allValues = allPoints.flatMap((point) => [point.value, point.expected, point.lower, point.upper]).filter((value): value is number => value !== null && Number.isFinite(value));
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const yPadding = Math.max((maxValue - minValue) * 0.12, Math.abs(maxValue) * 0.03, 1);
  const domainMin = minValue - yPadding;
  const domainMax = maxValue + yPadding;

  const chartWidth = Math.max(width - 24, 320);
  const chartHeight = Math.max(Math.min(options.showSummary === false ? height - 72 : height * 0.48, 420), 300);
  const chartPadding = PADDING;
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

  const xTickCount =
    resolvedOptions.detectionMode === 'multi'
      ? Math.max(3, Math.min(4, Math.ceil(chartWidth / 560)))
      : Math.max(3, Math.min(5, Math.ceil(chartWidth / 420)));
  const yTickCount = 4;
  const xTicks = buildLinearTicks(minTime, maxTime, xTickCount);
  const yTicks = buildLinearTicks(domainMin, domainMax, yTickCount);
  const eventMarkerGap = Math.max(96, innerWidth / 6.5);
  const visibleEvents =
    resolvedOptions.detectionMode === 'multi'
      ? limitMarkerCount(
          selectVisibleMarkers(events.filter((event) => event.isAnomaly), getX, eventMarkerGap, activeSelection?.kind === 'event' ? activeSelection.time : null),
          6,
          activeSelection?.kind === 'event' ? activeSelection.time : null
        )
      : [];

  const bucketSpanLabel = formatEffectiveBucketSpanLabel(resolvedOptions.bucketSpan, effectiveBucketSpanMs);
  const howItWorks = buildHowItWorksText(resolvedOptions, effectiveBucketSpanMs);
  const annotationExport = buildAnnotationExport(summaryItems, bucketSpanLabel);
  const alertQuery = buildAlertPromQuery(scoreFeed.registered);
  const alertExport = buildAlertExport(selectionDetail, resolvedOptions, bucketSpanLabel, scoreFeed.registered);
  const selectedAnnotationPayload = buildSelectedAnnotationPayload(selectionDetail, id ?? 0, dashboardUid, bucketSpanLabel);
  const selectedAnnotationExport = selectedAnnotationPayload ? JSON.stringify(selectedAnnotationPayload, null, 2) : '';
  const selectedRect = selectionDetail
    ? {
        x: getX(selectionDetail.bucketStart),
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
  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.title}>{options.title || 'Anomaly detector'}</div>
          <div className={styles.subtitle}>
            {ALGORITHM_LABELS[resolvedOptions.algorithm]} across {seriesCount} numeric series | {MODE_LABELS[resolvedOptions.detectionMode]} | {bucketSpanLabel}
          </div>
        </div>
        <div className={styles.stats}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Series</div>
            <div className={styles.statValue}>{seriesCount}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Anomalies</div>
            <div className={styles.statValue}>{anomalyCount}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Peak score</div>
            <div className={styles.statValue}>{formatValue(peakScore)}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Alert severity</div>
            <div className={styles.statValue} style={{ color: SEVERITY_COLORS[peakSeverity.severityLabel] }}>{SEVERITY_LABELS[peakSeverity.severityLabel]}</div>
          </div>
        </div>
      </div>

      <div className={styles.recommendationBanner}>
        <div className={styles.recommendationBadge}>{resolvedOptions.recommendation.badge}</div>
        <div className={styles.recommendationCopy}>
          <div className={styles.recommendationTitle}>{resolvedOptions.recommendation.title}</div>
          <div className={styles.recommendationText}>
            {resolvedOptions.recommendation.reason}
            {resolvedOptions.recommendation.matchedNames.length > 0 ? ` Matched metrics: ${resolvedOptions.recommendation.matchedNames.slice(0, 3).join(', ')}.` : ''}
          </div>
        </div>
      </div>

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

      <div className={styles.chartCard}>
        <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Anomaly chart">
          <rect x={0} y={0} width={chartWidth} height={chartHeight} fill={theme.isDark ? '#08111F' : '#FFFFFF'} />
          {selectedRect ? (
            <rect
              x={Math.max(chartPadding.left, selectedRect.x)}
              y={chartPadding.top}
              width={Math.min(selectedRect.width, innerWidth)}
              height={innerHeight}
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
                <text x={chartPadding.left - 10} y={y + 4} textAnchor="end" fill={theme.isDark ? '#94A3B8' : '#64748B'} fontSize="11">
                  {formatValue(tick)}
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
                  {formatTime(tick)}
                </text>
              </g>
            );
          })}
          {resolvedOptions.detectionMode === 'multi' && visibleEventBands.length > 0 ? (
            <g>
              {visibleEventBands.map(({ event, x, width, centerX }) => {
                const selected = activeSelection?.kind === 'event' && activeSelection.time === event.time;
                const tint = SEVERITY_COLORS[event.severityLabel];
                return (
                  <g key={`event-${event.time}`} style={{ cursor: 'pointer' }} onClick={() => setSelection({ kind: 'event', time: event.time })}>
                    <title>{`Combined anomaly at ${formatTime(event.time)} | Score ${formatValue(event.score)} | ${SEVERITY_LABELS[event.severityLabel]}`}</title>
                    <rect x={x} y={chartPadding.top + 1} width={width} height={innerHeight - 2} rx={selected ? 10 : 8} fill={tint} fillOpacity={selected ? 0.14 : 0.05} />
                    <rect x={x} y={chartPadding.top + 4} width={width} height={4} rx={2} fill={tint} fillOpacity={selected ? 0.9 : 0.5} />
                    <rect x={x} y={chartPadding.top + innerHeight - 6} width={width} height={3} rx={1.5} fill={tint} fillOpacity={selected ? 0.8 : 0.42} />
                    {selected ? (
                      <line
                        x1={centerX}
                        y1={chartPadding.top + 10}
                        x2={centerX}
                        y2={chartPadding.top + innerHeight - 10}
                        stroke={tint}
                        strokeOpacity={0.68}
                        strokeWidth={1.4}
                        strokeDasharray="4 5"
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>
          ) : null}
          {analyses.map((analysis) => {
            const areaPath = options.showBands === false ? '' : buildAreaPath(analysis.points, getX, getY);
            const actualPath = buildLinePath(analysis.points, getX, getY, (point) => point.value);
            const expectedPath = resolvedOptions.showExpectedLine ? buildLinePath(analysis.points, getX, getY, (point) => point.expected) : '';
            const selectedPointTime = activeSelection?.kind === 'point' && activeSelection.seriesKey === analysis.key ? activeSelection.time : null;
            const visiblePoints =
              resolvedOptions.detectionMode === 'multi'
                ? []
                : selectVisibleMarkers(analysis.points.filter((point) => point.isAnomaly), getX, Math.max(18, innerWidth / 28), selectedPointTime);
            return (
              <g key={analysis.key}>
                {areaPath ? <path d={areaPath} fill={analysis.color} opacity={selectionDetail && selectionDetail.kind === 'point' && selectionDetail.seriesKey === analysis.key ? 0.14 : 0.07} /> : null}
                {expectedPath ? <path d={expectedPath} fill="none" stroke={analysis.color} strokeOpacity={0.32} strokeWidth={1.3} strokeDasharray="6 6" /> : null}
                <path d={actualPath} fill="none" stroke={analysis.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                {visiblePoints.map((point) => {
                  const selected = activeSelection?.kind === 'point' && activeSelection.seriesKey === analysis.key && activeSelection.time === point.time;
                  return (
                    <g key={`${analysis.key}-${point.time}`} style={{ cursor: 'pointer' }} onClick={() => setSelection({ kind: 'point', seriesKey: analysis.key, time: point.time })}>
                      <circle cx={getX(point.time)} cy={getY(point.value)} r={selected ? 6.5 : 4.8} fill={theme.isDark ? '#111827' : '#FFFFFF'} stroke={SEVERITY_COLORS[point.severityLabel]} strokeWidth={selected ? 2.6 : 2.2} />
                      <circle cx={getX(point.time)} cy={getY(point.value)} r={10} fill="transparent" />
                    </g>
                  );
                })}
              </g>
            );
          })}
          <rect x={chartPadding.left} y={chartPadding.top} width={innerWidth} height={innerHeight} rx={12} fill="none" stroke={theme.isDark ? '#22314A' : '#D7E3F4'} />
        </svg>
      </div>

      <div className={styles.legend}>
        {analyses.map((analysis) => (
          <div key={analysis.key} className={styles.legendItem} title={`${analysis.label} | ${analysis.anomalyCount} anomalies | max ${formatValue(analysis.maxScore)}`}>
            <span className={styles.legendSwatch} style={{ background: analysis.color }} />
            <span>
              {analysis.label} | {analysis.anomalyCount} anomalies | max {formatValue(analysis.maxScore)}
            </span>
          </div>
        ))}
      </div>

      {options.showSummary === false ? scoreFeedCard : null}

      {options.showSummary !== false ? (
        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Top anomalies</div>
            <div className={styles.summaryList}>
              {summaryItems.length === 0 ? (
                <div className={styles.subtitle}>No anomalies crossed the active threshold in the selected time range.</div>
              ) : (
                summaryItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.summaryRow} ${selectionKey(selection) === selectionKey(item.selection) ? styles.summaryRowSelected : ''}`}
                    onClick={() => setSelection(item.selection)}
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

          <div className={styles.card}>
            <div className={styles.cardTitle}>Selected anomaly</div>
            {selectionDetail ? (
              <>
                <div className={styles.recommendationText}>{selectionDetail.title}</div>
                <div className={styles.subtitle}>{selectionDetail.subtitle}</div>
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.actionButton}
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
                  <button
                    type="button"
                    className={styles.actionButtonSecondary}
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
                </div>
                {!dashboardUid ? <div className={styles.subtitle}>Save the dashboard once so Grafana knows which dashboard the new annotation belongs to.</div> : null}
                <div className={styles.detailGrid}>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Score</div>
                    <div className={styles.detailValue}>{formatValue(selectionDetail.score)}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Severity</div>
                    <div className={styles.detailValue} style={{ color: SEVERITY_COLORS[selectionDetail.severityLabel] }}>{SEVERITY_LABELS[selectionDetail.severityLabel]} {selectionDetail.severityScore}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Bucket span</div>
                    <div className={styles.detailValue}>{formatBucketWindow(selectionDetail.bucketStart, selectionDetail.bucketEnd)}</div>
                  </div>
                  <div className={styles.detailStat}>
                    <div className={styles.detailLabel}>Guidance</div>
                    <div className={styles.detailValue}>{buildAlertGuidance(selectionDetail, resolvedOptions.severityPreset)}</div>
                  </div>
                </div>
                {selectionDetail.kind === 'point' ? (
                  <div className={styles.detailGrid}>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Actual</div><div className={styles.detailValue}>{formatValue(selectionDetail.actual)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Expected</div><div className={styles.detailValue}>{formatValue(selectionDetail.expected)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Deviation</div><div className={styles.detailValue}>{formatValue(selectionDetail.deviation)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Deviation %</div><div className={styles.detailValue}>{formatPercent(selectionDetail.deviationPercent)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Expected range</div><div className={styles.detailValue}>{formatRange(selectionDetail.rangeLower, selectionDetail.rangeUpper)}</div></div>
                    <div className={styles.detailStat}><div className={styles.detailLabel}>Samples in bucket</div><div className={styles.detailValue}>{selectionDetail.sampleCount}</div></div>
                  </div>
                ) : (
                  <div className={styles.detailTable}>
                    <div className={`${styles.detailRow} ${styles.detailHeaderRow}`}>
                      <span>Metric</span>
                      <span>Actual</span>
                      <span>Expected</span>
                      <span>Deviation</span>
                      <span>Score</span>
                    </div>
                    {selectionDetail.breakdown.map((row) => (
                      <div key={row.label} className={styles.detailRow}>
                        <span style={{ color: row.color, fontWeight: 700 }}>{row.label}</span>
                        <span>{formatValue(row.actual)}</span>
                        <span>{formatValue(row.expected)}</span>
                        <span>{formatValue(row.deviation)}</span>
                        <span style={{ color: SEVERITY_COLORS[row.severityLabel] }}>{formatValue(row.score)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className={styles.subtitle}>Click an anomaly marker or a row from Top anomalies to inspect expected value, deviation, and bucket details.</div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>How it works</div>
            <div className={styles.recommendationText}>{howItWorks}</div>
            <div className={styles.detailGrid}>
              <div className={styles.detailStat}><div className={styles.detailLabel}>Setup mode</div><div className={styles.detailValue}>{SETUP_MODE_LABELS[resolvedOptions.setupMode]}</div></div>
              <div className={styles.detailStat}><div className={styles.detailLabel}>Metric preset</div><div className={styles.detailValue}>{METRIC_PRESET_LABELS[resolvedOptions.metricPreset]}</div></div>
              <div className={styles.detailStat}><div className={styles.detailLabel}>Effective preset</div><div className={styles.detailValue}>{resolvedOptions.effectiveMetricPreset === 'custom' ? 'Custom' : METRIC_PRESET_LABELS[resolvedOptions.effectiveMetricPreset]}</div></div>
              <div className={styles.detailStat}><div className={styles.detailLabel}>Severity preset</div><div className={styles.detailValue}>{SEVERITY_PRESET_LABELS[resolvedOptions.severityPreset]}</div></div>
            </div>
          </div>

          {scoreFeedCard}

          {options.showExports !== false ? (
            <>
              <div className={`${styles.card} ${styles.wideCard}`}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                    <div className={styles.cardTitle}>Operational exports</div>
                    <div className={styles.subtitle}>Hidden by default to keep the dashboard clean. Expand only when you need annotation payloads or a copy-paste alert query.</div>
                  </div>
                  <button
                    type="button"
                    className={styles.actionButtonSecondary}
                    onClick={() => setExportsExpanded((current) => !current)}
                  >
                    {exportsExpanded ? 'Hide exports' : 'Show exports'}
                  </button>
                </div>
              </div>
              {exportsExpanded ? (
                <>
                  <div className={`${styles.card} ${styles.wideCard}`}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
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
                  <div className={`${styles.card} ${styles.wideCard}`}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                        <div className={styles.cardTitle}>Alert rule export</div>
                        <div className={styles.subtitle}>
                          {alertQuery
                            ? `Paste this PromQL into Grafana Alerting, then set WHEN QUERY IS ABOVE ${getRecommendedAlertThreshold(resolvedOptions.severityPreset)} FOR 2m.`
                            : 'Sync Prometheus score feed first to generate an alert-ready anomaly score query.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.actionButtonSecondary}
                        disabled={!alertQuery}
                        onClick={() => {
                          if (!alertQuery) {
                            setActionToast({ tone: 'error', message: 'Sync Prometheus score feed first to generate the alert query.' });
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
                    <div className={styles.codeLine}>{alertQuery || 'Sync Prometheus score feed first to generate an alert-ready PromQL query.'}</div>
                    <pre className={styles.monoBlock}>{alertExport}</pre>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const __testables = {
  normalizeScoreFeedEndpoint,
  extractPrometheusTargets,
  buildMetricHintNames,
  buildScoreFeedSyncHash,
  buildSelectedAnnotationPayload,
  buildGrafanaErrorMessage,
};






