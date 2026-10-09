// Tracker #149, live-reported (two bugs found together):
// 1. "Click delete, nothing happens" -- every destructive confirmation
//    (issue delete, bulk delete, field delete, redaction) gated on native
//    window.confirm(), which a Matrix client's sandboxed widget iframe
//    silently no-ops (no dialog, no error). Replaced with a real in-app
//    modal (confirmDialog state + confirm-dialog-modal), reused everywhere
//    window.confirm() used to gate a destructive action.
// 2. A deleted issue came back after reconnecting to a Matrix room --
//    deletion used to be a hard, unlogged removal, so the room's still-
//    present creation event got replayed and treated as "new" on
//    reconnect. Issue deletion is now a real, derivable tombstone
//    (field: '__deleted__', value: true) appended to the issue's own
//    history, same "latest signed entry wins" pattern as everything else
//    -- the issue stays in the persisted doc (so another party sees the
//    deletion) but is filtered out of every human-facing view.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Issue deletion: in-app confirm modal + tombstone', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('single delete: Cancel leaves the issue untouched, Confirm removes it from view', async ({ page }) => {
    await h.clickTitleToPeek(page, 1);
    await page.waitForTimeout(150);
    await page.locator('[data-testid=slideover-delete-btn]').click();
    await expect(page.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();

    await page.locator('[data-testid=btn-confirm-dialog-cancel]').click();
    await expect(page.locator('[data-testid=confirm-dialog-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);

    await page.locator('[data-testid=slideover-delete-btn]').click();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(8);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0); // closes on delete
  });

  // Live-reported (Tom, 2026-09-29): the confirm dialog's message text and
  // Cancel button rendered in "some nasty serif font", while the red
  // Confirm/Delete button looked fine. Root cause: confirm-dialog-overlay
  // is not a descendant of the app's own font-family-declaring root (every
  // ancestor up through <html> measured "Times New Roman", the browser's
  // true UA default) -- merge-overlay/connect-remote-overlay already carry
  // an explicit font-family for the exact same reason, confirm-dialog-
  // overlay was just missing it. The Confirm button only looked right by
  // coincidence: a <button> gets its own browser-default form-control
  // font (measured as Arial) rather than inheriting body text, so it never
  // fell through to the true serif default the way plain text did.
  test('the confirm dialog message and Cancel use the app font, not the browser default serif', async ({ page }) => {
    await page.locator('[data-testid=row]').first().locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=bulk-action-bar] [data-testid=bulk-delete-btn]').click();
    await expect(page.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();

    const fonts = await page.evaluate(() => ({
      message: getComputedStyle(document.querySelector('[data-testid=confirm-dialog-modal] > div')).fontFamily,
      cancel: getComputedStyle(document.querySelector('[data-testid=btn-confirm-dialog-cancel]')).fontFamily,
    }));
    expect(fonts.message).toContain('-apple-system');
    expect(fonts.message).not.toContain('Times');
    expect(fonts.cancel).toContain('-apple-system');
    expect(fonts.cancel).not.toContain('Times');
  });

  test('a deleted issue is a real tombstone -- kept in the persisted doc, not hard-removed', async ({ page }) => {
    await h.clickTitleToPeek(page, 1);
    await page.locator('[data-testid=slideover-delete-btn]').click();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(200);

    const doc = await h.idbGetProjectDoc(page, 'demo-milestone');
    expect(doc.issues.length).toBe(9); // still present in storage
    const tombstoned = doc.issues.find(i => (i.history || []).some(hh => hh.field === '__deleted__' && hh.value === true));
    expect(tombstoned).toBeTruthy();

    // Survives a fresh hydrate/reload -- stays hidden, doesn't resurrect.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(8);
  });

  test('bulk delete uses the same in-app modal and tombstones every selected issue', async ({ page }) => {
    await h.row(page, 1).locator('[data-testid=row-select-checkbox]').click();
    await h.row(page, 2).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=bulk-delete-btn]').click();
    await expect(page.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(7);
  });

  test('a deleted issue keeps its full history in storage but is excluded from live counts', async ({ page }) => {
    await h.clickTitleToPeek(page, 1);
    await page.locator('[data-testid=slideover-delete-btn]').click();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(200);
    const doc = await h.idbGetProjectDoc(page, 'demo-milestone');
    expect(doc.issues.length).toBe(9); // full fidelity kept for another party/device to see the deletion
    const liveCount = doc.issues.filter(i => !(i.history || []).some(hh => hh.field === '__deleted__' && hh.value === true)).length;
    expect(liveCount).toBe(8); // matches what buildSourceText('squashed', ...) would keep, and what the grid shows
  });
});
