import { expect, type Page } from '@playwright/test';

// Helpers for the MediLab screens.

/** Types in the patient field of "Nuova richiesta" and picks the suggestion that contains `name`. */
export async function pickPatient(page: Page, query: string, name: string): Promise<void> {
  await page.locator('#patient-search').pressSequentially(query, { delay: 30 });
  await page.locator('.patient-suggestions li', { hasText: name }).dispatchEvent('mousedown');
  await expect(page.locator('#patient-picked')).toContainText(name);
}

/** Scans a tube at the acceptance desk: types the barcode and presses Enter (what a scanner does). */
export async function scanBarcode(page: Page, barcode: string): Promise<void> {
  await page.locator('#barcode').fill(barcode);
  await page.locator('#barcode').press('Enter');
}

/** Types a value in the result field of a test ("Inserimento risultati"), as the technician does. */
export async function typeResult(page: Page, examCode: string, text: string): Promise<void> {
  const field = page.locator(`#value-${examCode}`);
  await field.fill('');
  await field.pressSequentially(text, { delay: 20 });
}
