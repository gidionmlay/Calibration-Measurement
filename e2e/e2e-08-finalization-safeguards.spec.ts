import { test, expect, clearIndexedDB, createNewSession, fillFourPreCalRides, fillFourPostCalRides, navigateToStep } from './fixtures';

test.describe('E2E-08: Finalization safeguards', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('blocks session finalization when measurement policy is unapproved and displays clear blocker notice', async ({ page }) => {
    await createNewSession(page);

    // Complete all readings so only policy approval remains
    await navigateToStep(page, 'Pre-calibration');
    await fillFourPreCalRides(page, 10000, 1000);

    await navigateToStep(page, 'Course distance');
    await page.locator('#distance-start').fill('20000');
    await page.locator('#distance-finish').fill('30000');
    await page.locator('#distance-finish').blur();

    await navigateToStep(page, 'Post-calibration');
    await fillFourPostCalRides(page, 50000, 1002);

    await navigateToStep(page, 'Session setup');
    await page.locator('#final-rule').selectOption('larger');

    // Navigate to Review & report
    await navigateToStep(page, 'Review & report');

    // 1. Verify that Finalization Checklist contains 'Governing measurement policy approved' with failing indicator
    const checklist = page.locator('aside');
    await expect(checklist.getByText('Governing measurement policy approved')).toBeVisible();

    // 2. Click 'Finalize session'
    const finalizeBtn = page.getByRole('button', { name: /Finalize session/i });
    await expect(finalizeBtn).toBeVisible();
    await finalizeBtn.click();

    // 3. Verify that Finalization is blocked and error notice is displayed
    const blockedNotice = page.locator('#finalize-blocked');
    await expect(blockedNotice).toBeVisible();
    await expect(blockedNotice).toContainText(/Finalization blocked/i);
    await expect(blockedNotice).toContainText(/Governing measurement policy and final-constant rule are pending approval/i);

    // 4. Verify that session was NOT finalized (no read-only / finalized record notice)
    await expect(page.getByText('Finalized — read-only record')).not.toBeVisible();

    // 5. Verify the Finalize button remains 'Finalize session' and not 'Back to sessions'
    await expect(finalizeBtn).toHaveText(/Finalize session/i);
  });
});
