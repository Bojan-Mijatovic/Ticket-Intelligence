import { expect, test } from '@playwright/test';
import { mockApi } from '../support/mock-api';

test('magazzino: expired lots do not count, low stock is flagged', async ({ page }) => {
  await mockApi(page);
  await page.goto('/magazzino');

  const metformina = page.locator('#stock-table tbody tr', { hasText: 'Metformina' });
  await expect(metformina).toContainText('L-MF2601');
  await expect(metformina).toContainText('SCADUTO');
  await expect(metformina.locator('td').nth(1)).toHaveText('40');
  await expect(page.locator('#stock-table tbody tr', { hasText: 'Amoxicillina' })).toContainText('SOTTO SCORTA');
});

test('magazzino: only the lots that expire within 60 days', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/magazzino');

  await page.locator('#only-expiring').check();
  await expect.poll(() => api.expiringRequests).toEqual([60]);
  await expect(page.locator('#stock-table tbody tr', { hasText: 'Atorvastatina' })).toHaveCount(0);
  await expect(page.locator('#stock-table tbody tr', { hasText: 'Enoxaparina' })).toContainText('L-EN2603');
});
