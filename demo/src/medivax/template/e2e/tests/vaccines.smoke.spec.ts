import { expect, test } from '@playwright/test';
import { mockApi } from '../support/mock-api';

test('vaccini: the catalog with interval, age range and booster', async ({ page }) => {
  await mockApi(page);
  await page.goto('/vaccini');
  const row = (code: string) => page.locator(`#vaccines-table tr[data-vaccine="${code}"]`);
  await expect(row('ESA')).toContainText('60 giorni');
  await expect(row('ESA')).toContainText('da 2 mesi a 6 anni');
  await expect(row('HPV')).toContainText('da 11 anni a 26 anni');
  await expect(row('INFL')).toContainText('da 6 mesi');
  await expect(row('INFL')).toContainText('ogni anno');
  await expect(row('TDAP')).toContainText('ogni 10 anni');
  await expect(row('PCV').locator('td').nth(5)).toHaveText('no');
});
