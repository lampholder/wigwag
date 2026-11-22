// Multi-issue linking (design handoff multi_issue_linking.zip, tracker
// issue ae55eef8): generalizes a non-Title 'issue'-type field from one
// linked entry into a list. 0/1 entries must stay byte-identical to
// today's single-value field (see issue-field.spec.js/bind-issue-field.spec.js
// for that existing coverage); this file covers the new 2+-entry
// behavior: pill-row display, the inspect/add/remove popover, and the
// bound-field non-goal (a rule resolving to 2+ issues stays unbound).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function addField(page, name, type) {
  await page.locator('[data-testid=add-field-wrap] span').first().click();
  await page.waitForTimeout(150);
  await page.locator('input[placeholder="Field name"]').fill(name);
  await page.locator('select').selectOption(type);
  await page.locator('button', { hasText: 'Add field' }).click();
  await page.waitForTimeout(200);
  return page.locator('[data-testid=col-header]').last().getAttribute('data-col');
}

// Live-reported (Tom): plain Enter commits the Issues field now (not
// newline) -- Ctrl+Enter inserts a newline instead, the inverse of every
// other multiline field's convention, scoped to this field type only
// (see handleIssuesFieldEditKey). A bare '\n' inside page.keyboard.type()
// presses plain Enter, which would now commit early mid-paste -- insert
// each line separately with an explicit Control+Enter between them.
async function typeMultilineAndCommit(page, lines) {
  await page.keyboard.press('Control+A');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Control+Enter');
    await page.keyboard.type(lines[i]);
  }
  await page.keyboard.press('Tab');
}

