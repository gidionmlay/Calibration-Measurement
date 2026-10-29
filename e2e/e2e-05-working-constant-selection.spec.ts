import { test, expect, clearIndexedDB, createNewSession, fillFourPreCalRides, fillFourPostCalRides, navigateToStep } from './fixtures';

test.describe('E2E-05: Working-constant selection', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('dynamically updates course distance and basis across larger, average, and notConfigured rules', async ({ page }) => {
    await createNewSession(page);

    // 1. Complete Pre-calibration (WC = 1001.0000)
    await navigateToStep(page, 'Pre-calibration');
    await fillFourPreCalRides(page, 10000, 1000);

    // 2. Enter Distance readings (T = 10002 counts)
    await navigateToStep(page, 'Course distance');
    await page.locator('#distance-start').fill('20000');
    await page.locator('#distance-finish').fill('30002');
    await page.locator('#distance-finish').blur();

    // 3. Complete Post-calibration (WC = 1003.0020)
    await navigateToStep(page, 'Post-calibration');
    await fillFourPostCalRides(page, 50000, 1002);

    // 4. Test Rule: 'larger'
    await navigateToStep(page, 'Session setup');
    const finalRuleSelect = page.locator('#final-rule');
    await finalRuleSelect.selectOption('larger');
    await finalRuleSelect.blur();

    // Navigate to Course distance and verify distance recomputed using Final WC (provisional)
    await navigateToStep(page, 'Course distance');
    await expect(page.getByText(/Final working constant \(Larger/i)).toBeVisible();
    await expect(page.getByText('Provisional').first()).toBeVisible();
    // 10002 / 1003.002 = 9.972 km
    await expect(page.getByText(/9\.972\s*km/)).toBeVisible();

    // Verify inside calculation details disclosure
    const calcDetailsBtn = page.getByRole('button', { name: /Calculation details/i });
    if (await calcDetailsBtn.getAttribute('aria-expanded') !== 'true') {
      await calcDetailsBtn.click();
    }
    await expect(page.getByText(/Working constant used \(Final WC · provisional\)/i)).toBeVisible();

    // 5. Test Rule: 'average'
    await navigateToStep(page, 'Session setup');
    await page.locator('#final-rule').selectOption('average');
    await page.locator('#final-rule').blur();

    await navigateToStep(page, 'Course distance');
    await expect(page.getByText(/Final working constant \(Average/i)).toBeVisible();
    await expect(page.getByText('Provisional').first()).toBeVisible();
    // (1001.0000 + 1003.0020) / 2 = 1002.0010; 10002 / 1002.0010 = 9.982 km
    await expect(page.getByText(/9\.982\s*km/)).toBeVisible();

    // 6. Test Rule: 'notConfigured'
    await navigateToStep(page, 'Session setup');
    await page.locator('#final-rule').selectOption('notConfigured');
    await page.locator('#final-rule').blur();

    await navigateToStep(page, 'Course distance');
    // Reverts to Pre-calibration WC basis
    await expect(page.getByText(/Pre-calibration working constant \(provisional\)/i)).toBeVisible();
    await expect(page.getByText('Provisional').first()).toBeVisible();
    // 10002 / 1001.0000 = 9.992 km
    await expect(page.getByText(/9\.992\s*km/)).toBeVisible();
  });
});
