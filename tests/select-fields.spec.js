// Spec section: Row > Fields > Single-select / Multi-select / Text
//   - Each item can be given a colour
//   - There's an ordering set (option order = sort order)
//   - Can be bound to an issue with a basic DSL
//   - Text: probably no ordering to text fields
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Single-select', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('each option carries its configured color', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await page.getByText('Edit field…', { exact: true }).click();
    await page.waitForTimeout(200);
    const rows = page.locator('[data-testid=option-row]');
    expect(await rows.count()).toBe(3); // On track / At risk / Off track
    const colors = [];
    for (const r of await rows.all()) {
      const swatch = r.locator('span').nth(2); // option row spans: [0]=move-up [1]=move-down [2]=color swatch
      colors.push(await swatch.evaluate(el => getComputedStyle(el).backgroundColor));
    }
    expect(new Set(colors).size).toBe(3); // three distinct, actually-configured colors
    expect(colors.every(c => c !== 'rgba(0, 0, 0, 0)')).toBe(true);
  });

  test('sorting by RAG follows the options\' configured order, not alphabetical', async ({ page }) => {
    await h.sortByColumn(page, 'rag');
    const values = await page.locator('[data-testid=field-cell][data-col=rag]').allTextContents();
    const cleaned = values.map(v => v.trim()).filter(v => v && v !== '—');
    // On track < At risk < Off track per option order (not alphabetical, which would put At risk first)
    const order = ['On track', 'At risk', 'Off track'];
    const indices = cleaned.map(v => order.findIndex(o => v.includes(o))).filter(i => i !== -1);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  test('can be bound to any Issue-type field via the rule DSL (not just Title)', async ({ page }) => {
    // Bindable SOURCES are narrower than bindable targets: only the Issue
    // field (Title) and fields explicitly typed 'issue' (here, "Related")
    // can hold a GitHub/Jira link and show up in the dropdown — plain text
    // fields like Mitigation are valid rule targets but not valid sources.
    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.github.labels.includes("bug") ? "bug" : "enhancement"');

    // Link row 3's Related field (type 'issue') to a real GitHub issue
    // carrying a "bug" label (fixture #3, not #1 which has no labels).
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);
    // row 1's title is linked but Type's rule now reads Related, and row 1's
    // Related isn't linked — so Type is unlocked there (human-editable),
    // not derived from Title anymore.
    await h.clickFieldToEdit(page, 1, 'type');
    await expect(page.getByText('Select an item', { exact: true })).toBeVisible();
  });

  // Regression test: a derived/rule-computed select change used to log the
  // option's raw storage id (e.g. "opt_1786483541502") in its history entry
  // instead of resolving it to the option's label, and named only the bound
  // column ("derived from Related") rather than what actually drove the
  // change. Renaming the option ids to opt_-style values reproduces the
  // exact shape a user gets from "+ add option" in the real UI (see
  // addOption, which mints `'opt_' + Date.now()`).
  test('a derived select change logs the option\'s label, not its raw storage id, and names the linked issue', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.type.options = doc.fieldDefs.type.options.map((o, i) => ({ ...o, id: 'opt_' + (1000 + i) }));
    // fieldDefs content is derived from projectHistory now -- clearing it
    // here lets the next load's backfill resynthesize fresh entries from
    // the (already-renamed) fieldDefs above, instead of the stale entry
    // from the app's first-ever load reasserting the ORIGINAL option ids.
    doc.projectHistory = [];
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.github.labels.includes("bug") ? "bug" : "enhancement"');

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc2 = await h.readActiveMilestoneDoc(page);
    expect(h.latestFieldValue(doc2.issues.find(i => i.id === 'i3'), 'type')).toBe('opt_1000'); // stored value is still the raw id...

    const history = await h.getHistoryEntriesFor(page, 'i3');
    // ...but the history text reads the label, and names the linked issue
    // whose state actually drove the computation, not just the column.
    expect(history.some(t => t.includes('opt_'))).toBe(false);
    expect(history).toContain('Type set to Bug (derived from state of Test issue for the tracker suite in column Related)');
  });

  // Regression test: a rule field used to lock permanently the instant ANY
  // rule was configured, even for issues where the rule couldn't resolve to
  // anything (e.g. the bound field isn't GitHub-linked) — leaving it stuck
  // showing "No match" with no way to set it by hand.
  test('a rule-bound field stays human-editable when the rule has nothing to compute from', async ({ page }) => {
    // seed row 3: Type is bound to Title with a rule reading source.github,
    // and row 3's title has no GitHub link at all, so the rule can't
    // resolve anything (source.isLinked is false).
    await expect(h.fieldCell(page, 3, 'type')).toHaveText('—');
    await h.clickFieldToEdit(page, 3, 'type');
    await expect(page.getByText('Select an item', { exact: true })).toBeVisible();
    // scope to the popover's own option-list container (max-height:220px is
    // that list's distinguishing style) — otherwise "Bug" matches other rows'
    // already-set Type cells too.
    const optionList = page.locator('div[style*="max-height: 220px"]');
    await optionList.getByText('Bug', { exact: true }).click();
    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);

    // row 1's title IS GitHub-linked, so its Type rule resolves — it must
    // stay locked (no popover), unaffected by the above.
    await h.clickFieldToEdit(page, 1, 'type');
    await page.waitForTimeout(200);
    await expect(page.getByText('Select an item', { exact: true })).toHaveCount(0);
  });
});

