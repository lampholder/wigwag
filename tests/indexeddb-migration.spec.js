// Tracker #187, Phase 2: the one-time, idempotent shadow-copy of each
// project's localStorage doc + merge log into IndexedDB. This phase
// does NOT change what the app actually reads from (that's Phase 3+) --
// these tests talk to IndexedDB directly (raw indexedDB.open, since the
// app's own idbGetDoc/etc. live inside the component's own closure, not
// exposed on window) to confirm the shadow copy itself is correct,
// idempotent, and never clobbers something already there.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const DB_NAME = 'wigwag-docstore';

function rawIdbGet(page, storeName, key) {
  return page.evaluate(({ storeName, key, DB_NAME }) => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(storeName, 'readonly');
      const getReq = tx.objectStore(storeName).get(key);
      getReq.onsuccess = () => resolve(getReq.result === undefined ? null : getReq.result);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  }), { storeName, key, DB_NAME });
}
function rawIdbPut(page, storeName, key, value) {
  return page.evaluate(({ storeName, key, value, DB_NAME }) => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), { storeName, key, value, DB_NAME });
}

function seedLegacyLocalStorage(vars) {
  localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
    activeMilestoneId: vars.PROJ_A,
    milestones: [{ id: vars.PROJ_A, name: 'Project A' }, { id: vars.PROJ_B, name: 'Project B' }]
  }));
  localStorage.setItem('git_native_tracker_v1:' + vars.PROJ_A, JSON.stringify(vars.docA));
  localStorage.setItem('git_native_tracker_v1:' + vars.PROJ_B, JSON.stringify(vars.docB));
  localStorage.setItem('git_native_tracker_merge_log_v1:' + vars.PROJ_A, JSON.stringify(vars.mergeLogA));
  localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
    rev: 1, identities: [{ id: 'id1', label: 'Tester', email: 'tester@example.com' }], activeIdentityId: 'id1'
  }));
}

const PROJ_A = 'proj-aaaa';
const PROJ_B = 'proj-bbbb';
const docA = { fieldDefs: { title: { label: 'Issue', type: 'issue' } }, issues: [{ id: 'a1' }], projectHistory: [], projectNotes: 'notes A', projectComments: [] };
const docB = { fieldDefs: { title: { label: 'Issue', type: 'issue' } }, issues: [{ id: 'b1' }], projectHistory: [], projectNotes: 'notes B', projectComments: [] };
const mergeLogA = [{ id: 'm1' }, { id: 'm2' }];

