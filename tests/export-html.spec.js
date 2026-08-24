const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const h = require('./helpers.js');

// "Export as HTML" gives someone a fully interactive, independently
// editable copy of the current milestone -- not a static rendering. Two
// cooperating pieces, both deliberate design points, not implementation
// details:
//   1. A permanent script, first thing in <head> (outside the
//      __bundler/template blob entirely -- part of the raw page shell),
//      listens for DOMContentLoaded and caches this page's own complete,
//      untouched source into window.__wigwagOwnSource. It's registered
//      before the bundler runtime's own DOMContentLoaded handler (which
//      lives in <body>), and DOMContentLoaded listeners fire in
//      registration order, so this always wins the race -- capturing a
//      full copy (DOMContentLoaded only fires once __bundler/* tags near
//      the end of body are already parsed) before the runtime can consume
//      and remove any of it. This used to be fetch(location.href) instead;
//      that needed a real http(s) origin, so re-exporting from an
//      already-exported file:// copy was flatly blocked. The cache needs no
//      network request at all, so that limitation is gone.
//   2. At export time, a plain executable <script> (not a data-only tag --
//      the bundler runtime consumes and removes __bundler/* tags once it's
//      read them at boot, so a data-only tag, the first approach tried,
//      never survives long enough for the app's own constructor to read
//      it) is spliced into a copy of that cached source, right after
//      <head>, stashing the current milestone's squashed JSONL on
//      window.__wigwagExportSnapshot.
//
// download.path() returns an extensionless temp file -- fine for reading
// its bytes, but Chrome won't parse/execute a file:// document as HTML
// without a recognized extension (it falls back to something inert
// instead), so every test that actually NAVIGATES to a downloaded file
// re-saves it with a real .html path first via this helper.
let tmpCounter = 0;
async function saveDownloadAsHtml(download) {
  const p = path.join(os.tmpdir(), 'export-html-test-' + Date.now() + '-' + (tmpCounter++) + '.html');
  await download.saveAs(p);
  return p;
}

