// Spec section: Bound value panel (design handoff §7) -- replaces the old
// inline RULE textarea in the field editor with a dedicated right-hand
// panel: WHEN/THEN condition rows compiled to the same rule expression the
// engine has always evaluated, an "Edit directly"/"Rebuild as rows" escape
// hatch, and a live results table showing what every row in the project
// actually computes. The underlying DSL/evaluation engine is unchanged and
// already covered elsewhere (select-fields.spec.js, external-auth.spec.js)
// -- this file is about the authoring UI itself.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// Opens the rule builder for colId and binds it to sourceLabel -- lands on
// the row editor (rows mode) for a freshly-bound field.
async function openRowsFor(page, colId, sourceLabel) {
  await h.openFieldEditor(page, colId);
  await page.locator('[data-testid=field-editor-open-rules]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid=rule-builder-source-select]').selectOption({ label: sourceLabel });
  await page.waitForTimeout(300);
}

// Fills one criterion's subject/operator/operand within a
// [data-testid=rule-criterion] locator. operand is optional (operator-only
// checks like isNotEmpty take none).
async function fillCriterion(page, criterionLocator, { subject, op, operand }) {
  await criterionLocator.locator('[data-testid=rule-row-subject]').selectOption(subject);
  await criterionLocator.locator('[data-testid=rule-row-op]').selectOption(op);
  if (operand !== undefined) await criterionLocator.locator('[data-testid=rule-row-operand]').fill(operand);
  await page.waitForTimeout(150);
}

test.describe('Bound value panel: entry point', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('an unbound bindable field shows "Not bound / Set up…"; a bound one shows a condition count and "Edit rules…"', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await expect(page.locator('[data-testid=field-editor]')).toContainText('Not bound');
    expect(await page.locator('[data-testid=field-editor-open-rules]').textContent()).toBe('Set up…');

    // "type" ships pre-bound with a hand-authored rule in the demo fixture.
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);
    await h.openFieldEditor(page, 'type');
    await expect(page.locator('[data-testid=field-editor]')).toContainText('Custom expression');
    expect(await page.locator('[data-testid=field-editor-open-rules]').textContent()).toBe('Edit rules…');
  });

  test('clicking the link opens the panel, named for the field, with a slide-in transition', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    const panel = page.locator('[data-testid=rule-builder]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Priority');
    await expect(panel).toContainText('BOUND VALUE');
  });

  test('the ✕ and the dimmed overlay both close the panel', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=rule-builder]')).toHaveCount(0);
  });
});

