import { test, expect, clearIndexedDB, createNewSession } from './fixtures';

test.describe('E2E-01: Session creation and persistence', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('creates a new session, enters setup details, and persists across reload', async ({ page }) => {
    // 1. Open application and create a new session
    await createNewSession(page, '');

    // 2. Verify Session Setup screen is rendered with blank initial course length and base name
    const courseLengthInput = page.locator('#course-length');
    await expect(courseLengthInput).toBeVisible();
    await expect(courseLengthInput).toHaveValue('');

    const courseNameInput = page.locator('#course-name');
    await expect(courseNameInput).toBeVisible();
    await expect(courseNameInput).toHaveValue('');

    // 3. Edit course length to 400m and fill optional Calibration base name
    await courseLengthInput.fill('400');
    // Blur to trigger commit / logEdit
    await courseLengthInput.blur();

    await courseNameInput.fill('Waterfront 1000m Reference Base');
    await courseNameInput.blur();

    // 4. Note the generated reference ID (e.g., BC-2026-004)
    const refLocator = page.locator('header').getByText(/BC-\d{4}-\d{3}/).first();
    await expect(refLocator).toBeVisible();
    const referenceId = (await refLocator.textContent())?.trim();
    expect(referenceId).toMatch(/BC-\d{4}-\d{3}/);

    // 5. Navigate back to Session List
    const backBtn = page.getByRole('button', { name: /Back to sessions/i });
    await backBtn.click();

    // 6. Verify session appears in the list with base name
    await expect(page.getByRole('heading', { name: /Calibration sessions/i })).toBeVisible();
    const sessionCard = page.getByText(referenceId!.trim());
    await expect(sessionCard.first()).toBeVisible();
    await expect(page.getByText('Waterfront 1000m Reference Base').first()).toBeVisible();

    // 7. Reload the browser page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 8. Verify the session still appears in the list after reload with base name
    await expect(page.getByText(referenceId!.trim()).first()).toBeVisible();
    await expect(page.getByText('Waterfront 1000m Reference Base').first()).toBeVisible();

    // 9. Reopen the session by clicking Resume / Open / Review
    const openBtn = page.getByRole('button', { name: new RegExp(referenceId!.trim(), 'i') }).first();
    await openBtn.click();

    // 10. Verify that the modified setup values (400m and base name) persisted from IndexedDB
    await expect(page.locator('#course-length')).toHaveValue('400');
    await expect(page.locator('#course-name')).toHaveValue('Waterfront 1000m Reference Base');
  });
});
