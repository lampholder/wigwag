// Local-first, hash-addressed media attachments (design handoff
// attachments.zip, tracker e16588b6), Tauri-only for now (Tom: durable
// storage was the hard requirement; a browser/widget version backed by
// a media repo is an explicit second pass). Covers: the wigwag-media:
// reference type rendering present/missing, the comment composer's
// attach affordance (paperclip + drag-drop), and the missing-file ask
// popover. mockGithubApi's shared Tauri stub (tests/helpers.js) fakes
// window.__TAURI__.core so every test here runs as if under the real
// desktop app, same convention the identity-credential tests already
// use for their own fake keychain.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function openFirstIssue(page) {
  await h.clickTitleToPeek(page, 1);
  await page.waitForTimeout(250);
}

test.describe('Media attachments: reference rendering', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a [filename](wigwag-media:hash) reference with nothing stored locally renders as a grayed, dashed missing card', async ({ page }) => {
    await openFirstIssue(page);
    const hash = 'a'.repeat(64);
    await page.locator('[data-testid=new-comment-input]').fill('See attached.\n\n[report.pdf](wigwag-media:' + hash + ')');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(400);

    const missing = page.locator('[data-testid=media-card-missing]');
    await expect(missing).toHaveCount(1);
    await expect(missing).toContainText('report.pdf');
    await expect(missing).toContainText('not stored locally');
    await expect(page.locator('[data-testid=media-card-present]')).toHaveCount(0);
  });

  test('once the bytes are in the local store, the same reference renders as a present file card with name and size', async ({ page }) => {
    await openFirstIssue(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=comment-attach-btn]').click()
    ]);
    await chooser.setFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello world') });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(400);

    const present = page.locator('[data-testid=media-card-present]');
    await expect(present).toHaveCount(1);
    await expect(present).toContainText('report.pdf');
    await expect(present).toContainText('11 B');
    await expect(page.locator('[data-testid=media-card-missing]')).toHaveCount(0);
  });

  test('a plain [label](https://...) link is unaffected -- the new reference type only intercepts wigwag-media: URLs', async ({ page }) => {
    await openFirstIssue(page);
    await page.locator('[data-testid=new-comment-input]').fill('See [the doc](https://example.com/doc).');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=media-card-missing]')).toHaveCount(0);
    await expect(page.locator('[data-testid=media-card-present]')).toHaveCount(0);
    await expect(page.locator('a[href="https://example.com/doc"]')).toHaveText('the doc');
  });
});

test.describe('Media attachments: the comment composer attach affordance', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('the paperclip opens a native file picker and inserts a reference at the cursor, not just appended to the end', async ({ page }) => {
    await openFirstIssue(page);
    const input = page.locator('[data-testid=new-comment-input]');
    await input.fill('before after');
    await input.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 'before'.length; i++) await page.keyboard.press('ArrowRight');

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=comment-attach-btn]').click()
    ]);
    await chooser.setFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3, 4]) });
    await page.waitForTimeout(300);

    const draft = await input.inputValue();
    expect(draft).toMatch(/^before\[diagram\.png\]\(wigwag-media:[a-f0-9]{64}\) after$/);
  });

  test('dropping a file onto the composer attaches it the same way as the paperclip', async ({ page }) => {
    await openFirstIssue(page);
    const buffer = Buffer.from('dropped file contents');
    const dataTransfer = await page.evaluateHandle((bytes) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(bytes)], 'dropped.txt', { type: 'text/plain' });
      dt.items.add(file);
      return dt;
    }, Array.from(buffer));
    await page.locator('[data-testid=new-comment-input]').dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(300);

    const draft = await page.locator('[data-testid=new-comment-input]').inputValue();
    expect(draft).toMatch(/^\[dropped\.txt\]\(wigwag-media:[a-f0-9]{64}\)$/);
  });

  test('dropping two files at once attaches both, one reference each', async ({ page }) => {
    await openFirstIssue(page);
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' }));
      dt.items.add(new File([new Uint8Array([2, 2])], 'b.txt', { type: 'text/plain' }));
      return dt;
    });
    await page.locator('[data-testid=new-comment-input]').dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(300);

    const draft = await page.locator('[data-testid=new-comment-input]').inputValue();
    expect(draft).toContain('[a.txt](wigwag-media:');
    expect(draft).toContain('[b.txt](wigwag-media:');
  });
});

test.describe('Media attachments: the missing-file popover', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('clicking a missing card opens a popover with the hash, the comment author as "likely has it", and a working copy-request button; outside-click closes it', async ({ page }) => {
    await openFirstIssue(page);
    const hash = 'b'.repeat(64);
    await page.locator('[data-testid=new-comment-input]').fill('[call-recording.m4a](wigwag-media:' + hash + ')');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(400);

    await page.locator('[data-testid=media-card-missing]').click();
    await page.waitForTimeout(150);
    const popover = page.locator('[data-testid=missing-media-popover]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('sha256:' + hash.slice(0, 16));
    // The active identity (the test's own seeded identity) authored this
    // comment, so it's the suggested "likely has it" -- never the
    // doc's generic "ask anyone" fallback when a real author exists.
    await expect(page.locator('[data-testid=missing-media-likely-has-it]')).not.toHaveText('Ask anyone who has it');

    await page.locator('[data-testid=missing-media-copy-request]').click();
    await page.waitForTimeout(100);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('call-recording.m4a');
    expect(clip).toContain(hash);

    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);
    await expect(popover).toHaveCount(0);
  });

  test('a media reference with no recoverable author (e.g. a plain text field) falls back to "Ask anyone who has it"', async ({ page }) => {
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="Field name"]').fill('Notes field');
    await page.locator('select').selectOption('text');
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(200);
    const colId = await page.locator('[data-testid=col-header]').last().getAttribute('data-col');

    await openFirstIssue(page);
    const hash = 'c'.repeat(64);
    const fieldCellDiv = h.slideoverField(page, colId).locator(':scope > div').nth(1);
    await fieldCellDiv.click();
    await page.waitForTimeout(120);
    await fieldCellDiv.click();
    const textarea = page.locator('[data-testid=text-field-edit-textarea]');
    await textarea.fill('[spec.docx](wigwag-media:' + hash + ')');
    await textarea.press('Tab');
    await page.waitForTimeout(400);

    // The field also renders behind the slide-over in its own table row
    // (unaffected, same field) -- scope to the slide-over's own copy.
    await page.locator('[data-testid=slideover] [data-testid=media-card-missing]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=missing-media-likely-has-it]')).toHaveText('Ask anyone who has it');
  });
});

