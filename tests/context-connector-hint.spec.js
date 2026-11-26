// Design handoff "context_connector_hint" (Tauri-only): the add-item
// input's placeholder becomes an overlay that hints at which context
// connectors (GitHub via the active project's githubRepo, Jira/
// Salesforce via the builtin Connected Sources connectors) are already
// configured, with a clickable "add a context connector" CTA that deep-
// links to Settings -> Context connectors. Outside Tauri the input keeps
// its original static placeholder, unchanged. See src/wigwag-app.js's
// configuredConnectorNames/addItemPlaceholderVariants/
// recomputeAddItemPlaceholder and the overlay markup in
// src/wigwag-template.html (both the desktop add-item-input and the
// mobile add-item sheet).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function openAddItem(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('Space');
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
}

test.describe('Context connector hint: outside Tauri (unchanged)', () => {
  test('the add-item input keeps its original static placeholder, and the overlay never renders', async ({ page }) => {
    await h.gotoTracker(page);
    await openAddItem(page);
    const input = page.locator('[data-testid=add-item-input]');
    await expect(input).toHaveAttribute('placeholder', 'Start typing to create an item, or paste a public GitHub issue link');
    await expect(page.locator('[data-testid=add-item-placeholder-overlay]')).toHaveCount(0);
  });

  test('the mobile add-item sheet also keeps its static placeholder and caption, unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 800 });
    await h.gotoTracker(page);
    await page.locator('[data-testid=mobile-add-fab]').click();
    await page.waitForTimeout(300);
    const textarea = page.locator('[data-testid=mobile-add-input]');
    await expect(textarea).toHaveAttribute('placeholder', 'Start typing to create an item, or paste a public GitHub issue link');
    await expect(page.locator('[data-testid=mobile-add-item-placeholder-overlay]')).toHaveCount(0);
    await expect(page.getByText('Start typing to create an item, or paste a public GitHub issue link').last()).toBeVisible();
  });
});