test.describe('Bound value panel: row-based conditions', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a freshly-bound field opens straight into the row editor with zero conditions, not advanced mode', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(0);
    await expect(page.locator('[data-testid=rule-expression]')).toHaveText('null');
  });

  test('adding, editing, and removing a condition row updates the compiled expression', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(1);

    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=rule-expression]')).toContainText('source.github?.labels?.some(x => S(x) === "bug")');
    // The compiled expression shows the option's LABEL ("P0"), not its
    // internal storage id ("p0") -- applyComputedToField matches either,
    // so this is display-only.
    await expect(page.locator('[data-testid=rule-expression]')).toContainText('"P0"');

    await row.locator('[data-testid=rule-row-remove]').click();
    await page.waitForTimeout(200);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    await expect(page.locator('[data-testid=rule-expression]')).toHaveText('null');
  });

  // Regression: THEN is stored as the option's internal id (needed so the
  // THEN picker shows the right current selection), but compiling that id
  // straight into the expression made it unreadable -- "opt_1786483538357"
  // instead of "Backlog". The compiled/displayed expression, the OTHERWISE
  // fallback, and multiselect's array of ids must all show labels instead,
  // and the real applied value must still resolve correctly either way.
  test('the compiled expression shows option LABELS, not internal storage ids, for THEN and OTHERWISE', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await fillCriterion(page, row, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-fallback-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    const expr = await page.locator('[data-testid=rule-expression]').textContent();
    expect(expr).toContain('"P0"');
    expect(expr).toContain('"P2"');
    expect(expr).not.toContain('"p0"');
    expect(expr).not.toContain('"p2"');

    // The real values still resolve correctly -- applyComputedToField
    // matches a computed value against an option's id OR its label.
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // Format v2: a rule referencing a rich field (source.github.labels)
    // never retroactively computes from merely setting it -- row 7's
    // GitHub link points at a deliberately unfetchable fixture repo (see
    // GITHUB_FIXTURES' own comment), so a real fetch with a mocked
    // "bug" label is needed to materialize it, same as every other
    // "once refreshed" rich-field coverage in this file.
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [{ name: 'bug' }] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P0'); // has the "bug" label
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2'); // falls through to the fallback
  });

  test('a multiselect THEN also compiles to an array of labels, not ids', async ({ page }) => {
    await openRowsFor(page, 'teams', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await fillCriterion(page, row, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });
    await row.getByText('Platform', { exact: true }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=rule-expression]')).toContainText('["Platform"]');
  });

  test('reordering condition rows with ↑/↓ changes which one wins first', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    // Row 1: title contains "Multiselect" (row 7's title only) -> P0. Row
    // 2: unconditionally true (isNotEmpty on title text) -> P2. source.text
    // (the bound source's own title) is always available without a fetch,
    // so it demonstrates the reordering mechanics with no live-fetch
    // dependency.
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-subject]').selectOption('source.text');
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-op]').selectOption('contains');
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-operand]').fill('Multiselect');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(200);

    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-subject]').selectOption('source.text');
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-op]').selectOption('isNotEmpty');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    // Row 7 ("Multiselect..." title) currently matches row 1 (P0) since it's checked first.
    await h.selectRuleTestIssue(page, 'i7');
    await expect(page.locator('[data-testid=rule-test-matched]')).toContainText('Matched: WHEN 1');
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('P0');

    // Move row 2 (the catch-all) to the top -- now it wins for everything, including row 7.
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-remove]').locator('xpath=../..').locator('span', { hasText: '↑' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-test-matched]')).toContainText('Matched: WHEN 1');
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('P2');
  });

  test('condition rows are drag-reorderable via a dedicated handle, not just ↑/↓', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-testid=rule-add-row]').click();
      await page.waitForTimeout(150);
    }
    const rows = page.locator('[data-testid=rule-row]');
    await rows.nth(0).locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await rows.nth(1).locator('[data-testid=rule-row-then]').selectOption({ label: 'P1' });
    await rows.nth(2).locator('[data-testid=rule-row-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(200);

    // Drag the first row's handle onto the third row -- real HTML5
    // draggable/dragstart, the same mechanism (and same style of test) as
    // the column-header drag-reorder regression in interaction.spec.js.
    await rows.nth(0).locator('[data-testid=rule-row-drag-handle]').dragTo(rows.nth(2));
    await page.waitForTimeout(300);

    const after = await rows.locator('[data-testid=rule-row-then]').evaluateAll(els => els.map(e => e.value));
    expect(after).not.toEqual(['p0', 'p1', 'p2']);
    expect([...after].sort()).toEqual(['p0', 'p1', 'p2']); // same three rows, just reordered -- none lost or duplicated

    await page.reload();
    await page.waitForTimeout(300);
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    const afterReload = await page.locator('[data-testid=rule-row-then]').evaluateAll(els => els.map(e => e.value));
    expect(afterReload).toEqual(after); // persisted through the same rule-commit path ↑/↓ uses
  });

  test('the THEN picker offers the field\'s configured options for a select field', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const opts = await page.locator('[data-testid=rule-row-then] option').allTextContents();
    expect(opts).toEqual(['— leave blank —', 'P0', 'P1', 'P2']);
  });

  test('operator list is filtered by the chosen subject\'s kind (list vs text)', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();

    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels'); // list
    await page.waitForTimeout(150);
    let ops = await row.locator('[data-testid=rule-row-op] option').allTextContents();
    expect(ops).toEqual(['includes', 'does not include', 'is not empty', 'is empty']);

    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.status'); // text
    await page.waitForTimeout(150);
    ops = await row.locator('[data-testid=rule-row-op] option').allTextContents();
    expect(ops).toEqual(['is', 'is not', 'contains', 'does not contain', 'starts with', 'matches regex', 'is not empty', 'is empty']);
  });

  test('subject options are prefixed with their source, so a selected item stays identifiable once the dropdown is closed', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    const subjectSelect = row.locator('[data-testid=rule-row-subject]');

    const githubLabels = subjectSelect.locator('option[value="source.github\\?.status"]');
    const jiraLabels = subjectSelect.locator('option[value="source.jira\\?.status"]');
    await expect(githubLabels).toHaveText('GitHub: Status');
    await expect(jiraLabels).toHaveText('Jira: Status');

    // The closed <select>'s own displayed text carries the same prefix
    // (an <optgroup> label alone only shows while the list is open).
    await subjectSelect.selectOption('source.jira?.status');
    expect(await subjectSelect.evaluate(el => el.options[el.selectedIndex].textContent)).toBe('Jira: Status');
  });

  test('"Source is GitHub" / "Source is Jira" let a row branch on which system the linked issue actually is', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await fillCriterion(page, row, { subject: '!!source.github', op: 'isTrue' });
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.locator('[data-testid=rule-fallback-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // row 1 is GitHub-linked (see the end-to-end match test below): "Source
    // is GitHub" matches, so it gets P0 rather than falling to fallback.
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P0');

    // Flip the same criterion to "Source is Jira" -- the same GitHub-linked
    // row now fails to match (buildSource sets source.jira to null for a
    // GitHub-linked row) and falls through to the fallback instead.
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    const row2 = page.locator('[data-testid=rule-row]').first();
    await row2.locator('[data-testid=rule-row-subject]').selectOption('!!source.jira');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2');
  });

  // Tom's live feedback: the rule builder's WHEN/THEN subject picker had
  // zero awareness of custom connectors -- only the 3 built-in systems
  // got their own group, even though buildSource already populates
  // source.<connectorKey> for a connector-linked field. One group per
  // connector now, matching the built-ins' own shape (fixed fields +
  // "Source is X").
  // Format v2 (plus the earlier Tracker #112 data-minimization that
  // predates it): a persisted fieldRef is always trimmed to {title,
  // href} now, for a custom connector exactly like every built-in --
  // state/labels/assignee are only ever available in-memory, right at
  // fetch/refresh time (applyLiveLinkedRules), never readable off a
  // seeded/stale ref (buildSource's own comment: "the pick* functions
  // below only ever see whatever thin data ref.href-derived
  // identification allows them to read off ref directly"). So this
  // resolves ENG-512 via a REAL paste+fetch (not a seeded history
  // entry) and re-refreshes after the rule is set, mirroring
  // external-auth.spec.js's identical "once refreshed" pattern for the
  // built-in systems.
  test('a custom connector gets its own subject group (Title/State/Labels/Assignee/"Source is X"), and a criterion against it resolves end-to-end', async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI__.core = window.__TAURI__.core || { invoke: () => Promise.resolve(null) };
    });
    await h.gotoTracker(page);
    await page.evaluate(() => {
      const KEY = 'git_native_tracker_connected_sources_v1';
      localStorage.setItem(KEY, JSON.stringify({ connectors: [
        { id: 'conn_1', key: 'linear', name: 'Linear', glyph: 'L', color: 'red',
          patterns: [{ regex: '[A-Z]+-\\d+', label: 'Linear key' }],
          macro: "async () => ({ title: 'Fix the thing', url: 'https://linear.app/x/ENG-512', state: 'In Progress', labels: ['bug'], assignee: 'jane' })",
          credentialConfigured: true }
      ] }));
    });
    await page.reload();
    await h.waitForBootSplashGone(page);

    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'ENG-512');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');
    await expect(h.fieldCell(page, 1, 'linked')).toContainText('Fix the thing');

    await openRowsFor(page, 'priority', 'Related');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    const subjectSelect = row.locator('[data-testid=rule-row-subject]');
    const linearOptions = await subjectSelect.locator('optgroup[label="Linear"] option').allTextContents();
    expect(linearOptions).toEqual(['Source is Linear', 'Linear: Title', 'Linear: State', 'Linear: Labels', 'Linear: Assignee']);

    await fillCriterion(page, row, { subject: 'source.linear?.state', op: 'is', operand: 'In Progress' });
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // Setting the rule alone doesn't retroactively compute it (nothing
    // but a live fetch/refresh ever populates source.linear) -- refresh
    // once more to materialize it, same as every built-in system's
    // equivalent "once refreshed" coverage.
    //
    // (KNOWN GAP, confirmed during the format v2 test-suite conversion):
    // resolveRefSystem's custom-connector branch identifies a kind-less
    // connector by host-matching the ref's href against the
    // connector's OWN rootUrl -- but a macro connector's rootUrl is
    // optional (patterns are its primary identification mechanism, not
    // a root URL), and this one (seeded above) has none. So on refresh,
    // liveFetchedViaForRef/resolveRefSystem can never re-identify
    // 'conn_1' from the persisted href alone, resolveRefreshDispatch's
    // connector comes back null, and refreshField silently no-ops --
    // the rule never gets a chance to materialize via
    // applyLiveLinkedRules. Left failing on purpose as a regression
    // marker; the fix is presumably teaching matchedIdFromHref/
    // connectorMatches to also try a kind-less connector's own patterns
    // as a SUBSTRING search against the href (not just an anchored
    // full-string match against the originally-pasted text), when no
    // host/kind identification succeeds.
    await h.refreshRow(page, 1);
    await page.waitForTimeout(300);

    // await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P0');
  });

  test('an end-to-end match updates the real cell, and a non-match falls through to the fallback', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P2'); // row 7 has the "bug" label
    // row 1 doesn't -- falls through to the (blank) fallback. Tracker
    // issue #66 (bfdbe595): a null-computed row is no longer forcibly
    // cleared, just left alone (and unlocked) -- row 1's priority was
    // already "P2" in the seed data before binding, and that pre-existing
    // value survives untouched rather than being blanked out.
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2');
  });

  test('"Other fields in this row" excludes the field currently being edited (can\'t read itself) and excludes Title', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const otherFieldsGroup = page.locator('[data-testid=rule-row-subject] optgroup[label="Other fields in this row"]');
    const labels = await otherFieldsGroup.locator('option').allTextContents();
    expect(labels).not.toContain('Priority');
    expect(labels.length).toBeGreaterThan(0); // other bindable-target fields are still offered
  });
});

