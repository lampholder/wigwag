// Project switcher: folder tree by '/'-delimited name prefix (tracker
// 63f55b85, design handoff folders.zip). The pure grouping/flattening
// algorithm (buildProjectTree/flattenProjectTree) has its own thorough
// unit-test coverage in wigwag-core.test.js -- this file covers the UI
// layer specifically: real rows render with the right text/structure,
// selecting a nested/collapsed/collision row actually switches the
// project, and existing switcher behavior (right-click "Open in new
// window") still works on a tree row. Scoped to desktop/web + the
// Matrix-widget switcher only -- the mobile bottom-sheet switcher is a
// structurally different, richer row (issue count/linked-repo label)
// deliberately left out of this handoff (confirmed with Tom).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

function minimalDoc() {
  return { fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues: [], hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: [] };
}
// Seeds a known set of projects directly (bypassing real project
// creation, far cheaper for a view-layer test that just needs specific
// NAMES to exist) -- registered before h.gotoTracker's own call, whose
// demo-project seed already no-ops once something's present. Input
// order doesn't matter: the app does its own alphabetical sort before
// building the tree, same as it does for the existing flat list.
async function seedProjectTreeFixture(page, names) {
  const projects = names.map((name, i) => ({ id: 'proj' + i, name }));
  await page.addInitScript(({ projects, doc }) => {
    localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: projects[0].id, milestones: projects }));
    projects.forEach(p => localStorage.setItem('git_native_tracker_v1:' + p.id, JSON.stringify(doc)));
  }, { projects, doc: minimalDoc() });
}

test.describe('Project switcher: folder tree', () => {
  test('a real multi-level grouping renders folder headers and nested leaf rows, each clickable one switching the active project', async ({ page }) => {
    await seedProjectTreeFixture(page, [
      'Acme/Doggo/Source dog', 'Acme/Doggo/Train dog',
      'Acme/Delivery tracker', 'Acme/Rules demo',
      'Boring/Test'
    ]);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);

    const rows = page.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(7); // 2 folder headers (Acme, Doggo) + 5 selectable rows
    await expect(rows.nth(0)).toHaveText('Acme'); // display-only header
    await expect(rows.nth(1)).toHaveText('Doggo'); // display-only header, nested
    // toContainText -- "Source dog" is the seeded ACTIVE project
    // (projects[0]), so its row also renders a checkmark.
    await expect(rows.nth(2)).toContainText('Source dog');
    await expect(rows.nth(3)).toHaveText('Train dog');
    await expect(rows.nth(4)).toHaveText('Delivery tracker');
    await expect(rows.nth(5)).toHaveText('Rules demo');
    await expect(rows.nth(6)).toHaveText('Boring/Test'); // single-item folder, collapsed to the full path

    // Deepest nested row is still really clickable and switches projects.
    await rows.nth(2).click(); // "Source dog"
    await page.waitForTimeout(200);
    expect(await h.activeMilestoneId(page)).toBe('proj0'); // Acme/Doggo/Source dog was index 0
  });

  test('display-only folder headers are visually distinct from clickable rows: no cursor:pointer, no checkmark even when a descendant is active', async ({ page }) => {
    await seedProjectTreeFixture(page, ['Acme/Doggo/Source dog', 'Acme/Doggo/Train dog']);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);

    const acmeHeader = page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Acme' });
    await expect(acmeHeader).toHaveCSS('cursor', 'default');
    await expect(acmeHeader.locator('text=✓')).toHaveCount(0);

    const sourceDog = page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Source dog' });
    await expect(sourceDog).toHaveCSS('cursor', 'pointer');
  });

  test('a lone project under a prefix collapses to a flat "Prefix/Name" row, not a one-item folder', async ({ page }) => {
    await seedProjectTreeFixture(page, ['Acme/Only', 'Zebra']);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);

    const rows = page.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(2); // no folder header row at all
    // toContainText -- "Acme/Only" is the seeded ACTIVE project
    // (projects[0]), so its row also renders a checkmark.
    await expect(rows.nth(0)).toContainText('Acme/Only');
    await expect(rows.nth(1)).toHaveText('Zebra');
  });

  test('exact-name collision: a project named exactly "Acme" becomes the folder\'s own clickable header, selectable like any project', async ({ page }) => {
    await seedProjectTreeFixture(page, ['Acme', 'Acme/Doggo']);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);

    const rows = page.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(2);
    const acmeHeader = rows.nth(0);
    // toContainText, not toHaveText -- "Acme" is the seeded ACTIVE
    // project (projects[0]), so its row also renders a checkmark.
    await expect(acmeHeader).toContainText('Acme');
    await expect(acmeHeader).toHaveCSS('cursor', 'pointer'); // clickable, unlike a display-only header

    await acmeHeader.click();
    await page.waitForTimeout(200);
    expect(await h.activeMilestoneId(page)).toBe('proj0'); // the "Acme" project itself
  });

  test('right-click "Open in new window" still works on a nested tree row, inside Tauri', async ({ page }) => {
    await page.addInitScript(() => {
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI__.core = { invoke: () => Promise.resolve(null) };
      window.__TAURI__.window = { getCurrentWindow: () => ({ setTitle: () => Promise.resolve() }) };
    });
    await seedProjectTreeFixture(page, ['Acme/Doggo/Source dog', 'Acme/Doggo/Train dog']);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);

    const sourceDog = page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Source dog' });
    await sourceDog.click({ button: 'right' });
    await expect(page.locator('[data-testid=switcher-row-context-menu]')).toBeVisible();
  });

  test('projects with no "/" in their name render exactly as before (flat, no regression)', async ({ page }) => {
    await seedProjectTreeFixture(page, ['Alpha', 'Beta', 'Gamma']);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);

    const rows = page.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(3);
    // toContainText, not toHaveText -- "Alpha" is the seeded ACTIVE
    // project (projects[0]), so its row also renders a checkmark.
    await expect(rows.nth(0)).toContainText('Alpha');
    await expect(rows.nth(1)).toHaveText('Beta');
    await expect(rows.nth(2)).toHaveText('Gamma');
  });

  test('the "no projects" empty state still triggers correctly in a scope with zero projects (counts real projects, not tree rows)', async ({ page }) => {
    // Identity B deliberately has zero projects -- switching scope to it
    // must show the real empty state, not be confused by however many
    // rows a (nonexistent) tree would otherwise produce.
    await h.seedTwoIdentities(page, { projects: [{ id: 'project-a', name: 'Acme/Only', identityId: 'identity-a' }] });
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    // Scope rows sort alphabetically by label ("Northwind" < "Personal"),
    // so the zero-project identity (Northwind) is index 0, not 1.
    const emptyScope = page.locator('[data-testid=switcher-scope-row]').nth(0);
    await emptyScope.click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(0);
  });
});
