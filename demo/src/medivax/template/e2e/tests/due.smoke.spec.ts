import { expect, test } from '@playwright/test';
import { mockApi } from '../support/mock-api';
import { dueWeekOf } from '../support/vax';

test('scadenze: the doses due from Monday to Sunday of the week', async ({ page }) => {
  const api = await mockApi(page);
  await dueWeekOf(page, '2026-11-18');
  await expect(page.locator('#due-range')).toHaveText('Dal 16/11/2026 al 22/11/2026');
  expect(api.dueRequests.at(-1)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  const laura = page.locator('#due-table tr[data-patient-id="8"]');
  await expect(laura).toContainText('20/11/2026');
  await expect(laura).toContainText('Dose 3');
  await expect(page.locator('#due-table tr[data-patient-id="6"]')).toContainText('Richiamo');
});

test('scadenze: the next week', async ({ page }) => {
  const api = await mockApi(page);
  await dueWeekOf(page, '2026-11-18');
  await page.locator('#next-week').click();
  await expect(page.locator('#due-range')).toHaveText('Dal 23/11/2026 al 29/11/2026');
  expect(api.dueRequests.at(-1)).toEqual({ from: '2026-11-23', to: '2026-11-29' });
});
