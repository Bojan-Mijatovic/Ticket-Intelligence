import { expect, test } from '@playwright/test';
import { mockApi } from '../support/mock-api';
import { ageToday, patientRow, searchPatient } from '../support/vax';

test('pazienti: a surname finds the patients, with birth date, age and sex', async ({ page }) => {
  const api = await mockApi(page);
  await searchPatient(page, 'ricci');
  await expect(page.locator('#patients-table tbody tr')).toHaveCount(3);
  const sara = patientRow(page, 6);
  await expect(sara).toContainText('Ricci Sara');
  await expect(sara).toContainText('19/08/1943');
  await expect(sara.locator('td').nth(3)).toHaveText(String(ageToday('1943-08-19')));
  await expect(sara).toContainText('Femmina');
  expect(api.searches.at(-1)).toBe('ricci');
});

test('pazienti: a fiscal code finds its patient, one character finds nothing', async ({ page }) => {
  await mockApi(page);
  await searchPatient(page, 'RCCLCU');
  await expect(page.locator('#patients-table tbody tr')).toHaveCount(1);
  await expect(patientRow(page, 7)).toContainText('Ricci Luca');
  await page.locator('#patient-query').fill('R');
  await expect(page.locator('#patients-table')).toHaveCount(0);
});

test('pazienti: the name opens the vaccination card', async ({ page }) => {
  await mockApi(page);
  await searchPatient(page, 'De Luca');
  await patientRow(page, 8).getByRole('link').click();
  await expect(page.locator('#patient-name')).toHaveText('De Luca Laura');
});