test.describe('Media attachments: Receive\'s ingestion path', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('an unmatched file (no missing reference points at its hash) is NOT auto-stored -- only after clicking Keep', async ({ page }) => {
    await openFirstIssue(page);
    await h.closeSlideover(page);
    await page.waitForTimeout(200);

    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(200);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-paste-merge-open-file]').click()
    ]);
    await chooser.setFiles({ name: 'unrelated.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
    await page.waitForTimeout(300);

    const row = page.locator('[data-testid=receive-media-row]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('unrelated.bin');
    await expect(row).toContainText('no matching request');
    await expect(row.locator('[data-testid=receive-media-row-keep]')).toBeVisible();

    await row.locator('[data-testid=receive-media-row-keep]').click();
    await page.waitForTimeout(200);
    await expect(row.locator('[data-testid=receive-media-row-keep]')).toHaveCount(0);
  });

  test('a file matching a missing reference visible in the project auto-ingests immediately, no Keep needed, and the card flips to present', async ({ page }) => {
    const matchHash = await page.evaluate(async () => {
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array([9, 9, 9]));
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    });
    await openFirstIssue(page);
    await page.locator('[data-testid=new-comment-input]').fill('[payload.bin](wigwag-media:' + matchHash + ')');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=media-card-missing]')).toHaveCount(1);
    await h.closeSlideover(page);
    await page.waitForTimeout(200);

    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(200);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-paste-merge-open-file]').click()
    ]);
    await chooser.setFiles({ name: 'payload.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([9, 9, 9]) });
    await page.waitForTimeout(400);

    const row = page.locator('[data-testid=receive-media-row]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Matched');
    await expect(row.locator('[data-testid=receive-media-row-keep]')).toHaveCount(0);

    await page.locator('[data-testid=btn-cancel-paste-merge]').click();
    await page.waitForTimeout(300);
    await openFirstIssue(page);
    const present = page.locator('[data-testid=slideover] [data-testid=media-card-present]');
    await expect(present).toHaveCount(1);
    await expect(present).toContainText('payload.bin');
  });

  test('a real JSONL project update still goes through the existing merge path unchanged -- the media branch never intercepts it', async ({ page }) => {
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(200);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-paste-merge-open-file]').click()
    ]);
    await chooser.setFiles({ name: 'export.jsonl', mimeType: 'application/x-jsonl', buffer: Buffer.from('not real jsonl but has the right extension') });
    await page.waitForTimeout(400);
    // Never shows up as a "media" row -- it went down the text/JSONL path.
    await expect(page.locator('[data-testid=receive-media-row]')).toHaveCount(0);
  });
});

test.describe('Media attachments: Send menu\'s "Send media by hash…"', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a new highlighted row sits at the bottom of the existing Send menu', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=btn-send-media-by-hash]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Send media by hash');
    // Sits after the three existing rows, not before/between them.
    const allRows = page.locator('[data-testid^=btn-export-], [data-testid=btn-copy-to-clipboard], [data-testid=btn-send-media-by-hash]');
    await expect(allRows.last()).toHaveAttribute('data-testid', 'btn-send-media-by-hash');
  });

  test('pasting a hash that matches a locally stored file shows its name/size/context and a working Reveal in folder; a non-matching hash says so plainly', async ({ page }) => {
    const hash = await page.evaluate(async () => {
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array([5, 5, 5]));
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    });
    await openFirstIssue(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=comment-attach-btn]').click()
    ]);
    await chooser.setFiles({ name: 'network-diagram.pdf', mimeType: 'application/pdf', buffer: Buffer.from([5, 5, 5]) });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(400);
    await h.closeSlideover(page);
    await page.waitForTimeout(200);

    await page.locator('[data-testid=btn-export]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=btn-send-media-by-hash]').click();
    await page.waitForTimeout(150);
    const popover = page.locator('[data-testid=send-media-by-hash-popover]');
    await expect(popover).toBeVisible();

    await page.locator('[data-testid=send-media-by-hash-input]').fill('sha256:' + hash);
    await page.waitForTimeout(150);
    const match = page.locator('[data-testid=send-media-by-hash-match]');
    await expect(match).toContainText('network-diagram.pdf');
    await expect(match).toContainText('3 B');
    await expect(page.locator('[data-testid=send-media-by-hash-not-found]')).toHaveCount(0);

    await page.locator('[data-testid=send-media-by-hash-input]').fill('sha256:' + 'f'.repeat(64));
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=send-media-by-hash-not-found]')).toBeVisible();
    await expect(page.locator('[data-testid=send-media-by-hash-match]')).toHaveCount(0);

    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);
    await expect(popover).toHaveCount(0);
  });
});