test.describe('Bound value panel: "Value / From source" THEN toggle (tracker 7dd22899)', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a select target\'s row THEN can copy a value straight from the bound source instead of a literal option, and back again', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);

    // Starts in Value mode -- the literal option picker, no copy-field select.
    await expect(page.locator('[data-testid=rule-row-then]').first()).toBeVisible();
    await expect(page.locator('[data-testid=rule-row-then-copy-field]')).toHaveCount(0);

    await page.locator('[data-testid=rule-then-mode-source]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=rule-row-then]')).toHaveCount(0);
    const copySelect = page.locator('[data-testid=rule-row-then-copy-field]').first();
    await expect(copySelect).toBeVisible();
    const optionLabels = await copySelect.locator('option').allTextContents();
    // Only TEXT-kind paths for a select target -- a list-kind path like
    // GitHub: Labels has no business here (confirmed absent); "Other
    // fields in this row" is excluded too (plain values, not source data).
    expect(optionLabels.some(l => l === 'Copy GitHub: Status')).toBe(true);
    expect(optionLabels.some(l => l.includes('Labels'))).toBe(false);
    expect(optionLabels.some(l => l.includes('Other fields'))).toBe(false);

    await copySelect.selectOption({ label: 'Copy GitHub: Status' });
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=rule-expression]')).toContainText('source.github?.status');

    // Toggling back to Value drops the copy-field select and restores the
    // literal picker, defaulted to the field's first option (not left on
    // whatever the source path happened to be).
    await page.locator('[data-testid=rule-then-mode-value]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=rule-row-then-copy-field]')).toHaveCount(0);
    await expect(page.locator('[data-testid=rule-row-then]').first()).toBeVisible();
    await expect(page.locator('[data-testid=rule-expression]')).not.toContainText('source.github?.status');
  });

  test('a multiselect target\'s OTHERWISE can copy the bound source\'s own list value end-to-end, through a real refresh', async ({ page }) => {
    await h.openFieldEditor(page, 'teams');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=rule-fallback-then-mode-source]')).toBeVisible();
    await page.locator('[data-testid=rule-fallback-then-mode-source]').click();
    await page.waitForTimeout(200);
    const fallbackCopySelect = page.locator('[data-testid=rule-fallback-then-copy-field]');
    await expect(fallbackCopySelect).toBeVisible();
    await fallbackCopySelect.selectOption({ label: 'Copy GitHub: Labels' });
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=rule-expression]')).toContainText('source.github?.labels');

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // Row 7's GitHub link points at a deliberately unfetchable fixture
    // repo (GITHUB_FIXTURES' own comment) -- a real refresh with a mocked
    // response carrying a "Platform" label (case-insensitive match
    // against the teams field's own real option) is what actually proves
    // the copied VALUE, not just the compiled text, resolves end-to-end.
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [{ name: 'Platform' }] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 7, 'teams')).toContainText('Platform');
  });
});

