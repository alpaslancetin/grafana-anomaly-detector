import { AnomalyDirection, BucketSpan, DetectionAlgorithm, SeasonalRefinement, SeverityPreset } from './types';

export type SeverityLabel = 'normal' | 'low' | 'medium' | 'high' | 'critical';
export type ConfidenceLabel = 'low' | 'medium' | 'high';
export type DataQualityLabel = 'healthy' | 'thin' | 'flatline' | 'gappy';
export type DecisionState = 'normal' | 'candidate' | 'open' | 'recovering' | 'cooldown' | 'warming_up';

export interface SeverityState {
  severityScore: number;
  severityLabel: SeverityLabel;
}

export interface ConfidenceState {
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  dataQualityLabel: DataQualityLabel;
}

export interface ValueDomain {
  min: number;
  max: number;
}

export interface RawPoint {
  time: number;
  value: number;
  bucketStart: number;
  bucketEnd: number;
  sampleCount: number;
  minValue: number;
  maxValue: number;
}

export interface SamplePoint extends RawPoint, SeverityState, ConfidenceState {
  expected: number | null;
  upper: number | null;
  lower: number | null;
  score: number;
  pointScore: number;
  windowScore: number;
  scoreDriver: 'point' | 'window';
  isAnomaly: boolean;
  decisionState: DecisionState;
}

export interface PreparedSeries {
  rawPoints: RawPoint[];
}

export interface ScoringOptions {
  algorithm: DetectionAlgorithm;
  anomalyDirection?: AnomalyDirection;
  minimumAbsoluteDeviation?: number;
  minimumRelativeDeviation?: number;
  minimumActivity?: number;
  persistenceBuckets?: number;
  persistenceWindow?: number;
  recoveryThreshold?: number;
  recoveryBuckets?: number;
  cooldownBuckets?: number;
  dataQualityGate?: boolean;
  sensitivity: number;
  baselineWindow: number;
  seasonalitySamples: number;
  seasonalRefinement: SeasonalRefinement;
  severityPreset: SeverityPreset;
}

const MIN_BASELINE_POINTS = 3;
const MIN_SEASONAL_SAMPLES = 3;
const AUTO_TARGET_POINTS = 640;
export const MAX_RAW_SCORE = 100;

export const getWarmupHistoryPoints = (baselineWindow: number): number =>
  Math.max(MIN_BASELINE_POINTS, Math.floor(Number.isFinite(baselineWindow) ? baselineWindow : MIN_BASELINE_POINTS));

const BUCKET_SPAN_MS: Record<Exclude<BucketSpan, 'auto' | 'raw'>, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

const EXPLICIT_BUCKET_SPANS = Object.values(BUCKET_SPAN_MS).sort((left, right) => left - right);

const SEVERITY_THRESHOLDS: Record<SeverityPreset, { low: number; medium: number; high: number; critical: number }> = {
  warning_first: { low: 35, medium: 55, high: 72, critical: 88 },
  balanced: { low: 40, medium: 60, high: 75, critical: 90 },
  page_first: { low: 45, medium: 65, high: 82, critical: 95 },
};

export const buildRawPoint = (time: number, value: number): RawPoint => ({
  time,
  value,
  bucketStart: time,
  bucketEnd: time,
  sampleCount: 1,
  minValue: value,
  maxValue: value,
});

const sanitizeRawPoint = (point: RawPoint): RawPoint | null => {
  if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) {
    return null;
  }

  const sampleCount = Number.isFinite(point.sampleCount) ? Math.max(1, Math.floor(point.sampleCount)) : 1;
  const candidateMin = Number.isFinite(point.minValue) ? point.minValue : point.value;
  const candidateMax = Number.isFinite(point.maxValue) ? point.maxValue : point.value;

  return {
    ...point,
    bucketStart: Number.isFinite(point.bucketStart) ? point.bucketStart : point.time,
    bucketEnd: Number.isFinite(point.bucketEnd) ? point.bucketEnd : point.time,
    sampleCount,
    minValue: Math.min(candidateMin, candidateMax, point.value),
    maxValue: Math.max(candidateMin, candidateMax, point.value),
  };
};

export const sanitizeRawPoints = (points: RawPoint[]): RawPoint[] =>
  points
    .map(sanitizeRawPoint)
    .filter((point): point is RawPoint => point !== null)
    .sort((left, right) => left.time - right.time);

