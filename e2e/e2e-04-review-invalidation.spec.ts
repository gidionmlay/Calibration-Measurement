import { test, expect, clearIndexedDB, createNewSession, fillFourPreCalRides, navigateToStep } from './fixtures';

test.describe('E2E-04: Upstream edits and review invalidation', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('invalidates downstream review when an upstream reading is modified', async ({ page }) => {
    await createNewSession(page);

    // 1. Fill 4 pre-cal rides
    await navigateToStep(page, 'Pre-calibration');
    await fillFourPreCalRides(page, 10000, 1000);
    const reviewPreBtn = page.getByRole('button', { name: /Review and continue|Next/i });
    await reviewPreBtn.click();

    // 2. Fill Course distance readings
    await navigateToStep(page, 'Course distance');
    await page.locator('#distance-start').fill('20000');
    await page.locator('#distance-start').blur();
    await page.locator('#distance-finish').fill('30000');
    await page.locator('#distance-finish').blur();

    // 3. Click "Review distance" to mark distance review as current
    const reviewDistBtn = page.getByRole('button', { name: /Review distance|Next/i });
    await reviewDistBtn.click();

    // 4. Return to Course distance; verify status is "Calculated · reviewed"
    await navigateToStep(page, 'Course distance');
    await expect(page.getByText('Calculated · reviewed')).toBeVisible();

    // 5. Now navigate back to Pre-calibration and change Ride 4 finish from 14000 to 14050
    await navigateToStep(page, 'Pre-calibration');
    const r4Finish = page.locator('#pre-ride-4-finish');
    await r4Finish.fill('14050');
    await r4Finish.blur();

    // 6. Navigate back to Course distance; verify status transitioned to "Recalculated · review again"
    await navigateToStep(page, 'Course distance');
    await expect(page.getByText(/Recalculated · review again/i)).toBeVisible();
    await expect(page.getByText(/The working constant or a counter reading changed after you reviewed this distance/i)).toBeVisible();

    // 7. Navigate to Final Review; verify invalidation notice in checklist and audit trail
    await navigateToStep(page, 'Review & report');
    await expect(page.getByText(/Changed after review:/i)).toBeVisible();

    // Audit trail should record the edit
    const auditBtn = page.getByRole('button', { name: /Audit trail/i });
    if (await auditBtn.getAttribute('aria-expanded') !== 'true') {
      await auditBtn.click();
    }
    await expect(page.getByText(/Pre-calibration Ride 4 finish changed/i)).toBeVisible();
    await expect(page.getByText(/Course distance review invalidated/i)).toBeVisible();
  });
});
