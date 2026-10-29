import { test, expect, clearIndexedDB, createNewSession, fillFourPreCalRides, fillFourPostCalRides, navigateToStep } from './fixtures';

test.describe('E2E-11: Session Export, Backup, Audit Export, and Provisional Reporting', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('exports and imports session backups with duplicate conflict copy resolution', async ({ page }) => {
    await page.goto('/');

    // 1. Verify Export button is visible on seed sessions
    const seedExportBtn = page.getByTestId('export-session-BC-2026-003');
    await expect(seedExportBtn).toBeVisible();

    // 2. Click Export on BC-2026-003 and catch download event
    const downloadPromise = page.waitForEvent('download');
    await seedExportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('BC-2026-003_session_backup.json');

    // Read download content
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const backupContent = Buffer.concat(chunks).toString('utf-8');
    const parsedBackup = JSON.parse(backupContent);

    expect(parsedBackup.format).toBe('bicycle-calibration-session-export');
    expect(parsedBackup.session.reference).toBe('BC-2026-003');
    expect(parsedBackup.application.provisionalNotice).toContain('PROVISIONAL');

    // 3. Attempt to import the exact same session (duplicate conflict)
    const fileChooserInput = page.getByTestId('import-file-input');
    await fileChooserInput.setInputFiles({
      name: 'BC-2026-003_session_backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupContent, 'utf-8'),
    });

    // 4. Verify Import Conflict Dialog appears
    const conflictDialog = page.getByRole('dialog', { name: /Session import conflict/i });
    await expect(conflictDialog).toBeVisible();
    await expect(conflictDialog.getByText(/BC-2026-003.*already exists/i)).toBeVisible();

    // 5. Click "Import as copy"
    const copyBtn = page.getByTestId('import-conflict-copy-btn');
    await copyBtn.click();
    await expect(conflictDialog).not.toBeVisible();

    // Verify copy session appears in session list table
    await expect(page.getByRole('rowheader', { name: 'BC-2026-003-COPY' })).toBeVisible();

    // 6. Test malformed file rejection
    await fileChooserInput.setInputFiles({
      name: 'corrupt.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ malformed: true ', 'utf-8'),
    });

    // Verify toast error is shown
    await expect(page.getByText('Import failed', { exact: true })).toBeVisible();
  });

  test('verifies prominent provisional notices and export actions in report preview', async ({ page }) => {
    await createNewSession(page);

    await navigateToStep(page, 'Pre-calibration');
    await fillFourPreCalRides(page, 10000, 1000);

    await navigateToStep(page, 'Course distance');
    await page.locator('#distance-start').fill('20000');
    await page.locator('#distance-finish').fill('30000');
    await page.locator('#distance-finish').blur();

    await navigateToStep(page, 'Post-calibration');
    await fillFourPostCalRides(page, 50000, 1002);

    await navigateToStep(page, 'Review & report');

    // Verify Audit Trail export buttons
    const auditDisclosure = page.getByRole('button', { name: /Audit trail/i });
    await auditDisclosure.click();

    const exportAuditJsonBtn = page.getByTestId('export-audit-json-btn');
    const exportAuditCsvBtn = page.getByTestId('export-audit-csv-btn');
    await expect(exportAuditJsonBtn).toBeVisible();
    await expect(exportAuditCsvBtn).toBeVisible();

    // Test Audit JSON Download
    const auditDownloadPromise = page.waitForEvent('download');
    await exportAuditJsonBtn.click();
    const auditDownload = await auditDownloadPromise;
    expect(auditDownload.suggestedFilename()).toContain('_audit_trail.json');

    // Open Report Preview
    const previewBtn = page.getByTestId('final-review-preview-btn');
    await previewBtn.click();

    const reportModal = page.getByRole('dialog', { name: /Report preview/i });
    await expect(reportModal).toBeVisible();

    // Verify prominent Provisional Notice header
    const noticeHeader = reportModal.getByTestId('provisional-report-notice');
    await expect(noticeHeader).toBeVisible();
    await expect(noticeHeader.getByText(/PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION/i)).toBeVisible();
    await expect(noticeHeader.getByText(/PROHIBITED & BLOCKED/i)).toBeVisible();

    // Verify Provisional Notice footer
    const noticeFooter = reportModal.getByTestId('provisional-report-footer');
    await expect(noticeFooter).toBeVisible();
    await expect(noticeFooter.getByText(/PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION/i)).toBeVisible();

    // Verify report export action buttons
    await expect(reportModal.getByTestId('download-report-txt-btn')).toBeVisible();
    await expect(reportModal.getByTestId('download-report-json-btn')).toBeVisible();
    await expect(reportModal.getByTestId('print-report-btn')).toBeVisible();

    // Test Report Text Download
    const reportTextDownloadPromise = page.waitForEvent('download');
    await reportModal.getByTestId('download-report-txt-btn').click();
    const reportTextDownload = await reportTextDownloadPromise;
    expect(reportTextDownload.suggestedFilename()).toContain('_provisional_report.txt');

    await reportModal.getByRole('button', { name: /Close preview/i }).click();
  });

  test('blocks overwrite of finalized sessions and enforces import as copy', async ({ page }) => {
    await page.goto('/');

    // BC-2026-001 is a finalized seed session
    const seed1ExportBtn = page.getByTestId('export-session-BC-2026-001');
    await expect(seed1ExportBtn).toBeVisible();

    // Export BC-2026-001
    const downloadPromise = page.waitForEvent('download');
    await seed1ExportBtn.click();
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const backupContent = Buffer.concat(chunks).toString('utf-8');

    // Attempt to re-import BC-2026-001
    const fileChooserInput = page.getByTestId('import-file-input');
    await fileChooserInput.setInputFiles({
      name: 'BC-2026-001_session_backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupContent, 'utf-8'),
    });

    // Conflict dialog opens
    const conflictDialog = page.getByRole('dialog', { name: /Session import conflict/i });
    await expect(conflictDialog).toBeVisible();

    // Verify finalized warning is displayed
    await expect(conflictDialog.getByTestId('conflict-finalized-warning')).toBeVisible();
    await expect(conflictDialog.getByText(/finalized and locked.*prohibited/i)).toBeVisible();

    // Verify overwrite button is disabled
    const disabledOverwriteBtn = conflictDialog.getByTestId('import-conflict-overwrite-disabled');
    await expect(disabledOverwriteBtn).toBeVisible();
    await expect(disabledOverwriteBtn).toBeDisabled();

    // Import as copy instead
    await conflictDialog.getByTestId('import-conflict-copy-btn').click();
    await expect(conflictDialog).not.toBeVisible();

    // Verify copy is listed alongside original
    await expect(page.getByRole('rowheader', { name: 'BC-2026-001-COPY' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'BC-2026-001', exact: true })).toBeVisible();
  });
});
