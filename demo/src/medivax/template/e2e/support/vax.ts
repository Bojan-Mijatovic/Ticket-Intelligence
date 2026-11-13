import { expect, type Locator, type Page } from '@playwright/test';

// Screen helpers for the MediVax pages.

/** Types a search on Pazienti and waits for the result list (or "no patients"). */
export async function searchPatient(page: Page, query: string): Promise<void> {
  await page.goto('/pazienti');
  await page.locator('#patient-query').fill(query);
  await expect(page.locator('#patients-table, #no-patients')).toBeVisible();
}

/** The row of a patient in the search results, by id. */
export function patientRow(page: Page, id: number): Locator {
  return page.locator(`#patients-table tr[data-patient-id="${id}"]`);
}

/** Opens the vaccination card of a patient and waits for the name. */
export async function openCard(page: Page, id: number): Promise<void> {
  await page.goto(`/pazienti/${id}`);
  await expect(page.locator('#patient-name')).toBeVisible();
}

/** Fills the "Registra una dose" form and presses REGISTRA. */
export async function recordDose(page: Page, vaccineCode: string, lotCode: string, givenOn: string): Promise<void> {
  await page.locator('#dose-vaccine').selectOption(vaccineCode);
  await expect(page.locator(`#dose-lot option[value="${lotCode}"]`)).toHaveCount(1);
  await page.locator('#dose-lot').selectOption(lotCode);
  await page.locator('#dose-date').fill(givenOn);
  await page.locator('#record-dose').click();
  await expect(page.locator('#dose-message, #dose-errors')).toBeVisible();
}

/** Shows the Scadenze week of `day` ("yyyy-MM-dd") and waits for its list. */
export async function dueWeekOf(page: Page, day: string): Promise<void> {
  await page.goto('/scadenze');
  await page.locator('#due-day').fill(day);
  await expect(page.locator('#due-table, #no-due')).toBeVisible();
}

/** Whole years from a birth date to today, as the centre counts them (for checks that do not go stale). */
export function ageToday(birthDate: string): number {
  const now = new Date();
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