test.describe('Export as HTML', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('downloads a real, well-formed .html file with exactly one embedded snapshot', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.html$/);

    const text = fs.readFileSync(await download.path(), 'utf8');
    const matches = text.match(/<head>\n<script>\/\*wigwag-export-snapshot\*\//g) || [];
    expect(matches.length).toBe(1);
  });

  test('the exported file, opened cold, boots straight into the current milestone\'s data -- not blank, not the original browser\'s state', async ({ page, browser }) => {
    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const filePath = await saveDownloadAsHtml(await downloadPromise);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    const errors = [];
    recipientPage.on('pageerror', e => errors.push(e.message));
    await recipientPage.goto('file://' + filePath);
    await recipientPage.waitForTimeout(500);

    await expect(recipientPage.locator('[data-testid=tracker-name-title]')).toHaveText('Delivery tracker');
    await expect(recipientPage.locator('[data-testid=row]')).toHaveCount(9);
    expect(errors).toEqual([]);

    await recipientContext.close();
  });

  test('project notes and comments travel with the snapshot too', async ({ page, browser }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=notes-textarea]').fill('Cutover notes for the recipient.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=notes-close-btn]').click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const filePath = await saveDownloadAsHtml(await downloadPromise);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto('file://' + filePath);
    await recipientPage.waitForTimeout(500);
    await recipientPage.locator('[data-testid=btn-notes]').click();
    await recipientPage.waitForTimeout(400);
    await expect(recipientPage.locator('[data-testid=notes-body]')).toContainText('Cutover notes for the recipient.');

    await recipientContext.close();
  });

  test('the recipient\'s copy is fully interactive -- they can edit a field, and it persists across their own reload', async ({ page, browser }) => {
    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const filePath = await saveDownloadAsHtml(await downloadPromise);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto('file://' + filePath);
    await recipientPage.waitForTimeout(500);

    await h.clickFieldToEdit(recipientPage, 1, 'mitigation');
    await h.pasteText(recipientPage, 'Recipient-authored mitigation text');
    await recipientPage.keyboard.press('Tab');
    await recipientPage.waitForTimeout(200);

    // The recipient is a genuinely fresh identity in this brand-new
    // context -- their first edit hits the email gate, same as any other
    // first-time editor. Submitting it lets the original edit through.
    await recipientPage.locator('[data-testid=email-gate-input]').fill('recipient@example.com');
    await recipientPage.locator('[data-testid=btn-submit-email-gate]').click();
    await recipientPage.waitForTimeout(300);

    await recipientPage.reload();
    await recipientPage.waitForTimeout(500);
    await expect(h.fieldCell(recipientPage, 1, 'mitigation')).toHaveText(/Recipient-authored mitigation text/);

    await recipientContext.close();
  });

  test('reopening the same exported file later does not clobber the recipient\'s own edits', async ({ page, browser }) => {
    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const filePath = await saveDownloadAsHtml(await downloadPromise);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto('file://' + filePath);
    await recipientPage.waitForTimeout(500);

    await h.clickFieldToEdit(recipientPage, 1, 'mitigation');
    await h.pasteText(recipientPage, 'Do not clobber me');
    await recipientPage.keyboard.press('Tab');
    await recipientPage.waitForTimeout(200);

    // The recipient is a genuinely fresh identity in this brand-new
    // context -- their first edit hits the email gate, same as any other
    // first-time editor. Submitting it lets the original edit through.
    await recipientPage.locator('[data-testid=email-gate-input]').fill('recipient@example.com');
    await recipientPage.locator('[data-testid=btn-submit-email-gate]').click();
    await recipientPage.waitForTimeout(300);

    // Reopen (same browser storage, not a fresh context -- this is the
    // "come back to it tomorrow" scenario, not "a different person").
    await recipientPage.goto('file://' + filePath);
    await recipientPage.waitForTimeout(500);
    await expect(h.fieldCell(recipientPage, 1, 'mitigation')).toHaveText(/Do not clobber me/);

    await recipientContext.close();
  });

  test('exporting again from an already-served instance still produces exactly one embedded snapshot (stale one stripped first)', async ({ page }) => {
    // Re-exporting twice from the same live (http-served) instance is the
    // realistic version of "export again after more edits" -- re-exporting
    // FROM an already-exported file needs fetch() against its own origin,
    // which file:// blocks (a real, accepted platform constraint, same one
    // GitHub/Jira sync already have -- covered by its own error-message
    // test below, not re-tested here for the file:// case).
    await page.locator('[data-testid=btn-export]').click();
    let downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    await downloadPromise;

    await page.locator('[data-testid=btn-export]').click();
    downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const download = await downloadPromise;

    const text = fs.readFileSync(await download.path(), 'utf8');
    const matches = text.match(/<head>\n<script>\/\*wigwag-export-snapshot\*\//g) || [];
    expect(matches.length).toBe(1);
  });

  // buildHtmlExport() used to need fetch(location.href) to re-read its own
  // source, which browsers block for file:// origins -- a real limitation,
  // worked around at the time with a clear error message. It now reads a
  // copy of its own source captured into window.__wigwagOwnSource at load
  // time (via a DOMContentLoaded listener registered before the bundler
  // runtime's own, so it captures a complete, untouched document before
  // anything downstream can mutate it) instead of fetching -- no network
  // request at all, so this works identically whether served over http(s)
  // or opened as a local file. Re-exporting from an already-exported,
  // file://-opened copy is exactly the scenario this unblocks.
  test('re-exporting from an already-exported, file://-opened copy works (no fetch involved, so file:// is no longer a special case)', async ({ page, browser }) => {
    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const filePath = await saveDownloadAsHtml(await downloadPromise);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    recipientPage.on('dialog', async d => { throw new Error('unexpected dialog: ' + d.message()); });
    await recipientPage.goto('file://' + filePath);
    await recipientPage.waitForTimeout(500);

    await recipientPage.locator('[data-testid=btn-export]').click();
    const reDownloadPromise = recipientPage.waitForEvent('download');
    await recipientPage.locator('[data-testid=btn-export-html]').click();
    const reExportPath = await saveDownloadAsHtml(await reDownloadPromise);
    await recipientContext.close();

    // The re-export is itself a real, working copy -- not just "a download happened".
    const thirdGenContext = await browser.newContext();
    const thirdGenPage = await thirdGenContext.newPage();
    await thirdGenPage.goto('file://' + reExportPath);
    await thirdGenPage.waitForTimeout(500);
    await expect(thirdGenPage.locator('[data-testid=row]')).toHaveCount(9);
    await thirdGenContext.close();
  });

  test('re-exporting never duplicates the embedded snapshot, whether re-exporting live or from a file:// copy', async ({ page, browser }) => {
    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-html]').click();
    const filePath = await saveDownloadAsHtml(await downloadPromise);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto('file://' + filePath);
    await recipientPage.waitForTimeout(500);

    await recipientPage.locator('[data-testid=btn-export]').click();
    const reDownloadPromise = recipientPage.waitForEvent('download');
    await recipientPage.locator('[data-testid=btn-export-html]').click();
    const download = await reDownloadPromise;

    const text = fs.readFileSync(await download.path(), 'utf8');
    const snapshotMatches = text.match(/<head>\n<script>\/\*wigwag-export-snapshot\*\//g) || [];
    expect(snapshotMatches.length).toBe(1);
    const captureMatches = text.match(/document\.addEventListener\('DOMContentLoaded', function\(\) \{ window\.__wigwagOwnSource/g) || [];
    expect(captureMatches.length).toBe(1);

    await recipientContext.close();
  });
});
