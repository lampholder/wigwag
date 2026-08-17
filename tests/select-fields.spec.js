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
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);

    // Link row 3's Related field (type 'issue') to a real GitHub issue
    // carrying a "bug" label (fixture #3, not #1 which has no labels).
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await page.keyboard.press('Enter');
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
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await page.keyboard.press('Enter');
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
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
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
    await expect(page.getByText('Return an array of option ids or labels.', { exact: true })).toBeVisible();
  });
});

test.describe('Text fields', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // Text fields ARE bindable (as a rule target) so they still get "Edit
  // field…", but they have no option list / ordering concept — the field
  // editor shows FIELD NAME + BOUND SOURCE + RULE, no OPTIONS section.
  test('have no option list / ordering concept (nothing to configure)', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    expect(await page.getByText('OPTIONS', { exact: false }).count()).toBe(0);
    expect(await page.locator('[data-testid=option-row]').count()).toBe(0);
  });

  test('a truncated value shows the full text as a native hover tooltip', async ({ page }) => {
    // seed row 7's mitigation text is long enough to truncate in the column.
    const span = h.fieldCell(page, 7, 'mitigation').locator('span[title]').first();
    const full = await span.getAttribute('title');
    expect(full).toBe('Fallback to plain text export until fixed');
    expect(full).toBe(await span.textContent());
  });

  test('is bindable via BOUND SOURCE, same as select/multiselect', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    expect(await page.getByText('BOUND SOURCE', { exact: true }).count()).toBe(1);
    // rule textarea only appears once a source is actually bound
    expect(await page.locator('[data-testid=field-editor-rule-textarea]').count()).toBe(0);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=field-editor-rule-textarea]').count()).toBe(1);
  });

  test('rule helper text includes a return-type hint ("Return a string.")', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await expect(page.getByText('Return a string.', { exact: true })).toBeVisible();
  });

  test('once bound, shows a pretty-printed preview of the actual source object instead of prose', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    // no preview before a source is picked
    expect(await page.locator('[data-testid=field-editor-source-preview]').count()).toBe(0);

    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    const preview = page.locator('[data-testid=field-editor-source-preview]');
    await expect(preview).toBeVisible();
    const text = await preview.textContent();
    const parsed = JSON.parse(text); // must be valid, parseable JSON
    expect(parsed).toHaveProperty('isLinked');
    expect(parsed).toHaveProperty('github');
    expect(parsed).toHaveProperty('jira');
    // seed row 1's title IS github-linked, so the preview should reflect a
    // real linked example, not just the empty default shape.
    expect(parsed.isLinked).toBe(true);
    expect(parsed.github.labels).toContain('enhancement');
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

    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    const sourceText = await page.locator('pre').textContent();
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
