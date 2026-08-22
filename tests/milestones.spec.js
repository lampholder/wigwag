// Spec section: milestone/tracker switcher -- multiple independent tracker
// documents (id + name + own fieldDefs/issues/columnOrder/hiddenFieldIds,
// and own GitHub repo sync target) managed from a header dropdown. See
// vectorized-whistling-pancake.md for the design, in particular why repo
// sync had to become per-milestone (a data-loss footgun otherwise).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Tracker switcher', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('opens showing the seed milestone as active, and closes on outside click', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    const rows = page.locator('[data-testid=milestone-row]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Delivery tracker');
    await expect(rows.first()).toContainText('✓');

    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(0);
  });

  test('creating a blank milestone switches to it with the starter field template and no issues; switching back leaves the original untouched', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Second milestone');
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    // Not the demo seed's own schema (Type/Related/Delivery teams/Mitigation)
    // -- the starter template instead (see blankProjectFieldDefs()).
    const headers = await page.locator('[data-testid=col-header]').allTextContents();
    expect(headers.map(h => h.replace(/\W+$/, '').trim())).toEqual(['Priority', 'Remedy', 'RAG', 'Status']);
    await expect(page.locator('body')).toContainText('Second milestone');

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });

  test('projects are listed alphabetically, not in creation order', async ({ page }) => {
    for (const name of ['Zebra project', 'Apple project', 'Mango project']) {
      await h.openTrackerSwitcher(page);
      await h.createNamedBlankProject(page, name);
      await page.waitForTimeout(300);
    }
    await h.openTrackerSwitcher(page);
    const names = await page.locator('[data-testid=milestone-row]').allInnerTexts();
    const trimmed = names.map(n => n.trim().split('\n')[0]);
    expect(trimmed).toEqual(['Apple project', 'Delivery tracker', 'Mango project', 'Zebra project']);
  });

  // "+ New project" (previously labelled "+ Add project") used to open a
  // panel (blank/naming/import-file/paste) -- it now just creates a
  // project immediately, named "Untitled" (then "Untitled 2",
  // "Untitled 3", ...) since import is already handled by the dedicated
  // app-bar "Import project..." menu.
  test('"+ New project" creates a project named "Untitled 1", then "Untitled 2" etc, with no naming step or import options', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=btn-add-milestone]')).toHaveText('+ New project');
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Untitled 1');
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);

    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Untitled 2');

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=new-milestone-name-input]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-import-milestone]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-paste-milestone]')).toHaveCount(0);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(3); // Delivery tracker, Untitled 1, Untitled 2
  });

  // Rename moved off the header (inline edit) and into the project panel,
  // behind a "Rename..." link, with deliberate friction: a stray blur must
  // NOT commit (the opposite of the old inline-edit behavior) -- only the
  // explicit Rename button or Enter does.
  test('clicking the header title opens the project panel, not an inline editor', async ({ page }) => {
    const title = page.locator('[data-testid=tracker-name-title]');
    await expect(page.locator('[data-testid=tracker-name-input]')).toHaveCount(0);
    await title.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=notes-panel]')).toBeVisible();
    await expect(page.locator('[data-testid=tracker-name-input]')).toHaveCount(0); // no inline editor exists anymore
  });

  test('renaming inside the project panel: Enter commits, Escape cancels, a stray blur does neither (deliberate friction)', async ({ page }) => {
    const title = page.locator('[data-testid=tracker-name-title]');
    await title.click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=notes-rename-btn]').click();
    const input = page.locator('[data-testid=notes-rename-input]');
    await expect(page.getByText('This name is stored in the file', { exact: false })).toBeVisible();

    await input.fill('Renamed via Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await expect(title).toContainText('Renamed via Enter');
    await expect(page.locator('[data-testid=notes-rename-input]')).toHaveCount(0); // back to reading mode

    await page.locator('[data-testid=notes-rename-btn]').click();
    await input.fill('should be discarded');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=notes-rename-input]')).toHaveCount(0);
    await expect(title).toContainText('Renamed via Enter');

    await page.locator('[data-testid=notes-rename-btn]').click();
    await input.fill('should NOT be committed by a stray click');
    await page.locator('[data-testid=notes-panel]').click({ position: { x: 20, y: 300 } }); // stray click elsewhere in the panel, not Cancel/Rename
    await page.waitForTimeout(150);
    await expect(input).toBeVisible(); // still in the editing state -- blur alone did nothing
    await expect(input).toHaveValue('should NOT be committed by a stray click'); // draft preserved, not lost either

    await page.locator('[data-testid=notes-rename-commit-btn]').click();
    await page.waitForTimeout(150);
    await expect(title).toContainText('should NOT be committed by a stray click');

    await page.locator('[data-testid=notes-close-btn]').click();
    await page.waitForTimeout(300);
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]').first()).toContainText('should NOT be committed by a stray click');
  });

  test('importing a file for a genuinely new project creates a separate milestone without touching the current one', async ({ page }) => {
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'genuinely-new-project', name: 'Genuinely New' }),
      JSON.stringify({ type: 'issue', id: 'gn1', uid: 'ugn1', num: 1, fieldRefs: {}, values: { title: 'New project issue' }, comments: [], history: [] })
    ].join('\n');

    await h.openImportProjectMenu(page);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-project-from-file]').click(),
    ]);
    await fc.setFiles({ name: 'new-project.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Genuinely New');

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(2);
    await expect(h.milestoneRow(page, 'Delivery tracker')).toBeVisible(); // original untouched
  });

  // Regression / deliberate behavior change: re-importing a file that
  // matches a project already present locally used to silently fork a
  // same-name duplicate under a fresh random id. It now warns first, and
  // on confirm applies it as an update to the existing project instead --
  // no duplicate, nothing silently forked.
  test('re-importing an already-known project warns, then merges into the existing project rather than forking a duplicate', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const exportedText = fs.readFileSync(await dl.path(), 'utf8');

    // Cancelling the warning does nothing at all.
    let dialogMsg = null;
    page.once('dialog', async d => { dialogMsg = d.message(); await d.dismiss(); });
    await h.openImportProjectMenu(page);
    const [fc1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-project-from-file]').click(),
    ]);
    await fc1.setFiles({ name: 'reimport.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(exportedText) });
    await page.waitForTimeout(400);
    expect(dialogMsg).toContain('already have');
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // unchanged, cancelling did nothing
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(1); // still just the one project
    await page.mouse.click(700, 400); // outside click closes the dropdown
    await page.waitForTimeout(150);

    // Confirming merges into the existing project -- still just the one
    // milestone, no duplicate created.
    page.once('dialog', d => d.accept());
    await h.openImportProjectMenu(page);
    const [fc2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-project-from-file]').click(),
    ]);
    await fc2.setFiles({ name: 'reimport2.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(exportedText) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // merged, not duplicated -- still 9
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(1);
  });

  test('connecting milestone A to a GitHub repo, then creating a blank milestone B, does not touch A\'s repo', async ({ page }) => {
    const REPO_A = 'acme/repo-a';
    const gh = h.mockGithubContentsApi(page, REPO_A);
    gh.getResponses = [{ status: 404 }];

    await h.setGithubRepoSync(page, { repo: REPO_A, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1)); // A's initial-commit push
    const pushCountAfterA = gh.pushCount;
    const getCountAfterA = gh.getCount;

    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Milestone B');
    await page.waitForTimeout(500); // past the (shrunk) push debounce, if it were (wrongly) armed

    expect(gh.pushCount).toBe(pushCountAfterA); // B never pushed to A's repo
    expect(gh.getCount).toBe(getCountAfterA); // B never reconnected to A's repo either

    await h.openProjectPanel(page);
    await h.selectProjectPanelSection(page, 'sync');
    await expect(page.locator('[data-testid=settings-github-repo]')).toHaveValue(''); // B has no repo of its own
    await h.closeProjectPanel(page);

    // Switch back to A and confirm it kept its own repo config the whole time.
    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);
    await h.openProjectPanel(page);
    await h.selectProjectPanelSection(page, 'sync');
    await expect(page.locator('[data-testid=settings-github-repo]')).toHaveValue(REPO_A);
  });
});

