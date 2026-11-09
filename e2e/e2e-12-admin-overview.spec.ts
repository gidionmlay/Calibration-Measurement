import { test, expect, clearIndexedDB, seedAuthTokens } from './fixtures';

test.describe('E2E-12: Role separation & Admin Overview Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthTokens(page, 'measurer');
    await clearIndexedDB(page);
  });

  test('admin overview visibility, role switching, and metrics display', async ({ page }) => {
    // 1. Visit application root
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 2. Open operator menu in header
    const operatorButton = page.locator('header button[aria-haspopup="menu"]').first();
    await expect(operatorButton).toBeVisible({ timeout: 10000 });
    await operatorButton.click();

    // 3. Switch role to Admin using Dev Role Switcher
    const adminRoleBtn = page.getByRole('button', { name: /^admin$/i });
    await expect(adminRoleBtn).toBeVisible({ timeout: 10000 });
    await adminRoleBtn.click();

    // Verify Admin profile is active
    await expect(page.locator('header').getByRole('button', { name: /Pat Chen/i })).toBeVisible({ timeout: 10000 });

    // 4. Click Overview in sidebar
    const overviewNav = page.locator('aside nav').getByRole('button', { name: /^Overview$/i });
    await expect(overviewNav).toBeVisible({ timeout: 10000 });
    await overviewNav.click();

    // 5. Verify Overview dashboard is displayed
    await expect(page.getByRole('heading', { name: /Operational Overview/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('kpi-card-measurers')).toBeVisible();
    await expect(page.getByTestId('kpi-card-total-sessions')).toBeVisible();
    await expect(page.getByTestId('kpi-card-finalized-reports')).toBeVisible();
    await expect(page.getByTestId('kpi-card-active-drafts')).toBeVisible();

    // 6. Verify Recent Activity table is rendered
    await expect(page.getByRole('heading', { name: /Recent Measurement Activity/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search reference or measurer/i)).toBeVisible();

    // 7. Test Users navigation in sidebar
    const usersNav = page.locator('aside nav').getByRole('button', { name: /^Users$/i });
    await expect(usersNav).toBeVisible({ timeout: 10000 });
    await usersNav.click();
    await expect(page.getByRole('heading', { name: /^Users$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('search-users-input')).toBeVisible();

    // 8. Test Settings navigation in sidebar
    const settingsNav = page.locator('aside nav').getByRole('button', { name: /^Settings$/i });
    await expect(settingsNav).toBeVisible({ timeout: 10000 });
    await settingsNav.click();
    await expect(page.getByRole('heading', { name: /^Settings$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Governing Road Measurement Standard/i)).toBeVisible();

    // 9. Verify Sessions and New Session buttons are completely removed from Admin sidebar
    await expect(page.locator('aside nav').getByRole('button', { name: /^Sessions$/i })).not.toBeVisible();
    await expect(page.locator('aside nav').getByRole('button', { name: /^New session$/i })).not.toBeVisible();

    // 10. Switch back to Measurer role and verify Sessions & New Session return
    const currentOperatorBtn = page.locator('header button[aria-haspopup="menu"]').first();
    await currentOperatorBtn.click();
    const measurerRoleBtn = page.getByRole('button', { name: /^measurer$/i });
    await expect(measurerRoleBtn).toBeVisible({ timeout: 10000 });
    await measurerRoleBtn.click();
    await expect(page.locator('aside nav').getByRole('button', { name: /^Sessions$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('aside nav').getByRole('button', { name: /^New session$/i })).toBeVisible({ timeout: 10000 });
  });
});

