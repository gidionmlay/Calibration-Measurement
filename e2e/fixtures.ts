import { test as base, expect, type Page } from '@playwright/test';

/**
 * Common test helper functions and custom test fixture.
 */

export async function clearIndexedDB(page: Page) {
  if (page.url() === 'about:blank') {
    await page.goto('/');
  }
  await page.evaluate(async () => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('bicycle_calibration_db');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
}

export async function createNewSession(page: Page, courseLength = '1000') {
  await page.goto('/');
  const newBtn = page.getByRole('button', { name: /New session|Create your first session/i }).first();
  await expect(newBtn).toBeVisible({ timeout: 10000 });
  await newBtn.click();
  await expect(page.getByRole('heading', { name: /Session setup/i })).toBeVisible({ timeout: 5000 });

  if (courseLength) {
    const courseLengthInput = page.locator('#course-length');
    await courseLengthInput.fill(courseLength);
    await courseLengthInput.blur();
  }
}

export async function fillFourPreCalRides(
  page: Page,
  start = 10000,
  diff = 1000
) {
  // Ride 1
  await page.locator('#pre-ride-1-start').fill(String(start));
  await page.locator('#pre-ride-1-start').blur();
  await page.locator('#pre-ride-1-finish').fill(String(start + diff));
  await page.locator('#pre-ride-1-finish').blur();

  // Ride 2 (linked start is start + diff)
  await page.locator('#pre-ride-2-finish').fill(String(start + 2 * diff));
  await page.locator('#pre-ride-2-finish').blur();

  // Ride 3
  await page.locator('#pre-ride-3-finish').fill(String(start + 3 * diff));
  await page.locator('#pre-ride-3-finish').blur();

  // Ride 4
  await page.locator('#pre-ride-4-finish').fill(String(start + 4 * diff));
  await page.locator('#pre-ride-4-finish').blur();
}

export async function fillFourPostCalRides(
  page: Page,
  start = 50000,
  diff = 1002
) {
  // Ride 1
  await page.locator('#post-ride-1-start').fill(String(start));
  await page.locator('#post-ride-1-start').blur();
  await page.locator('#post-ride-1-finish').fill(String(start + diff));
  await page.locator('#post-ride-1-finish').blur();

  // Ride 2
  await page.locator('#post-ride-2-finish').fill(String(start + 2 * diff));
  await page.locator('#post-ride-2-finish').blur();

  // Ride 3
  await page.locator('#post-ride-3-finish').fill(String(start + 3 * diff));
  await page.locator('#post-ride-3-finish').blur();

  // Ride 4
  await page.locator('#post-ride-4-finish').fill(String(start + 4 * diff));
  await page.locator('#post-ride-4-finish').blur();
}

export async function navigateToStep(
  page: Page,
  stepLabel: string
) {
  const pattern = /session setup|setup/i.test(stepLabel)
    ? /setup/i
    : new RegExp(stepLabel, 'i');
  const stepButton = page.locator('nav[aria-label="Workflow steps"]').getByRole('button', { name: pattern }).first();
  await stepButton.click();
}

export const test = base.extend({
  cleanPage: async ({ page }, use) => {
    await clearIndexedDB(page);
    await use(page);
  },
});

export { expect };