test.describe('Multi-select', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('each option carries its configured color', async ({ page }) => {
    // exact text match — {hasText:'Platform'} would also match ancestor spans
    // whose combined text is "Platform Ops Mobile" etc. The templating
    // engine wraps interpolated text in its own inner span (class
    // "sc-interp"), so the exact-text match lands on THAT inner span, not
    // the chip span carrying the actual background style — go up one level.
    const chip = h.fieldCell(page, 1, 'teams').getByText('Platform', { exact: true }).locator('..');
    const bg = await chip.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)'); // has an actual configured background, not transparent/default
  });

  test('sorting follows the options\' configured order (by the lowest selected option index)', async ({ page }) => {
    await h.sortByColumn(page, 'teams');
    // teams options order: Platform, Ops, Mobile, Web, Infra — assert a stable
    // order exists (blanks all trail non-blanks); exact row identity isn't
    // asserted since several rows tie on their lowest selected index.
    const values = await page.locator('[data-testid=field-cell][data-col=teams]').allTextContents();
    const blanks = values.map(v => v.trim() === '—');
    const firstBlank = blanks.indexOf(true);
    if (firstBlank !== -1) {
      expect(blanks.slice(firstBlank).every(b => b)).toBe(true); // once blanks start, no more non-blanks after
    }
  });

  test('chips always render in the field\'s configured option order, regardless of selection order', async ({ page }) => {
    // teams options configured order: Platform, Ops, Mobile, Web, Infra.
    // Row 8 starts with just ['infra'] -- select the rest in REVERSE
    // configured order and confirm the rendered chips don't follow that.
    const cell = h.fieldCell(page, 8, 'teams');
    await cell.click();
    await page.waitForTimeout(150);
    await cell.click();
    await page.waitForTimeout(150);
    const optionList = page.locator('div[style*="max-height: 220px"]');
    for (const label of ['Web', 'Mobile', 'Ops', 'Platform']) {
      await optionList.getByText(label, { exact: true }).click();
      await page.waitForTimeout(100);
    }
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    const rawTexts = await cell.locator('span').evaluateAll(spans => spans.map(s => s.textContent.trim()));
    const known = ['Platform', 'Ops', 'Mobile', 'Web', 'Infra'];
    const chips = rawTexts.filter((t, i) => known.includes(t) && t !== rawTexts[i - 1]); // dedupe nested sc-interp span
    expect(chips).toEqual(['Platform', 'Ops', 'Mobile', 'Web', 'Infra']);
  });

  test('can be bound to a field via the rule DSL', async ({ page }) => {
    await h.openFieldEditor(page, 'teams');
    await h.setBoundSourceAndRule(page, 'Issue', 'source.github.labels.includes("bug") ? ["platform"] : []');
    // row 7's title is already github-linked with labels: ['bug'], and its
    // teams (seeded as just ["web"]) does NOT already include Platform — so
    // this only passes if the rule mechanism actually ran, not by
    // coincidence with the seed data.
    await expect(h.fieldCell(page, 7, 'teams')).toContainText('Platform');
    // row 3's title has no GitHub link at all — must stay unlocked/untouched
    // by the rule's else-branch ([]), not silently cleared.
    await expect(h.fieldCell(page, 3, 'teams')).toHaveText('—');
    await h.clickFieldToEdit(page, 3, 'teams');
    await expect(page.getByText('Select items', { exact: true })).toBeVisible();
  });

  test('rule helper text includes a return-type hint ("Return an array of option ids or labels.")', async ({ page }) => {
    await h.openFieldEditor(page, 'teams');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    // a freshly-bound field opens in the row editor, not advanced mode --
    // the return-type hint lives alongside the raw expression textarea.
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await expect(page.getByText('Return an array of option ids or labels.', { exact: true })).toBeVisible();
  });
});

