import { expect, test } from '@playwright/test';
import { scanBarcode } from '../support/lab';
import { mockApi } from '../support/mock-api';

test('campioni: accepting the last waiting tube puts the request in work', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/campioni');

  await scanBarcode(page, 'LB00000850');
  await expect(page.locator('#sample-card')).toContainText('Verdi Giuseppe');
  await expect(page.locator('#sample-card')).toContainText('CHOL, GLU, URIC');
  await page.locator('#accept-sample').click();

  await expect(page.locator('#sample-message')).toContainText('LB00000850 accettato · richiesta RL-2026-00061 in lavorazione');
  await expect(page.locator('#barcode')).toHaveValue('');
  expect(api.sampleActions).toEqual([{ barcode: 'LB00000850', action: 'accept' }]);
});

test('campioni: a barcode typed in lower case is found', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/campioni');

  await scanBarcode(page, 'lb00000855');
  await expect(page.locator('#sample-card')).toContainText('LB00000855');
  expect(api.sampleLookups).toEqual(['LB00000855']);
});

test('campioni: a rejected tube gets a new barcode', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/campioni');

  await scanBarcode(page, 'LB00000856');
  await page.locator('#reject-reason').selectOption('Emolizzato');
  await page.locator('#reject-sample').click();

  await expect(page.locator('#sample-message')).toContainText('LB00000856 rifiutato (Emolizzato) · nuova provetta LB00001000');
  expect(api.sampleActions).toEqual([{ barcode: 'LB00000856', action: 'reject', reason: 'Emolizzato' }]);
});