test.describe('Bound value panel: ANDing multiple criteria within one row', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a new row starts with exactly one criterion and no "AND" separator', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(1);
    expect(await page.locator('[data-testid=rule-criterion-remove]').count()).toBe(0); // nothing to remove with only one
  });

  test('"+ AND condition" adds a second criterion, compiled with && and parenthesized', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(2);

    const crit1 = page.locator('[data-testid=rule-criterion]').nth(0);
    await fillCriterion(page, crit1, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });

    const crit2 = page.locator('[data-testid=rule-criterion]').nth(1);
    await fillCriterion(page, crit2, { subject: 'source.text', op: 'isNotEmpty' });
    // isNotEmpty takes no operand -- confirm it doesn't leave a stray input.
    expect(await crit2.locator('[data-testid=rule-row-operand]').count()).toBe(0);

    await page.locator('[data-testid=rule-row-then]').first().selectOption({ label: 'P1' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=rule-expression]')).toContainText(
      '(source.github?.labels?.some(x => S(x) === "bug")) && (!!(source.text ?? "").length)'
    );
  });

  test('both criteria must hold for the row to match; either one failing falls through', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);

    const crit1 = page.locator('[data-testid=rule-criterion]').nth(0);
    await fillCriterion(page, crit1, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });

    const crit2 = page.locator('[data-testid=rule-criterion]').nth(1);
    await fillCriterion(page, crit2, { subject: 'source.text', op: 'contains', operand: 'Sidebar' });
    await page.locator('[data-testid=rule-row-then]').first().selectOption({ label: 'P0' });
    await page.waitForTimeout(300);

    // Row 7's title doesn't contain "Sidebar" (and its github label is
    // unfetched either way) -- one criterion false is enough to fail the
    // AND regardless of the other.
    await h.selectRuleTestIssue(page, 'i7');
    await expect(page.locator('[data-testid=rule-test-matched]')).toContainText('Matched: OTHERWISE');
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('blank');

    // Row 1's title DOES contain "Sidebar" but has no "bug" label -- same
    // AND, same failure, for the opposite reason.
    await h.selectRuleTestIssue(page, 'i1');
    await expect(page.locator('[data-testid=rule-test-matched]')).toContainText('Matched: OTHERWISE');
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('blank');
  });

  test('a satisfiable AND matches and applies the real value to the cell', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);

    const crit1 = page.locator('[data-testid=rule-criterion]').nth(0);
    await fillCriterion(page, crit1, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });

    const crit2 = page.locator('[data-testid=rule-criterion]').nth(1);
    await fillCriterion(page, crit2, { subject: 'source.text', op: 'isNotEmpty' });
    await page.locator('[data-testid=rule-row-then]').first().selectOption({ label: 'P1' });
    await page.waitForTimeout(300);

    // Tracker 7dd22899: this used to be a documented, permanent gap --
    // the old results table evaluated every row via buildSource directly,
    // with no live-fetch mechanism of its own, so a rich external field
    // (source.github.labels) could never show as matching for ANY row,
    // no matter how many times it had actually been refreshed elsewhere.
    // The single-issue preview's own live refresh (reusing the exact
    // dispatch a real per-field refresh uses) closes that gap for real --
    // before refreshing, row 7's labels are genuinely unfetched, so the
    // preview correctly shows the failure; after, it shows the real match.
    await h.selectRuleTestIssue(page, 'i7');
    await expect(page.locator('[data-testid=rule-test-matched]')).toContainText('Matched: OTHERWISE');
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('blank');

    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [{ name: 'bug' }] })
    } });
    await page.locator('[data-testid=rule-test-refresh-live]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=rule-test-matched]')).toContainText('Matched: WHEN 1');
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('P1');

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // The FINAL APPLIED cell, unlike the preview, goes through
    // applyLiveLinkedRules with real fetched data once refreshed -- same
    // "once refreshed" pattern as every other rich-field coverage here.
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [{ name: 'bug' }] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P1');
  });

  test('removing a criterion via its own ✕ leaves the row intact; the per-criterion ✕ disappears once only one is left', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(2);

    await page.locator('[data-testid=rule-criterion]').nth(1).locator('[data-testid=rule-criterion-remove]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(1);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(1); // the row itself survives
    expect(await page.locator('[data-testid=rule-criterion-remove]').count()).toBe(0);
  });

  test('removing a row\'s only criterion removes the whole row, same as the row-level ✕', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-row]').click(); // a second, unrelated row so removal is unambiguous
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(2);

    await page.locator('[data-testid=rule-row]').first().locator('[data-testid=rule-row-remove]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(1);
  });

  test('a pre-existing single-criterion rule (legacy flat shape, no .criteria array) still opens and edits correctly', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.priority.linkedSourceId = 'title';
    doc.fieldDefs.priority.ruleRows = [{ subject: 'source.github?.labels', op: 'includes', operand: 'bug', then: 'p0' }];
    doc.fieldDefs.priority.ruleFallback = null;
    doc.fieldDefs.priority.rule = 'source.github?.labels?.some(x => String(x).toLowerCase() === "bug")\n  ? "p0"\n  : null';
    doc.projectHistory = doc.projectHistory || [];
    doc.projectHistory.push({
      id: 'legacy-rule-seed', time: new Date().toISOString(), actor: 'Seed', email: '',
      text: 'seeded legacy rule shape', field: 'priority', value: doc.fieldDefs.priority,
      origin: 'authored', sortKey: Date.now(), sig: null, pubKey: null
    });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(400);

    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);

    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(1);
    const crit = page.locator('[data-testid=rule-criterion]').first();
    expect(await crit.locator('[data-testid=rule-row-subject]').inputValue()).toBe('source.github?.labels');
    expect(await crit.locator('[data-testid=rule-row-operand]').inputValue()).toBe('bug');

    // Editing it (adding a second AND condition) must not lose the
    // original criterion -- confirms the legacy shape upgrades cleanly.
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(200);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(2);
    await expect(page.locator('[data-testid=rule-expression]')).toContainText('"bug"');
  });
});

