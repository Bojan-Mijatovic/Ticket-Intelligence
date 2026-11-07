import { expect, test } from '@playwright/test';
import { addDrug, itemRow, pickPatient } from '../support/farma';
import { mockApi } from '../support/mock-api';

test('prescrizioni: newest first, dates as dd/MM/yyyy, filter by status', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/prescrizioni');

  const rows = page.locator('#prescriptions-table tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('RX-2026-00036');
  await expect(rows.first()).toContainText('06/11/2026 08:50');

  await page.locator('#status-filter').selectOption({ label: 'Emessa' });
  await expect.poll(() => api.prescriptionListRequests.at(-1)).toBe('EMESSA');
  await expect(rows).toHaveCount(3);
});

test('nuova prescrizione: a renal warning (eGFR 28) must be acknowledged before EMETTI', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/prescrizioni/nuova');

  await pickPatient(page, 'mari', 'Marino Paolo');
  await page.locator('#prescriber').fill('Dr. Paolo Brambilla');
  await addDrug(page, 'metf', 'Metformina');

  await expect(page.locator('#egfr')).toHaveText('28');
  await expect(page.locator('#warnings-panel')).toContainText('controindicato sotto 30');
  await expect(page.locator('#issue-prescription')).toBeDisabled();
  await page.locator('#acknowledge').check();
  await page.locator('#issue-prescription').click();

  await expect(page.locator('#prescription-issued')).toContainText('RX-2026-00100');
  expect(api.prescriptionWrites[0]).toMatchObject({ patientId: 9, acknowledgeWarnings: true, items: [{ aic: '012345016', packs: 1 }] });
});

test('nuova prescrizione: removing a drug removes that drug and its warnings', async ({ page }) => {
  await mockApi(page);
  await page.goto('/prescrizioni/nuova');

  await pickPatient(page, 'ross', 'Rossi Mario');
  await addDrug(page, 'warf', 'Warfarin');
  await addDrug(page, 'ibup', 'Ibuprofene');
  await addDrug(page, 'para', 'Paracetamolo');
  await expect(page.locator('#warnings-panel')).toContainText('Rischio emorragico');

  await itemRow(page, 'Ibuprofene').getByRole('button', { name: 'Rimuovi' }).click();
  await expect(page.locator('#items-table tbody tr')).toHaveCount(2);
  await expect(itemRow(page, 'Ibuprofene')).toHaveCount(0);
  await expect(itemRow(page, 'Warfarin')).toHaveCount(1);
  await expect(page.locator('#no-warnings')).toBeVisible();
});
