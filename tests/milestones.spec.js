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
    const rows = page.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Delivery tracker');
    await expect(rows.first()).toContainText('✓');

    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(0);
  });

  // Regression test: the pill's border used to only show on actual mouse
  // :hover, so opening the menu then moving the mouse away left the
  // translucent background lit with no border around it -- mismatched.
  test('the switcher pill keeps its border the whole time the menu is open, even after the mouse leaves it', async ({ page }) => {
    const pill = page.locator('[data-testid=btn-switcher]');
    await expect(pill).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');

    await h.openTrackerSwitcher(page);
    await page.mouse.move(700, 700);
    await page.waitForTimeout(150);
    const openBorder = await pill.evaluate(el => getComputedStyle(el).borderColor);
    expect(openBorder).not.toBe('rgba(0, 0, 0, 0)');

    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(pill).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
  });

  test('creating a blank milestone switches to it with the starter field template and no issues; switching back leaves the original untouched', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Second milestone');
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    // Not the demo seed's own schema (Type/Related/Delivery teams/Mitigation)
    // -- the starter template instead (see blankProjectFieldDefs()).
    const headers = await page.locator('[data-testid=col-header]').allTextContents();
    expect(headers.map(h => h.replace(/\W+$/, '').trim())).toEqual(['Description', 'Priority', 'Status']);
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
    const names = await page.locator('[data-testid=switcher-project-row]').allInnerTexts();
    const trimmed = names.map(n => n.trim().split('\n')[0]);
    expect(trimmed).toEqual(['Apple project', 'Delivery tracker', 'Mango project', 'Zebra project']);
  });

  // "+ New project" (previously labelled "+ Add project") used to open a
  // panel (blank/naming/import-file/paste) -- it now just creates a
  // project immediately, named "Untitled Project 1" (then "Untitled
  // Project 2", "Untitled Project 3", ...) since import is already
  // handled by the dedicated app-bar "Import project..." menu.
  test('"New project" creates a project named "Untitled Project 1", then "Untitled Project 2" etc, with no naming step or import options', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=btn-switcher-new-project]')).toHaveText('New project in Personal'); // no "+" -- neither this nor Import project is marked, both create a project; names the target identity since creating is a write
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Untitled Project 1');
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);

    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Untitled Project 2');

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=new-milestone-name-input]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-import-milestone]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-paste-milestone]')).toHaveCount(0);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(3); // Delivery tracker, Untitled Project 1, Untitled Project 2
  });

  // The numbering is strictly the highest existing "Untitled Project N" + 1
  // -- it does NOT fill a gap left by a deleted/renamed one. Deleting
  // "Untitled Project 1" while "Untitled Project 2" survives must still
  // produce "Untitled Project 3" next, not a reused "Untitled Project 1".
  test('deleting "Untitled Project 1" does not free up that number -- the next one is still highest+1', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page); // Untitled Project 1, now active
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page); // Untitled Project 2, now active

    // Switch to and delete Untitled Project 1.
    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Untitled Project 1').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await h.selectProjectPanelSection(page, 'danger');
    await page.locator('[data-testid=btn-delete-project]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=delete-project-name-input]').fill('Untitled Project 1');
    await page.locator('[data-testid=btn-confirm-delete-project]').click();
    await page.waitForTimeout(400);

    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Untitled Project 3');
  });

  // Rename moved off the header (inline edit) and into the project panel,
  // behind a "Rename..." link, with deliberate friction: a stray blur must
  // NOT commit (the opposite of the old inline-edit behavior) -- only the
  // explicit Rename button or Enter does. tracker-name-title is now just a
  // display span inside the unified switcher's own toggle button (clicking
  // it opens the switcher, not the project panel) -- "Project" is the
  // dedicated entry point.
  test('the "Project" button opens the project panel, not an inline editor', async ({ page }) => {
    await expect(page.locator('[data-testid=tracker-name-input]')).toHaveCount(0);
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=notes-panel]')).toBeVisible();
    await expect(page.locator('[data-testid=tracker-name-input]')).toHaveCount(0); // no inline editor exists anymore
  });

  test('renaming inside the project panel: Enter commits, Escape cancels, a stray blur does neither (deliberate friction)', async ({ page }) => {
    const title = page.locator('[data-testid=tracker-name-title]');
    await page.locator('[data-testid=btn-notes]').click();
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
    await expect(page.locator('[data-testid=switcher-project-row]').first()).toContainText('should NOT be committed by a stray click');
  });

  // Tracker #149: a project's name used to be purely local browser metadata
  // (PROJECTS_KEY.milestones[].name) plus a narrative-only, field-less
  // history entry -- readable by a human, but not derivable by another
  // browser the way a real field definition is. A rename now also appends
  // a real field:'__project_name__' entry, so it round-trips through the
  // same signed-history mechanism as everything else in the file.
  test('renaming appends a real, derivable field:__project_name__ history entry, not just the narrative text', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=notes-rename-btn]').click();
    await page.locator('[data-testid=notes-rename-input]').fill('Derivable Name Test');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const doc = await h.idbGetProjectDoc(page, 'demo-milestone');
    const nameEntries = doc.projectHistory.filter(h => h.field === '__project_name__');
    expect(nameEntries.length).toBeGreaterThan(0);
    expect(nameEntries[nameEntries.length - 1].value).toBe('Derivable Name Test');
    // The sentinel field id must never leak into fieldDefs as a real field.
    expect(doc.fieldDefs['__project_name__']).toBeUndefined();
  });

  // The whole point of making the name derivable: another session picking
  // up a name change purely from history, the same way a field-definition
  // change already propagates via wigwag's existing cross-tab sync
  // (a stand-in here for a real peer -- GitHub sync pull, Matrix room,
  // Connect Remote -- pushing new signed history for this same project).
  // Tracker #187, Phase 4: the project doc now lives in IndexedDB, and
  // cross-tab delivery for it is a BroadcastChannel message
  // ({type:'doc-saved', projectId, doc}), not a real localStorage
  // 'storage' event -- simulate "another tab/peer already wrote this"
  // the same way: write the doc into IndexedDB directly, then post the
  // same message shape the app's own persist() broadcasts on a real save.
  test('a peer-authored rename (new field:__project_name__ entry, no local cache update) is picked up via cross-tab sync', async ({ page }) => {
    const title = page.locator('[data-testid=tracker-name-title]');
    await expect(title).toContainText('Delivery tracker');

    const doc = await h.idbGetProjectDoc(page, 'demo-milestone');
    doc.projectHistory.push({
      id: 'peer-rename-1', time: new Date().toISOString(), actor: 'Peer', email: 'peer@example.com',
      text: 'Renamed project from "Delivery tracker" to "Peer Renamed It"',
      field: '__project_name__', value: 'Peer Renamed It',
      origin: 'authored', sortKey: Date.now() + 100000, sig: null, sigRedacted: null, pubKey: null
    });
    await h.idbSetProjectDoc(page, 'demo-milestone', doc);
    await page.evaluate((doc) => {
      new BroadcastChannel('wigwag:docsync').postMessage({ type: 'doc-saved', projectId: 'demo-milestone', doc });
    }, doc);
    await page.waitForTimeout(300);
    await expect(title).toContainText('Peer Renamed It');

    // Reconciled into the milestone cache too, not just this render.
    const milestones = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones);
    expect(milestones.find(m => m.id === 'demo-milestone').name).toBe('Peer Renamed It');

    // Survives a fresh boot (loadPersistedAsync), not just the live broadcast path.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await expect(title).toContainText('Peer Renamed It');
  });

  test('importing a file for a genuinely new project creates a separate milestone without touching the current one', async ({ page }) => {
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'genuinely-new-project', name: 'Genuinely New' }),
      JSON.stringify({ type: 'issue', id: 'gn1', num: 1, fieldRefs: {}, values: { title: 'New project issue' }, comments: [], history: [] })
    ].join('\n');

    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    const projectsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones);
    // No project id match -- handleApplyUpdateParsed asks to confirm
    // importing as a brand new project.
    await fc.setFiles({ name: 'new-project.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(page.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Genuinely New');

    // A genuinely separate milestone exists now (imported projects start
    // with no derived identity -- see identity-attribution.spec.js -- so
    // it won't show in this identity-scoped switcher until it's written
    // to; checked at the storage level instead, which is where "separate
    // milestone, original untouched" actually lives).
    const projectsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones);
    expect(projectsAfter.length).toBe(projectsBefore.length + 1);
    const original = projectsBefore[0];
    expect(projectsAfter.find(p => p.id === original.id)).toEqual(original);
    // The just-imported project is now active and has no derived identity,
    // so the switcher opens on "Shared with you" by default -- Personal's
    // scope needs previewing before its own project is clickable/visible.
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Personal' }).click();
    await page.waitForTimeout(150);
    await expect(h.milestoneRow(page, 'Delivery tracker')).toBeVisible(); // original still reachable, untouched
  });

  // Regression / deliberate behavior change: re-importing a file that
  // matches a project already present locally used to silently fork a
  // same-name duplicate under a fresh random id. It now warns first, and
  // on confirm applies it as an update to the existing project instead --
  // no duplicate, nothing silently forked.
  //
  // Tracker #143 (dfb378b2): Receive routes a same-project match through
  // handleApplyUpdateParsed's previewMerge -- tracker #124's real merge
  // gate CARD, not a plain window.confirm() the way the old, now-removed
  // "Import project…" entry point did. "Not now" replaces dismiss;
  // "Merge update" replaces accept.
  test('re-importing an already-known project shows the merge gate, then merges into the existing project rather than forking a duplicate', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const exportedText = fs.readFileSync(await dl.path(), 'utf8');

    // "Not now" on the gate does nothing at all.
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    const [fc1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc1.setFiles({ name: 'reimport.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(exportedText) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=btn-merge-primary]')).toBeVisible();
    await page.locator('[data-testid=btn-merge-secondary]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // unchanged, "Not now" did nothing
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(1); // still just the one project
    await page.mouse.click(700, 400); // outside click closes the dropdown
    await page.waitForTimeout(150);

    // "Merge update" merges into the existing project -- still just the
    // one milestone, no duplicate created. A byte-identical re-import is
    // a genuine no-op (tracker #124, 5c3051e9's own gate disables "Merge
    // update" for exactly that case), so give this second reimport one
    // real new entry the first didn't have, to actually exercise the
    // accept path rather than just re-proving "Not now" above.
    const lines2 = exportedText.trim().split('\n').map(l => JSON.parse(l));
    const issue2 = lines2.find(l => l.type === 'issue' && l.id === 'i2');
    issue2.commentStreams = issue2.commentStreams || {};
    issue2.commentStreams.comments = issue2.commentStreams.comments || [];
    issue2.commentStreams.comments.push({ author: 'jordan', time: 'Aug 2', text: 'Reimport note', sortKey: 99999 });
    const reimportText2 = lines2.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    const [fc2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc2.setFiles({ name: 'reimport2.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(reimportText2) });
    await page.waitForTimeout(400);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // merged, not duplicated -- still 9
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(1);
  });

  test('connecting milestone A to a GitHub repo, then creating a blank milestone B, does not touch A\'s repo', async ({ page }) => {
    const REPO_A = 'acme/repo-a';
    const gh = h.mockGithubContentsApi(page, REPO_A);
    gh.getResponses = [{ status: 404 }];

    await h.setGithubRepoSync(page, { repo: REPO_A, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1)); // A's initial-commit push
    // A's own connect flow genuinely fires a second, immediate follow-up
    // push in quick succession after the first (pre-existing, unrelated
    // to anything this test is about) -- give it the same settling grace
    // the test already gives AFTER creating B below, so a real timing
    // shift elsewhere can't make this capture an incomplete count.
    await page.waitForTimeout(500);
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
        issues: [{ id: 'i1', num: 1, fieldRefs: {}, fieldLoading: {}, values: { title: 'My real issue' }, comments: [], history: [] }],
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

  // A genuinely empty browser -- no PROJECTS_KEY at all -- exercises
  // bootstrapFirstProjectIfNeeded() for real, unlike every other test in
  // this file (they all pre-seed the index via gotoTracker()/addInitScript,
  // so the guard at the top of that function always short-circuits it).
  test('a genuinely fresh browser (no seeded storage) bootstraps its first project as "Untitled Project 1"', async ({ page }) => {
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Untitled Project 1');
    const index = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    expect(index.milestones).toHaveLength(1);
    expect(index.milestones[0].name).toBe('Untitled Project 1');
  });
});
