import { analyzePoints, buildRawPoint, getWarmupHistoryPoints, MAX_RAW_SCORE, resolveValueDomain, ScoringOptions } from './scoring';

const buildBoundaryScenario = () =>
  [100, 100.2, 99.8, 106, 100.1, 99.9, 100.3, 99.7, 100.2, 99.8, 100.1, 99.9, 130].map((value, index) =>
    buildRawPoint(index * 60_000, value)
  );

const baseOptions: ScoringOptions = {
  algorithm: 'zscore',
  sensitivity: 4,
  baselineWindow: 12,
  seasonalitySamples: 24,
  seasonalRefinement: 'cycle',
  severityPreset: 'balanced',
};

describe('canonical anomaly scoring', () => {
  it('uses the configured history window as the range-boundary warm-up', () => {
    expect(getWarmupHistoryPoints(12)).toBe(12);
    expect(getWarmupHistoryPoints(1)).toBe(3);
    expect(getWarmupHistoryPoints(Number.NaN)).toBe(3);
  });

  it.each(['zscore', 'mad', 'ewma', 'level_shift'] as const)(
    'suppresses premature %s anomalies but detects a post-warm-up spike',
    (algorithm) => {
      const result = analyzePoints(buildBoundaryScenario(), { ...baseOptions, algorithm });

      expect(result.slice(0, baseOptions.baselineWindow).every((point) => !point.isAnomaly)).toBe(true);
      expect(result.slice(0, baseOptions.baselineWindow).every((point) => point.expected === null)).toBe(true);
      expect(result[baseOptions.baselineWindow].isAnomaly).toBe(true);
      expect(result[baseOptions.baselineWindow].score).toBeGreaterThanOrEqual(baseOptions.sensitivity);
    }
  );

  it('drops non-finite input points before they can poison later scores', () => {
    const points = [1, 2, 3, 4, 5].map((value, index) => buildRawPoint(index + 1, value));
    points.splice(2, 0, buildRawPoint(2.5, Number.NaN));
    points.push(buildRawPoint(Number.POSITIVE_INFINITY, 6));

    const result = analyzePoints(points, { ...baseOptions, algorithm: 'mad', baselineWindow: 3 });

    expect(result.map((point) => point.time)).toEqual([1, 2, 3, 4, 5]);
    expect(result.every((point) => Number.isFinite(point.score))).toBe(true);
    expect(result.every((point) => point.expected === null || Number.isFinite(point.expected))).toBe(true);
  });

  it('caps operational raw scores without changing a zero-baseline anomaly decision', () => {
    const points = [...Array.from({ length: 12 }, (_, index) => buildRawPoint(index, 0)), buildRawPoint(12, 100)];

    const result = analyzePoints(points, { ...baseOptions, algorithm: 'mad' });
    const spike = result[result.length - 1];

    expect(spike.isAnomaly).toBe(true);
    expect(spike.severityScore).toBe(100);
    expect(spike.score).toBe(MAX_RAW_SCORE);
    expect(spike.pointScore).toBe(MAX_RAW_SCORE);
  });

  it('classifies flat and irregularly sampled histories without treating regular cadence as gappy', () => {
    const flat = Array.from({ length: 8 }, (_, index) => buildRawPoint(index * 60_000, 0));
    const irregularTimes = [0, 60, 120, 240, 300, 420, 480, 600];
    const irregular = irregularTimes.map((seconds, index) => buildRawPoint(seconds * 1000, 100 + index));
    const regular = Array.from({ length: 8 }, (_, index) => buildRawPoint(index * 60_000, 100 + index));

    expect(analyzePoints(flat, { ...baseOptions, baselineWindow: 6 }).at(-1)?.dataQualityLabel).toBe('flatline');
    expect(analyzePoints(irregular, { ...baseOptions, baselineWindow: 6 }).at(-1)?.dataQualityLabel).toBe('gappy');
    expect(analyzePoints(regular, { ...baseOptions, baselineWindow: 6 }).at(-1)?.dataQualityLabel).toBe('healthy');
  });

  it('keeps a non-negative chart domain for non-negative metrics while preserving signed metrics', () => {
    expect(resolveValueDomain([-25, 10, 20], [10, 20]).min).toBe(0);
    expect(resolveValueDomain([-25, 10, 20], [-5, 20]).min).toBeLessThan(0);
  });
});
