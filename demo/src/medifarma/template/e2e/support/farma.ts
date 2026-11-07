import { expect, type Page } from '@playwright/test';

// Helpers for the MediFarma screens.

/** Types in the patient field of "Nuova prescrizione" and picks the suggestion that contains `name`. */
export async function pickPatient(page: Page, query: string, name: string): Promise<void> {
  await page.locator('#patient-search').pressSequentially(query, { delay: 30 });
  await page.locator('.patient-suggestions li', { hasText: name }).dispatchEvent('mousedown');
  await expect(page.locator('#patient-picked')).toContainText(name);
}

/** Adds a drug to the prescription: types in "Aggiungi farmaco" and picks the suggestion that contains `name`. */
export async function addDrug(page: Page, query: string, name: string): Promise<void> {
  await page.locator('#drug-search').pressSequentially(query, { delay: 30 });
  await page.locator('.drug-suggestions li', { hasText: name }).dispatchEvent('mousedown');
  await expect(page.locator('#items-table tbody tr', { hasText: name })).toHaveCount(1);
}

/** The row of a drug in the prescription being written. */
export function itemRow(page: Page, name: string) {
  return page.locator('#items-table tbody tr', { hasText: name });
}
