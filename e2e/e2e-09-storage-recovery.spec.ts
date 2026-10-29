import { test, expect, clearIndexedDB, createNewSession, navigateToStep } from './fixtures';

test.describe('E2E-09: Browser storage and recovery', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('preserves sessions in native IndexedDB across reloads and filters corrupt records gracefully', async ({ page }) => {
    // 1. Create a valid session
    await createNewSession(page);
    await navigateToStep(page, 'Session setup');
    const courseLengthInput = page.locator('#course-length');
    await courseLengthInput.fill('500');
    await courseLengthInput.blur();

    const header = page.locator('header').getByText(/BC-\d{4}-\d{3}/).first();
    const ref = (await header.textContent())?.trim();

    // 2. Navigate back to session list and confirm it exists
    await page.getByRole('button', { name: /Back to sessions/i }).click();
    await expect(page.getByText(ref!).first()).toBeVisible();

    // 3. Inject a corrupt / malformed record directly into IndexedDB
    await page.evaluate(async () => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('bicycle_calibration_db', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('sessions', 'readwrite');
          const store = tx.objectStore('sessions');
          // Put corrupt record lacking required session fields
          store.put({ id: 'corrupt-rec', reference: 'MALFORMED-001', broken: true });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    // 4. Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 5. Verify the app does not crash and valid session is still listed
    await expect(page.getByRole('heading', { name: /Calibration sessions/i })).toBeVisible();
    await expect(page.getByText(ref!).first()).toBeVisible();

    // Corrupt record was gracefully skipped
    await expect(page.getByText('MALFORMED-001')).not.toBeVisible();

    // 6. Verify valid session can be reopened and course length 500 is intact
    const openBtn = page.getByRole('button', { name: new RegExp(ref!, 'i') }).first();
    await openBtn.click();
    await expect(page.locator('#course-length')).toHaveValue('500');
  });
});