const boundRawScore = (score: number): number =>
  Number.isFinite(score) ? Math.max(0, Math.min(MAX_RAW_SCORE, score)) : 0;

export const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

export const resolveValueDomain = (values: number[], actualValues: number[]): ValueDomain => {
  const finiteValues = values.filter(Number.isFinite);
  const finiteActualValues = actualValues.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return { min: 0, max: 1 };
  }

  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const padding = Math.max((maxValue - minValue) * 0.12, Math.abs(maxValue) * 0.03, 1);
  const onlyNonNegativeActuals = finiteActualValues.length > 0 && finiteActualValues.every((value) => value >= 0);

  return {
    min: onlyNonNegativeActuals ? Math.max(0, minValue - padding) : minValue - padding,
    max: maxValue + padding,
  };
};

export const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

export const mad = (values: number[], center?: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const medianCenter = center ?? median(values);
  return median(values.map((value) => Math.abs(value - medianCenter))) * 1.4826;
};

export const standardDeviation = (values: number[], center?: number): number => {
  if (values.length <= 1) {
    return 0;
  }

  const avg = center ?? mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export const safeSpread = (spread: number, reference: number): number => {
  if (Number.isFinite(spread) && spread > 1e-9) {
    return spread;
  }

  return Math.max(Math.abs(reference) * 0.02, 1e-6);
};

const getSeasonalBucketKeys = (timestampMs: number): Record<'hour_of_day' | 'weekday_hour', string> => {
  const date = new Date(timestampMs);
  return {
    hour_of_day: `hour:${date.getHours()}`,
    weekday_hour: `weekday:${date.getDay()}-${date.getHours()}`,
  };
};

const getSeasonalExpectedAndSpread = (peers: number[], recentHistory: number[]): { expected: number; spread: number } => {
  const expected = median(peers);
  const peerSpread = safeSpread(mad(peers, expected), expected);
  const deltas = peers.slice(1).map((value, index) => value - peers[index]);
  const trend = deltas.length >= 2 ? median(deltas) : 0;
  const deltaSpread = deltas.length >= 2 ? safeSpread(mad(deltas, trend), expected) : 0;
  const localSpread = recentHistory.length > 0 ? safeSpread(mad(recentHistory), median(recentHistory)) : 0;
  const spread = Math.max(peerSpread, deltaSpread, localSpread * 0.75);
  return {
    expected: expected + trend,
    spread: safeSpread(spread, expected + trend),
  };
};

export const dedupeConsecutivePoints = (points: RawPoint[]): RawPoint[] => {
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

export const resolveBucketSpanMs = (series: PreparedSeries[], requested: BucketSpan): number | null => {
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

export const aggregateRawPoints = (points: RawPoint[], bucketSpanMs: number | null): RawPoint[] => {
  const validPoints = sanitizeRawPoints(points);
  if (!bucketSpanMs || validPoints.length === 0) {
    return dedupeConsecutivePoints(validPoints);
  }

  const buckets = new Map<number, { sum: number; count: number; min: number; max: number; end: number }>();

  for (const point of validPoints) {
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

const getWindowScore = (history: number[], currentValue: number, expected: number, spread: number, window: number): number => {
  const contextWindow = Math.min(Math.max(3, Math.floor(window / 3)), 10);
  const recent = [...history.slice(-(contextWindow - 1)), currentValue];
  if (recent.length < 3) {
    return 0;
  }

  return Math.abs(mean(recent) - expected) / spread;
};

const getDataQualityState = (points: RawPoint[], index: number, baselineWindow: number): DataQualityLabel => {
  const history = points.slice(Math.max(0, index - baselineWindow), index + 1);
  const values = history.map((entry) => entry.value);
  const recent = history.slice(-Math.max(4, Math.min(baselineWindow, 8)));

  if (values.length < Math.max(MIN_BASELINE_POINTS, Math.floor(baselineWindow / 2))) {
    return 'thin';
  }

  if (recent.length >= 3) {
    const diffs = recent.slice(1).map((point, offset) => point.time - recent[offset].time).filter((diff) => diff > 0);
    const expectedStep = diffs.length > 0 ? median(diffs) : null;
    const smallestStep = diffs.length > 0 ? Math.min(...diffs) : null;
    const largestStep = diffs.length > 0 ? Math.max(...diffs) : null;
    if (
      (expectedStep && diffs.some((diff) => diff > expectedStep * 2.4)) ||
      (smallestStep && largestStep && largestStep > smallestStep * 1.8)
    ) {
      return 'gappy';
    }
  }

  if (recent.length >= 4) {
    const recentValues = recent.map((entry) => entry.value);
    const floor = Math.max(Math.abs(mean(recentValues)) * 0.002, 1e-6);
    if (Math.max(...recentValues) - Math.min(...recentValues) <= floor) {
      return 'flatline';
    }
  }

  return 'healthy';
};

const getConfidenceState = (
  rawScore: number,
  threshold: number,
  pointRawScore: number,
  windowRawScore: number,
  sampleCount: number,
  dataQualityLabel: DataQualityLabel
): ConfidenceState => {
  const safeThreshold = Math.max(threshold, 1e-6);
  const ratio = Math.min(rawScore / safeThreshold, 2.5);
  let confidenceScore = (ratio / 2.5) * 100;

  if (windowRawScore > pointRawScore) {
    confidenceScore += 8;
  }

  if (sampleCount >= 8) {
    confidenceScore += 4;
  }

  if (dataQualityLabel === 'thin') {
    confidenceScore -= 18;
  } else if (dataQualityLabel === 'flatline') {
    confidenceScore -= 22;
  } else if (dataQualityLabel === 'gappy') {
    confidenceScore -= 12;
  }

  const boundedScore = Math.max(5, Math.min(100, Math.round(confidenceScore * 10) / 10));
  const confidenceLabel: ConfidenceLabel = boundedScore >= 80 ? 'high' : boundedScore >= 55 ? 'medium' : 'low';

  return {
    confidenceScore: boundedScore,
    confidenceLabel,
    dataQualityLabel,
  };
};

const buildEmptyPoint = (point: RawPoint, threshold: number, severityPreset: SeverityPreset): SamplePoint => {
  const severity = getSeverityState(0, threshold, severityPreset);
  return {
    ...point,
    expected: null,
    upper: null,
    lower: null,
    score: 0,
    pointScore: 0,
    windowScore: 0,
    scoreDriver: 'point',
    isAnomaly: false,
    decisionState: 'warming_up',
    ...severity,
    confidenceScore: 5,
    confidenceLabel: 'low',
    dataQualityLabel: 'thin',
  };
};

const buildZScorePoints = (points: RawPoint[], threshold: number, window: number, severityPreset: SeverityPreset): SamplePoint[] =>
  points.map((point, index) => {
    const history = points.slice(Math.max(0, index - window), index).map((entry) => entry.value);
    if (history.length < getWarmupHistoryPoints(window)) {
      return buildEmptyPoint(point, threshold, severityPreset);
    }

    const expected = mean(history);
    const spread = safeSpread(standardDeviation(history, expected), expected);
    const pointScore = Math.abs(point.value - expected) / spread;
    const windowScore = 0;
    const score = pointScore;
    const severity = getSeverityState(score, threshold, severityPreset);
    const confidence = getConfidenceState(score, threshold, pointScore, windowScore, history.length + 1, getDataQualityState(points, index, window));

    return {
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      pointScore,
      windowScore,
      scoreDriver: windowScore > pointScore ? 'window' : 'point',
      isAnomaly: score >= threshold,
      decisionState: score >= threshold ? 'open' : 'normal',
      ...severity,
      ...confidence,
    };
  });

const buildMadPoints = (points: RawPoint[], threshold: number, window: number, severityPreset: SeverityPreset): SamplePoint[] =>
  points.map((point, index) => {
    const history = points.slice(Math.max(0, index - window), index).map((entry) => entry.value);
    if (history.length < getWarmupHistoryPoints(window)) {
      return buildEmptyPoint(point, threshold, severityPreset);
    }

    const expected = median(history);
    const deviationHistory = history.map((value) => Math.abs(value - expected));
    const spread = safeSpread(median(deviationHistory) * 1.4826, expected);
    const pointScore = Math.abs(point.value - expected) / spread;
    const windowScore = 0;
    const score = pointScore;
    const severity = getSeverityState(score, threshold, severityPreset);
    const confidence = getConfidenceState(score, threshold, pointScore, windowScore, history.length + 1, getDataQualityState(points, index, window));

    return {
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      pointScore,
      windowScore,
      scoreDriver: windowScore > pointScore ? 'window' : 'point',
      isAnomaly: score >= threshold,
      decisionState: score >= threshold ? 'open' : 'normal',
      ...severity,
      ...confidence,
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
      results.push(buildEmptyPoint(point, threshold, severityPreset));
      return;
    }

    const expected = smoothed;
    const spread = safeSpread(median(residualHistory.slice(-window)) || standardDeviation(points.slice(Math.max(0, index - window), index).map((entry) => entry.value)), expected);
    const history = points.slice(Math.max(0, index - window), index).map((entry) => entry.value);
    residualHistory.push(Math.abs(point.value - expected));
    smoothed = alpha * point.value + (1 - alpha) * expected;

    if (history.length < getWarmupHistoryPoints(window)) {
      results.push(buildEmptyPoint(point, threshold, severityPreset));
      return;
    }

    const pointScore = Math.abs(point.value - expected) / spread;
    const windowScore = getWindowScore(history, point.value, expected, spread, window);
    const score = Math.max(pointScore, windowScore);
    const severity = getSeverityState(score, threshold, severityPreset);
    const confidence = getConfidenceState(score, threshold, pointScore, windowScore, history.length + 1, getDataQualityState(points, index, window));
    results.push({
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      pointScore,
      windowScore,
      scoreDriver: windowScore > pointScore ? 'window' : 'point',
      isAnomaly: score >= threshold,
      decisionState: score >= threshold ? 'open' : 'normal',
      ...severity,
      ...confidence,
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
  const hourlyHistory = new Map<string, number[]>();
  const weekdayHistory = new Map<string, number[]>();

  return points.map((point, index) => {
    let peers: number[] = [];
    if (refinement === 'cycle') {
      for (let cursor = index - seasonalitySamples; cursor >= 0 && peers.length < window; cursor -= seasonalitySamples) {
        peers.push(points[cursor].value);
      }
    } else {
      const bucketKeys = getSeasonalBucketKeys(point.time);
      peers =
        refinement === 'hour_of_day'
          ? [...(hourlyHistory.get(bucketKeys.hour_of_day) ?? [])].slice(-window)
          : [...(weekdayHistory.get(bucketKeys.weekday_hour) ?? [])].slice(-window);

      if (refinement === 'weekday_hour' && peers.length < MIN_SEASONAL_SAMPLES) {
        peers = [...(hourlyHistory.get(bucketKeys.hour_of_day) ?? [])].slice(-window);
      }

      const hourStored = hourlyHistory.get(bucketKeys.hour_of_day) ?? [];
      hourStored.push(point.value);
      hourlyHistory.set(bucketKeys.hour_of_day, hourStored);

      const weekdayStored = weekdayHistory.get(bucketKeys.weekday_hour) ?? [];
      weekdayStored.push(point.value);
      weekdayHistory.set(bucketKeys.weekday_hour, weekdayStored);
    }

    if (peers.length < MIN_SEASONAL_SAMPLES) {
      return buildEmptyPoint(point, threshold, severityPreset);
    }

    const recentHistory = points.slice(Math.max(0, index - window), index).map((entry) => entry.value);
    const { expected, spread } = getSeasonalExpectedAndSpread(peers, recentHistory);
    const pointScore = Math.abs(point.value - expected) / spread;
    const windowScore = 0;
    const score = pointScore;
    const severity = getSeverityState(score, threshold, severityPreset);
    const confidence = getConfidenceState(score, threshold, pointScore, windowScore, recentHistory.length + 1, getDataQualityState(points, index, window));

    return {
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      pointScore,
      windowScore,
      scoreDriver: windowScore > pointScore ? 'window' : 'point',
      isAnomaly: score >= threshold,
      decisionState: score >= threshold ? 'open' : 'normal',
      ...severity,
      ...confidence,
    };
  });
};

const selectLevelShiftReference = (values: number[], start: number, baselineEnd: number, window: number): number[] => {
  const anchorEnd = Math.min(start + window, baselineEnd);
  if (anchorEnd - start >= MIN_BASELINE_POINTS) {
    return values.slice(start, anchorEnd);
  }

  return values.slice(Math.max(start, baselineEnd - window), baselineEnd);
};

const buildLevelShiftPoints = (points: RawPoint[], threshold: number, window: number, severityPreset: SeverityPreset): SamplePoint[] => {
  const values = points.map((entry) => entry.value);
  const shiftWindow = Math.min(Math.max(3, Math.floor(window / 3)), 12);
  const recentWindow = Math.max(1, shiftWindow - 1);
  const lookbackWindow = Math.max(window * 6, window + shiftWindow);
  const minHistory = Math.max(getWarmupHistoryPoints(window), MIN_BASELINE_POINTS * 2, shiftWindow + MIN_BASELINE_POINTS);

  return points.map((point, index) => {
    const start = Math.max(0, index - lookbackWindow);
    if (index - start < minHistory) {
      return buildEmptyPoint(point, threshold, severityPreset);
    }

    const baselineEnd = index - recentWindow;
    if (baselineEnd - start < MIN_BASELINE_POINTS) {
      return buildEmptyPoint(point, threshold, severityPreset);
    }

    const referenceHistory = selectLevelShiftReference(values, start, baselineEnd, window);
    const expected = mean(referenceHistory);
    const spread = safeSpread(standardDeviation(referenceHistory, expected), expected);
    const pointScore = Math.abs(point.value - expected) / spread;
    const recentStart = Math.max(0, index - recentWindow);
    let recentSum = point.value;
    let persistentBuckets = Math.abs(point.value - expected) > spread ? 1 : 0;
    for (let cursor = recentStart; cursor < index; cursor += 1) {
      const recentValue = values[cursor];
      recentSum += recentValue;
      if (Math.abs(recentValue - expected) > spread) {
        persistentBuckets += 1;
      }
    }
    const recentCount = index - recentStart + 1;
    const recentCenter = recentSum / recentCount;
    const persistenceRatio = persistentBuckets / recentCount;
    const windowScore = (Math.abs(recentCenter - expected) / spread) * (1 + Math.max(0, persistenceRatio - 0.4));
    const score = Math.max(pointScore * 0.85, windowScore);
    const severity = getSeverityState(score, threshold, severityPreset);
    const confidence = getConfidenceState(score, threshold, pointScore, windowScore, referenceHistory.length + 1, getDataQualityState(points, index, window));

    return {
      ...point,
      expected,
      lower: expected - threshold * spread,
      upper: expected + threshold * spread,
      score,
      pointScore,
      windowScore,
      scoreDriver: windowScore >= pointScore * 0.85 ? 'window' : 'point',
      isAnomaly: score >= threshold,
      decisionState: score >= threshold ? 'open' : 'normal',
      ...severity,
      ...confidence,
    };
  });
};

export const analyzePoints = (points: RawPoint[], options: ScoringOptions): SamplePoint[] => {
  const window = Math.max(options.baselineWindow, 3);
  const threshold = Math.max(options.sensitivity, 0.2);
  const validPoints = dedupeConsecutivePoints(sanitizeRawPoints(points));
  let scoredPoints: SamplePoint[];

  switch (options.algorithm) {
    case 'mad':
      scoredPoints = buildMadPoints(validPoints, threshold, window, options.severityPreset);
      break;
    case 'ewma':
      scoredPoints = buildEwmaPoints(validPoints, threshold, window, options.severityPreset);
      break;
    case 'level_shift':
      scoredPoints = buildLevelShiftPoints(validPoints, threshold, window, options.severityPreset);
      break;
    case 'seasonal':
      scoredPoints = buildSeasonalPoints(validPoints, threshold, window, Math.max(options.seasonalitySamples, 2), options.seasonalRefinement, options.severityPreset);
      break;
    case 'zscore':
    default:
      scoredPoints = buildZScorePoints(validPoints, threshold, window, options.severityPreset);
      break;
  }

  const direction = options.anomalyDirection ?? 'high_or_low';
  const minimumAbsoluteDeviation = Math.max(0, options.minimumAbsoluteDeviation ?? 0);
  const minimumRelativeDeviation = Math.max(0, options.minimumRelativeDeviation ?? 0);
  const minimumActivity = Math.max(0, options.minimumActivity ?? 0);
  const persistenceWindow = Math.max(1, Math.round(options.persistenceWindow ?? 1));
  const persistenceBuckets = Math.max(1, Math.min(persistenceWindow, Math.round(options.persistenceBuckets ?? 1)));
  const recoveryThreshold = Math.max(0, Math.min(threshold, options.recoveryThreshold ?? 0));
  const recoveryBuckets = Math.max(1, Math.round(options.recoveryBuckets ?? 1));
  const cooldownBuckets = Math.max(0, Math.round(options.cooldownBuckets ?? 0));
  const decisionPolicyEnabled =
    direction !== 'high_or_low' ||
    minimumAbsoluteDeviation > 0 ||
    minimumRelativeDeviation > 0 ||
    minimumActivity > 0 ||
    persistenceBuckets > 1 ||
    recoveryThreshold > 0 ||
    recoveryBuckets > 1 ||
    cooldownBuckets > 0 ||
    options.dataQualityGate === true;

  if (!decisionPolicyEnabled) {
    return scoredPoints.map((point) => ({
      ...point,
      score: boundRawScore(point.score),
      pointScore: boundRawScore(point.pointScore),
      windowScore: boundRawScore(point.windowScore),
      decisionState: point.isAnomaly ? 'open' : point.expected === null ? 'warming_up' : 'normal',
    }));
  }

  const isCandidate = (point: SamplePoint, candidateThreshold: number): boolean => {
    const deviation = point.expected === null ? 0 : point.value - point.expected;
    const directionMatches =
      direction === 'high_or_low' || (direction === 'high_mean' && deviation > 0) || (direction === 'low_mean' && deviation < 0);
    const absoluteDeviation = Math.abs(deviation);
    const relativeDeviation = point.expected === null ? 0 : absoluteDeviation / Math.max(Math.abs(point.expected), 1e-9);
    const qualityMatches = options.dataQualityGate !== true || point.dataQualityLabel === 'healthy';
    return (
      point.score >= candidateThreshold &&
      directionMatches &&
      absoluteDeviation >= minimumAbsoluteDeviation &&
      relativeDeviation >= minimumRelativeDeviation &&
      Math.max(Math.abs(point.value), Math.abs(point.expected ?? 0)) >= minimumActivity &&
      qualityMatches
    );
  };

  const openCandidates = scoredPoints.map((point) => isCandidate(point, threshold));
  const closeThreshold = recoveryThreshold > 0 ? recoveryThreshold : threshold;
  const holdCandidates = scoredPoints.map((point) => isCandidate(point, closeThreshold));
  const recent: boolean[] = [];
  let incidentOpen = false;
  let recoveryCount = 0;
  let cooldownRemaining = 0;

  return scoredPoints.map((point, index) => {
    const boundedPoint = {
      ...point,
      score: boundRawScore(point.score),
      pointScore: boundRawScore(point.pointScore),
      windowScore: boundRawScore(point.windowScore),
    };
    const openCandidate = openCandidates[index];
    const holdCandidate = holdCandidates[index];
    recent.push(openCandidate);
    if (recent.length > persistenceWindow) {
      recent.shift();
    }

    if (incidentOpen) {
      if (holdCandidate) {
        recoveryCount = 0;
        return { ...boundedPoint, isAnomaly: true, decisionState: 'open' as const };
      }
      recoveryCount += 1;
      if (recoveryCount < recoveryBuckets) {
        return { ...boundedPoint, isAnomaly: true, decisionState: 'recovering' as const };
      }
      incidentOpen = false;
      recoveryCount = 0;
      cooldownRemaining = cooldownBuckets;
    }

    if (cooldownRemaining > 0) {
      cooldownRemaining -= 1;
      return { ...boundedPoint, isAnomaly: false, severityScore: 0, severityLabel: 'normal' as const, decisionState: 'cooldown' as const };
    }

    if (openCandidate && recent.filter(Boolean).length >= persistenceBuckets) {
      incidentOpen = true;
      return { ...boundedPoint, isAnomaly: true, decisionState: 'open' as const };
    }

    return {
      ...boundedPoint,
      isAnomaly: false,
      severityScore: 0,
      severityLabel: 'normal' as const,
      decisionState: openCandidate ? ('candidate' as const) : point.expected === null ? ('warming_up' as const) : ('normal' as const),
    };
  });
};
