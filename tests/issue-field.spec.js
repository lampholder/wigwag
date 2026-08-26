// Spec section: Row > Fields > Key / Issue
//   - Can just be text
//   - If it's a URL:
//       - GitHub issue URL -> renders as the issue title, link as a subscript beneath
//       - non-GitHub URL -> renders as a pill
//   - If it's text it just renders as text
//   - Other fields can be BOUND to an issue field, rendering set via a basic DSL
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Key/Issue field', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('plain text renders as plain text, no pill or subscript', async ({ page }) => {
    const cell = h.titleCell(page, 3); // seed row 3: plain local issue, no source
    await expect(cell).toContainText('Presence indication');
    expect(await cell.locator('a').count()).toBe(0);
  });

  test('a GitHub issue URL resolves to the real title with the link as a subscript', async ({ page }) => {
    await h.clickTitleToEdit(page, 8);
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 8);

    const cell = h.titleCell(page, 8);
    const text = await cell.textContent();
    expect(text).not.toMatch(/github\.com/); // the fetched title is shown, not the raw URL
    expect(text).toContain('octocat/Hello-World#1');

    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://github.com/octocat/Hello-World/issues/1');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', /noopener/);
    // the whole "owner/repo#N ↗" line is the link, not just the arrow
    await expect(anchor).toHaveText('octocat/Hello-World#1 ↗');
  });

  // Regression: the octocat glyph used a hardcoded near-black brand color
  // (#181717, GitHub's own light-background mark) -- invisible against a
  // dark-mode background. Checked via computed style rather than a
  // screenshot, since the actual visibility bug is the color, not layout.
  test('the GitHub glyph uses a theme-aware color, not a hardcoded light-mode-only hex', async ({ page }) => {
    const cell = h.titleCell(page, 1); // seed row 1: already resolved (acme/app#3298)
    const color = await cell.locator('svg').first().evaluate(el => getComputedStyle(el).color);
    expect(color).not.toBe('rgb(24, 23, 23)'); // #181717
  });

  test('a Jira-style reference (no resolvable href) has no anchor at all, just the plain key', async ({ page }) => {
    // seed row 9's title is a demo Jira reference (TRK-118), with no real URL to link to.
    const cell = h.titleCell(page, 9);
    await expect(cell).toContainText('TRK-118');
    expect(await cell.locator('a').count()).toBe(0);
  });

  test('a non-GitHub URL renders as a pill (real href, no live fetch)', async ({ page }) => {
    await h.clickTitleToEdit(page, 8);
    await h.typeAndCommit(page, 'https://example.com/some-doc');
    await page.waitForTimeout(300);

    const cell = h.titleCell(page, 8);
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://example.com/some-doc');
    // it's a static pill, not a resolved subscript: no separate label+arrow pair
    const arrowCount = await cell.locator('a', { hasText: '↗' }).count();
    expect(arrowCount).toBe(1);
  });

  test('a GitHub shorthand (owner/repo#N) also resolves via a live fetch, not a static pill', async ({ page }) => {
    await h.clickTitleToEdit(page, 8);
    await h.typeAndCommit(page, 'octocat/Hello-World#2');
    await h.waitForTitleResolved(page, 8);
    const cell = h.titleCell(page, 8);
    const text = await cell.textContent();
    expect(text).not.toBe('octocat/Hello-World#2'); // replaced with the fetched title
    expect(text).toContain('octocat/Hello-World#2');
  });

  test('clicking the title to edit shows the underlying URL, not the fetched title', async ({ page }) => {
    // seed row 1 is already resolved (acme/app#3298)
    await h.clickTitleToEdit(page, 1);
    const value = await page.evaluate(() => document.activeElement.value);
    expect(value).toBe('https://github.com/acme/app/issues/3298');
  });

  test('other fields can be bound to a text/issue field via the rule DSL', async ({ page }) => {
    // seed rule: Type is bound to Title, rule: source.github.labels.includes("bug") ? "bug" : "enhancement"
    // row 1's title is linked with labels: ['enhancement']
    await expect(h.fieldCell(page, 1, 'type')).toHaveText(/Enhancement/);
    // row 7's title is linked with labels: ['bug']
    await expect(h.fieldCell(page, 7, 'type')).toHaveText(/Bug/);
    // row 3's title has no link at all -> the rule's null branch, no computed value
    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/—/);
  });

  test('a truncated title shows the full text as a native hover tooltip', async ({ page }) => {
    // seed row 1's title is long enough to truncate in the fixed-width column.
    const span = h.titleCell(page, 1).locator('span[title]').first();
    const full = await span.getAttribute('title');
    expect(full).toBe('Sidebar sizing does not stick between application starts');
    expect(full).toBe(await span.textContent());
  });
});

// The Issue field is genuinely type:'issue' now (it used to be type:'text'
// despite behaving like an issue-linkable field throughout the UI, purely
// by colId-based special-casing) -- see docs/FORMAT.md's "Field types"
// section and deriveFieldDefs() in wigwag.html for the auto-migration that
// makes this true for every existing project too, not just new ones.
test.describe('Issue field is genuinely type:\'issue\'', () => {
  test('a fresh project\'s Issue field is type:\'issue\', not the old type:\'text\' default', async ({ page }) => {
    await h.gotoTracker(page); // the demo fixture's OWN stored fields line still literally says type:'text'
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.fieldDefs.title.type).toBe('issue');
  });

  test('an existing project stored with type:\'text\' self-heals to type:\'issue\' on load, keeping a customized label', async ({ page }) => {
    const id = 'legacy-proj';
    await h.useFastTimers(page);
    await page.addInitScript((id) => {
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Legacy project' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Ticket', type: 'text' } },
        issues: [{ id: 'i1', num: 1, fieldRefs: {}, fieldLoading: {}, values: { title: 'Something' }, comments: [], history: [] }],
        projectHistory: [], hiddenFieldIds: [],
        githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: '', projectNotes: '', projectComments: []
      }));
    }, id);
    await page.addInitScript((email) => {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: email }));
    }, h.DEMO_IDENTITY_EMAIL);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.fieldDefs.title).toMatchObject({ label: 'Ticket', type: 'issue' });

    // And it now genuinely behaves as issue-typed: paste-to-resolve linking works.
    await h.mockGithubApi(page);
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 1);
    await expect(h.titleCell(page, 1).locator('a')).toHaveCount(1);
  });

  test('the bound-source dropdown lists "Issue" once, not twice', async ({ page }) => {
    // Regression: bindableSources() used to hardcode 'title' into the list
    // AND separately loop over every type:'issue' field -- once title's own
    // type became 'issue' too, it matched both, without an explicit
    // exclusion in the loop.
    await h.gotoTracker(page);
    await h.openFieldEditor(page, 'type');
    const options = await page.locator('[data-testid=field-editor-source-select] option').allTextContents();
    expect(options.filter(o => o === 'Issue').length).toBe(1);
  });
});
