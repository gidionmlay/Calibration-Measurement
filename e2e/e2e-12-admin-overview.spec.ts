import { test, expect, clearIndexedDB, seedAuthTokens } from './fixtures';

test.describe('E2E-12: Role separation & Admin Overview Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
    await seedAuthTokens(page, 'measurer');
  });

  test('admin overview visibility, role switching, and metrics display', async ({ page }) => {
    // 1. Visit application root
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 2. Open operator menu in header
    const operatorButton = page.locator('header').getByRole('button', { name: /Measurer|Operator|Jane/i }).first();
    await expect(operatorButton).toBeVisible({ timeout: 10000 });
    await operatorButton.click();

    // 3. Switch role to Admin using Dev Role Switcher
    const adminRoleBtn = page.getByRole('button', { name: /^admin$/i });
    if (await adminRoleBtn.isVisible()) {
      await adminRoleBtn.click();
    }

    // 4. Close operator menu or click Admin Overview in sidebar
    const adminOverviewNav = page.getByRole('button', { name: /Admin Overview/i }).first();
    await expect(adminOverviewNav).toBeVisible({ timeout: 5000 });
    await adminOverviewNav.click();

    // 5. Verify Admin Overview dashboard is displayed
    await expect(page.getByRole('heading', { name: /Operational Overview/i })).toBeVisible();
    await expect(page.getByText('Field Measurers', { exact: true })).toBeVisible();
    await expect(page.getByText('Total Sessions', { exact: true })).toBeVisible();
    await expect(page.getByText('Finalized Reports', { exact: true })).toBeVisible();
    await expect(page.getByText('Active Drafts', { exact: true })).toBeVisible();

    // 6. Verify Recent Activity table is rendered
    await expect(page.getByRole('heading', { name: /Recent Measurement Activity/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search reference or measurer/i)).toBeVisible();

    // 7. Test search filter
    const searchInput = page.getByPlaceholder(/Search reference or measurer/i);
    await searchInput.fill('NonexistentQuery999');
    await expect(page.getByText(/No sessions match your search criteria/i)).toBeVisible();
    await searchInput.clear();

    // 8. Return to Sessions list
    const sessionsNav = page.getByRole('button', { name: /^Sessions$/i }).first();
    await sessionsNav.click();
    await expect(page.getByRole('heading', { name: /Calibration sessions/i })).toBeVisible();
  });
});