test.describe('Multi-issue linking: a non-Title issue field holding 2+ entries', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('exactly one entry still renders identically to the single-value field (no pill, no chip chrome)', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, colId);

    const cell = h.fieldCell(page, 1, colId);
    await expect(cell).toContainText('octocat/Hello-World#1');
    expect(await cell.locator('[data-testid="issues-pill"]').count()).toBe(0);
  });

  test('2+ newline-separated lines promote the cell to a pill row; an unresolved line renders inline as plain text, not a pill', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    await typeMultilineAndCommit(page, ['https://github.com/octocat/Hello-World/issues/1', 'fix after Q3 freeze']);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, colId);
    await expect(cell.locator('[data-testid="issues-pill"]')).toHaveCount(1);
    await expect(cell.locator('[data-testid="issues-pill"]').first()).toHaveText('octocat/Hello-World#1');
    await expect(cell).toContainText('fix after Q3 freeze');
  });

  test('clicking a pill opens the popover (id/title/remove rows); clicking outside closes it', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    await typeMultilineAndCommit(page, ['https://github.com/octocat/Hello-World/issues/1', 'https://github.com/octocat/Hello-World/issues/2']);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, colId);
    await cell.locator('[data-testid="issues-pill"]').first().click();
    await page.waitForTimeout(150);
    const rows = page.locator('[data-testid="issues-popover-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('octocat/Hello-World#1');
    await expect(rows.nth(1)).toContainText('octocat/Hello-World#2');

    // Outside-click allowlist regression guard (recurred 5x previously
    // per project memory) -- a new popover type MUST be added to
    // _onOutsideMouseDown's isPopoverField allowlist or this never closes.
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(rows).toHaveCount(0);
  });

  test('the popover fetches each built-in entry\'s live status and shows it as a colored pill, not persisted anywhere', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    // Fixture #1 is 'closed' (statusCategory done), #3 is 'open' (new) --
    // see GITHUB_FIXTURES in tests/helpers.js.
    await typeMultilineAndCommit(page, ['https://github.com/octocat/Hello-World/issues/1', 'https://github.com/octocat/Hello-World/issues/3']);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, colId);
    await cell.locator('[data-testid="issues-pill"]').first().click();
    await page.waitForTimeout(400);
    const statusPills = page.locator('[data-testid="issues-popover-status"]');
    await expect(statusPills).toHaveCount(2);
    await expect(statusPills.nth(0)).toHaveText('closed');
    await expect(statusPills.nth(1)).toHaveText('open');
  });

  // Live-reported (Tom): "why are we not guessing and taking the Status
  // value from wigwag issues?" -- a wigwag-internal link's status isn't
  // fetched (there's nothing to fetch, resolveWigwagRef's own comment
  // already establishes resolution is always local/synchronous), it just
  // wasn't being read at all. guessStatusFieldId picks whichever field
  // is actually called "Status" on the LINKED project, and the pill uses
  // that option's own real authored color, not a guessed category.
  test('a linked wigwag issue shows that project\'s own guessed "Status" field value and color, not just built-in connectors', async ({ page }) => {
    const projectId = await h.activeMilestoneId(page);
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.status = { label: 'Status', type: 'select', options: [
      { id: 'open', label: 'Open', color: 'gray' },
      { id: 'inprogress', label: 'In Progress', color: 'blue' },
      { id: 'done', label: 'Done', color: 'green' }
    ] };
    const target = doc.issues[1];
    h.pushFieldEntry(target, 'status', 'done');
    const source = doc.issues[0];
    const href = h.buildWigwagHref({ projectId, issueId: target.id });
    h.pushFieldEntry(source, 'linked', [{ title: 'Target issue', href }, 'a plain-text second entry']);
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(300);

    const cell = h.fieldCell(page, 1, 'linked');
    await cell.locator('[data-testid="issues-pill"]').first().click();
    await page.waitForTimeout(200);
    const statusPills = page.locator('[data-testid="issues-popover-status"]');
    // Only the resolved wigwag-linked row gets a status pill -- the
    // plain-text second entry has nothing to resolve and shows none.
    await expect(statusPills).toHaveCount(1);
    await expect(statusPills.first()).toHaveText('Done');
  });

  test('popover remove (x) commits immediately; removing down to one entry demotes the field back to ordinary single-value display', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    await typeMultilineAndCommit(page, ['https://github.com/octocat/Hello-World/issues/1', 'https://github.com/octocat/Hello-World/issues/2']);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, colId);
    await cell.locator('[data-testid="issues-pill"]').first().click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="issues-popover-row"]').nth(1).locator('[data-testid="issues-popover-remove"]').click();
    await page.waitForTimeout(400);

    await expect(cell.locator('[data-testid="issues-pill"]')).toHaveCount(0);
    await expect(cell).toContainText('octocat/Hello-World#1');
  });

  test('the popover\'s own add-entry input resolves a new line through the same connector pipeline', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    await typeMultilineAndCommit(page, ['https://github.com/octocat/Hello-World/issues/1', 'https://github.com/octocat/Hello-World/issues/2']);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, colId);
    await cell.locator('[data-testid="issues-pill"]').first().click();
    await page.waitForTimeout(150);
    const addInput = page.locator('[data-testid="issues-popover-add-input"]');
    await addInput.fill('https://github.com/octocat/Hello-World/issues/3');
    await addInput.press('Enter');
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="issues-popover-row"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="issues-popover-row"]').nth(2)).toContainText('octocat/Hello-World#3');
  });

  test('a rule that computes 2+ issues (copying a field that itself holds 2+ entries) falls back to unbound, never a mangled value', async ({ page }) => {
    // Seed row 1's "Related" (colId "linked", already type 'issue') with
    // 2 entries first.
    await h.clickFieldToEdit(page, 1, 'linked');
    await typeMultilineAndCommit(page, ['https://github.com/octocat/Hello-World/issues/1', 'https://github.com/octocat/Hello-World/issues/2']);
    await page.waitForTimeout(400);

    const remedyId = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, remedyId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Related' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('values.linked');
    await row.locator('[data-testid=rule-row-op]').selectOption('isNotEmpty');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then-copy-field]').selectOption({ label: 'Copy Related' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(300);

    const remedyCell = h.fieldCell(page, 1, remedyId);
    // Never a mangled "[object Object]"/joined string, and never locked
    // into a bound state it can't represent -- stays plain/editable.
    await expect(remedyCell).not.toContainText('[object');
    expect(await remedyCell.locator('[title="Linked to Issue\'s data"]').count()).toBe(0);
  });

  test('plain Enter commits the field; Ctrl+Enter inserts a newline instead -- the inverse of every other multiline field', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    const textarea = page.locator('textarea');
    await textarea.fill('first line');
    await page.keyboard.press('Control+Enter');
    // Ctrl+Enter must NOT commit -- still editing, and the newline landed
    // in the draft (not swallowed) so the second line is distinct.
    await expect(textarea).toBeVisible();
    await page.keyboard.type('https://github.com/octocat/Hello-World/issues/1');
    await expect(textarea).toHaveValue('first line\nhttps://github.com/octocat/Hello-World/issues/1');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    // Plain Enter commits -- textarea is gone, both lines landed (one
    // plain, one resolved into a pill).
    await expect(page.locator('textarea')).toHaveCount(0);
    const cell = h.fieldCell(page, 1, colId);
    await expect(cell).toContainText('first line');
    await expect(cell.locator('[data-testid="issues-pill"]')).toHaveText('octocat/Hello-World#1');
  });

  test('hovering a mini-pill shows the full title via its native title attribute, not just the short form', async ({ page }) => {
    const colId = await addField(page, 'Issues', 'issue');
    await h.clickFieldToEdit(page, 1, colId);
    await typeMultilineAndCommit(page, ['https://github.com/octocat/Hello-World/issues/1', 'https://github.com/octocat/Hello-World/issues/2']);
    await page.waitForTimeout(400);

    const pill = h.fieldCell(page, 1, colId).locator('[data-testid="issues-pill"]').first();
    await expect(pill).toHaveText('octocat/Hello-World#1');
    await expect(pill).toHaveAttribute('title', /.+/);
    const title = await pill.getAttribute('title');
    expect(title).not.toBe('octocat/Hello-World#1');
  });
});
