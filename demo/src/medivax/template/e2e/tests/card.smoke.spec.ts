import { expect, test } from '@playwright/test';
import { mockApi } from '../support/mock-api';
import { openCard, recordDose } from '../support/vax';

test('scheda paziente: the doses given and the next dose due', async ({ page }) => {
  await mockApi(page);
  await openCard(page, 8);
  await expect(page.locator('#patient-details')).toContainText('nato/a il 28/04/2026');
  await expect(page.locator('#doses-table tbody tr')).toHaveCount(2);
  const next = page.locator('#next-table tr[data-vaccine="ESA"]');
  await expect(next).toContainText('Dose 3');
  await expect(next).toContainText('20/11/2026');
});

test('scheda paziente: a dose on its day is recorded, and the next one moves on', async ({ page }) => {
  const api = await mockApi(page);
  await openCard(page, 14);
  await expect(page.locator('#next-table tr[data-vaccine="MPRV"]')).toContainText('04/11/2026');
  await recordDose(page, 'MPRV', 'MPRV-25C', '2026-11-04');
  await expect(page.locator('#dose-message')).toContainText('Dose 2 di MPRV registrata il 04/11/2026');
  expect(api.doseRequests.at(-1)).toEqual({ patientId: 14, vaccineCode: 'MPRV', givenOn: '2026-11-04', lotCode: 'MPRV-25C' });
  await expect(page.locator('#doses-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#no-next')).toBeVisible();
});

test('scheda paziente: a dose before its interval is refused with the first possible day', async ({ page }) => {
  await mockApi(page);
  await openCard(page, 8);
  await recordDose(page, 'ESA', 'ESA-25B', '2026-11-19');
  await expect(page.locator('#dose-errors')).toContainText('not before 20/11/2026');
});
