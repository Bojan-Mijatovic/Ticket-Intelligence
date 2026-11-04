import { expect, type Page } from '@playwright/test';

// Page helpers for the Agenda search mask (/agenda).

export const structureInput = (page: Page) => page.locator('#structure-input');

/** Types a query in the Struttura field and picks the structure with the given id from the suggestions. */
export async function pickStructure(page: Page, query: string, id: string): Promise<void> {
  await structureInput(page).pressSequentially(query, { delay: 30 });
  const option = page.locator('.suggestions li', { hasText: id });
  await expect(option).toBeVisible();
  await option.dispatchEvent('mousedown');
  await expect(structureInput(page)).toHaveValue(id);
}

/** Empties the Struttura field with the keyboard (select all + Backspace), as an operator would. */
export async function clearStructureWithKeyboard(page: Page): Promise<void> {
  await structureInput(page).click();
  await structureInput(page).press('Control+A');
  await structureInput(page).press('Backspace');
  await expect(structureInput(page)).toHaveValue('');
}

/** Codes shown in the "Risorse" list. */
export async function resourceCodes(page: Page): Promise<string[]> {
  return page.locator('app-resources-list tbody tr td:nth-child(2)').allInnerTexts();
}
