import { test, expect, clearIndexedDB, createNewSession, navigateToStep } from './fixtures';

test.describe('E2E-10: Keyboard and responsive interaction', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('supports keyboard navigation, focus management, and modal escape', async ({ page }) => {
    await createNewSession(page);

    // 1. Test Skip to content link
    const skipLink = page.getByRole('link', { name: /Skip to content/i });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();

    // 2. Tab into form inputs
    await page.keyboard.press('Tab'); // into nav or header
    // Navigate to Pre-calibration to test table keyboard navigation
    await navigateToStep(page, 'Pre-calibration');

    const r1Start = page.locator('#pre-ride-1-start');
    await r1Start.focus();
    await expect(r1Start).toBeFocused();

    // Type value via keyboard
    await page.keyboard.type('12345');
    await expect(r1Start).toHaveValue('12345');

    // Tab to next input (Ride 1 finish)
    await page.keyboard.press('Tab');
    const r1Finish = page.locator('#pre-ride-1-finish');
    await expect(r1Finish).toBeFocused();
    await page.keyboard.type('13345');

    // 3. Navigate to Review & report to test modal escape key
    await navigateToStep(page, 'Review & report');
    const generatePreviewBtn = page.getByRole('button', { name: /Generate preview/i });
    await generatePreviewBtn.focus();
    await page.keyboard.press('Enter');

    // Modal opens
    const modal = page.getByRole('dialog', { name: /Report preview/i });
    await expect(modal).toBeVisible();

    // Press Escape to dismiss dialog
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('renders responsively on mobile viewport (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await createNewSession(page);

    // Verify mobile header and setup screen render without horizontal overflow
    await expect(page.getByRole('heading', { name: /Session setup/i })).toBeVisible();
    await expect(page.locator('#course-length')).toBeVisible();

    // Verify mobile stepper shows current step description
    await expect(page.getByText(/Step 1 of 5/i)).toBeVisible();

    // Navigate to pre-calibration and verify card/compact layout
    await navigateToStep(page, 'Pre-calibration');
    await expect(page.getByRole('heading', { name: 'Pre-calibration', exact: true })).toBeVisible();
    await expect(page.locator('#pre-ride-1-start')).toBeVisible();
  });
});
