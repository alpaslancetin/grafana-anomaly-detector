import { expect, test } from '@playwright/test';
import { cleanupIncidentFixture, installIncidentFixture } from './incident_fixture';

test.setTimeout(90000);
test.afterEach(async ({ page }) => cleanupIncidentFixture(page));

test('invalid saved direction warns visibly and continues detecting without saving a dashboard', async ({ page }, testInfo) => {
  const fixtureFrames = await installIncidentFixture(page);
  let modifiedDashboard = false;
  await page.route(/\/(?:api\/dashboards\/uid\/plugin-source-matrix|apis\/dashboard\.grafana\.app\/.*\/dashboards\/plugin-source-matrix\/dto)(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    const dashboard = payload.dashboard ?? payload.spec;
    for (const panel of dashboard.panels) {
      panel.options.scoreFeedMode = 'off';
      if (panel.id === 2) {
        panel.options.setupMode = 'advanced';
        panel.options.anomalyDirection = 'upper';
      }
    }
    modifiedDashboard = true;
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/d/plugin-source-matrix/grafana-anomaly-plugin-source-matrix?orgId=1&from=now-30m&to=now&viewPanel=2');
  await expect(page.getByRole('img', { name: 'Anomaly chart', exact: true })).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: testInfo.outputPath('direction-warning.png'), fullPage: true });
  const warning = page.getByRole('status').filter({ hasText: 'Unsupported anomaly direction.' });
  await expect(warning).toBeVisible({ timeout: 60000 });
  expect(modifiedDashboard).toBe(true);
  await expect(warning).toContainText('Using high_or_low');
  await expect(page.getByRole('button', { name: /Detected incident / }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Anomaly chart', exact: true })).toBeVisible();
  expect(fixtureFrames()).toBeGreaterThan(0);
});
