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

    // Project A IS the active project, so its localStorage copy gets
    // legitimately rewritten by the pre-existing hydration/backfill pass
    // before migration-in ever runs (new timestamp field defs, backfill
    // history entries) -- the meaningful check is that IndexedDB matches
    // whatever localStorage *currently* holds, not our raw pre-hydration seed.
    const currentLocalStorageDocA = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), 'git_native_tracker_v1:' + PROJ_A);
    const idbDocA = await rawIdbGet(page, 'projectDocs', PROJ_A);
    expect(idbDocA).toEqual(currentLocalStorageDocA);
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