test.describe('Context connector hint: Tauri', () => {
  test('with no connectors configured, the overlay shows the "public GitHub" fallback and the real placeholder attribute goes blank', async ({ page }) => {
    await h.stubTauriConnectorRuntime(page);
    await h.gotoTracker(page);
    await openAddItem(page);
    const input = page.locator('[data-testid=add-item-input]');
    await expect(input).toHaveAttribute('placeholder', '');
    const overlay = page.locator('[data-testid=add-item-placeholder-overlay]');
    await expect(overlay).toContainText('public GitHub link');
    await expect(overlay).toContainText('add a context connector');
  });

  test('typing into the input hides the overlay immediately (no double placeholder text)', async ({ page }) => {
    await h.stubTauriConnectorRuntime(page);
    await h.gotoTracker(page);
    await openAddItem(page);
    await expect(page.locator('[data-testid=add-item-placeholder-overlay]')).toHaveCount(1);
    await page.locator('[data-testid=add-item-input]').fill('A real issue title');
    await expect(page.locator('[data-testid=add-item-placeholder-overlay]')).toHaveCount(0);
  });

  test('a project with its own githubRepo configured drops "public" from the phrase', async ({ page }) => {
    await h.stubTauriConnectorRuntime(page);
    await h.gotoTracker(page);
    const doc = await h.readActiveMilestoneDoc(page);
    doc.githubRepo = 'acme/widgets';
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await page.waitForTimeout(300);
    await openAddItem(page);
    const overlay = page.locator('[data-testid=add-item-placeholder-overlay]');
    await expect(overlay).toContainText('paste a GitHub link');
    await expect(overlay).not.toContainText('public GitHub');
  });

  test('GitHub + a configured Jira connector join with "or" in the hint', async ({ page }) => {
    await h.stubTauriConnectorRuntime(page);
    await h.seedBuiltinConfig(page, 'jira', { rootUrl: 'http://localhost:8934', credentialConfigured: true });
    await h.gotoTracker(page);
    const doc = await h.readActiveMilestoneDoc(page);
    doc.githubRepo = 'acme/widgets';
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await page.waitForTimeout(300);
    await openAddItem(page);
    await expect(page.locator('[data-testid=add-item-placeholder-overlay]')).toContainText('GitHub or Jira link');
  });

  test('3 configured connectors use the Oxford-comma "A, B, or C" join', async ({ page }) => {
    await h.stubTauriConnectorRuntime(page);
    await h.seedBuiltinConfig(page, 'jira', { rootUrl: 'http://localhost:8934', credentialConfigured: true });
    await h.seedBuiltinConfig(page, 'salesforce', { rootUrl: 'http://localhost:8935', credentialConfigured: true });
    await h.gotoTracker(page);
    const doc = await h.readActiveMilestoneDoc(page);
    doc.githubRepo = 'acme/widgets';
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await page.waitForTimeout(300);
    await openAddItem(page);
    await expect(page.locator('[data-testid=add-item-placeholder-overlay]')).toContainText('GitHub, Jira, or Salesforce link');
  });

  // Live-verified while building this: a real click fires mousedown (shifts
  // focus, blurring the add-item input) -> blur -> click, in that order.
  // onAddItemBlur reacts to that blur by collapsing the box when the draft
  // is empty -- which it always is while this overlay shows -- unmounting
  // the CTA span before its own click handler ever ran, so the link
  // silently did nothing. Fixed via a preventDefault()-on-mousedown guard
  // (onAddItemPlaceholderLinkMouseDown); this is the regression test for it.
  test('clicking "add a context connector" opens Settings on Context connectors, without the box collapsing out from under it first', async ({ page }) => {
    await h.stubTauriConnectorRuntime(page);
    await h.gotoTracker(page);
    await openAddItem(page);
    await page.getByText('add a context connector', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=settings-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-modal]')).toContainText('Context connectors');
  });

  test('a narrower window steps down to a shorter variant, never truncating mid-word', async ({ page }) => {
    await h.stubTauriConnectorRuntime(page);
    await h.seedBuiltinConfig(page, 'jira', { rootUrl: 'http://localhost:8934', credentialConfigured: true });
    await h.seedBuiltinConfig(page, 'salesforce', { rootUrl: 'http://localhost:8935', credentialConfigured: true });
    await h.gotoTracker(page);
    const doc = await h.readActiveMilestoneDoc(page);
    doc.githubRepo = 'acme/widgets';
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await page.waitForTimeout(300);
    await openAddItem(page);
    const overlay = page.locator('[data-testid=add-item-placeholder-overlay]');
    await expect(overlay).toContainText('Start typing to create an issue, paste a GitHub, Jira, or Salesforce link');

    await page.setViewportSize({ width: 700, height: 800 });
    await page.waitForTimeout(500);
    await expect(overlay).toContainText('Paste a GitHub, Jira, or Salesforce link');
    await expect(overlay).not.toContainText('Start typing to create an issue, paste');
    // Always keeps the CTA, whichever lead clause is currently showing.
    await expect(overlay).toContainText('add a context connector');
  });

  // At this width the CTA alone (level 5: "Add a context connector",
  // capitalized, no lead clause) is the variant that actually fits --
  // matched case-insensitively since which exact level wins is a real
  // function of live text measurement, not something to hardcode here.
  test('the mobile add-item sheet shows the same overlay, and suppresses its own separate static caption so the two hints never show at once', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 800 });
    await h.stubTauriConnectorRuntime(page);
    await h.gotoTracker(page);
    await page.locator('[data-testid=mobile-add-fab]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-add-item-placeholder-overlay]')).toContainText(/add a context connector/i);
    await expect(page.getByText('Start typing to create an item, or paste a public GitHub issue link')).toHaveCount(0);
  });

  test('clicking the mobile CTA closes the add-item sheet and opens the mobile Settings sheet on Context connectors', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 800 });
    await h.stubTauriConnectorRuntime(page);
    await h.gotoTracker(page);
    await page.locator('[data-testid=mobile-add-fab]').click();
    await page.waitForTimeout(300);
    await page.getByText(/add a context connector/i).click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-add-page]')).toHaveCount(0);
    await expect(page.getByText('Context connectors', { exact: true })).toBeVisible();
  });
});
