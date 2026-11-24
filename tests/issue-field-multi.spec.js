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

  // Live-reported (Tom): several things "weren't feeling right" about
  // mini-pills -- pill background indistinguishable from the row-hover
  // color, the popover too narrow (titles aggressively truncated), and
  // (in widget mode especially) the popover running off the top/bottom
  // of a short viewport. Click-to-open-the-list stays as-is; hovering any
  // one pill now highlights the whole group instead.
  test.describe('Mini-pill polish: color, popover width/wrap, hover-group, positioning', () => {
    async function seedTwoWigwagLinkedEntries(page) {
      const projectId = await h.activeMilestoneId(page);
      const doc = await h.readActiveMilestoneDoc(page);
      const targetA = doc.issues[1];
      const targetB = doc.issues[2];
      const hrefA = h.buildWigwagHref({ projectId, issueId: targetA.id });
      const hrefB = h.buildWigwagHref({ projectId, issueId: targetB.id });
      const source = doc.issues[0];
      // The displayed titleLabel is the snapshot title stored IN the
      // link entry itself at link-creation time (deriveIssueValues reads
      // it straight off {title, href}), not a live lookup of the target
      // issue's current title -- the long title has to live here.
      const longTitle = 'A genuinely very long issue title that would previously have been aggressively truncated in the old narrow popover column';
      h.pushFieldEntry(source, 'linked', [{ title: longTitle, href: hrefA }, { title: 'Target B', href: hrefB }]);
      await h.writeActiveMilestoneDoc(page, doc);
      await page.reload({ waitUntil: 'networkidle' });
      await h.waitForBootSplashGone(page);
      await page.waitForTimeout(300);
      return { projectId, targetA, targetB, longTitle };
    }

    test('a wigwag-linked pill shows <project-prefix>-<issue-prefix>, not a bare issue-uuid, matching in both the pill and the popover row', async ({ page }) => {
      const { projectId, targetA } = await seedTwoWigwagLinkedEntries(page);
      const expected = projectId.slice(0, 3) + '-' + targetA.id.slice(0, 5);

      const cell = h.fieldCell(page, 1, 'linked');
      const pill = cell.locator('[data-testid="issues-pill"]').first();
      expect((await pill.innerText()).trim()).toBe(expected);

      await pill.click();
      await page.waitForTimeout(200);
      const idCell = page.locator('[data-testid="issues-popover-row"]').first().locator('a');
      expect((await idCell.innerText()).trim()).toBe(expected);
    });

    test('pill background is its own distinct tone, not the same color as the row-hover background', async ({ page }) => {
      await seedTwoWigwagLinkedEntries(page);
      const pill = h.fieldCell(page, 1, 'linked').locator('[data-testid="issues-pill"]').first();
      const pillBg = await pill.evaluate(el => getComputedStyle(el).backgroundColor);
      // Same token (--surface-selected) already used elsewhere (e.g. the
      // inline-code background in markdown) -- confirms the pill picked
      // it up, not the old --surface-hover (near-identical to the row's
      // own hover color, which is the bug being fixed here).
      const reference = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--surface-selected)';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      expect(pillBg).toBe(reference);
    });

    test('hovering one pill highlights the whole group, not just that pill', async ({ page }) => {
      await seedTwoWigwagLinkedEntries(page);
      const pills = h.fieldCell(page, 1, 'linked').locator('[data-testid="issues-pill"]');
      await expect(pills).toHaveCount(2);

      const otherFilterBefore = await pills.nth(1).evaluate(el => getComputedStyle(el).filter);
      await pills.nth(0).hover();
      await page.waitForTimeout(100);
      const otherFilterDuring = await pills.nth(1).evaluate(el => getComputedStyle(el).filter);
      expect(otherFilterDuring).not.toBe(otherFilterBefore); // the un-hovered sibling changed too
    });

    test('the popover is wide enough, and a long title wraps instead of single-line-truncating', async ({ page }) => {
      await seedTwoWigwagLinkedEntries(page);
      await h.fieldCell(page, 1, 'linked').locator('[data-testid="issues-pill"]').first().click();
      await page.waitForTimeout(200);

      const popover = page.locator('[data-testid="issues-popover-row"]').first().locator('..').locator('..');
      const box = await popover.boundingBox();
      expect(box.width).toBeGreaterThan(500);

      const titleCell = page.locator('[data-testid="issues-popover-row"]').first().locator('div').nth(1);
      const whiteSpace = await titleCell.evaluate(el => getComputedStyle(el).whiteSpace);
      expect(whiteSpace).not.toBe('nowrap');
      await expect(titleCell).toContainText('genuinely very long issue title');
    });

    // The positioning clamp lives in computeAnchor/togglePopover, shared
    // by every popover type regardless of ROOM_MODE/widget vs desktop --
    // no isWidgetMode branch was added, so a short viewport under the
    // plain desktop harness exercises the exact same code path a short
    // widget panel would. Many entries forces a genuinely tall popover
    // (several rows), not just a short one that would trivially fit.
    test('on a short viewport, the popover stays fully within the visible viewport instead of running off the top or bottom', async ({ page }) => {
      const projectId = await h.activeMilestoneId(page);
      const doc = await h.readActiveMilestoneDoc(page);
      const source = doc.issues[0];
      const entries = [];
      for (let i = 1; i <= 6 && i < doc.issues.length; i++) {
        entries.push({ title: 'Entry ' + i, href: h.buildWigwagHref({ projectId, issueId: doc.issues[i].id }) });
      }
      h.pushFieldEntry(source, 'linked', entries);
      await h.writeActiveMilestoneDoc(page, doc);
      // Short enough that a 6-row popover would overflow without the fix
      // (its own natural height, header+rows+footer, comfortably exceeds
      // what's left below row 1 once the app bar/toolbar/column headers
      // are accounted for), but still tall enough to actually show row 1
      // without the "very short viewport" min-height/overlap fallback
      // (a separate, already-covered mechanism) kicking in and
      // confounding the click itself.
      await page.setViewportSize({ width: 1000, height: 420 });
      await page.reload({ waitUntil: 'networkidle' });
      await h.waitForBootSplashGone(page);
      await page.waitForTimeout(300);

      await h.fieldCell(page, 1, 'linked').locator('[data-testid="issues-pill"]').first().click();
      await page.waitForTimeout(200);
      const popoverRow = page.locator('[data-testid="issues-popover-row"]').first();
      const popover = popoverRow.locator('xpath=ancestor::div[3]');
      const box = await popover.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(420);
    });
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