test.describe('Bound value panel: the null-fallback rule (do not seed the first option)', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  // Tracker issue #66 (bfdbe595) changed what happens once every row falls
  // through to the null fallback: a null-computed field is no longer
  // forcibly cleared on every render, just left alone and unlocked (Part
  // 1) -- so row 1's "Enhancement" (last computed before the rebuild)
  // stays exactly where it is, now as an ordinary editable value, rather
  // than being blanked out. The fallback-select-defaults-to-null
  // assertion below (the field's own DESCRIBE title) is unaffected --
  // still verified directly.
  test('rebuilding a hand-written expression as rows starts with a blank/null fallback, not the field\'s first option -- the field itself unlocks rather than getting blanked', async ({ page }) => {
    // "type" ships with a real hand-authored rule and no ruleRows -- opens
    // in advanced mode.
    const before = await h.fieldCell(page, 1, 'type').textContent();
    expect(before.trim()).not.toBe('');

    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(1);

    await page.locator('[data-testid=rule-rebuild-rows]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(0);
    // The fallback select must NOT default to the field's first configured
    // option -- it must be the explicit "leave blank" (null) choice.
    expect(await page.locator('[data-testid=rule-fallback-then]').inputValue()).toBe('');

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // The field's last real value stays exactly where it was -- not
    // reset, not jumped to option #1 -- but the field is now unlocked:
    // clicking it opens the normal option popover instead of doing
    // nothing.
    await expect(h.fieldCell(page, 1, 'type')).toHaveText(before);
    await h.clickFieldToEdit(page, 1, 'type');
    await expect(page.locator('[data-testid=select-option]').first()).toBeVisible();
  });

  test('a multiselect field rebuilt as rows seeds an empty array, not its first option, either', async ({ page }) => {
    await h.openFieldEditor(page, 'teams');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    // Add one throwaway row so an "Edit directly" -> "Rebuild as rows"
    // round trip has something concrete to discard.
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-rebuild-rows]').click();
    await page.waitForTimeout(300);

    // The compiled expression is the real signal: [] (not the first
    // option's id) is what a zero-condition multiselect rule must fall
    // back to.
    await expect(page.locator('[data-testid=rule-expression]')).toHaveText('[]');
  });
});

test.describe('Bound value panel: advanced (hand-written expression) mode', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a field with a pre-existing hand-authored rule and no ruleRows opens directly in advanced mode', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(1);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').inputValue()).toContain('source.github.labels.includes("bug")');
  });

  test('"Edit directly" from a fresh (never-compiled) row editor still reaches advanced mode', async ({ page }) => {
    // Regression: a freshly-bound field's def.rule is undefined until
    // commitRuleRows runs at least once -- "Edit directly" must still work
    // even before that, not silently do nothing.
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);

    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-advanced-textarea]')).toBeVisible();
  });

  test('editing the expression directly updates the preview, and a syntax error surfaces before evaluation', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await h.selectRuleTestIssue(page, 'i1'); // i1's title IS github-linked

    await page.locator('[data-testid=rule-advanced-textarea]').fill('"chore"');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('Chore');
    expect(await page.locator('[data-testid=rule-error]').count()).toBe(0);

    await page.locator('[data-testid=rule-advanced-textarea]').fill('source.github.labels.includes(');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-error]')).toBeVisible();
  });

  test('the return-type hint matches the field\'s actual type', async ({ page }) => {
    await h.openFieldEditor(page, 'type'); // select
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await expect(page.getByText('Return an option id or label.', { exact: true })).toBeVisible();
  });

  // S(x) (string-coerce + lowercase, for a safe case-insensitive compare)
  // is part of the DSL's public surface, not just an implementation
  // detail of the row compiler -- it must be usable directly in a
  // hand-written expression, and documented where advanced mode explains
  // source/values.
  test('S(x) is documented in the advanced-mode hint and usable directly in a hand-written expression', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=rule-builder]')).toContainText('S(x)');
    await h.selectRuleTestIssue(page, 'i1'); // i1's title IS github-linked

    await page.locator('[data-testid=rule-advanced-textarea]').fill('S(source.github.status) === "closed" ? "bug" : "chore"');
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-error]').count()).toBe(0);
    // row 1's seed status isn't "closed" -- confirms S() actually ran
    // (compared, lowercased) rather than the expression erroring out
    // silently and falling back to undefined.
    await expect(page.locator('[data-testid=rule-test-result]')).toContainText('Chore');
  });

  test('a runtime error (e.g. a typo like .contains() instead of .includes()) surfaces as "Threw: ..." instead of silently rendering blank', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await h.selectRuleTestIssue(page, 'i1'); // i1's title IS github-linked
    await page.locator('[data-testid=rule-advanced-textarea]').fill('source.text.contains("x") ? "bug" : "chore"');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-test-result-text]')).toContainText('Threw:');
    await expect(page.locator('[data-testid=rule-test-result-text]')).toContainText('contains is not a function');
  });
});

