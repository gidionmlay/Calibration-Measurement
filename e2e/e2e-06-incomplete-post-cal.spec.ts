import { test, expect, clearIndexedDB, createNewSession, fillFourPreCalRides, navigateToStep } from './fixtures';

test.describe('E2E-06: Incomplete post-calibration', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('displays provisional pre-cal constant and badges when post-calibration is incomplete', async ({ page }) => {
    await createNewSession(page);

    // 1. Complete Pre-calibration only
    await navigateToStep(page, 'Pre-calibration');
    await fillFourPreCalRides(page, 10000, 1000);

    // 2. Enter Distance readings
    await navigateToStep(page, 'Course distance');
    await page.locator('#distance-start').fill('20000');
    await page.locator('#distance-finish').fill('30000');
    await page.locator('#distance-finish').blur();

    // 3. Verify that Course Distance uses Pre-calibration WC provisionally
    await expect(page.getByText(/Pre-calibration working constant \(provisional\)/i)).toBeVisible();
    await expect(page.getByText('Provisional').first()).toBeVisible();
    // 10000 / 1001 = 9.990 km
    await expect(page.getByText(/9\.990\s*km/)).toBeVisible();

    // Verify detailed disclosure
    const calcDetailsBtn = page.getByRole('button', { name: /Calculation details/i });
    if (await calcDetailsBtn.getAttribute('aria-expanded') !== 'true') {
      await calcDetailsBtn.click();
    }
    await expect(page.getByText(/Working constant used \(Pre-calibration WC · provisional\)/i)).toBeVisible();

    // 4. Verify that Post-calibration is incomplete
    await navigateToStep(page, 'Post-calibration');
    await expect(page.getByText('Post-calibration rides').first()).toBeVisible();
    // Finish readings are empty
    await expect(page.locator('#post-ride-1-start')).toHaveValue('');

    // 5. Navigate to Review & report
    await navigateToStep(page, 'Review & report');

    // 6. Verify that Finalization Checklist marks policyApproval and post incomplete
    await expect(page.getByText(/Governing measurement policy and final-constant rule are pending approval/i)).toBeVisible();
    // Finalization is not allowed
    const finalizeBtn = page.getByRole('button', { name: /Finalize session/i });
    await expect(finalizeBtn).toBeVisible();
    await finalizeBtn.click();
    await expect(page.getByText(/Finalization blocked/i)).toBeVisible();
  });
});
