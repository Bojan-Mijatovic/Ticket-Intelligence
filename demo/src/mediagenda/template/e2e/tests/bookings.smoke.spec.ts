import { expect, test } from '@playwright/test';
import { pickStructure } from '../support/agenda';
import { nextWeekday } from '../support/forms';
import { mockApi } from '../support/mock-api';

test('prenotazioni: the list shows patient and agenda, and filters confirmed bookings', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/prenotazioni');

  const rows = page.locator('#bookings-table tbody tr');
  await expect(rows).toHaveCount(7);
  await expect(rows.filter({ hasText: 'PR-2026-00570' })).toContainText('Romano Luca');

  await page.locator('#status-filter').selectOption({ label: 'Confermate' });
  await expect.poll(() => api.bookingListRequests.at(-1)).toBe('CONFERMATA');
  await expect(rows).toHaveCount(3);
});

test('prenotazioni: a confirmed booking is cancelled with a reason', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/prenotazioni');

  await page.locator('#bookings-table tbody tr', { hasText: 'PR-2026-00570' }).getByRole('button', { name: 'Annulla' }).click();
  await page.locator('#cancel-reason').selectOption('Richiesta del paziente');
  await page.locator('#confirm-cancel').click();

  await expect(page.locator('#booking-message')).toContainText('PR-2026-00570 annullata');
  expect(api.cancellations).toEqual([{ id: 'PR-2026-00570', reason: 'Richiesta del paziente' }]);
});

test('nuova prenotazione: patient, provider, day and a free time', async ({ page }) => {
  const api = await mockApi(page);
  const tuesday = nextWeekday(2);
  await page.goto('/prenotazioni/nuova');

  await page.locator('#patient-search').pressSequentially('ross', { delay: 30 });
  await page.locator('.patient-suggestions li', { hasText: 'Rossi' }).dispatchEvent('mousedown');
  await expect(page.locator('#patient-picked')).toContainText('Rossi Mario');

  await pickStructure(page, 'CA_P', 'CA_PRESIDIO');
  await page.locator('#resource-select').selectOption('CA_CARDIOLOGIA');
  await page.locator('#booking-date').fill(tuesday);
  await page.locator('#free-times button', { hasText: '13:30' }).click();
  await page.locator('#priority-select').selectOption('B');
  await page.locator('#nre-input').fill('0301a4000998877');
  await page.locator('#confirm-booking').click();

  await expect(page.locator('#booking-created')).toContainText('PR-');
  expect(api.bookingWrites[0]).toMatchObject({
    patientId: 1,
    timeSlotId: 143278,
    appointmentAt: `${tuesday}T13:30:00`,
    priority: 'B',
    prescriptionCode: '0301A4000998877',
  });
});
