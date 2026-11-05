import { expect, test } from '@playwright/test';
import { pickStructure } from '../support/agenda';
import { mockApi } from '../support/mock-api';

test('fasce orarie: one slot is created per selected weekday', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/fasce-orarie');

  await pickStructure(page, 'TEST', 'TEST_GEN_25');
  await page.locator('#slot-resource').selectOption('TG_RADIOLOGIA');
  await page.locator('#agenda-name').fill('Ecografia');
  await page.locator('#day-1').check();
  await page.locator('#day-3').check();
  await page.locator('#start-time').fill('09:00');
  await page.locator('#end-time').fill('11:00');
  await page.locator('#end-date').fill('2027-06-30');
  await expect(page.locator('#slot-preview')).toContainText('09:00-11:00, ogni martedì e giovedì');
  await page.locator('#save-slots').click();

  await expect(page.locator('#slots-created')).toContainText('Create 2 fasce');
  expect(api.timeSlotWrites[0]).toMatchObject({ resourceCode: 'TG_RADIOLOGIA', weekdays: ['martedì', 'giovedì'], startTime: '09:00', endTime: '11:00', priority: 'P' });
});
