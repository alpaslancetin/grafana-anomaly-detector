import type { Page } from '@playwright/test';

const createdAnnotations = new WeakMap<Page, number[]>();

export async function cleanupIncidentFixture(page: Page) {
  await page.unrouteAll({ behavior: 'wait' });
  for (const id of createdAnnotations.get(page) ?? []) {
    const response = await page.request.delete(`/api/annotations/${id}`);
    if (!response.ok()) {
      throw new Error(`Could not remove test annotation ${id}: HTTP ${response.status()}`);
    }
  }
  createdAnnotations.delete(page);
}

// Deterministic incident data for UI-action tests only. Backend requests still
// execute, errors remain errors, and no source data or dashboard is rewritten.
export async function installIncidentFixture(page: Page) {
  let modifiedFrames = 0;
  const annotationIds: number[] = [];
  createdAnnotations.set(page, annotationIds);
  await page.route('**/api/annotations', async (route) => {
    const response = await route.fetch();
    if (route.request().method() === 'POST' && response.ok()) {
      const payload = await response.json();
      if (Number.isInteger(payload.id)) {
        annotationIds.push(payload.id);
      }
    }
    await route.fulfill({ response });
  });
  await page.route('**/api/ds/query*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const payload = await response.json();
    for (const result of Object.values(payload.results ?? {}) as any[]) {
      if (result.error) {
        continue;
      }
      for (const frame of result.frames ?? []) {
        const fields = frame.schema?.fields ?? [];
        const timeIndex = fields.findIndex((field: any) => field.type === 'time');
        const times = frame.data?.values?.[timeIndex];
        if (!Array.isArray(times) || times.length === 0 || !fields.some((field: any) => field.type === 'number')) {
          continue;
        }
        // Some backends return sparse, tag-split frames. Give each existing
        // time series enough fixture history without inventing missing frames.
        const end = Number(times.at(-1));
        const start = Math.min(Number(times[0]), end - 30 * 60 * 1000);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          continue;
        }
        const count = 180;
        frame.data.values = fields.map((field: any, index: number) =>
          Array.from({ length: count }, (_, i) => field.type === 'time'
            ? Math.round(start + i * (end - start) / (count - 1))
            : field.type === 'number'
              ? 100 + Math.sin(i / 3) + (i >= 110 && i < 118 ? 60 : 0)
              : frame.data.values[index]?.[0] ?? null)
        );
        modifiedFrames++;
      }
    }
    await route.fulfill({ response, json: payload });
  });
  return () => modifiedFrames;
}