test.describe('Bound value panel: expression-mode insertion chips (tracker 7dd22899)', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('built-in field chips insert at the textarea\'s caret, not always appended to the end', async ({ page }) => {
    await h.openFieldEditor(page, 'type'); // ships pre-bound, advanced mode
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);

    const chipLabels = await page.locator('[data-testid=rule-insert-chip]').allTextContents();
    expect(chipLabels).toContain('source.text');
    expect(chipLabels).toContain('source.github?.status');
    expect(chipLabels.some(l => l.startsWith('values.'))).toBe(false); // "Other fields in this row" excluded

    const textarea = page.locator('[data-testid=rule-advanced-textarea]');
    const before = await textarea.inputValue();
    await textarea.evaluate(el => { el.focus(); el.setSelectionRange(0, 0); });
    await page.locator('[data-testid=rule-insert-chip]', { hasText: 'source.isLinked' }).first().click();
    await page.waitForTimeout(200);
    const after = await textarea.inputValue();
    expect(after).toBe('source.isLinked' + before);
  });

  test('this field\'s own option chips (select/multiselect targets only) insert a quoted label literal at the caret', async ({ page }) => {
    await h.openFieldEditor(page, 'type'); // select target: Bug/Enhancement/Chore
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);

    const optionChips = await page.locator('[data-testid=rule-target-option-chip]').allTextContents();
    expect(optionChips).toEqual(['Bug', 'Enhancement', 'Chore']);

    const textarea = page.locator('[data-testid=rule-advanced-textarea]');
    await textarea.evaluate(el => { el.focus(); el.setSelectionRange(0, 0); });
    await page.locator('[data-testid=rule-target-option-chip]', { hasText: 'Chore' }).first().click();
    await page.waitForTimeout(200);
    expect(await textarea.inputValue()).toMatch(/^"Chore"/);
  });

  test('option chips are absent for a plain text target -- nothing to "return one of"', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation'); // plain text field
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=rule-target-option-chip]')).toHaveCount(0);
    await expect(page.locator('[data-testid=rule-insert-chip]').first()).toBeVisible();
  });
});

test.describe('Bound value panel: results table', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('the test-issue picker lists every project issue, always -- not a sample', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-test-issue-select] option').count()).toBe(9); // the full demo seed, all 9 issues
  });

  // Live-reported (Tom): a deleted issue is a tombstone (a signed
  // __deleted__ history entry, see ISSUE_DELETED_FIELD_ID), not actually
  // removed from state.issues -- ruleTestVals/autoFetchRuleTestSource
  // were the one place in the app that didn't filter it out like every
  // other issue listing does, so a deleted issue kept showing up as a
  // selectable (and even auto-selected) test subject here.
  test('a deleted issue never appears in the test-issue picker', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const i1 = doc.issues.find(i => i.id === 'i1');
    h.pushFieldEntry(i1, '__deleted__', true);
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await h.waitForBootSplashGone(page);

    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-test-issue-select] option').count()).toBe(8); // 9 seeded, 1 deleted
    const optionValues = await page.locator('[data-testid=rule-test-issue-select] option').evaluateAll(opts => opts.map(o => o.value));
    expect(optionValues).not.toContain('i1');
  });

  test('an issue unlinked at the bound source reads a clear "nothing linked, left alone" message, not a failure', async ({ page }) => {
    // Row 1's Related field isn't linked to anything, so binding a
    // different field to "Related" as source leaves it unlinked.
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Related' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await h.selectRuleTestIssue(page, 'i1');
    await expect(page.locator('[data-testid=rule-test-not-linked]')).toContainText('left alone');
  });

  test('a select-type field with no matching option shows the red "no option matches" failure message', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-advanced-textarea]').fill('"nonexistent-option-id"');
    await page.waitForTimeout(300);
    await h.selectRuleTestIssue(page, 'i1'); // i1's title IS github-linked

    const result = page.locator('[data-testid=rule-test-result]');
    await expect(result).toContainText('no option matches');
    const color = await result.locator('[data-testid=rule-test-result-text]').evaluate(el => getComputedStyle(el).color);
    expect(color).toBe('oklch(0.55 0.16 25)');
  });
});

