import { expect, test } from '@playwright/test';
import { pickPatient, receiptRow } from '../support/bill';
import { mockApi } from '../support/mock-api';

test('ricevute: amounts in euro with two decimals, PAGA an issued receipt', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/ricevute');

  const verdi = receiptRow(page, 'RC-2026-00041');
  await expect(verdi.locator('.copay')).toHaveText('15,49 €');
  await expect(receiptRow(page, 'RC-2026-00038').locator('.copay')).toHaveText('22,50 €');
  await verdi.getByRole('button', { name: 'PAGA' }).click();

  await expect(page.locator('#receipt-message')).toContainText('RC-2026-00041 pagata: 15,49 €');
  await expect(receiptRow(page, 'RC-2026-00041')).toContainText('Pagata');
  expect(api.receiptActions).toEqual([{ id: 'RC-2026-00041', action: 'pay' }]);
});

test('ricevute: STORNA an issued receipt opens its charges again', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/ricevute');

  await receiptRow(page, 'RC-2026-00041').getByRole('button', { name: 'STORNA' }).click();
  await expect(page.locator('#receipt-message')).toContainText('RC-2026-00041 stornata');
  await expect(receiptRow(page, 'RC-2026-00041').getByRole('button', { name: 'STORNA' })).toHaveCount(0);
  expect(api.receiptActions).toEqual([{ id: 'RC-2026-00041', action: 'storno' }]);
});

test('esenzioni: a new exemption for a MediAgenda patient', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/esenzioni');

  await expect(page.locator('#exemptions-table tbody tr', { hasText: 'Bianchi Laura' })).toContainText('scaduta');
  await pickPatient(page, 'ricc', 'Ricci Francesca');
  await page.locator('#exemption-code').selectOption('013');
  await page.locator('#valid-from').fill('2026-11-01');
  await page.locator('#valid-to').fill('2027-10-31');
  await page.locator('#save-exemption').click();

  await expect(page.locator('#exemption-message')).toContainText('Esenzione 013 registrata per Ricci Francesca');
  expect(api.exemptionWrites).toEqual([{ patientId: 10, code: '013', validFrom: '2026-11-01', validTo: '2027-10-31' }]);
});

test('report incassi: October without the cancelled receipt', async ({ page }) => {
  const api = await mockApi(page);
  await page.clock.setFixedTime(new Date('2026-11-07T10:00:00'));
  await page.goto('/report');

  await expect(page.locator('#month-label')).toHaveText('novembre 2026');
  await page.locator('#prev-month').click();
  await expect(page.locator('#month-label')).toHaveText('ottobre 2026');
  await expect(page.locator('#report-receipts')).toHaveText('2');
  await expect(page.locator('#report-collected')).toHaveText('22,50 €');
  expect(api.reportRequests).toEqual(['2026-11', '2026-10']);
});
