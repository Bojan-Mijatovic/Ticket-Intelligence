import { expect, test } from '@playwright/test';
import { pickPatient } from '../support/lab';
import { mockApi } from '../support/mock-api';

test('richieste: the list shows every request, newest first, and filters by status', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/richieste');

  const rows = page.locator('#orders-table tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText('RL-2026-00062');
  expect(api.orderListRequests[0]).toEqual({ status: '', q: '' });

  await page.locator('#status-filter').selectOption({ label: 'In lavorazione' });
  await expect.poll(() => api.orderListRequests.at(-1)?.status).toBe('IN_LAVORAZIONE');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'RL-2026-00060' })).toContainText('URGENTE');
});

test('nuova richiesta: a MediAgenda patient, a profile and an urgent priority', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/richieste/nuova');

  await pickPatient(page, 'mari', 'Marino Paolo');
  await page.locator('#prescriber').fill('Dr. Paolo Brambilla');
  await page.locator('#nre').fill('0301a4000771122');
  await page.locator('#urgent').check();
  await page.getByRole('button', { name: '+ Profilo renale' }).click();
  await page.locator('#exam-HB').check();
  await page.locator('#confirm-order').click();

  await expect(page.locator('#order-created')).toContainText('RL-2026-00100');
  await expect(page.locator('#order-created')).toContainText('(siero)');
  await expect(page.locator('#order-created')).toContainText('(sangue)');
  expect(api.orderWrites[0]).toMatchObject({ patientId: 9, prescriber: 'Dr. Paolo Brambilla', prescriptionCode: '0301A4000771122', urgent: true, examCodes: ['CREA', 'UREA', 'NA', 'K', 'HB'] });
});

test('nuova richiesta: editing the patient name after picking forgets the patient', async ({ page }) => {
  await mockApi(page);
  await page.goto('/richieste/nuova');

  await pickPatient(page, 'ross', 'Rossi Mario');
  await page.locator('#patient-search').press('Backspace');
  await expect(page.locator('#patient-picked')).toHaveCount(0);
});

test('richieste: a request waiting for its tubes is cancelled with a reason', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/richieste');

  await page.locator('#orders-table tbody tr', { hasText: 'RL-2026-00061' }).getByRole('button', { name: 'Annulla' }).click();
  await page.locator('#cancel-reason').fill('Paziente non presentato');
  await page.locator('#confirm-cancel').click();

  await expect(page.locator('#order-message')).toContainText('RL-2026-00061 annullata');
  expect(api.cancellations).toEqual([{ id: 'RL-2026-00061', reason: 'Paziente non presentato' }]);
});