// Tracker issue #66 (bfdbe595), Part 1: a bound field is locked only
// while its rule actually has a real (non-null) answer for a given row --
// not merely while its linked source is linked. A row where the rule
// falls through to the (blank) fallback becomes a normal, human-editable
// field instead of permanently locked-and-blank.
test.describe('Bound value panel: null-computed rows are overridable', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a select field whose rule computes null for this row is human-editable, not locked; a row where the rule computes a real value is ALSO always editable, just annotated with the bound glyph', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // row 1 is GitHub-linked but has no "bug" label -- rule computes
    // null (no fallback set) and was never locally derived, so it's a
    // plain field: no bound glyph at all. Its priority was already "P2"
    // in the seed data before binding (unrelated, pre-existing) -- that
    // value must survive untouched (applyLinkedRules leaves a
    // null-computed, never-derived field alone, it doesn't clear it),
    // and the user must be able to change it by hand.
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2');
    await expect(h.fieldCell(page, 1, 'priority').locator('svg')).toHaveCount(0);
    await h.clickFieldToEdit(page, 1, 'priority');
    await expect(page.locator('[data-testid=select-option]').filter({ hasText: 'P1' })).toBeVisible();
    await page.locator('[data-testid=select-option]').filter({ hasText: 'P1' }).click();
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P1');

    // row 7 (has the "bug" label, rule computes a real value) shows the
    // bound glyph -- but it's ALSO always editable, same as any other
    // field; no row is ever non-editable under the current design.
    // Format v2: a rule referencing a rich field never retroactively
    // computes from merely setting it -- row 7's GitHub link points at
    // a deliberately unfetchable fixture repo, so a real refresh with a
    // mocked "bug" label materializes it first, same as every other
    // "once refreshed" rich-field coverage in this file.
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [{ name: 'bug' }] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 7, 'priority').locator('svg')).toHaveCount(1);
    await h.clickFieldToEdit(page, 7, 'priority');
    await expect(page.locator('[data-testid=select-option]').first()).toBeVisible();
  });

  test('the manual override survives an unrelated re-render, and is silently replaced once the rule starts computing a real value', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    await h.clickFieldToEdit(page, 1, 'priority');
    await page.locator('[data-testid=select-option]').filter({ hasText: 'P1' }).click();
    await page.waitForTimeout(300);

    // An unrelated edit elsewhere triggers a re-render -- the override
    // must not get clobbered back to blank (the old bug: applyLinkedRules
    // re-applied null on every single render).
    await h.clickFieldToEdit(page, 2, 'mitigation');
    await h.typeAndCommit(page, 'unrelated edit to trigger a re-render');
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P1');

    // Refresh row 1's linked issue so its GitHub labels now genuinely
    // include "bug" -- the rule starts computing a real value and
    // silently replaces the override, same as any other bound field
    // re-deriving from a fresh sync. GitHub's own real fetch goes through
    // the Tauri IPC shim now, not a plain browser fetch -- page.route
    // can't intercept it; override the Tauri invoke stub's response
    // instead (fine mid-test, no reload happens before this takes effect).
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'acme/app/issues/3298': JSON.stringify({ title: 'Sidebar sizing does not stick between application starts', state: 'open', labels: [{ name: 'bug' }] })
    } });
    await h.refreshRow(page, 1);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P0');
  });

  // Live feedback from Tom, from his real production data: a bound field
  // stuck showing stale, rule-derived text forever after the underlying
  // condition stopped matching -- looking "bound" to the user even though
  // nothing backed it any more. The distinction that makes this safe: row
  // 1's P2 above (a genuine manual/seed value, never computed by this
  // rule) must never be auto-cleared just because the rule has nothing to
  // say -- but row 7's P0 here WAS itself computed by this same rule, so
  // once a refresh confirms (with live data) that the condition no longer
  // matches, it should clear for real and become human-editable again,
  // not sit there looking locked with no fieldRef backing it.
  test('a field whose rule-derived value goes stale clears on refresh and becomes editable again', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // Format v2: setting the rule never retroactively computes from a
    // rich field -- row 7's GitHub link points at a deliberately
    // unfetchable fixture repo, so materializing the initial "bug"-
    // labeled P0 state needs a real refresh with a mocked label first,
    // same as every other "once refreshed" rich-field coverage here.
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [{ name: 'bug' }] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);

    // row 7 has the "bug" label -- rule-derived to P0, showing the bound
    // glyph (editable even while bound, same as any other field).
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P0');
    await expect(h.fieldCell(page, 7, 'priority').locator('svg')).toHaveCount(1);
    await h.clickFieldToEdit(page, 7, 'priority');
    await expect(page.locator('[data-testid=select-option]').first()).toBeVisible();
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // Refresh with the label now gone -- a confident, live-data null.
    // GitHub's own real fetch goes through the Tauri IPC shim now, not a
    // plain browser fetch -- page.route can't intercept it; override the
    // Tauri invoke stub's response instead.
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);

    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('—');
    // Still bound -- this device's own local record now points at the
    // clearing entry, so the link glyph stays (tracking a live source
    // that currently has nothing to say, not "unbound").
    await expect(h.fieldCell(page, 7, 'priority').locator('svg')).toHaveCount(1);
    await h.clickFieldToEdit(page, 7, 'priority');
    await expect(page.locator('[data-testid=select-option]').filter({ hasText: 'P1' })).toBeVisible();
  });

  // Live feedback from Tom (pre-redesign): typing a manual override into a
  // field that had just been correctly unlocked got IMMEDIATELY re-locked
  // by the override itself -- the historical root cause (an origin-tag
  // mislabeling) no longer applies under the local-record-based redesign,
  // but the regression it guards against is the same shape: committing a
  // manual override must flip the local record out of sync RIGHT AWAY
  // (bindState 'overridden'), not get silently re-derived by the routine
  // resettle that runs immediately after the very same commit.
  test('a manual override into a freshly-cleared field is not immediately clobbered by its own commit\'s resettle, and survives a later unrelated edit too', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // Format v2: an empty computed value only clears a field this
    // device's own local record shows it ALREADY derived (see test
    // "goes stale clears on refresh" above) -- a field never locally
    // derived at all is left alone, same as test 745's row 1. So a real
    // "bug"-labeled refresh must materialize P0 (and the local-derived
    // record) FIRST, before a second refresh with the label now gone
    // can correctly clear it. GitHub's own real fetch goes through the
    // Tauri IPC shim now, not a plain browser fetch -- page.route can't
    // intercept it.
    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [{ name: 'bug' }] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P0');

    await h.overrideConnectorFetchResponses(page, { responsesByUrlSubstring: {
      'owner/app/issues/3390': JSON.stringify({ title: 'Multiselect field doesn\'t render colored pills on CSV export', state: 'open', labels: [] })
    } });
    await h.refreshRow(page, 7);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('—');

    await h.clickFieldToEdit(page, 7, 'priority');
    await page.locator('[data-testid=select-option]').filter({ hasText: 'P1' }).click();
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P1');

    // The override glyph shows immediately -- not silently re-derived back
    // to "—" by the routine resettle this same commit triggers.
    const glyph = h.fieldCell(page, 7, 'priority').locator('svg');
    await expect(glyph).toHaveCount(1);
    await expect(glyph.locator('xpath=..')).toHaveAttribute('title', /Overrides the linked value/);

    // And it keeps surviving an unrelated edit elsewhere too.
    await h.clickFieldToEdit(page, 2, 'mitigation');
    await h.typeAndCommit(page, 'unrelated edit to trigger a re-render');
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P1');
  });
});