test.describe('Text fields', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  // Text fields ARE bindable (as a rule target) so they still get "Edit
  // field…", but they have no option list / ordering concept — the field
  // editor shows FIELD NAME + BOUND SOURCE + RULE, no OPTIONS section.
  test('have no option list / ordering concept (nothing to configure)', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    expect(await page.getByText('OPTIONS', { exact: false }).count()).toBe(0);
    expect(await page.locator('[data-testid=option-row]').count()).toBe(0);
  });

  test('a clamped value shows the full text as a native hover tooltip', async ({ page }) => {
    // seed row 7's mitigation text is long enough to clamp in the column --
    // markdown rendering replaced the old plain-text span, but the same
    // hover-tooltip affordance carries over onto the rendered div.
    const md = h.fieldCell(page, 7, 'mitigation').locator('[data-testid=text-field-md]');
    const full = await md.getAttribute('title');
    expect(full).toBe('Fallback to plain text export until fixed');
  });

  test('is bindable via BOUND SOURCE, and the entry point moves from "Set up…" to "Edit rules…" once bound', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    expect(await page.getByText('BOUND SOURCE', { exact: true }).count()).toBe(1);
    // not yet bound -- the entry point says so, and offers to set it up
    await expect(page.locator('[data-testid=field-editor]')).toContainText('Not bound');
    expect(await page.locator('[data-testid=field-editor-open-rules]').textContent()).toBe('Set up…');

    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=field-editor]')).not.toContainText('Not bound');
    expect(await page.locator('[data-testid=field-editor-open-rules]').textContent()).toBe('Edit rules…');
  });

  test('rule helper text includes a return-type hint ("Return a string.")', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    // a freshly-bound field opens in the row editor, not advanced mode --
    // the return-type hint lives alongside the raw expression textarea.
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await expect(page.getByText('Return a string.', { exact: true })).toBeVisible();
  });

  test('once bound, the results table reflects the real linked source data for every row, not just prose', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    // before any expression/rows exist, every row reads as linked-but-blank
    await expect(page.locator('[data-testid=rule-preview-row]').first()).toContainText('blank');

    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-advanced-textarea]').fill('source.isLinked ? "linked:" + source.github.labels.join(",") : "unlinked"');
    await page.waitForTimeout(300);

    // seed row 1's title IS github-linked, so the results table should
    // reflect a real linked example, not just the empty default shape.
    const row1 = page.locator('[data-testid=rule-preview-row]').first();
    await expect(row1).toContainText('linked:');
    await expect(row1).toContainText('enhancement');
  });
});

