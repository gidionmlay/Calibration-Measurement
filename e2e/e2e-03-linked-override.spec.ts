import { test, expect, clearIndexedDB, createNewSession, navigateToStep } from './fixtures';

test.describe('E2E-03: Linked-reading override', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('overrides linked start with mandatory reason and persists after reload', async ({ page }) => {
    await createNewSession(page);

    // Note the reference ID
    const refLocator = page.locator('header').getByText(/BC-\d{4}-\d{3}/).first();
    await expect(refLocator).toBeVisible();
    const referenceId = (await refLocator.textContent())?.trim();

    await navigateToStep(page, 'Pre-calibration');

    // 1. Enter Ride 1 readings
    await page.locator('#pre-ride-1-start').fill('10000');
    await page.locator('#pre-ride-1-start').blur();
    await page.locator('#pre-ride-1-finish').fill('11000');
    await page.locator('#pre-ride-1-finish').blur();

    // 2. Click Override on Ride 2
    const overrideBtn = page.getByRole('button', { name: /^Override$/i }).first();
    await expect(overrideBtn).toBeVisible();
    await overrideBtn.click();

    // 3. Verify override box appears
    await expect(page.getByText('Override Ride 2 linked start')).toBeVisible();

    // 4. Try submitting without reason; verify error
    const confirmOverrideBtn = page.getByRole('button', { name: 'Override start' });
    await confirmOverrideBtn.click();
    await expect(page.getByText('Enter a reason before overriding.')).toBeVisible();

    // 5. Fill reason and submit
    const reasonInput = page.getByPlaceholder(/Counter advanced while repositioning/i);
    await reasonInput.fill('Odometer disengaged during turnaround');
    await confirmOverrideBtn.click();

    // 6. Verify Ride 2 start is now editable and marked Overridden
    await expect(page.getByText('Overridden').first()).toBeVisible();
    await expect(page.getByText('Reason: Odometer disengaged during turnaround')).toBeVisible();

    // 7. Enter an unlinked custom start value
    const r2Start = page.locator('#pre-ride-2-start');
    await r2Start.fill('11050');
    await r2Start.blur();

    // 8. Reload page to verify persistence in real IndexedDB
    await page.reload();
    await page.waitForLoadState('networkidle');

    // After reload, user lands on Session List; reopen the active session
    await expect(page.getByRole('heading', { name: /Calibration sessions/i })).toBeVisible();
    const openBtn = page.getByRole('button', { name: new RegExp(referenceId!, 'i') }).first();
    await openBtn.click();

    // Navigate to Pre-calibration if not already there
    await navigateToStep(page, 'Pre-calibration');

    // Re-verify that Ride 2 retains 11050, Overridden status, and reason
    await expect(page.locator('#pre-ride-2-start')).toHaveValue('11050');
    await expect(page.getByText('Overridden').first()).toBeVisible();
    await expect(page.getByText('Reason: Odometer disengaged during turnaround')).toBeVisible();
  });
});