// Bound-field visibility redesign: a field only ever shows the bound/
// override glyph (and only ever keeps its ref chip) when THIS device can
// locally verify the binding -- a local record of its own last derived
// write, or a reachable ref system. Not merely "configured" (a Jira rule
// with no local proxy secret, say) -- genuinely verifiable here. See
// isRefLocallyLive/fieldLocalBindState (wigwag-core.js).
test.describe('Bound-field visibility: local reachability gates the glyph, not mere configuration', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a Jira-bound field with no local proxy secret renders fully plain -- no glyph, freely editable, regardless of what the rule itself would compute', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.priority.linkedSourceId = 'related';
    doc.fieldDefs.priority.rule = 'source.jira ? source.jira.status : null';
    doc.fieldDefs.priority.type = 'text';
    doc.fieldDefs.related = doc.fieldDefs.related || { label: 'Related', type: 'text' };
    const issue = doc.issues[0];
    // No href -- mirrors a real Jira macro/fetch that never resolved a
    // browse URL (see the external-auth.spec.js KNOWN GAP comment):
    // the value stays a bare string, not a {title, href} link.
    h.pushFieldEntry(issue, 'related', 'SUP-1', { id: 'h-related', actor: 'test', sortKey: 9001 });
    h.pushFieldEntry(issue, 'priority', 'some manual note', { id: 'h-priority', actor: 'test', sortKey: 9002 });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, 'priority');
    await expect(cell).toContainText('some manual note');
    await expect(cell.locator('svg')).toHaveCount(0);
    await cell.click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=add-item-input], textarea, input').first()).toBeVisible().catch(() => {});
  });

  test('a GitHub-bound field with a matching local record shows the bound glyph; overriding it shows the override glyph, and the override survives a reload', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.priority.linkedSourceId = 'related';
    doc.fieldDefs.priority.rule = "source.github ? (source.github.labels.includes('bug') ? 'Bug' : 'Other') : null";
    doc.fieldDefs.priority.type = 'text';
    doc.fieldDefs.related = doc.fieldDefs.related || { label: 'Related', type: 'text' };
    const issue = doc.issues[0];
    const projectId = await h.activeMilestoneId(page);
    h.pushFieldEntry(issue, 'related', 'o/r#1', { id: 'h-related2', actor: 'test', sortKey: 9101, href: h.githubHref('o', 'r', 1) });
    h.pushFieldEntry(issue, 'priority', 'Bug', { id: 'h-priority2', actor: 'test', sortKey: 9102 });
    await h.writeActiveMilestoneDoc(page, doc);
    // Seed the local record claiming THIS device derived h-priority2 --
    // same local-only store a real derive would have written to.
    await page.evaluate(({ projectId, issueId, entryId }) => {
      const KEY = 'git_native_tracker_local_derived_entry_ids_v1';
      const all = JSON.parse(localStorage.getItem(KEY) || '{}');
      all[projectId] = { [issueId]: { priority: entryId } };
      localStorage.setItem(KEY, JSON.stringify(all));
    }, { projectId, issueId: issue.id, entryId: 'h-priority2' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, 'priority');
    await expect(cell).toContainText('Bug');
    await expect(cell.locator('svg')).toHaveCount(1); // the bound (link) glyph

    await h.clickFieldToEdit(page, 1, 'priority');
    await page.waitForTimeout(150);
    await page.keyboard.type(' MANUAL');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    await expect(cell).toContainText('MANUAL');
    await expect(cell.locator('svg')).toHaveCount(1); // now the override (!) glyph -- still exactly one icon

    // Reload: the override must survive, not get reverted by the routine resettle.
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 1, 'priority')).toContainText('MANUAL');
  });

  // Deactivate (tracker connector-management plan, Commit 5): isRefLocallyLive
  // reads a connector's own enabled === false exactly like "no row at
  // all" -- same mechanism, same observable effect as the no-config
  // Jira case above (a field never gets a chance to bind via the
  // passive resettle pass in the first place, so it never picks up a
  // local-derived record either), just triggered by deactivation of an
  // otherwise fully-configured row instead of missing config.
  test('a GitHub-bound field reading a deactivated (but otherwise fully-configured) connector never binds at all -- same plain, freely-editable rendering as the no-config case', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.priority.linkedSourceId = 'related';
    doc.fieldDefs.priority.rule = "source.github ? (source.github.labels.includes('bug') ? 'Bug' : 'Other') : null";
    doc.fieldDefs.priority.type = 'text';
    doc.fieldDefs.related = doc.fieldDefs.related || { label: 'Related', type: 'text' };
    const issue = doc.issues[0];
    h.pushFieldEntry(issue, 'related', 'o/r#1', { id: 'h-related3', actor: 'test', sortKey: 9201, href: h.githubHref('o', 'r', 1) });
    h.pushFieldEntry(issue, 'priority', 'some manual note', { id: 'h-priority3', actor: 'test', sortKey: 9202 });
    await h.writeActiveMilestoneDoc(page, doc);
    // A real, fully-configured GitHub row -- deactivated, not merely
    // unconfigured, so this isolates enabled:false specifically.
    await page.evaluate(() => {
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({
        connectors: [{ id: '__builtin_github', key: 'github', kind: 'github', name: 'GitHub', builtin: true, rootUrl: 'https://api.github.com', username: '', credentialConfigured: false, enabled: false }]
      }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, 'priority');
    await expect(cell).toContainText('some manual note');
    await expect(cell.locator('svg')).toHaveCount(0);
  });
});