test.describe('Fresh-install bootstrap wire format stability', () => {
  // Regression test: an internal rename once renamed the JS-side state
  // property names (milestoneId/milestones -> projectId/projects) and, by
  // accident, the *persisted* index blob's own JSON key names along with
  // them. Real user data written under the old key names (activeMilestoneId/
  // milestones) then silently failed to load -- the app fell back to a
  // blank index, which then overwrote the real one on the next render. The
  // wire format for this blob must never change without a real migration,
  // independent of whatever the in-memory state properties are named.
  test('the project-index blob\'s on-disk key names (activeMilestoneId/milestones) are read correctly and never rewritten to a different shape', async ({ page }) => {
    const id = 'pre-existing-real-project-id';
    await page.context().addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id,
        milestones: [{ id, name: 'My Real Project' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } },
        issues: [{ id: 'i1', uid: 'u1', num: 1, fieldRefs: {}, fieldLoading: {}, values: { title: 'My real issue' }, comments: [], history: [] }],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '',
        projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('My Real Project');
    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=row]').first()).toContainText('My real issue');

    // Force at least one re-render (any interaction triggers componentDidUpdate,
    // which persists the index on every update) -- this is exactly the path
    // that clobbered the blob last time.
    await h.openSettings(page);

    const indexRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_milestones_v1'));
    const index = JSON.parse(indexRaw);
    expect(index.activeMilestoneId).toBe(id);
    // identityId is expected now (ensureDefaultIdentityIfNeeded tags every
    // existing project with the identity it just bootstrapped) --
    // everything else about the shape must still match exactly.
    expect(index.milestones).toEqual([{ id, name: 'My Real Project', identityId: expect.any(String) }]);
    expect(index.activeProjectId).toBeUndefined();
    expect(index.projects).toBeUndefined();
  });
});