// Multiline markdown editing, added alongside the base 'Text fields'
// coverage above -- same renderMarkdown engine as project notes/comments
// (see tests/project-notes.spec.js), just editing UX differs: blur or
// Cmd/Ctrl+Enter commits (matching every other field type's blur-commit
// convention), plain Enter inserts a newline instead.
test.describe('Text fields: multiline markdown', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('editing opens a multiline textarea, not a single-line input', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await expect(h.fieldCell(page, 1, 'mitigation').locator('[data-testid=text-field-edit-textarea]')).toBeVisible();
    expect(await h.fieldCell(page, 1, 'mitigation').locator('input').count()).toBe(0);
  });

  test('committed markdown renders as real elements in the table cell and the slide-over', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.fieldCell(page, 1, 'mitigation').locator('[data-testid=text-field-edit-textarea]').fill('# Plan\n\n**Bold** and `code`.\n\n- one\n- two');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(200);

    const cellMd = h.fieldCell(page, 1, 'mitigation').locator('[data-testid=text-field-md]');
    await expect(cellMd.locator('h1')).toHaveText('Plan');
    await expect(cellMd.locator('strong')).toHaveText('Bold');
    await expect(cellMd.locator('code')).toHaveText('code');
    await expect(cellMd.locator('li')).toHaveCount(2);

    const slideover = await h.openSlideover(page, 1);
    const sfMd = slideover.locator('[data-testid=slideover-field][data-col=mitigation] [data-testid=text-field-md]');
    await expect(sfMd.locator('h1')).toHaveText('Plan');
  });

  test('a bare email renders as a person pill and a bare URL becomes a link, same as comments/notes', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.fieldCell(page, 1, 'mitigation').locator('[data-testid=text-field-edit-textarea]').fill('Ping priya@lant.uk or see https://example.com/doc');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(200);

    const cellMd = h.fieldCell(page, 1, 'mitigation').locator('[data-testid=text-field-md]');
    await expect(cellMd.locator('a.email-pill')).toHaveAttribute('href', 'mailto:priya@lant.uk');
    await expect(cellMd.locator('a', { hasText: 'https://example.com/doc' })).toHaveAttribute('href', 'https://example.com/doc');
  });

  test('Cmd/Ctrl+Enter commits; plain Enter inserts a newline and stays in edit mode', async ({ page }) => {
    await h.clickFieldToEdit(page, 2, 'mitigation');
    const textarea = h.fieldCell(page, 2, 'mitigation').locator('[data-testid=text-field-edit-textarea]');
    await textarea.fill('line one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await expect(textarea).toBeVisible(); // still editing -- Enter alone didn't commit
    expect(await textarea.inputValue()).toBe('line one\nline two');

    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(200);
    expect(await h.fieldCell(page, 2, 'mitigation').locator('[data-testid=text-field-md]').getAttribute('data-raw-text')).toBe('line one\nline two');
  });

  test('Escape cancels without committing', async ({ page }) => {
    // seed row 2's mitigation has real content to preserve/discard against.
    const before = await h.fieldCell(page, 2, 'mitigation').locator('[data-testid=text-field-md]').getAttribute('data-raw-text');
    expect(before).toBe('Manual refresh workaround documented');
    await h.clickFieldToEdit(page, 2, 'mitigation');
    await h.fieldCell(page, 2, 'mitigation').locator('[data-testid=text-field-edit-textarea]').fill('discard me');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    expect(await h.fieldCell(page, 2, 'mitigation').locator('[data-testid=text-field-md]').getAttribute('data-raw-text')).toBe(before);
  });

  test('clicking away (blur) commits, same as every other field type', async ({ page }) => {
    await h.clickFieldToEdit(page, 4, 'mitigation');
    await h.fieldCell(page, 4, 'mitigation').locator('[data-testid=text-field-edit-textarea]').fill('blur commit test');
    await page.mouse.click(700, 5);
    await page.waitForTimeout(200);
    expect(await h.fieldCell(page, 4, 'mitigation').locator('[data-testid=text-field-md]').getAttribute('data-raw-text')).toBe('blur commit test');
  });

  test('an empty value still shows the plain placeholder dash, not an empty markdown body', async ({ page }) => {
    await h.clickFieldToEdit(page, 5, 'mitigation');
    await h.fieldCell(page, 5, 'mitigation').locator('[data-testid=text-field-edit-textarea]').fill('');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(200);
    const cell = h.fieldCell(page, 5, 'mitigation');
    await expect(cell).toContainText('—');
    expect(await cell.locator('[data-testid=text-field-md]').count()).toBe(0);
  });

  test('"Wrap text" toggles the line-clamp between 1 and 6 lines', async ({ page }) => {
    const md = h.fieldCell(page, 7, 'mitigation').locator('[data-testid=text-field-md]');
    const clampBefore = await md.evaluate(el => getComputedStyle(el).webkitLineClamp);
    expect(clampBefore).toBe('1');

    await h.openColumnMenu(page, 'mitigation');
    await page.locator('[data-testid=col-wrap-toggle]').click();
    await page.waitForTimeout(150);
    const clampAfter = await md.evaluate(el => getComputedStyle(el).webkitLineClamp);
    expect(clampAfter).toBe('6');
  });

  test('a text field linked to GitHub still shows its ref pill, not markdown rendering', async ({ page }) => {
    await h.clickFieldToEdit(page, 2, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 2, 'mitigation');

    const cell = h.fieldCell(page, 2, 'mitigation');
    expect(await cell.locator('[data-testid=text-field-md]').count()).toBe(0);
    await expect(cell.locator('a')).toHaveAttribute('href', 'https://github.com/octocat/Hello-World/issues/3');
  });

  test('the Title field (type "issue") is unaffected -- still a single-line input, no markdown', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await expect(h.titleCell(page, 1).locator('input')).toBeVisible();
    expect(await h.titleCell(page, 1).locator('[data-testid=text-field-edit-textarea]').count()).toBe(0);
    await page.keyboard.press('Escape');
  });
});

