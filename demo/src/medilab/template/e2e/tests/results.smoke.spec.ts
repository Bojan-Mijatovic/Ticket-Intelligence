import { expect, test } from '@playwright/test';
import { typeResult } from '../support/lab';
import { mockApi } from '../support/mock-api';

test('risultati: values are saved and flagged with the range of the patient\'s sex', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/richieste/RL-2026-00058/risultati');

  // Ferrari Giulia (F): ALT 38 is above the female range (≤ 33).
  await expect(page.locator('#results-table')).toContainText('ALT (GPT)');
  await typeResult(page, 'ALT', '38');
  await typeResult(page, 'GLU', '88');
  await page.locator('#save-results').click();

  await expect(page.locator('#result-message')).toContainText('Risultati salvati');
  await expect(page.locator('#results-table tbody tr', { hasText: 'ALT' }).locator('.flag')).toHaveText('H');
  expect(api.resultWrites[0].entries).toEqual(expect.arrayContaining([{ examCode: 'ALT', value: 38 }, { examCode: 'GLU', value: 88 }]));
});

test('risultati: Enter moves to the next value, and validation opens the report', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/richieste/RL-2026-00060/risultati');

  // Rows: SANGUE first (HB), then SIERO (CREA, K, NA).
  await typeResult(page, 'HB', '14');
  await page.locator('#value-HB').press('Enter');
  await expect(page.locator('#value-CREA')).toBeFocused();
  await typeResult(page, 'CREA', '1');
  await typeResult(page, 'K', '4');
  await typeResult(page, 'NA', '140');
  await page.locator('#save-results').click();
  await expect(page.locator('#result-message')).toContainText('Risultati salvati');
  await page.locator('#validate-results').click();

  await expect(page).toHaveURL(/\/referti\/RL-2026-00060$/);
  await expect(page.locator('#report-table')).toContainText('Emoglobina');
  expect(api.validations).toEqual([{ orderId: 'RL-2026-00060', validatedBy: 'Dr.ssa Anna Ferri' }]);
});

test('referto: values in the Italian format with the decimals of the test', async ({ page }) => {
  await mockApi(page);
  await page.goto('/referti/RL-2026-00052');

  const crea = page.locator('#report-table tbody tr', { hasText: 'Creatinina' });
  await expect(crea).toContainText('2,50');
  await expect(crea).toContainText('mg/dL');
  await expect(crea).toContainText('0,70 – 1,20');
  await expect(crea.locator('.flag')).toHaveText('H');
});
