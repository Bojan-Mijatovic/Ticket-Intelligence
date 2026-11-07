import { expect, test } from '@playwright/test';
import { importDay, patientCharges } from '../support/bill';
import { mockApi } from '../support/mock-api';

test('addebiti: the import of a day charges the visits at the tariff of the provider', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/addebiti');

  await importDay(page, '2026-11-05');
  await expect(page.locator('#import-result')).toContainText('2 visite, 0 analisi importate');
  await expect(page.locator('#import-result')).toContainText('MS_ALLERGOLOGIA');
  await expect(patientCharges(page, 'FNTCHR88R55G273T')).toContainText('45,00 €');
  expect(api.imports).toEqual(['2026-11-05']);

  await importDay(page, '2026-11-05');
  await expect(page.locator('#import-result')).toContainText('2 già presenti');
});

test('addebiti: the tests reported in MediLab, and a receipt with a disease exemption', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/addebiti');

  await importDay(page, '2026-11-03');
  await expect(page.locator('#import-result')).toContainText('0 visite, 5 analisi importate');
  await patientCharges(page, 'MRNPLA61S03C351V').getByRole('button', { name: 'EMETTI RICEVUTA' }).click();

  await expect(page.locator('#charges-message')).toContainText('ticket 3,39 €');
  expect(api.receiptRequests).toEqual(['MRNPLA61S03C351V']);
  await expect(patientCharges(page, 'MRNPLA61S03C351V')).toHaveCount(0);
});

test('addebiti: Ieri is the local yesterday', async ({ page }) => {
  await mockApi(page);
  await page.goto('/addebiti');

  await page.locator('#today').click();
  const today = await page.locator('#import-date').inputValue();
  await page.locator('#yesterday').click();
  const yesterday = await page.locator('#import-date').inputValue();
  expect(Date.parse(`${today}T12:00:00`) - Date.parse(`${yesterday}T12:00:00`)).toBe(86_400_000);
});
