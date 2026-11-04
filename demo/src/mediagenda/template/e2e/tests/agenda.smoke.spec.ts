import { expect, test } from '@playwright/test';
import { pickStructure, resourceCodes } from '../support/agenda';
import { mockApi } from '../support/mock-api';

test('agenda: picking a structure shows its providers and time slots', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/agenda');

  await pickStructure(page, 'TEST', 'TEST_GEN_25');

  await expect.poll(() => api.timeSlotRequests.at(-1)).toEqual(['TEST_GEN_25']);
  await expect.poll(() => resourceCodes(page)).toEqual(['TG_LABORATORIO', 'TG_RADIOLOGIA']);
});
