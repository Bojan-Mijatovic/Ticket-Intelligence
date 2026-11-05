import { expect, test } from '@playwright/test';
import { mockApi } from '../support/mock-api';

test('pazienti: the list is sorted by last name and links to each record', async ({ page }) => {
  await mockApi(page);
  await page.goto('/pazienti');

  await expect(page.locator('table tbody tr').first()).toContainText('Bianchi');
  await page.locator('table tbody tr', { hasText: 'Rossi' }).getByText('Modifica').click();
  await expect(page.locator('#last-name')).toHaveValue('Rossi');
});

test('pazienti: a new patient is saved with an upper-case fiscal code', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/pazienti');

  await page.locator('#new-patient').click();
  await page.locator('#fiscal-code').fill('nrianb91h54f205u');
  await page.locator('#last-name').fill('Neri');
  await page.locator('#first-name').fill('Anna');
  await page.locator('#sex-f').check();
  await page.locator('#birth-date').fill('14/06/1991');
  await page.locator('#save-patient').click();

  await expect(page.locator('#patient-saved')).toContainText('Neri Anna');
  expect(api.patientWrites[0]).toMatchObject({ method: 'POST', body: { fiscalCode: 'NRIANB91H54F205U', lastName: 'Neri', firstName: 'Anna', sex: 'F' } });
});

test('pazienti: a fiscal code that is already registered is reported', async ({ page }) => {
  await mockApi(page);
  await page.goto('/pazienti/nuovo');

  await page.locator('#fiscal-code').fill('RSSMRA80A01F205X');
  await page.locator('#last-name').fill('Rossi');
  await page.locator('#first-name').fill('Mario');
  await page.locator('#sex-m').check();
  await page.locator('#birth-date').fill('01/01/1980');
  await page.locator('#save-patient').click();

  await expect(page.locator('#patient-errors')).toContainText('Codice fiscale già presente');
});
