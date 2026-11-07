import { expect, type Page } from '@playwright/test';

// Helpers for the MediBill screens.

/** Imports a day on the Addebiti page ("yyyy-MM-dd") and waits for the summary. */
export async function importDay(page: Page, day: string): Promise<void> {
  await page.locator('#import-date').fill(day);
  await page.locator('#import').click();
  await expect(page.locator('#import-result')).toBeVisible();
}

/** The block of open charges of a patient on the Addebiti page. */
export function patientCharges(page: Page, fiscalCode: string) {
  return page.locator(`[data-patient="${fiscalCode}"]`);
}

/** The row of a receipt on the Ricevute page. */
export function receiptRow(page: Page, id: string) {
  return page.locator(`#receipts-table tr[data-receipt="${id}"]`);
}

/** Types in the patient field of Esenzioni and picks the suggestion that contains `name`. */
export async function pickPatient(page: Page, query: string, name: string): Promise<void> {
  await page.locator('#patient-search').pressSequentially(query, { delay: 30 });
  await page.locator('.patient-suggestions li', { hasText: name }).dispatchEvent('mousedown');
  await expect(page.locator('#patient-picked')).toContainText(name);
}