test.describe('IndexedDB migration-in (shadow copy, tracker #187)', () => {
  test('every project in the milestone list gets copied into IndexedDB on boot, verified by immediate read-back', async ({ page }) => {
    await page.addInitScript(seedLegacyLocalStorage, { PROJ_A, PROJ_B, docA, docB, mergeLogA });
    await page.goto('/wigwag.html', { waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500); // let the fire-and-forget migration sweep land

    const idbDocB = await rawIdbGet(page, 'projectDocs', PROJ_B);
    const idbLogA = await rawIdbGet(page, 'mergeLogs', 'git_native_tracker_merge_log_v1:' + PROJ_A);
    const migrationState = await rawIdbGet(page, 'meta', 'migrationState');

    // Project B is never the active project in this test, so its
    // localStorage copy is never touched by the normal (pre-existing,
    // unrelated) boot-time hydration pass -- a clean byte-for-byte check.
    expect(idbDocB).toEqual(docB);
    expect(idbLogA).toEqual(mergeLogA);
    expect(migrationState[PROJ_A].doc).toBe('copied');
    expect(migrationState[PROJ_B].doc).toBe('copied');

    // Project A IS the active project, so its doc goes through the
    // pre-existing hydration/backfill pass once loaded, which calls
    // persist() if anything changed (new timestamp field defs, backfill
    // history entries) -- and since Phase 3, persist() writes ONLY to
    // IndexedDB, never back to localStorage. So localStorage's own copy
    // is now a permanently-frozen migration-time snapshot (pre-hydration),
    // while IndexedDB correctly ends up with the richer, fully-hydrated
    // version -- these are expected to DIFFER now, not match. The
    // meaningful check is that IndexedDB's copy is the hydrated one.
    const idbDocA = await rawIdbGet(page, 'projectDocs', PROJ_A);
    // hydrateIssue() also backfills a `deleted: false` tombstone flag --
    // same category of enrichment as the created/updated field defs below.
    expect(idbDocA.issues).toEqual(docA.issues.map(iss => ({ ...iss, deleted: false })));
    expect(idbDocA.projectNotes).toBe(docA.projectNotes);
    expect(idbDocA.projectHistory.some(h => h.field === 'created' && h.origin === 'legacy-backfill')).toBe(true);
    expect(idbDocA.projectHistory.some(h => h.field === 'updated' && h.origin === 'legacy-backfill')).toBe(true);
  });

  test('a second boot does not redo (and cannot clobber) an already-migrated project', async ({ page }) => {
    await page.addInitScript(seedLegacyLocalStorage, { PROJ_A, PROJ_B, docA, docB, mergeLogA });
    await page.goto('/wigwag.html', { waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);

    // Tamper with the IndexedDB copy directly. If migration-in incorrectly
    // re-ran (ignoring migrationState), it would overwrite this back to
    // whatever's in localStorage.
    const tampered = { ...docB, projectNotes: 'TAMPERED -- must survive a second boot' };
    await rawIdbPut(page, 'projectDocs', PROJ_B, tampered);

    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);

    const idbDocBAfter = await rawIdbGet(page, 'projectDocs', PROJ_B);
    expect(idbDocBAfter).toEqual(tampered);
  });

  test('a project already present in IndexedDB is never clobbered by a stale localStorage copy', async ({ page }) => {
    await page.addInitScript(seedLegacyLocalStorage, { PROJ_A, PROJ_B, docA, docB, mergeLogA });
    await page.goto('/wigwag.html', { waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);

    const PROJ_C = 'proj-cccc';
    const freshIdbDocC = { fieldDefs: {}, issues: [{ id: 'c-fresh' }], projectHistory: [], projectNotes: 'already in IDB, newer', projectComments: [] };
    const staleLocalStorageDocC = { fieldDefs: {}, issues: [{ id: 'c-stale' }], projectHistory: [], projectNotes: 'stale localStorage copy', projectComments: [] };

    await page.evaluate(({ PROJ_C, staleLocalStorageDocC }) => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      idx.milestones.push({ id: PROJ_C, name: 'Project C' });
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify(idx));
      localStorage.setItem('git_native_tracker_v1:' + PROJ_C, JSON.stringify(staleLocalStorageDocC));
    }, { PROJ_C, staleLocalStorageDocC });
    await rawIdbPut(page, 'projectDocs', PROJ_C, freshIdbDocC);

    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);

    const idbDocCAfter = await rawIdbGet(page, 'projectDocs', PROJ_C);
    expect(idbDocCAfter).toEqual(freshIdbDocC);
  });
});

