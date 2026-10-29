import { test, expect, clearIndexedDB, createNewSession, fillFourPreCalRides, fillFourPostCalRides, navigateToStep } from './fixtures';

test.describe('E2E-07: Report consistency', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('verifies report preview reflects calculations, provisional warnings, and upstream updates', async ({ page }) => {
    await createNewSession(page);

    // 1. Setup pre-cal, distance, post-cal
    await navigateToStep(page, 'Pre-calibration');
    await fillFourPreCalRides(page, 10000, 1000);

    await navigateToStep(page, 'Course distance');
    await page.locator('#distance-start').fill('20000');
    await page.locator('#distance-finish').fill('30000');
    await page.locator('#distance-finish').blur();

    await navigateToStep(page, 'Post-calibration');
    await fillFourPostCalRides(page, 50000, 1002);

    // Set rule to larger
    await navigateToStep(page, 'Session setup');
    await page.locator('#final-rule').selectOption('larger');

    // 2. Navigate to Review & report
    await navigateToStep(page, 'Review & report');

    // 3. Open Report Preview modal
    const generatePreviewBtn = page.getByRole('button', { name: /Generate preview/i });
    await expect(generatePreviewBtn).toBeVisible();
    await generatePreviewBtn.click();

    // 4. Verify Report Modal content
    const previewModal = page.getByRole('dialog', { name: /Report preview/i });
    await expect(previewModal).toBeVisible();

    // Check header preview warning
    await expect(previewModal.getByText(/Preview only — not finalized/i)).toBeVisible();

    // Check outstanding issues list
    await expect(previewModal.getByText(/Governing measurement policy approved/i)).toBeVisible();

    // Check calculated distance and constant in report (10000 / 1003.002 = 9.970 km)
    await expect(previewModal.getByText(/9\.970 km/i)).toBeVisible();

    // 5. Close preview modal
    const closeBtn = previewModal.getByRole('button', { name: /Close preview/i });
    await closeBtn.click();
    await expect(previewModal).not.toBeVisible();

    // 6. Update distance finish reading from 30000 to 40000
    await navigateToStep(page, 'Course distance');
    await page.locator('#distance-finish').fill('40000');
    await page.locator('#distance-finish').blur();

    // 7. Re-open report preview and verify the new distance (20000 / 1003.002 = 19.940 km) is updated
    await navigateToStep(page, 'Review & report');
    await generatePreviewBtn.click();
    await expect(previewModal).toBeVisible();
    await expect(previewModal.getByText(/19\.940 km/i)).toBeVisible();
  });
});
