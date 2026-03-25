import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90000);

const dashboardPaths = {
  testData: '/d-solo/anomaly-detector-demo/provisioned-anomaly-detector-demo?orgId=1&panelId=1',
  multiMetric: '/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=1',
  singleMetric: '/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=2',
};

async function gotoSoloPanel(page: Page, path: string, title: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 60000 });
}

async function selectFirstAnomaly(page: Page) {
  const firstSummaryRow = page.getByRole('button').filter({ hasText: /anomaly/i }).first();
  await expect(firstSummaryRow).toBeVisible({ timeout: 60000 });
  await firstSummaryRow.click();
}

test('renders the provisioned TestData panel and exposes point-level analysis details', async ({ page }) => {
  await gotoSoloPanel(page, dashboardPaths.testData, 'Synthetic anomaly stream');

  await expect(page.getByText('Top anomalies', { exact: true })).toBeVisible();
  await expect(page.getByText('Selected anomaly', { exact: true })).toBeVisible();
  await expect(page.getByText('How it works', { exact: true })).toBeVisible();

  await selectFirstAnomaly(page);

  await expect(page.getByText('Actual', { exact: true })).toBeVisible();
  await expect(page.getByText('Expected', { exact: true })).toBeVisible();
  await expect(page.getByText('Deviation %', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy annotation JSON' })).toBeVisible();
});

test('renders the live multi-metric panel, syncs score-feed rules, and creates annotations', async ({ page }) => {
  await gotoSoloPanel(page, dashboardPaths.multiMetric, 'Prometheus latency anomaly (multi metric)');

  await expect(page.getByText('Prometheus score feed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync score feed' })).toBeVisible();

  await page.getByRole('button', { name: 'Sync score feed' }).click();
  await expect(page.getByText(/Synced \d+ alert-ready Prometheus score rule/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('grafana_anomaly_rule_score', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show score rules' })).toBeVisible();

  await page.getByRole('button', { name: 'Show score rules' }).click();
  await expect(page.getByText('Alert rule query', { exact: true })).toBeVisible();
  await expect(page.getByText(/grafana_anomaly_rule_score\{rule=/)).toBeVisible();

  await selectFirstAnomaly(page);

  await expect(page.getByText('Metric', { exact: true })).toBeVisible();
  await expect(page.getByText('Deviation', { exact: true })).toBeVisible();

  const createAnnotation = page.getByRole('button', { name: 'Create annotation' });
  await expect(createAnnotation).toBeEnabled();
  await createAnnotation.click();
  await expect(page.getByText('Created a Grafana annotation for the selected anomaly.')).toBeVisible({ timeout: 30000 });
});

test('renders the live single-metric panel and reveals alert export only when expanded', async ({ page }) => {
  await gotoSoloPanel(page, dashboardPaths.singleMetric, 'Prometheus request anomaly (single metric)');

  await expect(page.getByText('Top anomalies', { exact: true })).toBeVisible();
  await expect(page.getByText('Operational exports', { exact: true })).toBeVisible();
  await expect(page.getByText('Alert rule export', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync score feed' })).toBeVisible();

  await page.getByRole('button', { name: 'Sync score feed' }).click();
  await expect(page.getByText(/Synced \d+ alert-ready Prometheus score rule/)).toBeVisible({ timeout: 30000 });

  await selectFirstAnomaly(page);
  await expect(page.getByText('Expected range', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show exports' }).click();
  await expect(page.getByText('Alert rule export', { exact: true })).toBeVisible();
  await expect(page.getByText(/grafana_anomaly_rule_score\{rule=/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy query' })).toBeVisible();
});







