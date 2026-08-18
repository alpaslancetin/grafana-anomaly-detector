import { analyzePoints, buildRawPoint, RawPoint, ScoringOptions } from '../grafana-anomaly-detector-panel/src/scoring';
import { readFileSync } from 'fs';

interface InputCase {
  name: string;
  points: Array<{ timestamp: number; value: number }>;
  options: ScoringOptions;
}

interface InputPayload {
  cases: InputCase[];
}

const toRawPoints = (points: InputCase['points']): RawPoint[] =>
  points.map((point) => buildRawPoint(point.timestamp * 1000, point.value));

const main = () => {
  const payload = JSON.parse(readFileSync(0, 'utf8')) as InputPayload;
  const result = payload.cases.map((item) => ({
    name: item.name,
    points: analyzePoints(toRawPoints(item.points), item.options).map((point) => ({
      timestamp: point.time / 1000,
      value: point.value,
      expected: point.expected,
      lower: point.lower,
      upper: point.upper,
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
    })),
  }));
  process.stdout.write(JSON.stringify(result));
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