test.describe('Lazy localStorage cleanup (tracker #187, Phase 7)', () => {
  // "Verified twice" per the plan: don't delete the legacy localStorage
  // copy on the strength of the SAME boot that did the copy -- only
  // once a SEPARATE, later boot independently confirms IndexedDB is
  // still readable for it does the leftover actually get removed.
  test('a legacy localStorage copy survives the first boot that copies it, and is only deleted on a later, independent boot', async ({ page }) => {
    await page.addInitScript(seedLegacyLocalStorage, { PROJ_A, PROJ_B, docA, docB, mergeLogA });
    await page.goto('/wigwag.html', { waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);

    let migrationState = await rawIdbGet(page, 'meta', 'migrationState');
    expect(migrationState[PROJ_B].cleanedUp).toBeFalsy();
    expect(await page.evaluate((k) => localStorage.getItem(k), 'git_native_tracker_v1:' + PROJ_B)).not.toBeNull();
    expect(await page.evaluate((k) => localStorage.getItem(k), 'git_native_tracker_merge_log_v1:' + PROJ_A)).not.toBeNull();

    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);

    migrationState = await rawIdbGet(page, 'meta', 'migrationState');
    expect(migrationState[PROJ_A].cleanedUp).toBe(true);
    expect(migrationState[PROJ_B].cleanedUp).toBe(true);
    expect(await page.evaluate((k) => localStorage.getItem(k), 'git_native_tracker_v1:' + PROJ_A)).toBeNull();
    expect(await page.evaluate((k) => localStorage.getItem(k), 'git_native_tracker_v1:' + PROJ_B)).toBeNull();
    expect(await page.evaluate((k) => localStorage.getItem(k), 'git_native_tracker_merge_log_v1:' + PROJ_A)).toBeNull();

    // IndexedDB's own copies -- the only ones left -- are unaffected and
    // still correct (Project A through its normal hydration pass).
    expect(await rawIdbGet(page, 'projectDocs', PROJ_B)).toEqual(docB);
    const idbDocA = await rawIdbGet(page, 'projectDocs', PROJ_A);
    expect(idbDocA.projectNotes).toBe(docA.projectNotes);

    // A third boot: nothing left to clean up, nothing re-runs, no errors.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
    migrationState = await rawIdbGet(page, 'meta', 'migrationState');
    expect(migrationState[PROJ_A].cleanedUp).toBe(true);
    expect(migrationState[PROJ_B].cleanedUp).toBe(true);
  });

  test('deleting a project immediately removes its legacy localStorage keys and migration bookkeeping, even on the very first boot (before the verified-twice cleanup would otherwise run)', async ({ page }) => {
    // docA/docB above are deliberately minimal (only ever read back from
    // IndexedDB directly, never rendered) -- this test drives the real
    // UI (switcher, project settings, delete), so it needs real
    // renderable issues, same shape as the app's own demo fixture.
    const renderableDocA = { ...docA, issues: [{ id: 'a1', num: 1, fieldRefs: {}, fieldLoading: {}, comments: [], history: [{ id: 'ha1', time: new Date().toISOString(), actor: 'Tester', email: 'tester@example.com', text: 'Set Issue to "Issue A1"', field: 'title', value: 'Issue A1', origin: 'authored', sortKey: 1, sig: null, sigRedacted: null, pubKey: null }] }] };
    const renderableDocB = { ...docB, issues: [{ id: 'b1', num: 1, fieldRefs: {}, fieldLoading: {}, comments: [], history: [{ id: 'hb1', time: new Date().toISOString(), actor: 'Tester', email: 'tester@example.com', text: 'Set Issue to "Issue B1"', field: 'title', value: 'Issue B1', origin: 'authored', sortKey: 1, sig: null, sigRedacted: null, pubKey: null }] }] };
    await page.addInitScript(seedLegacyLocalStorage, { PROJ_A, PROJ_B, docA: renderableDocA, docB: renderableDocB, mergeLogA });
    await page.goto('/wigwag.html', { waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(500);

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Project B').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await h.selectProjectPanelSection(page, 'danger');
    await page.locator('[data-testid=btn-delete-project]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=delete-project-name-input]').fill('Project B');
    await page.locator('[data-testid=btn-confirm-delete-project]').click();
    await page.waitForTimeout(400);

    expect(await page.evaluate((k) => localStorage.getItem(k), 'git_native_tracker_v1:' + PROJ_B)).toBeNull();
    expect(await rawIdbGet(page, 'projectDocs', PROJ_B)).toBeNull();
    const migrationState = await rawIdbGet(page, 'meta', 'migrationState');
    expect(migrationState[PROJ_B]).toBeUndefined();
    // Project A is untouched by B's deletion -- still mid-way through its
    // own 2-boot cycle, its leftover legacy copy still present.
    expect(migrationState[PROJ_A].cleanedUp).toBeFalsy();
    expect(await page.evaluate((k) => localStorage.getItem(k), 'git_native_tracker_v1:' + PROJ_A)).not.toBeNull();
  });
});