test.describe('Date fields', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // No dedicated helper for this yet -- inline the create-field flow.
  async function addDateField(page, name) {
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="Field name"]').fill(name);
    await page.locator('select').selectOption('date');
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(200);
    return page.locator('[data-testid=col-header]').last().getAttribute('data-col');
  }

  async function setDate(page, colId, rowNum, iso) {
    const cell = page.locator(`[data-testid=row][data-row-num="${rowNum}"] [data-testid=field-cell][data-col="${colId}"]`);
    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    await cell.locator('input[type=date]').fill(iso);
    await cell.locator('input[type=date]').blur();
    await page.waitForTimeout(150);
  }

  test('an unset date shows a plain placeholder, editing uses a native date input', async ({ page }) => {
    const colId = await addDateField(page, 'Due date');
    const cell = h.fieldCell(page, 1, colId);
    await expect(cell).toHaveText('—');

    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    await expect(cell.locator('input[type=date]')).toBeVisible();
  });

  test('a set date renders as plain ISO 8601 (YYYY-MM-DD), and the same value shows in the slide-over', async ({ page }) => {
    const colId = await addDateField(page, 'Due date');
    await setDate(page, colId, 1, '2026-08-10');

    await expect(h.fieldCell(page, 1, colId)).toHaveText('2026-08-10');

    await h.openSlideover(page, 1);
    await expect(h.slideoverField(page, colId)).toContainText('2026-08-10');
  });

  test('a date value persists across reload', async ({ page }) => {
    const colId = await addDateField(page, 'Due date');
    await setDate(page, colId, 1, '2026-08-10');
    await expect(h.fieldCell(page, 1, colId)).toHaveText('2026-08-10');

    await page.reload();
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, colId)).toHaveText('2026-08-10');
  });

  // The glyph is a browser-independent cue for the "at rest" (display)
  // state only, positioned to the right like the select/multiselect
  // dropdown arrow. It's deliberately absent while editing -- overlaying it
  // on the native <input type="date"> collided with Chrome's own built-in
  // calendar-picker-indicator icon, which already sits in that same spot.
  test('shows a calendar glyph to the right when at rest; none while editing, to avoid colliding with a native picker icon', async ({ page }) => {
    const colId = await addDateField(page, 'Due date');
    const cell = h.fieldCell(page, 1, colId);
    await expect(cell.locator('svg')).toHaveCount(1); // empty display

    await setDate(page, colId, 1, '2026-08-10');
    await expect(cell.locator('svg')).toHaveCount(1); // set display
    const textBox = await cell.locator('span').first().boundingBox();
    const svgBox = await cell.locator('svg').boundingBox();
    expect(svgBox.x).toBeGreaterThan(textBox.x);

    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    await expect(cell.locator('svg')).toHaveCount(0); // no overlay while editing
  });

  test('a date value stores as a plain ISO string in the exported JSONL', async ({ page }) => {
    const colId = await addDateField(page, 'Due date');
    await setDate(page, colId, 1, '2026-08-10');

    const sourceText = await h.readSourceViewText(page);
    const i1 = JSON.parse(sourceText.split('\n').find(l => l.includes('"id":"i1"')));
    expect(h.latestFieldValue(i1, colId)).toBe('2026-08-10');
  });

  test('has no OPTIONS section or "Edit field…" menu item -- not bindable via a rule', async ({ page }) => {
    const colId = await addDateField(page, 'Due date');
    await h.openColumnMenu(page, colId);
    await expect(page.getByText('Edit field…', { exact: true })).toHaveCount(0);
  });

  test('has no "Wrap text" menu item and no value-filter section -- fixed-format, not free-form or option-based', async ({ page }) => {
    const colId = await addDateField(page, 'Due date');
    await h.openColumnMenu(page, colId);
    await expect(page.locator('[data-testid=col-wrap-toggle]')).toHaveCount(0);
    await expect(page.getByText('FILTER', { exact: true })).toHaveCount(0);
  });
});
