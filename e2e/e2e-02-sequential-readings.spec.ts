import { test, expect, clearIndexedDB, createNewSession, navigateToStep } from './fixtures';

test.describe('E2E-02: Sequential calibration readings', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('auto-links sequential starts and updates CPK and WC dynamically', async ({ page }) => {
    await createNewSession(page);

    // Navigate to Pre-calibration step
    await navigateToStep(page, 'Pre-calibration');
    await expect(page.getByRole('heading', { name: 'Pre-calibration', exact: true })).toBeVisible();

    // 1. Enter Ride 1 start and finish
    const r1Start = page.locator('#pre-ride-1-start');
    const r1Finish = page.locator('#pre-ride-1-finish');
    await r1Start.fill('10000');
    await r1Start.blur();
    await r1Finish.fill('11000');
    await r1Finish.blur();

    // 2. Verify Ride 2 start automatically updates to Ride 1 finish (11000)
    const r2Start = page.locator('#pre-ride-2-start');
    await expect(r2Start).toHaveValue('11000');

    // 3. Enter Ride 2 finish (12000)
    const r2Finish = page.locator('#pre-ride-2-finish');
    await r2Finish.fill('12000');
    await r2Finish.blur();

    // 4. Verify Ride 3 start is 12000, then enter finish 13000
    const r3Start = page.locator('#pre-ride-3-start');
    await expect(r3Start).toHaveValue('12000');
    const r3Finish = page.locator('#pre-ride-3-finish');
    await r3Finish.fill('13000');
    await r3Finish.blur();

    // 5. Verify Ride 4 start is 13000, then enter finish 14000
    const r4Start = page.locator('#pre-ride-4-start');
    await expect(r4Start).toHaveValue('13000');
    const r4Finish = page.locator('#pre-ride-4-finish');
    await r4Finish.fill('14000');
    await r4Finish.blur();

    // 6. Each ride count is 1000. For a 1000m course:
    // D = 4000, Average = 1000, CourseKm = 1.0, CPK = 1000.0000, WC = 1000 * 1.001 = 1001.0000
    // Check that Calibration summary renders the working constant
    await expect(page.getByText('1001.0000')).toBeVisible();

    // 7. Verify step status changes or review button becomes enabled
    const reviewBtn = page.getByRole('button', { name: /Review and continue|Next/i });
    await expect(reviewBtn).toBeVisible();
  });
});
