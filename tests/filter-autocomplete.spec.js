// Tracker #113 (bcee4751): the filter bar accepts GitHub-Projects-style
// `field:value` tokens (typed into the same filter-input box the plain
// keyword search already used), with two-stage autocomplete -- a
// colon-less in-progress token suggests matching field labels; a
// completed `label:` (a recognized label) suggests that field's values.
// This is an independent, always-live filter layer, ANDed with the
// classic keyword substring match and with whatever the separate
// checkbox-based column filters are doing -- neither of those existing
// mechanisms changes.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Filter bar: field:value autocomplete', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the placeholder reads "Filter this project" (tracker #144: the box lost its #id jump behavior to global search)', async ({ page }) => {
    await expect(page.locator('[data-testid=filter-input]')).toHaveAttribute('placeholder', 'Filter this project');
  });

  test('the suggestion panel overlays the table (position:fixed) instead of pushing it down, and the filter box keeps its normal border', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    const wrap = page.locator('[data-testid=filter-input-wrap]');
    const table = page.locator('[data-testid=table-region]');

    const tableTopBefore = (await table.boundingBox()).y;
    const borderBefore = await wrap.evaluate(el => getComputedStyle(el).borderColor);

    await input.click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toBeVisible();

    const tableTopAfter = (await table.boundingBox()).y;
    expect(tableTopAfter).toBe(tableTopBefore); // the table never moves

    const borderAfter = await wrap.evaluate(el => getComputedStyle(el).borderColor);
    expect(borderAfter).toBe(borderBefore); // the input's own border is untouched

    const panelBox = await page.locator('[data-testid=filter-suggest-panel]').boundingBox();
    const inputBox = await input.boundingBox();
    expect(panelBox.y).toBeGreaterThan(inputBox.y); // sits below the input
    expect(panelBox.y).toBeLessThan(tableTopAfter + 50); // overlapping the table area, not pushed above it
  });

  // Regression: the panel's border referenced an undefined CSS variable
  // (--c6, never actually declared in either palette) -- an invalid var()
  // invalidates the whole `border` shorthand at computed-value time, so
  // the border silently rendered as nothing in BOTH light and dark mode.
  // Masked in light mode by the box-shadow alone giving some definition;
  // obvious in dark mode as a borderless, edge-less panel.
  test('the panel has a real, visible border (not an undefined CSS variable) in both light and dark mode', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    const panel = page.locator('[data-testid=filter-suggest-panel]');
    // A reference swatch that explicitly uses --border, resolved through
    // the same computed-style machinery, sidesteps any color-format
    // quirk in comparing directly against the raw CSS variable text.
    const expectedBorderColor = () => page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.borderColor = 'var(--border)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).borderColor;
      probe.remove();
      return color;
    });

    await input.click();
    await page.waitForTimeout(150);
    const lightBorder = await panel.evaluate(el => getComputedStyle(el).borderColor);
    expect(lightBorder).toBe(await expectedBorderColor());

    await page.locator('[data-testid=btn-appearance]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);
    await input.click();
    await page.waitForTimeout(150);
    const darkBorder = await panel.evaluate(el => getComputedStyle(el).borderColor);
    expect(darkBorder).toBe(await expectedBorderColor());
    expect(darkBorder).not.toBe(lightBorder); // themes genuinely differ, both real
  });

  // Regression: the active (keyboard-highlighted) row's background was a
  // hardcoded near-white oklch literal, not a theme-aware variable --
  // legible in light mode, but rendered as a near-white box behind dark
  // mode's own light text (effectively white-on-white).
  test('the active suggestion row is legible in dark mode (background and text are genuinely different, not both near-white)', async ({ page }) => {
    await page.locator('[data-testid=btn-appearance]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);

    await page.locator('[data-testid=filter-input]').click();
    await page.waitForTimeout(150);
    const activeRow = page.locator('[data-testid=filter-suggest-row]').first();
    const bg = await activeRow.evaluate(el => getComputedStyle(el).backgroundColor);
    const textColor = await activeRow.evaluate(el => getComputedStyle(el.querySelector('span')).color);
    expect(bg).not.toBe(textColor);
    // Specifically the real dark --surface-selected token, not a stray
    // light-mode literal that happened to survive.
    const expectedBg = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--surface-selected)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(bg).toBe(expectedBg);
  });

  // Live-reported (Tom): arrowing down through the suggestion list could
  // move the highlighted row below the panel's own visible area without
  // the panel scrolling to follow -- the highlight effectively vanished
  // off-screen. scrollIntoView({block:'nearest'}) only moves the panel
  // when the active row is actually out of view.
  test('arrowing down past the visible panel scrolls the active suggestion into view', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    const panel = page.locator('[data-testid=filter-suggest-panel]');
    await input.click();
    await page.waitForTimeout(150);

    const rowCount = await page.locator('[data-testid=filter-suggest-row]').count();
    expect(rowCount).toBeGreaterThan(3); // enough fields that the panel's own max-height actually clips some

    for (let i = 0; i < rowCount - 1; i++) {
      await input.press('ArrowDown');
    }
    await page.waitForTimeout(100);

    const activeRow = page.locator('[data-testid=filter-suggest-row][data-active="true"]');
    const activeBox = await activeRow.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(activeBox.y).toBeGreaterThanOrEqual(panelBox.y - 1);
    expect(activeBox.y + activeBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
  });

  test('the panel sits a small (~3px), non-overlapping gap below the input\'s own visible border, not the bare input element', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    const wrap = page.locator('[data-testid=filter-input-wrap]');
    await input.click();
    await page.waitForTimeout(150);
    const wrapBox = await wrap.boundingBox();
    const panelBox = await page.locator('[data-testid=filter-suggest-panel]').boundingBox();
    const gap = panelBox.y - (wrapBox.y + wrapBox.height);
    expect(gap).toBeGreaterThanOrEqual(2);
    expect(gap).toBeLessThanOrEqual(4);
  });

  test('the item list is capped to ~6 rows and scrolls for the rest, instead of growing unbounded', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await page.waitForTimeout(150);
    const panel = page.locator('[data-testid=filter-suggest-panel]');
    // The demo fixture has 7 filterable fields (Created/Updated, tracker
    // #148's always-present timestamp fields, are deliberately excluded
    // from field-name suggestions -- see computeFilterSuggestions's own
    // comment) -- comfortably more than the cap, so this also exercises
    // the actual scroll (not just an untested style).
    await expect(page.locator('[data-testid=filter-suggest-row]')).toHaveCount(7);
    const info = await panel.evaluate(el => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }));
    expect(info.overflowY).toBe('auto');
    expect(info.scrollHeight).toBeGreaterThan(info.clientHeight); // has more content than fits
    expect(info.clientHeight).toBeLessThan(230); // roughly 6 rows' worth, not all 7
  });

  test('clicking into an empty box shows every filterable field, before typing anything', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    const panel = page.locator('[data-testid=filter-suggest-panel]');
    await expect(panel).toHaveCount(0); // nothing shown before any interaction
    await input.click();
    await page.waitForTimeout(150);
    await expect(panel).toBeVisible();
    const rows = page.locator('[data-testid=filter-suggest-row]');
    await expect(rows).toContainText(['Issue', 'Related', 'Type', 'Priority', 'RAG', 'Delivery teams', 'Mitigation']);
  });

  test('the shown-on-focus field list narrows as you type, same as normal', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await page.waitForTimeout(150);
    const rows = page.locator('[data-testid=filter-suggest-row]');
    expect(await rows.count()).toBeGreaterThan(1);
    await input.type('ra');
    await page.waitForTimeout(150);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('RAG');
  });

  test('clicking a suggested field name returns keyboard focus to the filter box so typing continues with no extra click', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=filter-suggest-row]').filter({ hasText: 'RAG' }).first().click();
    await page.waitForTimeout(150);
    await expect(input).toHaveValue('RAG:');
    expect(await input.evaluate(el => el === document.activeElement)).toBe(true);
    await page.keyboard.type('on');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-row]').first()).toContainText('On track');
  });

  test('after committing a value, focus stays put but the panel closes -- no trailing space, and no field suggestions until the user types their own separating space', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('RAG:on');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=filter-suggest-row]').first().click();
    await page.waitForTimeout(150);
    await expect(input).toHaveValue('RAG:"On track"'); // no trailing space
    expect(await input.evaluate(el => el === document.activeElement)).toBe(true); // cursor stays put
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toHaveCount(0); // closed, not lingering on the just-picked value

    // The user's OWN separating space reopens it with every field.
    await page.keyboard.type(' ');
    await page.waitForTimeout(150);
    const rows = page.locator('[data-testid=filter-suggest-row]');
    await expect(rows).toContainText(['Issue', 'Related', 'Type', 'Priority', 'RAG', 'Delivery teams', 'Mitigation']);
  });

  test('clicking a second suggested field after a real trailing space ADDS a new token instead of replacing the first one, and both criteria filter together', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('RAG:on');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=filter-suggest-row]').first().click(); // -> RAG:"On track"
    await page.waitForTimeout(150);
    await page.keyboard.type(' ');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=filter-suggest-row]').filter({ hasText: 'Priority' }).first().click();
    await page.waitForTimeout(150);
    await expect(input).toHaveValue('RAG:"On track" Priority:');
    await page.keyboard.type('p0');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=filter-suggest-row]').first().click();
    await page.waitForTimeout(150);
    await expect(input).toHaveValue('RAG:"On track" Priority:P0');

    const rows2 = await page.locator('[data-testid=row]').count();
    expect(rows2).toBeGreaterThan(0);
    for (const row of await page.locator('[data-testid=row]').all()) {
      await expect(row.locator('[data-col=rag]')).toContainText('On track');
      await expect(row.locator('[data-col=priority]')).toContainText('P0');
    }
  });

  test('typing a partial field name suggests matching field labels', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('ra');
    await page.waitForTimeout(150);
    const panel = page.locator('[data-testid=filter-suggest-panel]');
    await expect(panel).toBeVisible();
    const rows = page.locator('[data-testid=filter-suggest-row]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('RAG');
    await expect(rows.first()).toContainText('FIELD');
  });

  test('selecting a field suggestion inserts "Label:" and immediately opens that field\'s value suggestions', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('ra');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=filter-suggest-row]').first().click();
    await page.waitForTimeout(150);
    await expect(input).toHaveValue('RAG:');
    const rows = page.locator('[data-testid=filter-suggest-row]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('On track');
    await expect(rows.nth(1)).toContainText('At risk');
    await expect(rows.nth(2)).toContainText('Off track');
  });

  test('selecting a value suggestion commits the token (quoted, since "On track" has a space) and filters the table', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('RAG:on');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=filter-suggest-row]').first().click();
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('RAG:"On track"');
    const rowCount = await page.locator('[data-testid=row]').count();
    expect(rowCount).toBeGreaterThan(0);
    for (const cell of await page.locator('[data-testid=field-cell][data-col=rag]').all()) {
      await expect(cell).toContainText('On track');
    }
  });

  test('a multiselect field ("Delivery teams") offers value autocomplete the same way, and filters correctly', async ({ page }) => {
    // A multi-word field LABEL only round-trips quoted, same rule as a
    // multi-word VALUE -- exercised via the autocomplete flow itself
    // (which quotes automatically), not by hand-typing the raw label.
    const input = page.locator('[data-testid=filter-input]');
    const rows = page.locator('[data-testid=filter-suggest-row]');
    await input.click();
    await input.fill('deliv');
    await page.waitForTimeout(150);
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await page.waitForTimeout(150);
    await expect(input).toHaveValue('"Delivery teams":');
    await input.press('End');
    await page.keyboard.type('inf');
    await page.waitForTimeout(150);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Infra');
    await rows.first().click();
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('"Delivery teams":Infra');
    for (const cell of await page.locator('[data-testid=field-cell][data-col=teams]').all()) {
      await expect(cell).toContainText('Infra');
    }
  });

  test('keyboard: ArrowDown then Enter selects a suggestion, same as clicking it', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('typ');
    await page.waitForTimeout(150);
    await input.press('ArrowDown');
    await input.press('Enter');
    await page.waitForTimeout(150);
    await expect(input).toHaveValue('Type:');
  });

  test('Escape dismisses the suggestion panel without clearing the typed text', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('mit');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toBeVisible();
    await input.press('Escape');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toHaveCount(0);
    await expect(input).toHaveValue('mit');
  });

  test('clicking outside dismisses the suggestion panel without clearing the typed text', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('ra');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toBeVisible();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toHaveCount(0);
    await expect(input).toHaveValue('ra');
  });

  test('a field:value token ANDs with plain keyword text -- a bogus keyword alongside a real token hides everything', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.fill('RAG:"On track" thiswillneverappearanywhere');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
  });

  test('two tokens on the SAME field OR together; two tokens on DIFFERENT fields AND together', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.fill('RAG:"On track" RAG:"At risk"');
    await page.waitForTimeout(300);
    const orCount = await page.locator('[data-testid=row]').count();
    let onTrack = 0, atRisk = 0;
    for (const cell of await page.locator('[data-testid=field-cell][data-col=rag]').all()) {
      const text = await cell.textContent();
      if (text.includes('On track')) onTrack++;
      if (text.includes('At risk')) atRisk++;
    }
    expect(orCount).toBe(onTrack + atRisk);
    expect(orCount).toBeGreaterThan(0);

    // AND across fields: combine with a Type that has zero overlap with RAG:On track
    await input.fill('RAG:"On track" Type:Chore');
    await page.waitForTimeout(300);
    const bothCount = await page.locator('[data-testid=row]').count();
    expect(bothCount).toBeLessThanOrEqual(onTrack);
    for (const row of await page.locator('[data-testid=row]').all()) {
      await expect(row.locator('[data-testid=field-cell][data-col=rag]')).toContainText('On track');
      await expect(row.locator('[data-testid=field-cell][data-col=type]')).toContainText('Chore');
    }
  });

  test('a text field (Mitigation) has no enumerable values, so it offers no value autocomplete -- but a manually-typed token still substring-filters', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('Mitigation:');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toHaveCount(0);

    // seed row 7's mitigation text is "Fallback to plain text export until fixed"
    await input.fill('Mitigation:fallback');
    await page.waitForTimeout(300);
    const rowCount = await page.locator('[data-testid=row]').count();
    expect(rowCount).toBeGreaterThan(0);
    for (const cell of await page.locator('[data-testid=field-cell][data-col=mitigation]').all()) {
      await expect(cell).toContainText(/fallback/i);
    }
  });

  test('a synthesized comment-stream field (Comments) is never offered as a field suggestion', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    await input.click();
    await input.fill('comm');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toHaveCount(0);
  });

  test('an unrecognized label falls back to plain keyword search instead of matching nothing', async ({ page }) => {
    const input = page.locator('[data-testid=filter-input]');
    // "bogus:value" isn't a real field -- treated as two ordinary keywords,
    // neither of which should match anything real, but crucially this must
    // not crash or behave differently from a normal empty keyword result.
    await input.fill('bogus:value');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=filter-suggest-panel]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
  });

  test.describe('Negation: -field:value excludes matching rows (GitHub-issue-search style)', () => {
    test('typing a leading dash before a field name still suggests that field, and committing keeps the dash', async ({ page }) => {
      const input = page.locator('[data-testid=filter-input]');
      await input.click();
      await input.fill('-ra');
      await page.waitForTimeout(150);
      const rows = page.locator('[data-testid=filter-suggest-row]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('RAG');
      await rows.first().click();
      await page.waitForTimeout(150);
      await expect(input).toHaveValue('-RAG:');
    });

    test('-RAG:"On track" excludes every row with that value instead of requiring it', async ({ page }) => {
      const input = page.locator('[data-testid=filter-input]');
      await expect(page.locator('[data-testid=row]')).toHaveCount(9);
      await input.fill('RAG:"On track"');
      await page.waitForTimeout(150);
      const positiveCount = await page.locator('[data-testid=row]').count();
      expect(positiveCount).toBeGreaterThan(0);
      expect(positiveCount).toBeLessThan(9);

      await input.fill('-RAG:"On track"');
      await page.waitForTimeout(150);
      const negatedCount = await page.locator('[data-testid=row]').count();
      expect(negatedCount).toBe(9 - positiveCount); // exactly the complementary set
      const ragCells = await page.locator('[data-testid=row] [data-col=rag]').allInnerTexts();
      expect(ragCells.every(t => !t.includes('On track'))).toBe(true);
    });

    test('two negated tokens on different fields both apply (ANDed), same as two positive tokens would', async ({ page }) => {
      const input = page.locator('[data-testid=filter-input]');
      await input.fill('-RAG:"On track" -Priority:P0');
      await page.waitForTimeout(150);
      const ragCells = await page.locator('[data-testid=row] [data-col=rag]').allInnerTexts();
      const priorityCells = await page.locator('[data-testid=row] [data-col=priority]').allInnerTexts();
      expect(ragCells.every(t => !t.includes('On track'))).toBe(true);
      expect(priorityCells.every(t => !t.includes('P0'))).toBe(true);
    });
  });
});
