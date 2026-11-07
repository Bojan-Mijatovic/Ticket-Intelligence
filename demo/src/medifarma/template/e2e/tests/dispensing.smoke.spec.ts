import { expect, test } from '@playwright/test';
import { mockApi } from '../support/mock-api';

test('erogazione: the lot that expires first is used', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/erogazione/RX-2026-00036');

  await expect(page.locator('#prescription-items')).toContainText('Enoxaparina');
  await page.locator('#dispense').click();

  await expect(page.locator('#dispensed')).toContainText('dal lotto L-EN2603');
  await expect(page.locator('#dispense')).toBeDisabled();
  expect(api.dispenseRequests).toEqual(['RX-2026-00036']);
});

test('erogazione: a double click sends one request', async ({ page }) => {
  const api = await mockApi(page, { slowDispense: 600 });
  await page.goto('/erogazione/RX-2026-00031');

  await page.locator('#dispense').dblclick();
  await expect(page.locator('#dispensed')).toContainText('Paracetamolo');
  expect(api.dispenseRequests).toEqual(['RX-2026-00031']);
});
