import { test, expect, clearIndexedDB, fillFourPreCalRides } from './fixtures';

test.describe('E2E-13: Mandatory Auth Gate, Self-Registration, Clean Dashboard & User Onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('unauthenticated visitor lands on mandatory Create Account screen, registers, sees calm empty dashboard, and starts calibration', async ({ page }) => {
    const uniqueEmail = `measurer_${Date.now()}@athletics.org`;
    const measurerName = 'Autonomous Measurer Jane';

    // 1. Visit application root — must land directly on mandatory AuthScreen
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 2. Verify mandatory auth gate displays "Create Measurer Account" tab by default
    await expect(page.getByRole('tab', { name: /Create Measurer Account/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /Create Measurer Account/i })).toBeVisible();
    await expect(page.getByText(/Immediate Autonomous Activation/i)).toBeVisible();

    // 3. Fill in registration details
    await page.locator('#reg-name').fill(measurerName);
    await page.locator('#reg-email').fill(uniqueEmail);
    await page.locator('#reg-password').fill('FieldSecretPass2026!');
    await page.locator('#reg-org').fill('World Athletics Grade A');

    // 4. Submit registration
    const submitBtn = page.getByRole('button', { name: /Create Account & Start Measuring/i });
    await submitBtn.click();

    // 5. AuthScreen disappears and user enters application shell
    await expect(page.getByRole('tab', { name: /Create Measurer Account/i })).not.toBeVisible({ timeout: 10000 });

    // 6. Verify header reflects new authenticated user name
    const newOperatorBtn = page.locator('header').getByRole('button', { name: new RegExp(measurerName, 'i') }).first();
    await expect(newOperatorBtn).toBeVisible({ timeout: 5000 });

    // 7. Verify clean dashboard empty state with calm, human welcome message
    await expect(page.getByRole('heading', { name: new RegExp(`Welcome, ${measurerName}`, 'i') })).toBeVisible();
    await expect(page.getByText(/Accredited for World Athletics Grade A/i)).toBeVisible();
    await expect(page.getByText(/Would you like to start your bicycle calibration session now, or explore your workspace first\?/i)).toBeVisible();

    // 8. Test "Explore Workspace First" workflow guide
    const exploreBtn = page.getByRole('button', { name: /Explore Workspace First/i });
    await expect(exploreBtn).toBeVisible();
    await exploreBtn.click();
    await expect(page.getByText(/Official 4-Step Road Calibration Workflow/i)).toBeVisible();
    await expect(page.getByText(/Reference Course Setup/i)).toBeVisible();
    await expect(page.getByText(/Pre-Calibration Rides/i)).toBeVisible();

    // 9. Start a new measurement session as this registered measurer
    const startCalBtn = page.getByRole('button', { name: /Start Calibration Now/i }).first();
    await startCalBtn.click();

    // 10. Enter session setup details (1000m reference course)
    await expect(page.getByRole('heading', { name: /Session setup/i })).toBeVisible();
    const courseLengthInput = page.locator('#course-length');
    await courseLengthInput.fill('1000');
    await courseLengthInput.blur();

    // 11. Proceed to Pre-Calibration and enter 4 valid rides
    const toPreCalBtn = page.getByRole('button', { name: /Pre-calibration/i }).first();
    await toPreCalBtn.click();
    await expect(page.getByRole('heading', { name: /Pre-calibration rides/i })).toBeVisible();
    await fillFourPreCalRides(page, 10000, 1000);

    // 12. Verify calculated constant is visible and advance
    await expect(page.getByText(/Working constant/i).first()).toBeVisible();
  });
});
