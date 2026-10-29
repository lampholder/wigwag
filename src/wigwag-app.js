// Phase 1 of the wigwag-core extraction (see
// /home/dev/.claude/plans/vast-cuddling-pnueli.md) -- this used to be ~960
// lines of module-level pure functions/constants defined right here.
// They now live in wigwag-core.js, baked into window.WigwagCore by a
// plain <script> earlier in this file's own <head> (see the
// window.__wigwagOwnSource capture script right above it) -- so a CLI
// can require() the exact same file and get identical behavior, not a
// hand-synced copy. Every call site below is unchanged (still bare
// names like deriveIssueValues(...), not window.WigwagCore.xxx(...))
// because this destructure is the only thing that needed to change.
const {
  xlsxCrc32, xlsxDeflateRaw, xlsxU16, xlsxU32, XLSX_DOS_TIME, XLSX_DOS_DATE, xlsxBuildZip, xlsxEscape, xlsxColLetter, xlsxDateSerial, XLSX_PALETTE_HEX, xlsxFieldHref, xlsxBuildStyles, xlsxStylesXml, buildXlsxWorkbook, blankProjectFieldDefs, WIDTHS, defaultFieldDefs, defaultColumnOrder, canonicalColumnOrder, reconcileColumnOrder, TITLE_COL_ID, COMMENTS_COL_ID, SENTINEL_COLUMN_IDS, realColumnOrder, FORMAT_VERSION, STORAGE_KEY, SECRETS_KEY, PROJECTS_KEY, SESSION_PROJECT_KEY, IDENTITIES_KEY, COLUMN_WIDTHS_KEY, WRAP_KEY, COLUMN_ORDER_KEY, COLUMN_FILTERS_KEY, HIDDEN_FIELDS_KEY, LOCAL_FIELD_BINDINGS_KEY, LOCAL_DERIVED_ENTRY_IDS_KEY, UNSET_FILTER_VALUE, issueValueMatchesFilter, computeColumnFilterExcludedIds, columnFilterIsActive, dateFilterPresetRanges, parseFilterQuery, issueMatchesFieldTokens, computeFilterSuggestions, commitFilterSuggestion, isPastedTextASingleUrl, wrapSelectionWithMarkdownLink, COMMENT_READS_KEY, ISSUE_SUBSCRIPTIONS_KEY, SORT_KEY, SNAPSHOT_INGESTED_KEY, MENTION_NOTIFICATIONS_KEY, NOTIFIED_MENTIONS_KEY, NOTIFIED_MENTIONS_CAP, textMentionsEmail, truncate, splitHighlightSegments, matchingIssuesByIdPrefix, splitEmbeddedWigwagLinks, relativeAge, fieldRefSearchText, JIRA_KEY_RE, SF_ID_PREFIXES, salesforceObjectTypeFromId, IDENTITY_PROXY_FIELDS, identityProxyFieldsFrom, refInfo, col, pickGithubFields, pickJiraFields, pickSalesforceFields, escapeHtml, renderMarkdownInline, renderMarkdown, commentGroupKey, latestCommentsById, deriveIssueValues, backfillIssueHistoryFromValues, deriveIssueFieldRefs, ISSUE_DELETED_FIELD_ID, issueIsDeleted, hydrateIssue, migrateLegacyComments, deriveFieldDefs, effectiveFieldDefs, deriveProjectName, PROJECT_NAME_FIELD_ID, deriveProjectNotes, PROJECT_NOTES_FIELD_ID, backfillProjectHistory, hydrateProject, ensureCommentsFieldDef, base64FromBytes, bytesFromBase64, base64FromText, textFromBase64, principalKind, SIGN_ALG, signablePayload, signableProjectPayload, redactedPayload, redactedProjectPayload, signableCommentPayload, redactedCommentPayload, signableProjectCommentPayload, redactedProjectCommentPayload, RULE_NO_OPERAND_OPS, S, ruleCondition, ruleRowCriteria, ruleRowCondition, optionLabelForThen, ruleThenLiteral, compileRuleRows, COLORS, PALETTE_ORDER
,
  buildSource, normalizeRef, evalRule, ruleNeedsSourceData, isEmptyBoundValue, fieldLocalBindState, applyComputedToField, applyLinkedRules, applyLiveLinkedRules, computeBoundFieldRef, settleLinkedRules, sortValue, computeSortSnapshot, builtinKindConfigured, builtinKindReachable,
  CONNECTED_SOURCES_KEY, CONNECTED_SOURCE_RESERVED_KEYS, slugifyConnectorKey, pickConnectorFields, connectorLinkText, compileConnectorMacro,
  importSigningKey, signWithKey, verifyPayload, advanceSortKey, commitSignedEntry,
  squashHistory, displayValueForHistory, buildSourceText, humanFileSize, parseJsonl, entryKey, commentKey, unionByKey, mergeCommentStreams, mergeIssuePair, computeIssueMerge, mergeHasRealChanges, computeFieldDefsMerge, computeDerivedChangeEntries, buildGithubContentsUrl, buildGithubContentsHeaders, buildGithubCommitMessage, pullGithubFile, pushGithubFile, probeGithubRepoAccess, issueCreatedAt, computeHeaderMeshTriangles, computeHeaderCompression, cellPaddingForWidth, computeAffordanceFade,
  diff3Merge, formatDateLabel, provenanceMarkerSuffix, conflictMarkerLines, hasUnresolvedMergeMarkers, computeMergeProseEntries, MERGE_LOG_TYPE, MERGE_LOG_VERSION, mergeLogStorageKey, buildMergeRecord, buildMergeIssueSummary, latestEntryIdsByField,
  patchMergeSummaryResultEntryId, fieldStillSafeToRevert, computeMergeRollbackEntries, buildMergePreviewViewModel, buildMergeFieldTimeline, mergeRecordNeedsAttention, buildMergeFieldDiffLines, mergeSettledValueView, buildMergeIssueTimeline, resolveFieldValueView,
  WIGWAG_EXPORT_TYPE, WIGWAG_EXPORT_VERSION, canonicalRecordsText, computeContentSha256Hex, fingerprintPublicKey, buildExportEnvelope, parseExportEnvelope, verifyExportEnvelope, EXPORT_TRUST_KEY, lookupSenderTrust, classifySenderTrust, rememberSenderTrust, classifyExportProvenance
} = window.WigwagCore;

// Converts a VAPID public key (base64url, no padding -- the format the
// web-push library on the relay side emits) into the raw bytes
// PushManager.subscribe's applicationServerKey option requires. Kept local
// to this script rather than promoted into WigwagCore -- push-relay.js
// (Node) never needs to decode this itself; it only ever hands the
// base64url string straight to/from the web-push library.
function base64UrlToBytes(base64Url) {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - base64Url.length % 4) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// --- Room Scoped Widget Mode: storage substrate selection ---
// See docs/FORMAT.md and tracker f6b39bf0/#153. Real browser localStorage
// is synchronous; a Matrix Widget API / postMessage RPC to a parent frame
// is inherently asynchronous -- so instead of rewriting every call site
// to be async, this shadows the bare `localStorage` identifier (used
// unchanged at every existing call site below) with an in-memory,
// Storage-shaped shim for the three content keys (docKey(projectId),
// PROJECTS_KEY, IDENTITIES_KEY) when a parent frame confirms it will
// service them. Everything else (UI prefs, SECRETS_KEY, etc.) passes
// through to the real localStorage untouched, in both modes.
let localStorage = window.localStorage;
let ROOM_MODE_CAPABILITIES = null;
// Set from the handshake ack (wigwag-matrix-host.html's own roomId,
// added alongside this) -- lets storagePrefKey() below room-scope the
// cosmetic/metadata prefs that are otherwise keyed by projectId alone in
// real localStorage (see storagePrefKey's own comment). null in Local
// Mode, where projectId alone has always been the right, sufficient key.
let ROOM_MODE_ROOM_ID = null;
function isRoomModeContentKey(key) {
  // IDENTITIES_KEY is deliberately EXCLUDED -- a signing keypair is a
  // device credential, not room content (the same category as any real
  // Matrix client's own E2EE device keys, which every client legitimately
  // keeps locally). It stays in real localStorage so this device signs
  // consistently across reloads/reconnects, instead of minting a brand
  // new identity every page load. See the plan doc's explicit scope call
  // on this. PROJECTS_KEY and docKey(...) are the actual room content.
  return key === PROJECTS_KEY || (typeof key === 'string' && key.indexOf(STORAGE_KEY + ':') === 0);
}
function createRoomModeStorageShim() {
  const mem = new Map();
  const real = window.localStorage;
  return {
    _mem: mem,
    getItem(key) { return isRoomModeContentKey(key) ? (mem.has(key) ? mem.get(key) : null) : real.getItem(key); },
    setItem(key, value) {
      if (!isRoomModeContentKey(key)) { real.setItem(key, value); return; }
      mem.set(key, value);
      window.parent.postMessage({ type: 'wigwag:local-write', key, newValue: value }, '*');
    },
    removeItem(key) {
      if (!isRoomModeContentKey(key)) { real.removeItem(key); return; }
      mem.delete(key);
      window.parent.postMessage({ type: 'wigwag:local-write', key, newValue: null }, '*');
    },
    // Applies a remote-originated change (from the parent frame) and
    // dispatches a real StorageEvent shaped exactly like the native
    // cross-tab one -- _onStorageEvent (below) needs zero changes to
    // handle this, since it already only reads e.key/e.newValue/
    // e.storageArea and already requires e.storageArea === localStorage,
    // which is true here since this shim IS what `localStorage`
    // resolves to once activateRoomMode() below has run.
    _applyRemote(key, newValue) {
      if (newValue === null || newValue === undefined) mem.delete(key); else mem.set(key, newValue);
      const evt = new Event('storage');
      evt.key = key; evt.newValue = newValue; evt.storageArea = this; evt.url = location.href;
      window.dispatchEvent(evt);
    }
  };
}

// Tracker #187, Phase 1 (groundwork): IndexedDB wrapper for the project
// doc + merge log -- the two localStorage keys that actually grow
// unbounded (every signed edit ever made, kept forever). Firefox caps
// localStorage itself at 5MB by default (dom.storage.default_quota,
// separate from the much larger disk-scaled Storage API quota
// navigator.storage.estimate() reports) -- a real user hit exactly this,
// and persist() silently failed (console.warn only, no user-visible
// sign). IndexedDB has no such separate small quota.
//
// Deliberately NOT in wigwag-core.js: that module is require()'d
// directly by wigwag-cli.js/wigwag-core.test.js in plain Node with no
// DOM, and must never gain an indexedDB dependency. This is the one
// piece of wigwag.html's own app logic that isn't portable to the CLI,
// by design -- the CLI operates on a local directory's tracker.jsonl via
// wigwag-file-store.js, a completely different (filesystem) backend.
//
// Three object stores, out-of-line keys (store.put(value, key)) so the
// stored value is byte-for-byte the same shape persist()/loadPersisted()
// already produce/consume -- no projectId field to inject or strip on
// every read/write:
//   - projectDocs: key = projectId, value = the doc object
//     ({fieldDefs, issues, projectHistory, githubRepo*, projectNotes,
//     projectComments}) exactly as persist() already builds it.
//   - mergeLogs: key = mergeLogStorageKey(storagePrefKey(projectId))
//     (keeps the existing Room-Mode-aware composite-key convention),
//     value = the same capped-200-entry array.
//   - meta: bookkeeping only (migration-in state, see Phase 2).
// IndexedDB's own version number IS the schema version -- no second ad
// hoc version field bolted on top.
const WIGWAG_IDB_NAME = 'wigwag-docstore';
const WIGWAG_IDB_VERSION = 1;
let _wigwagDbPromise = null;
function openWigwagDb() {
  if (_wigwagDbPromise) return _wigwagDbPromise;
  _wigwagDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(WIGWAG_IDB_NAME, WIGWAG_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projectDocs')) db.createObjectStore('projectDocs');
      if (!db.objectStoreNames.contains('mergeLogs')) db.createObjectStore('mergeLogs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Insurance for a future schema bump from another tab -- without
      // this, a version-upgrade in one tab leaves this tab holding a
      // stale connection that silently blocks the upgrade elsewhere.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return _wigwagDbPromise;
}
function idbGet(storeName, key) {
  return openWigwagDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
    req.onerror = () => reject(req.error);
  }));
}
function idbPut(storeName, key, value) {
  return openWigwagDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbDelete(storeName, key) {
  return openWigwagDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function idbGetDoc(projectId) { return idbGet('projectDocs', projectId); }
function idbPutDoc(projectId, doc) { return idbPut('projectDocs', projectId, doc); }
function idbDeleteDoc(projectId) { return idbDelete('projectDocs', projectId); }
function idbGetMergeLog(prefKey) { return idbGet('mergeLogs', prefKey).then(v => v || []); }
function idbPutMergeLog(prefKey, log) { return idbPut('mergeLogs', prefKey, log); }
function idbGetMeta(key) { return idbGet('meta', key); }
function idbPutMeta(key, value) { return idbPut('meta', key, value); }

// Tracker #187, Phase 3: the one indirection every docKey/
// mergeLogStorageKey call site goes through, uniformly async regardless
// of branch. Room Scoped Widget Mode's branch is exactly today's
// existing code (that mode already shadows the bare localStorage
// identifier with its own in-memory shim for precisely these two kinds
// of keys -- see createRoomModeStorageShim/isRoomModeContentKey above),
// just wrapped in a resolved Promise so every caller can uniformly
// await regardless of which branch actually runs. Local Mode's branch
// is the new IndexedDB path.
function buildProjectSummaryFromDoc(doc) {
  const fieldDefs = (doc && doc.fieldDefs) || {};
  const issues = (doc && doc.issues) || [];
  return {
    issueCount: issues.filter(iss => !issueIsDeleted(iss.history)).length,
    githubRepo: (doc && doc.githubRepo) || '',
    githubRepoPath: (doc && doc.githubRepoPath) || 'tracker.jsonl',
    githubRepoBranch: (doc && doc.githubRepoBranch) || '',
    issues: issues.map(iss => {
      let title = '';
      try { title = deriveIssueValues(iss, fieldDefs).title || ''; } catch (e) { /* malformed issue -- blank title, not a crash */ }
      return { id: iss.id, title: String(title) };
    })
  };
}
const docStore = {
  async getDoc(projectId) {
    if (ROOM_MODE_CAPABILITIES) {
      const raw = localStorage.getItem(STORAGE_KEY + ':' + projectId);
      return raw ? JSON.parse(raw) : null;
    }
    return idbGetDoc(projectId);
  },
  async putDoc(projectId, doc) {
    if (ROOM_MODE_CAPABILITIES) { localStorage.setItem(STORAGE_KEY + ':' + projectId, JSON.stringify(doc)); return; }
    return idbPutDoc(projectId, doc);
  },
  async deleteDoc(projectId) {
    if (ROOM_MODE_CAPABILITIES) { localStorage.removeItem(STORAGE_KEY + ':' + projectId); return; }
    return idbDeleteDoc(projectId);
  },
  async getMergeLog(prefKey) {
    if (ROOM_MODE_CAPABILITIES) {
      try { return JSON.parse(localStorage.getItem(mergeLogStorageKey(prefKey)) || '[]'); } catch (e) { return []; }
    }
    return idbGetMergeLog(mergeLogStorageKey(prefKey));
  },
  async putMergeLog(prefKey, log) {
    if (ROOM_MODE_CAPABILITIES) { localStorage.setItem(mergeLogStorageKey(prefKey), JSON.stringify(log)); return; }
    return idbPutMergeLog(mergeLogStorageKey(prefKey), log);
  }
};

// Starting point for "+ Add source" -> "Blank custom" only now --
// Jira/GitHub/Salesforce used to seed a macro-shaped template here too
// (and, earlier still, doubled as migrateBuiltinConnectors' own seed
// data), but per the connector-management redesign (/home/dev/.claude/
// plans/encapsulated-waddling-gizmo.md, confirmed with Tom) those 3
// kinds now always open the real BUILTIN_INTEGRATIONS config editor
// (openBuiltinSourceForm) for a NEW instance instead, never a macro --
// see typeOptions below. A template just pre-fills the SAME draft shape
// openAddConnectorForm already builds; once saved, a template-seeded
// connector is byte-identical to a hand-built one, no separate
// discriminant to track or migrate later.
const CONNECTOR_TEMPLATES = {
  blank: { name: '', glyph: '', color: col('red').dot, patterns: [{ regex: '', label: '' }], macro: '', linkTextTemplate: '' }
};
// The 3 built-in systems (GitHub/Jira/Salesforce): NOT a connector-
// template/macro at all -- Tom's own correction, mid-session: these are
// real, hardcoded integrations (the actual bridges/*.js logic, ported
// in-process) behind a homogeneous EDITOR CHROME, not a user-editable
// macro. Each gets exactly the config fields its own real bridge script
// needed (see fetchJiraData/fetchSalesforceData/fetchGithubData) --
// rootUrl always, username only where the auth model actually uses one
// (Jira Cloud's email, Salesforce's username -- GitHub's token needs
// none). usernameLabel null means the editor shows no username field at
// all for that system. rootUrlDefault seeds a sensible starting value
// (GitHub/Salesforce both have one real default worth pre-filling;
// Jira's varies per org, no default to offer).
const BUILTIN_INTEGRATIONS = {
  github: {
    name: 'GitHub', key: 'github',
    rootUrlLabel: 'API base URL', rootUrlPlaceholder: 'https://api.github.com', rootUrlDefault: 'https://api.github.com',
    usernameLabel: null, usernamePlaceholder: '',
    credentialLabel: 'Personal access token', credentialPlaceholder: 'ghp_...',
    helperText: 'A fine-grained or classic personal access token. Optional for public repos (unauthenticated requests are rate-limited); required for private ones.'
  },
  jira: {
    name: 'Jira', key: 'jira',
    rootUrlLabel: 'Jira base URL', rootUrlPlaceholder: 'https://yourco.atlassian.net', rootUrlDefault: '',
    usernameLabel: 'Email (leave blank to use a Personal Access Token instead)', usernamePlaceholder: 'you@yourco.com',
    credentialLabel: 'API token / Personal Access Token', credentialPlaceholder: '...',
    helperText: 'Jira Cloud: your account email + an API token (id.atlassian.com/manage-profile/security/api-tokens). Jira Server/Data Center: leave email blank, paste a Personal Access Token instead.'
  },
  salesforce: {
    name: 'Salesforce', key: 'salesforce',
    rootUrlLabel: 'Login URL', rootUrlPlaceholder: 'https://login.salesforce.com', rootUrlDefault: 'https://login.salesforce.com',
    usernameLabel: 'Username', usernamePlaceholder: 'you@yourco.com',
    credentialLabel: 'Password + security token', credentialPlaceholder: '...',
    helperText: 'Your Salesforce username, and your password with its security token appended directly (no separator) -- e.g. a password of "hunter2" and token "ABC123" is entered as "hunter2ABC123". Omit the token if your org has a Trusted IP Range covering this device. Use https://test.salesforce.com as the Login URL for a sandbox org.'
  }
};
// Jira Cloud's `description` field is Atlassian Document Format (a nested
// JSON tree), not plain text -- Server/DC still returns a plain string.
// Flatten either shape to plain text; good enough for a preview/rule
// input, not meant to preserve rich formatting. Ported verbatim from
// bridges/jira-proxy.js.
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  let out = node.text || '';
  if (Array.isArray(node.content)) {
    out += node.content.map(adfToText).join('');
    if (node.type === 'paragraph') out += '\n';
  }
  return out;
}
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class Component extends DCLogic {
  constructor(props) {
    super(props);
    this._tabId = crypto.randomUUID();
    this._pendingGatedAction = null;
    this._lastSortKey = 0;
    // Per-project JSON snapshot of the issues array as last known to
    // match localStorage -- lets persist() (below) tell "disk moved since
    // I last looked" apart from "I'm just writing my own latest edit".
    // See persist()'s own comment for why this exists.
    this._docIssuesBaseline = {};
    this._lastDocSyncJson = {};
    this._lastMeasureOverflowDeps = null;
    this._projectSummaries = {};
    // Tracker #169/4f07e72b (moderator-proposed table layouts): per-
    // project (a room can hold more than one -- tracker #149) identity
    // (proposedBy+proposedAt) of whichever proposal was most recently
    // accepted or dismissed FOR THAT PROJECT -- purely in-memory, purely
    // local, same "never persisted, disappears on reload" treatment as
    // roomWriteRejectedMessage -- so a poll re-delivering the SAME still-
    // current state event doesn't reopen a banner the user already acted
    // on, while a genuinely NEW proposal (different identity) always does.
    this._handledLayoutProposalKeyByProject = {};
    this.state.isMobileViewport = window.matchMedia('(max-width: 640px)').matches;
    this.state.layoutProposals = {};
    this.state.isRoomModerator = false;
    // ?storageNamespace= was the OLD (now fully removed) widget host's
    // own signal that it was about to poke this frame's shared-origin
    // localStorage directly and expected an immediate, normal boot --
    // exactly like Local Mode (see docs/FORMAT.md's "Migration note").
    // wigwag-matrix-host.html no longer sets this param at all -- kept
    // here as a defensive, low-cost guard (discovered live via the full
    // suite: without something like it, a stray/older embedder passing
    // this param would otherwise stall the full handshake timeout below
    // on every visit for no reason) rather than assuming nothing will
    // ever pass it again.
    let legacyStorageNamespace = false;
    try { legacyStorageNamespace = new URLSearchParams(location.search).has('storageNamespace'); } catch (e) {}
    if (window.parent !== window && !legacyStorageNamespace) {
      // Embedded in a frame, and NOT the current legacy host -- could be
      // a real new-protocol wigwag host or an unrelated iframe. Either
      // way, don't run the normal boot sequence (which would read empty
      // content keys and synthesize a phantom blank project/identity --
      // the "placeholder pollution" failure mode) until a real host
      // actually confirms itself, or a generous timeout proves there
      // isn't one.
      this.state.roomModeBootstrapping = true;
      this.beginRoomModeHandshake();
    } else {
      this.state.localDocLoading = true;
      this.runBootSequence();
    }
  }
  // Sends a one-shot handshake to the parent frame and waits for
  // wigwag:hello-ack (which carries both capabilities and the initial
  // content-key snapshot together -- a real host may take a few seconds
  // to finish its own Matrix hydration before it can answer, so this
  // timeout is generous, not a fast round-trip check). No answer in time
  // means "not actually a wigwag host" -- fall back to normal Local Mode
  // rather than block boot forever.
  beginRoomModeHandshake() {
    let settled = false;
    const onMessage = (e) => {
      if (settled || !e.data || e.data.type !== 'wigwag:hello-ack') return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      this.activateRoomMode(e.data).catch(err => console.warn('[tracker] failed to activate Room Mode:', err));
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      Promise.resolve(this.runBootSequence()).then(() => {
        this.setState(Object.assign({}, this.state, { roomModeBootstrapping: false }));
        if (window.parent !== window) window.parent.postMessage({ type: 'wigwag:ready' }, '*');
      });
    }, 8000);
    window.parent.postMessage({ type: 'wigwag:hello' }, '*');
  }
  // Activates the in-memory storage shim from a confirmed host's initial
  // snapshot, then runs the (otherwise-identical) boot sequence against
  // it, then triggers a real re-render via setState -- runBootSequence()
  // mutates this.state directly (exactly as it does for the constructor's
  // own pre-mount use), so this passes the whole, already-mutated state
  // back through setState rather than relying on an empty patch to
  // trigger the framework's re-render.
  async activateRoomMode(ackData) {
    const shim = createRoomModeStorageShim();
    const snapshot = (ackData && ackData.snapshot) || {};
    Object.keys(snapshot).forEach(k => { if (snapshot[k] != null) shim._mem.set(k, snapshot[k]); });
    localStorage = shim;
    ROOM_MODE_CAPABILITIES = (ackData && ackData.capabilities) || null;
    ROOM_MODE_ROOM_ID = (ackData && ackData.roomId) || null;
    // Tracker #158: replays whatever the host's own in-memory outbox
    // still has outstanding across a plain iframe reload -- only this
    // iframe's own render state reset, the host (and its outbox) did not.
    this.state.pendingEditsByProject = (ackData && ackData.pendingSummaries) || {};
    this.state.isRoomModerator = !!(ackData && ackData.isModerator);
    window.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.type === 'wigwag:storage-changed') { shim._applyRemote(e.data.key, e.data.newValue); return; }
      // Moderator-gate rejection (tracker f6b39bf0, live-reported rate-
      // limit incident): the host already rolled back the optimistic
      // local write on its own side -- this only surfaces WHY to the
      // user, never a silent failure.
      if (e.data.type === 'wigwag:room-write-rejected') { this.setState({ roomWriteRejectedMessage: e.data.reason || 'Could not add this project to the room.' }); return; }
      // Tracker #158: purely local, per-device "have my own edits landed
      // yet" state -- see wigwag-matrix-host.html's pendingOutboxByProject
      // comment for the full design. Never broadcast to other room
      // viewers, by design (Tom's own call).
      if (e.data.type === 'wigwag:pending-update') { this.setState(s => ({ pendingEditsByProject: { ...(s.pendingEditsByProject || {}), [e.data.projectId]: e.data.summary } })); return; }
      // Tracker #169/4f07e72b: re-derived fresh on every poll tick that
      // found anything new (see wigwag-matrix-host.html's own comment) --
      // filterHandledLayoutProposals is what keeps an already-accepted/
      // dismissed proposal from reopening its own banner on a redundant
      // re-delivery of the same still-current state event.
      if (e.data.type === 'wigwag:layout-proposals') { this.setState({ layoutProposals: this.filterHandledLayoutProposals(e.data.proposalsByProjectId || {}) }); return; }
      if (e.data.type === 'wigwag:moderator-status') { this.setState({ isRoomModerator: !!e.data.isModerator }); return; }
      // Tracker #167/2275c4a6 follow-up, live-reported "table resizes
      // itself after rendering": wigwag-matrix-host.html's revealFrame
      // posts this right after actually setting #frame's display to
      // block, so there's a guaranteed correct remeasure against real
      // (non-zero) layout -- see measureTableOverflow's own guard above
      // for why one while still hidden can't be trusted.
      if (e.data.type === 'wigwag:revealed') { this.measureTableOverflow(); return; }
    });
    if (ackData && ackData.matrixUserId) await this.resolveRoomModeIdentity(ackData.matrixUserId, ackData.fallbackDisplayName, ackData.matrixDeviceId);
    // Test-only introspection hook, mirroring wigwag-matrix-host.html's
    // own window.__wigwagHostStorage -- content lives only in this
    // in-memory shim now, nowhere a test could otherwise observe or seed
    // it (page.evaluate()'s injected code runs at the page's true global
    // scope, which never sees this script tag's own shadowed
    // `let localStorage`, by design -- real window.localStorage is a
    // DIFFERENT object entirely). Read-only in spirit; harmless in
    // production, exposing nothing a real client couldn't already see by
    // watching the postMessage traffic itself.
    window.__wigwagRoomStorageShim = shim;
    await this.runBootSequence();
    // Tracker #169/4f07e72b: a proposal already live before this viewer
    // even connected (or a moderator status that already applies) must
    // show up immediately -- same treatment as pendingSummaries above.
    // Keyed by project id since a room can hold more than one (#149).
    // Filtered down here, AFTER runBootSequence() (not alongside
    // pendingEditsByProject at the top of this function), because the
    // self-exclusion check in filterHandledLayoutProposals
    // (proposedByMatrixUserId === my own identity's matrixUserId) needs
    // this.state.identities/activeIdentityId to already be populated --
    // resolveRoomModeIdentity above only writes IDENTITIES_KEY to
    // localStorage directly; loadIdentities() (called from inside
    // runBootSequence) is what actually loads it into state. Filtering
    // any earlier always saw an empty identity list, so a proposal that
    // is unmistakably the viewer's own still got shown once on every
    // fresh connect (first ever, or right after a reload).
    this.state.layoutProposals = this.filterHandledLayoutProposals((ackData && ackData.layoutProposals) || {});
    this.setState(Object.assign({}, this.state, { roomModeBootstrapping: false }));
    // Tracker #167/2275c4a6 follow-up, live-reported: this -- not
    // componentDidMount, which fires on the FIRST mount, while
    // roomModeBootstrapping is still true -- is the real "I have actual
    // content to show" point. Tells wigwag-matrix-host.html's revealFrame
    // to swap away from its own splash now, not before.
    if (window.parent !== window) window.parent.postMessage({ type: 'wigwag:ready' }, '*');
  }
  // Find-or-create a signing identity keyed on the Matrix user id itself
  // (mirrors wigwag-matrix-host.html's OLD bootstrapLocalStorage identity
  // logic, relocated here now that IDENTITIES_KEY is real, unshimmed
  // localStorage in Room Mode -- the host no longer has access to it at
  // all). Runs BEFORE runBootSequence() so ensureDefaultIdentityIfNeeded's
  // own "IDENTITIES_KEY already exists, skip" check sees this real,
  // MXID-matched identity rather than bootstrapping a fresh, wrong one.
  //
  // label = the room display name (cosmetic, local, unsigned -- never
  // used for attribution, since a Matrix display name is user-settable
  // and would make impersonation trivial). email carries the Matrix user
  // id itself: wigwag's signed-entry payload has no separate attribution
  // field, and an unsigned one would be worse than none on a tamper-
  // evident log, so the MXID goes in the one signed, human-readable "who
  // did this" slot that exists. matrixUserId is the local marker that
  // this identity's email is an MXID mirror, not a real address -- used
  // for this exact find-or-create on every future reconnect.
  async resolveRoomModeIdentity(matrixUserId, fallbackDisplayName, matrixDeviceId) {
    let store = null;
    try { store = JSON.parse(localStorage.getItem(IDENTITIES_KEY) || 'null'); } catch (e) {}
    if (!store || !Array.isArray(store.identities)) store = { activeIdentityId: null, identities: [], lastActiveProjectByIdentity: {} };
    let identity = store.identities.find(i => i.matrixUserId === matrixUserId)
      || store.identities.find(i => !i.matrixUserId && i.email === matrixUserId);
    if (!identity) {
      const { signingPublicKeyJwk, signingPrivateKeyJwk } = await this.generateIdentityKeypair();
      identity = {
        id: crypto.randomUUID(), label: (fallbackDisplayName || '').trim() || matrixUserId,
        matrixUserId, email: matrixUserId,
        githubToken: '', ...identityProxyFieldsFrom(null),
        signingPublicKeyJwk, signingPrivateKeyJwk
      };
      store.identities.push(identity);
    }
    identity.matrixUserId = matrixUserId;
    if (matrixDeviceId) identity.matrixDeviceId = matrixDeviceId; // real device id, when the client supports surfacing it
    const freshLabel = (fallbackDisplayName || '').trim();
    if (freshLabel) identity.label = freshLabel; // cosmetic only, never signed
    store.activeIdentityId = identity.id;
    localStorage.setItem(IDENTITIES_KEY, JSON.stringify(store));
  }
  // The full synchronous boot sequence, pulled out of the constructor so
  // Room Scoped Widget Mode can defer and re-run it once the room's
  // initial snapshot has actually arrived, instead of running it against
  // an empty in-memory store and bootstrapping a phantom blank
  // project/identity. Still mutates this.state directly (not via
  // setState) exactly as it always has for the constructor's own
  // pre-mount use -- a post-mount caller is responsible for its own
  // setState afterward to trigger a re-render.
  runBootSequence() {
    this.bootstrapFirstProjectIfNeeded();
    this.ensureDefaultIdentityIfNeeded();
    this.loadIdentities();
    this.loadProjectIndex();
    this.reconcileActiveIdentityWithProject();
    this.state.commentReads = this.commentReadsFor(this.state.activeIdentityId);
    this.state.issueSubscriptions = this.issueSubscriptionsFor(this.state.activeIdentityId);
    this.ingestEmbeddedSnapshotIfPresent();
    this.loadSecrets();
    this.hydrateActiveIdentitySecrets();
    this.migrateBuiltinConnectors();
    this._lastPersistedProjectIndexJson = JSON.stringify({ activeMilestoneId: this.state.projectId, milestones: this.state.projects });
    return this.finishBootSequenceAsync();
  }
  // Tracker #187, Phase 3: the async tail of boot -- migration-in (Phase
  // 2, idempotent/safe to re-run), then the active project's own doc
  // load (replaces the old synchronous loadPersisted() body), then
  // finally the boot-overlay dismiss timer, which must only start
  // counting down once real data is actually in state (see comment on
  // the constructor change above). Never awaited by the constructor
  // itself (can't be -- constructors can't be async); render proceeds
  // immediately with localDocLoading:true, gated in renderVals() above.
  async finishBootSequenceAsync() {
    try { await this.migrateLocalStorageDocsToIndexedDb(); } catch (e) { console.warn('[tracker] migration-in sweep failed:', e); }
    await this.loadPersistedAsync();
    this.warmProjectSummaries().catch(e => console.warn('[tracker] failed to warm project summaries:', e));
    this.kickOffBootOverlayDismiss();
  }
  // Tracker #187, Phase 5: populates this._projectSummaries for every
  // project in the milestone list, not just the active one -- see
  // buildProjectSummaryFromDoc's own comment for what it's used for.
  async warmProjectSummaries() {
    await Promise.all(this.state.projects.map(p =>
      docStore.getDoc(p.id).then(doc => { this._projectSummaries[p.id] = buildProjectSummaryFromDoc(doc); }).catch(() => {})
    ));
    this.setState({});
  }
  // Tracker #187, Phase 2: one-time-per-project shadow copy of the
  // localStorage project doc + merge log into IndexedDB. Idempotent and
  // safe to re-run every boot -- meta.migrationState only ever records a
  // CLEAN copy (see below); one that isn't (including because a prior
  // attempt errored or failed its own read-back check) is simply
  // retried next time.
  // Tracker #187, Phase 7: once a project's entry is recorded, later
  // boots take a second pass over it (below) that verifies IndexedDB
  // is STILL readable for it -- an independent confirmation, not just
  // trusting the first boot's own copy+readback -- before finally
  // deleting the lingering localStorage originals. Skipped entirely in
  // Room Mode: its doc/merge-log never touch real IndexedDB at all
  // (docStore's own Room Mode branch stays on the localStorage shim),
  // so there's nothing for this sweep to do there, and removeItem below
  // would otherwise hit that shim's live, in-use state.
  async migrateLocalStorageDocsToIndexedDb() {
    if (ROOM_MODE_CAPABILITIES) return;
    try {
      const migrationState = (await idbGetMeta('migrationState')) || {};
      let changed = false;
      for (const proj of this.state.projects) {
        const id = proj.id;
        const existing = migrationState[id];
        if (existing && existing.cleanedUp) continue;
        if (existing) {
          // A later, independent boot since the clean first copy above
          // -- the "verified twice" rule: don't delete the lingering
          // localStorage copy on the strength of a single boot's own
          // say-so, confirm a SEPARATE boot can still read it back too.
          try {
            const verifyDoc = await idbGetDoc(id);
            if (verifyDoc) {
              const verifyMergeKey = mergeLogStorageKey(this.storagePrefKey(id));
              await idbGetMergeLog(verifyMergeKey); // must not throw; an empty array is a legitimate result, not a failure
              localStorage.removeItem(this.docKey(id));
              localStorage.removeItem(verifyMergeKey);
              migrationState[id] = Object.assign({}, existing, { cleanedUp: true });
              changed = true;
            }
          } catch (e) { console.warn('[tracker] migration cleanup: failed to verify/clean up', id, e); }
          continue;
        }
        const entry = {};
        try {
          const existingDoc = await idbGetDoc(id);
          if (existingDoc) {
            entry.doc = 'already-present';
          } else {
            const raw = localStorage.getItem(this.docKey(id));
            if (raw) {
              const parsed = JSON.parse(raw);
              await idbPutDoc(id, parsed);
              const readBack = await idbGetDoc(id);
              entry.doc = (readBack && JSON.stringify(readBack) === JSON.stringify(parsed)) ? 'copied' : 'verify-failed';
            } else {
              entry.doc = 'nothing-to-copy';
            }
          }
        } catch (e) { entry.doc = 'error'; console.warn('[tracker] migration-in: failed to copy project doc', id, e); }
        try {
          const mergeKey = mergeLogStorageKey(this.storagePrefKey(id));
          const existingLog = await idbGetMergeLog(mergeKey);
          if (existingLog.length) {
            entry.mergeLog = 'already-present';
          } else {
            const rawLog = localStorage.getItem(mergeKey);
            if (rawLog) {
              const parsedLog = JSON.parse(rawLog);
              if (Array.isArray(parsedLog) && parsedLog.length) {
                await idbPutMergeLog(mergeKey, parsedLog);
                const readBackLog = await idbGetMergeLog(mergeKey);
                entry.mergeLog = (JSON.stringify(readBackLog) === JSON.stringify(parsedLog)) ? 'copied' : 'verify-failed';
              } else {
                entry.mergeLog = 'nothing-to-copy';
              }
            } else {
              entry.mergeLog = 'nothing-to-copy';
            }
          }
        } catch (e) { entry.mergeLog = 'error'; console.warn('[tracker] migration-in: failed to copy merge log', id, e); }
        if (entry.doc !== 'error' && entry.doc !== 'verify-failed' && entry.mergeLog !== 'error' && entry.mergeLog !== 'verify-failed') {
          migrationState[id] = entry;
          changed = true;
        }
      }
      if (changed) await idbPutMeta('migrationState', migrationState);
    } catch (e) { console.warn('[tracker] migration-in sweep failed:', e); }
  }
  // Full-screen boot splash (design handoff splash_screen.zip, tracker
  // #167/2275c4a6) -- see runBootSequence()'s own comment for why this is
  // called from there rather than componentDidMount.
  kickOffBootOverlayDismiss() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => {
        this.setState({ bootOverlayPhase: 'fading' });
        setTimeout(() => this.setState({ bootOverlayPhase: 'hidden' }), 420);
      }, 260);
    }));
  }
  // Copies the active identity's own email/token/proxy-url/signing-key
  // fields onto the flat state fields every existing call site already
  // reads (displayName(), github/jira sync, comment authorship, signing).
  // Called at boot (after loadSecrets(), so the identity record wins over
  // the legacy global SECRETS_KEY blob) and again on every switchIdentity()
  // so those call sites always see the CURRENTLY active identity, not
  // whichever one last edited these fields.
  hydrateActiveIdentitySecrets() {
    const active = this.state.identities.find(i => i.id === this.state.activeIdentityId);
    if (!active) return;
    this.state.identityEmail = active.email || '';
    this.state.githubToken = active.githubToken || '';
    Object.assign(this.state, identityProxyFieldsFrom(active));
    this.state.identityPublicKeyJwk = active.signingPublicKeyJwk || null;
    this.state.identityPrivateKeyJwk = active.signingPrivateKeyJwk || null;
  }
  docKey(id) { return STORAGE_KEY + ':' + id; }
  // If this file was produced by "Export as HTML", it carries one extra
  // <script type="__bundler/export_snapshot"> holding a JSONL snapshot of
  // the project that was active when it was exported (same shape
  // buildSourceText/parseJsonl already produce/consume for a normal file
  // import). First-ever open: seed it as a new project (skipping that
  // entirely if a project with that id somehow already exists locally --
  // e.g. it was already imported by hand) and make it active, so opening
  // the file goes straight to the shared data. Any later open is a no-op:
  // once ingested, this id is remembered and never reseeded/re-switched-to,
  // so it can't stomp on whatever local edits happened since.
  ingestEmbeddedSnapshotIfPresent() {
    try {
      if (!window.__wigwagExportSnapshot) return;
      const parsed = this.parseJsonl(window.__wigwagExportSnapshot);
      if (!parsed.fields || !parsed.projectId) return;
      const ingestedRaw = localStorage.getItem(SNAPSHOT_INGESTED_KEY);
      const ingested = ingestedRaw ? JSON.parse(ingestedRaw) : [];
      if (ingested.includes(parsed.projectId)) return;
      if (!this.state.projects.some(m => m.id === parsed.projectId)) {
        const doc = {
          fieldDefs: parsed.fields,
          projectHistory: parsed.projectHistory || [],
          issues: parsed.issues.map(iss => ({
            id: iss.id, num: iss.num,
            fieldRefs: iss.fieldRefs || {}, fieldLoading: {},
            values: iss.values || {}, commentStreams: iss.commentStreams || {}, history: iss.history || []
          })),
          columnOrder: defaultColumnOrder(),
          hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: '',
          projectNotes: parsed.projectNotes || '', projectComments: parsed.projectComments || []
        };
        localStorage.setItem(this.docKey(parsed.projectId), JSON.stringify(doc));
        this.state.projects = this.state.projects.concat([{ id: parsed.projectId, name: parsed.projectName || 'Shared snapshot', identityId: this.state.activeIdentityId }]);
      }
      this.state.projectId = parsed.projectId;
      localStorage.setItem(PROJECTS_KEY, JSON.stringify({ activeMilestoneId: this.state.projectId, milestones: this.state.projects }));
      localStorage.setItem(SNAPSHOT_INGESTED_KEY, JSON.stringify(ingested.concat([parsed.projectId])));
    } catch (e) { console.warn('[tracker] failed to ingest embedded snapshot:', e); }
  }
  // Creates the very first project on a genuinely fresh install (empty
  // localStorage) -- nothing to migrate from, Format v1 carries no
  // compatibility with any older on-disk shape. Guarded on PROJECTS_KEY so
  // it only ever runs once, the first time this browser ever opens the app.
  bootstrapFirstProjectIfNeeded() {
    try {
      if (localStorage.getItem(PROJECTS_KEY)) return;
      // Room Scoped Widget Mode has a real "no projects yet" state
      // (tracker f6b39bf0, Tom's explicit call: project creation is
      // moderator-gated) -- never auto-create a phantom local-only
      // default the moment an empty room is opened. Local Mode's
      // first-ever-install bootstrap is unaffected.
      if (ROOM_MODE_CAPABILITIES) return;
      const id = crypto.randomUUID();
      const name = 'Untitled Project 1';
      const fieldDefs = { title: { label: 'Issue', type: 'text' } };
      const doc = {
        fieldDefs, projectHistory: this.starterFieldHistory(fieldDefs, 'system', ''), issues: [],
        hiddenFieldIds: [],
        githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: ''
      };
      localStorage.setItem(this.docKey(id), JSON.stringify(doc));
      localStorage.setItem(PROJECTS_KEY, JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name }] }));
    } catch (e) { console.warn('[tracker] failed to bootstrap first project:', e); }
  }
  // Creates the one default identity a genuinely fresh install needs
  // (every project must belong to an identity), picking up whatever
  // email/token/proxy-url/signing-key SECRETS_KEY already has (e.g. an
  // email set via the gate before any identity existed) so it isn't lost.
  // Guarded the same way bootstrapFirstProjectIfNeeded() is -- runs once,
  // only on a browser that has never had an identity. Also tags any
  // project that somehow predates identities (came from
  // bootstrapFirstProjectIfNeeded() running first) with this new
  // identity's id.
  ensureDefaultIdentityIfNeeded() {
    try {
      if (localStorage.getItem(IDENTITIES_KEY)) return;
      const secretsRaw = localStorage.getItem(SECRETS_KEY);
      const secrets = secretsRaw ? JSON.parse(secretsRaw) : {};
      const id = crypto.randomUUID();
      const identity = {
        id, label: 'Personal', email: secrets.identityEmail || '',
        githubToken: secrets.githubToken || '',
        signingPublicKeyJwk: secrets.identityPublicKeyJwk || null, signingPrivateKeyJwk: secrets.identityPrivateKeyJwk || null
      };
      IDENTITY_PROXY_FIELDS.forEach(f => { identity[f.url] = secrets[f.url] || this.state[f.url] || ''; identity[f.secret] = secrets[f.secret] || this.state[f.secret] || ''; });
      localStorage.setItem(IDENTITIES_KEY, JSON.stringify({
        activeIdentityId: id, identities: [identity], lastActiveProjectByIdentity: {}
      }));
      const projectsRaw = localStorage.getItem(PROJECTS_KEY);
      if (projectsRaw) {
        const idx = JSON.parse(projectsRaw);
        if (idx && Array.isArray(idx.milestones)) {
          idx.milestones = idx.milestones.map(m => m.identityId ? m : Object.assign({}, m, { identityId: id }));
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(idx));
        }
      }
    } catch (e) { console.warn('[tracker] failed to bootstrap default identity:', e); }
  }
  loadIdentities() {
    try {
      const raw = localStorage.getItem(IDENTITIES_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      if (Array.isArray(saved.identities)) this.state.identities = saved.identities;
      if (saved.activeIdentityId) this.state.activeIdentityId = saved.activeIdentityId;
      if (saved.lastActiveProjectByIdentity) this.state.lastActiveProjectByIdentity = saved.lastActiveProjectByIdentity;
    } catch (e) { console.warn('[tracker] failed to load identities:', e); }
  }
  commentReadsFor(id) {
    try {
      const raw = localStorage.getItem(COMMENT_READS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[id]) || {};
    } catch (e) { return {}; }
  }
  persistCommentReads() {
    try {
      if (!this.state.activeIdentityId) return;
      const raw = localStorage.getItem(COMMENT_READS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.state.activeIdentityId] = this.state.commentReads;
      localStorage.setItem(COMMENT_READS_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save comment read state:', e); }
  }
  // Per-issue push subscriptions (tracker issue #73, 59372970) -- same
  // per-identity {[identityId]: {...}} shape as commentReadsFor/
  // persistCommentReads immediately above, deliberately mirrored rather
  // than introduced as a new pattern.
  issueSubscriptionsFor(id) {
    try {
      const raw = localStorage.getItem(ISSUE_SUBSCRIPTIONS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[id]) || {};
    } catch (e) { return {}; }
  }
  persistIssueSubscriptions() {
    try {
      if (!this.state.activeIdentityId) return;
      const raw = localStorage.getItem(ISSUE_SUBSCRIPTIONS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.state.activeIdentityId] = this.state.issueSubscriptions;
      localStorage.setItem(ISSUE_SUBSCRIPTIONS_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save issue subscription state:', e); }
  }
  toggleIssueSubscription = (issueId) => {
    const subscribing = !this.state.issueSubscriptions[issueId];
    this.setState(s => {
      const next = Object.assign({}, s.issueSubscriptions);
      if (next[issueId]) delete next[issueId]; else next[issueId] = true;
      return { issueSubscriptions: next };
    }, () => {
      this.persistIssueSubscriptions();
      if (subscribing) this.seedIssueSubscriptionAsNotified(issueId);
      this.syncIssueSubscriptionsToRelay();
    });
  };
  // See seedNotifiedMentions's own comment -- same reasoning, scoped to
  // one issue instead of every mention across the whole project.
  seedIssueSubscriptionAsNotified = (issueId) => {
    const issue = this.state.issues.find(iss => iss.id === issueId);
    if (!issue) return;
    const ids = [];
    for (const c of this.allCommentStreamEntries(issue)) ids.push(commentKey(c));
    for (const h of (issue.history || [])) {
      if (h.field && h.origin !== 'legacy-backfill') ids.push(entryKey(h));
    }
    this.markMentionsNotified(ids);
  };
  // Best-effort: only pushes the updated subscription list to push-relay.js
  // if this device already has an active push subscription (see
  // enablePushNotifications) -- subscribing to an issue before ever
  // enabling push on this device has nothing to sync yet, and will pick up
  // the current issueSubscriptions the next time enablePushNotifications
  // itself runs.
  syncIssueSubscriptionsToRelay = async () => {
    try {
      if (!('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const relayUrl = (this.state.pushRelayUrl || '').trim();
      const email = (this.state.identityEmail || '').trim();
      if (!relayUrl || !email) return;
      await fetch(relayUrl.replace(/\/$/, '') + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wigwag-Proxy-Secret': this.state.pushRelaySecret || '' },
        body: JSON.stringify({
          email,
          subscription: sub.toJSON(),
          repo: this.state.githubRepo,
          path: this.state.githubRepoPath,
          branch: this.state.githubRepoBranch,
          origin: location.href.replace(/#.*$/, ''),
          subscribedIssueIds: Object.keys(this.state.issueSubscriptions || {})
        })
      });
    } catch (e) { console.warn('[tracker] failed to sync issue subscriptions to push relay:', e); }
  };
  // Opening an issue counts as reading every comment on it right now --
  // tracks each comment THREAD's original sortKey (its first appearance,
  // from latestCommentsById -- not the latest edit's), so later editing an
  // already-read comment doesn't flag it unread again, only a genuinely
  // NEW comment thread does.
  // Flattened view of every entry across every commentStream field
  // (uniform mention/subscription handling -- an @mention in "My actions"
  // fires exactly like one in "Comments", per design). Order doesn't
  // matter to any caller (all of them just filter/reduce), so a plain
  // concat is fine.
  allCommentStreamEntries(issue) {
    return Object.values(issue.commentStreams || {}).flat();
  }
  markCommentsRead(issueId) {
    const issue = this.findIssue(issueId);
    const comments = (issue && issue.commentStreams.comments) || [];
    if (!comments.length) return;
    const latest = latestCommentsById(comments).reduce((max, c) => Math.max(max, c.sortKey || 0), 0);
    this.setState(s => ({ commentReads: { ...s.commentReads, [issueId]: latest } }));
  }
  persistIdentities() {
    try {
      const s = this.state;
      if (!s.activeIdentityId) return;
      const payload = {
        activeIdentityId: s.activeIdentityId,
        identities: s.identities, lastActiveProjectByIdentity: s.lastActiveProjectByIdentity
      };
      const payloadJson = JSON.stringify(payload);
      if (payloadJson === this._lastPersistedIdentitiesJson) return;
      this._lastPersistedIdentitiesJson = payloadJson;
      const rev = Date.now();
      this._lastKnownIdentitiesRev = Math.max(this._lastKnownIdentitiesRev || 0, rev);
      localStorage.setItem(IDENTITIES_KEY, JSON.stringify(Object.assign({}, payload, { rev })));
    } catch (e) { console.warn('[tracker] failed to save identities:', e); }
  }
  // Cosmetic/metadata prefs (column order/widths/filters, sort, wrap,
  // merge log) are keyed by projectId alone -- correct for Local Mode
  // (one browser, many unrelated projects, real durable per-project
  // prefs) but wrong for Room Scoped Widget Mode, where a project id can
  // legitimately repeat across two different rooms (more likely now that
  // Receive-a-project reuses an original id when there's no local
  // collision): without this, opening "the same" project id in a
  // different room would surprisingly inherit the first room's column
  // order/filters/etc. Composing roomId in keeps these durable PER ROOM
  // instead of flattening them onto projectId globally. A no-op in Local
  // Mode (ROOM_MODE_ROOM_ID is null there), so existing Local Mode
  // storage layout/tests are unaffected.
  storagePrefKey(id) { return ROOM_MODE_ROOM_ID ? (ROOM_MODE_ROOM_ID + ':' + id) : id; }
  columnWidthsFor(id) {
    try {
      const raw = localStorage.getItem(COLUMN_WIDTHS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || {};
    } catch (e) { return {}; }
  }
  // Local-only field bindings (linkedSourceId/rule/ruleRows/ruleFallback)
  // -- deliberately outside the portable fieldDefs shape, see
  // LOCAL_FIELD_BINDINGS_KEY's own comment in wigwag-core.js. Loaded once
  // per project switch (localFieldBindingsFor), read through
  // effectiveFieldDefs()/effectiveDef() everywhere evaluation/rendering
  // needs a bound field's actual rule, written directly (no diffed
  // componentDidUpdate persist like columnWidths -- bindings change on
  // explicit edits only, not every render).
  localFieldBindingsFor(id) {
    try {
      const raw = localStorage.getItem(LOCAL_FIELD_BINDINGS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || {};
    } catch (e) { return {}; }
  }
  // binding: {linkedSourceId, rule, ruleRows, ruleFallback} -- always the
  // full set (never a partial patch), since a merge here would leave
  // stale keys from a previous mode (e.g. old ruleRows surviving a switch
  // to a hand-written expression).
  //
  // A field bound before this local-only split shipped has its rule
  // embedded directly in an already-signed, portable projectHistory entry
  // -- deriveFieldDefs keeps faithfully reconstructing that forever
  // (nothing here rewrites already-shared history), so the first LOCAL
  // edit to such a field also writes ONE portable "cleanup" entry
  // stripping just the binding keys, superseding the old embedded rule
  // for every future export/hydrate. Without this, a field that happened
  // to be legacy-bound would keep leaking its old rule text on every
  // export forever, even after the user explicitly re-bound it locally --
  // silently defeating the entire point of this split for exactly the
  // fields most likely to have one already. A field that was never
  // legacy-bound (the common case going forward) needs no such entry --
  // this only fires once, the first time a field with leftover embedded
  // binding keys is touched.
  setLocalFieldBinding(colId, binding) {
    const portableDef = this.state.fieldDefs[colId];
    if (portableDef && ('rule' in portableDef || 'ruleRows' in portableDef || 'ruleFallback' in portableDef || 'linkedSourceId' in portableDef)) {
      const { rule, ruleRows, ruleFallback, linkedSourceId, ...cleaned } = portableDef;
      this.appendProjectHistory({ text: '"' + (portableDef.label || colId) + '" binding moved to local, per-device configuration', field: colId, value: cleaned });
    }
    try {
      if (!this.state.projectId) return;
      const raw = localStorage.getItem(LOCAL_FIELD_BINDINGS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const key = this.storagePrefKey(this.state.projectId);
      all[key] = { ...(all[key] || {}), [colId]: binding };
      localStorage.setItem(LOCAL_FIELD_BINDINGS_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save local field binding:', e); }
    this.setState(s => ({ localFieldBindings: { ...s.localFieldBindings, [colId]: binding } }));
  }
  // Bound-field visibility redesign: which history entry id THIS DEVICE's
  // own rule evaluation most recently wrote for a given field -- see
  // LOCAL_DERIVED_ENTRY_IDS_KEY's own comment in wigwag-core.js. Loaded
  // once per project switch (localDerivedEntryIdsFor), mirrored into
  // state for render access, written directly whenever a derived write
  // actually commits (see logDerivedChanges).
  localDerivedEntryIdsFor(id) {
    try {
      const raw = localStorage.getItem(LOCAL_DERIVED_ENTRY_IDS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || {};
    } catch (e) { return {}; }
  }
  recordLocalDerivedEntryId(issueId, colId, entryId) {
    try {
      if (!this.state.projectId) return;
      const raw = localStorage.getItem(LOCAL_DERIVED_ENTRY_IDS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      const key = this.storagePrefKey(this.state.projectId);
      const projAll = all[key] || {};
      const issueAll = projAll[issueId] || {};
      all[key] = { ...projAll, [issueId]: { ...issueAll, [colId]: entryId } };
      localStorage.setItem(LOCAL_DERIVED_ENTRY_IDS_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save local derived entry id:', e); }
    this.setState(s => ({
      localDerivedEntryIds: { ...s.localDerivedEntryIds, [issueId]: { ...(s.localDerivedEntryIds[issueId] || {}), [colId]: entryId } }
    }));
  }
  // GitHub needs no configuration at all to be reachable (anonymous
  // access, rate-limited not blocked -- same tolerance fetchGithubData/
  // resolveFetchConnector already have) -- but a brand-new install (now
  // that migrateBuiltinConnectors stopped auto-seeding anything) simply
  // has no __builtin_github row for a plain connectedSources.find(...)
  // to find. Anything that needs to treat GitHub as always-at-least-
  // minimally-reachable (liveRuleCtx's write-side gate, connectorMatches'
  // paste-time dispatch) reads THIS instead of this.state.connectedSources
  // directly -- the real list, plus the same synthetic stand-in
  // resolveFetchConnector() uses, appended only when no real github-kind
  // row exists yet. Deliberately NOT used by the Settings UI itself,
  // which must keep showing a genuinely empty list until something is
  // actually configured (Tom's own "list only configured connectors" ask).
  connectedSourcesForDispatch() {
    const connectedSources = this.state.connectedSources || [];
    return connectedSources.some(c => c.id === '__builtin_github')
      ? connectedSources
      : connectedSources.concat([this.resolveFetchConnector('__builtin_github')]);
  }
  // Context for the write-side reachability gate (computeBoundValue/
  // applyLinkedRules) AND the per-issue local-record slice -- gathered
  // once per call site rather than threading each field individually.
  liveRuleCtx(issueId) {
    return {
      connectedSources: this.connectedSourcesForDispatch(),
      tauriConnectorRuntime: this.isTauriConnectorRuntime(),
      localDerivedEntryIds: (this.state.localDerivedEntryIds && this.state.localDerivedEntryIds[issueId]) || {}
    };
  }
  // `ref`, when given, is this field's OWN current fieldRef -- only ever
  // possible for a type:'issue' field (select/multiselect can't hold a
  // pasted external link at all, see commitEdit's own type gating), and
  // only reachable when `isOverridden` is already true. Live-reported:
  // the glyph/tooltip's wording ("Overrides the linked value...")
  // implied a manual hand-edit even when what actually happened was an
  // independently-pasted link to a DIFFERENT source -- a field that's
  // schema-bound via a copy-field rule but ALSO carries its own real
  // link diverges from the rule's computed answer exactly the same way
  // a hand-edit would (fieldLocalBindState can't and shouldn't try to
  // tell those apart, see its own comment), but the two are different
  // enough in practice that the tooltip was actively misleading for the
  // link case -- confirmed via a real linked field on wigwag's own
  // tracker (#70's Remedy, independently linked to Jeera) showing this
  // exact wording despite never having been typed over.
  overrideTitle(def, ref) {
    const src = this.state.fieldDefs[def.linkedSourceId];
    const srcLabel = src ? src.label : def.linkedSourceId;
    if (ref) return "Independently linked -- not derived from " + srcLabel + "'s data";
    return "Overrides the linked value from " + srcLabel + "'s data";
  }
  // Every Activity/History-feed render prop builder (slideover, project
  // panel notes, mobile sheet -- comments and history entries alike)
  // needs a human-readable timestamp label. A new entry carries no
  // separate `time` field at all any more (Tom: "if the real ts is in
  // the sortKey, why store a formatted version at all in the file?
  // Don't do that.") -- `sortKey` (epoch ms) is already the entry's
  // real, canonical timestamp, so this derives the label fresh every
  // render straight from it, via the same formatDateLabel() convention
  // already used elsewhere (e.g. buildMergeTimelineView's own
  // fullTime) -- same hasRealSortKey guard that already exists there,
  // for a legacy/backfilled entry whose sortKey predates real epoch-ms
  // tracking (falls back to whatever's literally in `time`, which only
  // ever exists on an entry signed before this change -- a permanent
  // read-forward adapter, not a migration, same discipline as every
  // other format evolution in this file).
  timeLabelFor(entry) {
    const hasRealSortKey = !!(entry.sortKey && entry.sortKey > 946684800000);
    return hasRealSortKey ? formatDateLabel(new Date(entry.sortKey)) : (entry.time || '');
  }
  effectiveFieldDefs() { return effectiveFieldDefs(this.state.fieldDefs, this.state.localFieldBindings); }
  effectiveDef(colId) { return this.effectiveFieldDefs()[colId]; }
  persistColumnWidths() {
    try {
      if (!this.state.projectId) return;
      if (this.state.localDocLoading || this.state.roomModeBootstrapping) return;
      const raw = localStorage.getItem(COLUMN_WIDTHS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.storagePrefKey(this.state.projectId)] = this.state.columnWidths;
      const payloadJson = JSON.stringify(all);
      if (payloadJson === this._lastPersistedColumnWidthsJson) return;
      this._lastPersistedColumnWidthsJson = payloadJson;
      localStorage.setItem(COLUMN_WIDTHS_KEY, payloadJson);
    } catch (e) { console.warn('[tracker] failed to save column widths:', e); }
  }
  columnOrderFor(id) {
    try {
      const raw = localStorage.getItem(COLUMN_ORDER_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || null;
    } catch (e) { return null; }
  }
  persistColumnOrder() {
    try {
      if (!this.state.projectId) return;
      if (this.state.localDocLoading || this.state.roomModeBootstrapping) return;
      const raw = localStorage.getItem(COLUMN_ORDER_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.storagePrefKey(this.state.projectId)] = this.state.columnOrder;
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save column order:', e); }
  }
  // Live incident (2026-09-28): hiddenFieldIds used to live INSIDE the
  // per-project doc itself, which is the one key Room Scoped Widget Mode's
  // storage shim treats as in-memory-only "room content", wiped on every
  // reload -- live-reported as "field order persists but field hiddenness
  // doesn't" (columnOrder, via COLUMN_ORDER_KEY just above, was already
  // correct). Split out into its own real, per-device key, same pattern.
  hiddenFieldIdsFor(id) {
    try {
      const raw = localStorage.getItem(HIDDEN_FIELDS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || null;
    } catch (e) { return null; }
  }
  persistHiddenFieldIds() {
    try {
      if (!this.state.projectId) return;
      if (this.state.localDocLoading || this.state.roomModeBootstrapping) return;
      const raw = localStorage.getItem(HIDDEN_FIELDS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.storagePrefKey(this.state.projectId)] = this.state.hiddenFieldIds;
      localStorage.setItem(HIDDEN_FIELDS_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save hidden fields:', e); }
  }
  columnFiltersFor(id) {
    try {
      const raw = localStorage.getItem(COLUMN_FILTERS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || {};
    } catch (e) { return {}; }
  }
  persistColumnFilters() {
    try {
      if (!this.state.projectId) return;
      if (this.state.localDocLoading || this.state.roomModeBootstrapping) return;
      const raw = localStorage.getItem(COLUMN_FILTERS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.storagePrefKey(this.state.projectId)] = this.state.columnFilters;
      localStorage.setItem(COLUMN_FILTERS_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save column filters:', e); }
  }
  sortFor(id) {
    try {
      const raw = localStorage.getItem(SORT_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || { colId: null, dir: 'asc' };
    } catch (e) { return { colId: null, dir: 'asc' }; }
  }
  persistSort() {
    try {
      if (!this.state.projectId) return;
      if (this.state.localDocLoading || this.state.roomModeBootstrapping) return;
      const raw = localStorage.getItem(SORT_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.storagePrefKey(this.state.projectId)] = this.state.sort;
      localStorage.setItem(SORT_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save sort:', e); }
  }
  columnWrapFor(id) {
    try {
      const raw = localStorage.getItem(WRAP_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[this.storagePrefKey(id)]) || {};
    } catch (e) { return {}; }
  }
  persistColumnWrap() {
    try {
      if (!this.state.projectId) return;
      if (this.state.localDocLoading || this.state.roomModeBootstrapping) return;
      const raw = localStorage.getItem(WRAP_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[this.storagePrefKey(this.state.projectId)] = this.state.columnWrap;
      localStorage.setItem(WRAP_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[tracker] failed to save wrap preferences:', e); }
  }
  toggleColumnWrap(colId) { this.setState(s => ({ columnWrap: { ...s.columnWrap, [colId]: !s.columnWrap[colId] } })); }
  wrapStyleFor(colId) {
    return this.state.columnWrap[colId]
      ? 'white-space:normal; overflow:visible; text-overflow:clip; word-break:break-word;'
      : 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
  }
  // Same "Wrap text" column-menu toggle a plain-text column already uses
  // (wrapStyleFor above), just producing a line-clamp instead of
  // nowrap-ellipsis -- markdown is block-level HTML, not a single text
  // run, so white-space:nowrap doesn't apply the same way.
  markdownClampStyleFor(colId) {
    const lines = this.state.columnWrap[colId] ? 6 : 1;
    return 'display:-webkit-box; -webkit-line-clamp:' + lines + '; -webkit-box-orient:vertical; overflow:hidden;';
  }
  connectGithubRepoIfVisible() {
    if (!this.state.githubRepo || document.hidden) return;
    this.connectGithubRepo();
  }
  // Wired to the visibilitychange listener (componentDidMount) -- a tab
  // that was hidden (so didn't poll or push, see the document.hidden
  // guards in each) catches up the moment it's visible again instead of
  // sitting stale until the next natural trigger.
  onBecameVisible() {
    this.warmProjectSummaries().catch(e => console.warn('[tracker] failed to warm project summaries:', e));
    if (!this.state.githubRepo) return;
    if (this.state.githubSyncStatus === 'disconnected') { this.connectGithubRepo(); return; }
    this.pollGithubForRemoteChanges();
    this.maybeScheduleGithubPush();
  }
  // tracker issue #77 (34dccdbb): an installed PWA (home-screen icon on
  // iOS/Android) often resumes the existing in-memory page instead of doing
  // a fresh network load, so a wigwag.html change sitting on the server
  // never reaches a long-lived instance until something forces a real
  // reload. Compares document.lastModified (what THIS instance was served
  // with) against a fresh HEAD request's Last-Modified header, rather than
  // a separately-maintained version file -- there's no build step here to
  // keep one from drifting out of sync with a real deploy, but a static
  // file host's own Last-Modified header can't lie about that. Deliberately
  // never auto-reloads -- see the banner's own onReloadForUpdate; a
  // surprise reload would blow away in-progress drafts (comment text,
  // edit-in-progress cells, etc.).
  checkForAppUpdate = async () => {
    if (location.protocol === 'file:' || (window.__TAURI__ && window.__TAURI__.core)) return;
    if (this.state.appUpdateAvailable) return;
    try {
      const res = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
      const serverLastModified = res.headers.get('Last-Modified');
      if (!serverLastModified) return;
      if (new Date(serverLastModified).getTime() > new Date(document.lastModified).getTime()) {
        this.setState({ appUpdateAvailable: true });
      }
    } catch (e) { /* offline, or a network hiccup -- silently skip, try again next time */ }
  };
  // The active project (from loadProjectIndex(), including its per-tab
  // sessionStorage override) and the active identity (from loadIdentities())
  // are persisted independently and can disagree at boot -- the project
  // wins, since a per-tab override exists specifically so reloading a tab
  // doesn't jump you to a different project than the one you had open in
  // it. Only corrects state that's already wrong; every interactive switch
  // path already keeps these in sync on its own.
  reconcileActiveIdentityWithProject() {
    const project = this.state.projects.find(p => p.id === this.state.projectId);
    if (!project || !project.identityId || project.identityId === this.state.activeIdentityId) return;
    if (!this.state.identities.some(i => i.id === project.identityId)) return;
    this.state.activeIdentityId = project.identityId;
  }
  // Drives both the initial boot resolution and every popstate -- parses
  // #/project/<id>(/issue/<id>)? out of the current hash and switches
  // identity/project/issue to match. switchProject() does not itself
  // validate id against this.state.projects (it happily falls back to a
  // blank doc for an unknown one), so that check happens here, before ever
  // calling it. this._navigatingFromHistory stays true for the whole,
  // possibly-async chain (including the setState callback tail) so that
  // switchProject/switchIdentity/openSlideOver/closeSlideOver -- which each
  // write to history on a REAL, in-app navigation -- know to stay quiet
  // while this one is just replaying what the browser already decided.

  // ---- Connect a remote project (design_handoff_remote_connect) ----
  // Parses a pasted address into {host, owner, repo, branch, path}.
  // Accepts a full https URL (host/owner/repo/tree/branch/path...), an
  // SSH remote (git@host:owner/repo.git), or a bare owner/repo (host
  // assumed github.com, matching the rest of this app's GitHub-only
  // reach so far -- the grammar itself doesn't assume GitHub, nothing
  // downstream can act on a different host yet).
  parseRemoteAddress(text) {
    const t = (text || '').trim();
    if (!t) return null;
    let m = t.match(/^(?:git@|ssh:\/\/git@)([^:\/]+)[:\/]([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/);
    if (m) return { host: m[1], owner: m[2], repo: m[3], branch: '', path: '' };
    m = t.match(/^https?:\/\/([^\/]+)\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/tree\/([^\/]+)((?:\/[^\/]+)*))?\/?$/);
    if (m) return { host: m[1], owner: m[2], repo: m[3], branch: m[4] || '', path: (m[5] || '').replace(/^\//, '') };
    m = t.match(/^([\w-]+\.[\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (m) return { host: m[1], owner: m[2], repo: m[3], branch: '', path: '' };
    m = t.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (m) return { host: 'github.com', owner: m[1], repo: m[2], branch: '', path: '' };
    return null;
  }
  // The probe itself -- one request, with or without a token. GitHub
  // returns 404 (not 403) for a private repo a token can't see, same as
  // for one that doesn't exist at all, so both read as "refused" here;
  // an unauthenticated 200 means the repo is public (no permissions
  // object comes back without a token, so success alone is the signal).
  // Deliberately never touches a project's OWN token (githubTokenOverride)
  // -- only identity-level tokens, plus the one unauthenticated request,
  // per the handoff's own consent boundary (a credential scoped to one
  // remote is never tried against a different one).
  async probeGithubRepoAccess(owner, repo, token) {
    return probeGithubRepoAccess(owner, repo, token, fetch);
  }
  // Runs every identity's own probe plus one unauthenticated request, in
  // parallel, updating rows as each resolves rather than waiting for all
  // (rows "appear as they resolve", per the handoff). A monotonic
  // generation counter discards a stale result if the address changes
  // again before this round finishes -- kept on `this`, not state, since
  // it's pure race-guard bookkeeping, never rendered.
  runConnectRemoteProbe() {
    const parts = this.state.connectRemoteParsed;
    if (!parts) { this.setState({ connectRemoteProbeResults: null }); return; }
    const gen = (this._connectRemoteProbeGen = (this._connectRemoteProbeGen || 0) + 1);
    const identities = this.state.identities;
    const initial = identities.map(idy => ({ identityId: idy.id, status: 'pending' })).concat([{ identityId: 'public', status: 'pending' }]);
    this.setState({ connectRemoteProbeResults: initial });
    identities.forEach(idy => {
      this.probeGithubRepoAccess(parts.owner, parts.repo, idy.githubToken).then(result => {
        if (gen !== this._connectRemoteProbeGen) return;
        this.setState(s => ({ connectRemoteProbeResults: (s.connectRemoteProbeResults || []).map(r => r.identityId === idy.id ? Object.assign({}, r, result) : r) }));
      });
    });
    this.probeGithubRepoAccess(parts.owner, parts.repo, '').then(result => {
      if (gen !== this._connectRemoteProbeGen) return;
      this.setState(s => ({ connectRemoteProbeResults: (s.connectRemoteProbeResults || []).map(r => r.identityId === 'public' ? Object.assign({}, r, result) : r) }));
    });
  }
  // Reads a wigwag: link's own from=/path=/ref= into a Connect Remote
  // prefill -- structured parts directly, not round-tripped through
  // parseRemoteAddress's text-address parsing (from= is bare
  // host/owner/repo, a shape parseRemoteAddress doesn't itself accept,
  // and reconstructing a URL string from the parts we already have would
  // just be lossier than using them directly).
  connectRemotePrefillFromWigwagRef(wg) {
    if (!wg || !wg.from) return null;
    const parts = wg.from.split('/');
    if (parts.length !== 3) return null;
    const [host, owner, repo] = parts;
    return { address: wg.from, parsed: { host, owner, repo, branch: wg.ref || '', path: wg.path || '' } };
  }
  openConnectRemote(wg) {
    this._connectRemoteProbeGen = (this._connectRemoteProbeGen || 0) + 1; // orphan any still-running probe from a prior open
    const prefill = this.connectRemotePrefillFromWigwagRef(wg);
    this.setState({
      connectRemoteOpen: true, connectRemoteAddress: prefill ? prefill.address : '', connectRemoteParsed: prefill ? prefill.parsed : null, connectRemoteEditingParts: false,
      connectRemoteProbeResults: null, connectRemoteBusy: false, connectRemoteError: '',
      switcherOpen: false
    });
    if (prefill) this.runConnectRemoteProbe();
  }
  closeConnectRemote() {
    this._connectRemoteProbeGen = (this._connectRemoteProbeGen || 0) + 1;
    this.setState({ connectRemoteOpen: false });
  }
  // The probe starts on paste, not on submit -- every address edit
  // re-parses and re-probes immediately.
  onConnectRemoteAddressChange(e) {
    const value = e.target.value;
    const parsed = this.parseRemoteAddress(value);
    this.setState({ connectRemoteAddress: value, connectRemoteParsed: parsed, connectRemoteError: '' });
    if (parsed) this.runConnectRemoteProbe();
    else { this._connectRemoteProbeGen = (this._connectRemoteProbeGen || 0) + 1; this.setState({ connectRemoteProbeResults: null }); }
  }
  onConnectRemotePartChange(field, e) {
    const parsed = Object.assign({}, this.state.connectRemoteParsed, { [field]: e.target.value });
    this.setState({ connectRemoteParsed: parsed, connectRemoteError: '' });
    this.runConnectRemoteProbe();
  }
  // Derives the outcome (README's own probe-outcomes table) from the
  // current probe results -- null while still probing. Two identities
  // both able to write isn't designed upstream ("ask, but that case is
  // not designed here"); this picks the first writable one, in identity
  // order, rather than blocking on a question with no designed answer.
  // An identity with READ but not write, when nothing can write and the
  // public probe fails, isn't one of the three named outcomes either --
  // treated the same as public-readonly (lands in Shared with you) for
  // now; a specific-identity-scoped read-only landing belongs with the
  // richer first-write flow (13d), not this pass.
  connectRemoteOutcome() {
    const results = this.state.connectRemoteProbeResults;
    if (!results || !results.length) return null;
    if (results.some(r => r.status === 'pending')) return null;
    const writable = results.find(r => r.identityId !== 'public' && r.status === 'write');
    if (writable) return { kind: 'full-access', identityId: writable.identityId };
    const publicRow = results.find(r => r.identityId === 'public');
    if (publicRow && publicRow.status === 'read') return { kind: 'public-readonly' };
    const anyRead = results.find(r => r.identityId !== 'public' && r.status === 'read');
    if (anyRead) return { kind: 'public-readonly' };
    return { kind: 'no-access' };
  }
  async fetchRemoteTrackerFile(parts, token) {
    const path = (parts.path ? parts.path.replace(/\/+$/, '') + '/' : '') + 'tracker.jsonl';
    const repo = parts.owner + '/' + parts.repo;
    const result = await pullGithubFile({ fetchImpl: fetch, repo, path, branch: parts.branch, token });
    if (result.status === 'not-found') throw new Error('No tracker file found at that address (looked for ' + path + ').');
    if (result.status !== 'ok') throw new Error(result.message || ('GitHub returned an error fetching ' + path));
    return result.text;
  }
  // Attaches connection info (and, for a full-access outcome, an owning
  // identity) to a project that already exists here -- the "same UUID,
  // second address" case, reached when the fetched file's own embedded
  // id matches one we already have. Not a duplicate, not an error.
  async attachRemoteToProject(projectId, identityId, remoteFields) {
    try {
      const doc = await docStore.getDoc(projectId);
      if (!doc) return;
      Object.assign(doc, remoteFields);
      await docStore.putDoc(projectId, doc);
    } catch (e) { console.warn('[tracker] failed to attach remote to project', projectId, e); }
    if (identityId) this.setState(s => ({ projects: s.projects.map(p => p.id === projectId ? Object.assign({}, p, { identityId }) : p) }));
    if (projectId === this.state.projectId) this.setState(remoteFields);
  }
  // Materializes the fetched+parsed remote content as a project -- same
  // UUID-reuse-if-present logic as a normal file import (a project
  // already here under that id gets the content applied as an update,
  // not duplicated), plus what a plain import never needs: the winning
  // identity (full-access) and the connection's own remote fields, so
  // the result is actually CONNECTED, not just a one-off snapshot.
  async connectRemoteFinish(parsed, outcome) {
    const parts = this.state.connectRemoteParsed;
    const remoteFields = {
      githubRepo: parts.owner + '/' + parts.repo,
      githubRepoPath: (parts.path ? parts.path.replace(/\/+$/, '') + '/' : '') + 'tracker.jsonl',
      githubRepoBranch: parts.branch || ''
    };
    const identityId = outcome.kind === 'full-access' ? outcome.identityId : null;
    const match = parsed.projectId ? this.state.projects.find(m => m.id === parsed.projectId) : null;
    if (match) {
      this.confirmAction('This remote is for the project "' + match.name + '", which you already have. Connecting it will apply it as an update to that project instead of creating a new one. Continue?', () => {
        const afterSwitch = () => { this.startMerge(parsed); this.attachRemoteToProject(match.id, identityId, remoteFields); };
        if (match.id === this.state.projectId) afterSwitch(); else this.switchProject(match.id, afterSwitch);
        this.setState({ connectRemoteOpen: false, connectRemoteBusy: false });
      }, 'Continue');
      this.setState({ connectRemoteBusy: false });
      return;
    }
    const takenIds = new Set(this.state.projects.map(m => m.id));
    const finalId = (parsed.projectId && !takenIds.has(parsed.projectId)) ? parsed.projectId : crypto.randomUUID();
    const name = parsed.projectName || parts.repo;
    const doc = Object.assign({
      fieldDefs: parsed.fields || defaultFieldDefs(),
      projectHistory: parsed.projectHistory || [],
      issues: parsed.issues.map(iss => ({
        id: iss.id, num: iss.num,
        fieldRefs: iss.fieldRefs || {}, fieldLoading: {},
        values: iss.values || {}, commentStreams: iss.commentStreams || {}, history: iss.history || []
      })),
      columnOrder: defaultColumnOrder(),
      hiddenFieldIds: [], githubTokenOverride: '',
      projectNotes: parsed.projectNotes || '', projectComments: parsed.projectComments || []
    }, remoteFields);
    await docStore.putDoc(finalId, doc);
    this.state.projects = this.state.projects.concat([{ id: finalId, name, identityId }]);
    this.setState({ connectRemoteOpen: false, connectRemoteBusy: false });
    if (identityId && identityId !== this.state.activeIdentityId) this.switchIdentity(identityId, finalId);
    else this.switchProject(finalId);
  }
  // The sheet's own Connect button -- fetches the remote's tracker file
  // using whichever identity's token the outcome resolved to (none, for
  // the public-readonly case), then hands off to connectRemoteFinish.
  onConnectRemoteConnect() {
    const outcome = this.connectRemoteOutcome();
    if (!outcome || outcome.kind === 'no-access') return;
    this.setState({ connectRemoteBusy: true, connectRemoteError: '' });
    const token = outcome.kind === 'full-access' ? ((this.state.identities.find(i => i.id === outcome.identityId) || {}).githubToken || '') : '';
    this.fetchRemoteTrackerFile(this.state.connectRemoteParsed, token).then(text => {
      const parsed = this.parseJsonl(text);
      if (!parsed.fields && !parsed.issues.length) throw new Error("That file isn't a valid tracker export.");
      this.connectRemoteFinish(parsed, outcome);
    }).catch(err => {
      this.setState({ connectRemoteBusy: false, connectRemoteError: err.message });
    });
  }

  dismissUnknownProjectState(key) {
    this.setState({ [key]: null });
    if (this.state.projectId) {
      const hash = '#/project/' + encodeURIComponent(this.state.projectId);
      if (window.location.hash !== hash) history.replaceState(null, '', hash);
    }
  }
  resolveDeepLinkFromHash(isBoot) {
    const m = /^#\/project\/([^\/]+)(?:\/issue\/([^\/]+))?$/.exec(window.location.hash);
    if (!m) return;
    const projectId = decodeURIComponent(m[1]);
    const issueId = m[2] ? decodeURIComponent(m[2]) : null;
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) {
      const reference = projectId.slice(0, 8) + (issueId ? '#' + issueId : '');
      if (isBoot) this.setState({ unknownProjectCold: { reference } });
      else this.setState({ unknownProjectNotice: { reference } });
      return;
    }
    this._navigatingFromHistory = true;
    const afterNav = () => {
      if (issueId) {
        if (this.findIssue(issueId)) this.openSlideOver(issueId);
        else this.setState({ deepLinkNotice: 'That issue link couldn\u2019t be found in this project.' });
      } else if (this.state.slideOverIssueId) {
        this.closeSlideOver();
      }
      this._navigatingFromHistory = false;
    };
    if (projectId === this.state.projectId) {
      afterNav();
    } else if (project.identityId && project.identityId !== this.state.activeIdentityId &&
        this.state.identities.some(i => i.id === project.identityId)) {
      this.switchIdentity(project.identityId, projectId, afterNav);
    } else {
      this.switchProject(projectId, afterNav);
    }
  }
  loadProjectIndex() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      if (saved.activeMilestoneId) this.state.projectId = saved.activeMilestoneId;
      if (Array.isArray(saved.milestones)) this.state.projects = saved.milestones;
      const sessionProjectId = sessionStorage.getItem(SESSION_PROJECT_KEY);
      if (sessionProjectId && this.state.projects.some(p => p.id === sessionProjectId)) {
        this.state.projectId = sessionProjectId;
      }
    } catch (e) { console.warn('[tracker] failed to load project index:', e); }
    this.state.columnWidths = this.columnWidthsFor(this.state.projectId);
    this.state.columnWrap = this.columnWrapFor(this.state.projectId);
    this.state.columnFilters = this.columnFiltersFor(this.state.projectId);
    this.state.sort = this.sortFor(this.state.projectId);
    this.state.localFieldBindings = this.localFieldBindingsFor(this.state.projectId);
    this.state.localDerivedEntryIds = this.localDerivedEntryIdsFor(this.state.projectId);
  }
  persistProjectIndex() {
    try {
      if (!this.state.projectId) return;
      if (ROOM_MODE_CAPABILITIES && !ROOM_MODE_CAPABILITIES.multiIdentity && this.state.activeIdentityId && this.state.projects.some(p => !p.identityId)) {
        const activeId = this.state.activeIdentityId;
        this.setState(s => ({ projects: s.projects.map(p => p.identityId ? p : Object.assign({}, p, { identityId: activeId })) }));
        return; // re-render triggers componentDidUpdate -> persistProjectIndex() again with corrected data
      }
      const payloadJson = JSON.stringify({ activeMilestoneId: this.state.projectId, milestones: this.state.projects });
      if (payloadJson !== this._lastPersistedProjectIndexJson) {
        this._lastPersistedProjectIndexJson = payloadJson;
        localStorage.setItem(PROJECTS_KEY, payloadJson);
      }
      sessionStorage.setItem(SESSION_PROJECT_KEY, this.state.projectId);
    } catch (e) { console.warn('[tracker] failed to save project index:', e); }
  }
  // Switches the active project. No manual "snapshot" of the OLD
  // project is needed here -- persist() already runs after every state
  // change and has been writing to the old project's own keyed slot the
  // whole time, right up until this call. Clicking the already-active row
  // just closes the dropdown without resetting anything else (filters/sort
  // shouldn't jump for a no-op click).
  // targetProjectId/after are optional, only ever passed by
  // resolveDeepLinkFromHash() -- every other call site keeps working
  // unchanged with just an id.
  switchIdentity(id, targetProjectId, after) {
    if (id === this.state.activeIdentityId) { this.setState({ switcherOpen: false }); if (after) after(); return; }
    const lastByIdentity = Object.assign({}, this.state.lastActiveProjectByIdentity, { [this.state.activeIdentityId]: this.state.projectId });
    const candidates = this.state.projects.filter(p => p.identityId === id);
    const remembered = lastByIdentity[id];
    const preferred = targetProjectId && candidates.some(p => p.id === targetProjectId) ? targetProjectId : null;
    const targetId = preferred || ((remembered && candidates.some(p => p.id === remembered)) ? remembered : (candidates[0] ? candidates[0].id : null));
    const target = this.state.identities.find(i => i.id === id);
    this._signingKey = null;
    this.setState({
      activeIdentityId: id, lastActiveProjectByIdentity: lastByIdentity, switcherOpen: false,
      identityEmail: target ? (target.email || '') : '',
      githubToken: target ? (target.githubToken || '') : '',
      ...identityProxyFieldsFrom(target),
      identityPublicKeyJwk: target ? (target.signingPublicKeyJwk || null) : null,
      identityPrivateKeyJwk: target ? (target.signingPrivateKeyJwk || null) : null,
      commentReads: this.commentReadsFor(id),
      issueSubscriptions: this.issueSubscriptionsFor(id)
    });
    if (targetId) this.switchProject(targetId, after);
    else this.createBlankProject(this.nextUntitledProjectName(id), id).then(() => { if (after) after(); });
    this.ensureIdentity();
  }
  // Deterministic dot color per identity (reuses the existing select-field
  // color palette rather than inventing a new one) -- stable across
  // reorders since it hashes the id itself, not array position.
  identityColor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) { hash = (hash * 31 + id.charCodeAt(i)) | 0; }
    return PALETTE_ORDER[Math.abs(hash) % PALETTE_ORDER.length];
  }
  // The real entry point every write call site uses now (see
  // requireIdentityEmail below, which this wraps). A project's identityId
  // is "the identity I last committed with here" -- derived, never
  // assigned. No derived identity yet (a project shared with you, never
  // written to) or a derived identity that no longer matches who's
  // currently active both mean: ask once, in plain language, before the
  // write (and the separate email gate) proceed.
  requireAttribution(action) {
    const project = this.state.projects.find(p => p.id === this.state.projectId);
    if (project) {
      const needsFirst = !project.identityId;
      const needsMismatch = !needsFirst && project.identityId !== this.state.activeIdentityId;
      if (needsFirst || needsMismatch) {
        this._pendingAttributionAction = action;
        this.setState({
          attributionGateOpen: true,
          attributionGateMode: needsFirst ? 'first' : 'mismatch',
          attributionGateSelectedId: needsFirst ? (this.state.activeIdentityId || null) : project.identityId,
          attributionGateAddOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: ''
        });
        return;
      }
    }
    this.requireIdentityEmail(action);
  }
  // Generic in-app confirm, replacing window.confirm() everywhere it was
  // used for a destructive/consequential action (tracker #149,
  // live-reported): a Matrix client typically sandboxes an embedded
  // widget's iframe without allow-modals, which makes window.confirm
  // silently no-op -- no dialog, no error, the action just never happens.
  // deleteProject's own bespoke (stricter, type-to-confirm) modal already
  // proved this pattern works; this is the same idea generalized for
  // every other confirm() call site, which only need a plain OK/Cancel.
  confirmAction(message, onConfirm, confirmLabel) {
    this.setState({ confirmDialog: { message, confirmLabel: confirmLabel || 'Confirm', onConfirm } });
  }
  selectAttributionGateIdentity(id) { this.setState({ attributionGateSelectedId: id, attributionGateAddOpen: false }); }
  openAttributionGateAdd() { this.setState({ attributionGateAddOpen: true, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }); }
  cancelAttributionGate() {
    this._pendingAttributionAction = null;
    this.setState({ attributionGateOpen: false, attributionGateSelectedId: null, attributionGateAddOpen: false, activeCell: null, editDraft: '' });
  }
  // Writing the project's identityId here -- the moment a write is
  // actually confirmed -- is the ONLY place identityId is ever set after
  // creation. There is deliberately no other UI that reassigns it (no
  // "move project between identities"): this is a derivation update, not
  // a manual edit.
  confirmAttributionGate() {
    const selectedId = this.state.attributionGateSelectedId;
    if (!selectedId) return;
    const projectId = this.state.projectId;
    const target = this.state.identities.find(i => i.id === selectedId);
    const action = this._pendingAttributionAction;
    this._pendingAttributionAction = null;
    this._signingKey = null;
    this.setState(s => ({
      projects: s.projects.map(p => p.id === projectId ? Object.assign({}, p, { identityId: selectedId }) : p),
      activeIdentityId: selectedId,
      commentReads: this.commentReadsFor(selectedId),
      issueSubscriptions: this.issueSubscriptionsFor(selectedId),
      identityEmail: target ? (target.email || '') : s.identityEmail,
      githubToken: target ? (target.githubToken || '') : s.githubToken,
      jiraProxyUrl: target ? (target.jiraProxyUrl || '') : s.jiraProxyUrl,
      jiraProxySecret: target ? (target.jiraProxySecret || '') : s.jiraProxySecret,
      salesforceProxyUrl: target ? (target.salesforceProxyUrl || '') : s.salesforceProxyUrl,
      salesforceProxySecret: target ? (target.salesforceProxySecret || '') : s.salesforceProxySecret,
      githubProxyUrl: target ? (target.githubProxyUrl || '') : s.githubProxyUrl,
      githubProxySecret: target ? (target.githubProxySecret || '') : s.githubProxySecret,
      googleDriveProxyUrl: target ? (target.googleDriveProxyUrl || '') : s.googleDriveProxyUrl,
      googleDriveProxySecret: target ? (target.googleDriveProxySecret || '') : s.googleDriveProxySecret,
      pushRelayUrl: target ? (target.pushRelayUrl || '') : s.pushRelayUrl,
      pushRelaySecret: target ? (target.pushRelaySecret || '') : s.pushRelaySecret,
      identityPublicKeyJwk: target ? (target.signingPublicKeyJwk || null) : s.identityPublicKeyJwk,
      identityPrivateKeyJwk: target ? (target.signingPrivateKeyJwk || null) : s.identityPrivateKeyJwk,
      attributionGateOpen: false, attributionGateSelectedId: null
    }), () => { if (action) this.requireIdentityEmail(action); });
  }
  requireIdentityEmail(action) {
    if ((this.state.identityEmail || '').trim()) { action(); return; }
    this._pendingGatedAction = action;
    this.setState({ emailGateOpen: true, emailGateDraft: '' });
  }
  onEmailGateDraftChange(e) { this.setState({ emailGateDraft: e.target.value }); }
  cancelEmailGate() { this._pendingGatedAction = null; this.setState({ emailGateOpen: false, emailGateDraft: '', activeCell: null, editDraft: '' }); }
  submitEmailGate() {
    const email = (this.state.emailGateDraft || '').trim();
    if (!email) return;
    const action = this._pendingGatedAction;
    this._pendingGatedAction = null;
    this.setState(s => ({
      identities: s.identities.map(i => i.id === s.activeIdentityId ? Object.assign({}, i, { email }) : i),
      identityEmail: email,
      emailGateOpen: false, emailGateDraft: ''
    }));
    if (action) action();
  }
  updateActiveIdentityField(field, value, mirrorKey) {
    this.setState(s => {
      const patch = { identities: s.identities.map(i => i.id === s.activeIdentityId ? Object.assign({}, i, { [field]: value }) : i) };
      if (mirrorKey) patch[mirrorKey] = value;
      return patch;
    });
  }
  // Adds a brand-new identity with its own freshly generated ECDSA keypair
  // (same generateKey/exportKey shape as ensureIdentity(), just not shared
  // with any other identity) and switches to it. switchIdentity's own
  // project filter naturally returns no candidates for a never-seen id, so
  // this lands on the same blank-state fallback switchProject already has
  // for an unvisited project -- no special-casing needed here.
  async generateIdentityKeypair() {
    try {
      const keyPair = await crypto.subtle.generateKey(SIGN_ALG, true, ['sign', 'verify']);
      const [signingPublicKeyJwk, signingPrivateKeyJwk] = await Promise.all([
        crypto.subtle.exportKey('jwk', keyPair.publicKey),
        crypto.subtle.exportKey('jwk', keyPair.privateKey)
      ]);
      return { signingPublicKeyJwk, signingPrivateKeyJwk };
    } catch (e) {
      console.warn('[tracker] failed to generate identity keypair:', e);
      return { signingPublicKeyJwk: null, signingPrivateKeyJwk: null };
    }
  }
  async createIdentity(label, email) {
    const id = crypto.randomUUID();
    const { signingPublicKeyJwk, signingPrivateKeyJwk } = await this.generateIdentityKeypair();
    const identity = {
      id, label: (label || '').trim() || 'New identity', email: (email || '').trim(),
      githubToken: '', ...identityProxyFieldsFrom(null),
      signingPublicKeyJwk, signingPrivateKeyJwk
    };
    this.setState(s => ({ identities: s.identities.concat([identity]), addIdentityOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }));
    this.switchIdentity(id);
  }
  // Used only by the attribution gate's inline "Someone else..." bootstrap
  // -- adds the identity and pre-selects it in the gate, but deliberately
  // does NOT call switchIdentity() (that's a real navigation; this is
  // still mid-write, waiting on "Save the change").
  async createIdentityForAttributionGate(label, email) {
    const id = crypto.randomUUID();
    const { signingPublicKeyJwk, signingPrivateKeyJwk } = await this.generateIdentityKeypair();
    const identity = {
      id, label: (label || '').trim() || 'New identity', email: (email || '').trim(),
      githubToken: '', ...identityProxyFieldsFrom(null),
      signingPublicKeyJwk, signingPrivateKeyJwk
    };
    this.setState(s => ({ identities: s.identities.concat([identity]), attributionGateAddOpen: false, attributionGateSelectedId: id, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }));
  }
  async switchProject(id, after) {
    if (id === this.state.projectId) { this.setState({ switcherOpen: false, unknownProjectCold: null, unknownProjectNotice: null }, after); return; }
    // Skipped while a resolveDeepLinkFromHash() run (boot or popstate) is
    // driving this switch -- the browser has already moved the history
    // pointer for us, pushing again here would corrupt the stack.
    if (!this._navigatingFromHistory) {
      const hash = '#/project/' + encodeURIComponent(id);
      if (window.location.hash !== hash) history.pushState(null, '', hash);
    }
    this._issueOpenedViaPush = false;
    // Cancel bookkeeping tied to the OLD project's GitHub connection --
    // otherwise a debounce timer armed against the old project could fire
    // a push using the NEW project's content and a stale sha.
    if (this._githubPushTimer) { clearTimeout(this._githubPushTimer); this._githubPushTimer = null; }
    this._githubFileSha = null;
    this._githubEtag = null;
    this._githubLastSyncedText = null;
    let doc = null;
    try {
      doc = await docStore.getDoc(id);
    } catch (e) { console.warn('[tracker] failed to load project', id, e); }
    if (!doc) doc = { fieldDefs: defaultFieldDefs(), issues: [], projectHistory: [], hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: '', projectNotes: '', projectComments: [] };
    this._docIssuesBaseline[id] = JSON.stringify(doc.issues || []);
    this._projectSummaries[id] = buildProjectSummaryFromDoc(doc);
    const newTimestampFieldIds = ['created', 'updated'].filter(tid => !(doc.fieldDefs && doc.fieldDefs[tid]));
    const { fieldDefs: hydratedFieldDefs, projectHistory: hydratedProjectHistory, projectName: hydratedProjectName, projectNotes: hydratedProjectNotes } = hydrateProject(doc.fieldDefs, doc.projectHistory || [], doc.projectNotes || '');
    const hydratedIssues = doc.issues.map(iss => hydrateIssue(iss, hydratedFieldDefs));
    const storedHiddenFieldIds = this.hiddenFieldIdsFor(id) || [];
    const hiddenFieldIds = [...storedHiddenFieldIds, ...newTimestampFieldIds.filter(tid => !storedHiddenFieldIds.includes(tid))];
    const mergeLog = await this.readMergeLog(id);
    const waitingJob = this.state.refreshJobs[id];
    const pendingMerge = (waitingJob && (waitingJob.status === 'ready' || waitingJob.status === 'partial')) ? waitingJob.preparedMerge : null;
    this.setState({
      projectId: id,
      // A real, derived field:'name' entry (tracker #149) always wins over
      // this browser's own cached milestone name -- covers the case where
      // another peer (GitHub sync, Matrix room, Connect Remote) renamed the
      // project since this browser last saw it.
      projects: this.state.projects.map(m => m.id === id && hydratedProjectName && hydratedProjectName !== m.name ? { ...m, name: hydratedProjectName } : m),
      fieldDefs: hydratedFieldDefs, projectHistory: hydratedProjectHistory, issues: hydratedIssues,
      columnOrder: reconcileColumnOrder(this.columnOrderFor(id), hydratedFieldDefs, hiddenFieldIds),
      hiddenFieldIds,
      mergeLog, pendingMerge, mergeReviewId: null, mergeReviewTimelineIssueId: null,
      githubRepo: doc.githubRepo || '', githubRepoPath: doc.githubRepoPath || 'tracker.jsonl', githubRepoBranch: doc.githubRepoBranch || '', githubTokenOverride: doc.githubTokenOverride || '',
      projectNotes: hydratedProjectNotes != null ? hydratedProjectNotes : (doc.projectNotes || ''), projectComments: doc.projectComments || [],
      githubSyncStatus: 'disconnected', githubSyncError: '', githubLastSyncedAt: null,
      columnWidths: this.columnWidthsFor(id),
      columnWrap: this.columnWrapFor(id),
      localFieldBindings: this.localFieldBindingsFor(id),
      localDerivedEntryIds: this.localDerivedEntryIdsFor(id),
      // columnOrder/columnFilters/sort are cosmetic per-browser preferences
      // now (like columnWidths/columnWrap) -- they LOAD for the target
      // project rather than resetting, unlike the rest of this transient
      // UI state (menus, active/selected cell, add-item draft, slide-over)
      // plus what it implies (drag state, field-editor/color-picker modals,
      // an in-progress rename).
      settingsOpen: false, exportMenuOpen: false, proposeLayoutConfirmOpen: false, sendCopied: false, sourceViewOpen: false, addFieldOpen: false,
      addItemOpen: false, addItemDraft: '', filterQuery: '', widgetFilterOpen: false, jumpDismissed: false, jumpActiveIndex: 0, filterSuggestDismissed: true, filterSuggestActiveIndex: 0, sort: this.sortFor(id), sortSnapshot: computeSortSnapshot(this.sortFor(id), hydratedIssues, hydratedFieldDefs), columnFilters: this.columnFiltersFor(id),
      columnFilterExcludedIds: computeColumnFilterExcludedIds(this.columnFiltersFor(id), hydratedIssues, hydratedFieldDefs),
      draggingColId: null, dragOverColId: null, dragOverSide: null, openColMenuId: null,
      kanbanColId: null, draggingKanbanIssueId: null, dragOverKanbanOptId: null, freezeColId: null,
      draggingRuleRowIndex: null, dragOverRuleRowIndex: null, dragOverRuleRowSide: null,
      fieldEditorColId: null, fieldEditorNewOptLabel: '', colorPickerOptIndex: null,
      ruleBuilderColId: null, ruleBuilderVisible: false,
      activeCell: null, selectedCell: null, editDraft: '', optionFilterQuery: '',
      slideOverIssueId: null, slideOverVisible: false, newCommentDraft: '', commentStreamDrafts: {}, editingCommentFieldId: null, editingCommentId: null, editCommentDraft: '',
      switcherOpen: false, unknownProjectCold: null, unknownProjectNotice: null,
      trackerNameEditing: false, trackerNameDraft: '',
      projectNotesOpen: false, projectNotesVisible: false, projectNoteEditing: false, projectNoteDraft: '', projectCommentDraft: '',
      deleteProjectConfirmOpen: false, deleteProjectNameDraft: '', confirmDialog: null,
      selectedIssueIds: [], focusAnchorId: null,
      bulkFieldMenuOpen: false, bulkFieldMenuColId: null, bulkTextDraft: '', bulkMultiDraft: {}
    }, after);
    this.checkForNewMentions(hydratedIssues);
    this.checkForSubscribedIssueUpdates(hydratedIssues);
    // Mirrors componentDidMount's own boot-time check -- the new project
    // has its own (possibly unset) repo connection, independent of whatever
    // the old one was connected to.
    this.connectGithubRepoIfVisible();
  }
  // The only place a project row's click actually commits (the picker's
  // scope column only ever previews). A project already attributed to a
  // DIFFERENT identity than the one currently active switches identity
  // too (reusing switchIdentity's own target-project-aware signature) so
  // activeIdentityId and the project's own identityId stay in sync, same
  // invariant switchIdentity/reconcileActiveIdentityWithProject already
  // maintain everywhere else. A Shared-with-you project (no identityId)
  // never forces an identity switch -- browsing/writing to it needs none
  // upfront (see requireAttribution).
  selectSwitcherProject(project) {
    this.setState({ switcherOpen: false });
    if (project.identityId && project.identityId !== this.state.activeIdentityId) {
      this.switchIdentity(project.identityId, project.id);
    } else {
      this.switchProject(project.id);
    }
  }
  // A blank board with the same useful default columns as the seed data,
  // but no demo issues. Relies on switchProject's own "doc not found"
  // fallback to actually construct that blank shape, rather than
  // duplicating it here -- nothing is written for this id until the first
  // persist() after switching.
  openDeleteProjectConfirm() {
    this.setState({ deleteProjectConfirmOpen: true, deleteProjectNameDraft: '' });
  }
  async deleteProject() {
    const id = this.state.projectId;
    const meta = this.state.projects.find(p => p.id === id);
    if (!meta || this.state.deleteProjectNameDraft !== meta.name) return;
    try { await docStore.deleteDoc(id); if (!ROOM_MODE_CAPABILITIES) this._docSyncChannel.postMessage({ type: 'doc-deleted', projectId: id }); } catch (e) { console.warn('[tracker] failed to remove project doc:', e); }
    if (!ROOM_MODE_CAPABILITIES) {
      try {
        localStorage.removeItem(this.docKey(id));
        localStorage.removeItem(mergeLogStorageKey(this.storagePrefKey(id)));
        const migrationState = await idbGetMeta('migrationState');
        if (migrationState && Object.prototype.hasOwnProperty.call(migrationState, id)) {
          delete migrationState[id];
          await idbPutMeta('migrationState', migrationState);
        }
      } catch (e) { console.warn('[tracker] failed to clean up legacy storage for deleted project:', e); }
    }
    [COLUMN_WIDTHS_KEY, COLUMN_ORDER_KEY, COLUMN_FILTERS_KEY, HIDDEN_FIELDS_KEY, SORT_KEY, WRAP_KEY].forEach(key => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const all = JSON.parse(raw);
        if (all && Object.prototype.hasOwnProperty.call(all, id)) {
          delete all[id];
          localStorage.setItem(key, JSON.stringify(all));
        }
      } catch (e) { console.warn('[tracker] failed to clean up per-project prefs for key', key, e); }
    });
    const remainingProjects = this.state.projects.filter(p => p.id !== id);
    const candidates = remainingProjects.filter(p => p.identityId === this.state.activeIdentityId);
    this.setState({ projects: remainingProjects, deleteProjectConfirmOpen: false, deleteProjectNameDraft: '' });
    if (candidates.length) this.switchProject(candidates[0].id);
    else this.createBlankProject(this.nextUntitledProjectName());
  }
  nextUntitledProjectName(identityId) {
    const scopeId = identityId !== undefined ? identityId : this.state.activeIdentityId;
    const re = /^Untitled Project (\d+)$/;
    let highest = 0;
    this.state.projects.forEach(p => {
      if (p.identityId !== scopeId) return;
      const m = re.exec(p.name);
      if (m) highest = Math.max(highest, parseInt(m[1], 10));
    });
    return 'Untitled Project ' + (highest + 1);
  }
  async createBlankProject(name, identityId) {
    const id = crypto.randomUUID();
    const finalName = (name || '').trim() || 'New project';
    const fieldDefs = blankProjectFieldDefs();
    const starterHistory = this.starterFieldHistory(fieldDefs, this.displayName(), this.state.identityEmail || '');
    const nameEntry = this.buildUnsignedProjectNameEntry(finalName);
    const doc = {
      fieldDefs,
      projectHistory: starterHistory.concat([nameEntry]),
      issues: [], hiddenFieldIds: [],
      githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: '',
      projectNotes: '', projectComments: []
    };
    await docStore.putDoc(id, doc);
    this.state.projects = this.state.projects.concat([{ id, name: finalName, identityId: identityId || this.state.activeIdentityId }]);
    await this.switchProject(id, () => this.signInsertedProjectHistoryEntry(id, nameEntry));
  }
  // Builds a project-name history entry the SAME shape appendProjectHistory
  // itself would produce, unsigned, WITHOUT inserting it anywhere -- for
  // callers that need it to already exist in a doc's very first write
  // (see createBlankProject/importParsedAsNewProject's own comments for
  // why a later, separate append can lose a race it must never lose).
  // Pair with signInsertedProjectHistoryEntry once switched into the
  // project, to patch a real signature on in the background.
  buildUnsignedProjectNameEntry(value) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : 'ph-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      actor: this.displayName(), email: this.state.identityEmail || '',
      text: 'Named project "' + value + '"', field: PROJECT_NAME_FIELD_ID, value,
      origin: 'authored', sortKey: this.nextSortKey(), sig: null, sigRedacted: null, pubKey: null
    };
  }
  // Signs an entry already present (unsigned) in projectId's own history --
  // same background sign-then-patch as commitSignedEntry's own pattern,
  // just skipping the (already-done) insert step. Only patches if still
  // viewing the same project the entry belongs to, in case the user
  // switched away before signing finished.
  signInsertedProjectHistoryEntry(projectId, entry) {
    Promise.all([this.signPayload(signableProjectPayload(projectId, entry)), this.signPayload(redactedProjectPayload(projectId, entry))])
      .then(([sig, sigRedacted]) => {
        if (!sig && !sigRedacted) return;
        if (this.state.projectId !== projectId) return;
        this.setState(st => ({ projectHistory: st.projectHistory.map(h => h.id === entry.id ? { ...h, sig, sigRedacted, pubKey: this.state.identityPublicKeyJwk } : h) }));
      });
  }
  startEditTrackerName() {
    const meta = this.state.projects.find(m => m.id === this.state.projectId);
    this.setState({ trackerNameEditing: true, trackerNameDraft: meta ? meta.name : '', switcherOpen: false });
  }
  onTrackerNameDraftChange(e) { this.setState({ trackerNameDraft: e.target.value }); }
  onTrackerNameFocus(e) { e.target.select(); }
  // Called from blur (Enter routes through e.target.blur(), same
  // convention as handleEditKey elsewhere) -- guarded on trackerNameEditing
  // so it's a no-op if already committed/cancelled.
  commitTrackerNameEdit() {
    if (!this.state.trackerNameEditing) return;
    const name = (this.state.trackerNameDraft || '').trim();
    if (!name) { this.cancelTrackerNameEdit(); return; }
    const meta = this.state.projects.find(m => m.id === this.state.projectId);
    const oldName = meta ? meta.name : '';
    this.requireAttribution(() => {
      this.setState({
        projects: this.state.projects.map(m => m.id === this.state.projectId ? { ...m, name } : m),
        trackerNameEditing: false, trackerNameDraft: ''
      });
      if (name !== oldName) this.appendProjectHistory({ text: 'Renamed project from "' + oldName + '" to "' + name + '"', field: PROJECT_NAME_FIELD_ID, value: name });
    });
  }
  cancelTrackerNameEdit() { this.setState({ trackerNameEditing: false, trackerNameDraft: '' }); }
  ensureHeaderPattern() {
    const id = this.state.projectId || '_default';
    const mount = document.querySelector('[data-testid="header-pattern-mount"]');
    if (!mount) { setTimeout(() => this.ensureHeaderPattern(), 60); return; }
    // Live-reported (Tom, 2026-10-03): crossing the mobile/desktop
    // breakpoint in either direction left the header permanently blank
    // (white) even after returning to the original viewport size. Root
    // cause: the desktop and mobile shells are two separate <sc-if>
    // branches, not one shell with CSS-hidden variants -- so toggling the
    // breakpoint destroys whichever header-pattern-mount was just filled
    // and mounts a brand new, empty one. The old guard above only tracked
    // "has the project id changed", with no way to notice the DOM node
    // itself got replaced -- it kept skipping the redraw against a
    // genuinely empty mount, in BOTH directions, since the project id
    // never actually changed. Checking the mount's own emptiness too
    // catches this with no cost on the common path (an already-filled
    // mount for an unchanged project still skips straight through).
    if (this._headerPatternProjectId === id && mount.firstChild) return;
    this._headerPatternProjectId = id;
    const { width, height, triangles } = computeHeaderMeshTriangles(id);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    triangles.forEach(tri => {
      ctx.beginPath();
      ctx.moveTo(tri.points[0][0], tri.points[0][1]);
      ctx.lineTo(tri.points[1][0], tri.points[1][1]);
      ctx.lineTo(tri.points[2][0], tri.points[2][1]);
      ctx.closePath();
      ctx.fillStyle = tri.fill;
      ctx.fill();
    });
    mount.innerHTML = '';
    mount.appendChild(canvas);
  }
  // Only called from componentDidUpdate's own blanket fan-out -- see
  // measureTableOverflow's own comment for why this gate cannot live
  // inside that function itself (it has 4 other, non-state-driven callers).
  maybeMeasureTableOverflow() {
    const s = this.state;
    const deps = [s.issues, s.filterQuery, s.columnFilters, s.columnFilterExcludedIds, s.sort, s.columnWrap, s.hiddenFieldIds, s.projectId];
    const lastDeps = this._lastMeasureOverflowDeps;
    if (lastDeps && deps.every((v, i) => v === lastDeps[i])) return;
    this._lastMeasureOverflowDeps = deps;
    this.measureTableOverflow();
  }
  // Only called from componentDidUpdate's own blanket fan-out -- see
  // measureTableOverflow's own comment for the same reasoning (this
  // gate cannot live inside measureStatusBarOverflow itself, which also
  // has non-state-driven callers: mount, resize).
  maybeMeasureStatusBarOverflow() {
    if (!this.isTauriWindowedRuntime()) return;
    const s = this.state;
    const deps = [s.installedAppVersion, s.updateCheckState, s.githubRepo, s.githubSyncStatus];
    const lastDeps = this._lastMeasureStatusBarDeps;
    if (lastDeps && deps.every((v, i) => v === lastDeps[i])) return;
    this._lastMeasureStatusBarDeps = deps;
    this.measureStatusBarOverflow();
  }
  measureStatusBarOverflow() {
    if (!this.isTauriWindowedRuntime()) return;
    const el = document.querySelector('[data-testid="status-bar-info-row"]');
    if (!el || el.offsetParent === null) return;
    const fits = el.scrollWidth <= el.clientWidth + 1;
    if (fits !== this.state.statusBarRowFits) this.setState({ statusBarRowFits: fits });
  }
  measureTableOverflow() {
    // Bottom padding only exists when the table actually scrolls, so a short
    // table sits the same distance above the add-item bar as it does below
    // the filter box. Subtracting the current spacer keeps the test stable
    // (adding the spacer can't flip the answer back).
    const el = document.querySelector('[data-testid="table-scroll-wrap"]');
    if (!el || el.offsetParent === null) return; // not actually laid out (e.g. an embedding host's iframe is still display:none) -- nothing meaningful to measure yet
    const currentSpacer = this.state.tableOverflow ? 14 : 0;
    const overflows = (el.scrollHeight - currentSpacer) > (el.clientHeight + 1);
    const patch = {};
    if (overflows !== this.state.tableOverflow) patch.tableOverflow = overflows;

    // Count rows whose bottom edge sits past the visible area. The 22px fade
    // band counts as "not visible" -- a row dissolving into it is exactly
    // the row a reader would miss. Measured with rects, not offsetTop: the
    // scroll wrap is position:static, so rows' offsetParent is an outer
    // element and offsetTop is in a different coordinate space from
    // scrollTop/clientHeight.
    const rows = el.querySelectorAll('[data-testid="row"]');
    const cutoff = el.getBoundingClientRect().bottom - 22;
    let below = 0;
    for (const r of rows) if (r.getBoundingClientRect().bottom > cutoff) below++;
    // At the very end of the scroll range nothing is below, whatever the
    // bottom spacer does to the measurement.
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if (!overflows || atEnd) below = 0;
    if (below !== this.state.rowsBelow) patch.rowsBelow = below;
    const fitting = rows.length - below;
    if (fitting !== this.state.rowsFitting) patch.rowsFitting = fitting;
    if (Object.keys(patch).length) this.setState(patch);
  }
  scrollTableToEnd() {
    const el = document.querySelector('[data-testid="table-scroll-wrap"]');
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }
  componentDidMount() {
    this._headerPatternProjectId = null;
    this.ensureHeaderPattern();
    if (window.__wigwagStopHidingOverlays) window.__wigwagStopHidingOverlays();
    // Tauri desktop app (tracker #85): target=_blank already opens a real
    // new browser tab everywhere else (PWA, plain browser), but a Tauri
    // webview has no browser chrome to open a tab in and won't route
    // target=_blank to the system browser on its own -- it needs the
    // opener plugin's own open_url command instead. window.__TAURI__ only
    // exists inside the desktop app (withGlobalTauri), so this is a no-op
    // everywhere else and the native target=_blank behavior is untouched.
    this._onExternalLinkClick = (e) => {
      if (!window.__TAURI__ || !window.__TAURI__.core) return;
      const a = e.target.closest('a[target="_blank"]');
      if (!a || !a.href) return;
      e.preventDefault();
      window.__TAURI__.core.invoke('plugin:opener|open_url', { url: a.href }).catch(err => console.warn('[tracker] failed to open external link:', err));
    };
    document.addEventListener('click', this._onExternalLinkClick, true);
    // notificationPermission's own initial-state computation can only be
    // synchronous (window.Notification.permission is a plain property) --
    // the Tauri plugin's isPermissionGranted() is async, so it starts as a
    // placeholder 'default' there and gets corrected here, once, on mount.
    if (this.isTauriNotificationRuntime()) {
      this.checkNotificationPermission().then(perm => this.setState({ notificationPermission: perm }));
    }
    if (window.__TAURI__ && window.__TAURI__.app) {
      window.__TAURI__.app.getVersion().then(v => this.setState({ installedAppVersion: v })).catch(() => {});
    }
    if (this.isTauriUpdaterRuntime()) {
      this.checkForUpdate();
    }
    // file: origins can't register a service worker at all (same restriction
    // mentionNotificationsFileOrigin already surfaces for in-tab notifications)
    // -- skip quietly rather than let the rejection hit the console.
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('[tracker] service worker registration failed -- push notifications need one:', e));
    }
    this.checkForAppUpdate();
    this._onOutsideMouseDown = (e) => {
      const s = this.state;
      let patch = null;
      if (s.openColMenuId && !e.target.closest('[data-testid="col-header"]') && !e.target.closest('[data-testid="title-col-header"]')) {
        patch = Object.assign(patch || {}, { openColMenuId: null });
      }
      if (s.addFieldOpen && !e.target.closest('[data-testid="add-field-wrap"]')) {
        patch = Object.assign(patch || {}, { addFieldOpen: false });
      }
      if (s.exportMenuOpen && !e.target.closest('[data-testid="export-menu-wrap"]')) {
        // Clear the copy-success auto-close timer too -- otherwise a stale
        // sendCopied:true can flash on the NEXT time this menu opens if
        // the user dismisses it (clicking away) before the 1100ms window
        // elapses.
        clearTimeout(this._sendCopiedTimer);
        patch = Object.assign(patch || {}, { exportMenuOpen: false, sendCopied: false });
      }
      if (s.proposeLayoutConfirmOpen && !e.target.closest('[data-testid="propose-layout-menu-wrap"]')) {
        patch = Object.assign(patch || {}, { proposeLayoutConfirmOpen: false });
      }
      if (s.settingsOpen && !e.target.closest('[data-testid="settings-modal"]') && !e.target.closest('[data-testid="connector-form-overlay"]') && !e.target.closest('[data-testid="connector-form-modal"]')) {
        patch = Object.assign(patch || {}, { settingsOpen: false });
      }
      if (s.switcherOpen && !e.target.closest('[data-testid="switcher-wrap"]')) {
        patch = Object.assign(patch || {}, { switcherOpen: false });
      }
      if (s.statusBarOverflowOpen && !e.target.closest('[data-testid="app-status-bar"]')) {
        patch = Object.assign(patch || {}, { statusBarOverflowOpen: false });
      }
      if (!s.jumpDismissed && !e.target.closest('[data-testid="filter-input-wrap"]') && !e.target.closest('[data-testid="jump-panel"]') && !e.target.closest('[data-testid="mobile-filter-header"]') && !e.target.closest('[data-testid="mobile-row-list"]')) {
        patch = Object.assign(patch || {}, { jumpDismissed: true });
      }
      if (!s.filterSuggestDismissed && !e.target.closest('[data-testid="filter-input-wrap"]') && !e.target.closest('[data-testid="filter-suggest-panel"]')) {
        patch = Object.assign(patch || {}, { filterSuggestDismissed: true });
      }
      if (s.activeCell) {
        const def = s.fieldDefs[s.activeCell.colId];
        const isPopoverField = def && (def.type === 'select' || def.type === 'multiselect' || def.type === 'commentStream');
        const insidePopoverHost = e.target.closest('[data-testid="field-cell"]') || e.target.closest('[data-testid="slideover-field"]') || e.target.closest('[data-testid="slideover-description"]') || e.target.closest('[data-testid="mobile-field-picker-page"]') || e.target.closest('[data-testid="mobile-row-detail-field"]');
        if (isPopoverField && !insidePopoverHost) {
          patch = Object.assign(patch || {}, { activeCell: null, optionFilterQuery: '' });
        }
      }
      if (s.selectedCell) {
        const insideCell = e.target.closest('[data-testid="field-cell"]') || e.target.closest('[data-testid="title-cell"]') || e.target.closest('[data-testid="slideover-field"]') || e.target.closest('[data-testid="slideover-title-wrap"]') || e.target.closest('[data-testid="slideover-description"]');
        if (!insideCell) patch = Object.assign(patch || {}, { selectedCell: null });
      }
      if (patch) this.setState(patch);
    };
    document.addEventListener('mousedown', this._onOutsideMouseDown, true);
    this._onGlobalKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (this.state.globalSearchOpen) this.closeGlobalSearch(); else this.openGlobalSearch();
        return;
      }
      if (e.key === 'Escape') {
        if (this.state.globalSearchOpen) { this.closeGlobalSearch(); return; }
        if (this.state.widgetFilterOpen) { this.setState({ widgetFilterOpen: false }); return; }
        if (this._appearanceMenuOpen) { this.closeAppearanceMenu(); return; }
        if (this.state.mobileAddOpen) { this.setState({ mobileAddOpen: false, addItemDraft: '' }); return; }
        if (this.state.mobileAddIdentityOpen) { this.setState({ mobileAddIdentityOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }); return; }
        if (this.state.mobileSettingsSection) { this.setState({ mobileSettingsSection: null }); return; }
        if (this.state.mobileFilterOpen) { this.setState({ mobileFilterOpen: false, filterQuery: '', jumpDismissed: false }); return; }
        if (this.state.mobileActiveSheet) {
          if (this.state.mobileActiveSheet === 'row') this.closeSlideOver();
          this.setState({ mobileActiveSheet: null });
          return;
        }
        if (this.state.pendingMerge) { this.cancelPendingMerge(); return; }
        if (this.state.pasteImportOpen) { this.setState({ pasteImportOpen: false, pasteImportDraft: '' }); return; }
        if (this.state.pasteMergeOpen) { this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' }); return; }
        if (this.state.ruleBuilderColId) { this.closeRuleBuilder(); return; }
        if (this.state.fieldEditorColId) { this.closeFieldEditor(); return; }
        if (this.state.openColMenuId) { this.setState({ openColMenuId: null }); return; }
        if (this.state.addFieldOpen) { this.setState({ addFieldOpen: false }); return; }
        if (this.state.addSourceTypePickerOpen) { this.closeAddSourceTypePicker(); return; }
        if (this.state.builtinFormOpen) { this.cancelBuiltinForm(); return; }
        if (this.state.connectorFormOpen) { this.cancelConnectorForm(); return; }
        if (this.state.settingsOpen) { this.setState({ settingsOpen: false }); return; }
        if (this.state.switcherOpen) { this.setState({ switcherOpen: false }); return; }
        if (this.state.exportMenuOpen) { clearTimeout(this._sendCopiedTimer); this.setState({ exportMenuOpen: false, sendCopied: false }); return; }
        if (this.state.sourceViewOpen) { this.closeSourceView(); return; }
        if (this.state.activeCell) { this.cancelEdit(); return; }
        if (this.state.slideOverIssueId) { this.closeSlideOver(); return; }
        if (this.state.selectedIssueIds.length) { this.setState({ selectedIssueIds: [] }); return; }
        if (this.state.deleteProjectConfirmOpen) { this.setState({ deleteProjectConfirmOpen: false, deleteProjectNameDraft: '' }); return; }
        if (this.state.projectNotesOpen) { this.closeProjectNotes(); return; }
        return;
      }
      const typingTarget = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (!typingTarget && e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && ROOM_MODE_CAPABILITIES) {
        e.preventDefault();
        this.setState({ widgetFilterOpen: true });
        return;
      }
      if (!typingTarget && (e.key === 'x' || e.key === 'X') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.toggleFocusedRowByKeyboard();
        return;
      }
      if (!typingTarget && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        this.moveFocusAndExtendSelection(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.code !== 'Space' || !e.ctrlKey) return;
      const s = this.state;
      if (s.addItemOpen || s.fieldEditorColId || s.sourceViewOpen || s.slideOverIssueId) return;
      e.preventDefault();
      this.setState({ addItemOpen: true });
    };
    document.addEventListener('keydown', this._onGlobalKeyDown);
    this._onGithubOAuthMessage = (e) => {
      const data = e.data;
      if (!data || data.source !== 'github-oauth') return;
      if (!this._githubOAuthState || data.state !== this._githubOAuthState) return;
      if (!this._githubOAuthExpectedOrigin || e.origin !== this._githubOAuthExpectedOrigin) return;
      this._githubOAuthState = null;
      this._githubOAuthExpectedOrigin = null;
      if (data.token) { this.updateActiveIdentityField('githubToken', data.token, 'githubToken'); this.setState({ githubSyncError: '' }); }
      else if (data.error) this.setState({ githubSyncError: data.error });
    };
    window.addEventListener('message', this._onGithubOAuthMessage);
    this._onStorageEvent = (e) => {
      if (e.storageArea !== localStorage) return;
      if (e.key === PROJECTS_KEY) {
        try {
          const saved = e.newValue ? JSON.parse(e.newValue) : null;
          if (saved && Array.isArray(saved.milestones) && JSON.stringify(saved.milestones) !== JSON.stringify(this.state.projects)) {
            const hadNoMatchingProject = !this.state.projects.some(m => m.id === this.state.projectId);
            this.setState({ projects: saved.milestones });
            if (ROOM_MODE_CAPABILITIES && hadNoMatchingProject && saved.milestones.length > 0) this.switchProject(saved.milestones[0].id);
          }
        } catch (err) { console.warn('[tracker] failed to sync project list from another tab:', err); }
        return;
      }
      if (e.key === IDENTITIES_KEY) {
        try {
          const saved = e.newValue ? JSON.parse(e.newValue) : null;
          if (!saved || !Array.isArray(saved.identities)) return;
          if (typeof saved.rev === 'number' && saved.rev <= (this._lastKnownIdentitiesRev || 0)) return;
          if (typeof saved.rev === 'number') this._lastKnownIdentitiesRev = saved.rev;
          const cur = this.state;
          const savedActive = saved.identities.find(i => i.id === cur.activeIdentityId);
          const activeFieldsChanged = !!savedActive && (
            (savedActive.email || '') !== cur.identityEmail ||
            (savedActive.githubToken || '') !== cur.githubToken ||
            IDENTITY_PROXY_FIELDS.some(f => (savedActive[f.url] || '') !== cur[f.url] || (savedActive[f.secret] || '') !== cur[f.secret]) ||
            JSON.stringify(savedActive.signingPublicKeyJwk || null) !== JSON.stringify(cur.identityPublicKeyJwk || null) ||
            JSON.stringify(savedActive.signingPrivateKeyJwk || null) !== JSON.stringify(cur.identityPrivateKeyJwk || null)
          );
          const identitiesChanged = JSON.stringify(saved.identities) !== JSON.stringify(cur.identities);
          if (!identitiesChanged && !activeFieldsChanged) return;
          this.setState(s => {
            const patch = { identities: saved.identities };
            // Which identity THIS tab has active is this tab's own business
            // (same principle as PROJECTS_KEY above only refreshing the
            // list, never which project is currently open) -- but if the
            // active identity's OWN record is what changed elsewhere (its
            // email/token/repo/proxy/signing key edited in another tab),
            // the flat fields every existing call site reads need to catch
            // up too, or this tab would keep acting on stale values.
            const active = saved.identities.find(i => i.id === s.activeIdentityId);
            if (active) {
              patch.identityEmail = active.email || '';
              patch.githubToken = active.githubToken || '';
              Object.assign(patch, identityProxyFieldsFrom(active));
              patch.identityPublicKeyJwk = active.signingPublicKeyJwk || null;
              patch.identityPrivateKeyJwk = active.signingPrivateKeyJwk || null;
            }
            return patch;
          });
        } catch (err) { console.warn('[tracker] failed to sync identities from another tab:', err); }
        return;
      }
      if (e.key === this.docKey(this.state.projectId)) {
        try {
          const doc = e.newValue ? JSON.parse(e.newValue) : null;
          this._applyRemoteDocUpdate(doc);
        } catch (err) { console.warn('[tracker] failed to sync active project content from another tab:', err); }
        return;
      }
      if (e.key === COLUMN_WIDTHS_KEY) {
        try {
          this._lastPersistedColumnWidthsJson = e.newValue;
          const all = e.newValue ? JSON.parse(e.newValue) : null;
          const incoming = all && this.state.projectId ? (all[this.state.projectId] || {}) : null;
          if (incoming && JSON.stringify(incoming) !== JSON.stringify(this.state.columnWidths)) this.setState({ columnWidths: incoming });
        } catch (err) { console.warn('[tracker] failed to sync column widths from another tab:', err); }
        return;
      }
      if (e.key === LOCAL_FIELD_BINDINGS_KEY) {
        try {
          const all = e.newValue ? JSON.parse(e.newValue) : null;
          if (all && this.state.projectId) this.setState({ localFieldBindings: all[this.storagePrefKey(this.state.projectId)] || {} });
        } catch (err) { console.warn('[tracker] failed to sync local field bindings from another tab:', err); }
        return;
      }
      if (e.key === WRAP_KEY) {
        try {
          const all = e.newValue ? JSON.parse(e.newValue) : null;
          if (all && this.state.projectId) this.setState({ columnWrap: all[this.state.projectId] || {} });
        } catch (err) { console.warn('[tracker] failed to sync wrap preferences from another tab:', err); }
        return;
      }
      if (e.key === COLUMN_ORDER_KEY) {
        try {
          const all = e.newValue ? JSON.parse(e.newValue) : null;
          const override = all && this.state.projectId ? all[this.state.projectId] : null;
          if (override) this.setState({ columnOrder: reconcileColumnOrder(override, this.state.fieldDefs, this.state.hiddenFieldIds) });
        } catch (err) { console.warn('[tracker] failed to sync column order from another tab:', err); }
        return;
      }
      if (e.key === HIDDEN_FIELDS_KEY) {
        try {
          const all = e.newValue ? JSON.parse(e.newValue) : null;
          const override = all && this.state.projectId ? all[this.state.projectId] : null;
          if (override) this.setState({ hiddenFieldIds: override, columnOrder: reconcileColumnOrder(this.state.columnOrder, this.state.fieldDefs, override) });
        } catch (err) { console.warn('[tracker] failed to sync hidden fields from another tab:', err); }
        return;
      }
      if (e.key === COLUMN_FILTERS_KEY) {
        try {
          const all = e.newValue ? JSON.parse(e.newValue) : null;
          if (all && this.state.projectId) {
            const columnFilters = all[this.state.projectId] || {};
            this.setState(s => ({ columnFilters, columnFilterExcludedIds: computeColumnFilterExcludedIds(columnFilters, s.issues, s.fieldDefs) }));
          }
        } catch (err) { console.warn('[tracker] failed to sync column filters from another tab:', err); }
        return;
      }
      if (e.key === SORT_KEY) {
        try {
          const all = e.newValue ? JSON.parse(e.newValue) : null;
          if (all && this.state.projectId) this.setState({ sort: all[this.state.projectId] || { colId: null, dir: 'asc' } });
        } catch (err) { console.warn('[tracker] failed to sync sort from another tab:', err); }
        return;
      }
    };
    window.addEventListener('storage', this._onStorageEvent);
    this._docSyncChannel = new BroadcastChannel('wigwag:docsync');
    this._docSyncChannel.onmessage = (e) => this._onDocSyncMessage(e.data);
    this._githubPollTimer = setInterval(() => this.pollGithubForRemoteChanges(), window.__wigwagPollIntervalMs || 60000);
    this._onVisibilityChange = () => { if (!document.hidden) { this.onBecameVisible(); this.checkForAppUpdate(); } };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this.ensureIdentity();
    this.connectGithubRepoIfVisible();
    this.hydrateMarkdownBodies();
    this.autoGrowTextareas();
    this.measureTableOverflow();
    this.measureStatusBarOverflow();
    this._onWindowResize = () => { this.measureTableOverflow(); this.measureStatusBarOverflow(); };
    window.addEventListener('resize', this._onWindowResize);
    this.setupAppearanceControl();
    this._mobileMq = window.matchMedia('(max-width: 640px)');
    this._onMobileMqChange = e => this.setState({ isMobileViewport: e.matches }, () => this.setupAppearanceControl());
    this._mobileMq.addEventListener('change', this._onMobileMqChange);
    if (!window.location.hash && this.state.projectId) {
      history.replaceState(null, '', '#/project/' + encodeURIComponent(this.state.projectId));
    }
    this._onPopState = () => this.resolveDeepLinkFromHash(false);
    window.addEventListener('popstate', this._onPopState);
  }
  // Reads/applies/persists a "system" | "light" | "dark" preference
  // entirely outside this.state -- system is the ABSENCE of the
  // data-appearance attribute (an inline blocking script in <head>
  // already applied it before first paint, so there's no flash to fix
  // here; this just keeps the widget's own UI and the attribute in sync
  // from here on).
  setupAppearanceControl() {
    if (this._onAppearanceOutsideClick) document.removeEventListener('mousedown', this._onAppearanceOutsideClick, true);
    const wrap = document.querySelector('[data-testid="appearance-wrap"]');
    if (!wrap) return; // markup not present (e.g. an older exported copy, or the other viewport tree) -- nothing to wire up
    const btn = wrap.querySelector('[data-testid="btn-appearance"]');
    const menu = wrap.querySelector('[data-testid="appearance-menu"]');
    const footer = wrap.querySelector('[data-testid="appearance-footer"]');
    const options = wrap.querySelectorAll('[data-testid="appearance-option"]');
    const icons = {
      system: wrap.querySelector('[data-testid="appearance-icon-system"]'),
      light: wrap.querySelector('[data-testid="appearance-icon-light"]'),
      dark: wrap.querySelector('[data-testid="appearance-icon-dark"]')
    };
    let mode = 'system';
    try {
      const stored = localStorage.getItem('wigwag.appearance');
      if (stored === 'light' || stored === 'dark') mode = stored;
    } catch (e) {}
    this._appearanceMq = window.matchMedia('(prefers-color-scheme: dark)');
    this._appearanceMenuOpen = false;
    const applyAttribute = () => {
      if (mode === 'dark') document.documentElement.setAttribute('data-appearance', 'dark');
      else if (mode === 'light') document.documentElement.setAttribute('data-appearance', 'light');
      else document.documentElement.removeAttribute('data-appearance');
    };
    const updateUI = () => {
      Object.keys(icons).forEach(k => { icons[k].style.display = k === mode ? '' : 'none'; });
      const resolvedDark = mode === 'dark' || (mode === 'system' && this._appearanceMq.matches);
      const label = mode === 'system'
        ? ('Currently ' + (resolvedDark ? 'dark' : 'light') + ', matching your OS setting.')
        : ('Pinned to ' + mode + ', ignoring your OS setting.');
      const valueLabel = wrap.querySelector('[data-testid="appearance-value-label"]');
      if (valueLabel) valueLabel.textContent = mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark';
      footer.textContent = label;
      btn.title = 'Appearance — ' + label;
      options.forEach(opt => {
        const isActive = opt.getAttribute('data-appearance-id') === mode;
        opt.querySelector('[data-testid="appearance-option-check"]').style.visibility = isActive ? 'visible' : 'hidden';
        opt.style.background = isActive ? 'var(--surface-selected)' : '';
      });
    };
    applyAttribute();
    updateUI();
    this._onAppearanceMqChange = () => updateUI();
    this._appearanceMq.addEventListener('change', this._onAppearanceMqChange);
    this._onAppearanceBtnClick = (e) => {
      e.stopPropagation();
      this._appearanceMenuOpen = !this._appearanceMenuOpen;
      menu.style.display = this._appearanceMenuOpen ? '' : 'none';
    };
    btn.addEventListener('click', this._onAppearanceBtnClick);
    this._onAppearanceOptionClick = (e) => {
      mode = e.currentTarget.getAttribute('data-appearance-id');
      try {
        if (mode === 'light' || mode === 'dark') localStorage.setItem('wigwag.appearance', mode);
        else localStorage.removeItem('wigwag.appearance');
      } catch (e) {}
      applyAttribute();
      updateUI();
      this.closeAppearanceMenu();
    };
    options.forEach(opt => opt.addEventListener('click', this._onAppearanceOptionClick));
    this._onAppearanceOutsideClick = (e) => {
      if (this._appearanceMenuOpen && !wrap.contains(e.target)) this.closeAppearanceMenu();
    };
    document.addEventListener('mousedown', this._onAppearanceOutsideClick, true);
    this._closeAppearanceMenuEl = menu;
  }
  closeAppearanceMenu() {
    this._appearanceMenuOpen = false;
    if (this._closeAppearanceMenuEl) this._closeAppearanceMenuEl.style.display = 'none';
  }
  _onDocSyncMessage(data) {
    if (!data) return;
    if (data.type === 'doc-saved') {
      if (data.projectId === this.state.projectId) {
        this._applyRemoteDocUpdate(data.doc);
      } else {
        this._projectSummaries[data.projectId] = buildProjectSummaryFromDoc(data.doc);
        this.setState({});
      }
    } else if (data.type === 'merge-log-appended' && data.projectId === this.state.projectId) {
      this.setState({ mergeLog: data.log });
    } else if (data.type === 'refresh-job-updated') {
      this.setState(s => {
        const next = { ...s.refreshJobs };
        if (data.job) next[data.projectId] = data.job; else delete next[data.projectId];
        return { refreshJobs: next };
      });
    } else if (data.type === 'doc-deleted' && data.projectId !== this.state.projectId) {
      delete this._projectSummaries[data.projectId];
      this.setState({});
    }
    // A doc-deleted for THIS tab's own active project is a no-op here --
    // that edge case (watching your own active project get deleted out
    // from under you by another tab) is pre-existing and unaddressed,
    // no worse than before this phase.
  }
  _applyRemoteDocUpdate(doc) {
    try {
      if (!doc) return;
      const newTimestampFieldIds = ['created', 'updated'].filter(tid => !(doc.fieldDefs && doc.fieldDefs[tid]));
      const hydratedProject = hydrateProject(doc.fieldDefs, doc.projectHistory || [], doc.projectNotes || '');
      const hydratedIssues = doc.issues.map(iss => hydrateIssue(iss, hydratedProject.fieldDefs));
      this._docIssuesBaseline[this.state.projectId] = JSON.stringify(doc.issues || []);
      this._lastDocSyncJson[this.state.projectId] = JSON.stringify(doc);
      this._projectSummaries[this.state.projectId] = buildProjectSummaryFromDoc(doc);
      const storedHiddenFieldIds2 = this.hiddenFieldIdsFor(this.state.projectId) || [];
      const hiddenFieldIds2 = [...storedHiddenFieldIds2, ...newTimestampFieldIds.filter(tid => !storedHiddenFieldIds2.includes(tid))];
      const activeProjectId = this.state.projectId;
      this.setState({
        fieldDefs: hydratedProject.fieldDefs, projectHistory: hydratedProject.projectHistory, issues: hydratedIssues, hiddenFieldIds: hiddenFieldIds2,
        columnOrder: reconcileColumnOrder(this.columnOrderFor(this.state.projectId), hydratedProject.fieldDefs, hiddenFieldIds2),
        projects: this.state.projects.map(m => m.id === activeProjectId && hydratedProject.projectName && hydratedProject.projectName !== m.name ? { ...m, name: hydratedProject.projectName } : m),
        projectNotes: hydratedProject.projectNotes != null ? hydratedProject.projectNotes : (doc.projectNotes || this.state.projectNotes)
      });
      this.checkForNewMentions(hydratedIssues);
      this.checkForSubscribedIssueUpdates(hydratedIssues);
    } catch (err) { console.warn('[tracker] failed to apply a remote doc update:', err); }
  }
  componentWillUnmount() {
    document.removeEventListener('click', this._onExternalLinkClick, true);
    document.removeEventListener('mousedown', this._onOutsideMouseDown, true);
    document.removeEventListener('keydown', this._onGlobalKeyDown);
    window.removeEventListener('message', this._onGithubOAuthMessage);
    window.removeEventListener('storage', this._onStorageEvent);
    if (this._docSyncChannel) this._docSyncChannel.close();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.removeEventListener('resize', this._onWindowResize);
    clearInterval(this._githubPollTimer);
    if (this._appearanceMq) this._appearanceMq.removeEventListener('change', this._onAppearanceMqChange);
    document.removeEventListener('mousedown', this._onAppearanceOutsideClick, true);
    if (this._mobileMq) this._mobileMq.removeEventListener('change', this._onMobileMqChange);
    window.removeEventListener('popstate', this._onPopState);
  }
  // Popup, not a full-page redirect -- this app can carry unsaved local
  // edits, and a popup that posts a message back and self-closes leaves the
  // main tab's own state untouched. GitHub Apps reuse the same
  // authorize/callback shape as classic OAuth Apps (permissions are
  // configured on the App itself, not via a scope param).
  signInWithGithub() {
    const clientId = (this.state.githubOAuthClientId || '').trim();
    const proxyUrl = (this.state.githubOAuthProxyUrl || 'http://localhost:8935').trim().replace(/\/$/, '');
    if (!clientId) { this.setState({ githubSyncError: 'Set an OAuth Client ID in Settings first.' }); return; }
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this._githubOAuthState = state;
    this._githubOAuthExpectedOrigin = new URL(proxyUrl).origin;
    const redirectUri = proxyUrl + '/callback';
    const authUrl = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(clientId) + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + encodeURIComponent(state);
    window.open(authUrl, 'github-oauth', 'width=600,height=700');
  }
  // Lazily generates a per-browser ECDSA keypair the first time the app
  // runs with none saved yet. The private key never leaves localStorage
  // (persisted via persistSecrets, same as the GitHub token); the public
  // key travels on every signed history entry so it can be verified later.
  async ensureIdentity() {
    const activeId = this.state.activeIdentityId;
    const active = this.state.identities.find(i => i.id === activeId);
    if (active && active.signingPublicKeyJwk && active.signingPrivateKeyJwk) return;
    try {
      const keyPair = await crypto.subtle.generateKey(SIGN_ALG, true, ['sign', 'verify']);
      const [publicKeyJwk, privateKeyJwk] = await Promise.all([
        crypto.subtle.exportKey('jwk', keyPair.publicKey),
        crypto.subtle.exportKey('jwk', keyPair.privateKey)
      ]);
      // Bail if the user switched identity again while this was in flight --
      // don't stamp a freshly generated key onto whatever is active NOW.
      if (this.state.activeIdentityId !== activeId) return;
      this.setState(s => ({
        identityPublicKeyJwk: publicKeyJwk, identityPrivateKeyJwk: privateKeyJwk,
        identities: s.identities.map(i => i.id === activeId ? Object.assign({}, i, { signingPublicKeyJwk: publicKeyJwk, signingPrivateKeyJwk: privateKeyJwk }) : i)
      }));
    } catch (e) { console.warn('[tracker] failed to generate identity keypair:', e); }
  }
  async getSigningKey() {
    if (this._signingKey) return this._signingKey;
    const jwk = this.state.identityPrivateKeyJwk;
    if (!jwk) return null;
    this._signingKey = await importSigningKey(jwk);
    return this._signingKey;
  }
  async signPayload(payloadStr) {
    const key = await this.getSigningKey();
    return signWithKey(key, payloadStr);
  }
  // The one display name derived from identity: the local-part of the
  // configured email (before @), or "anonymous" until an email is set.
  // No separate editable display name exists any more -- set your email
  // once (Settings, or the header shortcut) and it drives both signing
  // and attribution everywhere.
  displayName() {
    return this.state.identityEmail || 'anonymous';
  }
  // The single funnel every history-append call site goes through (see
  // commitEdit/selectOption/toggleMultiOption/applyGithubLinkToField/
  // applyConnectorLinkToField/addIssue/applyLinkedRules). Appends immediately,
  // unsigned, so callers stay synchronous with no control-flow changes —
  // the signature is computed in the background and patched in once ready
  // (milliseconds later; nothing meaningful reads sig before an export
  // would ever happen). origin defaults to 'authored'; applyLinkedRules
  // passes 'derived' explicitly for rule-computed field changes.
  // A stable identity for a history/comment entry for union-dedup
  // purposes. Real entries (everything appended via appendSignedHistory
  // since this pass) always have an id; the original seed data's history
  // predates ids, so those fall back to a composite of their other fields
  // — stable enough to dedupe on, since two independently-authored entries
  // are exceedingly unlikely to collide on sortKey+actor+field+text.
  // Resolves a history entry's field-change text into {before, label,
  // emoji, bg, fg, after} for pill rendering, or null if it isn't a
  // select/multiselect change (or the option can't be resolved -- e.g.
  // the field's type changed since, or the value was cleared).
  // Finds the field label's own span within a history entry's narrative
  // text, if it's actually present in it (not every entry mentions the
  // label in exactly this form -- e.g. a fetch-failure message might not),
  // so the Activity feed can render it in a visually distinct weight from
  // the surrounding sentence.
  buildActivityFieldLabel(h, fieldDefs) {
    if (!h.field || h.text === undefined) return null;
    const def = fieldDefs[h.field];
    const label = def && def.label;
    if (!label) return null;
    const idx = h.text.indexOf(label);
    if (idx === -1) return null;
    return { before: h.text.slice(0, idx), label, after: h.text.slice(idx + label.length) };
  }
  buildActivityPill(h, fieldDefs) {
    if (!h.field || h.text === undefined) return null;
    const def = fieldDefs[h.field];
    if (!def) return null;
    if (def.type === 'select') {
      const opt = (def.options || []).find(o => o.id === h.value);
      if (!opt) return null;
      const idx = h.text.indexOf(opt.label);
      if (idx === -1) return null;
      return { before: h.text.slice(0, idx), label: opt.label, emoji: opt.emoji || '', bg: col(opt.color).bg, fg: col(opt.color).fg, after: h.text.slice(idx + opt.label.length) };
    }
    if (def.type === 'multiselect') {
      for (const opt of (def.options || [])) {
        const idx = h.text.indexOf(opt.label);
        if (idx !== -1 && idx + opt.label.length === h.text.length) {
          return { before: h.text.slice(0, idx), label: opt.label, emoji: '', bg: col(opt.color).bg, fg: col(opt.color).fg, after: '' };
        }
      }
    }
    return null;
  }
  // Shared entry point for the file-based and paste-based "Import
  // project" flows. If the file references a project id that already
  // exists locally, treat it as an update to that project (after
  // confirming) instead of silently forking a same-name duplicate under
  // a fresh random id.
  handleImportParsed(parsed, suggestedName) {
    if (!parsed.fields && !parsed.issues.length) { window.alert('Could not read that as a tracker export.'); return; }
    const match = parsed.projectId ? this.state.projects.find(m => m.id === parsed.projectId) : null;
    if (match) {
      this.confirmAction('This file is for the project "' + match.name + '", which you already have. Importing it will apply it as an update to that project instead of creating a new one. Continue?', () => {
        if (match.id === this.state.projectId) this.startMerge(parsed);
        else this.switchProject(match.id, () => this.startMerge(parsed));
      }, 'Continue');
      return;
    }
    this.importParsedAsNewProject(parsed, suggestedName);
  }
  // Always creates a NEW project rather than touching the current one --
  // called only once handleImportParsed has confirmed the incoming file
  // does not match a project we already have.
  async importParsedAsNewProject(parsed, suggestedName) {
    if (!parsed.fields && !parsed.issues.length) { window.alert('Could not read that as a tracker export.'); return; }
    const takenIds = new Set(this.state.projects.map(m => m.id));
    const id = (parsed.projectId && !takenIds.has(parsed.projectId)) ? parsed.projectId : crypto.randomUUID();
    const name = parsed.projectName || suggestedName || 'Imported project';
    const importedProjectHistory = parsed.projectHistory || [];
    const nameEntry = deriveProjectName(importedProjectHistory) ? null : this.buildUnsignedProjectNameEntry(name);
    const doc = {
      fieldDefs: parsed.fields || defaultFieldDefs(),
      projectHistory: nameEntry ? importedProjectHistory.concat([nameEntry]) : importedProjectHistory,
      issues: parsed.issues.map(iss => ({
        id: iss.id, num: iss.num,
        fieldRefs: iss.fieldRefs || {}, fieldLoading: {},
        values: iss.values || {}, commentStreams: iss.commentStreams || {}, history: iss.history || []
      })),
      columnOrder: defaultColumnOrder(),
      hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: '',
      projectNotes: parsed.projectNotes || '', projectComments: parsed.projectComments || []
    };
    await docStore.putDoc(id, doc);
    this.state.projects = this.state.projects.concat([{ id, name, identityId: null }]);
    this.switchProject(id, () => { if (nameEntry) this.signInsertedProjectHistoryEntry(id, nameEntry); });
  }
  // Orchestrates a full merge: pairs up issues present on both sides,
  // brings in issues that only exist in the incoming file (tagged with an
  // unsigned system note, per plan — nobody "authored" the union itself),
  // and leaves local-only issues untouched. Always applies immediately --
  // nothing blocks on a human decision; overlappingFields (see
  // mergeIssuePair) becomes a lightweight, dismissible per-row notice
  // instead of a modal, since the union+re-derive already resolved
  // everything and nothing is ever silently lost (a losing edit is still
  // right there in that field's own history).
  // Applies immediately -- used by call sites with no real export
  // envelope/signature to gate on in the first place (GitHub sync, and
  // the Connect Remote first-pull), where the union+re-derive already
  // resolves everything and nothing is ever silently lost (a losing edit
  // is still right there in that field's own history). Apply Update's
  // own file/paste path goes through previewMerge/confirmPendingMerge
  // instead (tracker #124, 5c3051e9) -- see the comment there for why.
  startMerge(parsed, inboundInfo) {
    if (parsed.projectId && parsed.projectId !== this.state.projectId) {
      console.warn('[tracker] startMerge: refusing to merge -- parsed.projectId does not match the active project', parsed.projectId, this.state.projectId);
      return;
    }
    const computed = computeIssueMerge(this.state.issues, parsed.issues, this.state.fieldDefs, inboundInfo);
    this.applyComputedMerge(parsed, computed, inboundInfo);
  }
  // The apply half of a merge, shared by the immediate (startMerge) and
  // gated (confirmPendingMerge) paths: lands the union'd issues/fields,
  // then signs+appends one new entry per prose field that needed a real
  // diff3 merge (fired after applyMergedIssues so the union'd history
  // this builds on top of has already landed), patching each entry's
  // real id into the merge-log summary as it's created -- appendSignedHistory
  // returns the real entry synchronously even though signing itself
  // resolves async -- before finally recording the merge log.
  applyComputedMerge(parsed, computed, inboundInfo) {
    const { mergedIssues, notices, proseMergeEntries, mergeIssueSummaries, notesMergeEntries, notesChanged } = computed;
    const beforeEntryIdsByIssue = {};
    mergedIssues.forEach(iss => { beforeEntryIdsByIssue[iss.id] = latestEntryIdsByField(iss); });
    const fieldsMerge = computeFieldDefsMerge(this.state.projectHistory, parsed.fields, parsed.projectHistory);
    this.applyMergedIssues(mergedIssues, fieldsMerge ? fieldsMerge.mergedFieldDefs : null, fieldsMerge ? fieldsMerge.mergedProjectHistory : null, notices, parsed);
    if (notesChanged) {
      for (const entry of (notesMergeEntries || [])) {
        this.appendProjectHistory({ text: entry.text, field: PROJECT_NOTES_FIELD_ID, value: entry.value });
      }
      if (!notesMergeEntries.length) {
        // A real, non-conflicting change (incoming had Notes content the
        // local copy never saw) -- derive it for real from the
        // just-unioned history instead of applyMergedIssues' own crude
        // "fill if currently empty" guess above.
        this.setState(s => ({ projectNotes: deriveProjectNotes(s.projectHistory) ?? s.projectNotes }));
      }
    }
    let summaries = mergeIssueSummaries;
    for (const issueId in (proseMergeEntries || {})) {
      for (const entry of proseMergeEntries[issueId]) {
        const result = this.appendSignedHistory(issueId, { text: entry.text, field: entry.colId, value: entry.value, fieldRef: entry.fieldRef, origin: entry.origin });
        summaries = patchMergeSummaryResultEntryId(summaries, issueId, entry.colId, result.id);
      }
    }
    // Tracker #196: fold in derived/bound-field fallout, same before/after
    // diff refreshes use -- nothing else currently tracks it anywhere
    // revertible, including for a prose/notes-only merge that never
    // touched mergeIssueSummaries at all.
    const summariesByIssueId = {};
    (summaries || []).forEach(s => { summariesByIssueId[s.id] = s; });
    mergedIssues.forEach(iss => {
      const afterIssue = this.findIssue(iss.id);
      if (!afterIssue) return;
      const beforeIds = beforeEntryIdsByIssue[iss.id] || {};
      const afterIds = latestEntryIdsByField(afterIssue);
      const existing = summariesByIssueId[iss.id];
      const explicitFields = new Set(existing ? existing.fields.map(f => f.field) : []);
      const derivedExtra = [];
      for (const f in afterIds) {
        if (explicitFields.has(f)) continue;
        if (afterIds[f] !== beforeIds[f]) derivedExtra.push({ field: f, preMergeLocalEntryId: beforeIds[f] || null, resultEntryId: afterIds[f] });
      }
      if (!derivedExtra.length) return;
      if (existing) existing.fields = [...existing.fields, ...derivedExtra];
      else { summariesByIssueId[iss.id] = { id: iss.id, fields: derivedExtra }; summaries = [...(summaries || []), summariesByIssueId[iss.id]]; }
    });
    if (summaries && summaries.length) this.recordMergeLog(inboundInfo, summaries);
  }
  // Apply Update's own pre-merge gate (tracker #124, 5c3051e9, merge_provenance.zip
  // handoff): computes the merge but does NOT apply it -- stashes the
  // result as pendingMerge so the ingest provenance card (merge-card) can
  // show real per-issue/per-field detail before a human decides. Per
  // Tom's own call: nothing here is ever a per-field choice -- "Merge
  // update" (confirmPendingMerge) applies the WHOLE computed result,
  // "Not now" (cancelPendingMerge) discards it entirely, with zero side
  // effects either way until a decision is made.
  previewMerge(parsed, inboundInfo) {
    if (parsed.projectId && parsed.projectId !== this.state.projectId) {
      console.warn('[tracker] previewMerge: refusing to merge -- parsed.projectId does not match the active project', parsed.projectId, this.state.projectId);
      return;
    }
    const computed = computeIssueMerge(this.state.issues, parsed.issues, this.state.fieldDefs, inboundInfo);
    const localProjectHistory = this.state.projectHistory;
    const incomingProjectHistory = parsed.projectHistory || [];
    const notesMergeEntries = computeMergeProseEntries(
      { history: localProjectHistory },
      { history: incomingProjectHistory },
      { [PROJECT_NOTES_FIELD_ID]: { type: 'text', label: 'Notes' } },
      inboundInfo
    );
    const localNotesKeys = new Set(localProjectHistory.filter(h => h.field === PROJECT_NOTES_FIELD_ID).map(h => entryKey(h)));
    const notesChanged = notesMergeEntries.length > 0 || incomingProjectHistory.some(h => h.field === PROJECT_NOTES_FIELD_ID && !localNotesKeys.has(entryKey(h)));
    const localCommentKeys = new Set((this.state.projectComments || []).map(c => commentKey(c)));
    const commentsChanged = ((parsed.projectComments) || []).some(c => !localCommentKeys.has(commentKey(c)));
    this.setState({ pendingMerge: { parsed, inboundInfo: inboundInfo || null, computed: { ...computed, notesMergeEntries, notesChanged, commentsChanged } } });
  }
  // A refresh-sourced pendingMerge (inboundInfo.kind === 'refresh') has a
  // matching entry in state.refreshJobs this project's own id -- once
  // the user has actually decided (confirm or cancel), that job is done
  // and must be cleared, or switchProject's own "surface an unreviewed
  // job" logic and the header chip's job count both keep treating it as
  // still outstanding forever. Broadcast afterward so another tab
  // watching the same job's chip clears it too (mirrors stageRefreshJob's
  // own broadcast-after-setState pattern).
  clearRefreshJobFor(pending) {
    if (!pending || !pending.inboundInfo || pending.inboundInfo.kind !== 'refresh') return null;
    const projectId = this.state.projectId;
    this.setState(s => {
      if (!s.refreshJobs[projectId]) return null;
      const refreshJobs = { ...s.refreshJobs };
      delete refreshJobs[projectId];
      return { refreshJobs };
    });
    return projectId;
  }
  confirmPendingMerge() {
    const pending = this.state.pendingMerge;
    if (!pending) return;
    // "Merge update" is only cosmetically disabled (cursor:not-allowed)
    // when there's genuinely nothing to merge -- guard for real here too,
    // same as onConfirmDeleteProject's own name-match check.
    if (!mergeHasRealChanges(this.state.issues, pending.computed)) return;
    const clearedJobProjectId = this.clearRefreshJobFor(pending);
    this.setState({ pendingMerge: null, gateOpenTimelineIssueId: null });
    if (clearedJobProjectId) this.broadcastRefreshJob(clearedJobProjectId);
    this.applyComputedMerge(pending.parsed, pending.computed, pending.inboundInfo);
  }
  cancelPendingMerge() {
    const clearedJobProjectId = this.clearRefreshJobFor(this.state.pendingMerge);
    this.setState({ pendingMerge: null, gateOpenTimelineIssueId: null });
    if (clearedJobProjectId) this.broadcastRefreshJob(clearedJobProjectId);
  }
  // "Back out this update" (tracker #196): reverts a past merge-log
  // record -- real merge or refresh alike -- by DELETING the entries it
  // introduced, not appending a corrective entry. Safe unconditionally,
  // no per-field "has this changed since" gate: removing a non-latest
  // entry (superseded by a later, independent edit) is inert on current
  // derived state by construction, since deriveIssueValues' latest-
  // sortKey-wins scan was never going to pick it anyway -- there's no
  // failure mode left for a gate to prevent. Safe specifically because
  // mergeLog itself is local-only and never exported (see docs/FORMAT.md
  // and tests/merge-provenance.spec.js) -- this was never a shared fact
  // for a replay/merge elsewhere to get confused by its absence.
  // fieldStillSafeToRevert/computeMergeRollbackEntries are left in place,
  // unused by this path (nothing here depends on them).
  rollbackMerge(mergeId) {
    const record = (this.state.mergeLog || []).find(r => r.id === mergeId);
    if (!record || record.revertedAt) return;
    this.setState(s => ({
      issues: s.issues.map(iss => {
        const issueSummary = (record.issues || []).find(x => x.id === iss.id);
        if (!issueSummary) return iss;
        const deleteIds = new Set((issueSummary.fields || []).map(f => f.resultEntryId).filter(Boolean));
        if (!deleteIds.size) return iss;
        const withHistory = { ...iss, history: iss.history.filter(h => !deleteIds.has(h.id)) };
        return { ...withHistory, values: deriveIssueValues(withHistory, s.fieldDefs), fieldRefs: deriveIssueFieldRefs(withHistory, s.fieldDefs), deleted: issueIsDeleted(withHistory.history) };
      })
    }));
    const projectId = this.state.projectId;
    this.readMergeLog(projectId).then(log => {
      log = log.map(r => r.id === mergeId ? { ...r, revertedAt: new Date().toISOString() } : r);
      return docStore.putMergeLog(this.storagePrefKey(projectId), log).then(() => {
        this.setState({ mergeLog: log });
        if (!ROOM_MODE_CAPABILITIES) this._docSyncChannel.postMessage({ type: 'merge-log-appended', projectId, log });
      });
    }).catch(e => console.warn('[tracker] failed to save merge log after revert:', e));
  }
  // The state glyph + tint for Level 1's provenance line (README §3):
  // a 16px glyph in a tinted rounded square -- signed green, unsigned
  // neutral, changed/damaged amber (the handoff's own §1.4: "two failure
  // modes fold into changed's visual treatment"). Reuses the SAME
  // green/amber CSS tokens the RAG field's own On track/At risk options
  // already use elsewhere in the product, not raw values lifted from the
  // mockup -- this app's colors, not the prototype's.
  sigGlyphFor(sigState) {
    if (sigState === 'signed') return { glyph: '✓', bg: 'var(--c32)', ink: 'var(--c33)' };
    if (sigState === 'changed' || sigState === 'damaged') return { glyph: '!', bg: 'var(--c29)', ink: 'var(--c30)' };
    return { glyph: '○', bg: 'var(--surface-selected)', ink: 'var(--text-secondary)' };
  }
  // Shared per-field row view, used by BOTH the ingest gate and Merge
  // History (README §5: "the same component... only the language
  // differs") -- settled-value pill, origin note, and (for a prose field)
  // the real tinted inline diff lines, styled here once rather than
  // duplicated in two render paths.
  buildMergeFieldRowView(f) {
    const DIFF_TINT = {
      context: { bg: 'transparent', ink: 'var(--text-secondary)', sign: '' },
      local: { bg: 'var(--c32)', ink: 'var(--c33)', sign: '+' },
      inbound: { bg: 'var(--c20)', ink: 'var(--c3)', sign: '+' },
      marker: { bg: 'var(--c29)', ink: 'var(--c30)', sign: '!' }
    };
    const diffLines = (f.diffLines || []).map((l, i) => {
      const t = DIFF_TINT[l.kind] || DIFF_TINT.context;
      return { n: i + 1, text: l.text, bg: t.bg, ink: t.ink, sign: t.sign, weight: l.kind === 'marker' ? '700' : '400' };
    });
    return {
      field: f.field, label: f.label, markers: f.markers || 0,
      editCount: f.editCount, editCountLabel: f.editCount === 1 ? '1 edit' : f.editCount + ' edits',
      origin: f.origin || '',
      isProse: !!f.isProse,
      settledText: f.settledText || '', settledIsPill: !!f.settledIsPill,
      settledPillBg: f.settledPillBg, settledPillFg: f.settledPillFg,
      showPlainSettled: !f.isProse && !f.settledIsPill,
      hasDiffLines: diffLines.length > 0, diffLines
    };
  }
  // Level 3, shared by the gate and Merge History (README §5: "the same
  // component... only the language differs"). Per-issue (not per-field --
  // "Show the timeline" combines every field the merge touched into one
  // down-is-time, across-is-the-copy view, README §3). Resolves each
  // event's value/prevValue through resolveFieldValueView so a select
  // field's own opaque option id never leaks into the timeline the way
  // it does in raw history -- this is the same resolution the settled-
  // value column already gets.
  buildMergeTimelineView(issue, fields, isOpen, onToggle) {
    const s = this.state;
    const rawEdits = (fields || []).reduce((n, f) => n + (f.value !== undefined ? 1 : ((f.localEntryIds || []).length + (f.incomingEntryIds || []).length)), 0);
    const events = (isOpen && issue) ? buildMergeIssueTimeline(issue, fields || []).map(e => {
      const def = s.fieldDefs[e.field] || {};
      const isProse = def.type === 'text';
      const valView = isProse ? { text: truncate(e.value === undefined || e.value === null ? '' : String(e.value), 70), isPill: false } : resolveFieldValueView(def, e.value);
      const hasPrev = e.prevValue !== null && e.prevValue !== undefined;
      const prevView = !hasPrev ? null : (isProse ? { text: truncate(String(e.prevValue), 70), isPill: false } : resolveFieldValueView(def, e.prevValue));
      // sortKey is only a genuine epoch ms timestamp for entries the real
      // app itself created (advanceSortKey is always Date.now()-based) --
      // a legacy/backfilled entry predating that convention can carry a
      // small non-epoch sortKey, which relativeAge would otherwise render
      // as a nonsense "Nd ago". Guard: only trust it past year 2000
      // (946684800000ms); fall back to the entry's own real time string
      // otherwise, for both the shown label and the hover tooltip.
      const hasRealSortKey = !!(e.sortKey && e.sortKey > 946684800000);
      return {
        isLocal: e.side === 'local', isInbound: e.side !== 'local',
        sideAttr: e.side === 'local' ? 'local' : 'inbound',
        timeAgo: hasRealSortKey ? relativeAge(e.sortKey) : (e.time || ''),
        fullTime: hasRealSortKey ? formatDateLabel(new Date(e.sortKey)) : (e.time || ''),
        actor: e.actor,
        fieldLabel: def.label || e.field,
        valueText: valView.text, valueIsPill: valView.isPill, valueBg: valView.bg, valueFg: valView.fg,
        hasPrev, prevText: hasPrev ? prevView.text : '', prevIsPill: hasPrev ? prevView.isPill : false, prevBg: hasPrev ? prevView.bg : null, prevFg: hasPrev ? prevView.fg : null
      };
    }) : [];
    return {
      open: isOpen,
      chev: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
      toggleLabel: isOpen ? 'Hide the timeline' : ('Show the timeline — ' + rawEdits + (rawEdits === 1 ? ' edit' : ' edits') + ' across both copies'),
      onToggle,
      diverged: events.length ? ('both copies matched until ' + events[0].timeAgo) : '',
      events
    };
  }
  // Merge History project-panel section's own render-ready view model
  // (tracker #124, 5c3051e9, Level 3): most-recent-first, expandable per
  // record (mergeReviewId) into its real per-field breakdown, each field
  // further expandable (mergeReviewTimelineIssueId) into its two-lane
  // timeline (buildMergeFieldTimeline). computeMergeRollbackEntries is
  // only run for the expanded record -- cheap, but no reason to run it
  // for rows nobody's looking at.
  buildMergeGateViewModel(s) {
    if (!s.pendingMerge) return null;
    const vm = buildMergePreviewViewModel(s.pendingMerge.computed, s.pendingMerge.inboundInfo, s.fieldDefs);
    const glyph = this.sigGlyphFor(vm.sigState);
    const headlines = {
      signed: 'Signed by ' + (vm.exportedBy || 'unknown sender'),
      unsigned: 'Unsigned' + (vm.exportedBy ? (' · exported by ' + vm.exportedBy) : ' update'),
      changed: 'Signed by ' + (vm.exportedBy || 'this sender') + ' with a key you have not seen',
      damaged: 'Signature check failed'
    };
    const detailParts = [];
    if (vm.exportedAt) detailParts.push('exported ' + formatDateLabel(vm.exportedAt));
    if (vm.reason) detailParts.push(vm.reason);
    const envelope = s.pendingMerge.inboundInfo && s.pendingMerge.inboundInfo.envelope;
    const hasRealChanges = mergeHasRealChanges(s.issues, s.pendingMerge.computed);
    return {
      sigState: vm.sigState,
      sigGlyph: glyph.glyph, sigGlyphBg: glyph.bg, sigGlyphInk: glyph.ink,
      provenanceHeadline: headlines[vm.sigState] || headlines.unsigned,
      provenanceDetail: detailParts.join(' · '),
      hasEnvelope: !!envelope,
      recordsCount: vm.recordsCount,
      contentSha256Short: vm.contentSha256 ? vm.contentSha256.slice(0, 12) : '',
      showKeyStrip: vm.sigState === 'changed',
      keyFingerprintShort: vm.fingerprint ? vm.fingerprint.slice(0, 20) : '',
      lede: 'The file says who exported it and when, and the hash covers every record after the envelope. That identity is what the conflict markers below are named after — a marker read in six months still says which update carried the text in.',
      onTrustKey: () => {
        if (!vm.fingerprint || !vm.exportedBy || !envelope || !envelope.sig) return;
        const updated = rememberSenderTrust(this.state.exportTrustStore, vm.exportedBy, vm.fingerprint, envelope.sig.pubKeyJwk, new Date().toISOString());
        this.setState({ exportTrustStore: updated });
        try { localStorage.setItem(EXPORT_TRUST_KEY, JSON.stringify(updated)); } catch (e) {}
      },
      onKeepKey: () => {},
      // vm.issues only ever contains an entry for an issue that had a
      // touched FIELD or prose entry -- it misses a brand-new issue or a
      // comment-only change, neither of which populate mergeIssueSummaries
      // (see mergeHasRealChanges's own comment in wigwag-core.js), so the
      // real "is there anything to land at all" check has to go through
      // that helper rather than vm.issues.length alone.
      hasNoChanges: !hasRealChanges,
      issues: vm.issues.map(iss => {
        const mergedIssue = (s.pendingMerge.computed.mergedIssues || []).find(mi => mi.id === iss.issueId);
        const rawSummary = (s.pendingMerge.computed.mergeIssueSummaries || []).find(sm => sm.id === iss.issueId);
        const timelineOpen = s.gateOpenTimelineIssueId === iss.issueId;
        return {
          issueId: iss.issueId, shortId: String(iss.issueId).slice(0, 8), title: iss.title,
          fields: iss.fields.map(f => this.buildMergeFieldRowView(f)),
          // Needs the RAW summary field rows (localEntryIds/incomingEntryIds),
          // not vm.issues' own already-transformed render fields, which drop
          // those ids once turned into settledText/diffLines.
          timeline: this.buildMergeTimelineView(mergedIssue, rawSummary ? rawSummary.fields : [], timelineOpen, () => this.setState(st => ({ gateOpenTimelineIssueId: st.gateOpenTimelineIssueId === iss.issueId ? null : iss.issueId })))
        };
      }),
      primaryBg: hasRealChanges ? 'var(--accent-fill)' : 'var(--n28)',
      primaryHoverBg: hasRealChanges ? 'var(--c22)' : 'var(--n28)',
      primaryCursor: hasRealChanges ? 'pointer' : 'not-allowed',
      onConfirm: () => this.confirmPendingMerge(),
      onCancel: () => this.cancelPendingMerge()
    };
  }
  buildMergeHistoryViewModel(issuesByIdForMerge) {
    const s = this.state;
    const records = (s.mergeLog || []).slice().reverse().map(record => {
      const isExpanded = s.mergeReviewId === record.id;
      const rollbackPreview = isExpanded ? computeMergeRollbackEntries(record, issuesByIdForMerge, s.fieldDefs) : [];
      const revertableCount = rollbackPreview.filter(r => !r.skipped).length;
      const skippedCount = rollbackPreview.filter(r => r.skipped).length;
      const sigState = (record.source && record.source.sig_state) || 'unsigned';
      const glyph = this.sigGlyphFor(sigState);
      const isRefresh = !!(record.source && record.source.kind === 'refresh');
      const exportedBy = isRefresh ? ('Refreshed ' + (record.issues || []).reduce((n, s) => n + (s.fields || []).length, 0) + ' linked field(s)') : ((record.source && record.source.exported_by) || 'this browser');
      return {
        id: record.id,
        exportedBy,
        isRefresh,
        ingestedAtLabel: record.ingested_at ? formatDateLabel(record.ingested_at) : '',
        sigState,
        sigGlyph: glyph.glyph, sigGlyphBg: glyph.bg, sigGlyphInk: glyph.ink,
        hasEnvelope: !!record.source,
        recordsCount: record.source ? record.source.records : null,
        contentSha256Short: (record.source && record.source.content_sha256) ? record.source.content_sha256.slice(0, 12) : '',
        issueCount: (record.issues || []).length,
        needsAttention: mergeRecordNeedsAttention(record, issuesByIdForMerge),
        isExpanded,
        onToggle: () => this.setState(st => ({ mergeReviewId: st.mergeReviewId === record.id ? null : record.id, mergeReviewTimelineIssueId: null })),
        issues: !isExpanded ? [] : (record.issues || []).map(issueSummary => {
          const issue = issuesByIdForMerge[issueSummary.id];
          const title = (issue && issue.values && issue.values.title) || '(deleted issue)';
          const timelineOpen = s.mergeReviewTimelineIssueId === (record.id + ':' + issueSummary.id);
          const fields = issueSummary.fields.map(f => {
            const def = s.fieldDefs[f.field] || {};
            const isProse = f.outcome === 'merged' || f.outcome === 'merged-with-markers';
            const diff = (isProse && issue) ? buildMergeFieldDiffLines(issue, f, record.source || {}) : null;
            const settled = (!isProse && issue) ? mergeSettledValueView(issue, f.field, def) : null;
            return this.buildMergeFieldRowView({
              field: f.field, label: def.label || f.field, markers: f.markers || 0,
              editCount: (f.localEntryIds || []).length + (f.incomingEntryIds || []).length,
              origin: isProse ? '' : (f.outcome === 'newest-edit-wins' ? 'newest edit wins' : 'one copy only'),
              isProse,
              settledText: settled ? settled.text : '', settledIsPill: settled ? settled.isPill : false,
              settledPillBg: settled ? settled.bg : null, settledPillFg: settled ? settled.fg : null,
              diffLines: diff ? diff.lines : []
            });
          });
          const timelineKey = record.id + ':' + issueSummary.id;
          return {
            issueId: issueSummary.id, shortId: String(issueSummary.id).slice(0, 8), title, fields,
            timeline: this.buildMergeTimelineView(issue, issueSummary.fields, timelineOpen, () => this.setState(st => ({ mergeReviewTimelineIssueId: st.mergeReviewTimelineIssueId === timelineKey ? null : timelineKey })))
          };
        }),
        revertableCount, skippedCount,
        canRevert: isExpanded && !record.revertedAt && (record.issues || []).some(x => (x.fields || []).length),
        isReverted: !!record.revertedAt,
        onRollback: () => {
          this.confirmAction('Back out this update? This deletes the entries it introduced. Anything that hasn\'t changed since falls back to its prior value; anything edited again since is left untouched.', () => this.rollbackMerge(record.id), 'Back out');
        }
      };
    });
    return { records, isEmpty: records.length === 0 };
  }
  // Local-only merge log (README §2.3/§4) -- NEVER exported (see
  // buildSourceText/the export-envelope section of docs/FORMAT.md,
  // neither of which this record type ever passes through). Stored per
  // project, capped to the most recent 200 entries so it can't grow
  // unbounded across a long-lived project's lifetime.
  recordMergeLog(inboundInfo, issues) {
    const info = inboundInfo || {};
    const envelope = info.envelope || null;
    // A refresh carries a real envelope too (tracker #196 follow-up) --
    // self-signed by this identity's own key over just this operation's
    // own delta, not the whole project. Same envelope-shaped fields
    // either way; kind:'refresh' is the only thing that distinguishes
    // it from a real cross-identity merge's source.
    const source = envelope ? {
      exported_by: envelope.exported_by, exported_at: envelope.exported_at,
      project: envelope.project, records: envelope.records, content_sha256: envelope.content_sha256,
      sig_state: info.provenance ? info.provenance.sigState : 'unsigned', keyid: info.fingerprint || null,
      ...(info.kind === 'refresh' ? { kind: 'refresh' } : {})
    } : null;
    const record = buildMergeRecord({
      id: 'mrg_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)),
      ingestedAt: new Date().toISOString(),
      ingestedBy: this.state.identityEmail || '',
      source,
      issues
    });
    const projectId = this.state.projectId;
    this.readMergeLog(projectId).then(log => {
      log = [...log, record];
      if (log.length > 200) log = log.slice(log.length - 200);
      return docStore.putMergeLog(this.storagePrefKey(projectId), log).then(() => {
        this.setState({ mergeLog: log });
        if (!ROOM_MODE_CAPABILITIES) this._docSyncChannel.postMessage({ type: 'merge-log-appended', projectId, log });
      });
    }).catch(e => console.warn('[tracker] failed to save merge log:', e));
  }
  // Shared entry point for the file-based and paste-based "Apply update"
  // flows. An update is only ever applied to the project it's actually
  // for -- never force-merged into whatever's currently open. A file for
  // a DIFFERENT project you already have switches you there and applies
  // it (the "update the right project" path); a file matching no project
  // you have offers to bring it in as a new one instead (mirrors "Import
  // project from file…"'s own handling, reusing importParsedAsNewProject
  // directly). Declining either leaves the currently open project
  // untouched -- there is no remaining path that merges an update into
  // the wrong project.
  handleApplyUpdateParsed(parsed, suggestedName, inboundInfo) {
    if (!parsed.fields && !parsed.issues.length) { window.alert('Could not read that as a tracker export.'); return; }
    if (parsed.projectId && parsed.projectId === this.state.projectId) { this.previewMerge(parsed, inboundInfo); return; }
    const currentName = (this.state.projects.find(m => m.id === this.state.projectId) || {}).name || 'this project';
    const match = parsed.projectId ? this.state.projects.find(m => m.id === parsed.projectId) : null;
    if (match) {
      this.confirmAction('This file is an update for "' + match.name + '", not "' + currentName + '". Switch to "' + match.name + '" and apply it there?', () => {
        this.switchProject(match.id, () => this.previewMerge(parsed, inboundInfo));
      }, 'Switch');
      return;
    }
    const newProjectLabel = parsed.projectName ? ' ("' + parsed.projectName + '")' : '';
    this.confirmAction('This file looks like a brand new project' + newProjectLabel + ', not an update to "' + currentName + '". Import it as a new project instead?', () => {
      this.importParsedAsNewProject(parsed, suggestedName);
    }, 'Import');
  }
  // Lands a final issue list: re-runs applyLinkedRules (merged source data
  // may recompute bound fields differently) and logs any resulting
  // changes the same way setFieldRule/setFieldLinkedSource already do.
  // fieldDefs, if given, is the already-unioned result computed back in
  // startMerge(). notices merges into mergeNotices (transient, per-row,
  // cleared by viewing that row -- see onDismissMergeNotice).
  applyMergedIssues(mergedIssues, fieldDefs, projectHistory, notices, parsed) {
    let maxIncomingSortKey = this._lastSortKey;
    mergedIssues.forEach(iss => (iss.history || []).forEach(h => { if (h.sortKey > maxIncomingSortKey) maxIncomingSortKey = h.sortKey; }));
    this._lastSortKey = maxIncomingSortKey;
    const beforeByIssue = {};
    mergedIssues.forEach(iss => { beforeByIssue[iss.id] = iss.values; });
    const notesPatch = (!this.state.projectNotes && parsed && parsed.projectNotes) ? { projectNotes: parsed.projectNotes } : {};
    const commentsPatch = { projectComments: unionByKey(this.state.projectComments || [], (parsed && parsed.projectComments) || [], c => commentKey(c)) };
    this.setState(s => Object.assign(
      { issues: mergedIssues.map(iss => settleLinkedRules({ ...iss }, effectiveFieldDefs(s.fieldDefs, s.localFieldBindings), this.liveRuleCtx(iss.id))) },
      fieldDefs ? { fieldDefs, projectHistory, columnOrder: reconcileColumnOrder(this.state.columnOrder, fieldDefs, this.state.hiddenFieldIds) } : {},
      notesPatch, commentsPatch
    ));
    mergedIssues.forEach(iss => this.logDerivedChanges(iss.id, beforeByIssue[iss.id] || {}));
    this.checkForNewMentions(mergedIssues);
    this.checkForSubscribedIssueUpdates(mergedIssues);
  }
  logDerivedChanges(issueId, beforeValues, excludeColId, beforeFieldRefs) {
    const iss = this.findIssue(issueId);
    if (!iss) return;
    const entries = computeDerivedChangeEntries(iss, beforeValues, this.effectiveFieldDefs(), excludeColId, beforeFieldRefs);
    for (const e of entries) {
      const committed = this.appendSignedHistory(issueId, { text: e.text, field: e.colId, value: e.value, fieldRef: e.fieldRef || null });
      this.recordLocalDerivedEntryId(issueId, e.colId, committed.id);
    }
  }
  // Strictly-increasing sortKey for every history entry/comment this app
  // generates, so two events written in the same millisecond never tie.
  nextSortKey() {
    this._lastSortKey = advanceSortKey(this._lastSortKey);
    return this._lastSortKey;
  }
  // Real (if unsigned -- there's no live identity action to sign against
  // for a field the app itself is seeding, not a person adding) "Created
  // field" entries for a starter field set, one per field, in fieldDefs'
  // own key order. Mirrors submitNewField's own entry shape exactly so a
  // starter field's Activity history reads no differently from one a user
  // added by hand right after project creation.
  starterFieldHistory(fieldDefs, actor, email) {
    const entries = [];
    for (const id in fieldDefs) {
      entries.push({
        id: crypto.randomUUID(), actor, email,
        text: 'Created field "' + (fieldDefs[id].label || id) + '"',
        field: id, value: fieldDefs[id], origin: 'authored',
        sortKey: this.nextSortKey(), sig: null, sigRedacted: null, pubKey: null
      });
    }
    return entries;
  }
  appendProjectHistory({ text, field, value, origin }) {
    const s = this.state;
    const entryBase = {
      id: crypto.randomUUID ? crypto.randomUUID() : 'ph-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      actor: this.displayName(), email: s.identityEmail || '',
      text, field: field || null, value: field ? value : undefined,
      origin: origin || 'authored',
      sortKey: this.nextSortKey()
    };
    const projectId = this.state.projectId;
    commitSignedEntry(entryBase, {
      signable: signableProjectPayload(projectId, entryBase),
      redacted: redactedProjectPayload(projectId, entryBase)
    }, {
      sign: (payload) => this.signPayload(payload),
      insertUnsigned: (entry) => this.setState(st => {
        const projectHistory = [...st.projectHistory, entry];
        const derivedNotes = deriveProjectNotes(projectHistory);
        return { projectHistory, fieldDefs: deriveFieldDefs(projectHistory), projectNotes: derivedNotes != null ? derivedNotes : st.projectNotes };
      }),
      patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => this.setState(st => ({
        projectHistory: st.projectHistory.map(h => h.id === id ? { ...h, sig, sigRedacted, pubKey } : h)
      })),
      currentPubKey: () => this.state.identityPublicKeyJwk
    });
    return { ...entryBase, sig: null, sigRedacted: null, pubKey: null };
  }
  appendSignedHistory(issueId, { text, field, value, fieldRef, origin }) {
    const s = this.state;
    const entryBase = {
      id: crypto.randomUUID ? crypto.randomUUID() : 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      actor: this.displayName(), email: s.identityEmail || '',
      text, field: field || null, value: field ? value : undefined,
      fieldRef: (field && fieldRef !== undefined) ? fieldRef : undefined,
      origin: origin || 'authored',
      sortKey: this.nextSortKey()
    };
    commitSignedEntry(entryBase, {
      signable: signablePayload(issueId, entryBase),
      redacted: redactedPayload(issueId, entryBase)
    }, {
      sign: (payload) => this.signPayload(payload),
      insertUnsigned: (entry) => this.setState(st => ({
        issues: st.issues.map(iss => {
          if (iss.id !== issueId) return iss;
          const withHistory = { ...iss, history: [...iss.history, entry] };
          return { ...withHistory, values: deriveIssueValues(withHistory, st.fieldDefs), fieldRefs: deriveIssueFieldRefs(withHistory, st.fieldDefs), deleted: issueIsDeleted(withHistory.history) };
        })
      })),
      patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => this.setState(st => ({
        issues: st.issues.map(iss => iss.id === issueId ? {
          ...iss, history: iss.history.map(h => h.id === id ? { ...h, sig, sigRedacted, pubKey } : h)
        } : iss)
      })),
      currentPubKey: () => this.state.identityPublicKeyJwk
    });
    return { ...entryBase, sig: null, sigRedacted: null, pubKey: null };
  }
  loadSecrets() {
    try {
      const raw = localStorage.getItem(SECRETS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      Object.assign(this.state, {
        githubToken: saved.githubToken || this.state.githubToken,
        githubOAuthClientId: saved.githubOAuthClientId || this.state.githubOAuthClientId,
        githubOAuthProxyUrl: saved.githubOAuthProxyUrl || this.state.githubOAuthProxyUrl,
        identityEmail: saved.identityEmail || this.state.identityEmail,
        identityPublicKeyJwk: saved.identityPublicKeyJwk || this.state.identityPublicKeyJwk,
        identityPrivateKeyJwk: saved.identityPrivateKeyJwk || this.state.identityPrivateKeyJwk,
        knownIdentities: saved.knownIdentities || this.state.knownIdentities
      });
      IDENTITY_PROXY_FIELDS.forEach(f => {
        this.state[f.url] = saved[f.url] || this.state[f.url];
        this.state[f.secret] = saved[f.secret] || this.state[f.secret];
      });
    } catch (e) { console.warn('[tracker] failed to load saved secrets:', e); }
  }
  persistSecrets() {
    try {
      const s = this.state;
      localStorage.setItem(SECRETS_KEY, JSON.stringify(Object.assign({
        githubToken: s.githubToken,
        githubOAuthClientId: s.githubOAuthClientId, githubOAuthProxyUrl: s.githubOAuthProxyUrl,
        identityEmail: s.identityEmail,
        identityPublicKeyJwk: s.identityPublicKeyJwk, identityPrivateKeyJwk: s.identityPrivateKeyJwk,
        knownIdentities: s.knownIdentities
      }, identityProxyFieldsFrom(s))));
    } catch (e) { console.warn('[tracker] failed to save secrets:', e); }
  }
  // Reads the ACTIVE project's own document -- this.state.projectId is
  // already set by loadProjectIndex() (which runs first in the
  // constructor) by the time this is called.
  async loadPersistedAsync() {
    const projectId = this.state.projectId;
    let doc = null;
    try {
      doc = await docStore.getDoc(projectId);
    } catch (e) {
      console.warn('[tracker] failed to load saved state:', e);
      this.setState({
        localDocLoading: false,
        columnFilterExcludedIds: computeColumnFilterExcludedIds(this.state.columnFilters, this.state.issues, this.state.fieldDefs),
        sortSnapshot: computeSortSnapshot(this.state.sort, this.state.issues, this.state.fieldDefs)
      }, () => { this.setupAppearanceControl(); this.resolveDeepLinkFromHash(true); });
      return;
    }
    if (!doc || typeof doc !== 'object') {
      // No doc at all yet (brand-new project with nothing persisted) --
      // mirrors the original's own early return, which likewise skipped
      // columnOrder/mergeLog recomputation in this exact case (whatever
      // defaults are already in state are already correct for a project
      // that was *just* created moments earlier by whichever path led
      // here). The one genuinely new thing Phase 3 adds is the loading
      // gate itself, which must still clear regardless.
      this.setState({
        localDocLoading: false,
        columnFilterExcludedIds: computeColumnFilterExcludedIds(this.state.columnFilters, this.state.issues, this.state.fieldDefs),
        sortSnapshot: computeSortSnapshot(this.state.sort, this.state.issues, this.state.fieldDefs)
      }, () => { this.setupAppearanceControl(); this.resolveDeepLinkFromHash(true); });
      return;
    }
    let patch = null;
    try {
      this._docIssuesBaseline[projectId] = JSON.stringify(doc.issues || []);
      const hiddenFieldIds0 = this.hiddenFieldIdsFor(projectId) || this.state.hiddenFieldIds;
      const fieldDefs0 = doc.fieldDefs || this.state.fieldDefs;
      const issues0 = doc.issues || this.state.issues;
      const projectHistory0 = doc.projectHistory || this.state.projectHistory;
      const projectNotes0 = doc.projectNotes || this.state.projectNotes;
      const hadTimestampFieldsBeforeHydrate = ['created', 'updated'].every(tid => fieldDefs0 && fieldDefs0[tid]);
      const hydratedProject = hydrateProject(fieldDefs0, projectHistory0, projectNotes0);
      const projectBackfillChanged = hydratedProject.projectHistory !== projectHistory0;
      const fieldDefs = hydratedProject.fieldDefs;
      const projectHistory = hydratedProject.projectHistory;
      let projects = this.state.projects;
      if (hydratedProject.projectName) {
        const meta = projects.find(m => m.id === projectId);
        if (meta && meta.name !== hydratedProject.projectName) {
          projects = projects.map(m => m.id === projectId ? { ...m, name: hydratedProject.projectName } : m);
        }
      }
      let projectNotes = projectNotes0;
      if (hydratedProject.projectNotes != null && hydratedProject.projectNotes !== projectNotes0) {
        projectNotes = hydratedProject.projectNotes;
      }
      let hiddenFieldIds = hiddenFieldIds0;
      if (!hadTimestampFieldsBeforeHydrate) {
        hiddenFieldIds = [...hiddenFieldIds0, ...['created', 'updated'].filter(tid => !hiddenFieldIds0.includes(tid))];
      }
      const hydratedIssues = issues0.map(iss => hydrateIssue(iss, fieldDefs));
      const backfillChangedSomething = hydratedIssues.some((iss, i) => iss.history !== issues0[i].history || iss.commentStreams !== issues0[i].commentStreams);
      patch = {
        fieldDefs, issues: hydratedIssues, projectHistory, projects, hiddenFieldIds, projectNotes,
        githubRepo: doc.githubRepo || this.state.githubRepo,
        githubRepoPath: doc.githubRepoPath || this.state.githubRepoPath,
        githubRepoBranch: doc.githubRepoBranch || this.state.githubRepoBranch,
        githubTokenOverride: doc.githubTokenOverride || this.state.githubTokenOverride,
        projectComments: doc.projectComments || this.state.projectComments,
        _shouldPersist: backfillChangedSomething || projectBackfillChanged
      };
    } catch (e) {
      console.warn('[tracker] failed to load saved state:', e);
      patch = {};
    }
    patch.columnOrder = reconcileColumnOrder(this.columnOrderFor(projectId), patch.fieldDefs || this.state.fieldDefs, patch.hiddenFieldIds || this.state.hiddenFieldIds);
    patch.columnFilterExcludedIds = computeColumnFilterExcludedIds(this.state.columnFilters, patch.issues || this.state.issues, patch.fieldDefs || this.state.fieldDefs);
    patch.sortSnapshot = computeSortSnapshot(this.state.sort, patch.issues || this.state.issues, patch.fieldDefs || this.state.fieldDefs);
    patch.mergeLog = await this.readMergeLog(projectId);
    const shouldPersist = patch._shouldPersist;
    delete patch._shouldPersist;
    patch.localDocLoading = false;
    this.setState(patch, () => { this.setupAppearanceControl(); this.resolveDeepLinkFromHash(true); });
    if (shouldPersist) this.persist();
    const finalIssues = patch.issues || this.state.issues;
    this.checkForNewMentions(finalIssues);
    this.checkForSubscribedIssueUpdates(finalIssues);
  }
  // Local-only merge log (README §2.3/§4, tracker #123/#124) -- reads the
  // per-project localStorage list recordMergeLog appends to. Never part
  // of the synced doc (see docKey/persist above) and never exported.
  async readMergeLog(projectId) {
    try { return await docStore.getMergeLog(this.storagePrefKey(projectId)); } catch (e) { return []; }
  }
  persist() {
    this._persistChain = (this._persistChain || Promise.resolve())
      .then(() => this._persistOnce())
      .catch(e => console.warn('[tracker] failed to save state:', e));
    return this._persistChain;
  }
  async _persistOnce() {
    const s = this.state;
    if (!s.projectId) return;
    if (s.localDocLoading || s.roomModeBootstrapping) return;
    if (!s.projects.some(p => p.id === s.projectId)) return;
    const outgoingIssues = s.issues.map(({ values, fieldRefs, fieldLoading, ...rest }) => rest);
    const outgoingIssuesText = JSON.stringify(outgoingIssues);
    const onDisk = await docStore.getDoc(s.projectId);
    let onDiskIssuesText = null;
    if (onDisk) {
      try { onDiskIssuesText = JSON.stringify(onDisk.issues || []); } catch (e) { /* corrupt on-disk doc -- fall through and overwrite it */ }
    }
    const baseline = this._docIssuesBaseline[s.projectId];
    if (onDiskIssuesText != null && baseline != null && onDiskIssuesText !== baseline && onDiskIssuesText !== outgoingIssuesText) {
      this.adoptExternalIssues(onDisk);
      return;
    }
    const doc = {
      fieldDefs: s.fieldDefs,
      issues: outgoingIssues,
      projectHistory: s.projectHistory,
      githubRepo: s.githubRepo, githubRepoPath: s.githubRepoPath, githubRepoBranch: s.githubRepoBranch, githubTokenOverride: s.githubTokenOverride,
      projectNotes: s.projectNotes, projectComments: s.projectComments
    };
    await docStore.putDoc(s.projectId, doc);
    this._docIssuesBaseline[s.projectId] = outgoingIssuesText;
    this._projectSummaries[s.projectId] = buildProjectSummaryFromDoc(doc);
    if (!ROOM_MODE_CAPABILITIES) {
      const docJson = JSON.stringify(doc);
      if (docJson !== this._lastDocSyncJson[s.projectId]) {
        this._lastDocSyncJson[s.projectId] = docJson;
        this._docSyncChannel.postMessage({ type: 'doc-saved', projectId: s.projectId, doc });
      }
    }
  }
  // Pulls the on-disk issues for the active project into this tab's own
  // state instead of overwriting them -- persist()'s own reaction to
  // detecting that disk moved since this tab last saw it. fieldDefs comes
  // from the disk doc itself when present (matches how the storage-event
  // listener above hydrates), since this tab's own fieldDefs may not be
  // what actually produced these issues.
  adoptExternalIssues(doc) {
    try {
      const fieldDefsForHydration = doc.fieldDefs || this.state.fieldDefs;
      const hydratedIssues = (doc.issues || []).map(iss => hydrateIssue(iss, fieldDefsForHydration));
      this._docIssuesBaseline[this.state.projectId] = JSON.stringify(doc.issues || []);
      this.setState({ issues: hydratedIssues });
    } catch (err) { console.warn('[tracker] failed to adopt external issues:', err); }
  }
  componentDidUpdate() { this.ensureHeaderPattern(); this.persist(); this.persistSecrets(); this.persistProjectIndex(); this.persistIdentities(); this.persistCommentReads(); this.persistColumnWidths(); this.persistColumnWrap(); this.persistColumnOrder(); this.persistHiddenFieldIds(); this.persistColumnFilters(); this.persistSort(); this.maybeScheduleGithubPush(); this.hydrateMarkdownBodies(); this.autoGrowTextareas(); this.maybeMeasureTableOverflow(); this.maybeMeasureStatusBarOverflow(); }
  // Covers every markdown-rendered surface in the app -- issue/project
  // comments, project notes, and (as of the text-field markdown feature)
  // every plain 'text' field's cell/slide-over display -- all through the
  // same data-raw-text-attribute + innerHTML pattern, since the template
  // engine HTML-escapes every {{ }} interpolation (see the comment above
  // escapeHtml()).
  hydrateMarkdownBodies() {
    document.querySelectorAll('[data-testid="comment-md"], [data-testid="notes-body"], [data-testid="project-comment-md"], [data-testid="text-field-md"]').forEach(el => {
      const raw = el.getAttribute('data-raw-text') || '';
      if (el.__mdRaw !== raw) {
        el.innerHTML = renderMarkdown(raw);
        el.__mdRaw = raw;
      }
      el.querySelectorAll('.wigwag-ref-pill').forEach(pill => {
        const rawRef = pill.getAttribute('data-wigwag-ref') || '';
        const wg = this.wigwagUrlMatch(rawRef);
        const resolved = wg ? this.resolveWigwagRef(wg) : { found: false, label: 'Unknown wigwag reference' };
        const shortLabel = wg && wg.issueId ? '#' + wg.issueId.slice(0, 8) : resolved.label;
        pill.innerHTML = '<svg width="10" height="10" viewBox="0 0 44 44" style="margin-left:5px; margin-right:2px; vertical-align:0;"><path d="M0 0h44v44H0z" fill="#EF4755"></path><path d="M14 14h16v16H14z" fill="#fff"></path></svg>' + escapeHtml(shortLabel);
        pill.title = resolved.label;
        pill.style.cssText = 'font-size:12.5px; color: var(--c13); text-decoration:none; cursor:pointer;' + (resolved.found ? '' : ' opacity:0.6;');
        pill.onclick = e => { e.preventDefault(); if (wg) this.openWigwagRef(wg); };
      });
    });
  }
  autoGrowTextareas() {
    const MAX_HEIGHT = 300;
    document.querySelectorAll('[data-testid="new-comment-input"], [data-testid="comment-edit-input"], [data-testid="text-field-edit-textarea"]').forEach(el => {
      if (el.__grownFor === el.value) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
      el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
      el.__grownFor = el.value;
    });
  }
  state = {
    projectId: null,
    bootOverlayPhase: 'visible',
    deepLinkNotice: null,
    appUpdateAvailable: false,
    markdownCopiedKey: null,
    unknownProjectNotice: null,
    unknownProjectCold: null,
    connectRemoteOpen: false,
    connectRemoteAddress: '',
    connectRemoteParsed: null,
    connectRemoteEditingParts: false,
    connectRemoteProbeResults: null,
    connectRemoteBusy: false,
    connectRemoteError: '',
    projects: [],
    identities: [],
    activeIdentityId: null,
    lastActiveProjectByIdentity: {},
    commentReads: {},
    issueSubscriptions: {},
    mentionNotificationsEnabled: (function () { try { return localStorage.getItem(MENTION_NOTIFICATIONS_KEY) === '1'; } catch (e) { return false; } })(),
    exportTrustStore: (function () { try { return JSON.parse(localStorage.getItem(EXPORT_TRUST_KEY) || '{}'); } catch (e) { return {}; } })(),
    lastIngestProvenance: null,
    // Tracker #124 (5c3051e9): the not-yet-applied result of previewMerge(),
    // shown as the ingest gate ("Merge update" / "Not now") -- see
    // previewMerge/confirmPendingMerge/cancelPendingMerge. Per-tab, not
    // per-project (a pending decision doesn't survive a project switch).
    pendingMerge: null,
    // Which issue's Level 3 timeline is expanded within the gate --
    // per-issue (not per-field, README §3: "Show the timeline" combines
    // every field an issue's merge touched into one view).
    gateOpenTimelineIssueId: null,
    // Local-only merge log (per project -- reloaded in loadPersisted/
    // switchProject, appended to by recordMergeLog). Backs the "Merge
    // history" project-panel section (Level 3).
    mergeLog: [],
    // Which past merge log record (if any) is expanded in the Merge
    // History project-panel section, and which one field's Level-3
    // timeline within it is expanded. Ephemeral UI state -- reset on
    // project switch/panel close like the rest of the panel's own state.
    mergeReviewId: null,
    mergeReviewTimelineIssueId: null,
    // The Tauri desktop app has no synchronous equivalent of the web
    // Notification.permission property (isPermissionGranted() below is
    // async) -- starts as 'default' there (same as a browser that's never
    // been asked) and componentDidMount kicks off the real check, updating
    // this once it resolves.
    notificationPermission: ((window.__TAURI__ && window.__TAURI__.notification) ? 'default' : (window.Notification ? Notification.permission : 'unsupported')),
    testNotificationResult: null,
    // Tracker #205: auto-update (Tauri desktop only). checkState tracks
    // the check() call itself; phase tracks what happens after the user
    // confirms (download/install/relaunch) -- kept separate since a
    // failed download shouldn't erase the fact an update IS available.
    installedAppVersion: '',
    updateCheckState: 'idle', updateInfo: null, pendingUpdate: null,
    updatePhase: 'idle', updateDismissed: false, updateError: '',
    // Connected Sources (Phase 1): custom, user-defined connectors --
    // global/device-wide, not per-project (see CONNECTED_SOURCES_KEY's
    // own comment in wigwag-core.js), hydrated once here rather than on
    // every project switch. connectorPickerOpen is the transient
    // pattern-conflict picker state ({ issueId, colId, matches }) when a
    // paste matches more than one custom connector's patterns.
    connectedSources: this.loadConnectedSources(),
    connectorPickerOpen: null,
    connectorFormOpen: null,
    // Visual half of the slide transition (Settings <-> connector
    // editor) -- connectorFormOpen is the slot (mounts/unmounts the
    // editor), this drives the actual transform, same dual-state idiom
    // as slideOverIssueId/slideOverVisible (see closeSlideOver).
    connectorFormVisible: false,
    builtinFormOpen: null,
    addSourceTypePickerOpen: false,
    switcherOpen: false,
    switcherScopeId: null,
    addIdentityOpen: false,
    newIdentityLabelDraft: '',
    newIdentityEmailDraft: '',
    emailGateOpen: false,
    emailGateDraft: '',
    attributionGateOpen: false,
    attributionGateMode: 'first',
    attributionGateSelectedId: null,
    attributionGateAddOpen: false,
    tableOverflow: false,
    rowsBelow: 0,
    rowsFitting: 0,
    pasteImportOpen: false,
    pasteImportDraft: '',
    pasteMergeOpen: false,
    pasteMergeDraft: '',
    deleteProjectConfirmOpen: false,
    deleteProjectNameDraft: '',
    confirmDialog: null,
    trackerNameEditing: false,
    trackerNameDraft: '',
    identityEmail: '',
    identityPublicKeyJwk: null,
    identityPrivateKeyJwk: null,
    knownIdentities: {},
    githubToken: '',
    githubRepo: '',
    githubRepoPath: 'tracker.jsonl',
    githubRepoBranch: '',
    githubTokenOverride: '',
    githubOAuthClientId: '',
    githubOAuthProxyUrl: 'http://localhost:8935',
    githubSyncStatus: 'disconnected',
    githubSyncError: '',
    githubLastSyncedAt: null,
    jiraProxyUrl: 'http://localhost:8934',
    jiraProxySecret: '',
    salesforceProxyUrl: 'http://localhost:8936',
    salesforceProxySecret: '',
    githubProxyUrl: '',
    githubProxySecret: '',
    googleDriveProxyUrl: '',
    googleDriveProxySecret: '',
    pushRelayUrl: 'http://localhost:8939',
    pushRelaySecret: '',
    pushNotificationsStatus: '',
    pushNotificationsError: '',
    statusBarOverflowOpen: false,
    statusBarRowFits: true,
    settingsOpen: false,
    settingsSection: 'identity',
    exportMenuOpen: false,
    proposeLayoutConfirmOpen: false,
    sendCopied: false,
    sourceViewOpen: false,
    copyLabel: 'Copy',
    addFieldOpen: false,
    addFieldAnchorLeft: 0, addFieldAnchorTopPx: 0, addFieldAnchorBottomPx: 0, addFieldOpenUpward: false, addFieldMaxHeightPx: 400,
    addItemOpen: false,
    addItemDraft: '',
    // Tracker #191: bulk-link-issues-from-a-multi-line-paste. bulkPasteLines
    // is null when inactive, else the raw pasted lines (array of strings) --
    // everything else is re-derived fresh from it every render (see
    // buildBulkPasteViewModel), same "recompute, don't cache" discipline as
    // the merge-gate's own pendingMerge/buildMergeGateViewModel.
    bulkPasteLines: null,
    bulkPasteReviewOpen: false,
    bulkPasteShowLinkedList: false,
    bulkPasteShowUnlinkedList: false,
    bulkSummaryOpen: false,
    bulkSummaryAnchorLeft: 0, bulkSummaryAnchorTopPx: 0, bulkSummaryAnchorBottomPx: 0, bulkSummaryOpenUpward: false, bulkSummaryMaxHeightPx: 400,
    newFieldName: '',
    newFieldType: 'text',
    filterQuery: '',
    widgetFilterOpen: false,
    jumpDismissed: false,
    jumpActiveIndex: 0,
    refreshJobsPopoverOpen: false,
    globalSearchOpen: false,
    globalSearchQuery: '',
    globalSearchIndex: 0,
    // Tracker #198: { [projectId]: RefreshJob }. Deliberately not reset
    // by switchProject -- a job must survive navigating away from its
    // own project (see stageRefreshJob/the header job chip).
    refreshJobs: {},
    filterSuggestDismissed: true,
    filterSuggestActiveIndex: 0,
    filterSuggestAnchorLeft: 0,
    filterSuggestAnchorTopPx: 0,
    sort: { colId: null, dir: 'asc' },
    sortSnapshot: null,
    columnFilters: {},
    columnFilterExcludedIds: [],
    selectedIssueIds: [],
    focusAnchorId: null,
    bulkFieldMenuOpen: false,
    bulkFieldMenuColId: null,
    bulkTextDraft: '',
    bulkMultiDraft: {},
    isMobileViewport: false,
    mobileActiveSheet: null,
    mobileSheetDragY: 0,
    mobileSheetDragging: false,
    mobileHeaderCollapsed: false,
    mobileSyncDetailOpen: false,
    mobileOverflowOpen: false,
    // tracker #153 (45556022): the compact header's Receive toolbar
    // segment opens a small 2-item menu (Apply update / Import project)
    // instead of performing one action directly, since those were two
    // genuinely different existing flows before this -- separate from
    // the "···" overflow now that Share/Apply update/Project settings
    // have their own direct toolbar icons.
    mobileReceiveMenuOpen: false,
    mobileFilterOpen: false,
    mobileAddOpen: false,
    mobileAddIdentityOpen: false,
    mobileSettingsSection: null,
    columnWidths: {},
    columnWrap: {},
    columnOrder: defaultColumnOrder(),
    draggingColId: null, dragOverColId: null, dragOverSide: null,
    kanbanColId: null, draggingKanbanIssueId: null, dragOverKanbanOptId: null, freezeColId: null,
    draggingRuleRowIndex: null, dragOverRuleRowIndex: null, dragOverRuleRowSide: null,
    hiddenFieldIds: [],
    openColMenuId: null,
    colMenuAnchorLeft: 0, colMenuAnchorTopPx: 0, colMenuAnchorBottomPx: 0, colMenuOpenUpward: false, colMenuMaxHeightPx: 400,
    fieldEditorColId: null,
    fieldEditorNewOptLabel: '',
    colorPickerOptIndex: null,
    ruleBuilderColId: null,
    ruleBuilderVisible: false,
    activeCell: null,
    selectedCell: null,
    editDraft: '',
    optionFilterQuery: '',
    slideOverIssueId: null,
    slideOverVisible: false,
    newCommentDraft: '',
    commentStreamDrafts: {},
    editingCommentFieldId: null,
    editingCommentId: null,
    editCommentDraft: '',
    editingProjectCommentId: null,
    editProjectCommentDraft: '',
    activityTab: 'comments',
    slideOverCopyLinkLabel: 'Copy link',
    slideOverCopyJsonLabel: 'Copy JSON',
    projectNotes: '',
    projectComments: [],
    projectPanelSection: 'notes',
    projectLinkCopyLabel: 'Copy link',
    projectNotesOpen: false,
    projectNotesVisible: false,
    projectNoteEditing: false,
    projectNoteDraft: '',
    projectCommentDraft: '',
    fieldDefs: defaultFieldDefs(),
    issues: [],
    projectHistory: []
  };

  findIssue(id) { return this.state.issues.find(i => i.id === id); }

  startEdit(issueId, colId, current) { this.setState({ activeCell: { issueId, colId }, editDraft: current || '' }); }
  // The two-click gate itself: first click on a cell selects it; a second
  // click on the SAME already-selected cell runs onCommit (enter text
  // edit, or open the select/multiselect popover). Bypassed by the
  // dropdown arrow and by clicking a resolved Title, both of which act
  // immediately on one click -- see buildTextCell/buildSelectCell/buildMultiCell.
  cellClickGate(issueId, colId, onCommit) {
    const sel = this.state.selectedCell;
    const isSelected = sel && sel.issueId === issueId && sel.colId === colId;
    if (isSelected) {
      this.setState({ selectedCell: null });
      onCommit();
    } else {
      this.setState({ selectedCell: { issueId, colId }, activeCell: null });
    }
  }

  // Pure shape recognition, no gating -- the inverse used both by the
  // public gated matcher below (new paste-dispatch, where reachability
  // genuinely matters) and by matchedIdFromHref (re-deriving an
  // EXISTING ref's own matchedId for refresh/sameRef comparison, which
  // must work regardless of current configuration -- comparing
  // identity, not deciding reachability).
  parseGithubUrl(text) {
    const t = (text || '').trim();
    const full = t.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)\/?$/i);
    if (full) return { owner: full[1], repo: full[2], num: full[3] };
    const shorthand = t.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
    if (shorthand) return { owner: shorthand[1], repo: shorthand[2], num: shorthand[3] };
    return null;
  }
  // Pure shape recognition only -- gating (is this kind even reachable
  // right now) and the {fetchedVia, matchedId, href} paste-dispatch
  // shape live in connectorMatches below, which reuses these directly
  // (also still reused by matchedIdFromHref, unrelated to paste gating).
  parseJiraKey(text) {
    const t = (text || '').trim();
    if (JIRA_KEY_RE.test(t)) return t.toUpperCase();
    const urlMatch = t.match(/^https?:\/\/[\w.-]+\/browse\/([A-Z][A-Z0-9]+-\d+)\/?(?:[?#].*)?$/i);
    return urlMatch ? urlMatch[1].toUpperCase() : null;
  }
  // URL-only -- a Salesforce Id (006Nz00000jD3mCIAS)
  // isn't something anyone types from memory the way a short Jira key is,
  // so there's no bare-id form to also accept. Handles both the modern
  // Lightning shape (object-name path segment optional -- some orgs' URLs
  // omit it) and the older classic-UI shape.
  // The Lightning pattern is deliberately domain-agnostic on the host
  // (matches the path shape anywhere, not just *.lightning.force.com) --
  // a PASTED link is typically on the org's own lightning.force.com
  // domain, but fetchSalesforceData's own constructed `url` (what
  // actually gets persisted as href, and what matchedIdFromHref later
  // re-parses on refresh) builds the SAME /lightning/r/<Type>/<id>/view
  // path on the SOAP login's returned instanceUrl instead, which is
  // typically *.my.salesforce.com -- restricting the host here used to
  // make a real refresh's own id re-derivation silently fail (confirmed
  // regression, caught by external-auth.spec.js's own bound-source-
  // rules-read-after-refresh coverage).
  parseSalesforceId(text) {
    const t = (text || '').trim();
    let m = t.match(/\/lightning\/r\/(?:[\w]+\/)?([a-zA-Z0-9]{15,18})\/view\/?(?:[?#].*)?$/i);
    if (m) return m[1];
    m = t.match(/^https?:\/\/[\w-]+\.(?:my\.)?salesforce\.com\/([a-zA-Z0-9]{15,18})\/?(?:[?#].*)?$/i);
    return m ? m[1] : null;
  }
  // The host of a pasted URL, for connectorMatches' own soft
  // disambiguation below -- null for anything that isn't a parseable
  // absolute URL (a bare Jira key, a Salesforce id, any plain text).
  hostFromUrl(text) {
    try { return new URL((text || '').trim()).host; } catch (e) { return null; }
  }
  // Unified paste-dispatch matcher -- replaces githubUrlMatch/
  // jiraKeyMatch/salesforceUrlMatch/customConnectorMatches. Every
  // connectedSources entry (real, or -- for GitHub specifically -- the
  // same synthetic always-reachable stand-in connectedSourcesForDispatch
  // appends -- see its own comment) is tried once: a kind-tagged entry
  // reuses the matching pure parser (parseGithubUrl/parseJiraKey/
  // parseSalesforceId), gated by builtinKindReachable (so an
  // unconfigured/disabled/Tauri-less instance never claims a shape it
  // can't actually fetch); an untagged (true macro) entry runs its own
  // saved patterns through the same regex engine customConnectorMatches
  // always used, gated on isTauriConnectorRuntime (every macro connector
  // needs it, unlike github). Returns the shared {connector, fetchedVia,
  // matchedId, href} shape every caller (commitEdit, createIssueFromText,
  // classifyBulkPasteLines) already expects.
  connectorMatches(draft) {
    const t = (draft || '').trim();
    if (!t) return [];
    const ctx = { tauriConnectorRuntime: this.isTauriConnectorRuntime() };
    const kindMatches = [];
    const macroMatches = [];
    for (const c of this.connectedSourcesForDispatch()) {
      if (c.enabled === false) continue;
      if (c.kind) {
        if (!builtinKindReachable(c, ctx)) continue;
        const matchedId = c.kind === 'github' ? this.parseGithubUrl(t)
          : c.kind === 'jira' ? this.parseJiraKey(t)
          : c.kind === 'salesforce' ? this.parseSalesforceId(t)
          : null;
        if (matchedId == null) continue;
        const href = c.kind === 'github' ? 'https://github.com/' + matchedId.owner + '/' + matchedId.repo + '/issues/' + matchedId.num : null;
        kindMatches.push({ connector: c, fetchedVia: c.id, matchedId, href });
      } else {
        if (!ctx.tauriConnectorRuntime) continue;
        for (const p of c.patterns || []) {
          let re;
          try { re = new RegExp('^(?:' + p.regex + ')$'); } catch (e) { continue; }
          const m = re.exec(t);
          // href is left null here, same as the old jiraKeyMatch/
          // salesforceUrlMatch -- a connector's real record URL only
          // comes back from the macro's own fetch result (data.url).
          if (m) { macroMatches.push({ connector: c, fetchedVia: c.id, matchedId: (m[1] || m[0]), href: null }); break; }
        }
      }
    }
    // Kind-tagged (github/jira/salesforce) matches take strict priority
    // over untagged (macro) ones, same as the old gh||jira||sf chain
    // short-circuiting before customConnectorMatches ever ran -- an
    // unrelated custom connector whose own pattern happens to ALSO
    // match (e.g. a broad `[A-Z]+-\d+` ticket-key pattern colliding
    // with a real Jira key) must never turn a deterministic built-in
    // match into a false "matches more than one source" ambiguity.
    const raw = kindMatches.length ? kindMatches : macroMatches;
    // Soft disambiguation: when 2+ matches share a kind AND the pasted
    // text is itself a URL, a host match against each candidate's own
    // rootUrl narrows silently to the one actually-matching instance --
    // e.g. two configured Jira servers, paste a full browse URL on one
    // of them rather than a bare key (which has no host to narrow by,
    // and genuinely is ambiguous between them).
    const host = this.hostFromUrl(t);
    if (!host || raw.length < 2) return raw;
    const narrowed = raw.filter(m => this.hostFromUrl(m.connector.rootUrl) === host);
    return narrowed.length === 1 ? narrowed : raw;
  }
  // Matches EITHER a raw local-instance deep link (any scheme/origin/path,
  // since "local instance path" varies machine to machine -- only the
  // portable #/project/<id>(/issue/<id>) suffix matters) OR an
  // already-canonical wigwag: URI (so re-pasting an already-translated
  // link, e.g. copied from another project's field, still resolves).
  // Whole-string match, matching connectorMatches' own contract
  // (paste-to-resolve gates on the ENTIRE field value, not a substring).
  wigwagUrlMatch(text) {
    const t = (text || '').trim();
    let m = t.match(/^wigwag:\/project\/([^\/?\s]+)(?:\/issue\/([^\/?\s]+))?\/?(?:\?(\S*))?$/);
    if (m) {
      const q = this.parseWigwagQuery(m[3]);
      return { form: 'project', projectId: decodeURIComponent(m[1]), issueId: m[2] ? decodeURIComponent(m[2]) : null, from: q.from || null, path: q.path || null, ref: q.ref || null };
    }
    m = t.match(/^wigwag:\/remote\/([^\/?\s]+)\/([^\/?\s]+)\/([^\/?\s]+)(?:\/issue\/([^\/?\s]+))?\/?(?:\?(\S*))?$/);
    if (m) {
      const q = this.parseWigwagQuery(m[5]);
      return { form: 'remote', host: decodeURIComponent(m[1]), owner: decodeURIComponent(m[2]), repo: decodeURIComponent(m[3]), issueId: m[4] ? decodeURIComponent(m[4]) : null, path: q.path || null, ref: q.ref || null };
    }
    m = t.match(/^(?:(?:https?|file):\/\/[^\s#]*)?#\/project\/([^\/\s]+)(?:\/issue\/([^\/\s]+))?\/?$/);
    if (m) return { form: 'project', projectId: decodeURIComponent(m[1]), issueId: m[2] ? decodeURIComponent(m[2]) : null, from: null, path: null, ref: null };
    return null;
  }
  parseWigwagQuery(qs) {
    const out = {};
    if (!qs) return out;
    for (const pair of qs.split('&')) {
      const eq = pair.indexOf('=');
      const k = eq === -1 ? pair : pair.slice(0, eq);
      const v = eq === -1 ? '' : pair.slice(eq + 1);
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    return out;
  }
  resolveWigwagProjectId(wg) {
    if (!wg) return null;
    const form = wg.form || 'project';
    if (form === 'project') return wg.projectId;
    if (form === 'remote') {
      const ownerRepo = (wg.owner + '/' + wg.repo).toLowerCase();
      for (const p of this.state.projects) {
        const repo = p.id === this.state.projectId ? this.state.githubRepo : this.projectGithubRepo(p.id);
        if ((repo || '').toLowerCase() === ownerRepo) return p.id;
      }
    }
    return null;
  }
  // Reads another project's own stored githubRepo without switching to
  // it -- same lightweight cross-project doc read resolveWigwagRef and
  // the mobile sheet's own per-project summaries already use.
  projectGithubRepo(projectId) {
    const summary = this._projectSummaries[projectId];
    return summary ? summary.githubRepo : '';
  }
  // Reads another project's own stored repo-sync path/branch alongside
  // its repo, for wigwagLinkSuffix below.
  projectGithubRepoInfo(projectId) {
    const summary = this._projectSummaries[projectId];
    if (!summary || !summary.githubRepo) return null;
    return { repo: summary.githubRepo, path: summary.githubRepoPath || 'tracker.jsonl', branch: summary.githubRepoBranch || '' };
  }
  // Builds the ?from=/path=/ref= suffix for a wigwag: link pointing at
  // projectId -- from= is emitted whenever that project has a connected
  // repo. path= is ALWAYS stated too, even when it's just 'tracker.jsonl'
  // -- deliberately not treated as an implicit default a reader has to
  // already know about; this is the ONLY information a recipient without
  // projectId locally gets to go on (see connectRemotePrefillFromWigwagRef),
  // so it has to carry everything the LINKING browser already knows about
  // where the file actually lives, explicitly, not by convention. ref= is
  // the one exception: when no branch is pinned (githubRepoBranch empty,
  // meaning "follow the repo's current default branch"), there's no
  // concrete value to state without an extra live GitHub API call at
  // link-creation time -- omitted there means exactly "no ref pinned",
  // not "forgot to say".
  wigwagLinkSuffix(projectId) {
    const info = projectId === this.state.projectId
      ? (this.state.githubRepo ? { repo: this.state.githubRepo, path: this.state.githubRepoPath || 'tracker.jsonl', branch: this.state.githubRepoBranch || '' } : null)
      : this.projectGithubRepoInfo(projectId);
    if (!info) return '';
    const params = ['from=' + encodeURIComponent('github.com/' + info.repo), 'path=' + encodeURIComponent(info.path)];
    if (info.branch) params.push('ref=' + encodeURIComponent(info.branch));
    return '?' + params.join('&');
  }
  // The monospace "which link failed" reference shown on the
  // unknown-project screens -- prefers the from= address hint (readable,
  // e.g. "acme-corp/wigwag#42") over the bare id, since we don't have the
  // project and so don't know its name.
  wigwagReferenceLabel(wg) {
    if (!wg) return 'unknown';
    if (wg.from) return wg.from + (wg.issueId ? '#' + wg.issueId : '');
    if (wg.form === 'remote') return wg.owner + '/' + wg.repo + (wg.issueId ? '#' + wg.issueId : '');
    return (wg.projectId ? wg.projectId.slice(0, 8) : 'project') + (wg.issueId ? '#' + wg.issueId : '');
  }
  // Prose (comments/notes/type:'text' fields) translation: rewrites every
  // raw local-instance deep link found ANYWHERE inside a larger string
  // into its canonical wigwag: form, at commit time -- so what's actually
  // PERSISTED is location-independent, not tied to this browser's own
  // origin/path. Already-canonical wigwag: links pass through untouched
  // (the regex only matches the http(s)/file raw-link shape).
  translateWigwagLinksInText(text) {
    if (!text) return text;
    return text.replace(/\b(?:(?:https?|file):\/\/[^\s#]*)?#\/project\/([^\/\s]+)(?:\/issue\/([^\/\s]+))?\/?/g, (m, pid, iid) => {
      const projectId = decodeURIComponent(pid);
      const issueId = iid ? decodeURIComponent(iid) : null;
      const suffix = this.wigwagLinkSuffix(projectId);
      return 'wigwag:/project/' + encodeURIComponent(projectId) + (issueId ? '/issue/' + encodeURIComponent(issueId) : '') + suffix;
    });
  }
  // Resolution is always local and synchronous (localStorage, never a
  // fetch) -- unlike GitHub/Jira/Salesforce there's no staleness to
  // guard against, so this can just be called fresh on every render
  // instead of needing a cache or a loading/refresh cycle. issueId's
  // doc may be the currently-active project (read from live state) or a
  // different one (read directly from its own stored doc, same pattern
  // already used by the mobile sheet's per-project issue counts).
  resolveWigwagRef(wg) {
    const projectId = this.resolveWigwagProjectId(wg);
    if (!projectId) {
      if (wg && wg.form === 'remote') return { found: false, label: wg.owner + '/' + wg.repo + ' (not connected)' };
      return { found: false, label: 'Unknown wigwag project' };
    }
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) return { found: false, label: 'Unknown wigwag project' };
    const issueId = wg.issueId || null;
    if (!issueId) return { found: true, label: project.name };
    let issueTitle = null;
    if (projectId === this.state.projectId) {
      const iss = this.state.issues.find(i => i.id === issueId);
      issueTitle = iss && iss.values ? iss.values.title : null;
    } else {
      const summary = this._projectSummaries[projectId];
      const iss = summary ? summary.issues.find(i => i.id === issueId) : null;
      issueTitle = iss ? iss.title : null;
    }
    return { found: true, label: project.name + (issueTitle ? ' / ' + issueTitle : ' / (issue not found)') };
  }
  // In-app navigation for a wigwag: link click -- reuses the exact same
  // hash route + resolveDeepLinkFromHash() the address bar/Back-Forward
  // already drive, so cross-identity switching and the "not in this
  // browser" notice both come for free instead of being reimplemented.
  openWigwagRef(wg) {
    const projectId = this.resolveWigwagProjectId(wg);
    if (!projectId || !this.state.projects.some(p => p.id === projectId)) {
      this.setState({ unknownProjectNotice: { reference: this.wigwagReferenceLabel(wg), wg } });
      return;
    }
    const issueId = wg.issueId || null;
    const hash = '#/project/' + encodeURIComponent(projectId) + (issueId ? '/issue/' + encodeURIComponent(issueId) : '');
    if (window.location.hash !== hash) history.pushState(null, '', hash);
    this.resolveDeepLinkFromHash(false);
  }
  // Field-scoped wigwag counterpart to applyGithubLinkToField/
  // applyConnectorLinkToField -- same fieldRef/history shape, but no
  // fetch/loading state at all since resolution is local and instant.
  applyWigwagLinkToField(issueId, colId, wg) {
    const fieldLabel = (this.state.fieldDefs[colId] && this.state.fieldDefs[colId].label) || colId;
    const iss0 = this.findIssue(issueId);
    const resolved = this.resolveWigwagRef(wg);
    const fieldRef = { system: 'wigwag', projectId: this.resolveWigwagProjectId(wg), issueId: wg.issueId || null, from: wg.from || null, path: wg.path || null, ref: wg.ref || null };
    const beforeFieldRef = iss0 && iss0.fieldRefs && iss0.fieldRefs[colId];
    const beforeValue = iss0 ? iss0.values[colId] : undefined;
    const unchanged = !!beforeFieldRef && JSON.stringify(beforeFieldRef) === JSON.stringify(fieldRef) && beforeValue === resolved.label;
    this.setState({ activeCell: null, editDraft: '' });
    if (!unchanged) this.appendSignedHistory(issueId, { text: 'Linked ' + fieldLabel + ' to a wigwag project', field: colId, value: resolved.label, fieldRef });
    this.setState(s => ({ issues: s.issues.map(iss => iss.id === issueId ? settleLinkedRules(iss, effectiveFieldDefs(s.fieldDefs, s.localFieldBindings), this.liveRuleCtx(issueId)) : iss) }));
  }
  withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { isTimeout: true })), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  // Connected Sources (Phase 1) -- mirrors columnWidthsFor/
  // localFieldBindingsFor's own try/catch-JSON-parse shape, but global
  // (no storagePrefKey) since a connector is a cross-project resource.
  loadConnectedSources() {
    try {
      const raw = localStorage.getItem(CONNECTED_SOURCES_KEY);
      return raw ? (JSON.parse(raw).connectors || []) : [];
    } catch (e) { return []; }
  }
  saveConnectedSources(connectors) {
    try { localStorage.setItem(CONNECTED_SOURCES_KEY, JSON.stringify({ connectors })); }
    catch (e) { console.warn('[tracker] failed to save connected sources:', e); }
    this.setState({ connectedSources: connectors });
  }
  // Keeps the 3 original fixed-id built-in rows (GitHub/Jira/Salesforce,
  // ids/keys literally 'github'/'jira'/'salesforce' -- not
  // slugifyConnectorKey-derived, and permanently reserved against
  // collision with anything a user could create themselves, see
  // CONNECTED_SOURCE_RESERVED_KEYS, wigwag-core.js) in good shape --
  // does NOT seed them for a fresh install any more (see /home/dev/
  // .claude/plans/encapsulated-waddling-gizmo.md: Tom wants the
  // Connected Sources list to show only what's actually configured, and
  // to support more than one instance per system -- an unconditional
  // "always exactly 3 rows" seed is incompatible with both). A project
  // that already has one or more of these 3 ids (from before this
  // change, or from the one legacy-credential migration below) keeps
  // it; a brand-new install's connectedSources starts empty and the
  // user adds GitHub/Jira/Salesforce (or more than one of any of them)
  // explicitly via "+ Add source", same as a custom connector always
  // had to be.
  //
  // Each kind-tagged entry is config, not a macro -- {rootUrl,
  // username, credentialConfigured} -- matching BUILTIN_INTEGRATIONS'
  // own per-system field set (see its own comment for why the field set
  // differs per system). The actual fetch logic lives in
  // fetchJiraData/fetchSalesforceData/fetchGithubData, hardcoded ports of
  // the real bridges/*.js scripts, not a compiled user macro.
  migrateBuiltinConnectors() {
    const existing = this.state.connectedSources || [];
    // Live-reported bug: a project that already ran under the earlier,
    // now-superseded macro-based architecture (commits 979593f/e9da646,
    // corrected by 80f5003) seeded __builtin_jira/__builtin_salesforce/
    // __builtin_github with real patterns+macro fields -- this function
    // only ever filled in MISSING ids, never migrated an EXISTING one, so
    // those stale fields survived the correction untouched. Left alone,
    // connectorMatches would keep matching a Jira-shaped paste against
    // the stale __builtin_jira entry's own leftover patterns as if it
    // were a real custom connector -- showing up in the "matches more
    // than one connected source" picker even though Jira itself was
    // never configured under the current model. One-time, idempotent
    // cleanup: strip the old macro-shape fields from any EXISTING
    // builtin entry that still carries them, same self-heals-on-next-
    // boot convention as this codebase's other legacy migrations. Also
    // backfills the new `.kind` field onto any of the 3 fixed ids that
    // predate it -- the single source of truth every dispatch site now
    // reads, replacing id-slicing (see the plan above).
    const legacyShapeKeys = ['patterns', 'macro', 'glyph', 'color', 'linkTextTemplate'];
    const migrated = existing.map(c => {
      if (!c.id.startsWith('__builtin_')) return c;
      const kind = c.id.slice('__builtin_'.length);
      const stripped = legacyShapeKeys.some(k => k in c)
        ? (() => { const { patterns, macro, glyph, color, linkTextTemplate, ...cleaned } = c; return { ...cleaned, builtin: true, rootUrl: cleaned.rootUrl || '', username: cleaned.username || '' }; })()
        : c;
      return stripped.kind ? stripped : { ...stripped, kind };
    });
    const anyMigrated = migrated.some((c, i) => c !== existing[i]);
    // githubToken is the ONE real pre-existing credential still worth
    // migrating (it WAS literally the user's GitHub PAT, used directly
    // by the app's own fetch, from before connectedSources existed at
    // all) -- jiraProxySecret/salesforceProxySecret were never real
    // Jira/Salesforce credentials, only a shared secret with a separate
    // local proxy process holding the real ones, invisible to this app,
    // so there's nothing real to migrate for those two. This is the one
    // case that still CREATES a row -- migrating real user data, not
    // seeding an empty placeholder -- gated on "no github-kind entry
    // exists yet" so it only ever fires once, same as the old seeding
    // logic's own idempotency, and is a true no-op for a fresh install
    // (no githubToken, nothing to migrate, nothing created).
    const legacyToken = (this.state.githubToken || '').trim();
    const added = (!migrated.some(c => c.kind === 'github') && legacyToken) ? [{
      id: '__builtin_github', key: 'github', kind: 'github', name: BUILTIN_INTEGRATIONS.github.name, builtin: true,
      rootUrl: BUILTIN_INTEGRATIONS.github.rootUrlDefault || '', username: '', credentialConfigured: false
    }] : [];
    if (!anyMigrated && !added.length) return;
    const next = migrated.concat(added);
    try { localStorage.setItem(CONNECTED_SOURCES_KEY, JSON.stringify({ connectors: next })); }
    catch (e) { console.warn('[tracker] failed to save connected sources:', e); }
    this.state.connectedSources = next;
    if (!added.length || !this.isTauriConnectorRuntime()) return;
    // Migration (copying githubToken into the new entry's OS keychain
    // slot) only runs inside Tauri, since keychain access requires it,
    // and is fired without awaiting -- same non-blocking pattern as
    // warmProjectSummaries -- so a slow keychain round-trip never delays
    // boot. This part runs well after mount (a promise callback), so IT
    // goes through the normal saveConnectedSources/setState path -- but
    // the migration above runs inside runBootSequence, pre-mount, where
    // (per runBootSequence's own comment) this.state must be mutated
    // directly, never via setState.
    this.setConnectorCredential('__builtin_github', legacyToken).then(() => {
      this.saveConnectedSources((this.state.connectedSources || []).map(c => c.id === '__builtin_github' ? { ...c, credentialConfigured: true } : c));
    }).catch(e => console.warn('[tracker] failed to migrate legacy credential for __builtin_github', e));
  }
  // Looks up one of the 3 fixed-id built-in entries migrateBuiltinConnectors
  // preserves, if it still exists (deleting one is now possible -- see
  // deleteConnectorSource -- so unlike before this can legitimately be
  // absent).
  builtinConnector(key) { return (this.state.connectedSources || []).find(c => c.id === '__builtin_' + key); }
  // A built-in is actually usable (claims a paste pattern / is "Connected"
  // in Settings) only once it has a real root URL AND a real credential --
  // existence alone means nothing (a fixed-id row can now be entirely
  // absent, deleted, or newly-added-but-blank). GitHub is the one exception: its
  // real bridge/app-side fetch always allowed anonymous, unauthenticated
  // access (rate-limited, not blocked), so only its root URL needs to be
  // real -- a credential is optional, same as it always was. Delegates to
  // builtinKindConfigured (wigwag-core.js) against resolveFetchConnector
  // (not the bare builtinConnector lookup) -- GitHub must read as
  // configured even with NO row at all, via resolveFetchConnector's own
  // synthetic stand-in (real default rootUrl for github, empty for
  // jira/salesforce), same tolerance every other fetchedVia-based
  // dispatch site already gets; a plain "does a row exist" check would
  // wrongly deny this for a fresh install that's never had
  // migrateBuiltinConnectors seed anything. Signature unchanged --
  // every existing caller (including connectorMatches' own reachability
  // gate) keeps working for the grandfathered rows.
  builtinConfigured(key) {
    return builtinKindConfigured(this.resolveFetchConnector('__builtin_' + key));
  }
  // Connected Sources (Phase 1) macro engine. isTauriConnectorRuntime
  // follows the same window.__TAURI__-namespace feature-detect idiom as
  // isTauriNotificationRuntime/isTauriUpdaterRuntime -- a macro always
  // gets SOME fetch implementation, real browser fetch outside Tauri (so
  // the exact same macro can be hand-tested against a CORS-friendly API
  // without a packaged build) or a shim forwarding to the Rust-side
  // connected_source_fetch command inside it (no CORS restriction at
  // all, since reqwest has no URL-scope of its own -- see
  // src-tauri/src/connected_sources.rs).
  isTauriConnectorRuntime = () => !!(window.__TAURI__ && window.__TAURI__.core);
  connectorFetchShim = () => {
    return async (url, options) => {
      options = options || {};
      const headers = {};
      if (options.headers instanceof Headers) { for (const pair of options.headers.entries()) headers[pair[0]] = pair[1]; }
      else if (options.headers) Object.assign(headers, options.headers);
      console.time('[diag] connector-fetch-ipc ' + url);
      const resp = await window.__TAURI__.core.invoke('connected_source_fetch', {
        url, method: options.method || 'GET', headers,
        body: options.body != null ? String(options.body) : null
      });
      console.timeEnd('[diag] connector-fetch-ipc ' + url);
      return {
        ok: resp.status >= 200 && resp.status < 300, status: resp.status,
        headers: new Headers(resp.headers),
        json: async () => JSON.parse(resp.body), text: async () => resp.body
      };
    };
  };
  // Deliberately NOT wrapped in withRetry (unlike fetchGithubData, the
  // one survivor of the old proxy-fronted fetch functions): that assumes
  // a GET-only, idempotent call safe to retry on 403/429/5xx. An
  // arbitrary user-authored macro can't be assumed idempotent (could be
  // a POST, could have side effects) -- only a timeout guard is
  // appropriate here.
  runConnectorMacro = (macroSource, id, credential) => {
    const fetchImpl = this.isTauriConnectorRuntime() ? this.connectorFetchShim() : window.fetch.bind(window);
    const macroFn = compileConnectorMacro(macroSource)(fetchImpl);
    return this.withTimeout(macroFn(id, credential), 15000);
  };
  getConnectorCredential = (connectorId) => {
    if (!this.isTauriConnectorRuntime()) return Promise.resolve('');
    console.time('[diag] connector-credential-ipc ' + connectorId);
    return window.__TAURI__.core.invoke('connected_source_get_credential', { connectorId }).then(v => v || '').catch(() => '').finally(() => console.timeEnd('[diag] connector-credential-ipc ' + connectorId));
  };
  setConnectorCredential = (connectorId, value) => {
    if (!this.isTauriConnectorRuntime()) return Promise.resolve();
    return window.__TAURI__.core.invoke('connected_source_set_credential', { connectorId, value }).catch(() => {});
  };
  deleteConnectorCredential = (connectorId) => {
    if (!this.isTauriConnectorRuntime()) return Promise.resolve();
    return window.__TAURI__.core.invoke('connected_source_delete_credential', { connectorId }).catch(() => {});
  };
  // Settings UI: Connected sources add/edit form (Phase 1's one
  // remaining piece -- see /home/dev/.claude/plans/encapsulated-waddling-gizmo.md).
  // A fresh draft each time the form opens -- editing an EXISTING
  // connector never mutates this.state.connectedSources directly, only
  // saveConnectorForm commits, mirroring every other immutable-draft
  // form in this codebase (addRuleRow/updateRuleRow/removeRuleRow).
  openAddSourceTypePicker() { this.setState({ addSourceTypePickerOpen: true }); }
  closeAddSourceTypePicker() { this.setState({ addSourceTypePickerOpen: false }); }
  // "+ Add source" opens this picker first (Jira/GitHub/Salesforce/Blank
  // custom), rather than jumping straight to a blank draft -- each option
  // seeds the SAME draft shape openAddConnectorForm below builds, just
  // pre-filled from CONNECTOR_TEMPLATES. "Blank custom" reuses the blank
  // template so there's one code path, not two.
  startConnectorFromTemplate(kind) {
    const tpl = CONNECTOR_TEMPLATES[kind] || CONNECTOR_TEMPLATES.blank;
    this.setState({
      addSourceTypePickerOpen: false, connectorFormVisible: false,
      connectorFormOpen: { id: null, draft: { name: tpl.name, glyph: tpl.glyph, color: tpl.color,
        patterns: tpl.patterns.map(p => ({ ...p })), macro: tpl.macro, credentialDraft: '',
        hasCredential: false, linkTextTemplate: tpl.linkTextTemplate || '' }, testId: '', testResult: null, testRunning: false }
    });
    // Mount off-screen first (connectorFormVisible still false), THEN
    // flip visible one tick later so the slide-in transform actually
    // animates from its start position instead of snapping -- same
    // idiom as openSlideOver (wigwag-app.js, search slideOverVisible).
    setTimeout(() => this.setState({ connectorFormVisible: true }), 20);
  }
  openEditConnectorForm(id) {
    const c = (this.state.connectedSources || []).find(x => x.id === id);
    if (!c) return;
    this.setState({ connectorFormVisible: false, connectorFormOpen: { id, draft: { name: c.name, glyph: c.glyph, color: c.color, patterns: (c.patterns || []).map(p => ({ regex: p.regex, label: p.label })), macro: c.macro, credentialDraft: '', hasCredential: !!c.credentialConfigured, linkTextTemplate: c.linkTextTemplate || '' }, testId: '', testResult: null, testRunning: false } });
    setTimeout(() => this.setState({ connectorFormVisible: true }), 20);
  }
  updateConnectorDraft(patch) {
    if (!this.state.connectorFormOpen) return;
    this.setState(s => ({ connectorFormOpen: s.connectorFormOpen ? { ...s.connectorFormOpen, draft: { ...s.connectorFormOpen.draft, ...patch } } : null }));
  }
  addConnectorPattern() {
    if (!this.state.connectorFormOpen) return;
    this.updateConnectorDraft({ patterns: this.state.connectorFormOpen.draft.patterns.concat([{ regex: '', label: '' }]) });
  }
  updateConnectorPattern(i, patch) {
    if (!this.state.connectorFormOpen) return;
    const patterns = this.state.connectorFormOpen.draft.patterns.slice();
    if (!patterns[i]) return;
    patterns[i] = { ...patterns[i], ...patch };
    this.updateConnectorDraft({ patterns });
  }
  removeConnectorPattern(i) {
    if (!this.state.connectorFormOpen) return;
    const patterns = this.state.connectorFormOpen.draft.patterns.slice();
    patterns.splice(i, 1);
    this.updateConnectorDraft({ patterns });
  }
  resolveTestInputId(rawInput, patterns) {
    const t = (rawInput || '').trim();
    if (!t) return { id: t, matchedPattern: false };
    for (const p of patterns || []) {
      if (!p.regex || !p.regex.trim()) continue;
      let re;
      try { re = new RegExp('^(?:' + p.regex + ')$'); } catch (e) { continue; }
      const m = re.exec(t);
      if (m) return { id: (m[1] || m[0]), matchedPattern: true };
    }
    return { id: t, matchedPattern: false };
  }
  onConnectorTestIdChange(v) {
    if (!this.state.connectorFormOpen) return;
    this.setState(s => ({ connectorFormOpen: s.connectorFormOpen ? { ...s.connectorFormOpen, testId: v, testResult: null } : null }));
  }
  // Runs the REAL macro against a real typed id, not a dry-run or lint --
  // the real thrown error on a bad field path or wrong auth header is the
  // whole point (runConnectorMacro, same as the dispatch path, is
  // deliberately not try/catch-wrapped itself; this is the one place
  // that needs to catch it, to show it rather than let it reach the UI).
  async runConnectorTest() {
    const f = this.state.connectorFormOpen;
    if (!f || !f.testId.trim() || !f.draft.macro.trim() || f.testRunning) return;
    const resolved = this.resolveTestInputId(f.testId, f.draft.patterns);
    this.setState(s => ({ connectorFormOpen: s.connectorFormOpen ? { ...s.connectorFormOpen, testRunning: true, testResult: null } : null }));
    try {
      const credential = f.draft.credentialDraft.trim() || (f.id ? await this.getConnectorCredential(f.id) : '');
      const data = await this.runConnectorMacro(f.draft.macro, resolved.id, credential);
      this.setState(s => ({ connectorFormOpen: s.connectorFormOpen ? { ...s.connectorFormOpen, testRunning: false, testResult: { ok: true, output: JSON.stringify(data, null, 2), resolvedId: resolved.id, matchedPattern: resolved.matchedPattern } } : null }));
    } catch (err) {
      this.setState(s => ({ connectorFormOpen: s.connectorFormOpen ? { ...s.connectorFormOpen, testRunning: false, testResult: { ok: false, output: err.message, resolvedId: resolved.id, matchedPattern: resolved.matchedPattern } } : null }));
    }
  }
  // Closes the custom connector editor (connectorFormOpen) -- the big
  // sliding modal, Settings shifting off-screen left while this slides
  // in from the right. Built-ins (builtinFormOpen) are a plain small
  // modal now (see cancelBuiltinForm) -- too little content (root URL/
  // username/credential) to earn the bigger sliding treatment Tom felt
  // was silly for them specifically. Flip invisible immediately (the
  // slide-out transform starts), THEN clear the slot 280ms later --
  // matching the transition duration -- so the element stays mounted
  // long enough to actually finish animating out. The s.connectorFormVisible
  // guard protects against a rapid re-open during that window (same idiom
  // as closeSlideOver).
  cancelConnectorForm() {
    this.setState({ connectorFormVisible: false });
    setTimeout(() => this.setState(s => (s.connectorFormVisible ? {} : { connectorFormOpen: null })), 280);
  }
  // Built-in editor (GitHub/Jira/Salesforce): root URL/username/credential
  // config, not a macro -- see BUILTIN_INTEGRATIONS. A plain small modal,
  // not the custom connector editor's sliding chrome (see
  // cancelConnectorForm's own comment) -- opens/closes immediately, no
  // animation state to coordinate. `id: null` opens a blank draft for a
  // NEW instance of `kind` (rootUrl pre-filled from its real default --
  // same real-world default BUILTIN_INTEGRATIONS/resolveFetchConnector
  // use elsewhere); `id` set edits that existing instance, draft started
  // from its real, currently-saved config -- today's behavior unchanged.
  openBuiltinSourceForm({ id, kind }) {
    // Looked up by the passed id directly (not builtinConnector(kind)'s
    // fixed-id lookup) -- a second real instance of a kind has its own
    // conn_<...> id, not __builtin_<kind>, and must still open correctly
    // for re-editing.
    const c = id ? (this.state.connectedSources || []).find(x => x.id === id) : null;
    if (id && !c) return;
    const spec = BUILTIN_INTEGRATIONS[kind];
    this.setState({
      addSourceTypePickerOpen: false,
      builtinFormOpen: { id, kind, draft: {
        rootUrl: c ? (c.rootUrl || '') : (spec.rootUrlDefault || ''),
        username: c ? (c.username || '') : '',
        credentialDraft: '', hasCredential: c ? !!c.credentialConfigured : false
      } }
    });
  }
  cancelBuiltinForm() {
    this.setState({ builtinFormOpen: null });
  }
  updateBuiltinDraft(patch) {
    if (!this.state.builtinFormOpen) return;
    this.setState(s => ({ builtinFormOpen: s.builtinFormOpen ? { ...s.builtinFormOpen, draft: { ...s.builtinFormOpen.draft, ...patch } } : null }));
  }
  // f.id null creates a brand-new instance of f.kind -- the original
  // __builtin_<kind> id/key scheme is reserved for the one grandfathered
  // row of each kind (see migrateBuiltinConnectors) and never reused, so
  // a new instance gets the same conn_<timestamp><rand> id + slugified
  // key scheme saveConnectorForm already uses for custom connectors.
  async saveBuiltinForm() {
    const f = this.state.builtinFormOpen;
    if (!f) return;
    const rootUrl = f.draft.rootUrl.trim();
    const username = (f.draft.username || '').trim();
    const credentialTyped = f.draft.credentialDraft.trim();
    const existing = this.state.connectedSources || [];
    const id = f.id || ('conn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    let next;
    if (f.id) {
      next = existing.map(c => c.id === id ? { ...c, rootUrl, username, credentialConfigured: credentialTyped ? true : c.credentialConfigured } : c);
    } else {
      const spec = BUILTIN_INTEGRATIONS[f.kind];
      const key = slugifyConnectorKey(spec.name, existing.map(c => c.key));
      next = existing.concat([{ id, key, kind: f.kind, name: spec.name, builtin: true, rootUrl, username, credentialConfigured: !!credentialTyped, enabled: true }]);
    }
    if (credentialTyped) await this.setConnectorCredential(id, credentialTyped);
    this.saveConnectedSources(next);
    this.cancelBuiltinForm();
  }
  // Validates (non-blank name/macro, every non-blank pattern actually
  // compiles) and re-checks defensively even though the Save button's
  // own styling already reflects this -- same no-real-disabled-attribute,
  // guard-in-the-handler convention as deleteProject/onConfirmDeleteProject.
  // key is immutable once set (slugifyConnectorKey only runs for a brand
  // new connector) so existing rules referencing source.<key> never break
  // on a rename. The credential is only (re)written to the keychain when
  // the user actually typed something new -- an edit that leaves it blank
  // never clobbers an already-stored secret -- and credentialDraft is
  // never itself persisted into this.state.connectedSources, only the
  // cached credentialConfigured boolean is.
  async saveConnectorForm() {
    const f = this.state.connectorFormOpen;
    if (!f) return;
    const draft = f.draft;
    const name = draft.name.trim();
    const macro = draft.macro.trim();
    if (!name || !macro) return;
    for (const p of draft.patterns) {
      if (!p.regex.trim()) continue;
      try { new RegExp(p.regex); } catch (e) { return; }
    }
    const existing = this.state.connectedSources || [];
    const existingRecord = f.id ? existing.find(c => c.id === f.id) : null;
    const key = existingRecord ? existingRecord.key : slugifyConnectorKey(name, existing.map(c => c.key));
    const id = f.id || ('conn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    const credentialTyped = draft.credentialDraft.trim();
    const record = {
      id, key, name, glyph: (draft.glyph || name[0] || '?').slice(0, 2), color: draft.color,
      patterns: draft.patterns.filter(p => p.regex.trim()).map(p => ({ regex: p.regex.trim(), label: p.label.trim() })),
      macro, credentialConfigured: credentialTyped ? true : draft.hasCredential,
      linkTextTemplate: (draft.linkTextTemplate || '').trim()
    };
    const next = existingRecord ? existing.map(c => c.id === f.id ? record : c) : existing.concat([record]);
    if (credentialTyped) await this.setConnectorCredential(id, credentialTyped);
    this.saveConnectedSources(next);
    // Same slide-out-then-unmount sequencing as cancelConnectorForm.
    this.setState({ connectorFormVisible: false });
    setTimeout(() => this.setState(s => (s.connectorFormVisible ? {} : { connectorFormOpen: null })), 280);
  }
  deleteConnectorSource(id) {
    const next = (this.state.connectedSources || []).filter(c => c.id !== id);
    this.saveConnectedSources(next);
    this.deleteConnectorCredential(id);
    this.setState({ connectorFormVisible: false });
    setTimeout(() => this.setState(s => (s.connectorFormVisible ? {} : { connectorFormOpen: null })), 280);
  }
  // A retryable failure is a timeout, a network-level rejection (no
  // .status at all -- a real fetch() failure, not an HTTP error
  // response), or an HTTP 403/429/5xx. A 404 (issue genuinely gone/
  // moved) and any other 4xx fail fast -- retrying those would just
  // waste the attempt budget on something that will never resolve.
  async withRetry(fn, { maxRetries, baseDelayMs, timeoutMs, onRetry } = {}) {
    const retries = maxRetries != null ? maxRetries : 3;
    const base = baseDelayMs != null ? baseDelayMs : (window.__wigwagRefreshRetryBaseMs || 1000);
    const timeout = timeoutMs != null ? timeoutMs : (window.__wigwagRefreshTimeoutMs || 15000);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.withTimeout(fn(), timeout);
      } catch (err) {
        const status = err && err.status;
        const isTimeout = !!(err && err.isTimeout);
        // A config error (e.g. "no proxy URL configured") throws
        // synchronously with no .status -- indistinguishable from a
        // real network-level rejection by that check alone, so it used
        // to get the full retry/backoff treatment even though retrying
        // can never fix a missing setting. Callers that know their
        // failure is a config problem, not a network one, mark it
        // nonRetryable so it fails fast instead.
        const nonRetryable = !!(err && err.nonRetryable);
        const retryable = !nonRetryable && (isTimeout || !status || status === 403 || status === 429 || (status >= 500 && status < 600));
        if (attempt >= retries || !retryable) throw err;
        if (onRetry) onRetry({ attempt, status, isTimeout });
        await new Promise(r => setTimeout(r, base * Math.pow(2, attempt) + Math.random() * 300));
      }
    }
  }
  // The 3 built-in fetch functions below are hardcoded ports of the real
  // bridges/jira-proxy.js, salesforce-proxy.js, github-data-proxy.js
  // scripts -- same REST calls, same field selection, same result shape
  // (so buildSource's existing pickJiraFields/pickSalesforceFields need
  // no changes at all) -- just running in-process against
  // connectorFetchShim's Tauri IPC (no CORS restriction) instead of a
  // separate local proxy holding the credentials. Jira/Salesforce built-in
  // linking is Tauri-only (confirmed with Tom): both require a credential
  // to do anything at all, and that credential lives in the OS keychain,
  // which only Tauri can reach -- there's no meaningful "direct browser
  // fetch" fallback left to offer. GitHub is NOT Tauri-only -- see
  // fetchGithubData's own comment for why.
  requireTauriBuiltin() {
    if (!this.isTauriConnectorRuntime()) throw Object.assign(new Error('Requires the desktop app'), { nonRetryable: true });
  }
  // Unlike Jira/Salesforce, GitHub's own real pre-retirement behavior
  // (and bridges/github-data-proxy.js before that) never needed Tauri or
  // a proxy for the common case: api.github.com sends CORS headers
  // permitting a direct, anonymous browser fetch (rate-limited, not
  // blocked) -- there's no credential requirement to gate on. Only a
  // CONFIGURED credential (optional, for higher rate limits/private
  // repos) needs Tauri, since it's stored in the OS keychain --
  // getConnectorCredential already degrades to '' outside Tauri on its
  // own, so the only other Tauri-specific piece is routing the fetch
  // itself through connectorFetchShim's IPC instead of a plain fetch()
  // (mirrors runConnectorMacro's own identical fetchImpl selection).
  async fetchGithubData(owner, repo, num, forceRefresh, connectorId) {
    connectorId = connectorId || '__builtin_github';
    const cacheKey = connectorId + ':' + owner + '/' + repo + '#' + num;
    if (!this.githubCache) this.githubCache = new Map();
    if (!forceRefresh && this.githubCache.has(cacheKey)) return this.githubCache.get(cacheKey);
    const cfg = (this.state.connectedSources || []).find(c => c.id === connectorId);
    const rootUrl = ((cfg && cfg.rootUrl) || 'https://api.github.com').trim().replace(/\/$/, '');
    // GitHub alone allows anonymous, unauthenticated access (rate-limited,
    // not blocked) -- a credential is optional, same as it always was.
    const credential = await this.getConnectorCredential(connectorId);
    const headers = { Accept: 'application/vnd.github+json' };
    if (credential) headers.Authorization = 'Bearer ' + credential;
    const fetchImpl = this.isTauriConnectorRuntime() ? this.connectorFetchShim() : window.fetch.bind(window);
    const res = await fetchImpl(rootUrl + '/repos/' + owner + '/' + repo + '/issues/' + num, { headers });
    if (!res.ok) throw Object.assign(new Error('GitHub API returned ' + res.status), { status: res.status });
    const data = await res.json();
    const isPullRequest = !!data.pull_request;
    const result = {
      title: data.title,
      labels: (data.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
      state: data.state,
      isPullRequest,
      description: data.body || '',
      key: owner + '/' + repo + '#' + num,
      status: data.state || '',
      statusCategory: data.state === 'closed' ? 'done' : 'new',
      issueType: isPullRequest ? 'Pull Request' : 'Issue',
      assignees: (data.assignees || []).map(a => a.login),
      reporter: (data.user && data.user.login) || '',
      created: data.created_at || '',
      updated: data.updated_at || '',
      resolution: data.state_reason || '',
      resolutionDate: data.closed_at || '',
      fixVersions: data.project ? [data.project.title] : [],
      project: owner + '/' + repo
    };
    this.githubCache.set(cacheKey, result);
    return result;
  }
  // Whichever credential pair is present picks Cloud (Basic, API v3) vs.
  // Server/Data Center (Bearer PAT, API v2) -- mirrors jira-proxy.js's own
  // authConfig() exactly.
  async fetchJiraData(key, connectorId) {
    connectorId = connectorId || '__builtin_jira';
    this.requireTauriBuiltin();
    const cfg = (this.state.connectedSources || []).find(c => c.id === connectorId);
    const rootUrl = ((cfg && cfg.rootUrl) || '').trim().replace(/\/$/, '');
    if (!rootUrl) throw Object.assign(new Error('no Jira base URL configured — see Settings'), { nonRetryable: true });
    const credential = await this.getConnectorCredential(connectorId);
    if (!credential) throw Object.assign(new Error('no Jira credential configured — see Settings'), { nonRetryable: true });
    const username = ((cfg && cfg.username) || '').trim();
    const authHeader = username ? 'Basic ' + btoa(username + ':' + credential) : 'Bearer ' + credential;
    const apiVersion = username ? '3' : '2';
    const FIELDS = ['summary', 'description', 'labels', 'status', 'issuetype', 'priority',
      'assignee', 'reporter', 'created', 'updated', 'duedate', 'resolution',
      'resolutiondate', 'components', 'fixVersions', 'project'].join(',');
    const fetchImpl = this.connectorFetchShim();
    const res = await fetchImpl(rootUrl + '/rest/api/' + apiVersion + '/issue/' + encodeURIComponent(key) + '?fields=' + FIELDS, {
      headers: { Authorization: authHeader, Accept: 'application/json' }
    });
    if (!res.ok) throw Object.assign(new Error('Jira returned ' + res.status), { status: res.status });
    const data = await res.json();
    const f = data.fields || {};
    return {
      title: f.summary || key,
      description: adfToText(f.description).trim(),
      labels: f.labels || [],
      browseUrl: rootUrl + '/browse/' + key,
      key,
      status: (f.status && f.status.name) || '',
      statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || '',
      issueType: (f.issuetype && f.issuetype.name) || '',
      priority: (f.priority && f.priority.name) || '',
      assignee: (f.assignee && f.assignee.displayName) || '',
      reporter: (f.reporter && f.reporter.displayName) || '',
      created: f.created || '',
      updated: f.updated || '',
      dueDate: f.duedate || '',
      resolution: (f.resolution && f.resolution.name) || '',
      resolutionDate: f.resolutiondate || '',
      components: (f.components || []).map(c => c.name),
      fixVersions: (f.fixVersions || []).map(v => v.name),
      project: (f.project && f.project.key) || ''
    };
  }
  // The older SOAP login() call -- no Connected App needed at all, just
  // username/password/security-token (the same thing tools like
  // simple-salesforce default to, and what Tom specifically asked for --
  // ported from salesforce-proxy.js's own soapFlowAuth). Returns a session
  // Id that works directly as a REST API Bearer token, plus a serverUrl
  // whose origin is the instance URL for subsequent calls. Cached
  // in-memory (per app session, not persisted) until a downstream 401
  // forces a re-authentication -- Salesforce's login call doesn't hand
  // back an expiry.
  async salesforceAuth(forceRefresh, connectorId) {
    connectorId = connectorId || '__builtin_salesforce';
    if (!this._sfAuthCacheByConnector) this._sfAuthCacheByConnector = {};
    if (this._sfAuthCacheByConnector[connectorId] && !forceRefresh) return this._sfAuthCacheByConnector[connectorId];
    const cfg = (this.state.connectedSources || []).find(c => c.id === connectorId);
    const loginUrl = ((cfg && cfg.rootUrl) || 'https://login.salesforce.com').trim().replace(/\/$/, '');
    const username = (cfg && cfg.username || '').trim();
    if (!username) throw Object.assign(new Error('no Salesforce username configured — see Settings'), { nonRetryable: true });
    const credential = await this.getConnectorCredential(connectorId);
    if (!credential) throw Object.assign(new Error('no Salesforce credential configured — see Settings'), { nonRetryable: true });
    const envelope = '<?xml version="1.0" encoding="utf-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">' +
      '<soapenv:Body><urn:login><urn:username>' + escapeXml(username) + '</urn:username>' +
      '<urn:password>' + escapeXml(credential) + '</urn:password></urn:login></soapenv:Body></soapenv:Envelope>';
    const fetchImpl = this.connectorFetchShim();
    const res = await fetchImpl(loginUrl + '/services/Soap/u/59.0', {
      method: 'POST', headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: 'login' }, body: envelope
    });
    const text = await res.text();
    const sessionId = (text.match(/<sessionId>([\s\S]*?)<\/sessionId>/) || [])[1];
    const serverUrl = (text.match(/<serverUrl>([\s\S]*?)<\/serverUrl>/) || [])[1];
    if (!res.ok || !sessionId || !serverUrl) {
      const fault = (text.match(/<faultstring>([\s\S]*?)<\/faultstring>/) || [])[1];
      throw new Error('Salesforce login failed' + (fault ? ': ' + fault : ''));
    }
    this._sfAuthCacheByConnector[connectorId] = { accessToken: sessionId, instanceUrl: new URL(serverUrl).origin };
    return this._sfAuthCacheByConnector[connectorId];
  }
  // Compact-layout fields only (the record's admin-configured Compact
  // Layout, same as a record's default card view) -- the real bridge also
  // offers an auto-describe mode that fetches EVERY field on the object
  // (two extra, cacheable describe calls), deliberately not ported here to
  // keep this first in-process version simple; Compact-only is also
  // exactly what the real bridge itself falls back to when its own
  // describe calls fail, so it's a real, intentional mode, not a half
  // implementation.
  async fetchSalesforceData(id, connectorId) {
    this.requireTauriBuiltin();
    let auth = await this.salesforceAuth(false, connectorId);
    const fetchImpl = this.connectorFetchShim();
    const fetchRecord = (a) => fetchImpl(
      a.instanceUrl + '/services/data/v59.0/ui-api/records/' + encodeURIComponent(id) + '?layoutTypes=Compact&modes=View',
      { headers: { Authorization: 'Bearer ' + a.accessToken, Accept: 'application/json' } }
    );
    let res = await fetchRecord(auth);
    if (res.status === 401) { auth = await this.salesforceAuth(true, connectorId); res = await fetchRecord(auth); }
    if (!res.ok) throw Object.assign(new Error('Salesforce returned ' + res.status), { status: res.status });
    const body = await res.json();
    const rawFields = body.fields || {};
    const flat = {};
    for (const k in rawFields) {
      const f = rawFields[k];
      flat[k] = (f && typeof f === 'object') ? (f.displayValue != null ? f.displayValue : (f.value != null ? f.value : '')) : (f || '');
    }
    const objectType = body.apiName || '';
    return {
      id, objectType,
      name: flat.Name || flat.Subject || flat.CaseNumber || id,
      status: flat.Status || flat.StageName || '',
      owner: flat.Owner || '',
      url: auth.instanceUrl + '/lightning/r/' + (objectType || 'Record') + '/' + id + '/view',
      lastModified: body.lastModifiedDate || '',
      fields: flat
    };
  }
  // Replaces sameLink/sameJiraLink/sameSalesforceLink/sameConnectorLink
  // -- one comparison for every system now that they all persist the
  // same {href, fetchedVia} shape. href isn't always directly
  // comparable pre-fetch (jira/salesforce/a custom connector only
  // learn their real href FROM the fetch -- see connectorMatches' own
  // comment), so this compares matchedId instead, re-deriving the
  // existing ref's own matchedId from its persisted href via
  // matchedIdFromHref when it isn't carried directly on the ref
  // itself (a legacy connector ref, or a failed-fetch error-path
  // write for any system, still carries its own bare matchedId
  // precisely so a retry is recognized as a retry, not a brand-new
  // link -- see applyLinkToField's own catch block).
  sameRef(ref, fetchedVia, matchedId) {
    const n = normalizeRef(ref);
    if (!n || n.fetchedVia !== fetchedVia) return false;
    const existingMatchedId = n.matchedId !== undefined ? n.matchedId : this.matchedIdFromHref(fetchedVia, n.href);
    return JSON.stringify(existingMatchedId) === JSON.stringify(matchedId);
  }
  // Given a normalized ref's fetchedVia + href, re-derives the
  // "matchedId" a fresh paste/refresh would use to re-fetch this same
  // link -- the inverse of each builtin's own shape-recognition regex
  // (parseGithubUrl/parseJiraKey/parseSalesforceId, reused directly --
  // deliberately UNGATED, since re-deriving an EXISTING ref's own
  // identity must work regardless of current Tauri/configuration
  // state, unlike the public gated matchers used for NEW paste-
  // dispatch). For a custom connector, re-runs ITS OWN current
  // patterns against href (patterns can change after the fact; the
  // connector itself, not a stale capture, is the source of truth) --
  // falls back to the raw href itself if no pattern currently
  // matches, same honesty discipline the Test button already has
  // (never silently drop the only identifying string on hand).
  // Resolves the connector behind a persisted fetchedVia for fetch/
  // refresh dispatch -- a real connectedSources entry when one exists,
  // or (for the 3 grandfathered ids specifically) a synthetic stand-in
  // carrying the right kind/name even when NO row has ever been seeded
  // for it. GitHub/Jira/Salesforce dispatch has always tolerated this
  // (fetchGithubData/fetchJiraData/salesforceAuth already degrade
  // gracefully from a missing/blank cfg on their own, and a project
  // with nothing configured never had a connectedSources row for them
  // even before migrateBuiltinConnectors stopped auto-seeding) -- this
  // is that same tolerance, centralized, so every fetchedVia-based
  // lookup (matchedIdFromHref, stageFieldRefresh, refreshField,
  // applyLinkToField) sees one real-or-synthetic connector object
  // instead of re-deriving kind from the id string itself.
  resolveFetchConnector(fetchedVia) {
    const c = (this.state.connectedSources || []).find(x => x.id === fetchedVia);
    if (c) return c;
    if (fetchedVia === '__builtin_github' || fetchedVia === '__builtin_jira' || fetchedVia === '__builtin_salesforce') {
      const kind = fetchedVia.slice('__builtin_'.length);
      const spec = BUILTIN_INTEGRATIONS[kind];
      // Carries the exact same default rootUrl migrateBuiltinConnectors
      // used to seed unconditionally pre-redesign -- real for GitHub
      // ('https://api.github.com', needing no further setup to be
      // reachable), empty for Jira/Salesforce (which genuinely need a
      // user-entered root URL + credential before builtinKindConfigured
      // calls them configured).
      return { id: fetchedVia, key: kind, kind, name: spec.name, builtin: true, rootUrl: spec.rootUrlDefault || '', username: '', credentialConfigured: false };
    }
    return null;
  }
  matchedIdFromHref(fetchedVia, href) {
    if (!href) return null;
    const c = this.resolveFetchConnector(fetchedVia);
    if (!c) return null;
    if (c.kind === 'github') return this.parseGithubUrl(href);
    if (c.kind === 'jira') return this.parseJiraKey(href);
    if (c.kind === 'salesforce') return this.parseSalesforceId(href);
    for (const p of c.patterns || []) {
      let re;
      try { re = new RegExp('^(?:' + p.regex + ')$'); } catch (e) { continue; }
      const m = re.exec(href);
      if (m) return m[1] || m[0];
    }
    return href; // no pattern currently matches -- fall back to the raw href
  }
  // Best-known matchedId for DISPLAY purposes only (buildTextCell's
  // refLabel, editValueForRef's edit-affordance value) -- NOT used for
  // sameRef/retry comparison, which has its own narrower matchedId-via-
  // href-only derivation (matchedIdFromHref alone). A legacy jira/
  // salesforce ref that was NEVER successfully resolved (no browseUrl/
  // url yet) has no href for matchedIdFromHref to re-parse, but its own
  // bare key/id IS sitting right there on the raw ref, unused --
  // confirmed regression, caught by external-auth.spec.js's own "legacy
  // seed Jira reference (never live-fetched) still renders as a plain
  // unlinked chip" coverage, which needs the bare key shown even with
  // no href at all.
  resolveMatchedIdForDisplay(ref, n) {
    if (!n) return null;
    if (n.matchedId !== undefined) return n.matchedId;
    const viaHref = this.matchedIdFromHref(n.fetchedVia, n.href);
    if (viaHref != null) return viaHref;
    return ref.key || ref.id || null;
  }
  // Shared fetch core for applyLinkToField (single-row write) and
  // stageFieldRefresh (staged/bulk, pure compute) below -- given a
  // resolved fetchedVia + matchedId (+ the live connector object
  // itself for a custom connector -- callers resolve it by id first
  // so they can report "no longer exists" distinctly before even
  // attempting a fetch), returns the live fetch result plus the href
  // to persist. github/jira/salesforce are withRetry-wrapped (the
  // retryable-error handling both call sites already needed); a
  // custom connector's own macro is NOT (an arbitrary macro can't be
  // assumed idempotent -- runConnectorMacro's own 15s timeout is the
  // only guard, same as always). fetchCache, when given, dedupes a
  // repeat fetch of the exact same identity within one bulk-refresh
  // job.
  async fetchLinkData(fetchedVia, matchedId, connector, { onRetry, fetchCache } = {}) {
    const cacheKey = fetchedVia + ':' + JSON.stringify(matchedId);
    if (fetchCache && fetchCache.has(cacheKey)) return fetchCache.get(cacheKey);
    let data, href;
    const kind = connector && connector.kind;
    if (kind === 'github') {
      data = await this.withRetry(() => this.fetchGithubData(matchedId.owner, matchedId.repo, matchedId.num, true, connector.id), { onRetry });
      href = 'https://github.com/' + matchedId.owner + '/' + matchedId.repo + '/issues/' + matchedId.num;
    } else if (kind === 'jira') {
      data = await this.withRetry(() => this.fetchJiraData(matchedId, connector.id), { onRetry });
      href = data.browseUrl || null;
    } else if (kind === 'salesforce') {
      data = await this.withRetry(() => this.fetchSalesforceData(matchedId, connector.id), { onRetry });
      href = data.url || null;
    } else {
      const credential = await this.getConnectorCredential(connector.id);
      data = await this.runConnectorMacro(connector.macro, matchedId, credential);
      href = data.url || null;
    }
    const result = { data, href };
    if (fetchCache) fetchCache.set(cacheKey, result);
    return result;
  }
  // Tracker #198: pure fetch+compute for ONE linked field against a
  // plain SNAPSHOT issue (never this.state directly) -- returns what
  // WOULD be written, writes nothing itself. Mirrors
  // applyLinkToField/applyWigwagLinkToField's own success-path
  // value/no-op logic exactly. Used by the staged refresh job path
  // (2+ rows); the 1-row direct-apply path still uses applyLinkToField.
  // Fetches and applies live data for ONE linked field against the
  // accumulating issue a row-level refresh is building up (never live
  // this.state) -- returns the updated issue plus (for a field that
  // isn't itself bound) the prose entry for ITS OWN link having
  // changed. A BOUND field that also carries its own real (row-based
  // "copy field") ref still gets fetched and cascaded here -- that's
  // the only way anything bound to IT in turn ever sees live source
  // data -- but never produces its own entry; its change is reported
  // exactly once, by the row-level diff run after every hop settles.
  // fetchCache dedupes a repeat fetch of the same underlying resource
  // within one row (a bound field's copied ref is often identical to
  // its source's), so a multi-hop chain doesn't multiply real network
  // calls/rate-limit exposure per hop.
  async stageFieldRefresh(issue, colId, ref, fieldDefsForRules, onRetry, fetchCache) {
    const fieldLabel = (fieldDefsForRules[colId] && fieldDefsForRules[colId].label) || colId;
    const isBound = !!(fieldDefsForRules[colId] && fieldDefsForRules[colId].linkedSourceId);
    if (ref.system === 'wigwag') {
      const resolved = this.resolveWigwagRef(ref);
      const fieldRef = { system: 'wigwag', projectId: this.resolveWigwagProjectId(ref), issueId: ref.issueId || null, from: ref.from || null, path: ref.path || null, ref: ref.ref || null };
      const beforeFieldRef = issue.fieldRefs && issue.fieldRefs[colId];
      const beforeValue = issue.values[colId];
      const unchanged = !!beforeFieldRef && JSON.stringify(beforeFieldRef) === JSON.stringify(fieldRef) && beforeValue === resolved.label;
      const rootEntry = (!isBound && !unchanged) ? { field: colId, text: 'Linked ' + fieldLabel + ' to a wigwag project', value: resolved.label, fieldRef } : null;
      const patchedIssue = { ...issue, values: { ...issue.values, [colId]: resolved.label }, fieldRefs: { ...issue.fieldRefs, [colId]: fieldRef } };
      const afterIssue = settleLinkedRules(patchedIssue, fieldDefsForRules, this.liveRuleCtx(issue.id));
      return { failed: false, afterIssue, rootEntry };
    }
    const n = normalizeRef(ref);
    if (!n || !n.fetchedVia) return { failed: true, errorText: 'Could not refresh: link no longer resolvable' };
    const connector = this.resolveFetchConnector(n.fetchedVia);
    if (!connector) return { failed: true, errorText: 'Could not refresh: connector no longer exists' };
    const kind = connector.kind;
    const isBuiltin = !!kind;
    const systemLabel = connector.name;
    const matchedId = n.matchedId !== undefined ? n.matchedId : this.matchedIdFromHref(n.fetchedVia, n.href);
    let fetched;
    try {
      fetched = await this.fetchLinkData(n.fetchedVia, matchedId, connector, { onRetry, fetchCache });
    } catch (err) {
      return { failed: true, errorText: 'Could not fetch from ' + systemLabel + ' (' + err.message + ')' };
    }
    const { data, href } = fetched;
    // See applyLinkToField's own fieldRef comment -- matchedId is kept
    // for a custom connector (identity, not rich per-system data) since
    // its href has no guaranteed relationship to its own paste pattern.
    const fieldRef = isBuiltin ? { href, fetchedVia: n.fetchedVia } : { href, fetchedVia: n.fetchedVia, matchedId };
    const value = kind === 'salesforce' ? data.name : data.title;
    const beforeValue = issue.values[colId];
    const beforeFieldRef = issue.fieldRefs && issue.fieldRefs[colId];
    // Compares against the NORMALIZED before-ref, not the raw one -- a
    // legacy-shaped ref migrating to the new {href, fetchedVia} shape
    // with the exact same identity/value is purely a representation
    // change, not real news from the source system, so it must not
    // surface as a spurious "refreshed" entry (confirmed: this was a
    // real regression caught by row-selection.spec.js's own no-op-
    // refresh coverage -- every pre-existing legacy-shaped link would
    // otherwise show as "changed" on its first touch after this
    // redesign). When unchanged, no entry is appended at all (append-
    // only history is the only thing that actually persists state), so
    // a legacy ref that never changes simply keeps its legacy shape on
    // disk forever, read correctly via normalizeRef every time -- it
    // only actually migrates to the new shape the next time a REAL
    // value/href change gives it something worth writing anyway.
    const unchanged = value === beforeValue && JSON.stringify(fieldRef) === JSON.stringify(normalizeRef(beforeFieldRef));
    const rootEntry = (!isBound && !unchanged) ? { field: colId, text: fieldLabel + ' refreshed from ' + systemLabel, value, fieldRef } : null;
    const patchedIssue = { ...issue, values: { ...issue.values, [colId]: value }, fieldRefs: { ...issue.fieldRefs, [colId]: fieldRef } };
    const liveKey = isBuiltin ? kind : connector.key;
    const afterIssue = settleLinkedRules(applyLiveLinkedRules(patchedIssue, fieldDefsForRules, colId, liveKey, data, this.liveRuleCtx(issue.id)), fieldDefsForRules, this.liveRuleCtx(issue.id));
    return { failed: false, afterIssue, rootEntry };
  }
  // Stages every linked field on ONE issue (snapshot, never live state).
  // Row-level failure semantics: if ANY linked field on this row could
  // not be fetched after retries, the WHOLE row is excluded from the
  // merge -- a consistent, all-or-nothing-per-row outcome ("this issue
  // could not be fully refreshed, try again") rather than a partially-
  // refreshed issue with some fields silently stale. Threads ONE
  // accumulating issue through every linked field in fieldDefs order
  // (matching refreshRow's own single-row equivalent) so a field bound
  // to an earlier one in this same pass sees its just-propagated
  // fieldRef/value -- the only way a multi-hop chain's second+ hop ever
  // gets live source data during a staged refresh.
  async stageRefreshRow(issue, fieldDefsForRules, onRetry) {
    const beforeIds = latestEntryIdsByField(issue);
    const initialValues = issue.values;
    let afterIssue = issue;
    const rootEntries = [];
    const fetchCache = new Map();
    for (const colId in fieldDefsForRules) {
      const ref = afterIssue.fieldRefs && afterIssue.fieldRefs[colId];
      if (!ref) continue;
      const result = await this.stageFieldRefresh(afterIssue, colId, ref, fieldDefsForRules, onRetry, fetchCache);
      if (result.failed) return { id: issue.id, failed: true, errorText: result.errorText };
      afterIssue = result.afterIssue;
      if (result.rootEntry) rootEntries.push(result.rootEntry);
    }
    const entries = rootEntries.slice();
    for (const e of computeDerivedChangeEntries(afterIssue, initialValues, fieldDefsForRules)) entries.push({ field: e.colId, text: e.text, value: e.value, fieldRef: e.fieldRef || null, origin: 'derived' });
    const withIds = entries.map(entry => ({ ...entry, preMergeLocalEntryId: beforeIds[entry.field] || null }));
    return withIds.length ? { id: issue.id, failed: false, entries: withIds } : null;
  }
  // nothing changed at all (including the applyWigwagLinkToField no-op
  // case now that it diffs too).
  async refreshField(issueId, colId) {
    const iss = this.findIssue(issueId);
    const ref = iss && iss.fieldRefs && iss.fieldRefs[colId];
    if (!ref) return null;
    const beforeIds = latestEntryIdsByField(iss);
    if (ref.system === 'wigwag') {
      this.applyWigwagLinkToField(issueId, colId, { projectId: ref.projectId, issueId: ref.issueId, from: ref.from, path: ref.path, ref: ref.ref });
    } else {
      const n = normalizeRef(ref);
      if (n && n.fetchedVia) {
        const matchedId = n.matchedId !== undefined ? n.matchedId : this.matchedIdFromHref(n.fetchedVia, n.href);
        const connector = this.resolveFetchConnector(n.fetchedVia);
        const kind = connector && connector.kind;
        const isBuiltin = !!kind;
        // Tracker: a field originally linked via a built-in (Jira/
        // Salesforce) that Tom has since disabled (cleared its root
        // URL/credential) in favour of a custom connector matching the
        // same identifier would otherwise keep dispatching to the dead
        // built-in on every refresh forever -- fieldRefs are
        // historical/immutable, so a ref's own fetchedVia never
        // updates itself just because the matching system changed.
        // Re-resolve against the currently configured custom
        // connectors, but only when the built-in itself is
        // unconfigured (so a still-working built-in is never second-
        // guessed) and matchedId is a plain string (github's own
        // {owner,repo,num} object was never a candidate for this --
        // nothing "migrates off" a working github link this way).
        // Self-healing: once applyLinkToField runs, it writes a fresh
        // fetchedVia-tagged ref, so every refresh after this first one
        // takes the ordinary connector branch below with no special
        // case needed. Ambiguous (2+) matches just take the first --
        // this is a background refresh with no picker UI to
        // disambiguate through.
        const staleBuiltin = isBuiltin && (kind === 'jira' || kind === 'salesforce') && !builtinKindConfigured(connector) && typeof matchedId === 'string';
        // Filtered to true macro connectors only (no .kind) -- deliberately
        // narrower than connectorMatches' own full result, matching this
        // self-healing migration's original intent: re-resolve against a
        // CUSTOM connector specifically, never a different kind-tagged
        // instance (that's a distinct, not-yet-asked-for migration path).
        const migratedMatch = staleBuiltin ? this.connectorMatches(matchedId).filter(m => !m.connector.kind)[0] : null;
        if (migratedMatch) await this.applyLinkToField(issueId, colId, migratedMatch);
        else if (connector) await this.applyLinkToField(issueId, colId, { fetchedVia: n.fetchedVia, matchedId, connector });
      }
    }
    const afterIssue = this.findIssue(issueId);
    if (!afterIssue) return null;
    const afterIds = latestEntryIdsByField(afterIssue);
    const changed = [];
    for (const f in afterIds) {
      if (afterIds[f] !== beforeIds[f]) changed.push({ field: f, preMergeLocalEntryId: beforeIds[f] || null, resultEntryId: afterIds[f] });
    }
    return changed.length ? changed : null;
  }
  // One field at a time, not all at once -- see the comment above
  // applyGithubLinkToField's return change for why. Collects every
  // changed field (explicit + derived) across the whole row into one
  // revertible bundle entry, or null if nothing on this row changed.
  async refreshRow(issueId) {
    const fields = [];
    for (const colId of Object.keys(this.state.fieldDefs)) {
      const changed = await this.refreshField(issueId, colId);
      if (changed) fields.push(...changed);
    }
    return fields.length ? { id: issueId, fields } : null;
  }
  async refreshAll() {
    const colIds = Object.keys(this.state.fieldDefs);
    for (const iss of this.state.issues) {
      for (const colId of colIds) {
        await this.refreshField(iss.id, colId);
      }
    }
  }
  // Replaces applyGithubLinkToField/applyJiraLinkToField/
  // applySalesforceLinkToField/applyConnectorLinkToField -- one
  // shared write path for every system, now that paste-dispatch
  // (connectorMatches) and refresh-dispatch both produce the
  // same {fetchedVia, matchedId} shape. Resolves the live connector
  // itself from fetchedVia (rather than trusting a caller-passed one)
  // so every caller -- a builtin shape-match that has never carried a
  // connector, or a custom-connector match that already has one --
  // converges on the exact same lookup. Writes fieldRef: {href, fetchedVia}.
  applyLinkToField(issueId, colId, { fetchedVia, matchedId }) {
    const connector = this.resolveFetchConnector(fetchedVia);
    if (!connector) return; // deleted/missing connector -- same silent no-op a vanished custom connector always had
    const kind = connector.kind;
    const isBuiltin = !!kind;
    if (!isBuiltin && !this.isTauriConnectorRuntime()) return; // same silent no-op applyConnectorLinkToField always had outside Tauri
    const systemLabel = connector.name;
    const linkedToText = kind === 'github' ? 'GitHub #' + matchedId.num
      : kind === 'jira' ? 'Jira ' + matchedId
      : kind === 'salesforce' ? 'Salesforce ' + salesforceObjectTypeFromId(matchedId)
      : systemLabel;
    const fieldLabel = (this.state.fieldDefs[colId] && this.state.fieldDefs[colId].label) || colId;
    const iss0 = this.findIssue(issueId);
    const isRefreshStart = iss0 && this.sameRef(iss0.fieldRefs && iss0.fieldRefs[colId], fetchedVia, matchedId);
    const beforeTitle = iss0 ? iss0.values[colId] : undefined;
    this.setState({
      activeCell: null, editDraft: '', connectorPickerOpen: null,
      issues: this.state.issues.map(i => i.id === issueId ? { ...i, fieldLoading: { ...(i.fieldLoading || {}), [colId]: true } } : i)
    });
    if (!isRefreshStart) this.appendSignedHistory(issueId, { text: 'Linked ' + fieldLabel + ' to ' + linkedToText });
    if (!isBuiltin) console.time('[diag] connector-link-total ' + matchedId);
    return this.fetchLinkData(fetchedVia, matchedId, connector).then(({ data, href }) => {
      const issNow = this.findIssue(issueId);
      const isRefresh = issNow && this.sameRef(issNow.fieldRefs && issNow.fieldRefs[colId], fetchedVia, matchedId);
      const beforeValues = (issNow && issNow.values) || {};
      // Tracker #112 (b564316d): the persisted fieldRef is display-only
      // -- {href, fetchedVia[, matchedId]} is all buildTextCell's ref
      // rendering ever reads. The live `data`'s own full picked set is
      // used ONLY in-memory, right below, to recompute any bound field
      // while real data is in hand -- it never reaches
      // appendSignedHistory/disk.
      // matchedId is persisted for a CUSTOM connector specifically (not
      // github/jira/salesforce, whose href already deterministically
      // encodes it, confirmed by matchedIdFromHref's own builtin
      // branches) because a connector's own fetched `url` has no
      // guaranteed relationship to the shape its paste-pattern matched
      // (e.g. a pasted ticket URL vs. the system's own canonical record
      // URL) -- without it, re-deriving the id from href for display
      // (connectorLinkText's {{id}}) or duplicate-detection (sameRef) is
      // unreliable. This is identity, not the "rich per-system fields"
      // (labels/status/assignee/...) Tom categorically ruled out.
      const fieldRef = isBuiltin ? { href, fetchedVia } : { href, fetchedVia, matchedId };
      const value = kind === 'salesforce' ? data.name : data.title;
      const beforeFieldRef = issNow && issNow.fieldRefs && issNow.fieldRefs[colId];
      if (!isRefresh) this.appendSignedHistory(issueId, { text: fieldLabel + ' fetched from ' + systemLabel, field: colId, value, fieldRef });
      // Deliberately RAW beforeFieldRef here (unlike stageFieldRefresh's
      // own equivalent comparison below applyLinkToField in this file --
      // see its comment) -- this is the single-row immediate-refresh
      // path, which writes straight to signed history/Merge History, not
      // a staged job's pre-confirm gate. Merge History bundles the root
      // field's entry together with whatever it derives (tracker #196),
      // so a legacy ref's first post-redesign touch must still produce a
      // real entry here -- confirmed by merge-provenance.spec.js's own
      // "refresh... records a revertible bundle... covering the derived
      // field" coverage, which needs BOTH fields' entries even when the
      // root field's visible value didn't change. The pre-confirm GATE
      // (stageFieldRefresh, used by the 2+-row staged job) is the one
      // place that must stay quiet about a pure shape migration -- it has
      // its own, separate, normalized comparison for exactly that reason.
      else if (value !== beforeTitle || JSON.stringify(fieldRef) !== JSON.stringify(beforeFieldRef)) this.appendSignedHistory(issueId, { text: fieldLabel + ' refreshed from ' + systemLabel, field: colId, value, fieldRef });
      const liveKey = isBuiltin ? kind : connector.key;
      // fieldRefs[colId] is patched to the clean fieldRef here IN-MEMORY,
      // not just via appendSignedHistory's own rehydration -- when
      // nothing really changed (unchanged, above) no entry gets written
      // at all, so this is the only place a legacy ref's stale embedded
      // rich data (e.g. old labels) actually gets cleared before
      // settleLinkedRules's own applyLinkedRules pass runs immediately
      // below. Without this, settleLinkedRules would still see the OLD
      // legacy ref, sourceRefHasFullData would call it "has full data"
      // (the embedded, now-stale labels), and re-derive every field
      // bound to colId from that STALE snapshot -- clobbering the
      // correct value applyLiveLinkedRules just computed from the
      // genuinely fresh `data` a moment ago (confirmed regression,
      // caught by row-selection.spec.js's own "recomputes from fresh
      // live data even when ... unchanged" coverage).
      this.setState(s => ({
        issues: s.issues.map(iss => {
          if (iss.id !== issueId) return iss;
          const patched = { ...iss, fieldLoading: { ...(iss.fieldLoading || {}), [colId]: false }, fieldRefs: { ...iss.fieldRefs, [colId]: fieldRef } };
          const defs = effectiveFieldDefs(s.fieldDefs, s.localFieldBindings);
          return settleLinkedRules(applyLiveLinkedRules(patched, defs, colId, liveKey, data, this.liveRuleCtx(issueId)), defs, this.liveRuleCtx(issueId));
        })
      }));
      this.logDerivedChanges(issueId, beforeValues, colId);
      if (!isBuiltin) console.timeEnd('[diag] connector-link-total ' + matchedId);
    }).catch(err => {
      if (!isBuiltin) console.timeEnd('[diag] connector-link-total ' + matchedId);
      const issNow = this.findIssue(issueId);
      const isRefresh = issNow && this.sameRef(issNow.fieldRefs && issNow.fieldRefs[colId], fetchedVia, matchedId);
      const errorText = 'Could not fetch from ' + systemLabel + ' (' + err.message + ')';
      if (isRefresh) {
        const fieldHistory = ((issNow && issNow.history) || []).filter(hh => hh.field === colId);
        const lastEntry = fieldHistory.length ? fieldHistory.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)) : null;
        const alreadyLoggedThisFailure = lastEntry && lastEntry.value === undefined && lastEntry.text === errorText;
        if (!alreadyLoggedThisFailure) this.appendSignedHistory(issueId, { text: errorText, field: colId });
      } else {
        // href is unknown on a failed first attempt for every system
        // except github (whose href is deterministic from matchedId
        // alone, known upfront -- see connectorMatches' own comment).
        // matchedId is persisted here specifically so a RETRY is
        // correctly recognized as a retry (sameRef) rather than looking
        // like a brand-new link on the second attempt -- for a builtin,
        // overwritten by the clean {href, fetchedVia}-only shape the
        // moment a fetch actually succeeds; for a custom connector, kept
        // on success too (see the success-path fieldRef comment above).
        const fallbackHref = kind === 'github' ? ('https://github.com/' + matchedId.owner + '/' + matchedId.repo + '/issues/' + matchedId.num) : null;
        const fallbackValue = kind === 'github' ? (matchedId.owner + '/' + matchedId.repo + '#' + matchedId.num) : matchedId;
        this.appendSignedHistory(issueId, { text: errorText, field: colId, value: fallbackValue, fieldRef: { href: fallbackHref, fetchedVia, matchedId } });
      }
      this.setState(s => ({
        issues: s.issues.map(iss => iss.id === issueId ? { ...iss, fieldLoading: { ...(iss.fieldLoading || {}), [colId]: false } } : iss)
      }));
    });
  }
  // source.github / source.jira are null unless the bound field is linked
  // to that specific system -- isLinked reflects whether the bound field
  // has ANY real link right now; source.github/source.jira on top of that
  // tell a rule WHICH one, so system-agnostic rule text can branch with a
  // plain truthy check (source.github ? ... : source.jira ? ... : ...) or
  // optional chaining (source.jira?.status). fieldRefs[linkedSourceId]
  // carries either kind, tagged by .system ('github' by default for old
  // data with no tag, since that's all that ever existed before Jira
  // linking).
  pickSourcePreview(linkedSourceId) {
    const empty = { text: '', isLinked: false, github: null, jira: null, salesforce: null };
    if (!this.state.issues.length) return empty;
    const linkedIssue = this.state.issues.find(iss => buildSource(iss, linkedSourceId, this.state.connectedSources).isLinked);
    const source = buildSource(linkedIssue || this.state.issues[0], linkedSourceId, this.state.connectedSources);
    return {
      text: truncate(source.text, 60),
      isLinked: source.isLinked,
      github: source.github ? { ...source.github, description: truncate(source.github.description, 80) } : null,
      jira: source.jira ? { ...source.jira, description: truncate(source.jira.description, 80) } : null,
      salesforce: source.salesforce ? { ...source.salesforce } : null
    };
  }
  // { isLinked:false } short-circuits before the rule even runs, for fields
  // with no rule/no bound source AND for bound-but-not-yet-linked rows —
  // callers use isLinked to decide whether to lock the cell / overwrite its
  // materialized value at all.
  // select: computed matched against option id/label -> that option's id (or
  // null if nothing matches). multiselect: computed may be an array or a
  // single value; each entry is matched the same way and invalid entries are
  // dropped. text: computed is coerced to a string directly.
  lockTitle(def) {
    const src = this.state.fieldDefs[def.linkedSourceId];
    return "Linked to " + (src ? src.label : def.linkedSourceId) + "'s data";
  }
  // Bindable SOURCES are narrower than bindable TARGETS: only the Issue
  // field (Title) and fields explicitly typed 'issue' can hold a
  // GitHub/Jira link, so only those show up in the "Bound source" dropdown
  // — plain text fields (e.g. Mitigation) are valid rule TARGETS but not
  // valid sources.
  bindableSources(excludeColId) {
    const fieldDefs = this.state.fieldDefs;
    const list = 'title' === excludeColId ? [] : [{ id: 'title', label: fieldDefs.title.label }];
    for (const id in fieldDefs) {
      if (id !== 'title' && id !== excludeColId && fieldDefs[id].type === 'issue') list.push({ id, label: fieldDefs[id].label });
    }
    return list;
  }
  // Per-kind item-list builders, factored out of subjectGroups so a
  // second real instance of a kind (keyed by its own .key, named
  // whatever Tom calls it) gets the exact same rich field list as the
  // one grandfathered __builtin_<kind> row -- called once below with
  // ('github','GitHub') etc. for byte-identical output to the old fixed
  // array, and again per additional kind-tagged connector.
  githubGroupItems(keyPrefix, displayName) {
    return [
      { path: 'source.' + keyPrefix + '?.labels', label: displayName + ': Labels', kind: 'list' },
      { path: 'source.' + keyPrefix + '?.status', label: displayName + ': Status', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.issueType', label: displayName + ': Issue type', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.assignees', label: displayName + ': Assignees', kind: 'list' },
      { path: 'source.' + keyPrefix + '?.description', label: displayName + ': Description', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.key', label: displayName + ': Key', kind: 'text' }
    ];
  }
  jiraGroupItems(keyPrefix, displayName) {
    return [
      { path: 'source.' + keyPrefix + '?.status', label: displayName + ': Status', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.statusCategory', label: displayName + ': Status category', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.priority', label: displayName + ': Priority', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.labels', label: displayName + ': Labels', kind: 'list' },
      { path: 'source.' + keyPrefix + '?.issueType', label: displayName + ': Issue type', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.components', label: displayName + ': Components', kind: 'list' },
      { path: 'source.' + keyPrefix + '?.description', label: displayName + ': Description', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.key', label: displayName + ': Key', kind: 'text' }
    ];
  }
  salesforceGroupItems(keyPrefix, displayName) {
    return [
      { path: 'source.' + keyPrefix + '?.name', label: displayName + ': Name', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.objectType', label: displayName + ': Object type', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.status', label: displayName + ': Status', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.owner', label: displayName + ': Owner', kind: 'text' },
      { path: 'source.' + keyPrefix + '?.id', label: displayName + ': Record Id', kind: 'text' }
    ];
  }
  // Every path a rule can read, grouped for the subject dropdown. The
  // paths are written with ?. so a row bound to a Jira issue can be
  // interrogated for GitHub labels (and vice versa) without a guard --
  // matching buildSource(), which sets the non-matching system to null.
  subjectGroups() {
    const groups = [
      { label: 'The linked issue', items: [
        { path: 'source.text', label: 'Its text in this row', kind: 'text' },
        { path: 'source.isLinked', label: 'Is actually linked', kind: 'bool' },
        { path: '!!source.github', label: 'Source is GitHub', kind: 'bool' },
        { path: '!!source.jira', label: 'Source is Jira', kind: 'bool' },
        { path: '!!source.salesforce', label: 'Source is Salesforce', kind: 'bool' }
      ] },
      { label: 'GitHub', items: this.githubGroupItems('github', 'GitHub') },
      { label: 'Jira', items: this.jiraGroupItems('jira', 'Jira') },
      { label: 'Salesforce', items: this.salesforceGroupItems('salesforce', 'Salesforce') }
    ];
    // The 3 grandfathered __builtin_* rows already have their own fixed,
    // rich-field group above (GitHub/Jira/Salesforce) -- skip them here
    // so a bound source doesn't show up twice. A SECOND real instance of
    // a kind (not one of the 3 fixed ids) gets its own rich group too,
    // keyed by its own .key and named after it.
    (this.state.connectedSources || []).filter(c => c.kind && !c.id.startsWith('__builtin_')).forEach(c => {
      const items = c.kind === 'github' ? this.githubGroupItems(c.key, c.name)
        : c.kind === 'jira' ? this.jiraGroupItems(c.key, c.name)
        : this.salesforceGroupItems(c.key, c.name);
      groups.push({ label: c.name, items });
    });
    // A true macro connector (no .kind) only ever gets the generic thin
    // title/state/labels/assignee shape pickConnectorFields exposes.
    (this.state.connectedSources || []).filter(c => !c.kind).forEach(c => {
      groups.push({ label: c.name, items: [
        { path: '!!source.' + c.key, label: 'Source is ' + c.name, kind: 'bool' },
        { path: 'source.' + c.key + '?.title', label: c.name + ': Title', kind: 'text' },
        { path: 'source.' + c.key + '?.state', label: c.name + ': State', kind: 'text' },
        { path: 'source.' + c.key + '?.labels', label: c.name + ': Labels', kind: 'list' },
        { path: 'source.' + c.key + '?.assignee', label: c.name + ': Assignee', kind: 'text' }
      ] });
    });
    const others = [];
    for (const id in this.state.fieldDefs) {
      if (id === 'title' || id === this.state.ruleBuilderColId) continue;
      const d = this.state.fieldDefs[id];
      others.push({ path: 'values.' + id, label: d.label, kind: d.type === 'multiselect' ? 'list' : 'text', optionsFrom: id });
    }
    if (others.length) groups.push({ label: 'Other fields in this row', items: others });
    return groups;
  }
  subjectMeta(path) {
    const groups = this.subjectGroups();
    for (const g of groups) for (const it of g.items) if (it.path === path) return it;
    return null;
  }
  opsFor(kind) {
    if (kind === 'list') return [
      { id: 'includes', label: 'includes' }, { id: 'notIncludes', label: 'does not include' },
      { id: 'isNotEmpty', label: 'is not empty' }, { id: 'isEmpty', label: 'is empty' }
    ];
    if (kind === 'bool') return [{ id: 'isTrue', label: 'is true' }, { id: 'isFalse', label: 'is false' }];
    return [
      { id: 'is', label: 'is' }, { id: 'isNot', label: 'is not' },
      { id: 'contains', label: 'contains' }, { id: 'notContains', label: 'does not contain' },
      { id: 'startsWith', label: 'starts with' }, { id: 'matches', label: 'matches regex' },
      { id: 'isNotEmpty', label: 'is not empty' }, { id: 'isEmpty', label: 'is empty' }
    ];
  }
  ruleDefRows(def) { return Array.isArray(def.ruleRows) ? def.ruleRows : null; }
  defaultThenFor(def) {
    if (def.type === 'multiselect') return [];
    if (def.type === 'select') return (def.options || [])[0] ? def.options[0].id : null;
    if (def.type === 'issue') return null;
    return '';
  }
  // Shared by every schema write that can change a bound field's computed
  // value: snapshot each issue's values, run the actual schema mutation
  // (which must itself call appendProjectHistory), recompute bound values
  // across every issue in a callback (so applyLinkedRules sees the NEW
  // fieldDefs, not the pre-history-append ones), then log whatever
  // actually changed as a result.
  recomputeAndLogDerived(mutate) {
    const beforeByIssue = {};
    this.state.issues.forEach(iss => { beforeByIssue[iss.id] = iss.values; });
    mutate();
    this.setState(s => ({ issues: s.issues.map(iss => settleLinkedRules({ ...iss }, effectiveFieldDefs(s.fieldDefs, s.localFieldBindings), this.liveRuleCtx(iss.id))) }));
    this.state.issues.forEach(iss => this.logDerivedChanges(iss.id, beforeByIssue[iss.id] || {}));
  }
  // Single write path for every row edit: recompile, log the field's whole
  // new definition (rows + fallback + compiled expression together) via
  // appendProjectHistory -- same "log the whole new value" pattern every
  // other schema-mutating method uses.
  commitRuleRows(colId, rows, fallback) {
    const def = this.effectiveDef(colId);
    const fb = fallback === undefined ? (def.ruleFallback === undefined ? null : def.ruleFallback) : fallback;
    const rule = compileRuleRows(rows, fb, def);
    this.recomputeAndLogDerived(() => {
      this.setLocalFieldBinding(colId, { linkedSourceId: def.linkedSourceId || null, rule, ruleRows: rows, ruleFallback: fb });
    });
  }
  addRuleRow(colId) {
    const def = this.effectiveDef(colId);
    const rows = (this.ruleDefRows(def) || []).concat([
      { criteria: [{ subject: 'source.github?.labels', op: 'includes', operand: '' }], then: this.defaultThenFor(def) }
    ]);
    this.commitRuleRows(colId, rows);
  }
  updateRuleRow(colId, i, patch) {
    const rows = (this.ruleDefRows(this.effectiveDef(colId)) || []).slice();
    if (!rows[i]) return;
    rows[i] = Object.assign({}, rows[i], patch);
    this.commitRuleRows(colId, rows);
  }
  removeRuleRow(colId, i) {
    const rows = (this.ruleDefRows(this.effectiveDef(colId)) || []).slice();
    rows.splice(i, 1);
    this.commitRuleRows(colId, rows);
  }
  // Every row normalized to the current {criteria:[...]} shape -- a row
  // touched through these methods is fully migrated off the legacy flat
  // shape from that point on, same "self-heals on next edit" approach as
  // the rest of this app's schema handling.
  normalizedRuleRows(colId) {
    return (this.ruleDefRows(this.effectiveDef(colId)) || []).map(r => ({ ...r, criteria: ruleRowCriteria(r).slice() }));
  }
  // Drops the legacy flat subject/op/operand keys once a row has a real
  // criteria array, so a migrated row never carries both shapes at once.
  stripLegacyRowFields(row) {
    delete row.subject; delete row.op; delete row.operand;
  }
  addRuleCriterion(colId, rowIndex) {
    const rows = this.normalizedRuleRows(colId);
    if (!rows[rowIndex]) return;
    rows[rowIndex].criteria.push({ subject: 'source.github?.labels', op: 'includes', operand: '' });
    this.stripLegacyRowFields(rows[rowIndex]);
    this.commitRuleRows(colId, rows);
  }
  updateRuleCriterion(colId, rowIndex, critIndex, patch) {
    const rows = this.normalizedRuleRows(colId);
    if (!rows[rowIndex] || !rows[rowIndex].criteria[critIndex]) return;
    const next = Object.assign({}, rows[rowIndex].criteria[critIndex], patch);
    // Changing the subject can invalidate the operator (a list has no
    // "starts with") -- fall back to that kind's first operator rather
    // than silently compiling a condition that can never be true.
    if (patch.subject) {
      const meta = this.subjectMeta(patch.subject);
      const ops = this.opsFor(meta ? meta.kind : 'text');
      if (!ops.some(o => o.id === next.op)) next.op = ops[0].id;
    }
    rows[rowIndex].criteria[critIndex] = next;
    this.stripLegacyRowFields(rows[rowIndex]);
    this.commitRuleRows(colId, rows);
  }
  // Removing a row's only remaining criterion removes the row itself --
  // a criterion-less row can't compile to anything, and the row-level ✕
  // already covers "delete this whole WHEN".
  removeRuleCriterion(colId, rowIndex, critIndex) {
    const rows = this.normalizedRuleRows(colId);
    if (!rows[rowIndex]) return;
    rows[rowIndex].criteria.splice(critIndex, 1);
    if (!rows[rowIndex].criteria.length) rows.splice(rowIndex, 1);
    else this.stripLegacyRowFields(rows[rowIndex]);
    this.commitRuleRows(colId, rows);
  }
  moveRuleRow(colId, i, dir) {
    const rows = (this.ruleDefRows(this.effectiveDef(colId)) || []).slice();
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
    this.commitRuleRows(colId, rows);
  }
  setRuleFallback(colId, value) {
    this.commitRuleRows(colId, this.ruleDefRows(this.effectiveDef(colId)) || [], value);
  }
  switchRuleToAdvanced(colId) {
    const def = this.effectiveDef(colId);
    const rule = def.rule || compileRuleRows(this.ruleDefRows(def) || [], def.ruleFallback === undefined ? null : def.ruleFallback, def);
    this.setLocalFieldBinding(colId, { linkedSourceId: def.linkedSourceId || null, rule, ruleRows: null, ruleFallback: def.ruleFallback === undefined ? null : def.ruleFallback });
  }
  // Fallback is deliberately null, not the field's first option: rebuilding
  // starts from "no conditions", and a zero-condition rule compiles to just
  // its fallback -- seeding that with a real option would write a value the
  // user never picked onto every linked row, the exact clobber this whole
  // panel exists to make visible.
  rebuildRuleAsRows(colId) { this.commitRuleRows(colId, [], this.effectiveDef(colId).type === 'multiselect' ? [] : null); }
  ruleSyntaxError(def) {
    if (!def.rule) return '';
    try { new Function('source', 'values', 'return (' + def.rule + ');'); return ''; }
    catch (e) { return e.message; }
  }
  ruleSummary(def) {
    if (!def.linkedSourceId) return 'Not bound';
    const rows = this.ruleDefRows(def);
    if (!rows) return 'Custom expression';
    if (!rows.length) return 'No conditions yet';
    return rows.length === 1 ? '1 condition' : rows.length + ' conditions';
  }
  // The panel's whole feedback surface: for every issue, which condition
  // won and what the field therefore holds. Conditions are evaluated
  // individually (same compiler, one row at a time) so the table can name
  // the winning row rather than just showing an output.
  rulePreview(colId) {
    const def = this.effectiveDef(colId);
    const rows = this.ruleDefRows(def) || [];
    const conds = rows.map(r => ruleRowCondition(r));
    return this.state.issues.map(iss => {
      const title = truncate(iss.values.title || '(untitled)', 44);
      const source = buildSource(iss, def.linkedSourceId, this.state.connectedSources);
      if (!source.isLinked) {
        return { id: iss.id, title, titleColor: 'var(--n29)', sourceText: '—',
          matchedLabel: 'not linked', matchedColor: 'var(--n46)',
          hasPills: false, hasText: true, pills: [], resultText: 'left alone', resultColor: 'var(--n46)' };
      }
      let matched = -1;
      for (let i = 0; i < conds.length; i++) {
        if (evalRule(conds[i], source, iss.values) === true) { matched = i; break; }
      }
      const computed = evalRule(def.rule || 'null', source, iss.values);
      const next = applyComputedToField(iss.values, colId, def, computed)[colId];
      const opts = def.options || [];
      let hasPills = false, pills = [], resultText = '', resultColor = 'var(--n45)';
      if (def.type === 'select' || def.type === 'multiselect') {
        const ids = def.type === 'multiselect' ? (next || []) : (next == null ? [] : [next]);
        pills = ids.map(id => {
          const o = opts.find(x => x.id === id);
          const c = col(o ? o.color : 'gray');
          return { label: o ? o.label : id, bg: c.bg, fg: c.fg };
        });
        hasPills = pills.length > 0;
        if (!hasPills) {
          const attempted = computed == null ? '' : String(computed);
          resultText = attempted ? 'no option matches “' + truncate(attempted, 24) + '”' : 'blank';
          resultColor = attempted ? 'var(--c51)' : 'var(--n46)';
        }
      } else {
        resultText = next ? truncate(String(next), 60) : 'blank';
        if (!next) resultColor = 'var(--n46)';
      }
      return { id: iss.id, title, titleColor: 'var(--text-strong)',
        sourceText: truncate(source.text || '—', 30),
        matchedLabel: matched >= 0 ? (matched === 0 ? 'when 1' : 'when ' + (matched + 1)) : 'otherwise',
        matchedColor: matched >= 0 ? 'var(--c3)' : 'var(--text-tertiary)',
        hasPills, hasText: !hasPills, pills, resultText, resultColor };
    });
  }
  ruleBuilderVals() {
    const s = this.state;
    const colId = s.ruleBuilderColId;
    if (!colId || !s.fieldDefs[colId]) return null;
    const def = this.effectiveDef(colId);
    const rows = this.ruleDefRows(def);
    const thenParts = (value, setter, copyFieldRefFrom, onCopyFieldChange, isFallback) => {
      const isSelect = def.type === 'select', isMulti = def.type === 'multiselect', isIssueType = def.type === 'issue';
      const opts = def.options || [];
      if (isIssueType && isFallback) {
        return { thenIsSelect: false, thenIsMulti: false, thenIsText: false, thenIsFieldCopy: false, thenIsFixedBlank: true };
      }
      if (isIssueType) {
        const candidates = [];
        for (const id in s.fieldDefs) {
          if (id === colId) continue;
          if (s.fieldDefs[id].type === 'issue') candidates.push({ id, label: s.fieldDefs[id].label });
        }
        return {
          thenIsSelect: false, thenIsMulti: false, thenIsText: false, thenIsFixedBlank: false, thenIsFieldCopy: true,
          thenCopyFieldValue: copyFieldRefFrom || '',
          thenCopyFieldOptions: candidates,
          onThenCopyFieldChange: onCopyFieldChange
        };
      }
      return {
        thenIsSelect: isSelect, thenIsMulti: isMulti, thenIsText: !isSelect && !isMulti, thenIsFieldCopy: false, thenIsFixedBlank: false,
        thenValue: isMulti ? '' : (value == null ? '' : String(value)),
        onThenChange: e => setter(isSelect ? (e.target.value || null) : e.target.value),
        thenOptions: isMulti
          ? opts.map(o => {
              const sel = (value || []).indexOf(o.id) >= 0;
              const c = col(o.color);
              return { id: o.id, label: o.label,
                bg: sel ? c.bg : 'var(--surface)', fg: sel ? c.fg : 'var(--text-secondary)',
                border: sel ? c.bg : 'var(--border)',
                onToggle: () => setter(sel ? (value || []).filter(x => x !== o.id) : (value || []).concat([o.id])) };
            })
          : opts.map(o => ({ id: o.id, label: o.label }))
      };
    };
    const rowVals = (rows || []).map((r, i) => {
      const rowCriteria = ruleRowCriteria(r);
      const criteria = rowCriteria.map((c, ci) => {
        const meta = this.subjectMeta(c.subject);
        const ops = this.opsFor(meta ? meta.kind : 'text');
        const needsOperand = RULE_NO_OPERAND_OPS.indexOf(c.op) < 0;
        const srcDef = meta && meta.optionsFrom ? s.fieldDefs[meta.optionsFrom] : null;
        const operandOpts = srcDef ? (srcDef.options || []) : [];
        return {
          notFirst: ci > 0, canRemove: rowCriteria.length > 1,
          subject: c.subject, op: c.op, operand: c.operand == null ? '' : String(c.operand),
          ops, operandIsText: needsOperand && !operandOpts.length, operandIsSelect: needsOperand && operandOpts.length > 0,
          operandOptions: operandOpts.map(o => ({ id: o.id, label: o.label })),
          operandPlaceholder: c.op === 'matches' ? 'regular expression' : 'value',
          onSubjectChange: e => this.updateRuleCriterion(colId, i, ci, { subject: e.target.value }),
          onOpChange: e => this.updateRuleCriterion(colId, i, ci, { op: e.target.value }),
          onOperandChange: e => this.updateRuleCriterion(colId, i, ci, { operand: e.target.value }),
          onRemove: () => this.removeRuleCriterion(colId, i, ci)
        };
      });
      const isDraggingRows = s.draggingRuleRowIndex != null;
      return Object.assign({
        keyword: i === 0 ? 'WHEN' : 'ELSE WHEN',
        criteria,
        onAddCriterion: () => this.addRuleCriterion(colId, i),
        onRemove: () => this.removeRuleRow(colId, i),
        onMoveUp: () => this.moveRuleRow(colId, i, -1),
        onMoveDown: () => this.moveRuleRow(colId, i, 1),
        upOpacity: i === 0 ? 0.25 : 1,
        downOpacity: i === rows.length - 1 ? 0.25 : 1,
        onDragStart: e => this.dragStartRuleRow(i, e),
        onDragOver: e => this.dragOverRuleRow(i, e),
        onDrop: e => this.dropRuleRow(colId, i, e),
        onDragEnd: () => this.dragEndRuleRow(),
        dragOpacity: s.draggingRuleRowIndex === i ? 0.4 : 1,
        showIndicatorBefore: isDraggingRows && s.dragOverRuleRowIndex === i && s.dragOverRuleRowSide === 'before' && s.draggingRuleRowIndex !== i,
        showIndicatorAfter: isDraggingRows && s.dragOverRuleRowIndex === i && s.dragOverRuleRowSide === 'after' && s.draggingRuleRowIndex !== i
      }, thenParts(r.then, v => this.updateRuleRow(colId, i, { then: v }), r.thenCopyFieldRefFrom,
         e => { const fid = e.target.value || null; this.updateRuleRow(colId, i, { then: fid ? ('=values.' + fid) : null, thenCopyFieldRefFrom: fid }); },
         false));
    });
    const preview = def.linkedSourceId ? this.rulePreview(colId) : [];
    const linkedCount = preview.filter(p => p.matchedLabel !== 'not linked').length;
    const srcDef = s.fieldDefs[def.linkedSourceId];
    return {
      fieldLabel: def.label,
      transform: s.ruleBuilderVisible ? 'translateX(0)' : 'translateX(100%)',
      overlayAlpha: s.ruleBuilderVisible ? 0.22 : 0,
      linkedSourceId: def.linkedSourceId || '',
      sourceOptions: this.bindableSources(colId),
      onLinkedSourceChange: e => this.setFieldLinkedSource(colId, e.target.value),
      sourceHint: def.linkedSourceId
        ? 'Conditions read the issue linked in ' + (srcDef ? srcDef.label : def.linkedSourceId) + '. Rows with nothing linked there are left alone.'
        : 'Pick the column whose linked issue this field should follow.',
      // A newly bound field has no rows AND no expression -- it starts in the
      // row editor, not the textarea. Advanced mode is only for a field that
      // genuinely holds a hand-written expression.
      isRows: !!def.linkedSourceId && (!!rows || !def.rule),
      isAdvanced: !!def.linkedSourceId && !rows && !!def.rule,
      rows: rowVals,
      subjectGroups: this.subjectGroups(),
      fallback: thenParts(def.ruleFallback === undefined ? null : def.ruleFallback, v => this.setRuleFallback(colId, v), null, null, true),
      onAddRow: () => this.addRuleRow(colId),
      expression: def.rule || 'null',
      onEditAsExpression: () => this.switchRuleToAdvanced(colId),
      onRebuildAsRows: () => this.rebuildRuleAsRows(colId),
      ruleValue: def.rule || '',
      onRuleChange: e => this.setFieldRule(colId, e.target.value),
      error: this.ruleSyntaxError(def),
      targetHint: def.type === 'multiselect' ? 'Return an array of option ids or labels.'
        : def.type === 'select' ? 'Return an option id or label.'
        : def.type === 'issue' ? 'Return a string (e.g. values.related). Copying another field\'s real link only works in the row editor, not here.'
        : 'Return a string.',
      preview,
      previewCaption: def.linkedSourceId
        ? 'What every row holds right now — ' + linkedCount + ' of ' + preview.length + ' rows have something linked.'
        : 'Bind a source to see what each row would get.'
    };
  }
  openRuleBuilder(colId) {
    this.setState({ ruleBuilderColId: colId, ruleBuilderVisible: false, fieldEditorColId: null, openColMenuId: null });
    setTimeout(() => this.setState({ ruleBuilderVisible: true }), 20);
  }
  closeRuleBuilder = () => {
    this.setState({ ruleBuilderVisible: false });
    setTimeout(() => this.setState({ ruleBuilderColId: null }), 280);
  };
  cancelEdit() { this.setState({ activeCell: null, editDraft: '' }); }
  // Unified for every text-like field, Title included (colId 'title' is not
  // special-cased) — a resolvable GitHub link always does a fresh (cache-
  // bypassing) fetch on submit; anything else saves as plain text and
  // explicitly clears this field's loading/ref flags, which is what actually
  // fixes the stuck-on-"Loading" bug (previously only the fetch's own
  // success/failure handlers cleared them, so a plain-text commit landing on
  // a field whose loading flag was already stuck true — reachable via the
  // slide-over, which never guarded editing on isLoadingTitle — left it
  // stuck forever).
  commitEdit(issueId, colId) {
    let draft = this.state.editDraft;
    const commitDef = this.state.fieldDefs[colId];
    // Paste-to-resolve linking only applies to type:'issue' fields -- a
    // plain type:'text' field always just commits as (markdown) text,
    // even if the pasted string happens to look like a GitHub/Jira/
    // Salesforce URL, so someone can't end up with a partially-linked
    // column they later can't bind to.
    if (commitDef && commitDef.type === 'issue') {
      // A genuine no-op check BEFORE any paste-match recognition runs --
      // editValueForRef is exactly what populated `draft` in the first
      // place when this field already has a link; if the user changed
      // nothing, draft is still EXACTLY that same string. The match
      // functions below are gated on CURRENT reachability (Tauri runtime
      // + the builtin actually configured), which is a real, live-
      // reported, DESTRUCTIVE bug: if the system that originally
      // resolved this link is no longer configured (e.g. Jira's proxy
      // URL cleared since), re-submitting the unedited text silently
      // fails to re-recognize it as a link at all, falls through to the
      // plain-text branch below, and overwrites the resolved value with
      // the bare key/identifier -- wiping the real fieldRef to null in
      // the process, as a normal signed "field set to X" entry. Checking
      // unchanged-ness directly here, independent of whether a match
      // would currently be recognized, is what actually prevents that.
      const iss0 = this.findIssue(issueId);
      const currentRef0 = iss0 && iss0.fieldRefs && iss0.fieldRefs[colId];
      if (currentRef0 && draft === this.editValueForRef(currentRef0, iss0.values[colId])) { this.cancelEdit(); return; }
      // editValueForRef is what populated `draft` in the first place when
      // this field already has a link -- clicking in and clicking back out
      // with no real edit re-submits the EXACT SAME text, which re-matches
      // here (expected: that's what lets the same link stay editable) and
      // would otherwise unconditionally kick off a real fetch/macro call
      // and the loading-shimmer flicker every single time, even though
      // nothing changed. Live-reported: this made it look like the field
      // was being freshly (re-)linked/bound on every click-in/click-out.
      // sameRef is the same "is this a refresh of what's already there"
      // check applyLinkToField uses internally -- checked here first so a
      // genuine no-op never starts the fetch at all. connectorPickerOpen
      // is the one place ambiguity (2+ matches, now possibly across
      // kinds too -- e.g. two configured Jira instances) surfaces a real
      // UI -- createIssueFromText/classifyBulkPasteLines have no picker
      // and fall through to plain text instead (unchanged precedent).
      const connMatches = this.connectorMatches(draft);
      if (connMatches.length === 1) {
        const iss = this.findIssue(issueId);
        const currentRef = iss && iss.fieldRefs && iss.fieldRefs[colId];
        if (this.sameRef(currentRef, connMatches[0].fetchedVia, connMatches[0].matchedId)) { this.cancelEdit(); return; }
        this.requireAttribution(() => this.applyLinkToField(issueId, colId, connMatches[0]));
        return;
      }
      if (connMatches.length > 1) { this.setState({ connectorPickerOpen: { issueId, colId, matches: connMatches } }); return; }
      const wg = this.wigwagUrlMatch(draft);
      if (wg && this.resolveWigwagProjectId(wg)) { this.requireAttribution(() => this.applyWigwagLinkToField(issueId, colId, wg)); return; }
      draft = this.translateWigwagLinksInText(draft);
    } else if (commitDef && commitDef.type === 'text') {
      draft = this.translateWigwagLinksInText(draft);
    }
    this.commitFieldValue(issueId, colId, draft);
  }
  // The tail of what commitEdit used to do inline once it had a final
  // value to write -- pulled out so bulk Set-field can drive it directly
  // with a value of its own, instead of going through the single shared
  // this.state.editDraft commitEdit reads from.
  commitFieldValue(issueId, colId, value) {
    const fieldLabel = (this.state.fieldDefs[colId] && this.state.fieldDefs[colId].label) || colId;
    const iss0 = this.findIssue(issueId);
    const changed = iss0 && value !== (iss0.values[colId] || '');
    const beforeValues = iss0 ? iss0.values : {};
    // True PRE-settle snapshot, same spirit as beforeValues -- without
    // this, computeDerivedChangeEntries's own beforeFieldRef would read
    // straight off issue.fieldRefs AFTER the settle below has already
    // run (same object, by the time logDerivedChanges calls findIssue
    // again), which trivially always matches a fresh recompute on that
    // SAME already-patched object -- making a stale/missing fieldRef
    // undetectable as "changed," ever, no matter how many times this
    // field is committed. See logDerivedChanges's own call below.
    const beforeFieldRefs = iss0 ? iss0.fieldRefs : {};
    const commit = () => {
      if (changed) {
        this.appendSignedHistory(issueId, {
          text: value ? (fieldLabel + ' set to "' + truncate(value, 60) + '"') : (fieldLabel + ' cleared'),
          field: colId, value, fieldRef: null
        });
      }
      this.setState(s => ({
        activeCell: null,
        issues: s.issues.map(iss => iss.id === issueId ? settleLinkedRules({
          ...iss,
          fieldLoading: iss.fieldLoading ? { ...iss.fieldLoading, [colId]: false } : iss.fieldLoading
        }, effectiveFieldDefs(s.fieldDefs, s.localFieldBindings), this.liveRuleCtx(issueId)) : iss)
      }));
      // Live-reported bug: colId is only excluded here to avoid
      // double-logging/mislabeling ITS OWN change -- correct when
      // `changed` is true (appendSignedHistory just wrote its own
      // dedicated entry above), but when the commit was a no-op
      // (`changed` false, e.g. clicking into a bound field and back out
      // with nothing typed), nothing was written for colId at all -- not
      // the direct entry (skipped, nothing changed) and, with the
      // exclusion, not a derived correction either. That left a bound
      // field with no way to ever persist its own stale/missing fieldRef
      // fixing itself back up: the settle just above corrects it in
      // local render state only, invisible again on the next reload.
      // Only exclude when colId's own entry actually was written.
      this.logDerivedChanges(issueId, beforeValues, changed ? colId : undefined, beforeFieldRefs);
    };
    if (changed) this.requireAttribution(commit); else commit();
  }
  handleEditKey(e, issueId, colId) {
    if (e.key === 'Enter') { e.target.blur(); }
    else if (e.key === 'Escape') { e.stopPropagation(); this.cancelEdit(); }
    else if (e.key === 'ArrowUp' && colId === 'title' && this.state.slideOverIssueId !== issueId && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
      // Tracker 69502216: Element-style chained walk-up -- a single-line
      // input has no native meaning for ArrowUp at all, so only steal it
      // once the caret is truly collapsed at the start (not mid-text,
      // where ArrowUp staying a no-op is the least surprising thing).
      // Reuses the same _visibleIssueOrder the add-item composer's own
      // first hop (onAddItemKeyDown) walks into -- one row up at a time,
      // landing on the title immediately above the one just edited;
      // autofocus already puts the caret at the end of that row's text
      // (confirmed empirically), so repeating ArrowUp keeps climbing.
      // Scoped out of the slide-over's own title field (single-issue
      // context, no neighbouring row to walk into).
      const order = this._visibleIssueOrder || [];
      const idx = order.indexOf(issueId);
      if (idx > 0) {
        e.preventDefault();
        const prevIssue = this.findIssue(order[idx - 1]);
        if (prevIssue) this.startEdit(order[idx - 1], 'title', this.editValueForRef(prevIssue.fieldRefs && prevIssue.fieldRefs.title, prevIssue.values.title || ''));
      }
    }
    else if (e.key === 'ArrowDown' && colId === 'title' && this.state.slideOverIssueId !== issueId && e.target.selectionStart === e.target.value.length && e.target.selectionEnd === e.target.value.length) {
      // Mirrors the ArrowUp climb above: steals ArrowDown (another native
      // no-op in a single-line input) only once the caret is collapsed at
      // the END -- where autofocus already leaves it after every hop, so
      // repeated bare ArrowDown keeps walking down with no extra
      // navigation needed, unlike the ArrowUp climb which requires
      // explicitly returning to the start each time. Bottoms out by
      // handing focus back to the add-item box, same row order either
      // direction walks.
      const order = this._visibleIssueOrder || [];
      const idx = order.indexOf(issueId);
      if (idx !== -1) {
        e.preventDefault();
        if (idx < order.length - 1) {
          const nextIssue = this.findIssue(order[idx + 1]);
          if (nextIssue) this.startEdit(order[idx + 1], 'title', this.editValueForRef(nextIssue.fieldRefs && nextIssue.fieldRefs.title, nextIssue.values.title || ''));
        } else {
          this.goToAddItemInput();
        }
      }
    }
  }
  // Shared by the ArrowDown-from-bottom-row walk above -- the add-item
  // input is always mounted (addItemOpen only toggles its styling, see
  // onAddItemBlur), so refocusing it is a plain DOM query + .focus(),
  // same idiom as selectFilterSuggestion's own filter-input refocus.
  // Desktop and the widget-embedded layout render two different inputs;
  // only one is ever actually present.
  goToAddItemInput() {
    const input = document.querySelector('[data-testid="add-item-input"]') || document.querySelector('[data-testid="widget-add-item-input"]');
    if (input) input.focus();
    this.setState({ addItemOpen: true });
  }
  // Multiline markdown text fields commit like project notes do (see
  // onDraftKeyDown/saveNoteEdit): plain Enter inserts a newline (falls
  // through to the textarea's own default behavior, not intercepted
  // here), Cmd/Ctrl+Enter commits via the same blur -> commitEdit() path
  // every other field type already uses, Escape cancels.
  handleMarkdownEditKey(e, issueId, colId) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') { e.stopPropagation(); this.cancelEdit(); }
  }

  // See the comment above computeAnchor(): position:fixed popups need
  // coordinates relative to the nearest transformed ancestor (the
  // slide-over), not the viewport, plus a right-edge clamp. Used by every
  // popup this app renders (field popover, column menu, row menu).
  computeAnchor(el, width) {
    const rect = el.getBoundingClientRect();
    const ancestor = el.closest('[data-testid="slideover"]');
    const origin = ancestor ? ancestor.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const containerWidth = origin.right - origin.left;
    const containerHeight = origin.bottom - origin.top;
    let left = rect.left - origin.left;
    const maxLeft = containerWidth - width - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    const top = rect.top - origin.top;
    const bottom = rect.bottom - origin.top;
    return { left, top, bottom, spaceBelow: containerHeight - bottom, spaceAbove: top, upwardOffsetPx: containerHeight - top + 6 };
  }
  togglePopover(issueId, colId, e, width) {
    const isOpen = this.state.activeCell && this.state.activeCell.issueId === issueId && this.state.activeCell.colId === colId;
    let openUpward = false, anchorLeft = 0, anchorTopPx = 0, anchorBottomPx = 0;
    const anchorEl = e && e.target && (e.target.closest('[data-testid="field-cell"]') || e.target.closest('[data-testid="slideover-field"]') || e.target.closest('[data-testid="title-cell"]') || e.currentTarget);
    if (!isOpen && anchorEl && anchorEl.getBoundingClientRect) {
      // Rough estimate of the popover's own height (header + up to ~220px
      // of scrollable option list) — good enough for a flip decision, no
      // need to be exact. Only flips when there's actually more room above
      // than below, not just whenever below is merely tight.
      const a = this.computeAnchor(anchorEl, width || 240);
      const estimatedPopoverHeight = 320;
      openUpward = a.spaceBelow < estimatedPopoverHeight && a.spaceAbove > a.spaceBelow;
      anchorLeft = a.left; anchorTopPx = a.bottom + 6; anchorBottomPx = a.upwardOffsetPx;
    }
    this.setState({ activeCell: isOpen ? null : { issueId, colId, openUpward, anchorLeft, anchorTopPx, anchorBottomPx }, optionFilterQuery: '' });
  }
  selectOption(issueId, colId, optionId) {
    const fieldLabel = (this.state.fieldDefs[colId] && this.state.fieldDefs[colId].label) || colId;
    const iss0 = this.findIssue(issueId);
    const changed = iss0 && iss0.values[colId] !== optionId;
    const opt = changed && (this.state.fieldDefs[colId].options || []).find(o => o.id === optionId);
    const commit = () => {
      this.setState({ activeCell: null });
      if (changed) {
        this.appendSignedHistory(issueId, { text: optionId ? (fieldLabel + ' set to ' + (opt ? opt.label : optionId)) : (fieldLabel + ' cleared'), field: colId, value: optionId });
      }
    };
    if (changed) this.requireAttribution(commit); else commit();
  }
  toggleMultiOption(issueId, colId, optionId) {
    this.requireAttribution(() => {
      const fieldLabel = (this.state.fieldDefs[colId] && this.state.fieldDefs[colId].label) || colId;
      const iss0 = this.findIssue(issueId);
      const cur0 = (iss0 && iss0.values[colId]) || [];
      const adding = !cur0.includes(optionId);
      const next = adding ? [...cur0, optionId] : cur0.filter(x => x !== optionId);
      const opt = (this.state.fieldDefs[colId].options || []).find(o => o.id === optionId);
      const optLabel = opt ? opt.label : optionId;
      this.appendSignedHistory(issueId, { text: fieldLabel + ': ' + (adding ? 'added ' : 'removed ') + optLabel, field: colId, value: next });
    });
  }
  // Bulk Set-field's multiselect path: replaces the whole option-id array
  // in one entry, rather than toggleMultiOption's one-option-at-a-time
  // add/remove -- matches how select/text/date bulk-set all replace the
  // value outright (one mental model across every field type this
  // feature touches).
  setMultiValue(issueId, colId, optionIds) {
    this.requireAttribution(() => {
      const fieldLabel = (this.state.fieldDefs[colId] && this.state.fieldDefs[colId].label) || colId;
      const iss0 = this.findIssue(issueId);
      const cur0 = (iss0 && iss0.values[colId]) || [];
      if (JSON.stringify(cur0) === JSON.stringify(optionIds)) return;
      const labels = optionIds.map(id => { const opt = (this.state.fieldDefs[colId].options || []).find(o => o.id === id); return opt ? opt.label : id; });
      this.appendSignedHistory(issueId, { text: fieldLabel + ' set to ' + (labels.length ? labels.join(', ') : 'none'), field: colId, value: optionIds });
    });
  }

  // The filtered+sorted issue-id order renderVals() last computed rows
  // from -- stashed as a plain instance field (not state) the same way
  // other render-time bookkeeping is (e.g. _lastSortKey), so shift-click
  // ranges and Shift+Up/Down keyboard extension operate on exactly what's
  // currently on screen without duplicating the filter/sort logic.
  currentRowOrderIds() {
    return this._visibleIssueOrder || [];
  }
  effectiveSelectedIds() {
    const visible = new Set(this.currentRowOrderIds());
    return this.state.selectedIssueIds.filter(id => visible.has(id));
  }
  // Selection conventions (the design handoff didn't specify the exact
  // mechanics, so this follows familiar file-manager/mail-client norms):
  // a plain click/x starts a fresh single-row selection and moves the
  // anchor there; shift-click ranges from whatever the anchor currently
  // is WITHOUT moving it, so repeated shift-clicks keep extending or
  // shrinking from the same origin; cmd/ctrl-click toggles just one row
  // without touching the rest, and moves the anchor to it.
  toggleRowSelection(issueId) {
    this.setState(s => {
      const has = s.selectedIssueIds.includes(issueId);
      return {
        selectedIssueIds: has ? s.selectedIssueIds.filter(id => id !== issueId) : s.selectedIssueIds.concat([issueId]),
        focusAnchorId: issueId
      };
    });
  }
  toggleRowSelectionAdditive(issueId) {
    this.toggleRowSelection(issueId);
  }
  selectRowRange(toIssueId) {
    this.setState(s => {
      const orderedIds = this.currentRowOrderIds();
      const fromIssueId = (s.focusAnchorId && orderedIds.includes(s.focusAnchorId)) ? s.focusAnchorId : toIssueId;
      const fromIdx = orderedIds.indexOf(fromIssueId);
      const toIdx = orderedIds.indexOf(toIssueId);
      if (fromIdx === -1 || toIdx === -1) {
        return { selectedIssueIds: s.selectedIssueIds.includes(toIssueId) ? s.selectedIssueIds : s.selectedIssueIds.concat([toIssueId]) };
      }
      const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
      const rangeIds = orderedIds.slice(lo, hi + 1);
      return { selectedIssueIds: rangeIds };
    });
  }
  toggleHeaderCheckbox() {
    this.setState(s => {
      const orderedIds = this.currentRowOrderIds();
      const allSelected = orderedIds.length > 0 && orderedIds.every(id => s.selectedIssueIds.includes(id));
      return { selectedIssueIds: allSelected ? [] : orderedIds.slice() };
    });
  }
  // Gutter click handler -- the gutter is checkbox-only, so a plain click
  // always toggles; shift/cmd-click range-select/additive-toggle same as
  // everywhere else. Refreshing one row is: check its box, then Refresh
  // in the bulk bar.
  onGutterClick(issueId, e) {
    if (e.shiftKey) { this.selectRowRange(issueId); return; }
    if (e.metaKey || e.ctrlKey) { this.toggleRowSelectionAdditive(issueId); return; }
    this.toggleRowSelection(issueId);
  }
  // tracker issue #99 (fad640df): shift-clicking the checkbox to range-
  // select also triggered the browser's own native "extend text
  // selection to here" gesture, which fires on mousedown -- before our
  // click handler (and its shiftKey check) ever runs -- highlighting the
  // text of every row in between as a side effect. Suppressing it only
  // for the shift-held case leaves a plain click's normal behavior (and
  // any actual text selection elsewhere on the row) untouched.
  onGutterMouseDown(e) {
    if (e.shiftKey) e.preventDefault();
  }
  // tracker issue #104 (29e69c41): pasting a bare URL over a text
  // selection wraps that selection in a markdown link instead of
  // replacing it -- matches the common "paste over selection ->
  // linkify" convention. Reads the pasted text and the field's own
  // native selectionStart/selectionEnd directly off the event target,
  // so this one method works identically on every markdown-capable
  // surface regardless of which state key that field's own draft
  // lives under -- the caller just supplies its existing setter.
  handleMarkdownLinkPaste(e, applyNewValue) {
    const el = e.target;
    if (el.selectionStart === el.selectionEnd) return;
    const pasted = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!isPastedTextASingleUrl(pasted)) return;
    e.preventDefault();
    applyNewValue(wrapSelectionWithMarkdownLink(el.value, el.selectionStart, el.selectionEnd, pasted.trim()));
  }
  // tracker issue #101 (0b2c30ea): "copy as Markdown" for a linked-issue
  // reference in the slideover. Deliberately NOT touching buildTextCell/
  // buildCell (shared with the main grid, out of scope) -- this reads the
  // already-built cell's own ref fields instead, so it only ever affects
  // the two slideover call sites that use it.
  markdownCopyInfoFor(cell) {
    if (!cell.isRef && !cell.hasRef) return null;
    const hasRealText = cell.displayText && cell.displayText !== '\u2014';
    const text = hasRealText ? cell.displayText : (cell.refLabel || '');
    const url = cell.hasHref ? cell.refHref : null;
    return { text, url };
  }
  copyFieldAsMarkdown = (key, text, url) => {
    const payload = url ? ('[' + text + '](' + url + ')') : text;
    this.writeToClipboard(payload).catch(() => {});
    this.setState({ markdownCopiedKey: key });
    clearTimeout(this._markdownCopyTimer);
    this._markdownCopyTimer = setTimeout(() => {
      this.setState(s => s.markdownCopiedKey === key ? { markdownCopiedKey: null } : {});
    }, 1400);
  };
  // Merges showMarkdownCopy/markdownCopied/onCopyMarkdown into an
  // already-built cell object in place, only when it actually has a ref
  // to copy -- keeps both slideover call sites (title, field grid) to a
  // one-line call instead of repeating this logic twice.
  withMarkdownCopy(cell, key) {
    const info = this.markdownCopyInfoFor(cell);
    if (!info) { cell.showMarkdownCopy = false; return cell; }
    cell.showMarkdownCopy = true;
    cell.markdownCopied = this.state.markdownCopiedKey === key;
    cell.onCopyMarkdown = e => { if (e) e.stopPropagation(); this.copyFieldAsMarkdown(key, info.text, info.url); };
    return cell;
  }
  // 'x' toggles the row at the keyboard focus anchor, defaulting to the
  // first visible row if nothing has been focused yet (a previous click,
  // 'x', or Shift+Up/Down all set the anchor).
  toggleFocusedRowByKeyboard() {
    const orderedIds = this.currentRowOrderIds();
    if (!orderedIds.length) return;
    const targetId = (this.state.focusAnchorId && orderedIds.includes(this.state.focusAnchorId)) ? this.state.focusAnchorId : orderedIds[0];
    this.toggleRowSelection(targetId);
  }
  // Shift+Up/Down: moves the anchor itself one row at a time and unions
  // the newly-reached row into the selection -- deliberately simpler than
  // mouse shift-click's fixed-origin range (documented in the
  // corresponding plan/PR notes): growing a selection this way just keeps
  // adding the next row; reversing direction adds the row on the other
  // side rather than shrinking the far end. Good enough for the
  // "extend by a few rows via keyboard" case this exists for.
  moveFocusAndExtendSelection(direction) {
    const orderedIds = this.currentRowOrderIds();
    if (!orderedIds.length) return;
    const s = this.state;
    const curIdx = s.focusAnchorId ? orderedIds.indexOf(s.focusAnchorId) : -1;
    const fromIdx = curIdx === -1 ? 0 : curIdx;
    const nextIdx = Math.max(0, Math.min(orderedIds.length - 1, fromIdx + direction));
    const nextId = orderedIds[nextIdx];
    this.setState(st => ({
      focusAnchorId: nextId,
      selectedIssueIds: st.selectedIssueIds.includes(nextId) ? st.selectedIssueIds : st.selectedIssueIds.concat([nextId])
    }));
  }
  deleteIssue(issueId) {
    const wasOpen = this.state.slideOverIssueId === issueId;
    this.requireAttribution(() => {
      this.appendSignedHistory(issueId, { text: 'Deleted issue', field: ISSUE_DELETED_FIELD_ID, value: true });
      if (wasOpen) this.setState({ slideOverIssueId: null });
    });
    if (wasOpen) {
      this._issueOpenedViaPush = false;
      if (!this._navigatingFromHistory && this.state.projectId) {
        const hash = '#/project/' + encodeURIComponent(this.state.projectId);
        if (window.location.hash !== hash) history.replaceState(null, '', hash);
      }
    }
  }
  openBulkFieldValuePicker(colId) {
    const def = this.state.fieldDefs[colId];
    const ids = this.state.selectedIssueIds;
    const values = ids.map(id => { const iss = this.findIssue(id); return iss ? iss.values[colId] : undefined; });
    let seedText = '';
    let seedMulti = [];
    if (def.type === 'multiselect') {
      const first = values[0];
      if (Array.isArray(first) && values.every(v => Array.isArray(v) && v.length === first.length && v.every(x => first.includes(x)))) seedMulti = first.slice();
    } else if (def.type === 'text' || def.type === 'date') {
      const first = values[0];
      if (values.every(v => v === first)) seedText = first || '';
    }
    this.setState(s => ({ bulkFieldMenuColId: colId, bulkTextDraft: seedText, bulkMultiDraft: Object.assign({}, s.bulkMultiDraft, { [colId]: seedMulti }) }));
  }
  toggleBulkMultiDraftOption(colId, optionId) {
    this.setState(s => {
      const cur = (s.bulkMultiDraft && s.bulkMultiDraft[colId]) || [];
      const next = cur.includes(optionId) ? cur.filter(x => x !== optionId) : cur.concat([optionId]);
      return { bulkMultiDraft: Object.assign({}, s.bulkMultiDraft, { [colId]: next }) };
    });
  }
  // Builds the standalone (non-per-cell) value picker for whichever field
  // is currently drilled into in the bulk Set-field menu. Select commits
  // immediately on click (matching selectOption's own single-cell
  // convention); multiselect/text/date compose a draft first since
  // there's no single atomic click that fully specifies the value.
  buildBulkValuePicker(colId, def, selectedIssuesFull) {
    const label = def.label;
    const currentValues = selectedIssuesFull.map(iss => iss.values[colId]);
    if (def.type === 'select') {
      const options = (def.options || []).map(opt => {
        const matchCount = currentValues.filter(v => v === opt.id).length;
        return {
          id: opt.id, label: opt.label, ringFill: col(opt.color).bg,
          matchNote: matchCount > 0 ? (matchCount + '/' + selectedIssuesFull.length + ' already') : '',
          onSelect: () => this.applyBulkFieldValue(colId, opt.id)
        };
      });
      return { label, isSelect: true, isMultiselect: false, isText: false, isDate: false, options };
    }
    if (def.type === 'multiselect') {
      const draft = (this.state.bulkMultiDraft && this.state.bulkMultiDraft[colId]) || [];
      const options = (def.options || []).map(opt => {
        const matchCount = currentValues.filter(v => Array.isArray(v) && v.includes(opt.id)).length;
        return {
          id: opt.id, label: opt.label, ringFill: col(opt.color).bg,
          selected: draft.includes(opt.id), checkBg: draft.includes(opt.id) ? 'var(--accent-fill)' : 'transparent',
          matchNote: matchCount > 0 ? (matchCount + '/' + selectedIssuesFull.length + ' already') : '',
          onToggle: () => this.toggleBulkMultiDraftOption(colId, opt.id)
        };
      });
      return { label, isSelect: false, isMultiselect: true, isText: false, isDate: false, options, onApply: () => this.applyBulkFieldValue(colId, draft) };
    }
    if (def.type === 'date') {
      return { label, isSelect: false, isMultiselect: false, isText: false, isDate: true, value: this.state.bulkTextDraft || '',
        onChange: e => this.setState({ bulkTextDraft: e.target.value }), onApply: () => this.applyBulkFieldValue(colId, this.state.bulkTextDraft || '') };
    }
    return { label, isSelect: false, isMultiselect: false, isText: true, isDate: false, value: this.state.bulkTextDraft || '',
      onChange: e => this.setState({ bulkTextDraft: e.target.value }), onApply: () => this.applyBulkFieldValue(colId, this.state.bulkTextDraft || '') };
  }
  // Bulk Set-field's commit path. Locked (rule-derived on at least one
  // selected row) fields never reach here -- the menu disables them --
  // but rows that are individually locked within an otherwise-unlocked
  // field selection are still filtered out defensively. The whole batch
  // goes through exactly one requireAttribution(...) call: the
  // per-issue setters below (selectOption/setMultiValue/commitFieldValue)
  // each call requireAttribution themselves too, but once attribution is
  // already resolved (which it will be, since this outer call resolved
  // it first) those nested calls fall straight through to running
  // synchronously -- see requireAttribution/requireIdentityEmail's own
  // single-slot _pendingAttributionAction/_pendingGatedAction fields,
  // which would otherwise silently drop all but the last queued action
  // if this loop called requireAttribution N times before any of them
  // resolved.
  applyBulkFieldValue(colId, value) {
    const def = this.effectiveDef(colId);
    if (!def) return;
    const ids = this.effectiveSelectedIds().filter(id => !!this.findIssue(id));
    this.requireAttribution(() => {
      for (const issueId of ids) {
        if (def.type === 'select') this.selectOption(issueId, colId, value);
        else if (def.type === 'multiselect') this.setMultiValue(issueId, colId, value);
        else this.commitFieldValue(issueId, colId, value);
      }
    });
    this.setState({ bulkFieldMenuOpen: false, bulkFieldMenuColId: null });
  }
  // refreshRow already refreshes every linked field on one issue,
  // sequentially; this is that same shape (refreshAll's own loop body)
  // scoped to the selection instead of every issue in the project.
  // Tracker #198: "Review" from the header chip/popover -- if the
  // job's project is already active, the gate is just a setState away
  // (and may already be showing, if this job finished while active);
  // otherwise switchProject itself now surfaces a waiting job's gate
  // automatically (see switchProject's own pendingMerge computation),
  // so a plain switch is all that's needed here.
  openRefreshJobReview(projectId) {
    this.setState({ refreshJobsPopoverOpen: false });
    const job = this.state.refreshJobs[projectId];
    if (!job || !job.preparedMerge) return;
    if (projectId === this.state.projectId) this.setState({ pendingMerge: job.preparedMerge });
    else this.switchProject(projectId);
  }
  // Aggregate view model for the global header's job chip + popover --
  // deliberately simple for the multi-job-across-projects case (the
  // handoff itself flagged this as not fully explored visually): while
  // ANY job anywhere is fetching, show one spinner + the summed
  // fraction across all of them; once none are, show a Review
  // affordance (a single job's own "N ready, M failed" if there's only
  // one, else a plain count). The popover always lists every job
  // individually regardless.
  buildHeaderJobChip(s) {
    const entries = Object.keys(s.refreshJobs || {}).map(pid => s.refreshJobs[pid]).filter(Boolean);
    if (!entries.length) return null;
    const fetching = entries.filter(j => j.status === 'fetching');
    const completed = entries.filter(j => j.status === 'ready' || j.status === 'partial');
    const isFetching = fetching.length > 0;
    let label;
    if (isFetching) {
      const totalCompleted = fetching.reduce((n, j) => n + j.completed, 0);
      const totalAll = fetching.reduce((n, j) => n + j.total, 0);
      label = totalCompleted + '/' + totalAll;
    } else if (completed.length === 1) {
      const j = completed[0];
      const readyCount = (j.preparedMerge && j.preparedMerge.computed.mergeIssueSummaries.length) || 0;
      label = j.status === 'partial' ? (readyCount + ' ready, ' + j.failedCount + ' failed') : 'Review';
    } else {
      label = 'Review (' + completed.length + ')';
    }
    const rows = entries.map(j => {
      const meta = s.projects.find(p => p.id === j.projectId);
      const name = meta ? meta.name : 'Unknown project';
      let statusText;
      if (j.status === 'fetching') statusText = 'Refreshing ' + j.total + ' issue' + (j.total === 1 ? '' : 's') + ' (' + j.completed + '/' + j.total + ')';
      else if (j.status === 'partial') statusText = ((j.preparedMerge && j.preparedMerge.computed.mergeIssueSummaries.length) || 0) + ' ready, ' + j.failedCount + ' failed';
      else statusText = 'Ready to review';
      const canView = j.status !== 'fetching';
      return {
        projectId: j.projectId, name, statusText, canView,
        cursorStyle: canView ? 'pointer' : 'default',
        onView: canView ? (() => this.openRefreshJobReview(j.projectId)) : undefined
      };
    });
    return {
      isFetching, label, anyRateLimited: fetching.some(j => j.rateLimited),
      popoverOpen: s.refreshJobsPopoverOpen,
      onToggle: () => this.setState(st => ({ refreshJobsPopoverOpen: !st.refreshJobsPopoverOpen })),
      rows
    };
  }
  async bulkRefreshSelected() {
    if (ROOM_MODE_CAPABILITIES) return; // connector-backed (Jira/Salesforce/custom) refresh needs the Tauri keychain+macro runtime, unreachable in widget mode
    const ids = this.effectiveSelectedIds();
    // Tracker #198: exactly 1 row is still quick enough to just apply
    // directly, same shape as always (now retry/timeout-wrapped via the
    // Stage 1/2 changes to applyGithubLinkToField/applyConnectorLinkToField)
    // -- nothing worth pausing to review for one row. 2+ rows stage a
    // job first (stageRefreshJob): nothing in
    // the grid changes until every row has resolved or been excluded,
    // then the existing merge gate takes over unmodified.
    if (ids.length === 1) {
      const result = await this.refreshRow(ids[0]);
      if (!result) return;
      const iss = this.findIssue(result.id);
      const lines = (result.fields || []).map(fieldRow => {
        const entry = iss && (iss.history || []).find(h => h.id === fieldRow.resultEntryId);
        return entry ? JSON.stringify({ type: 'entry', issueId: result.id, ...entry }) : null;
      }).filter(Boolean);
      const recordsBody = lines.join('\n');
      const s = this.state;
      const meta = s.projects.find(m => m.id === s.projectId);
      const envelope = await buildExportEnvelope({
        exportedBy: s.identityEmail || '', exportedAt: new Date().toISOString(),
        project: meta ? meta.name : undefined, tracker: 'Issues', recordsBody,
        publicKeyJwk: s.identityPublicKeyJwk, privateKeyJwk: s.identityPrivateKeyJwk
      });
      const { hashValid, sigValid } = await verifyExportEnvelope(envelope, recordsBody);
      const provenance = classifyExportProvenance({ envelope, hashValid, sigValid, senderTrust: null });
      const fingerprint = (envelope.sig && envelope.sig.pubKeyJwk) ? await fingerprintPublicKey(envelope.sig.pubKeyJwk) : null;
      this.recordMergeLog({ kind: 'refresh', envelope, provenance, fingerprint }, [result]);
      return;
    }
    this.stageRefreshJob(this.state.projectId, ids);
  }
  // Broadcasts this project's current refresh-job state (or its
  // absence, once removed) to every other open tab, regardless of which
  // project is active there -- the header chip has to reflect every
  // job, everywhere (confirmed: the existing doc-saved/merge-log-
  // appended channel types are insufficient for this, see tracker #198's
  // plan).
  broadcastRefreshJob(projectId) {
    if (ROOM_MODE_CAPABILITIES) return;
    this._docSyncChannel.postMessage({ type: 'refresh-job-updated', projectId, job: this.state.refreshJobs[projectId] || null });
  }
  // Tracker #198: fetches and computes an entire 2+-row refresh into an
  // in-memory job BEFORE touching anything live -- nothing in this
  // project's stored doc (or this.state, if it happens to be the active
  // project) changes until the user confirms the resulting merge gate.
  // Survives navigating away: reads/writes only via docStore +
  // state.refreshJobs, never this.state.issues directly, and
  // state.refreshJobs is deliberately excluded from switchProject's
  // reset (same precedent as globalSearchOpen/Query/Index).
  async stageRefreshJob(projectId, issueIds) {
    const doc = await docStore.getDoc(projectId);
    if (!doc) return;
    const { fieldDefs: hydratedFieldDefs, projectHistory: hydratedProjectHistory, projectNotes: hydratedProjectNotes } = hydrateProject(doc.fieldDefs, doc.projectHistory || [], doc.projectNotes || '');
    const hydratedIssues = doc.issues.map(iss => hydrateIssue(iss, hydratedFieldDefs));
    const issuesById = {};
    hydratedIssues.forEach(iss => { issuesById[iss.id] = iss; });
    const localFieldBindings = projectId === this.state.projectId ? this.state.localFieldBindings : this.localFieldBindingsFor(projectId);
    const fieldDefsForRules = effectiveFieldDefs(hydratedFieldDefs, localFieldBindings);
    const jobId = 'rj_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    this.setState(s => ({ refreshJobs: { ...s.refreshJobs, [projectId]: {
      id: jobId, projectId, status: 'fetching', total: issueIds.length, completed: 0, rateLimited: false, rows: {}
    } } }));
    this.broadcastRefreshJob(projectId);
    const succeeded = [];
    let failedCount = 0;
    for (const issueId of issueIds) {
      const issue = issuesById[issueId];
      if (!issue) continue;
      const onRetry = () => this.setState(s => {
        const job = s.refreshJobs[projectId];
        if (!job) return null;
        return { refreshJobs: { ...s.refreshJobs, [projectId]: { ...job, rateLimited: true } } };
      });
      const result = await this.stageRefreshRow(issue, fieldDefsForRules, onRetry);
      if (result && result.failed) failedCount++;
      else if (result) succeeded.push(result);
      this.setState(s => {
        const job = s.refreshJobs[projectId];
        if (!job) return null;
        return { refreshJobs: { ...s.refreshJobs, [projectId]: {
          ...job, completed: job.completed + 1, rateLimited: false,
          rows: { ...job.rows, [issueId]: (result && result.failed) ? { status: 'failed', errorText: result.errorText } : { status: 'done' } }
        } } };
      });
      this.broadcastRefreshJob(projectId);
    }
    const mergeIssueSummaries = succeeded.map(r => ({ id: r.id, fields: r.entries.map(e => ({ field: e.field, preMergeLocalEntryId: e.preMergeLocalEntryId, resultEntryId: null, value: e.value })) }));
    const proseMergeEntries = {};
    succeeded.forEach(r => { proseMergeEntries[r.id] = r.entries.map(e => ({ colId: e.field, text: e.text, value: e.value, fieldRef: e.fieldRef, origin: e.origin })); });
    const lines = [];
    succeeded.forEach(r => r.entries.forEach(e => lines.push(JSON.stringify({ type: 'entry', issueId: r.id, field: e.field, text: e.text, value: e.value }))));
    const recordsBody = lines.join('\n');
    const s0 = this.state;
    const meta = s0.projects.find(m => m.id === projectId);
    const envelope = await buildExportEnvelope({
      exportedBy: s0.identityEmail || '', exportedAt: new Date().toISOString(),
      project: meta ? meta.name : undefined, tracker: 'Issues', recordsBody,
      publicKeyJwk: s0.identityPublicKeyJwk, privateKeyJwk: s0.identityPrivateKeyJwk
    });
    const { hashValid, sigValid } = await verifyExportEnvelope(envelope, recordsBody);
    const provenance = classifyExportProvenance({ envelope, hashValid, sigValid, senderTrust: null });
    const fingerprint = (envelope.sig && envelope.sig.pubKeyJwk) ? await fingerprintPublicKey(envelope.sig.pubKeyJwk) : null;
    const preparedMerge = {
      parsed: { issues: [] },
      inboundInfo: { kind: 'refresh', envelope, provenance, fingerprint },
      computed: {
        mergedIssues: hydratedIssues, notices: {}, proseMergeEntries, mergeIssueSummaries,
        notesMergeEntries: [], notesChanged: false, commentsChanged: false
      }
    };
    this.setState(s => {
      const job = s.refreshJobs[projectId];
      if (!job) return null;
      const nextJob = { ...job, status: failedCount ? 'partial' : 'ready', rateLimited: false, preparedMerge, failedCount };
      const patch = { refreshJobs: { ...s.refreshJobs, [projectId]: nextJob } };
      if (s.projectId === projectId) patch.pendingMerge = preparedMerge;
      return patch;
    });
    this.broadcastRefreshJob(projectId);
  }
  // Matches single-delete exactly (same confirm copy/pattern, no history
  // entry either way) -- just batched into one setState instead of N.
  bulkDeleteSelected() {
    const ids = this.effectiveSelectedIds();
    if (!ids.length) return;
    this.confirmAction('Delete ' + ids.length + ' issue' + (ids.length === 1 ? '' : 's') + '? This can\'t be undone.', () => {
      this.requireAttribution(() => {
        const idSet = new Set(ids);
        ids.forEach(id => this.appendSignedHistory(id, { text: 'Deleted issue', field: ISSUE_DELETED_FIELD_ID, value: true }));
        this.setState(s => ({
          slideOverIssueId: idSet.has(s.slideOverIssueId) ? null : s.slideOverIssueId,
          selectedIssueIds: []
        }));
      });
    }, 'Delete');
  }
  buildDefaultValues() {
    const values = {};
    for (const id in this.state.fieldDefs) {
      if (id === 'title') continue;
      const def = this.state.fieldDefs[id];
      values[id] = def.type === 'multiselect' ? [] : (def.type === 'text' || def.type === 'issue' ? '' : null);
    }
    return values;
  }
  // Tracker #191: the actual per-line match/create logic, shared by
  // single-paste (addIssue, below) and bulk-paste (confirmBulkPaste) --
  // deliberately has NO requireAttribution of its own, so a caller
  // creating many rows at once can gate attribution exactly once for the
  // whole batch rather than once per row.
  createIssueFromText(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const connMatches = this.connectorMatches(trimmed);
    const conn = connMatches.length === 1 ? connMatches[0] : null; // ambiguous (>1) deliberately falls through to plain text -- no picker UI exists in this flow
    const wgParsed = !conn && this.wigwagUrlMatch(trimmed);
    const wg = wgParsed && this.resolveWigwagProjectId(wgParsed) ? wgParsed : null;
    const match = conn || null;
    const id = crypto.randomUUID ? crypto.randomUUID() : 'i-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    this.setState(s => {
      const num = Math.max(0, ...s.issues.map(i => i.num)) + 1;
      const values = this.buildDefaultValues();
      values.title = match ? 'Fetching…' : (wg ? this.resolveWigwagRef(wg).label : trimmed);
      return {
        addItemOpen: true, addItemDraft: '',
        issues: [...s.issues, { id, num, fieldRefs: {}, fieldLoading: {}, values,
          commentStreams: {}, history: [] }]
      };
    });
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-testid="table-scroll-wrap"]');
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
    this.appendSignedHistory(id, { text: 'Created' });
    if (match) this.applyLinkToField(id, 'title', match);
    else if (wg) this.applyWigwagLinkToField(id, 'title', wg);
    else this.appendSignedHistory(id, { text: 'Title set to "' + truncate(trimmed, 60) + '"', field: 'title', value: trimmed });
    for (const colId in this.state.fieldDefs) {
      if (colId === 'title') continue;
      const fdef = this.state.fieldDefs[colId];
      if (!fdef.defaultValue) continue;
      const fieldLabel = fdef.label || colId;
      if (fdef.type === 'select') {
        const opt = (fdef.options || []).find(o => o.id === fdef.defaultValue);
        this.appendSignedHistory(id, { text: fieldLabel + ' defaulted to ' + (opt ? opt.label : fdef.defaultValue), field: colId, value: fdef.defaultValue });
      } else {
        this.appendSignedHistory(id, { text: fieldLabel + ' defaulted to "' + truncate(fdef.defaultValue, 60) + '"', field: colId, value: fdef.defaultValue });
      }
    }
  }
  addIssue = (text) => {
    this.requireAttribution(() => this.createIssueFromText(text));
  };
  // Tracker #191: cross-system ref equality for duplicate detection --
  // delegates to sameRef (normalizeRef + fetchedVia/matchedId compare)
  // for every github/jira/salesforce/connector match. wigwag refs stay
  // out of scope for the fieldRef-shape unification (see the plan's own
  // "explicitly out of scope" section), so they keep their own, separate
  // equality here.
  sameWigwagRef(ref, projectId, issueId) {
    return !!ref && ref.system === 'wigwag' && ref.projectId === projectId && (ref.issueId || null) === (issueId || null);
  }
  // Same precedence/parsing as createIssueFromText, plus duplicate
  // detection against (a) every existing issue's already-hydrated
  // fieldRefs (any column, not just title -- a ref could be bound to a
  // different field) or exact title text, and (b) anything already
  // accepted EARLIER in this same paste (seenMatches/seenWigwag/
  // seenTitles) -- so an accidental repeated line within one paste only
  // ever creates one row, not two, same as it would if it existed as a
  // real prior row.
  classifyBulkPasteLines(lines, s) {
    const seenMatches = [];
    const seenWigwag = [];
    const seenTitles = [];
    return lines.map(text => {
      const trimmed = (text || '').trim();
      // Same connectorMatches-then-wigwag order as createIssueFromText;
      // ambiguous (2+) matches fall through to unlinked, same as that
      // function (no picker UI in this flow).
      const connMatches = this.connectorMatches(trimmed);
      const conn = connMatches.length === 1 ? connMatches[0] : null;
      const wgParsed = !conn && this.wigwagUrlMatch(trimmed);
      const wg = wgParsed && this.resolveWigwagProjectId(wgParsed) ? wgParsed : null;
      const match = conn || null;
      let duplicate;
      if (match) {
        duplicate = s.issues.some(iss => Object.values(iss.fieldRefs || {}).some(r => this.sameRef(r, match.fetchedVia, match.matchedId)))
          || seenMatches.some(m => m.fetchedVia === match.fetchedVia && JSON.stringify(m.matchedId) === JSON.stringify(match.matchedId));
        if (!duplicate) seenMatches.push(match);
      } else if (wg) {
        const wgProjectId = this.resolveWigwagProjectId(wg);
        const wgIssueId = wg.issueId || null;
        duplicate = s.issues.some(iss => Object.values(iss.fieldRefs || {}).some(r => this.sameWigwagRef(r, wgProjectId, wgIssueId)))
          || seenWigwag.some(w => w.projectId === wgProjectId && w.issueId === wgIssueId);
        if (!duplicate) seenWigwag.push({ projectId: wgProjectId, issueId: wgIssueId });
      } else {
        duplicate = s.issues.some(iss => iss.values && iss.values.title === trimmed) || seenTitles.includes(trimmed);
        if (!duplicate) seenTitles.push(trimmed);
      }
      return { text: trimmed, linked: !!(match || wg), duplicate };
    });
  }
  buildBulkPasteViewModel(s) {
    if (!s.bulkPasteLines) return null;
    const classified = this.classifyBulkPasteLines(s.bulkPasteLines, s);
    const linked = classified.filter(c => c.linked && !c.duplicate);
    const unlinked = classified.filter(c => !c.linked && !c.duplicate);
    const duplicates = classified.filter(c => c.duplicate);
    const totalToAdd = linked.length + unlinked.length;
    const n = s.bulkPasteLines.length;
    return {
      lineCount: n,
      lineCountLabel: n + ' line' + (n === 1 ? '' : 's') + ' pasted',
      rawLines: s.bulkPasteLines,
      reviewOpen: s.bulkPasteReviewOpen,
      linkedCount: linked.length, unlinkedCount: unlinked.length, duplicateCount: duplicates.length,
      linkedCountLabel: linked.length + ' will be added, linked',
      unlinkedCountLabel: unlinked.length + ' will be added, unlinked',
      linkedListToggleLabel: s.bulkPasteShowLinkedList ? 'Hide list' : 'Show list',
      unlinkedListToggleLabel: s.bulkPasteShowUnlinkedList ? 'Hide list' : 'Show list',
      duplicateCountLabel: duplicates.length + ' skipped — already in this project',
      showLinkedList: s.bulkPasteShowLinkedList,
      showUnlinkedList: s.bulkPasteShowUnlinkedList,
      linkedLines: linked.map(c => c.text),
      unlinkedLines: unlinked.map(c => c.text),
      duplicateSummary: duplicates.map(c => c.text).join(', '),
      totalToAdd,
      confirmLabel: 'Add ' + totalToAdd + ' issue' + (totalToAdd === 1 ? '' : 's'),
      widgetSummaryLabel: n + ' line' + (n === 1 ? '' : 's') + ' pasted · ' + linked.length + ' linked · ' + unlinked.length + ' unlinked · ' + duplicates.length + ' duplicate' + (duplicates.length === 1 ? '' : 's'),
      onReview: () => this.setState({ bulkPasteReviewOpen: true }),
      onToggleLinkedList: () => this.setState(st => ({ bulkPasteShowLinkedList: !st.bulkPasteShowLinkedList })),
      onToggleUnlinkedList: () => this.setState(st => ({ bulkPasteShowUnlinkedList: !st.bulkPasteShowUnlinkedList })),
      onCancel: () => this.cancelBulkPaste(),
      onConfirm: () => this.confirmBulkPaste()
    };
  }
  onAddItemPaste = (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 1) {
      e.preventDefault();
      this.setState({ bulkPasteLines: lines, addItemDraft: '', bulkPasteReviewOpen: false, bulkPasteShowLinkedList: false, bulkPasteShowUnlinkedList: false });
    }
  };
  cancelBulkPaste() {
    this.setState({ bulkPasteLines: null, bulkPasteReviewOpen: false, bulkPasteShowLinkedList: false, bulkPasteShowUnlinkedList: false, bulkSummaryOpen: false });
  }
  confirmBulkPaste() {
    const s = this.state;
    const lines = s.bulkPasteLines || [];
    const classified = this.classifyBulkPasteLines(lines, s);
    const toCreate = classified.filter(c => !c.duplicate).map(c => c.text);
    this.requireAttribution(() => { toCreate.forEach(text => this.createIssueFromText(text)); });
    this.cancelBulkPaste();
  }
  // 6th computeAnchor() call site (column menu/title menu/add-field/bulk-
  // field menu/filter-suggest are the other 5) -- same pattern: toggle,
  // compute geometry, pick flip-upward + max-height when it's open.
  toggleBulkSummaryPopover = (e) => {
    e.stopPropagation();
    const willOpen = !this.state.bulkSummaryOpen;
    if (!willOpen) { this.setState({ bulkSummaryOpen: false }); return; }
    const a = this.computeAnchor(e.currentTarget, 260);
    const openUpward = a.spaceBelow < 280 && a.spaceAbove > a.spaceBelow;
    const maxHeightPx = Math.max(120, (openUpward ? a.spaceAbove : a.spaceBelow) - 8);
    this.setState({ bulkSummaryOpen: true, bulkSummaryAnchorLeft: a.left, bulkSummaryAnchorTopPx: a.top, bulkSummaryAnchorBottomPx: a.upwardOffsetPx, bulkSummaryOpenUpward: openUpward, bulkSummaryMaxHeightPx: maxHeightPx });
  };
  onAddItemBoxClick = () => { if (!this.state.addItemOpen) this.setState({ addItemOpen: true }); };
  onAddItemPlusClick = (e) => {
    e.stopPropagation();
    if (this.state.addItemOpen) this.addIssue(this.state.addItemDraft);
    else this.setState({ addItemOpen: true });
  };
  onAddItemKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); this.addIssue(this.state.addItemDraft); }
    else if (e.key === 'Escape') { e.stopPropagation(); this.setState({ addItemOpen: false, addItemDraft: '' }); }
    else if (e.key === 'ArrowUp') {
      // Tracker 69502216: jump straight into editing the bottommost
      // (last-displayed, respecting the current sort/filter) issue's
      // title, same row order _visibleIssueOrder already tracks for
      // bulk-select range math -- the add-item draft itself is left
      // untouched (onAddItemBlur's own rule already decides whether the
      // box stays open once focus leaves it).
      const order = this._visibleIssueOrder || [];
      const lastId = order[order.length - 1];
      if (lastId) {
        e.preventDefault();
        const iss = this.findIssue(lastId);
        if (iss) this.startEdit(lastId, 'title', this.editValueForRef(iss.fieldRefs && iss.fieldRefs.title, iss.values.title || ''));
      }
    }
  };
  onAddItemBlur = () => { if (!this.state.addItemDraft.trim()) this.setState({ addItemOpen: false }); };

  openSlideOver(issueId) {
    if (this.state.slideOverIssueId === issueId && this.state.slideOverVisible) return;
    this.setState({ slideOverIssueId: issueId, slideOverVisible: false, activeCell: null, editingCommentFieldId: null, editingCommentId: null, editCommentDraft: '', slideOverCopyLinkLabel: 'Copy link', slideOverCopyJsonLabel: 'Copy JSON', activityTab: 'comments' });
    setTimeout(() => this.setState({ slideOverVisible: true }), 20);
    this.markCommentsRead(issueId);
    if (!this._navigatingFromHistory && this.state.projectId) {
      const hash = '#/project/' + encodeURIComponent(this.state.projectId) + '/issue/' + encodeURIComponent(issueId);
      if (window.location.hash !== hash) { history.pushState(null, '', hash); this._issueOpenedViaPush = true; }
    }
  }
  // Tracker: the Tauri desktop app's webview never implements the web
  // Notification API's own native permission prompt (no host-side glue for
  // it was ever wired up), so Notification.permission just reports
  // 'denied' forever with no UI to ever change it -- there's no "this
  // page" to go allow notifications for, unlike a real browser tab. These
  // three helpers are the one place that branches on which backend is
  // live; every other call site below just reads this.state.
  // notificationPermission and calls these, same for either platform.
  // Auto-update (tracker #205) -- Tauri desktop only, no web equivalent
  // (there's nothing analogous to self-replace a page in a browser tab).
  isTauriUpdaterRuntime = () => !!(window.__TAURI__ && window.__TAURI__.updater);
  checkForUpdate = async () => {
    if (!this.isTauriUpdaterRuntime()) return;
    this.setState({ updateCheckState: 'checking', updatePhase: 'idle', updateError: '' });
    try {
      const update = await window.__TAURI__.updater.check();
      if (update) {
        this.setState({ updateCheckState: 'available', pendingUpdate: update, updateInfo: { version: update.version, body: update.body || '' }, updateDismissed: false });
      } else {
        this.setState({ updateCheckState: 'none', pendingUpdate: null, updateInfo: null });
      }
    } catch (e) {
      console.warn('[tracker] update check failed:', e);
      this.setState({ updateCheckState: 'error', updateError: e.message || String(e) });
    }
  };
  confirmUpdate = async () => {
    if (!this.state.pendingUpdate) return;
    this.setState({ updatePhase: 'downloading' });
    try {
      await this.state.pendingUpdate.downloadAndInstall();
      this.setState({ updatePhase: 'installing' });
      await window.__TAURI__.process.relaunch();
    } catch (e) {
      console.warn('[tracker] update install failed:', e);
      this.setState({ updatePhase: 'error', updateError: e.message || String(e) });
    }
  };
  dismissUpdate = () => this.setState({ updateDismissed: true });
  isTauriNotificationRuntime = () => !!(window.__TAURI__ && window.__TAURI__.notification);
  isTauriWindowedRuntime = () => !!(window.__TAURI__ && window.__TAURI__.window);
  isTauriMacOS = () => /Mac/.test(navigator.platform || navigator.userAgent || '');
  onWindowMinimize = () => window.__TAURI__.window.getCurrentWindow().minimize();
  onWindowToggleMaximize = () => window.__TAURI__.window.getCurrentWindow().toggleMaximize();
  onWindowClose = () => window.__TAURI__.window.getCurrentWindow().close();
  checkNotificationPermission = async () => {
    if (this.isTauriNotificationRuntime()) {
      const granted = await window.__TAURI__.notification.isPermissionGranted();
      return granted ? 'granted' : 'default';
    }
    if (!window.Notification) return 'unsupported';
    return Notification.permission;
  };
  requestNotificationPermission = () => {
    if (this.isTauriNotificationRuntime()) return window.__TAURI__.notification.requestPermission();
    if (!window.Notification) return Promise.resolve('unsupported');
    return Notification.requestPermission();
  };
  // onClick/tag are web-Notification-only (Tauri's basic sendNotification
  // has no per-call click callback) -- a Tauri notification still fires,
  // it just can't focus the window and jump to the issue on click yet.
  fireNotification = ({ title, body, tag, onClick }) => {
    if (this.isTauriNotificationRuntime()) { window.__TAURI__.notification.sendNotification({ title, body }); return; }
    const n = new Notification(title, { body, tag });
    if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
  };
  toggleMentionNotifications = () => {
    if (this.state.mentionNotificationsEnabled) {
      try { localStorage.setItem(MENTION_NOTIFICATIONS_KEY, '0'); } catch (e) {}
      this.setState({ mentionNotificationsEnabled: false });
      return;
    }
    if (this.state.notificationPermission === 'unsupported') return;
    if (this.state.notificationPermission === 'denied') return;
    this.requestNotificationPermission().then(perm => {
      this.setState({ notificationPermission: perm });
      if (perm !== 'granted') return;
      this.seedNotifiedMentions();
      try { localStorage.setItem(MENTION_NOTIFICATIONS_KEY, '1'); } catch (e) {}
      this.setState({ mentionNotificationsEnabled: true });
    });
  };
  sendTestNotification = () => {
    if (this.state.notificationPermission === 'unsupported') { this.setState({ testNotificationResult: 'unsupported' }); return; }
    const fire = () => {
      try {
        this.fireNotification({ title: 'Test notification from wigwag', body: "If you can see this, notifications are working end to end." });
        this.setState({ testNotificationResult: 'sent' });
      } catch (e) {
        console.warn('[tracker] test notification failed to fire:', e);
        this.setState({ testNotificationResult: 'error', testNotificationError: e.message });
      }
    };
    if (this.state.notificationPermission === 'granted') { fire(); return; }
    if (this.state.notificationPermission === 'denied') { this.setState({ testNotificationResult: 'denied' }); return; }
    this.requestNotificationPermission().then(perm => {
      this.setState({ notificationPermission: perm });
      if (perm === 'granted') fire();
      else this.setState({ testNotificationResult: 'denied' });
    });
  };
  // Subscribes this device to Web Push via a self-hosted push-relay.js (see
  // that file's own header comment) -- tracker issue #72 (67fa1ba2). Unlike
  // sendTestNotification/checkForNewMentions (a same-tab Notification, only
  // fires while this tab is open), this survives the app being fully
  // closed, at the cost of needing that separate relay process running.
  enablePushNotifications = async () => {
    this.setState({ pushNotificationsStatus: 'subscribing', pushNotificationsError: '' });
    try {
      if (!window.Notification || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('This browser does not support push notifications.');
      }
      // iOS specifically only grants Web Push to a page already added to the
      // home screen (Settings > Share > Add to Home Screen), never a plain
      // Safari tab -- matches.standalone is Safari's own (non-standard,
      // pre-dating the Manifest spec) way of exposing that same fact.
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      if (!isStandalone) {
        throw new Error('Add wigwag to your home screen first (iOS: Share > Add to Home Screen), then open it from there and try again.');
      }
      const relayUrl = (this.state.pushRelayUrl || '').trim();
      if (!relayUrl) throw new Error('Set a push relay URL above first.');
      const email = (this.state.identityEmail || '').trim();
      if (!email) throw new Error('Set your identity email first -- see Settings > Identity.');
      const perm = await Notification.requestPermission();
      this.setState({ notificationPermission: perm });
      if (perm !== 'granted') throw new Error('Notification permission was not granted.');
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      const keyRes = await fetch(relayUrl.replace(/\/$/, '') + '/vapid-public-key', {
        headers: { 'X-Wigwag-Proxy-Secret': this.state.pushRelaySecret || '' }
      });
      if (!keyRes.ok) throw new Error('Could not reach the push relay at ' + relayUrl + ' (HTTP ' + keyRes.status + ').');
      const { publicKey } = await keyRes.json();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      const subRes = await fetch(relayUrl.replace(/\/$/, '') + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wigwag-Proxy-Secret': this.state.pushRelaySecret || '' },
        body: JSON.stringify({
          email,
          subscription: sub.toJSON(),
          repo: this.state.githubRepo,
          path: this.state.githubRepoPath,
          branch: this.state.githubRepoBranch,
          origin: location.href.replace(/#.*$/, '')
        })
      });
      if (!subRes.ok) throw new Error('Push relay rejected the subscription (HTTP ' + subRes.status + ').');
      this.setState({ pushNotificationsStatus: 'subscribed' });
      this.syncIssueSubscriptionsToRelay();
    } catch (e) {
      console.warn('[tracker] enabling push notifications failed:', e);
      this.setState({ pushNotificationsStatus: 'error', pushNotificationsError: e.message });
    }
  };
  // Marks every mention that already exists right now as notified, without
  // firing anything -- run once, right as notifications are switched on,
  // so the backlog of mentions that predate enabling them doesn't all fire
  // at once the next time checkForNewMentions() runs.
  seedNotifiedMentions = () => {
    const email = this.state.identityEmail;
    if (!email) return;
    const ids = [];
    for (const iss of this.state.issues) {
      for (const c of this.allCommentStreamEntries(iss)) {
        if (c.redacted || !c.text || (c.email && c.email === email)) continue;
        if (textMentionsEmail(c.text, email)) ids.push(c.id);
      }
    }
    this.markMentionsNotified(ids);
  };
  loadNotifiedMentionIds = () => {
    try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_MENTIONS_KEY) || '[]')); } catch (e) { return new Set(); }
  };
  markMentionsNotified = (ids) => {
    if (!ids.length) return;
    try {
      const existing = JSON.parse(localStorage.getItem(NOTIFIED_MENTIONS_KEY) || '[]');
      const merged = existing.concat(ids);
      localStorage.setItem(NOTIFIED_MENTIONS_KEY, JSON.stringify(merged.slice(Math.max(0, merged.length - NOTIFIED_MENTIONS_CAP))));
    } catch (e) {}
  };
  // Project-level comments don't currently flow through the merge path at
  // all (startMerge/applyMergedIssues never reads parsed.projectComments;
  // it's only ever wholesale-replaced on connect/reconnect), so there's
  // nothing for this to sweep there yet. Out of scope for #65; would need
  // its own union-by-key merge first.
  //
  // Deliberately a full sweep of every current comment rather than a
  // before/after diff of one specific merge: NOTIFIED_MENTIONS_KEY already
  // dedups anything already told to the user, which means this is safe (and
  // cheap -- a no-op past the dedup check) to call from *every* place new
  // comments can land, not just the one background-poll call site a
  // before/after diff would have had to be threaded through individually.
  // issues defaults to current state; callers merging in fresh data pass
  // the merged list directly so this doesn't have to wait for setState to
  // flush first.
  checkForNewMentions = (issues) => {
    const email = this.state.identityEmail;
    if (!email || !this.state.mentionNotificationsEnabled || this.state.notificationPermission !== 'granted') return;
    const alreadyNotified = this.loadNotifiedMentionIds();
    const newlyNotified = [];
    const fire = (title, body, onClick, tag) => {
      try {
        this.fireNotification({ title, body, tag: 'wigwag-mention-' + tag, onClick });
        return true;
      } catch (e) {
        console.warn('[tracker] mention notification failed to fire -- will retry next sweep:', e);
        return false;
      }
    };
    for (const iss of (issues || this.state.issues)) {
      if (iss.deleted) continue;
      for (const c of this.allCommentStreamEntries(iss)) {
        if (alreadyNotified.has(c.id) || newlyNotified.includes(c.id)) continue;
        if (c.redacted || !c.text || (c.email && c.email === email) || !textMentionsEmail(c.text, email)) continue;
        const fired = fire((c.author || 'Someone') + ' mentioned you', truncate(c.text, 140) + ' — ' + (iss.values.title || 'an issue'), () => this.openSlideOver(iss.id), c.id);
        if (fired) newlyNotified.push(c.id);
      }
    }
    if (newlyNotified.length) this.markMentionsNotified(newlyNotified);
  };
  checkForSubscribedIssueUpdates = (issues) => {
    const email = this.state.identityEmail;
    if (!email || this.state.notificationPermission !== 'granted') return;
    const subscribedIds = Object.keys(this.state.issueSubscriptions || {}).filter(id => this.state.issueSubscriptions[id]);
    if (!subscribedIds.length) return;
    const alreadyNotified = this.loadNotifiedMentionIds();
    const newlyNotified = [];
    const fire = (title, body, onClick, tag) => {
      try {
        this.fireNotification({ title, body, tag: 'wigwag-mention-' + tag, onClick });
        return true;
      } catch (e) {
        console.warn('[tracker] subscribed-issue notification failed to fire -- will retry next sweep:', e);
        return false;
      }
    };
    for (const iss of (issues || this.state.issues)) {
      if (iss.deleted || !subscribedIds.includes(iss.id)) continue;
      for (const c of this.allCommentStreamEntries(iss)) {
        const key = commentKey(c);
        if (alreadyNotified.has(key) || newlyNotified.includes(key)) continue;
        if (c.redacted || !c.text || (c.email && c.email === email)) continue;
        const fired = fire((c.author || 'Someone') + ' commented', truncate(c.text, 140) + ' — ' + (iss.values.title || 'an issue'), () => this.openSlideOver(iss.id), key);
        if (fired) newlyNotified.push(key);
      }
      for (const h of (iss.history || [])) {
        const key = entryKey(h);
        if (alreadyNotified.has(key) || newlyNotified.includes(key)) continue;
        if (!h.field || h.origin === 'legacy-backfill' || (h.email && h.email === email)) continue;
        const fired = fire('Update on ' + (iss.values.title || 'an issue'), h.text || 'A field changed', () => this.openSlideOver(iss.id), key);
        if (fired) newlyNotified.push(key);
      }
    }
    if (newlyNotified.length) this.markMentionsNotified(newlyNotified);
  };
  closeSlideOver = () => {
    if (this.state.activeCell && this.state.activeCell.issueId === this.state.slideOverIssueId) {
      this.commitEdit(this.state.activeCell.issueId, this.state.activeCell.colId);
    }
    this.setState({ slideOverVisible: false, newCommentDraft: '', commentStreamDrafts: {}, editingCommentFieldId: null, editingCommentId: null, editCommentDraft: '', jumpDismissed: false });
    setTimeout(() => this.setState(s => (s.slideOverVisible ? {} : { slideOverIssueId: null })), 280);
    if (!this._navigatingFromHistory) {
      if (this._issueOpenedViaPush) {
        // We pushed this entry ourselves when the issue was opened in-app --
        // consuming it via back() (rather than replaceState) is what lets
        // the Forward button redo the open.
        this._issueOpenedViaPush = false;
        history.back();
      } else if (this.state.projectId) {
        // No entry of ours to consume (e.g. the page loaded directly on an
        // issue link) -- back() here would navigate away from the app
        // entirely, so just correct the address bar in place instead.
        const hash = '#/project/' + encodeURIComponent(this.state.projectId);
        if (window.location.hash !== hash) history.replaceState(null, '', hash);
      }
    }
  };
  startEditCommentStreamEntry(fieldId, commentId, currentText) { this.setState({ editingCommentFieldId: fieldId, editingCommentId: commentId, editCommentDraft: currentText }); }
  cancelEditComment = () => { this.setState({ editingCommentFieldId: null, editingCommentId: null, editCommentDraft: '' }); };
  saveEditComment = () => {
    const fieldId = this.state.editingCommentFieldId;
    const id = this.state.editingCommentId;
    const text = this.translateWigwagLinksInText(this.state.editCommentDraft.trim());
    if (!fieldId || !id || !text || !this.state.slideOverIssueId) { this.cancelEditComment(); return; }
    this.requireAttribution(() => {
      const issueId = this.state.slideOverIssueId;
      const entryBase = {
        id, author: this.displayName(), email: this.state.identityEmail || '', text,
        sortKey: this.nextSortKey()
      };
      commitSignedEntry(entryBase, {
        signable: signableCommentPayload(issueId, entryBase),
        redacted: redactedCommentPayload(issueId, entryBase)
      }, {
        sign: (payload) => this.signPayload(payload),
        insertUnsigned: (entry) => this.setState(s => ({
          editingCommentFieldId: null, editingCommentId: null, editCommentDraft: '',
          issues: s.issues.map(iss => iss.id === issueId ? {
            ...iss,
            commentStreams: {
              ...iss.commentStreams,
              [fieldId]: [
                ...(iss.commentStreams[fieldId] || []).map(c => (c.id === id && !c.redacted)
                  ? { id: c.id, author: c.author, email: c.email, time: c.time, sortKey: c.sortKey, redacted: true, sigRedacted: c.sigRedacted, pubKey: c.pubKey }
                  : c),
                entry
              ]
            }
          } : iss)
        })),
        patchSignature: (pid, sortKey, sig, sigRedacted, pubKey) => this.setState(st => ({
          issues: st.issues.map(iss => iss.id === issueId ? { ...iss, commentStreams: { ...iss.commentStreams, [fieldId]: (iss.commentStreams[fieldId] || []).map(c => c.id === pid && c.sortKey === sortKey ? { ...c, sig, sigRedacted, pubKey } : c) } } : iss)
        })),
        currentPubKey: () => this.state.identityPublicKeyJwk
      });
    });
  };
  addCommentStreamEntry = (issueId, fieldId, draft) => {
    const text = this.translateWigwagLinksInText((draft || '').trim());
    if (!text || !issueId) return;
    this.requireAttribution(() => {
      const entryBase = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        author: this.displayName(), email: this.state.identityEmail || '', text,
        sortKey: this.nextSortKey()
      };
      commitSignedEntry(entryBase, {
        signable: signableCommentPayload(issueId, entryBase),
        redacted: redactedCommentPayload(issueId, entryBase)
      }, {
        sign: (payload) => this.signPayload(payload),
        insertUnsigned: (entry) => this.setState(s => ({
          newCommentDraft: fieldId === 'comments' ? '' : s.newCommentDraft,
          commentStreamDrafts: { ...s.commentStreamDrafts, [fieldId]: '' },
          activeCell: null,
          issues: s.issues.map(iss => iss.id === issueId ? { ...iss, commentStreams: { ...iss.commentStreams, [fieldId]: [...(iss.commentStreams[fieldId] || []), entry] } } : iss),
          commentReads: fieldId === 'comments' ? { ...s.commentReads, [issueId]: Math.max(s.commentReads[issueId] || 0, entry.sortKey) } : s.commentReads
        })),
        patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => this.setState(st => ({
          issues: st.issues.map(iss => iss.id === issueId ? { ...iss, commentStreams: { ...iss.commentStreams, [fieldId]: (iss.commentStreams[fieldId] || []).map(c => c.id === id && c.sortKey === sortKey ? { ...c, sig, sigRedacted, pubKey } : c) } } : iss)
        })),
        currentPubKey: () => this.state.identityPublicKeyJwk
      });
    });
  };
  addComment = () => { this.addCommentStreamEntry(this.state.slideOverIssueId, 'comments', this.state.newCommentDraft); };
  // Opens the project-wide notes/comments panel -- same anatomy and mount/
  // animate timing as openSlideOver/closeSlideOver (mount hidden, flip
  // visible on a 20ms timeout so the transform actually animates in;
  // closing reverses that, unmounting 280ms after the transform starts so
  // the panel is still there to slide out). The overlay covers the whole
  // viewport including the header, so there's no reachable way to open this
  // while an issue slide-over is already open (or vice versa) -- no extra
  // mutual-exclusion state needed.
  toggleProjectNotes() {
    if (this.state.projectNotesOpen) { this.closeProjectNotes(); return; }
    this.setState(s => ({ projectNotesOpen: true, projectNotesVisible: false, projectNoteEditing: false, projectNoteDraft: s.projectNotes, projectPanelSection: 'notes', switcherOpen: false, activeCell: null, activityTab: 'comments' }));
    setTimeout(() => this.setState({ projectNotesVisible: true }), 20);
  }
  closeProjectNotes = () => {
    this.setState({ projectNotesVisible: false, projectCommentDraft: '', projectLinkCopyLabel: 'Copy link' });
    setTimeout(() => this.setState(s => (s.projectNotesVisible ? {} : { projectNotesOpen: false, projectNoteEditing: false })), 280);
  };
  startNoteEdit() { this.setState(s => ({ projectNoteEditing: true, projectNoteDraft: s.projectNotes })); }
  cancelNoteEdit() { this.setState(s => ({ projectNoteEditing: false, projectNoteDraft: s.projectNotes })); }
  // Closing the panel discards unsaved edits (closeProjectNotes never
  // touches projectNotes) -- only this commits.
  saveNoteEdit() {
    const text = this.translateWigwagLinksInText(this.state.projectNoteDraft);
    this.setState({ projectNoteEditing: false });
    this.appendProjectHistory({ text: 'Notes updated', field: PROJECT_NOTES_FIELD_ID, value: text });
  }
  postProjectComment() {
    const text = this.translateWigwagLinksInText((this.state.projectCommentDraft || '').trim());
    if (!text) return;
    this.requireAttribution(() => {
      const projectId = this.state.projectId;
      const entryBase = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'pc-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        author: this.displayName(), email: this.state.identityEmail || '', text,
        sortKey: this.nextSortKey()
      };
      commitSignedEntry(entryBase, {
        signable: signableProjectCommentPayload(projectId, entryBase),
        redacted: redactedProjectCommentPayload(projectId, entryBase)
      }, {
        sign: (payload) => this.signPayload(payload),
        insertUnsigned: (entry) => this.setState(s => ({ projectCommentDraft: '', projectComments: [...s.projectComments, entry] })),
        patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => this.setState(st => ({
          projectComments: st.projectComments.map(c => c.id === id ? { ...c, sig, sigRedacted, pubKey } : c)
        })),
        currentPubKey: () => this.state.identityPublicKeyJwk
      });
    });
  }

  sortBy(colId, forceDir) {
    this.setState(s => {
      const sort = forceDir ? { colId, dir: forceDir } : (s.sort.colId === colId ? { colId, dir: s.sort.dir === 'asc' ? 'desc' : 'asc' } : { colId, dir: 'asc' });
      return { sort, sortSnapshot: computeSortSnapshot(sort, s.issues, s.fieldDefs), openColMenuId: null };
    });
  }
  clearSort() { this.setState({ sort: { colId: null, dir: 'asc' }, sortSnapshot: null, openColMenuId: null }); }
  setGroupBy(colId) { this.setState({ kanbanColId: colId, openColMenuId: null, selectedIssueIds: [] }); }
  clearGroupBy() { this.setState({ kanbanColId: null }); }
  toggleFreeze(colId) { this.setState(s => ({ freezeColId: s.freezeColId === colId ? null : colId, openColMenuId: null })); }
  clearFreeze() { this.setState({ freezeColId: null }); const w = document.querySelector('[data-testid="table-scroll-wrap"]'); if (w) w.scrollLeft = 0; }
  // Tracker #169/4f07e72b: moderator-proposed table layouts, sent as a
  // Matrix STATE event (see WIGWAG_MATRIX_LAYOUT_PROPOSAL_TYPE's own
  // comment in wigwag-core.js) -- a purely local cosmetic-pref exchange:
  // never appended to project history, never exported/merged. proposedBy
  // is the sender's own room display label (cosmetic, same as
  // resolveRoomModeIdentity's own identity.label), just for the banner's
  // "X proposed a layout" text -- not an attribution/signature field.
  getOrCreateDeviceId() {
    try {
      let id = localStorage.getItem('git_native_tracker_device_id_v1');
      if (!id) {
        id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          // Fallback for a non-secure context (crypto.randomUUID throws
          // there -- plain http:// on anything but localhost, e.g. a LAN
          // IP reached from a second real device): not cryptographically
          // strong, but this id is only ever a cosmetic de-dup key, never
          // a security boundary, so that's fine.
          : ('dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
        localStorage.setItem('git_native_tracker_device_id_v1', id);
      }
      return id;
    } catch (e) { return null; }
  }
  buildLayoutProposalSnapshot() {
    const s = this.state;
    const identity = s.identities.find(i => i.id === s.activeIdentityId);
    return {
      columnOrder: s.columnOrder,
      columnWidths: s.columnWidths,
      hiddenFieldIds: s.hiddenFieldIds,
      freezeColId: s.freezeColId || null,
      proposedBy: (identity && identity.label) || null,
      proposedByMatrixUserId: (identity && identity.matrixUserId) || null,
      proposedByDeviceId: (identity && identity.matrixDeviceId) || this.getOrCreateDeviceId(),
      proposedAt: Date.now()
    };
  }
  // Live-reported (Tom, 2026-09-29): a moderator proposing a layout
  // doesn't need to see their own just-sent proposal reflected back as a
  // banner -- Matrix delivers a state event to its own sender the same as
  // any other member, so without this the sender's device would otherwise
  // show their own proposal to themselves on the very next poll tick.
  // Pre-marking it "already handled" (same mechanism accept/dismiss use)
  // suppresses exactly that reflection, for this project only.
  sendLayoutProposal() {
    const projectId = this.state.projectId;
    const content = this.buildLayoutProposalSnapshot();
    this._handledLayoutProposalKeyByProject[projectId] = this.layoutProposalKey(content);
    window.parent.postMessage({ type: 'wigwag:propose-layout', projectId, content }, '*');
    this.setState({ proposeLayoutConfirmOpen: false });
  }
  layoutProposalKey(proposal) { return proposal ? (proposal.proposedBy + ':' + proposal.proposedAt) : null; }
  // Used both to decide whether an incoming push should (re)open a given
  // project's banner, and (via acceptLayoutProposal/dismissLayoutProposal
  // below) to remember that this exact proposal was already handled for
  // that project -- a poll tick re-delivers every project's CURRENT
  // proposal unconditionally on every change (wigwag-matrix-host.html's
  // own comment), so without this an already-accepted/dismissed proposal
  // would reopen its own banner on the very next tick. Scoped per
  // project id (_handledLayoutProposalKeyByProject), not globally -- a
  // room can hold more than one project (#149), each with its own
  // independent proposal/accept/dismiss history.
  layoutProposalIfNotHandled(projectId, proposal) {
    const key = this.layoutProposalKey(proposal);
    return (!key || key === this._handledLayoutProposalKeyByProject[projectId]) ? null : proposal;
  }
  filterHandledLayoutProposals(proposalsByProjectId) {
    const s = this.state;
    const myIdentity = s.identities.find(i => i.id === s.activeIdentityId);
    const myDeviceId = (myIdentity && myIdentity.matrixDeviceId) || this.getOrCreateDeviceId();
    const out = {};
    for (const projectId in proposalsByProjectId) {
      const proposal = proposalsByProjectId[projectId];
      if (myDeviceId && proposal && proposal.proposedByDeviceId === myDeviceId) continue;
      const kept = this.layoutProposalIfNotHandled(projectId, proposal);
      if (kept) out[projectId] = kept;
    }
    return out;
  }
  // Applies the proposed columns/widths/visibility/freeze point purely as
  // local state -- reuses the exact same fields (and, via
  // componentDidUpdate, the exact same persistColumnWidths/
  // persistColumnOrder/persistHiddenFieldIds functions) a manual drag-
  // resize/reorder/hide/freeze already goes through, so the result is
  // freely editable afterward with no special-cased "came from a
  // proposal" residue anywhere. reconcileColumnOrder guards against a
  // proposal naming a field id this device doesn't currently have.
  acceptLayoutProposal(projectId, proposal) {
    this._handledLayoutProposalKeyByProject[projectId] = this.layoutProposalKey(proposal);
    const hiddenFieldIds = proposal.hiddenFieldIds || [];
    const columnOrder = reconcileColumnOrder(proposal.columnOrder, this.effectiveFieldDefs(), hiddenFieldIds);
    this.setState(s => {
      const layoutProposals = Object.assign({}, s.layoutProposals);
      delete layoutProposals[projectId];
      return { columnOrder, columnWidths: proposal.columnWidths || {}, hiddenFieldIds, freezeColId: proposal.freezeColId || null, layoutProposals };
    });
  }
  // Live-reported (Tom, 2026-09-29): dismissing the one currently showing
  // should clear every other project's pending proposal too, not just
  // this one -- in practice a viewer dismissing a proposal means "not
  // interested in any of these right now," not "only this specific
  // project's." Marks every project this device currently knows about as
  // handled, not just the one actually shown.
  dismissLayoutProposal(projectId, proposal) {
    this.setState(s => {
      for (const pid in s.layoutProposals) {
        this._handledLayoutProposalKeyByProject[pid] = this.layoutProposalKey(s.layoutProposals[pid]);
      }
      this._handledLayoutProposalKeyByProject[projectId] = this.layoutProposalKey(proposal);
      return { layoutProposals: {} };
    });
  }
  // Always resolves from the real stored value now -- never hard-locked,
  // per the bound-field visibility redesign. isOverridden/isBoundLive are
  // purely informational (kanban's own lock icon -> bound/override icon;
  // draggable is unconditional now, see the kanban card builder below).
  resolveSelectOption(issue, colId) {
    const def = this.effectiveDef(colId);
    if (!def) return { opt: null, isBoundLive: false, isOverridden: false };
    const opt = (def.options || []).find(o => o.id === issue.values[colId]);
    const bindState = def.linkedSourceId ? fieldLocalBindState(issue, colId, this.liveRuleCtx(issue.id).localDerivedEntryIds) : 'plain';
    return { opt: opt || null, isBoundLive: bindState === 'bound', isOverridden: bindState === 'overridden' };
  }
  kanbanDragStart(issueId, e) { if (e && e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; this.setState({ draggingKanbanIssueId: issueId }); }
  kanbanDragOverCol(optId, e) { if (e) e.preventDefault(); if (this.state.dragOverKanbanOptId !== optId) this.setState({ dragOverKanbanOptId: optId }); }
  kanbanDragEnd() { this.setState({ draggingKanbanIssueId: null, dragOverKanbanOptId: null }); }
  kanbanDropCol(optId, e) {
    if (e) e.preventDefault();
    const issueId = this.state.draggingKanbanIssueId;
    const colId = this.state.kanbanColId;
    this.setState({ draggingKanbanIssueId: null, dragOverKanbanOptId: null });
    if (issueId && colId) this.selectOption(issueId, colId, optId);
  }
  // Row order should only change when the sort itself is set/changed or
  // the page is reloaded -- never as a side effect of editing a field,
  // even the sorted-by column. Captured once, here, at the only two
  // places sort criteria actually change (this and switchProject); NOT
  // re-armed by edits and NOT recomputed on every render, so there's no
  // per-tick mechanism that could misbehave under unrelated load the way
  // an earlier version of this fix (reverted) did.
  toggleColumnFilterValue(colId, optionId) {
    this.setState(s => {
      const current = s.columnFilters[colId] || [];
      const next = current.includes(optionId) ? current.filter(x => x !== optionId) : [...current, optionId];
      const columnFilters = { ...s.columnFilters };
      if (next.length) columnFilters[colId] = next; else delete columnFilters[colId];
      return { columnFilters, columnFilterExcludedIds: computeColumnFilterExcludedIds(columnFilters, s.issues, s.fieldDefs) };
    });
  }
  clearColumnFilter(colId) {
    this.setState(s => {
      const columnFilters = { ...s.columnFilters };
      delete columnFilters[colId];
      return { columnFilters, columnFilterExcludedIds: computeColumnFilterExcludedIds(columnFilters, s.issues, s.fieldDefs) };
    });
  }
  // Tracker #105: "Clear column filters" on the hidden-matches hint --
  // resets every column filter at once, leaves the keyword filter alone.
  clearAllColumnFilters() {
    this.setState({ columnFilters: {}, columnFilterExcludedIds: [] });
  }
  selectAllColumnFilter(colId, allIds) {
    this.setState(s => {
      const columnFilters = { ...s.columnFilters, [colId]: allIds };
      return { columnFilters, columnFilterExcludedIds: computeColumnFilterExcludedIds(columnFilters, s.issues, s.fieldDefs) };
    });
  }
  setColumnDateFilter(colId, key, value) {
    this.setState(s => {
      const current = (s.columnFilters[colId] && !Array.isArray(s.columnFilters[colId])) ? s.columnFilters[colId] : { from: '', to: '' };
      const next = { ...current, [key]: value };
      const columnFilters = { ...s.columnFilters };
      if (next.from || next.to) columnFilters[colId] = next; else delete columnFilters[colId];
      return { columnFilters, columnFilterExcludedIds: computeColumnFilterExcludedIds(columnFilters, s.issues, s.fieldDefs) };
    });
  }
  applyDatePreset(colId, presetKey) {
    const preset = dateFilterPresetRanges(new Date()).find(p => p.key === presetKey);
    if (!preset) return;
    this.setState(s => {
      const columnFilters = { ...s.columnFilters, [colId]: { from: preset.from, to: preset.to } };
      return { columnFilters, columnFilterExcludedIds: computeColumnFilterExcludedIds(columnFilters, s.issues, s.fieldDefs) };
    });
  }

  dragStart(colId, e) { e.dataTransfer.setData('text/plain', colId); this.setState({ draggingColId: colId }); }
  dragOverCol(colId, e) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const side = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
    if (this.state.dragOverColId !== colId || this.state.dragOverSide !== side) {
      this.setState({ dragOverColId: colId, dragOverSide: side });
    }
  }
  dragEndCol() { this.setState({ draggingColId: null, dragOverColId: null, dragOverSide: null }); }
  dragStartRuleRow(i, e) { e.dataTransfer.setData('text/plain', String(i)); this.setState({ draggingRuleRowIndex: i }); }
  dragOverRuleRow(i, e) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const side = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
    if (this.state.dragOverRuleRowIndex !== i || this.state.dragOverRuleRowSide !== side) {
      this.setState({ dragOverRuleRowIndex: i, dragOverRuleRowSide: side });
    }
  }
  dragEndRuleRow() { this.setState({ draggingRuleRowIndex: null, dragOverRuleRowIndex: null, dragOverRuleRowSide: null }); }
  dropRuleRow(colId, targetIdx, e) {
    e.preventDefault();
    const draggedIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const side = this.state.dragOverRuleRowSide;
    this.setState({ draggingRuleRowIndex: null, dragOverRuleRowIndex: null, dragOverRuleRowSide: null });
    if (Number.isNaN(draggedIdx) || draggedIdx === targetIdx) return;
    const rows = (this.ruleDefRows(this.effectiveDef(colId)) || []).slice();
    if (!rows[draggedIdx]) return;
    const [moved] = rows.splice(draggedIdx, 1);
    let to = draggedIdx < targetIdx ? targetIdx - 1 : targetIdx;
    if (side === 'after') to += 1;
    rows.splice(to, 0, moved);
    this.commitRuleRows(colId, rows);
  }
  dropCol(targetColId, e) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const side = this.state.dragOverSide;
    this.setState(s => {
      if (!draggedId || draggedId === targetColId) return { draggingColId: null, dragOverColId: null, dragOverSide: null };
      const order = [...s.columnOrder];
      const from = order.indexOf(draggedId);
      if (from === -1) return { draggingColId: null, dragOverColId: null, dragOverSide: null };
      order.splice(from, 1);
      let to = order.indexOf(targetColId);
      if (to === -1) to = order.length;
      else if (side === 'after') to += 1;
      order.splice(to, 0, draggedId);
      return { columnOrder: order, draggingColId: null, dragOverColId: null, dragOverSide: null };
    });
  }

  toggleColMenu(colId, e) {
    const isOpen = this.state.openColMenuId === colId;
    let anchorLeft = 0, anchorTopPx = 0, anchorBottomPx = 0, openUpward = false, maxHeightPx = 400;
    if (!isOpen && e && e.currentTarget && e.currentTarget.getBoundingClientRect) {
      const a = this.computeAnchor(e.currentTarget, 200);
      const estimatedMenuHeight = 280;
      openUpward = a.spaceBelow < estimatedMenuHeight && a.spaceAbove > a.spaceBelow;
      anchorLeft = a.left; anchorTopPx = a.bottom + 4; anchorBottomPx = a.upwardOffsetPx;
      maxHeightPx = Math.max(120, (openUpward ? a.spaceAbove : a.spaceBelow) - 8);
    }
    this.setState({ openColMenuId: isOpen ? null : colId, colMenuAnchorLeft: anchorLeft, colMenuAnchorTopPx: anchorTopPx, colMenuAnchorBottomPx: anchorBottomPx, colMenuOpenUpward: openUpward, colMenuMaxHeightPx: maxHeightPx });
  }
  toggleAddField(e) {
    const isOpen = this.state.addFieldOpen;
    let anchorLeft = 0, anchorTopPx = 0, anchorBottomPx = 0, openUpward = false;
    let maxHeightPx = 400;
    if (!isOpen && e && e.currentTarget && e.currentTarget.getBoundingClientRect) {
      const a = this.computeAnchor(e.currentTarget, 230);
      const estimatedPopoverHeight = 280;
      openUpward = a.spaceBelow < estimatedPopoverHeight && a.spaceAbove > a.spaceBelow;
      anchorLeft = a.left; anchorTopPx = a.bottom + 4; anchorBottomPx = a.upwardOffsetPx;
      maxHeightPx = Math.max(120, (openUpward ? a.spaceAbove : a.spaceBelow) - 16);
    }
    this.setState(st => ({ addFieldOpen: !st.addFieldOpen, addFieldAnchorLeft: anchorLeft, addFieldAnchorTopPx: anchorTopPx, addFieldAnchorBottomPx: anchorBottomPx, addFieldOpenUpward: openUpward, addFieldMaxHeightPx: maxHeightPx }));
  }
  startMobileSheetDrag(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const startY = touch.clientY;
    const onMove = (ev) => {
      const t2 = ev.touches && ev.touches[0];
      if (!t2) return;
      if (ev.cancelable) ev.preventDefault();
      const delta = Math.max(0, t2.clientY - startY);
      this.setState({ mobileSheetDragging: true, mobileSheetDragY: delta });
    };
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      const delta = this.state.mobileSheetDragY || 0;
      const wasRow = this.state.mobileActiveSheet === 'row';
      this.setState({ mobileSheetDragging: false, mobileSheetDragY: 0 });
      if (delta > 90) {
        this.setState({ mobileSettingsSection: null });
        const mq = () => this.setState({ mobileActiveSheet: null });
        mq();
        if (wasRow) this.closeSlideOver();
      }
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }
  startColumnResize(colId, defaultWidth, e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = this.state.columnWidths[colId] || defaultWidth;
    const onMove = (ev) => {
      const next = Math.max(28, startWidth + (ev.clientX - startX));
      this.setState(s => ({ columnWidths: { ...s.columnWidths, [colId]: next } }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  moveColumn(colId, dir) {
    this.setState(s => {
      const order = [...s.columnOrder];
      const from = order.indexOf(colId);
      if (from === -1) return {};
      order.splice(from, 1);
      let to = from;
      if (dir === 'left') to = Math.max(0, from - 1);
      else if (dir === 'right') to = Math.min(order.length, from + 1);
      else if (dir === 'start') to = 0;
      else if (dir === 'end') to = order.length;
      order.splice(to, 0, colId);
      return { columnOrder: order, openColMenuId: null };
    });
  }
  hideField(colId) {
    this.setState(s => ({ columnOrder: s.columnOrder.filter(id => id !== colId), hiddenFieldIds: [...s.hiddenFieldIds, colId], openColMenuId: null }));
  }
  showField(colId) {
    this.setState(s => ({ hiddenFieldIds: s.hiddenFieldIds.filter(id => id !== colId), columnOrder: [...s.columnOrder, colId] }));
  }
  deleteField(colId) {
    this.setState({ openColMenuId: null });
    this.confirmAction('Delete this field for every issue? This cannot be undone.', () => {
      const label = (this.state.fieldDefs[colId] || {}).label || colId;
      this.appendProjectHistory({ text: '"' + label + '" deleted', field: colId, value: null });
      this.setState(s => {
        const issues = s.issues.map(iss => { const values = { ...iss.values }; delete values[colId]; return { ...iss, values }; });
        return {
          issues,
          columnOrder: s.columnOrder.filter(id => id !== colId),
          hiddenFieldIds: s.hiddenFieldIds.filter(id => id !== colId)
        };
      });
    }, 'Delete');
  }

  // Keeps only the latest field-tagged entry per field (any origin);
  // narrative entries (create, link start/error, merge notes — anything
  // with no .field) are always retained, same as comments always are —
  // matching docs/FORMAT.md's original full-vs-squashed distinction, just
  // applied to this app's actual history shape instead of an events array.
  redactHistoryEntry(issueId, entryId) {
    this.confirmAction('Redact this history entry? Its content will be permanently removed -- this can\'t be undone.', () => {
      this.setState(s => ({
        issues: s.issues.map(iss => iss.id !== issueId ? iss : {
          ...iss, history: iss.history.map(h => h.id !== entryId || h.redacted ? h : {
            id: h.id, time: h.time, actor: h.actor, email: h.email,
            field: h.field, origin: h.origin, sortKey: h.sortKey,
            redacted: true, sigRedacted: h.sigRedacted, pubKey: h.pubKey
          })
        })
      }));
    }, 'Redact');
  }
  redactProjectHistoryEntry(entryId) {
    this.confirmAction('Redact this history entry? Its content will be permanently removed -- this can\'t be undone.', () => {
      this.setState(s => ({
        projectHistory: s.projectHistory.map(h => h.id !== entryId || h.redacted ? h : {
          id: h.id, time: h.time, actor: h.actor, email: h.email,
          field: h.field, origin: h.origin, sortKey: h.sortKey,
          redacted: true, sigRedacted: h.sigRedacted, pubKey: h.pubKey
        })
      }));
    }, 'Redact');
  }
  redactCommentStreamEntry(issueId, fieldId, commentId) {
    this.confirmAction('Redact this comment? Its content will be permanently removed -- this can\'t be undone.', () => {
      this.setState(s => ({
        issues: s.issues.map(iss => iss.id !== issueId ? iss : {
          ...iss, commentStreams: { ...iss.commentStreams, [fieldId]: (iss.commentStreams[fieldId] || []).map(c => c.id !== commentId || c.redacted ? c : {
            id: c.id, time: c.time, author: c.author, email: c.email, sortKey: c.sortKey,
            redacted: true, sigRedacted: c.sigRedacted, pubKey: c.pubKey
          }) }
        })
      }));
    }, 'Redact');
  }
  redactProjectComment(commentId) {
    this.confirmAction('Redact this comment? Its content will be permanently removed -- this can\'t be undone.', () => {
      this.setState(s => ({
        projectComments: s.projectComments.map(c => c.id !== commentId || c.redacted ? c : {
          id: c.id, time: c.time, author: c.author, email: c.email, sortKey: c.sortKey,
          redacted: true, sigRedacted: c.sigRedacted, pubKey: c.pubKey
        })
      }));
    }, 'Redact');
  }
  startEditProjectComment(commentId, currentText) { this.setState({ editingProjectCommentId: commentId, editProjectCommentDraft: currentText }); }
  cancelEditProjectComment = () => { this.setState({ editingProjectCommentId: null, editProjectCommentDraft: '' }); };
  saveEditProjectComment = () => {
    const id = this.state.editingProjectCommentId;
    const text = this.translateWigwagLinksInText(this.state.editProjectCommentDraft.trim());
    if (!id || !text) { this.cancelEditProjectComment(); return; }
    this.requireAttribution(() => {
      const projectId = this.state.projectId;
      const entryBase = {
        id, author: this.displayName(), email: this.state.identityEmail || '', text,
        sortKey: this.nextSortKey()
      };
      commitSignedEntry(entryBase, {
        signable: signableProjectCommentPayload(projectId, entryBase),
        redacted: redactedProjectCommentPayload(projectId, entryBase)
      }, {
        sign: (payload) => this.signPayload(payload),
        insertUnsigned: (entry) => this.setState(s => ({
          editingProjectCommentId: null, editProjectCommentDraft: '',
          projectComments: [
            ...s.projectComments.map(c => (c.id === id && !c.redacted)
              ? { id: c.id, author: c.author, email: c.email, time: c.time, sortKey: c.sortKey, redacted: true, sigRedacted: c.sigRedacted, pubKey: c.pubKey }
              : c),
            entry
          ]
        })),
        patchSignature: (pid, sortKey, sig, sigRedacted, pubKey) => this.setState(st => ({
          projectComments: st.projectComments.map(c => c.id === pid && c.sortKey === sortKey ? { ...c, sig, sigRedacted, pubKey } : c)
        })),
        currentPubKey: () => this.state.identityPublicKeyJwk
      });
    });
  };
  buildSourceText(mode) {
    const s = this.state;
    const meta = s.projects.find(m => m.id === s.projectId);
    return buildSourceText(mode, {
      projectId: s.projectId, projectName: meta ? meta.name : undefined,
      fieldDefs: s.fieldDefs, projectHistory: s.projectHistory,
      projectNotes: s.projectNotes, projectComments: s.projectComments, issues: s.issues
    });
  }
  // Tracker #122 (a61676e0): the real "share this with someone else"
  // export text -- buildSourceText's existing output, with a signed
  // envelope prepended (see wigwag-core.js's own comment on
  // buildExportEnvelope for why this reuses the existing per-entry
  // ECDSA identity keys rather than real SSH signatures).
  async buildSignedExportText(mode) {
    const s = this.state;
    const meta = s.projects.find(m => m.id === s.projectId);
    const recordsBody = this.buildSourceText(mode);
    const envelope = await buildExportEnvelope({
      exportedBy: s.identityEmail || '',
      exportedAt: new Date().toISOString(),
      project: meta ? meta.name : undefined,
      tracker: 'Issues',
      recordsBody,
      publicKeyJwk: s.identityPublicKeyJwk,
      privateKeyJwk: s.identityPrivateKeyJwk
    });
    return JSON.stringify(envelope) + '\n' + recordsBody;
  }
  parseJsonl(text) {
    return parseJsonl(text, this.state.fieldDefs);
  }
  // Tracker #122 (a61676e0): parses/verifies any envelope on an incoming
  // file/paste and classifies its provenance -- runs alongside (not
  // instead of) the existing parseJsonl/startMerge pipeline, since
  // parseJsonl already tolerates an envelope line fine (unrecognized
  // `type`s are silently skipped). On a genuinely first-seen signed
  // sender, records their fingerprint immediately (no gate to pass, per
  // the handoff's own "nothing here is a gate" rule); a KEY CHANGE is
  // never auto-trusted -- accepting a rotated key is the one real
  // decision in this whole flow, and stays unresolved until a future
  // "Trust this key" UI (tracker #124) acts on it.
  async classifyIngestProvenance(text) {
    const { envelope, recordsBody } = parseExportEnvelope(text);
    const { hashValid, sigValid } = await verifyExportEnvelope(envelope, recordsBody);
    let senderTrust = null, fingerprint = null;
    if (envelope && envelope.sig && envelope.sig.pubKeyJwk) {
      fingerprint = await fingerprintPublicKey(envelope.sig.pubKeyJwk);
      senderTrust = classifySenderTrust(this.state.exportTrustStore, envelope.exported_by, fingerprint);
      if (senderTrust.state === 'first-seen') {
        const updated = rememberSenderTrust(this.state.exportTrustStore, envelope.exported_by, fingerprint, envelope.sig.pubKeyJwk, new Date().toISOString());
        this.setState({ exportTrustStore: updated });
        try { localStorage.setItem(EXPORT_TRUST_KEY, JSON.stringify(updated)); } catch (e) {}
      }
    }
    const provenance = classifyExportProvenance({ envelope, hashValid, sigValid, senderTrust });
    this.setState({ lastIngestProvenance: { envelope, provenance, fingerprint } });
    return { envelope, provenance, fingerprint };
  }
  // Strips characters illegal (or awkward) in filenames on any common OS;
  // spaces and case are left as-is for readability.
  sanitizeFilename(s) {
    let out = s || 'tracker';
    '\\/:*?"<>|'.split('').forEach(ch => { out = out.split(ch).join('-'); });
    return out.trim() || 'tracker';
  }
  exportFilename(ext) {
    const meta = this.state.projects.find(m => m.id === this.state.projectId);
    const name = this.sanitizeFilename(meta ? meta.name : 'tracker');
    const maxTs = this.lastChangeTimestamp();
    const d = maxTs ? new Date(maxTs) : new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes());
    return name + ' ' + stamp + '.' + (ext || 'jsonl');
  }
  // Fetches this page's own current source, strips any stale embedded
  // snapshot from a previous export, and inserts a fresh one (this
  // project's squashed JSONL, same reduced form the "JSONL squashed"
  // download already offers) right before </body> -- the result is a
  // complete, independently-editable copy of this same app, not a read-only
  // rendering.
  async buildHtmlExport() {
    const ownHtml = window.__wigwagOwnSource;
    if (!ownHtml) throw new Error('this page\'s own source hasn\'t been captured yet -- try reloading first');
    // Strip any snapshot from an earlier export/re-export before inserting
    // a fresh one -- bounded by distinctive comment markers rather than a
    // generic terminator like the assignment's own trailing ";", since the
    // squashed JSONL payload itself could easily contain a literal
    // semicolon (prose, comments, titles) that would otherwise truncate a
    // naive non-greedy match early.
    const stripped = ownHtml.replace(/<script>\/\*wigwag-export-snapshot\*\/[\s\S]*?\/\*\/wigwag-export-snapshot\*\/<\/script>\s*/g, '');
    const snapshotJson = JSON.stringify(this.buildSourceText('squashed')).replace(/<\//g, '<\\u002F');
    const snapshotScript = '<script>/*wigwag-export-snapshot*/window.__wigwagExportSnapshot = ' + snapshotJson + ';/*\/wigwag-export-snapshot*/<\/script>\n';
    const headIdx = stripped.indexOf('<head>');
    if (headIdx === -1) throw new Error('could not find <head> in this page\'s own source');
    const insertAt = headIdx + '<head>'.length;
    return stripped.slice(0, insertAt) + '\n' + snapshotScript + stripped.slice(insertAt);
  }
  commentStreamLatestText(issue, fieldId) {
    const entries = latestCommentsById((issue.commentStreams && issue.commentStreams[fieldId]) || []);
    if (!entries.length) return '';
    return entries.reduce((a, b) => (a.sortKey || 0) >= (b.sortKey || 0) ? a : b).text || '';
  }
  csvCellValue(def, value) {
    if (def && def.type === 'timestamp') return value == null ? '' : new Date(value).toISOString();
    if (def && def.type === 'select') {
      const opt = (def.options || []).find(o => o.id === value);
      return opt ? opt.label : (value == null ? '' : String(value));
    }
    if (def && def.type === 'multiselect') {
      const ids = Array.isArray(value) ? value : (value ? [value] : []);
      return ids.map(id => { const opt = (def.options || []).find(o => o.id === id); return opt ? opt.label : id; }).join('; ');
    }
    return value == null ? '' : String(value);
  }
  csvEscape(v) {
    const str = String(v == null ? '' : v);
    return /[",\r\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }
  buildCsvText() {
    const s = this.state;
    const fieldDefs = s.fieldDefs;
    const colIds = ['title', ...realColumnOrder(s.columnOrder)];
    const header = colIds.map(id => this.csvEscape(fieldDefs[id] ? fieldDefs[id].label : id)).join(',');
    const rows = s.issues.filter(iss => !iss.deleted).map(iss => colIds.map(id => this.csvEscape(this.csvCellValue(fieldDefs[id], fieldDefs[id].type === 'commentStream' ? this.commentStreamLatestText(iss, id) : iss.values[id]))).join(','));
    return [header, ...rows].join('\r\n');
  }
  buildXlsxBytes() {
    const s = this.state;
    const colIds = ['title', ...realColumnOrder(s.columnOrder)];
    const meta = s.projects.find(p => p.id === s.projectId);
    // buildXlsxWorkbook reads issue.values[colId] directly and has no
    // concept of commentStreams -- pre-resolve those fields' cells to
    // their latest entry text on a throwaway copy, same value a CSV
    // export would show, rather than teaching the shared xlsx builder
    // about a field type it otherwise never needs to know exists.
    const commentStreamColIds = colIds.filter(id => s.fieldDefs[id] && s.fieldDefs[id].type === 'commentStream');
    const liveIssues = s.issues.filter(iss => !iss.deleted);
    const issuesForXlsx = commentStreamColIds.length
      ? liveIssues.map(iss => ({ ...iss, values: { ...iss.values, ...Object.fromEntries(commentStreamColIds.map(id => [id, this.commentStreamLatestText(iss, id)])) } }))
      : liveIssues;
    return buildXlsxWorkbook({ sheetName: meta ? meta.name : 'Sheet1', colIds, fieldDefs: s.fieldDefs, issues: issuesForXlsx });
  }
  downloadTextFile(text, filename, mimeType) {
    const blob = new Blob([text], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  lastChangeTimestamp() {
    let maxTs = 0;
    for (const iss of this.state.issues) {
      for (const h of (iss.history || [])) { if (h.sortKey && h.sortKey > maxTs) maxTs = h.sortKey; }
      for (const c of this.allCommentStreamEntries(iss)) { if (c.sortKey && c.sortKey > maxTs) maxTs = c.sortKey; }
    }
    for (const c of (this.state.projectComments || [])) { if (c.sortKey && c.sortKey > maxTs) maxTs = c.sortKey; }
    return maxTs;
  }
  lastUpdatedLabel() {
    const maxTs = this.lastChangeTimestamp();
    return maxTs ? new Date(maxTs).toISOString() : '';
  }
  githubSyncLabel() {
    const status = this.state.githubSyncStatus;
    if (status === 'syncing') return 'Syncing…';
    if (status === 'error') return '⚠ Sync error — click to retry';
    if (status === 'synced') return 'Synced' + this.githubSyncRelativeSuffix();
    return 'Not connected';
  }
  githubSyncRelativeSuffix() {
    const at = this.state.githubLastSyncedAt;
    if (!at) return '';
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return ' just now';
    if (mins < 60) return ' ' + mins + 'm ago';
    return ' ' + Math.round(mins / 60) + 'h ago';
  }
  githubSyncColor() {
    const colors = {
      syncing: 'var(--text-muted)',
      error: 'var(--danger-ink)',
      synced: 'var(--c50)',
      disconnected: 'var(--text-muted)'
    };
    return colors[this.state.githubSyncStatus] || colors.disconnected;
  }
  onGithubSyncIndicatorClick() {
    const status = this.state.githubSyncStatus;
    if (status === 'error') this.connectGithubRepo();
    else window.open(this.githubFileUrl(), '_blank', 'noopener');
  }
  githubFileUrl() {
    const repo = (this.state.githubRepo || '').trim();
    const path = (this.state.githubRepoPath || 'tracker.jsonl').trim();
    const branch = (this.state.githubRepoBranch || '').trim() || 'HEAD';
    const encodedPath = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return 'https://github.com/' + repo + '/blob/' + encodeURIComponent(branch) + '/' + encodedPath;
  }
  // Any change to WHICH file is being synced (repo, path, branch, or the
  // token used to reach it) invalidates everything this instance thinks
  // it knows about the previous target and re-verifies against the new
  // one immediately, rather than silently coasting on stale status until
  // some unrelated content edit happens to trigger the next auto-push.
  // See connectGithubRepo's own comment for the incident this closes.
  onGithubConnectionSettingChange(patch) {
    this._githubFileSha = null;
    this._githubEtag = null;
    this._githubLastSyncedText = null;
    this.setState({ ...patch, githubSyncStatus: 'disconnected', githubSyncError: '' }, () => {
      if (document.hidden) return; // onBecameVisible picks this up once the tab is actually visible
      if ((this.state.githubRepo || '').trim().includes('/')) this.connectGithubRepo();
    });
  }
  // Connects (or reconnects) to the configured repo: pulls the current
  // remote file and reconciles it with local state via the SAME merge
  // path "Import & merge..." already uses -- empty/fresh local just
  // adopts remote, local with unsynced work merges instead of being
  // clobbered. A remote file that doesn't exist yet (404) means local is
  // authoritative -- push it as the initial commit.
  async connectGithubRepo() {
    const repo = (this.state.githubRepo || '').trim();
    if (!repo.includes('/')) {
      this.setState({ githubSyncStatus: 'error', githubSyncError: 'Set "owner/repo" in Settings first.' });
      return;
    }
    // Captured up front -- a stale fetch resolving after the user has
    // switched to a different project must not attribute its result to
    // whatever project happens to be active by then (a real, plausible
    // cause of issues from one project turning up in an unrelated one).
    // Every step below re-checks this before touching shared state.
    const id = this.state.projectId;
    this.setState({ githubSyncStatus: 'syncing', githubSyncError: '' });
    const path = (this.state.githubRepoPath || 'tracker.jsonl').trim();
    const branch = (this.state.githubRepoBranch || '').trim();
    const token = (this.state.githubTokenOverride || '').trim() || this.state.githubToken;
    const result = await pullGithubFile({ fetchImpl: fetch, repo, path, branch, token });
    if (this.state.projectId !== id) return;
    if (result.status === 'not-found') { await this.pushToGithub(); return; }
    if (result.status !== 'ok') {
      this.setState({ githubSyncStatus: 'error', githubSyncError: result.message || 'GitHub sync failed' });
      return;
    }
    this._githubEtag = result.etag;
    this._githubFileSha = result.sha;
    try {
      const parsed = this.parseJsonl(result.text);
      if (this.state.projectId !== id) return;
      if (!parsed.fields && !parsed.issues.length) throw new Error('Remote file is not a valid tracker export.');
      // Tracker #133 (0b22b69e): classifyIngestProvenance already does
      // everything the paste/file "Apply update" flow uses (parse+verify
      // the envelope, record TOFU sender trust) -- reused here so a pull
      // via reconnect attributes to a real signer, not the generic "this
      // browser" fallback. Doesn't change startMerge's own "applies
      // immediately, no gate" behavior at all -- only enriches what gets
      // recorded in the merge log.
      const { envelope, provenance, fingerprint } = await this.classifyIngestProvenance(result.text);
      if (this.state.projectId !== id) return;
      const inboundInfo = { exportedBy: envelope ? envelope.exported_by : '', exportedAt: envelope ? envelope.exported_at : null, provenance, fingerprint, envelope };
      this.startMerge(parsed, inboundInfo);
      this.setState({ githubSyncStatus: 'synced', githubSyncError: '', githubLastSyncedAt: Date.now() });
    } catch (err) {
      if (this.state.projectId === id) this.setState({ githubSyncStatus: 'error', githubSyncError: err.message });
    }
  }
  // Background polling: every VISIBLE tab periodically re-checks the
  // remote file so a collaborator's push shows up without anyone
  // reloading -- no leader election, each tab decides independently via
  // document.hidden (multiple simultaneously-visible tabs each polling is
  // accepted, deliberately: GitHub's per-token rate limit has ample
  // headroom for this, see the ETag-based conditional polling below which
  // makes a routine no-op poll not count against it at all). Deliberately
  // quiet when nothing changed (no status flicker, no startMerge call) --
  // only a genuinely different blob sha triggers a real pull-and-merge,
  // via the exact same startMerge() path connect and "Import & merge..."
  // already use. Skips entirely while the tab is hidden, while a sync is
  // already in flight, or with no token configured -- and stays silent on
  // transient failures (network blip, rate limit) rather than surfacing
  // an error the way an explicit connect/push failure does; it just
  // tries again next interval.
  async pollGithubForRemoteChanges() {
    if (document.hidden) return;
    const id = this.state.projectId;
    const repo = (this.state.githubRepo || '').trim();
    if (!id || !repo.includes('/')) return;
    if (this.state.githubSyncStatus === 'syncing') return;
    const token = (this.state.githubTokenOverride || '').trim() || this.state.githubToken;
    if (!token) return;
    const path = (this.state.githubRepoPath || 'tracker.jsonl').trim();
    const branch = (this.state.githubRepoBranch || '').trim();
    try {
      const result = await pullGithubFile({ fetchImpl: fetch, repo, path, branch, token, etag: this._githubEtag });
      if (this.state.projectId !== id) return; // switched away while this was in flight
      if (result.status === 'not-modified' || result.status === 'not-found' || result.status === 'error') return;
      this._githubEtag = result.etag || this._githubEtag;
      if (result.sha === this._githubFileSha) return;
      const parsed = this.parseJsonl(result.text);
      if (!parsed.fields && !parsed.issues.length) return;
      this.setState({ githubSyncStatus: 'syncing', githubSyncError: '' });
      this._githubFileSha = result.sha;
      // Tracker #133 (0b22b69e): same real-attribution treatment as
      // connectGithubRepo's own pull -- see that method's comment.
      const { envelope, provenance, fingerprint } = await this.classifyIngestProvenance(result.text);
      if (this.state.projectId !== id) return;
      const inboundInfo = { exportedBy: envelope ? envelope.exported_by : '', exportedAt: envelope ? envelope.exported_at : null, provenance, fingerprint, envelope };
      this.startMerge(parsed, inboundInfo);
      this.setState({ githubSyncStatus: 'synced', githubSyncError: '', githubLastSyncedAt: Date.now() });
    } catch (e) {
      // quiet -- see method comment
    }
  }
  // Pushes the current working copy. GitHub's own sha-conditional PUT is
  // what actually keeps this safe (a 409/422 means the file moved under
  // us; it never gets silently overwritten) -- connectGithubRepo() pulls
  // and merges the same way "Import & merge..." does, then this retries
  // the push itself right away, rather than leaving it to the next
  // debounced auto-push (componentDidUpdate's own
  // maybeScheduleGithubPush would otherwise re-arm a full fresh timer,
  // so a single conflict used to cost an entire extra debounce cycle
  // before recovering). retryDepth caps immediate retries at 3 so a
  // remote that's changing faster than we can catch up degrades to the
  // normal debounce cadence instead of hammering the API in a tight loop.
  async pushToGithub(retryDepth) {
    const repo = (this.state.githubRepo || '').trim();
    if (!repo.includes('/')) return;
    if (this._githubPushTimer) { clearTimeout(this._githubPushTimer); this._githubPushTimer = null; }
    const id = this.state.projectId;
    this.setState({ githubSyncStatus: 'syncing', githubSyncError: '' });
    const path = (this.state.githubRepoPath || 'tracker.jsonl').trim();
    const branch = (this.state.githubRepoBranch || '').trim();
    const token = (this.state.githubTokenOverride || '').trim() || this.state.githubToken;
    const recordsBody = this.buildSourceText('full');
    // Tracker #133 (0b22b69e): GitHub sync now carries a real signed
    // export envelope, the same one "Save project file..."/"Copy to
    // clipboard" already build via buildSignedExportText -- previously
    // GitHub sync pushed the bare records body, so any pull (background
    // poll or reconnect) had no exported_by to show, and Merge History
    // fell back to the generic "this browser" label for every one of
    // them. _githubLastSyncedText intentionally keeps tracking the
    // UNWRAPPED recordsBody, not this enveloped text -- every future
    // edit-check compares against buildSourceText('full') directly
    // (maybeScheduleGithubPush, and this method's own conflict-retry
    // guard just below), and the envelope's own exported_at timestamp
    // would otherwise make that comparison spuriously mismatch on every
    // check, even with zero real content changes.
    const meta = this.state.projects.find(m => m.id === this.state.projectId);
    const envelope = await buildExportEnvelope({
      exportedBy: this.state.identityEmail || '',
      exportedAt: new Date().toISOString(),
      project: meta ? meta.name : undefined,
      tracker: 'Issues',
      recordsBody,
      publicKeyJwk: this.state.identityPublicKeyJwk,
      privateKeyJwk: this.state.identityPrivateKeyJwk
    });
    const text = JSON.stringify(envelope) + '\n' + recordsBody;
    const result = await pushGithubFile({
      fetchImpl: fetch, repo, path, branch, token, text, sha: this._githubFileSha,
      commitMessage: buildGithubCommitMessage(this.state.issues.length),
      authorName: this.displayName(), authorEmail: (this.state.identityEmail && principalKind(this.state.identityEmail) === 'email') ? this.state.identityEmail : 'unknown@example.invalid'
    });
    if (this.state.projectId !== id) return;
    if (result.status === 'conflict') {
      await this.connectGithubRepo();
      const depth = (retryDepth || 0) + 1;
      if (this.state.projectId === id && depth <= 3 && this.buildSourceText('full') !== this._githubLastSyncedText) await this.pushToGithub(depth);
      return;
    }
    if (result.status !== 'ok') {
      this.setState({ githubSyncStatus: 'error', githubSyncError: result.message || 'GitHub sync failed' });
      return;
    }
    this._githubFileSha = result.sha;
    this._githubLastSyncedText = recordsBody;
    this.setState({ githubSyncStatus: 'synced', githubSyncError: '', githubLastSyncedAt: Date.now() });
  }
  // Debounced auto-push: fires a few seconds after the exportable state
  // (fieldDefs/issues/columnOrder, via buildSourceText) actually stops
  // changing, rather than on every render or every keystroke.
  maybeScheduleGithubPush() {
    const repo = (this.state.githubRepo || '').trim();
    if (!repo.includes('/')) return;
    // A hidden tab's edits still get persist()'d locally (unconditional,
    // unaffected) but don't auto-push until the tab is visible again --
    // see onBecameVisible, which checks immediately on refocus rather
    // than waiting for the next edit or debounce cycle.
    if (document.hidden) return;
    const text = this.buildSourceText('full');
    if (text === this._githubLastSyncedText) {
      if (this._githubPushTimer) { clearTimeout(this._githubPushTimer); this._githubPushTimer = null; }
      return;
    }
    if (this._githubPushTimer) clearTimeout(this._githubPushTimer);
    this._githubPushTimer = setTimeout(() => {
      this._githubPushTimer = null;
      if (document.hidden) return;
      if (this.state.githubSyncStatus === 'syncing') { this.maybeScheduleGithubPush(); return; }
      this.pushToGithub();
    }, this.githubPushDebounceMs || window.__wigwagPushDebounceMs || 4000);
  }
  toggleSourceView = () => this.setState(s => ({ sourceViewOpen: !s.sourceViewOpen, copyLabel: 'Copy' }));
  closeSourceView = () => this.setState({ sourceViewOpen: false });
  stopClick = e => e.stopPropagation();
  // See onCopyToClipboard's own comment for why a fallback exists at all:
  // navigator.clipboard.writeText() depends on a Permissions-Policy
  // delegation chain that, inside a third-party widget host (Element),
  // includes at least one ancestor frame wigwag itself has no way to add
  // an `allow` attribute to.
  writeToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => this.writeToClipboardFallback(text));
    }
    return this.writeToClipboardFallback(text);
  }
  writeToClipboardFallback(text) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('execCommand copy failed'));
    });
  }
  copySource = () => {
    this.writeToClipboard(this.buildSourceText()).catch(() => {});
    this.setState({ copyLabel: 'Copied!' });
    setTimeout(() => this.setState({ copyLabel: 'Copy' }), 1500);
  };
  // The link is just this page's own current URL plus a hash -- portable
  // when wigwag.html is served from a stable, shared location, but a link
  // copied from a file:// -opened copy (or the desktop app's own internal
  // load URL) only resolves back on that same machine/install.
  copyShortRef = () => {
    if (!this.state.slideOverIssueId) return;
    this.writeToClipboard(this.state.slideOverIssueId).catch(() => {});
    this.setState({ slideOverRefCopyLabel: 'Copied' });
    setTimeout(() => this.setState({ slideOverRefCopyLabel: '' }), 1200);
  };
  // Live-reported (Tom): the project panel's header just said the static
  // word "project" above the name, unlike the issue slide-over's own
  // clickable short-id above an issue's title -- same pattern here too.
  copyProjectRef = () => {
    if (!this.state.projectId) return;
    this.writeToClipboard(this.state.projectId).catch(() => {});
    this.setState({ projectRefCopyLabel: 'Copied' });
    setTimeout(() => this.setState({ projectRefCopyLabel: '' }), 1200);
  };
  openJumpResult = (issueId) => {
    // Enter-triggered opens leave keyboard focus on the filter input (a
    // key event doesn't itself move focus) -- without this, the input's
    // own onFilterKeyDown would intercept the next Escape (dismissing the
    // panel instead of closing the slide-over that's now covering it,
    // since it stopPropagation()s before the global handler ever sees it).
    // A click-triggered open naturally blurs it already; this just makes
    // both paths land in the same state afterward.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.openSlideOver(issueId);
  };
  // Global search (tracker #144, e9d61424): one flat index across every
  // project in this browser, built once per open (not per keystroke) --
  // the current project comes from live state, every other project from
  // its own localStorage doc, same source readActiveMilestoneDoc-style
  // helpers already use elsewhere for cross-project reads.
  buildGlobalSearchIndex() {
    const s = this.state;
    return s.projects.map(p => {
      if (p.id === s.projectId) {
        return { project: p, issues: s.issues.map(iss => {
          let title = '';
          try { title = deriveIssueValues(iss, s.fieldDefs).title || ''; } catch (e) { title = (iss.values && iss.values.title) || ''; }
          return { id: iss.id, title: String(title) };
        }) };
      }
      const summary = this._projectSummaries[p.id];
      return { project: p, issues: summary ? summary.issues : [] };
    });
  }
  globalSearchMatches(q) {
    const raw = String(q || '').trim().toLowerCase();
    if (!raw) return [];
    const idq = raw.replace(/^#/, '');
    const idOk = idq.length >= 2 && /^[0-9a-f-]+$/.test(idq);
    const textOk = raw.length >= 2 && !raw.startsWith('#');
    const cur = this.state.projectId;
    const out = [];
    (this._gsIndex || []).forEach(({ project, issues }) => {
      if (idOk && project.id.toLowerCase().startsWith(idq)) out.push({ kind: 'project', score: 0, project });
      else if (textOk && project.name.toLowerCase().includes(raw)) out.push({ kind: 'project', score: 2, project });
      issues.forEach(iss => {
        if (idOk && iss.id.toLowerCase().startsWith(idq)) out.push({ kind: 'issue', score: 0, project, iss });
        else if (textOk && iss.title.toLowerCase().includes(raw)) out.push({ kind: 'issue', score: 1, project, iss });
      });
    });
    out.sort((a, b) => (a.score - b.score) || ((b.project.id === cur) - (a.project.id === cur)));
    return out.slice(0, 30);
  }
  openGlobalSearch = () => {
    this._gsIndex = this.buildGlobalSearchIndex();
    this._gsPendingQuery = '';
    clearTimeout(this._gsDebounceTimer);
    this.setState({ globalSearchOpen: true, globalSearchQuery: '', globalSearchIndex: 0, switcherOpen: false, exportMenuOpen: false });
  };
  closeGlobalSearch = () => {
    clearTimeout(this._gsDebounceTimer);
    this.setState({ globalSearchOpen: false, globalSearchQuery: '', globalSearchIndex: 0 });
  };
  openGlobalSearchResult = (m) => {
    this.closeGlobalSearch();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const pid = m.project.id;
    const issueId = m.kind === 'issue' ? m.iss.id : null;
    if (pid === this.state.projectId) { if (issueId) this.openSlideOver(issueId); return; }
    const hash = '#/project/' + encodeURIComponent(pid) + (issueId ? '/issue/' + encodeURIComponent(issueId) : '');
    if (window.location.hash !== hash) history.pushState(null, '', hash);
    this.resolveDeepLinkFromHash(false);
  };
  onGlobalSearchKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeGlobalSearch(); return; }
    if (e.key === 'Enter') {
      // The query committed to state may be a debounce tick behind what's
      // actually typed (see globalSearchVals' onChange) -- Enter must act
      // on what's really in the box right now, not a stale prior query,
      // so it recomputes matches from the pending value directly rather
      // than trusting whatever's currently rendered.
      e.preventDefault();
      clearTimeout(this._gsDebounceTimer);
      const query = this._gsPendingQuery !== undefined ? this._gsPendingQuery : this.state.globalSearchQuery;
      const matches = this.globalSearchMatches(query);
      const m = matches[Math.min(this.state.globalSearchIndex || 0, matches.length - 1)];
      if (m) this.openGlobalSearchResult(m);
      return;
    }
    const matches = this.globalSearchMatches(this.state.globalSearchQuery);
    if (e.key === 'ArrowDown') { e.preventDefault(); this.setState(s => ({ globalSearchIndex: Math.min((s.globalSearchIndex || 0) + 1, Math.max(matches.length - 1, 0)) })); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this.setState(s => ({ globalSearchIndex: Math.max((s.globalSearchIndex || 0) - 1, 0) })); return; }
  };
  globalSearchVals() {
    const s = this.state;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const base = { open: s.globalSearchOpen, shortcutLabel: isMac ? '⌘K' : 'Ctrl K', onOpen: this.openGlobalSearch };
    if (!s.globalSearchOpen) return base;
    const q = s.globalSearchQuery || '';
    const qt = q.trim();
    const idq = qt.replace(/^#/, '');
    const matches = this.globalSearchMatches(q);
    const active = Math.min(s.globalSearchIndex || 0, Math.max(matches.length - 1, 0));
    const results = matches.map((m, i) => {
      const id = m.kind === 'issue' ? m.iss.id : m.project.id;
      const title = m.kind === 'issue' ? (m.iss.title || 'Untitled') : m.project.name;
      return {
        idSegments: splitHighlightSegments(id.slice(0, 8), idq),
        titleSegments: splitHighlightSegments(title, qt.startsWith('#') ? '' : qt),
        titleWeight: m.kind === 'project' ? 700 : 500,
        meta: m.kind === 'issue' ? m.project.name : 'Project',
        bg: i === active ? 'var(--c25)' : 'transparent',
        enterVisibility: i === active ? 'visible' : 'hidden',
        onClick: () => this.openGlobalSearchResult(m),
        onHover: () => { if ((this.state.globalSearchIndex || 0) !== i) this.setState({ globalSearchIndex: i }); }
      };
    });
    const n = (this._gsIndex || []).length;
    const nLabel = n + ' project' + (n === 1 ? '' : 's');
    return Object.assign(base, {
      results,
      // Debounced (tracker #144 follow-up, live report): typing a
      // character calls setState, which -- regardless of what actually
      // changed -- re-runs this app's one monolithic renderVals(),
      // rebuilding the whole table's view-model. On a large project that
      // blocks the main thread long enough that keystrokes visibly lag.
      // Deferring the setState (not the DOM update -- the browser already
      // shows the typed character natively, instantly) means a fast burst
      // of typing costs one expensive render at the end instead of one
      // per keystroke; _gsPendingQuery keeps Enter/matching correct in
      // between (see onGlobalSearchKeyDown). The systemic fix -- render
      // shouldn't rebuild the whole table for state changes that don't
      // touch it -- is filed separately (tracker #146, 70a52f00).
      onChange: e => {
        const val = e.target.value;
        this._gsPendingQuery = val;
        clearTimeout(this._gsDebounceTimer);
        this._gsDebounceTimer = setTimeout(() => {
          if (this.state.globalSearchOpen) this.setState({ globalSearchQuery: val, globalSearchIndex: 0 });
        }, 150);
      },
      onKeyDown: this.onGlobalSearchKeyDown,
      onBackdrop: e => { if (e.target === e.currentTarget) this.closeGlobalSearch(); },
      hasEmpty: results.length === 0,
      emptyText: qt ? ('Nothing matches “' + qt + '” across ' + nLabel + '.') : 'Type an issue or project id (e.g. #67fa) or part of a title.',
      footerText: 'Searching ' + nLabel + ' in this browser'
    });
  }
  onOpenWidgetFilter = () => this.setState({ widgetFilterOpen: true });
  onWidgetFilterKeyDown = (e) => {
    if (e.key === 'Escape' && !this.state.filterQuery) { e.preventDefault(); e.stopPropagation(); this.setState({ widgetFilterOpen: false }); return; }
    this.onFilterKeyDown(e);
  };
  onWidgetFilterBlur = () => { if (!this.state.filterQuery.trim()) this.setState({ widgetFilterOpen: false }); };
  onClearWidgetFilter = () => this.setState({ filterQuery: '', widgetFilterOpen: false });
  onFilterKeyDown = (e) => {
    // Id-jumping moved up to the global Ctrl+K/Cmd+K search (tracker
    // #144, e9d61424) -- this box is keyword/field-token only now.
    const suggest = this.state.filterSuggestDismissed ? { mode: null, items: [] } : computeFilterSuggestions(this.state.filterQuery, this.state.fieldDefs);
    if (suggest.mode) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.setState({ filterSuggestDismissed: true }); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); this.setState(s => ({ filterSuggestActiveIndex: Math.min((s.filterSuggestActiveIndex || 0) + 1, suggest.items.length - 1) }), () => this.scrollActiveFilterSuggestionIntoView()); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.setState(s => ({ filterSuggestActiveIndex: Math.max((s.filterSuggestActiveIndex || 0) - 1, 0) }), () => this.scrollActiveFilterSuggestionIntoView()); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.selectFilterSuggestion(Math.min(this.state.filterSuggestActiveIndex || 0, suggest.items.length - 1));
        return;
      }
    }
    if (e.key === 'Escape' && this.state.filterQuery) {
      e.preventDefault(); e.stopPropagation(); this.setState({ filterQuery: '' });
    }
  };
  scrollActiveFilterSuggestionIntoView() {
    const el = document.querySelector('[data-testid="filter-suggest-row"][data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  selectFilterSuggestion(idx) {
    const suggest = computeFilterSuggestions(this.state.filterQuery, this.state.fieldDefs);
    const suggestion = suggest.items[idx];
    if (!suggestion) return;
    // Refocusing (below) synchronously fires onFilterFocus, which resets
    // filterSuggestDismissed:false -- done FIRST so the real, authoritative
    // state update below (particularly dismissed:true for a value pick)
    // always has the last word, not the focus handler's generic default.
    const input = document.querySelector('[data-testid="filter-input"]') || document.querySelector('[data-testid="widget-filter-input"]');
    if (input) input.focus();
    this.setState({
      filterQuery: commitFilterSuggestion(this.state.filterQuery, suggestion, this.state.fieldDefs),
      filterSuggestActiveIndex: 0,
      // A field pick opens straight into that field's value suggestions;
      // a value pick closes the panel -- the just-picked value re-showing
      // itself as the only "suggestion" is redundant, not useful.
      filterSuggestDismissed: suggestion.kind === 'value'
    });
  }
  copySlideOverLink = () => {
    if (!this.state.slideOverIssueId || !this.state.projectId) return;
    const suffix = this.wigwagLinkSuffix(this.state.projectId);
    const url = 'wigwag:/project/' + encodeURIComponent(this.state.projectId) + '/issue/' + encodeURIComponent(this.state.slideOverIssueId) + suffix;
    this.writeToClipboard(url).catch(() => {});
    this.setState({ slideOverCopyLinkLabel: 'Copied!' });
    setTimeout(() => this.setState({ slideOverCopyLinkLabel: 'Copy link' }), 1500);
  };
  // The same { type: 'issue', ... } shape buildSourceText writes per issue
  // line -- full, unsquashed history, pretty-printed for readability since
  // this is for pasting into a chat/ticket/debugger, not for re-applying
  // as an update (that's what Export -> Save project file is for).
  copySlideOverJson = () => {
    const issue = this.findIssue(this.state.slideOverIssueId);
    if (!issue) return;
    const json = JSON.stringify({ type: 'issue', id: issue.id, num: issue.num, commentStreams: issue.commentStreams, history: issue.history }, null, 2);
    this.writeToClipboard(json).catch(() => {});
    this.setState({ slideOverCopyJsonLabel: 'Copied!' });
    setTimeout(() => this.setState({ slideOverCopyJsonLabel: 'Copy JSON' }), 1500);
  };
  copyProjectLink = () => {
    if (!this.state.projectId) return;
    const suffix = this.wigwagLinkSuffix(this.state.projectId);
    const url = 'wigwag:/project/' + encodeURIComponent(this.state.projectId) + suffix;
    this.writeToClipboard(url).catch(() => {});
    this.setState({ projectLinkCopyLabel: 'Copied!' });
    setTimeout(() => this.setState({ projectLinkCopyLabel: 'Copy link' }), 1500);
  };
  // A line matching /^\}/ marks a record boundary (top-level closing brace
  // sits at column 0 under the 2-space indent prettySourceNodes uses), so
  // a manual drag-select can be split back into per-record chunks and
  // re-compacted -- this is what makes a partial selection still copy as
  // valid JSONL instead of a fragment of indented display text.
  compactJsonBlock(t) {
    try { return JSON.stringify(JSON.parse(t)); }
    catch (err) { return t.split('\n').map(l => l.trim()).filter(Boolean).join(' '); }
  }
  onSourceCopy = e => {
    const sel = window.getSelection ? String(window.getSelection()) : '';
    if (!sel.trim() || !e.clipboardData) return;
    const out = [];
    let buf = [];
    sel.split('\n').forEach(line => {
      buf.push(line);
      if (/^\}/.test(line)) { out.push(this.compactJsonBlock(buf.join('\n'))); buf = []; }
    });
    if (buf.join('').trim()) out.push(this.compactJsonBlock(buf.join('\n')));
    e.preventDefault();
    e.clipboardData.setData('text/plain', out.join('\n') + '\n');
  };
  // Above ~200KB of compact JSONL, per-
  // token regex syntax highlighting is skipped -- it emits one DOM node
  // PER TOKEN (every string/number/boolean), which for a large project's
  // full history can mean tens of thousands of nodes and dominates the
  // open cost regardless of caching. Plain text keeps the view fast; full
  // highlighting still applies to any normal-sized project.
  prettySourceNodes() {
    const text = this.buildSourceText();
    if (text === this._lastSourceText) return this._lastPrettyNodes;
    this._lastSourceText = text;
    const plain = text.length > 200000 /* ~200KB compact JSONL */;
    this._lastPrettyNodes = text.split('\n').filter(l => l.trim()).map((line, i) => {
      let lineText;
      try { lineText = JSON.stringify(JSON.parse(line), null, 2); } catch (e) { lineText = line; }
      return React.createElement('div', { key: i },
        plain ? lineText : this.highlightJson(lineText),
        React.createElement('span', {
          key: 'nl',
          'aria-hidden': 'true',
          style: { color: 'var(--n60)', userSelect: 'none', WebkitUserSelect: 'none', paddingLeft: '7px', fontSize: '17px', lineHeight: '1' }
        }, '\u21B5')
      );
    });
    return this._lastPrettyNodes;
  }
  highlightJson(text) {
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    const nodes = [];
    let last = 0, m, k = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) nodes.push(text.slice(last, m.index));
      let color;
      if (m[1] && m[2]) color = 'var(--c44)';
      else if (m[1]) color = 'var(--c45)';
      else if (m[3]) color = 'var(--c46)';
      else color = 'var(--c47)';
      nodes.push(React.createElement('span', { key: 'k' + (k++), style: { color } }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
  }

  openFieldEditor(colId) { this.setState({ fieldEditorColId: colId, openColMenuId: null, colorPickerOptIndex: null }); }
  closeFieldEditor = () => this.setState({ fieldEditorColId: null, colorPickerOptIndex: null });
  // Every schema-mutating method below describes what changed via
  // appendProjectHistory instead of touching fieldDefs directly -- it logs
  // the field's WHOLE new definition (label/type/options/linkedSourceId/
  // rule together), the same "log the whole new value, not a delta"
  // pattern toggleMultiOption already used for issue values. fieldDefs
  // itself is re-derived from projectHistory inside appendProjectHistory,
  // in the same update.
  setFieldLabel(colId, value) {
    const def = this.state.fieldDefs[colId];
    this.appendProjectHistory({ text: 'Renamed "' + (def.label || colId) + '" to "' + value + '"', field: colId, value: { ...def, label: value } });
  }
  setFieldDefaultValue(colId, value) {
    const def = this.state.fieldDefs[colId];
    const label = def.label || colId;
    let display = value;
    if (def.type === 'select' && value) {
      const opt = (def.options || []).find(o => o.id === value);
      display = opt ? opt.label : value;
    }
    this.appendProjectHistory({ text: '"' + label + '" default value ' + (value ? ('set to "' + display + '"') : 'cleared'), field: colId, value: { ...def, defaultValue: value || null } });
  }
  setFieldRule(colId, value) {
    const def = this.effectiveDef(colId);
    this.recomputeAndLogDerived(() => {
      this.setLocalFieldBinding(colId, { linkedSourceId: def.linkedSourceId || null, rule: value, ruleRows: def.ruleRows || null, ruleFallback: def.ruleFallback === undefined ? null : def.ruleFallback });
    });
  }
  setFieldLinkedSource(colId, value) {
    const def = this.effectiveDef(colId);
    this.recomputeAndLogDerived(() => {
      this.setLocalFieldBinding(colId, { linkedSourceId: value || null, rule: def.rule || null, ruleRows: def.ruleRows || null, ruleFallback: def.ruleFallback === undefined ? null : def.ruleFallback });
    });
  }
  setOptionLabel(colId, idx, value) {
    const def = this.state.fieldDefs[colId];
    const opts = [...def.options]; opts[idx] = { ...opts[idx], label: value };
    this.appendProjectHistory({ text: '"' + (def.label || colId) + '": renamed option to "' + value + '"', field: colId, value: { ...def, options: opts } });
  }
  moveOption(colId, idx, dir) {
    const def = this.state.fieldDefs[colId];
    const opts = [...def.options];
    const to = idx + dir;
    if (to < 0 || to >= opts.length) return;
    const tmp = opts[idx]; opts[idx] = opts[to]; opts[to] = tmp;
    this.appendProjectHistory({ text: '"' + (def.label || colId) + '": reordered options', field: colId, value: { ...def, options: opts } });
  }
  removeOption(colId, idx) {
    const def = this.state.fieldDefs[colId];
    const removed = def.options[idx];
    const opts = def.options.filter((_, i) => i !== idx);
    this.appendProjectHistory({ text: '"' + (def.label || colId) + '": removed option "' + (removed ? removed.label : '') + '"', field: colId, value: { ...def, options: opts } });
    this.setState({ colorPickerOptIndex: null });
  }
  toggleColorPicker(idx) { this.setState(s => ({ colorPickerOptIndex: s.colorPickerOptIndex === idx ? null : idx })); }
  pickOptionColor(colId, idx, colorName) {
    const def = this.state.fieldDefs[colId];
    const opts = [...def.options]; opts[idx] = { ...opts[idx], color: colorName };
    this.appendProjectHistory({ text: '"' + (def.label || colId) + '": recolored option "' + (opts[idx].label || '') + '" to ' + colorName, field: colId, value: { ...def, options: opts } });
    this.setState({ colorPickerOptIndex: null });
  }
  addFieldEditorOption(colId) {
    const label = this.state.fieldEditorNewOptLabel.trim();
    if (!label) return;
    const def = this.state.fieldDefs[colId];
    const opts = [...def.options, { id: 'opt_' + Date.now(), label, color: 'gray', emoji: '' }];
    this.setState({ fieldEditorNewOptLabel: '' });
    this.appendProjectHistory({ text: '"' + (def.label || colId) + '": added option "' + label + '"', field: colId, value: { ...def, options: opts } });
  }

  submitNewField = () => {
    const name = this.state.newFieldName.trim();
    if (!name) return;
    const id = 'f_' + Date.now();
    const newFieldType = this.state.newFieldType;
    const definition = { label: name, type: newFieldType, options: (newFieldType === 'select' || newFieldType === 'multiselect') ? [] : undefined };
    this.setState(s => ({
      addFieldOpen: false, newFieldName: '', newFieldType: 'text',
      fieldDefs: { ...s.fieldDefs, [id]: definition },
      columnOrder: [...s.columnOrder, id],
      issues: s.issues.map(iss => newFieldType === 'commentStream'
        ? { ...iss, commentStreams: { ...iss.commentStreams, [id]: [] } }
        : { ...iss, values: { ...iss.values, [id]: newFieldType === 'multiselect' ? [] : null } })
    }));
    this.appendProjectHistory({ text: 'Created field "' + name + '"', field: id, value: definition });
  };


  withEmbeddedWigwagLinks(cell, text, filterQuery, wrapEnabled, fullLabelOnly) {
    if (!cell.isPlain) return cell; // only the no-fieldRef plain-text path applies
    const segs = splitEmbeddedWigwagLinks(text);
    if (segs.length <= 1 && !(segs[0] && segs[0].isLink)) return cell; // nothing embedded -- unchanged
    const q = filterQuery || '';
    const boundedPillStyle = 'font-size:12px; color: var(--c13); text-decoration:none; cursor:pointer;';
    const segments = segs.map(seg => {
      if (!seg.isLink) return { isLink: false, highlightSegments: splitHighlightSegments(seg.text, q) };
      const wg = this.wigwagUrlMatch(seg.text);
      const resolved = wg ? this.resolveWigwagRef(wg) : null;
      const fullLabel = resolved ? resolved.label : seg.text;
      const shortLabel = (!fullLabelOnly && wg && wg.issueId) ? '#' + wg.issueId.slice(0, 8) : fullLabel;
      return { isLink: true, label: shortLabel, fullLabel, found: !!(resolved && resolved.found),
        pillStyle: boundedPillStyle,
        onClick: e => { if (e) { e.stopPropagation(); e.preventDefault(); } if (wg) this.openWigwagRef(wg); } };
    });
    return { ...cell, isPlain: false, isMixedText: true, segments };
  }
  // Shared with the ArrowUp row-to-row jump (onAddItemKeyDown/
  // handleEditKey) so "what would clicking this title reveal to edit"
  // has exactly one implementation -- see buildTextCell's own comment
  // on why editing always surfaces the source, not the resolved value.
  editValueForRef(ref, currentText) {
    if (!ref) return currentText;
    if (ref.system === 'wigwag') return 'wigwag:/project/' + ref.projectId + (ref.issueId ? '/issue/' + ref.issueId : '');
    const n = normalizeRef(ref);
    if (!n) return currentText;
    const connector = n.fetchedVia ? this.resolveFetchConnector(n.fetchedVia) : null;
    if (connector && connector.kind === 'github') return n.href || currentText;
    const matchedId = this.resolveMatchedIdForDisplay(ref, n);
    return matchedId != null ? matchedId : currentText;
  }
  buildTextCell(issue, colId, currentText, placeholderColor, readOnly, suppressTitlePeek) {
    const s = this.state;
    const isTitle = colId === 'title' && !suppressTitlePeek;
    const isSelected = s.selectedCell && s.selectedCell.issueId === issue.id && s.selectedCell.colId === colId;
    const cellHighlight = isSelected ? 'outline:2px solid var(--accent-fill); outline-offset:-2px;' : '';
    const def = this.effectiveDef(colId);
    // Always editable now -- no early-return "computed, display-only"
    // branch any more. isBoundLive/isOverridden are purely informational,
    // computed once here and merged into every return branch below.
    const bindState = def && def.linkedSourceId ? fieldLocalBindState(issue, colId, this.liveRuleCtx(issue.id).localDerivedEntryIds) : 'plain';
    const isBoundLive = bindState === 'bound', isOverridden = bindState === 'overridden';
    const rawRef = issue.fieldRefs && issue.fieldRefs[colId];
    const ref = rawRef;
    const boundGlyphTitle = isOverridden ? this.overrideTitle(def, ref) : (isBoundLive ? this.lockTitle(def) : '');
    const showBoundGlyph = isBoundLive || isOverridden;
    // The glyph itself is an absolutely-positioned overlay (stays fixed
    // in the cell's corner regardless of content, same spot across every
    // rendering context this cell feeds -- the main grid, a slideover
    // "other field" row, the slideover description) -- it was never
    // included in the text's own layout flow, so long/wrapped text had
    // nothing stopping it from running underneath it. This reserves a
    // matching right-hand gutter on the TEXT side only, wide enough for
    // the glyph (12px) plus its offset from the edge in every context
    // that renders it (0-12px) plus breathing room -- harmless to over-
    // reserve slightly in the tighter-offset contexts, since this only
    // ever applies when the glyph is actually showing. Live-reported:
    // 26px (2px of breathing room past the glyph's own 24px footprint)
    // still read as cramped against long text -- widened to 34px (10px
    // of clearance) for real visual separation.
    const boundGlyphGutterStyle = showBoundGlyph ? 'padding-right:34px;' : '';
    const isBoundField = !!(def && def.linkedSourceId);
    const titleFontWeight = (isBoundField && ref) ? '600' : '400';
    // Editing always shows the editable SOURCE, not a derived/fetched value:
    // the reconstructed URL if resolved (or the bare key for Jira, which is
    // exactly what a user would re-type), the raw stored text otherwise.
    const editValue = this.editValueForRef(ref, currentText);
    const active = !readOnly && s.activeCell && s.activeCell.issueId === issue.id && s.activeCell.colId === colId;
    if (active) {
      // Only plain 'text' fields get the multiline/markdown textarea --
      // 'issue'-type fields (Title/"Issue" is always one now, and any
      // other GitHub/Jira/Salesforce link target) keep the original
      // single-line input untouched.
      const isMultiline = !!def && def.type === 'text';
      return { isText: true, isEditing: true, isDisplay: false, isMultiline, isPlainInput: !isMultiline, inputValue: s.editDraft, onCellClick: undefined,
        onInputChange: e => this.setState({ editDraft: e.target.value }),
        onInputPaste: e => this.handleMarkdownLinkPaste(e, v => this.setState({ editDraft: v })),
        onInputBlur: () => this.commitEdit(issue.id, colId),
        onInputKeyDown: isMultiline ? (e => this.handleMarkdownEditKey(e, issue.id, colId)) : (e => this.handleEditKey(e, issue.id, colId)),
        cellHighlight: '' };
    }
    const commitEditFn = () => this.startEdit(issue.id, colId, editValue);
    // A bound field's own ref-link row still opens on a modified click
    // (ctrl/cmd/shift/middle) -- a plain click edits instead, so clicking
    // "the value" of a bound field reliably reaches the edit affordance
    // rather than risking a stray real click landing on the nested <a>
    // and navigating away with no way to edit at all.
    const onBoundAwareRefClick = navigateFn => e => {
      if (e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return;
      if (isBoundField) { if (e) { e.preventDefault(); e.stopPropagation(); } commitEditFn(); return; }
      if (e) e.stopPropagation();
      if (navigateFn) { if (e) e.preventDefault(); navigateFn(); }
    };
    const gatedClick = readOnly ? undefined : e => { if (e && e.target.closest && e.target.closest('a')) return; this.cellClickGate(issue.id, colId, commitEditFn); };
    const titleClick = readOnly ? undefined : e => { if (e) e.stopPropagation(); this.openSlideOver(issue.id); };
    // Non-title: leave the inner text span's own onClick unset so its
    // click bubbles to onCellClick on the wrapper instead of firing the
    // gate twice (once here, once on the bubbled wrapper click).
    const isSuppressedTitle = colId === 'title' && suppressTitlePeek;
    const textClick = isTitle ? titleClick : (isSuppressedTitle ? gatedClick : undefined);
    if (issue.fieldLoading && issue.fieldLoading[colId]) {
      return { isText: true, isEditing: false, isDisplay: true, isLoading: true, isRef: false, isPlain: false, cellHighlight: '', reservesRefLine: !!ref, isBoundLive, isOverridden, showBoundGlyph, boundGlyphTitle };
    }
    if (ref && ref.system === 'wigwag') {
      return { isText: true, isEditing: false, isDisplay: true, isLoading: false, isRef: false, isPlain: true, isWigwagRef: true, isConnectorRef: false, connectorGlyph: '', connectorColor: '',
        displayText: currentText || '—', textColor: currentText ? 'var(--text-primary)' : placeholderColor,
        onClick: textClick, onCellClick: gatedClick,
        hasRef: true, refLabel: this.resolveWigwagRef(ref).label, refHref: '#', hasHref: true, noHref: false,
        onRefLinkClick: onBoundAwareRefClick(() => this.openWigwagRef(ref)), cellHighlight, isBoundLive, isOverridden, showBoundGlyph, boundGlyphTitle, boundGlyphGutterStyle, titleFontWeight };
    }
    // Every other ref system (github/jira/salesforce/connector, new-shape
    // or legacy) collapses to one branch via normalizeRef -- branding is
    // derived LIVE from the current connectedSources entry for fetchedVia,
    // never from a persisted system/kind tag (see the plan's confirmed
    // decision #2: a deleted connector's ref falls back to this branch's
    // own unbranded-pill shape, all isXRef flags false, rather than a
    // crash). matchedId is read straight off the ref when the legacy
    // shape (or a failed-fetch error-path write) carries it directly;
    // otherwise it's re-derived from the persisted href via
    // matchedIdFromHref, same helper refreshField/sameRef use.
    if (ref) {
      const n = normalizeRef(ref);
      const fetchedVia = n ? n.fetchedVia : null;
      const matchedId = this.resolveMatchedIdForDisplay(ref, n);
      const connDef = fetchedVia ? (this.state.connectedSources || []).find(c => c.id === fetchedVia) : null;
      const isGithubRef = fetchedVia === '__builtin_github' || (connDef && connDef.kind === 'github');
      const isJiraRef = fetchedVia === '__builtin_jira' || (connDef && connDef.kind === 'jira');
      const isSalesforceRef = fetchedVia === '__builtin_salesforce' || (connDef && connDef.kind === 'salesforce');
      const isConnectorRef = !!connDef && !connDef.kind;
      const href = n ? n.href : null;
      const refLabel = isGithubRef ? (matchedId ? matchedId.owner + '/' + matchedId.repo + '#' + matchedId.num : (href || ''))
        : isConnectorRef ? connectorLinkText(connDef.linkTextTemplate, currentText, matchedId)
        : (matchedId != null ? String(matchedId) : (href || ''));
      return { isText: true, isEditing: false, isDisplay: true, isLoading: false, isRef: false, isPlain: true,
        isGithubRef, isJiraRef, isSalesforceRef, isWigwagRef: false, isConnectorRef,
        connectorGlyph: isConnectorRef ? connDef.glyph : '', connectorColor: isConnectorRef ? connDef.color : '',
        displayText: currentText || '—', textColor: currentText ? 'var(--text-primary)' : placeholderColor,
        onClick: textClick, onCellClick: gatedClick,
        hasRef: true, refLabel, refHref: href || null, hasHref: !!href, noHref: !href,
        onRefLinkClick: onBoundAwareRefClick(null), cellHighlight, isBoundLive, isOverridden, showBoundGlyph, boundGlyphTitle, boundGlyphGutterStyle, titleFontWeight };
    }
    // The static "this plain text merely looks like a link" fallback is
    // also gated to type:'issue' -- only issue-type fields hold/show
    // links at all now, matching the paste-time gate in commitEdit().
    if (def && def.type === 'issue') {
      const staticRef = refInfo(currentText);
      if (staticRef) {
        return { isText: true, isEditing: false, isDisplay: true, isLoading: false, isRef: true, isPlain: false, hasHref: !!staticRef.href,
          refLabel: staticRef.label, refHref: staticRef.href, onClick: textClick, onCellClick: gatedClick,
          onRefLinkClick: e => { e.stopPropagation(); }, cellHighlight, isBoundLive, isOverridden, showBoundGlyph, boundGlyphTitle };
      }
    }
    // Plain 'text' fields (not linked to any external system, no static
    // ref match) render as markdown -- same renderMarkdown() engine as
    // comments/notes, hydrated via hydrateMarkdownBodies() into the
    // data-testid="text-field-md" div the template leaves empty (see the
    // comment above escapeHtml() for why this can't just be a {{ }} prop).
    if (def && def.type === 'text') {
      return { isText: true, isEditing: false, isDisplay: true, isLoading: false, isRef: false, isPlain: false,
        isMarkdownText: true, isEmptyMarkdown: !currentText, hasMarkdown: !!currentText, rawText: currentText,
        markdownClampStyle: this.markdownClampStyleFor(colId),
        onClick: textClick, onCellClick: gatedClick, cellHighlight, isBoundLive, isOverridden, showBoundGlyph, boundGlyphTitle, boundGlyphGutterStyle };
    }
    return { isText: true, isEditing: false, isDisplay: true, isLoading: false, isRef: false, isPlain: true, hasRef: false,
      displayText: currentText || '—', textColor: currentText ? 'var(--text-primary)' : placeholderColor,
      onClick: textClick, onCellClick: gatedClick, cellHighlight, isBoundLive, isOverridden, showBoundGlyph, boundGlyphTitle, boundGlyphGutterStyle, titleFontWeight: '400' };
  }

  buildSelectCell(issue, colId, def, readOnly, width) {
    const s = this.state;
    const affordance = computeAffordanceFade(width);
    const affordanceOpacity = affordance.opacity, affordanceWidth = affordance.width, affordanceGap = affordance.gap;
    // Always editable now -- resolves from the real stored value in every
    // case. isBoundLive/isOverridden are purely informational (same icon
    // slot the old lock icon used), never gating click/arrow/popover.
    const curId = issue.values[colId];
    const opt = (def.options || []).find(o => o.id === curId);
    const bindState = def.linkedSourceId ? fieldLocalBindState(issue, colId, this.liveRuleCtx(issue.id).localDerivedEntryIds) : 'plain';
    const isBoundLive = bindState === 'bound', isOverridden = bindState === 'overridden';
    const isSelected = s.selectedCell && s.selectedCell.issueId === issue.id && s.selectedCell.colId === colId;
    const popoverOpen = !readOnly && s.activeCell && s.activeCell.issueId === issue.id && s.activeCell.colId === colId;
    const cell = { isSelect: true, isBoundLive, isOverridden, showArrow: true, showBoundGlyph: isBoundLive || isOverridden, affordanceOpacity, affordanceWidth, affordanceGap, hasOption: !!opt, noOption: !opt,
      optionLabel: opt ? opt.label : '', optionEmoji: opt ? opt.emoji : '', optionBg: opt ? col(opt.color).bg : '', optionFg: opt ? col(opt.color).fg : '',
      onClick: readOnly ? undefined : e => this.cellClickGate(issue.id, colId, () => this.togglePopover(issue.id, colId, e)),
      onArrowClick: readOnly ? undefined : e => { e.stopPropagation(); this.togglePopover(issue.id, colId, e); },
      popoverOpen,
      boundGlyphTitle: isOverridden ? this.overrideTitle(def) : (isBoundLive ? this.lockTitle(def) : ''),
      cellHighlight: (popoverOpen || isSelected) ? 'outline:2px solid var(--accent-fill); outline-offset:-2px;' : '' };
    if (popoverOpen) {
      cell.popoverStyle = 'position:fixed; left:' + s.activeCell.anchorLeft + 'px; ' +
        (s.activeCell.openUpward ? ('bottom:' + s.activeCell.anchorBottomPx + 'px;') : ('top:' + s.activeCell.anchorTopPx + 'px;'));
      cell.clearEntry = { id: null, label: '— No value —', emoji: '', ringColor: 'var(--n41)', ringFill: 'transparent',
        selected: !curId, rowBg: !curId ? 'var(--surface-selected)' : 'transparent',
        onSelect: () => this.selectOption(issue.id, colId, null) };
      cell.options = (def.options || []).map(o => ({
        id: o.id, label: o.label, emoji: o.emoji, ringColor: col(o.color).dot, ringFill: o.id === curId ? col(o.color).dot : 'transparent',
        selected: o.id === curId, rowBg: o.id === curId ? 'var(--surface-selected)' : 'transparent',
        onSelect: () => this.selectOption(issue.id, colId, o.id)
      }));
    }
    return cell;
  }

  buildMultiCell(issue, colId, def, readOnly, width) {
    const s = this.state;
    const affordance = computeAffordanceFade(width);
    const affordanceOpacity = affordance.opacity, affordanceWidth = affordance.width, affordanceGap = affordance.gap;
    // Always editable now -- resolves from the real stored value in every
    // case. isBoundLive/isOverridden are purely informational.
    const ids = issue.values[colId] || [];
    const bindState = def.linkedSourceId ? fieldLocalBindState(issue, colId, this.liveRuleCtx(issue.id).localDerivedEntryIds) : 'plain';
    const isBoundLive = bindState === 'bound', isOverridden = bindState === 'overridden';
    const optionOrder = (def.options || []).map(o => o.id);
    const idRank = id => { const i = optionOrder.indexOf(id); return i === -1 ? Infinity : i; };
    const sortedIds = [...ids].sort((a, b) => idRank(a) - idRank(b));
    const isSelected = s.selectedCell && s.selectedCell.issueId === issue.id && s.selectedCell.colId === colId;
    const popoverOpen = !readOnly && s.activeCell && s.activeCell.issueId === issue.id && s.activeCell.colId === colId;
    const cell = { isMulti: true, isBoundLive, isOverridden, showArrow: true, showBoundGlyph: isBoundLive || isOverridden, affordanceOpacity, affordanceWidth, affordanceGap, hasChips: ids.length > 0, noChips: ids.length === 0,
      chips: sortedIds.map(id => { const o = (def.options || []).find(x => x.id === id); return { id, label: o ? o.label : id, bg: o ? col(o.color).bg : col('gray').bg, fg: o ? col(o.color).fg : col('gray').fg }; }),
      onClick: readOnly ? undefined : e => this.cellClickGate(issue.id, colId, () => this.togglePopover(issue.id, colId, e)),
      onArrowClick: readOnly ? undefined : e => { e.stopPropagation(); this.togglePopover(issue.id, colId, e); },
      popoverOpen,
      boundGlyphTitle: isOverridden ? this.overrideTitle(def) : (isBoundLive ? this.lockTitle(def) : ''),
      cellHighlight: (popoverOpen || isSelected) ? 'outline:2px solid var(--accent-fill); outline-offset:-2px;' : '' };
    if (popoverOpen) {
      cell.popoverStyle = 'position:fixed; left:' + s.activeCell.anchorLeft + 'px; ' +
        (s.activeCell.openUpward ? ('bottom:' + s.activeCell.anchorBottomPx + 'px;') : ('top:' + s.activeCell.anchorTopPx + 'px;'));
      const q = s.optionFilterQuery.trim().toLowerCase();
      cell.filterQuery = s.optionFilterQuery;
      cell.onFilterChange = e => this.setState({ optionFilterQuery: e.target.value });
      cell.options = (def.options || []).filter(o => !q || o.label.toLowerCase().includes(q)).map(o => ({
        id: o.id, label: o.label, selected: ids.includes(o.id), ringColor: col(o.color).dot,
        ringFill: ids.includes(o.id) ? col(o.color).dot : 'transparent', rowBg: ids.includes(o.id) ? 'var(--surface-selected)' : 'transparent',
        onToggle: () => this.toggleMultiOption(issue.id, colId, o.id)
      }));
    }
    return cell;
  }

  buildDateCell(issue, colId, def, readOnly) {
    const s = this.state;
    const raw = issue.values[colId];
    const displayText = raw || '—';
    const isSelected = s.selectedCell && s.selectedCell.issueId === issue.id && s.selectedCell.colId === colId;
    const cellHighlight = isSelected ? 'outline:2px solid var(--accent-fill); outline-offset:-2px;' : '';
    const active = !readOnly && s.activeCell && s.activeCell.issueId === issue.id && s.activeCell.colId === colId;
    if (active) {
      return { isDate: true, isEditing: true, isDisplay: false, inputValue: s.editDraft, onCellClick: undefined,
        onInputChange: e => this.setState({ editDraft: e.target.value }),
        onInputPaste: e => this.handleMarkdownLinkPaste(e, v => this.setState({ editDraft: v })),
        onInputBlur: () => this.commitEdit(issue.id, colId),
        onInputKeyDown: e => this.handleEditKey(e, issue.id, colId), cellHighlight: '' };
    }
    const commitEditFn = () => this.startEdit(issue.id, colId, raw || '');
    const gatedClick = readOnly ? undefined : () => this.cellClickGate(issue.id, colId, commitEditFn);
    return { isDate: true, isEditing: false, isDisplay: true, displayText,
      textColor: raw ? 'var(--text-primary)' : 'var(--text-placeholder)',
      onClick: gatedClick, onCellClick: gatedClick, cellHighlight };
  }
  // Tracker #148 (0c46404d): Created/Updated -- always read-only (no
  // click-to-edit at all, unlike other field types which are only
  // conditionally read-only), since the value is computed from the
  // issue's own history/comments, never written via a history entry.
  buildTimestampCell(issue, colId) {
    const s = this.state;
    const raw = issue.values[colId];
    const isSelected = s.selectedCell && s.selectedCell.issueId === issue.id && s.selectedCell.colId === colId;
    const cellHighlight = isSelected ? 'outline:2px solid var(--accent-fill); outline-offset:-2px;' : '';
    return {
      isTimestamp: true, isDisplay: true, isEditing: false,
      displayText: raw ? relativeAge(raw) : '—',
      titleAttr: raw ? new Date(raw).toLocaleString() : '',
      textColor: raw ? 'var(--text-secondary)' : 'var(--text-placeholder)',
      cellHighlight
    };
  }
  buildRefreshProgressView(job) {
    if (!job) return null;
    const pct = job.total ? Math.round((job.completed / job.total) * 100) : 0;
    return {
      label: 'Refreshing ' + job.total + ' issue' + (job.total === 1 ? '' : 's'),
      fraction: job.completed + '/' + job.total,
      pct: pct + '%',
      rateLimited: !!job.rateLimited,
      onClear: () => this.setState({ selectedIssueIds: [] })
    };
  }
  buildBulkBar(s, fieldDefs, isSelecting) {
    if (!isSelecting) return null;
    const jobFetchingPeek = !!(s.refreshJobs[s.projectId] && s.refreshJobs[s.projectId].status === 'fetching');
    if (jobFetchingPeek) return null;
    const selectedIssuesFull = this.effectiveSelectedIds().map(id => this.findIssue(id)).filter(Boolean);
    const linkedCount = selectedIssuesFull.filter(iss => Object.keys(fieldDefs).some(colId => iss.fieldRefs && iss.fieldRefs[colId])).length;
    const activeJob = s.refreshJobs[s.projectId];
    const jobFetching = !!(activeJob && activeJob.status === 'fetching');
    const canRefresh = linkedCount > 0 && !ROOM_MODE_CAPABILITIES && !jobFetching;
    const fieldRows = realColumnOrder(s.columnOrder).filter(colId => fieldDefs[colId].type !== 'commentStream' && fieldDefs[colId].type !== 'timestamp').map(colId => {
      const def = fieldDefs[colId];
      const derivedCount = def.linkedSourceId ? selectedIssuesFull.filter(iss => fieldLocalBindState(iss, colId, this.liveRuleCtx(iss.id).localDerivedEntryIds) === 'bound').length : 0;
      const hasDerived = derivedCount > 0;
      return {
        colId, label: def.label, locked: false, unlocked: true, hasDerivedNote: hasDerived,
        cursorStyle: 'pointer',
        rowOpacity: '1',
        derivedNote: hasDerived ? (derivedCount + ' of these ' + selectedIssuesFull.length + ' row' + (selectedIssuesFull.length === 1 ? '' : 's') + ' currently sync' + (derivedCount === 1 ? 's' : '') + ' this from a linked issue -- setting a value here will override ' + (derivedCount === 1 ? 'it' : 'them') + '.') : '',
        onOpen: () => this.openBulkFieldValuePicker(colId)
      };
    });
    let valuePicker = null;
    if (s.bulkFieldMenuColId) valuePicker = this.buildBulkValuePicker(s.bulkFieldMenuColId, fieldDefs[s.bulkFieldMenuColId], selectedIssuesFull);
    return {
      selectionCount: selectedIssuesFull.length,
      linkedSuffix: linkedCount > 0 ? (linkedCount + ' linked') : '',
      refreshOpacity: canRefresh ? '1' : '0.4',
      refreshCursor: canRefresh ? 'pointer' : 'default',
      refreshHoverStyle: canRefresh ? 'background: var(--n21);' : '',
      onRefresh: canRefresh ? (() => this.bulkRefreshSelected()) : undefined,
      onDelete: () => this.bulkDeleteSelected(),
      onClear: () => this.setState({ selectedIssueIds: [] }),
      onToggleMenu: e => {
        const isOpen = s.bulkFieldMenuOpen;
        let anchorLeft = 0, anchorBottomPx = 0;
        let maxHeightPx = 320;
        if (!isOpen && e && e.currentTarget && e.currentTarget.getBoundingClientRect) {
          const a = this.computeAnchor(e.currentTarget, 220);
          anchorLeft = a.left; anchorBottomPx = a.upwardOffsetPx;
          maxHeightPx = Math.max(120, a.spaceAbove - 16);
        }
        this.setState(st => ({ bulkFieldMenuOpen: !st.bulkFieldMenuOpen, bulkFieldMenuColId: null, bulkFieldMenuAnchorLeft: anchorLeft, bulkFieldMenuAnchorBottomPx: anchorBottomPx, bulkFieldMenuMaxHeightPx: maxHeightPx }));
      },
      showFieldList: s.bulkFieldMenuOpen && !s.bulkFieldMenuColId,
      showValuePicker: s.bulkFieldMenuOpen && !!s.bulkFieldMenuColId,
      widgetMenuAnchorStyle: 'position:fixed; bottom:' + (s.bulkFieldMenuAnchorBottomPx || 0) + 'px; left:' + (s.bulkFieldMenuAnchorLeft || 0) + 'px; max-height:' + (s.bulkFieldMenuMaxHeightPx || 320) + 'px; overflow-y:auto;',
      fieldRows,
      valuePicker,
      onBackToFields: () => this.setState({ bulkFieldMenuColId: null })
    };
  }
  // Tracker #108 (a91db807): a generic append-only "comment stream"
  // field -- the table cell shows only the latest entry + a relative
  // timestamp (the actual ask: "the next thing I'm going to share with
  // the customer, visible at the top level"); the slide-over's copy of
  // the same cell additionally gets the full entry list and a composer,
  // since history needs to stay reachable, just not inline in the grid.
  buildCommentStreamCell(issue, colId, readOnly) {
    const s = this.state;
    const entries = latestCommentsById((issue.commentStreams && issue.commentStreams[colId]) || []).sort((a, b) => b.sortKey - a.sortKey);
    const latest = entries[0] || null;
    const isSelected = s.selectedCell && s.selectedCell.issueId === issue.id && s.selectedCell.colId === colId;
    const popoverOpen = !readOnly && s.activeCell && s.activeCell.issueId === issue.id && s.activeCell.colId === colId;
    const cell = {
      isCommentStream: true,
      hasLatest: !!latest,
      latestRawText: latest ? latest.text : '',
      markdownClampStyle: this.markdownClampStyleFor(colId),
      latestTimestamp: latest ? relativeAge(latest.sortKey) : '',
      onClick: readOnly ? undefined : e => this.cellClickGate(issue.id, colId, () => this.togglePopover(issue.id, colId, e, 340)),
      popoverOpen,
      cellHighlight: (popoverOpen || isSelected) ? 'outline:2px solid var(--accent-fill); outline-offset:-2px;' : '',
      draft: s.commentStreamDrafts[colId] || '',
      onDraftChange: e => this.setState(st => ({ commentStreamDrafts: { ...st.commentStreamDrafts, [colId]: e.target.value } })),
      onDraftKeyDown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.addCommentStreamEntry(issue.id, colId, this.state.commentStreamDrafts[colId]); } },
      onPost: () => this.addCommentStreamEntry(issue.id, colId, this.state.commentStreamDrafts[colId]),
      // Detail-view field block only: jump the Activity area to this
      // field's own dedicated tab (see slideOver.tabs) rather than posting
      // inline -- a second posting surface here would duplicate the tab's
      // own post box (this was tried and explicitly reverted per the
      // handoff's own decision history).
      onJumpToActivity: readOnly ? undefined : e => { if (e) e.stopPropagation(); this.setState({ activityTab: colId }); }
    };
    if (popoverOpen) {
      cell.popoverStyle = 'position:fixed; left:' + s.activeCell.anchorLeft + 'px; ' +
        (s.activeCell.openUpward ? ('bottom:' + s.activeCell.anchorBottomPx + 'px;') : ('top:' + s.activeCell.anchorTopPx + 'px;'));
    }
    return cell;
  }
  buildCell(issue, colId, def, readOnly, width) {
    let cell;
    if (def.type === 'select') cell = this.buildSelectCell(issue, colId, def, readOnly, width);
    else if (def.type === 'multiselect') cell = this.buildMultiCell(issue, colId, def, readOnly, width);
    else if (def.type === 'date') cell = this.buildDateCell(issue, colId, def, readOnly);
    else if (def.type === 'timestamp') cell = this.buildTimestampCell(issue, colId);
    else if (def.type === 'commentStream') cell = this.buildCommentStreamCell(issue, colId, readOnly);
    // 'text' and 'issue' field types render identically — both detect/live-fetch
    // GitHub references, matching how the Title column already behaves.
    else cell = this.buildTextCell(issue, colId, issue.values[colId], 'var(--text-placeholder)', readOnly);
    this.applyPendingState(cell, this.pendingStatusFor(issue.id, colId));
    return cell;
  }
  // Tracker #158 (design handoff pending_and_failed.zip, direction 5c/5b):
  // Room state is the source of truth; a local edit sits visibly 'pending'
  // until the room's own history actually confirms it, and only becomes
  // 'failed' once a send genuinely errors/is rejected -- never for merely
  // being slow. Colours reused from the existing accent/danger tokens, not
  // invented, per the handoff's own instruction.
  pendingStatusFor(issueId, colId) {
    if (!ROOM_MODE_CAPABILITIES) return null;
    const summary = (this.state.pendingEditsByProject || {})[this.state.projectId];
    return (summary && summary.issues && summary.issues[issueId] && summary.issues[issueId][colId]) || null;
  }
  projectPendingStatusFor(field) {
    if (!ROOM_MODE_CAPABILITIES) return null;
    const summary = (this.state.pendingEditsByProject || {})[this.state.projectId];
    return (summary && summary.project && summary.project[field]) || null;
  }
  applyPendingState(cell, status) {
    if (!status) { cell.pendingVisible = false; cell.pendingCellStyle = ''; return; }
    const failed = status === 'failed';
    cell.pendingVisible = true;
    cell.pendingIsFailed = failed;
    cell.pendingDotColor = failed ? 'var(--danger-ink)' : 'var(--accent-fill)';
    cell.pendingDotAnimStyle = failed ? '' : 'animation: pendingPulse 1.6s ease-in-out infinite;';
    cell.pendingDotTitle = failed ? 'Failed to sync' : 'Pending — waiting to be confirmed by the room';
    cell.pendingCellStyle = failed
      ? 'background:color-mix(in oklch, var(--danger-ink) 6%, transparent); border-left:2px solid var(--danger-ink); margin-left:-1px;'
      : 'background:color-mix(in oklch, var(--accent-fill) 6%, transparent); border-left:2px solid var(--accent-fill); margin-left:-1px;';
    cell.pendingCaptionText = failed ? 'Failed to sync' : 'Pending, syncing to the room';
    cell.pendingCaptionColor = failed ? 'var(--danger-ink)' : 'var(--text-secondary)';
    cell.onRetryPending = failed ? () => this.retryPendingEdits() : null;
  }
  // Re-runs the send pass for every currently-unconfirmed local edit in
  // this project -- the failed entry is already sitting in the local doc
  // (nothing was ever rolled back), so this is the same mechanism any
  // other edit's own auto-push already uses, just triggered explicitly
  // rather than waiting on the next one.
  retryPendingEdits() {
    if (!ROOM_MODE_CAPABILITIES || !this.state.projectId) return;
    window.parent.postMessage({ type: 'wigwag:retry-pending', projectId: this.state.projectId }, '*');
  }

  renderVals() {
    const s = this.state;
    if (s.roomModeBootstrapping) return { bootOverlayVisible: window.parent === window && s.bootOverlayPhase !== 'hidden', bootOverlayOpacity: s.bootOverlayPhase === 'fading' ? 0 : 1, bootOverlayPointerEvents: s.bootOverlayPhase === 'fading' ? 'none' : 'auto', roomModeBootstrapping: true, notRoomModeBootstrapping: false, roomHasNoProjects: false, hasRoomWriteRejectedMessage: false, roomWriteRejectedMessage: null, onDismissRoomWriteRejected: () => {}, onCreateFirstProject: () => {}, isRoomModerator: false, roomNoProjectsHint: '' };
    // Tracker #187, Phase 3: Local Mode's own "still loading the active
    // project's doc from IndexedDB" gate -- same boot-overlay shape as
    // roomModeBootstrapping above (reuses the exact same boot-splash
    // component, no new markup needed), set true in the constructor
    // (Local Mode only -- Room Mode keeps its own gate, never sets this
    // one) and cleared once loadPersistedAsync() resolves.
    if (s.localDocLoading) return { bootOverlayVisible: window.parent === window && s.bootOverlayPhase !== 'hidden', bootOverlayOpacity: s.bootOverlayPhase === 'fading' ? 0 : 1, bootOverlayPointerEvents: s.bootOverlayPhase === 'fading' ? 'none' : 'auto', roomModeBootstrapping: false, notRoomModeBootstrapping: true, roomHasNoProjects: false, hasRoomWriteRejectedMessage: false, roomWriteRejectedMessage: null, onDismissRoomWriteRejected: () => {}, onCreateFirstProject: () => {}, isRoomModerator: false, roomNoProjectsHint: '' };
    // Room Scoped Widget Mode's real "no projects yet" state (tracker
    // f6b39bf0) -- checked after the bootstrapping gate above (a host
    // that hasn't even answered yet must still show "Connecting…", not
    // this), before the normal full-app vals computation below (which
    // assumes at least one project exists throughout).
    if (ROOM_MODE_CAPABILITIES && s.projects.length === 0) {
      return {
        bootOverlayVisible: window.parent === window && s.bootOverlayPhase !== 'hidden', bootOverlayOpacity: s.bootOverlayPhase === 'fading' ? 0 : 1, bootOverlayPointerEvents: s.bootOverlayPhase === 'fading' ? 'none' : 'auto',
        roomModeBootstrapping: false, notRoomModeBootstrapping: false, roomHasNoProjects: true,
        hasRoomWriteRejectedMessage: !!s.roomWriteRejectedMessage, roomWriteRejectedMessage: s.roomWriteRejectedMessage || null,
        onDismissRoomWriteRejected: () => this.setState({ roomWriteRejectedMessage: null }),
        // Tracker #169/4f07e72b follow-up: now that isRoomModerator is a
        // real, live power-level check (built for the layout-proposal
        // feature), the create/receive actions here -- already moderator-
        // gated server-side via Matrix's own power-level check on the
        // project-creation state write -- are hidden entirely for a non-
        // moderator too, the same "hidden, not just disabled" rule that
        // feature uses, instead of always showing them and letting the
        // write bounce.
        isRoomModerator: !!s.isRoomModerator,
        roomNoProjectsHint: s.isRoomModerator ? 'Add the first project, or receive one someone sent you.' : 'Ask a room moderator to add one.',
        onCreateFirstProject: () => this.createBlankProject(this.nextUntitledProjectName()),
        receiveProjectOpen: s.pasteMergeOpen,
        receiveProjectDraft: s.pasteMergeDraft,
        onToggleReceiveProject: () => this.setState(st => ({ pasteMergeOpen: !st.pasteMergeOpen, pasteMergeDraft: '' })),
        onReceiveProjectDraftChange: e => this.setState({ pasteMergeDraft: e.target.value }),
        onCancelReceiveProject: () => this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' }),
        onReceiveProjectBackdrop: e => { if (e.target === e.currentTarget) this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' }); },
        onSubmitReceiveProject: () => {
          const text = this.state.pasteMergeDraft;
          const parsed = this.parseJsonl(text);
          this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' });
          if (!parsed.fields && !parsed.issues.length) { window.alert('Could not read that as a tracker export.'); return; }
          this.importParsedAsNewProject(parsed, 'Pasted update');
        },
        onReceiveProjectOpenFileClick: () => { this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' }); const el = document.querySelector('[data-testid="room-no-projects-file-input"]'); if (el) el.click(); },
        onReceiveProjectFileChange: e => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result || '');
            const parsed = this.parseJsonl(text);
            if (!parsed.fields && !parsed.issues.length) { window.alert('Could not read that as a tracker export.'); return; }
            this.importParsedAsNewProject(parsed, file.name.replace(/\.[^.]+$/, ''));
          };
          reader.readAsText(file);
        }
      };
    }
    const fieldDefs = this.effectiveFieldDefs();
    const cellPadding = '7px 12px';

    let issues = s.issues.filter(iss => !iss.deleted).map(iss => ({ ...iss, values: deriveIssueValues(iss, fieldDefs) }));
    const jumpMatches = matchingIssuesByIdPrefix(issues, s.filterQuery);
    const jumpMode = jumpMatches.length > 0 && !s.jumpDismissed;
    const jumpQueryStripped = s.filterQuery.trim().replace(/^#/, '');
    const jumpResults = jumpMode ? jumpMatches.map((iss, idx) => ({
      id: iss.id,
      shortRefSegments: splitHighlightSegments(iss.id.slice(0, 8), jumpQueryStripped),
      title: iss.values.title || '',
      isActive: idx === Math.min(s.jumpActiveIndex || 0, jumpMatches.length - 1),
      rowStyle: 'display:flex; align-items:center; gap:10px; padding:8px 9px; border-radius:5px; cursor:pointer;' +
        (idx === Math.min(s.jumpActiveIndex || 0, jumpMatches.length - 1) ? ' background: var(--surface-selected);' : ''),
      onClick: () => this.openJumpResult(iss.id)
    })) : [];
    const filterParsed = parseFilterQuery(s.filterQuery, fieldDefs);
    const hasFieldTokens = filterParsed.fieldTokens.length > 0;
    const filterSuggest = (!jumpMode && !s.filterSuggestDismissed) ? computeFilterSuggestions(s.filterQuery, fieldDefs) : { mode: null, colId: null, items: [] };
    const filterSuggestOpen = filterSuggest.mode !== null;
    const filterSuggestActiveIdx = filterSuggestOpen ? Math.min(s.filterSuggestActiveIndex || 0, filterSuggest.items.length - 1) : 0;
    const filterSuggestItems = filterSuggest.items.map((item, idx) => ({
      ...item,
      isField: item.kind === 'field',
      text: item.kind === 'field' ? item.label : item.value,
      dotColor: item.color ? col(item.color).dot : '',
      hasDot: !!item.color,
      isActive: idx === filterSuggestActiveIdx,
      rowStyle: 'display:flex; align-items:center; gap:8px; padding:8px 9px; border-radius:5px; cursor:pointer;' +
        (idx === filterSuggestActiveIdx ? ' background: var(--surface-selected);' : ''),
      onClick: () => this.selectFilterSuggestion(idx),
      // Suppress the browser's default mousedown focus-shift so the
      // filter input never blurs from this click -- see the incident
      // note above filterSuggestItems' definition.
      onMouseDown: e => e.preventDefault()
    }));
    if (filterParsed.keyword.trim() || hasFieldTokens) {
      const q = filterParsed.keyword.trim().toLowerCase();
      issues = issues.filter(i =>
        issueMatchesFieldTokens(i, filterParsed.fieldTokens, fieldDefs) &&
        (!q || (i.values.title || '').toLowerCase().includes(q) ||
          Object.values(i.fieldRefs || {}).some(ref => fieldRefSearchText(ref).toLowerCase().includes(q)))
      );
    }
    // Tracker #105: a keyword match that an active column filter is
    // silently excluding is easy to miss entirely -- surface it with a
    // hint next to the filter box rather than leaving no trace it ever
    // matched. Snapshot the keyword-only result before column filters
    // apply below, so the diff is exactly what the column filters hid.
    const keywordMatchedIssues = issues;
    const hasActiveColumnFilter = Object.keys(s.columnFilters).some(colId => fieldDefs[colId] && columnFilterIsActive(s.columnFilters[colId]));
    const excludedSet = new Set(s.columnFilterExcludedIds);
    let hiddenByColumnFiltersIssues = [];
    if ((filterParsed.keyword.trim() || hasFieldTokens) && hasActiveColumnFilter) {
      hiddenByColumnFiltersIssues = keywordMatchedIssues.filter(iss => excludedSet.has(iss.id));
    }
    if (s.columnFilterExcludedIds.length) {
      // Purely frozen -- recomputed only at an explicit trigger
      // (toggleColumnFilterValue/clearColumnFilter, a cross-tab filter
      // sync, or page load/switchProject), same as sort's own snapshot.
      // An edit or a sync-driven merge re-renders with the same frozen
      // set, so it never silently hides or reveals a row.
      issues = issues.filter(iss => !excludedSet.has(iss.id));
    }
    // If the column filters would leave literally nothing on screen
    // despite real keyword matches existing, show those matches anyway,
    // dimmed -- an empty table with no explanation is worse than a
    // faded one with a hint saying why. Deliberately automatic (no manual
    // toggle) per the tracker discussion: this is a rare edge case, not
    // worth its own UI.
    // Table view only (per the tracker discussion) -- Kanban has its own
    // grouped-card rendering with no dimmed-card treatment, and an empty
    // Kanban column isn't the same "no explanation for a blank screen"
    // problem this fallback exists to solve.
    let hiddenByColumnFiltersFellBackToDimmed = false;
    if (!s.kanbanColId && hiddenByColumnFiltersIssues.length && issues.length === 0) {
      issues = keywordMatchedIssues.map(iss => ({ ...iss, __dimmedByColumnFilter: true }));
      hiddenByColumnFiltersFellBackToDimmed = true;
    }
    if (s.sort.colId) {
      const def = s.sort.colId === 'title' ? null : fieldDefs[s.sort.colId];
      if (s.sortSnapshot) {
        const orderIndex = new Map(s.sortSnapshot.map((id, i) => [id, i]));
        issues.sort((a, b) => {
          const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : Infinity;
          const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : Infinity;
          if (ai !== bi) return ai - bi;
          // Both new since the snapshot was frozen (added after a sort/
          // reload) -- order them by creation date, not by a live sort
          // value comparison that's meaningless for brand-new issues.
          if (ai === Infinity) return issueCreatedAt(a) - issueCreatedAt(b);
          const av = sortValue(a, s.sort.colId, def), bv = sortValue(b, s.sort.colId, def);
          const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
          return s.sort.dir === 'asc' ? cmp : -cmp;
        });
      } else {
        issues.sort((a, b) => {
          const av = sortValue(a, s.sort.colId, def), bv = sortValue(b, s.sort.colId, def);
          const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
          if (cmp !== 0) return s.sort.dir === 'asc' ? cmp : -cmp;
          return issueCreatedAt(a) - issueCreatedAt(b);
        });
      }
    }

    this._visibleIssueOrder = issues.map(i => i.id);
    const selectedSet = new Set(s.selectedIssueIds);
    const isSelecting = selectedSet.size > 0;
    const visibleIssueCount = issues.length;
    const headerAllSelected = visibleIssueCount > 0 && issues.every(iss => selectedSet.has(iss.id));
    const headerSomeSelected = isSelecting && !headerAllSelected;

    const isKanbanView = !!s.kanbanColId;
    const isTableView = !isKanbanView;
    let kanbanColumns = [];
    let groupByLabel = '';
    if (isKanbanView) {
      const groupDef = fieldDefs[s.kanbanColId];
      groupByLabel = groupDef ? groupDef.label : '';
      const otherSelectIds = realColumnOrder(s.columnOrder).filter(id => id !== s.kanbanColId && fieldDefs[id] && fieldDefs[id].type === 'select');
      const buildCard = issue => {
        const chips = otherSelectIds.map(cid => {
          const { opt } = this.resolveSelectOption(issue, cid);
          return opt ? { id: cid + ':' + opt.id, label: opt.label, bg: col(opt.color).bg, fg: col(opt.color).fg } : null;
        }).filter(Boolean);
        const groupRes = this.resolveSelectOption(issue, s.kanbanColId);
        return {
          id: issue.id,
          title: issue.values.title || '(untitled)',
          shortRef: '#' + issue.id.slice(0, 8),
          onOpen: () => this.openSlideOver(issue.id),
          draggable: true,
          onDragStart: e => this.kanbanDragStart(issue.id, e),
          onDragEnd: () => this.kanbanDragEnd(),
          dragOpacity: s.draggingKanbanIssueId === issue.id ? '0.4' : '1',
          isBoundLive: groupRes.isBoundLive, isOverridden: groupRes.isOverridden, showBoundGlyph: groupRes.isBoundLive || groupRes.isOverridden,
          boundGlyphTitle: groupRes.isOverridden ? this.overrideTitle(fieldDefs[s.kanbanColId]) : (groupRes.isBoundLive ? this.lockTitle(fieldDefs[s.kanbanColId]) : ''),
          chips, hasChips: chips.length > 0
        };
      };
      const opts = groupDef ? (groupDef.options || []) : [];
      kanbanColumns = opts.map(opt => {
        const cards = issues.filter(iss => this.resolveSelectOption(iss, s.kanbanColId).opt && this.resolveSelectOption(iss, s.kanbanColId).opt.id === opt.id).map(buildCard);
        return {
          id: opt.id, label: opt.label, dotColor: col(opt.color).dot, count: cards.length, cards,
          hasCards: cards.length > 0, noCards: cards.length === 0,
          dragOverStyle: s.dragOverKanbanOptId === opt.id ? 'background: var(--surface-hover); outline:2px dashed var(--border-strong); outline-offset:-2px;' : '',
          onDragOver: e => this.kanbanDragOverCol(opt.id, e),
          onDragLeave: () => { if (this.state.dragOverKanbanOptId === opt.id) this.setState({ dragOverKanbanOptId: null }); },
          onDrop: e => this.kanbanDropCol(opt.id, e)
        };
      });
      const noneCards = issues.filter(iss => !this.resolveSelectOption(iss, s.kanbanColId).opt).map(buildCard);
      kanbanColumns.push({
        id: '__none__', label: 'No ' + groupByLabel.toLowerCase(), dotColor: 'var(--text-tertiary)', count: noneCards.length, cards: noneCards,
        hasCards: noneCards.length > 0, noCards: noneCards.length === 0,
        dragOverStyle: s.dragOverKanbanOptId === '__none__' ? 'background: var(--surface-hover); outline:2px dashed var(--border-strong); outline-offset:-2px;' : '',
        onDragOver: e => this.kanbanDragOverCol('__none__', e),
        onDragLeave: () => { if (this.state.dragOverKanbanOptId === '__none__') this.setState({ dragOverKanbanOptId: null }); },
        onDrop: e => this.kanbanDropCol(null, e)
      });
    }
    const order = realColumnOrder(s.columnOrder);
    const colorFn = col;
    const columns = order.map((id, i) => {
      const def = fieldDefs[id];
      const isBindableType = def.type === 'select' || def.type === 'multiselect' || def.type === 'text' || def.type === 'issue';
      const isTextLike = def.type === 'text' || def.type === 'issue' || def.type === 'commentStream';
      const width = s.columnWidths[id] || WIDTHS[id] || 160;
      const isSorted = s.sort.colId === id;
      const showIndicatorBefore = s.dragOverColId === id && s.dragOverSide === 'before' && s.draggingColId && s.draggingColId !== id;
      const showIndicatorAfter = s.dragOverColId === id && s.dragOverSide === 'after' && s.draggingColId && s.draggingColId !== id;
      const hasOptions = def.type === 'select' || def.type === 'multiselect';
      const isDateType = def.type === 'date' || def.type === 'timestamp';
      const activeColumnFilter = s.columnFilters[id] || (isDateType ? { from: '', to: '' } : []);
      const isFiltered = isDateType ? !!(activeColumnFilter.from || activeColumnFilter.to) : activeColumnFilter.length > 0;
      const datePresets = isDateType ? dateFilterPresetRanges(new Date()).map(p => ({
        label: p.label,
        isActive: activeColumnFilter.from === p.from && activeColumnFilter.to === p.to,
        fontWeight: (activeColumnFilter.from === p.from && activeColumnFilter.to === p.to) ? '700' : '400',
        color: (activeColumnFilter.from === p.from && activeColumnFilter.to === p.to) ? 'var(--accent-ink)' : 'var(--n10)',
        bg: (activeColumnFilter.from === p.from && activeColumnFilter.to === p.to) ? 'var(--surface-selected)' : 'transparent',
        onClick: () => this.applyDatePreset(id, p.key)
      })) : [];
      const filterOptions = isDateType ? [] : [
        {
          id: UNSET_FILTER_VALUE, label: '(No value)', dotColor: colorFn('gray').dot,
          checked: activeColumnFilter.includes(UNSET_FILTER_VALUE),
          checkBg: activeColumnFilter.includes(UNSET_FILTER_VALUE) ? 'var(--accent-fill)' : 'var(--surface)',
          onToggle: () => this.toggleColumnFilterValue(id, UNSET_FILTER_VALUE)
        },
        ...(def.options || []).map(o => ({
          id: o.id, label: o.label, dotColor: colorFn(o.color).dot,
          checked: activeColumnFilter.includes(o.id),
          checkBg: activeColumnFilter.includes(o.id) ? 'var(--accent-fill)' : 'var(--surface)',
          onToggle: () => this.toggleColumnFilterValue(id, o.id)
        }))
      ];
      const allFilterIds = filterOptions.map(o => o.id);
      const headerCompression = computeHeaderCompression(def.label, width);
      const col = {
        id, width,
        label: headerCompression.label, fullLabel: headerCompression.fullLabel,
        headerPadding: headerCompression.headerPadding, compactIndicator: headerCompression.compactIndicator,
        iconOpacity: headerCompression.iconOpacity, showIcon: headerCompression.showIcon,
        iconBoxWidth: headerCompression.iconBoxWidth, iconBoxMarginLeft: headerCompression.iconBoxMarginLeft,
        iconPointerEvents: headerCompression.compactIndicator ? 'none' : 'auto',
        sortArrow: isSorted ? (s.sort.dir === 'asc' ? '↑' : '↓') : '',
        sortIconColor: 'var(--accent-ink)',
        showDescIcon: isSorted && s.sort.dir === 'desc',
        showAscIcon: isSorted && s.sort.dir !== 'desc',
        isSorted,
        isSortAsc: isSorted && s.sort.dir === 'asc',
        isSortDesc: isSorted && s.sort.dir === 'desc',
        // One combined icon trigger instead of separate sort/filter/idle
        // icons -- frees up horizontal space on narrow columns (tracker #170).
        showNoneIcon: !isSorted && !isFiltered,
        showFilterOnlyIcon: isFiltered && !isSorted,
        showSortOnlyIcon: isSorted && !isFiltered,
        showBothIcon: isSorted && isFiltered,
        menuIconColor: (isSorted || isFiltered) ? 'var(--accent-ink)' : 'var(--text-muted)',
        menuIconTitle: (isSorted && isFiltered) ? 'Sorted & filtered' : isSorted ? 'Sorted' : isFiltered ? 'Filtered' : 'Column options',
        labelColor: (headerCompression.compactIndicator && (isSorted || isFiltered)) ? 'var(--accent-ink)' : 'var(--n5)',
        isBindableType,
        onSort: () => this.sortBy(id),
        onDragStart: e => this.dragStart(id, e),
        onDragOver: e => this.dragOverCol(id, e),
        onDrop: e => this.dropCol(id, e),
        onDragEnd: () => this.dragEndCol(),
        showIndicatorBefore, showIndicatorAfter,
        menuOpen: s.openColMenuId === id,
        menuStyle: 'position:fixed; left:' + s.colMenuAnchorLeft + 'px; max-height:' + s.colMenuMaxHeightPx + 'px; overflow-y:auto; ' + (s.colMenuOpenUpward ? ('bottom:' + s.colMenuAnchorBottomPx + 'px;') : ('top:' + s.colMenuAnchorTopPx + 'px;')),
        onToggleMenu: e => this.toggleColMenu(id, e),
        onSortAsc: () => (isSorted && s.sort.dir === 'asc') ? this.clearSort() : this.sortBy(id, 'asc'),
        onSortDesc: () => (isSorted && s.sort.dir === 'desc') ? this.clearSort() : this.sortBy(id, 'desc'),
        onEditField: () => this.openFieldEditor(id),
        isGroupable: def.type === 'select',
        onGroupByThis: () => this.setGroupBy(id),
        isFrozenHere: s.freezeColId === id,
        onToggleFreeze: () => this.toggleFreeze(id),
        onHide: () => this.hideField(id),
        canDeleteField: def.type !== 'timestamp' && def.type !== 'commentStream',
        onDelete: () => this.deleteField(id),
        onMoveLeft: () => this.moveColumn(id, 'left'),
        onMoveRight: () => this.moveColumn(id, 'right'),
        onMoveStart: () => this.moveColumn(id, 'start'),
        onMoveEnd: () => this.moveColumn(id, 'end'),
        onStartResize: e => this.startColumnResize(id, WIDTHS[id] || 160, e),
        moveLeftOpacity: s.columnOrder.indexOf(id) === 0 ? 0.35 : 1,
        moveRightOpacity: s.columnOrder.indexOf(id) === s.columnOrder.length - 1 ? 0.35 : 1,
        moveStartOpacity: s.columnOrder.indexOf(id) === 0 ? 0.35 : 1,
        moveEndOpacity: s.columnOrder.indexOf(id) === s.columnOrder.length - 1 ? 0.35 : 1,
        hasOptions, isFiltered, filterOptions,
        isDateType, dateFrom: isDateType ? activeColumnFilter.from : '', dateTo: isDateType ? activeColumnFilter.to : '', datePresets,
        onDateFromChange: e => this.setColumnDateFilter(id, 'from', e.target.value),
        onDateToChange: e => this.setColumnDateFilter(id, 'to', e.target.value),
        onClearFilter: () => this.clearColumnFilter(id),
        onSelectAllFilter: () => this.selectAllColumnFilter(id, allFilterIds),
        isTextLike, wrapEnabled: !!s.columnWrap[id],
        onToggleWrap: () => this.toggleColumnWrap(id)
      };
      return col;
    });
    const columnsById = {};
    columns.forEach(c => { columnsById[c.id] = c; });
    const titleWidth = s.columnWidths.title || 300;
    const titleCellPadding = cellPaddingForWidth(titleWidth);
    // Header uses the same 90px trigger as the body cell so the title
    // column's padding pinches at one consistent width, top-to-bottom.
    const titleHeaderPadding = (titleWidth < 90) ? '9px 6px' : '9px 12px';
    const titleDragOverSide = s.dragOverColId === TITLE_COL_ID ? s.dragOverSide : null;
    const commentsDragOverSide = s.dragOverColId === COMMENTS_COL_ID ? s.dragOverSide : null;
    const freezeColId = s.freezeColId;
    const freezeIdx = freezeColId ? s.columnOrder.indexOf(freezeColId) : -1;
    const isFrozenActive = freezeIdx >= 0;
    const freezeGeom = {};
    {
      let runningLeft = 56;
      s.columnOrder.forEach((fid, fi) => {
        const w = fid === TITLE_COL_ID ? titleWidth : fid === COMMENTS_COL_ID ? 40 : (columnsById[fid] ? columnsById[fid].width : 160);
        if (isFrozenActive && fi <= freezeIdx) freezeGeom[fid] = { left: runningLeft, isBoundary: fi === freezeIdx };
        runningLeft += w;
      });
    }
    // Border-top/bottom are scoped to just the frozen columns (accent) vs the rest
    // (normal grey) by giving EVERY header/last-row cell its own 1px border of one
    // colour or the other -- never a mix of "some cells have a border, some don't",
    // which is what caused the earlier per-row height-mismatch wiggle. The row's own
    // shared border is turned off in this mode so there's only ever one line per cell.
    const darkBorder = '1px solid var(--accent-ink)';
    const lightBorder = '1px solid var(--n34)';
    const headerStickyStyle = fid => {
      const g = freezeGeom[fid];
      const topBorder = isFrozenActive ? ' border-top:' + (g ? darkBorder : lightBorder) + ';' : '';
      const bottomBorder = (isFrozenActive && issues.length === 0) ? ' border-bottom:' + (g ? darkBorder : lightBorder) + ';' : '';
      if (!g) return topBorder + bottomBorder;
      return 'position:sticky; left:' + g.left + 'px; z-index:50; background:var(--surface-header);' + topBorder + bottomBorder + (g.isBoundary ? ' border-right:' + darkBorder + ';' : '');
    };
    const bodyStickyStyle = (fid, rowBg, isLastRow) => {
      const g = freezeGeom[fid];
      const bottomBorder = (isFrozenActive && isLastRow) ? ' border-bottom:' + (g ? darkBorder : lightBorder) + ';' : '';
      if (!g) return bottomBorder;
      return 'position:sticky; left:' + g.left + 'px; z-index:5; background:' + rowBg + ';' + bottomBorder + (g.isBoundary ? ' border-right:' + darkBorder + ';' : '');
    };
    const gutterStickyStyle = (isHeader, rowBg, isLastRow) => {
      if (!isFrozenActive) return '';
      return 'position:sticky; left:0px; z-index:' + (isHeader ? 50 : 5) + '; background:' + (isHeader ? 'var(--surface-header)' : rowBg) + '; border-left:' + darkBorder + ';' + (isHeader ? ' border-top:' + darkBorder + ';' : '') + ((isLastRow || (isHeader && issues.length === 0)) ? ' border-bottom:' + darkBorder + ';' : '');
    };
    const headerSegments = s.columnOrder.map((id, i) => {
      const borderLeft = (i === 0 || i === freezeIdx + 1) ? 'none' : '1px solid var(--n28)';
      if (id === TITLE_COL_ID) {
        return { isTitle: true, isComments: false, isField: false, borderLeft, stickyStyle: headerStickyStyle(TITLE_COL_ID),
          onDragOver: e => this.dragOverCol(TITLE_COL_ID, e), onDrop: e => this.dropCol(TITLE_COL_ID, e),
          showIndicatorBefore: titleDragOverSide === 'before' && !!s.draggingColId,
          showIndicatorAfter: titleDragOverSide === 'after' && !!s.draggingColId };
      }
      if (id === COMMENTS_COL_ID) {
        return { isTitle: false, isComments: true, isField: false, borderLeft, stickyStyle: headerStickyStyle(COMMENTS_COL_ID),
          onDragOver: e => this.dragOverCol(COMMENTS_COL_ID, e), onDrop: e => this.dropCol(COMMENTS_COL_ID, e),
          showIndicatorBefore: commentsDragOverSide === 'before' && s.draggingColId && s.draggingColId !== COMMENTS_COL_ID,
          showIndicatorAfter: commentsDragOverSide === 'after' && s.draggingColId && s.draggingColId !== COMMENTS_COL_ID };
      }
      return { isTitle: false, isComments: false, isField: true, col: { ...columnsById[id], borderLeft, stickyStyle: headerStickyStyle(id) } };
    });
    // The "+" add-field button isn't a real column (not in columnOrder, never
    // reorderable/freezable) but reuses the same sticky-border logic as a trailing
    // unfrozen entry, so it never needs its own hand-maintained border styling.
    headerSegments.push({ isAddField: true, stickyStyle: headerStickyStyle('__add_field__') });
    const totalWidth = 56 + titleWidth + 40 + 44 + columns.reduce((sum, c) => sum + c.width, 0);

    const rows = issues.map((issue, rowPos) => {
      const rowNumber = rowPos + 1;
      const rowReadOnly = issue.id === s.slideOverIssueId;
      const title = { ...this.withEmbeddedWigwagLinks(this.buildTextCell(issue, 'title', issue.values.title, 'var(--text-placeholder)', rowReadOnly), issue.values.title || '', s.filterQuery, !!s.columnWrap.title),
        textWrapStyle: this.wrapStyleFor('title'),
        highlightSegments: splitHighlightSegments(issue.values.title || '', s.filterQuery) };
      const cells = realColumnOrder(s.columnOrder).map(colId => { const w = s.columnWidths[colId] || WIDTHS[colId] || 160; return { ...this.buildCell(issue, colId, fieldDefs[colId], rowReadOnly, w), width: w, padding: cellPaddingForWidth(w), colId, textWrapStyle: this.wrapStyleFor(colId) }; });
      const cellsById = {};
      cells.forEach(c => { cellsById[c.colId] = c; });
      const rowIsSelected = selectedSet.has(issue.id);
      const rowBg = rowIsSelected ? 'var(--c21)' : 'var(--surface)';
      const isLastRow = rowPos === issues.length - 1;
      const segments = s.columnOrder.map((id, i) => {
        const rowBorderLeft = (i === 0 || i === freezeIdx + 1) ? 'none' : '1px solid var(--n32)';
        if (id === TITLE_COL_ID) return { isTitle: true, isComments: false, isField: false, rowBorderLeft, stickyStyle: bodyStickyStyle(TITLE_COL_ID, rowBg, isLastRow) };
        if (id === COMMENTS_COL_ID) return { isTitle: false, isComments: true, isField: false, rowBorderLeft, stickyStyle: bodyStickyStyle(COMMENTS_COL_ID, rowBg, isLastRow) };
        return { isTitle: false, isComments: false, isField: true, cell: { ...cellsById[id], rowBorderLeft, stickyStyle: bodyStickyStyle(id, rowBg, isLastRow) } };
      });
      segments.push({ isAddField: true, stickyStyle: bodyStickyStyle('__add_field__', rowBg, isLastRow) });
      const visibleComments = latestCommentsById((issue.commentStreams && issue.commentStreams.comments) || []);
      const lastReadKey = s.commentReads[issue.id] || 0;
      const unreadCount = visibleComments.filter(c => (c.sortKey || 0) > lastReadKey).length;
      return {
        issue, title, cells, segments, rowNumber,
        dimOpacity: issue.__dimmedByColumnFilter ? '0.5' : '1',
        rowBg, gutterStickyStyle: gutterStickyStyle(false, rowBg, isLastRow),
        rowRadius: (isLastRow && !isFrozenActive) ? '0px 0px 8px 8px' : '0px',
        rowBorderBottom: isLastRow ? 'none' : '1px solid var(--border-subtle)',
        isSelected: rowIsSelected,
        checkboxBorder: rowIsSelected ? 'none' : '1.5px solid var(--n30)',
        checkboxBg: rowIsSelected ? 'var(--accent-fill)' : 'transparent',
        onGutterMouseDown: (e) => this.onGutterMouseDown(e),
        onGutterClick: (e) => this.onGutterClick(issue.id, e),
        onOpenDetail: () => this.openSlideOver(issue.id),
        hasUnread: unreadCount > 0,
        commentCount: unreadCount,
        commentIconColor: visibleComments.length > 0 ? 'var(--accent-ink)' : 'var(--n61)',
        // Tooltip stays on the raw (not deduped) array -- its last entry is
        // whatever most recently happened (a new comment OR an edit to an
        // older one), chronologically, which is the right thing to preview
        // on hover; latestCommentsById's array order is grouped by each
        // comment's first appearance, not sorted by latest activity.
        commentTooltip: ((issue.commentStreams && issue.commentStreams.comments) || []).length > 0 ? issue.commentStreams.comments[issue.commentStreams.comments.length - 1].text : 'Add a comment'
      };
    });

    let slideOver = null;
    if (s.slideOverIssueId) {
      const issue = this.findIssue(s.slideOverIssueId);
      if (issue) {
        const title = this.withMarkdownCopy(this.withEmbeddedWigwagLinks(this.buildTextCell(issue, 'title', issue.values.title, 'var(--text-placeholder)', false, true), issue.values.title || '', '', true, true), 'title');
        const buildStreamActivityEntries = (fieldId) => latestCommentsById((issue.commentStreams && issue.commentStreams[fieldId]) || []).map(c => {
          const isEditing = s.editingCommentFieldId === fieldId && s.editingCommentId === c.id;
          const canEdit = !!(s.identityEmail && c.email && c.email === s.identityEmail);
          return { isComment: true, isHistory: false, actor: c.author, initial: (c.author || '?')[0].toUpperCase(),
            time: this.timeLabelFor(c), text: c.text, sortKey: c.sortKey, wasEdited: c.wasEdited, isRedacted: !!c.redacted,
            isEditing, isNotEditing: !isEditing, showCommentBody: !isEditing && !c.redacted,
            showEditBtn: canEdit && !isEditing && !!c.id && !c.redacted,
            showRedactBtn: !isEditing && !!c.id && !c.redacted,
            onStartEdit: () => this.startEditCommentStreamEntry(fieldId, c.id, c.text),
            onRedact: () => this.redactCommentStreamEntry(issue.id, fieldId, c.id) };
        }).sort((a, b) => b.sortKey - a.sortKey);
        const slideOverCommentEntries = buildStreamActivityEntries('comments');
        const streamFieldIds = Object.keys(fieldDefs).filter(id => fieldDefs[id].type === 'commentStream' && id !== 'comments');
        const streamEntriesByField = {};
        streamFieldIds.forEach(id => { streamEntriesByField[id] = buildStreamActivityEntries(id); });
        const activeStreamColId = streamFieldIds.find(id => id === s.activityTab) || null;
        const streamTabs = streamFieldIds.map(id => ({
          colId: id,
          label: (fieldDefs[id].label || id).toUpperCase(),
          count: streamEntriesByField[id].length,
          isActive: s.activityTab === id,
          onSwitch: () => this.setState({ activityTab: id })
        }));
        const slideOverHistoryEntries = issue.history.filter(h => h.origin !== 'legacy-backfill').map(h => {
          const pill = this.buildActivityPill(h, fieldDefs);
          const fieldLabelParts = !pill ? this.buildActivityFieldLabel(h, fieldDefs) : null;
          return { isComment: false, isHistory: true, actor: h.actor, time: this.timeLabelFor(h), text: h.text, sortKey: h.sortKey,
            pill, hasPill: !!pill, fieldLabelParts, hasFieldLabel: !!fieldLabelParts, noPill: !pill && !h.redacted && !fieldLabelParts, isRedacted: !!h.redacted,
            showRedactBtn: !!h.id && !h.redacted && h.text !== 'Created',
            onRedact: () => this.redactHistoryEntry(issue.id, h.id) };
        }).sort((a, b) => b.sortKey - a.sortKey);
        const slideOverActiveList = activeStreamColId ? streamEntriesByField[activeStreamColId] : (s.activityTab === 'history' ? slideOverHistoryEntries : slideOverCommentEntries);
        // Heuristic: a text-type field literally labeled "Description" gets
        // its own full-width section immediately below the title, instead
        // of sitting in the regular fields grid -- prose reads better full-
        // width than squeezed into a 220px grid cell. Any other field type
        // named "Description" (unusual) is left in the regular grid as-is.
        const descriptionColId = Object.keys(fieldDefs).find(id => id !== 'title' && fieldDefs[id].type === 'text' && (fieldDefs[id].label || '').trim().toLowerCase() === 'description');
        slideOver = {
          issue, title,
          shortRef: '#' + issue.id.slice(0, 8),
          shortRefLabel: s.slideOverRefCopyLabel || ('#' + issue.id.slice(0, 8)),
          onCopyRef: () => this.copyShortRef(),
          copyLinkLabel: s.slideOverCopyLinkLabel,
          onCopyLink: () => this.copySlideOverLink(),
          copyJsonLabel: s.slideOverCopyJsonLabel,
          onCopyJson: () => this.copySlideOverJson(),
          isSubscribed: !!s.issueSubscriptions[issue.id],
          subscribeLabel: s.issueSubscriptions[issue.id] ? 'Subscribed' : 'Subscribe',
          subscribeColor: s.issueSubscriptions[issue.id] ? 'var(--accent-ink)' : 'var(--text-secondary)',
          onToggleSubscribe: () => this.toggleIssueSubscription(issue.id),
          transform: s.slideOverVisible ? 'translateX(0)' : 'translateX(100%)',
          overlayAlpha: s.slideOverVisible ? '0.28' : '0',
          hasDescription: !!descriptionColId,
          description: descriptionColId ? { label: fieldDefs[descriptionColId].label, cell: this.buildCell(issue, descriptionColId, fieldDefs[descriptionColId]) } : null,
          fields: realColumnOrder(s.columnOrder).concat(Object.keys(fieldDefs).filter(id => id !== 'title' && s.hiddenFieldIds.includes(id)))
            .filter(id => id !== descriptionColId)
            .map(id => ({ colId: id, label: fieldDefs[id].label, width: s.columnWidths[id] || WIDTHS[id] || 160, cell: this.withMarkdownCopy(this.buildCell(issue, id, fieldDefs[id]), id) })),
          activity: slideOverActiveList,
          isCommentsTab: !activeStreamColId && s.activityTab !== 'history',
          isHistoryTab: !activeStreamColId && s.activityTab === 'history',
          isStreamTab: !!activeStreamColId,
          streamTabs,
          streamDraft: activeStreamColId ? (s.commentStreamDrafts[activeStreamColId] || '') : '',
          onStreamDraftChange: e => this.setState(st => ({ commentStreamDrafts: { ...st.commentStreamDrafts, [activeStreamColId]: e.target.value } })),
          onStreamKeyDown: e => { if (activeStreamColId && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.addCommentStreamEntry(issue.id, activeStreamColId, this.state.commentStreamDrafts[activeStreamColId]); } },
          onPostStream: () => { if (activeStreamColId) this.addCommentStreamEntry(issue.id, activeStreamColId, this.state.commentStreamDrafts[activeStreamColId]); },
          commentCount: slideOverCommentEntries.length,
          historyCount: slideOverHistoryEntries.length,
          onSwitchToComments: () => this.setState({ activityTab: 'comments' }),
          onSwitchToHistory: () => this.setState({ activityTab: 'history' }),
          noActivity: slideOverActiveList.length === 0,
          onDelete: () => { this.confirmAction('Delete this issue? This can\'t be undone.', () => this.deleteIssue(issue.id), 'Delete'); }
        };
      }
    }

    // Tracker #124 (5c3051e9): badge the Merge History nav item only when
    // something in it is genuinely unresolved (see mergeRecordNeedsAttention)
    // -- never just because a merge happened.
    const issuesByIdForMerge = {};
    s.issues.forEach(iss => { issuesByIdForMerge[iss.id] = iss; });
    const mergeHistoryNeedsAttention = (s.mergeLog || []).some(r => mergeRecordNeedsAttention(r, issuesByIdForMerge));
    const projectPanelSectionDefs = [
      { id: 'notes', label: 'Notes', configured: false, dotColor: 'var(--accent-fill)' },
      { id: 'sync', label: ROOM_MODE_CAPABILITIES ? 'Export' : 'Sync & Export', configured: !ROOM_MODE_CAPABILITIES && !!(s.githubRepo && s.githubRepo.trim()), dotColor: 'var(--accent-fill)' },
      { id: 'merge-history', label: 'Merge history', configured: mergeHistoryNeedsAttention, dotColor: 'var(--c31)' },
      { id: 'danger', label: 'Danger Zone', configured: false, dotColor: 'var(--accent-fill)' }
    ];
    const activeProjectPanelSectionId = s.projectPanelSection || 'notes';
    let note = null;
    if (s.projectNotesOpen) {
      const meta = s.projects.find(m => m.id === s.projectId);
      const rawNotes = s.projectNotes || '';
      const trimmedNotes = rawNotes.trim();
      const noteCommentEntries = latestCommentsById(s.projectComments).map(c => {
        const isEditing = s.editingProjectCommentId === c.id;
        const canEdit = !!(s.identityEmail && c.email && c.email === s.identityEmail);
        return { isComment: true, isHistory: false,
          id: c.id, initial: (c.author || '?')[0].toUpperCase(), author: c.author, actor: c.author, time: this.timeLabelFor(c), rawText: c.text, sortKey: c.sortKey || 0,
          wasEdited: c.wasEdited, isRedacted: !!c.redacted,
          isEditing, showCommentBody: !isEditing && !c.redacted,
          showEditBtn: canEdit && !isEditing && !!c.id && !c.redacted,
          showRedactBtn: !isEditing && !!c.id && !c.redacted,
          onStartEdit: () => this.startEditProjectComment(c.id, c.text),
          onRedact: () => this.redactProjectComment(c.id) };
      }).sort((a, b) => b.sortKey - a.sortKey);
      const noteHistoryEntries = s.projectHistory.filter(h => h.origin !== 'legacy-backfill').map(h => ({
        isComment: false, isHistory: true,
        actor: h.actor, time: this.timeLabelFor(h), text: h.text, sortKey: h.sortKey || 0, isRedacted: !!h.redacted,
        showHistoryText: !h.redacted,
        showRedactBtn: !!h.id && !h.redacted,
        onRedact: () => this.redactProjectHistoryEntry(h.id)
      })).sort((a, b) => b.sortKey - a.sortKey);
      const noteActiveList = s.activityTab === 'history' ? noteHistoryEntries : noteCommentEntries;
      note = {
        sections: projectPanelSectionDefs.map(d => ({
          id: d.id, label: d.label, configured: d.configured, dotColor: d.dotColor,
          weight: d.id === activeProjectPanelSectionId ? '600' : '450',
          color: d.id === 'danger' ? 'var(--c17)' : (d.id === activeProjectPanelSectionId ? 'var(--text-primary)' : 'var(--n23)'),
          bg: d.id === activeProjectPanelSectionId ? 'var(--surface-selected)' : 'transparent',
          onPick: () => this.setState({ projectPanelSection: d.id })
        })),
        isNotes: activeProjectPanelSectionId === 'notes',
        isSync: activeProjectPanelSectionId === 'sync',
        showGithubSyncSection: activeProjectPanelSectionId === 'sync' && !ROOM_MODE_CAPABILITIES,
        isMergeHistory: activeProjectPanelSectionId === 'merge-history',
        isDanger: activeProjectPanelSectionId === 'danger',
        mergeHistory: this.buildMergeHistoryViewModel(issuesByIdForMerge),
        projectName: meta ? meta.name : 'Untitled',
        shortRefLabel: s.projectRefCopyLabel || (s.projectId ? ('#' + s.projectId.slice(0, 8)) : ''),
        onCopyRef: () => this.copyProjectRef(),
        copyLinkLabel: s.projectLinkCopyLabel,
        onCopyLink: () => this.copyProjectLink(),
        transform: s.projectNotesVisible ? 'translateX(0)' : 'translateX(100%)',
        overlayAlpha: s.projectNotesVisible ? '0.28' : '0',
        isEditing: s.projectNoteEditing,
        isReading: !s.projectNoteEditing,
        draft: s.projectNoteDraft,
        onDraftChange: e => this.setState({ projectNoteDraft: e.target.value }),
        onDraftPaste: e => this.handleMarkdownLinkPaste(e, v => this.setState({ projectNoteDraft: v })),
        onDraftKeyDown: e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.saveNoteEdit(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelNoteEdit(); }
        },
        onStartEdit: e => { if (e && e.target.closest && e.target.closest('a')) return; this.startNoteEdit(); },
        onCancelEdit: () => this.cancelNoteEdit(),
        onSaveEdit: () => this.saveNoteEdit(),
        isEmpty: !trimmedNotes,
        hasNotes: !!trimmedNotes,
        rawNotes,
        commentDraft: s.projectCommentDraft,
        onCommentChange: e => this.setState({ projectCommentDraft: e.target.value }),
        onCommentPaste: e => this.handleMarkdownLinkPaste(e, v => this.setState({ projectCommentDraft: v })),
        onCommentKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); this.postProjectComment(); } },
        onPostComment: () => this.postProjectComment(),
        editCommentDraft: s.editProjectCommentDraft,
        onEditCommentDraftChange: e => this.setState({ editProjectCommentDraft: e.target.value }),
        onEditCommentPaste: e => this.handleMarkdownLinkPaste(e, v => this.setState({ editProjectCommentDraft: v })),
        onEditCommentKeyDown: e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.saveEditProjectComment(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelEditProjectComment(); }
        },
        saveEditComment: this.saveEditProjectComment,
        cancelEditComment: this.cancelEditProjectComment,
        onDeleteProject: () => this.openDeleteProjectConfirm(),
        rename: {
          isReading: !s.trackerNameEditing,
          isRenaming: s.trackerNameEditing,
          onKeyDown: e => { if (e.key === 'Enter') this.commitTrackerNameEdit(); else if (e.key === 'Escape') { e.stopPropagation(); this.cancelTrackerNameEdit(); } },
          onStart: () => this.startEditTrackerName(),
          onCancel: () => this.cancelTrackerNameEdit(),
          onCommit: () => this.commitTrackerNameEdit(),
        },
        activity: noteActiveList,
        isCommentsTab: s.activityTab !== 'history',
        isHistoryTab: s.activityTab === 'history',
        commentCount: noteCommentEntries.length,
        historyCount: noteHistoryEntries.length,
        onSwitchToComments: () => this.setState({ activityTab: 'comments' }),
        onSwitchToHistory: () => this.setState({ activityTab: 'history' }),
        noActivity: noteActiveList.length === 0
      };
    }

    let fieldEditor = null;
    if (s.fieldEditorColId) {
      const colId = s.fieldEditorColId;
      const def = fieldDefs[colId];
      if (def) {
        fieldEditor = {
          label: def.label,
          onLabelChange: e => this.setFieldLabel(colId, e.target.value),
          linkedSourceId: def.linkedSourceId || '',
          onLinkedSourceChange: e => this.setFieldLinkedSource(colId, e.target.value),
          sourceOptions: this.bindableSources(colId),
          ruleSummary: this.ruleSummary(def),
          ruleLinkLabel: def.linkedSourceId ? 'Edit rules…' : 'Set up…',
          isBindable: def.type === 'select' || def.type === 'multiselect' || def.type === 'text' || def.type === 'issue',
          onOpenRules: () => this.openRuleBuilder(colId),
          hasOptions: def.type === 'select' || def.type === 'multiselect',
          bindHint: def.type === 'multiselect' ? 'Return an array of option ids or labels.' : def.type === 'text' ? 'Return a string.' : def.type === 'issue' ? 'Copies another field\'s real link, not just its text.' : '',
          newOptLabel: s.fieldEditorNewOptLabel,
          onNewOptLabelChange: e => this.setState({ fieldEditorNewOptLabel: e.target.value }),
          onAddOpt: () => this.addFieldEditorOption(colId),
          options: (def.options || []).map((o, idx) => ({
            index: idx, label: o.label, dotColor: col(o.color).dot,
            onLabelChange: e => this.setOptionLabel(colId, idx, e.target.value),
            onMoveUp: () => this.moveOption(colId, idx, -1),
            onMoveDown: () => this.moveOption(colId, idx, 1),
            upOpacity: idx === 0 ? 0.3 : 1,
            downOpacity: idx === (def.options.length - 1) ? 0.3 : 1,
            onRemove: () => this.removeOption(colId, idx),
            onToggleColorPicker: () => this.toggleColorPicker(idx),
            colorPickerOpen: s.colorPickerOptIndex === idx,
            palette: PALETTE_ORDER.map(name => ({ dot: col(name).dot, border: o.color === name ? '2px solid var(--n10)' : '1px solid var(--border-strong)', onPick: () => this.pickOptionColor(colId, idx, name) }))
          })),
          hasDefaultValue: def.type === 'select' || def.type === 'text',
          defaultValueIsSelect: def.type === 'select',
          defaultValueIsText: def.type === 'text',
          defaultValue: def.defaultValue || '',
          defaultValueOptions: (def.options || []).map(o => ({ id: o.id, label: o.label })),
          onDefaultValueSelectChange: e => this.setFieldDefaultValue(colId, e.target.value),
          onDefaultValueTextChange: e => this.setFieldDefaultValue(colId, e.target.value)
        };
      }
    }

    const activeIdentity = s.identities.find(i => i.id === s.activeIdentityId) || null;
    const projectCount = idy => s.projects.filter(p => p.identityId === idy).length;
    const countLabel = n => n + ' project' + (n === 1 ? '' : 's');
    const settingsSectionDefs = [
      { id: 'identity', label: 'Identity', title: 'Identity', blurb: 'Who your changes are attributed to.', configured: !!(activeIdentity && activeIdentity.email && activeIdentity.email.trim()) },
      // connectedSources now only ever holds what the user actually
      // added (no more fixed-3 auto-seed) -- existing at all is enough
      // signal for the nav dot, no need to separately check "and is it
      // actually configured."
      { id: 'connectedDataSources', label: 'Context connectors', title: 'Context connectors', blurb: 'Other systems wigwag can reference and pull state from -- GitHub, Jira, Salesforce, or your own custom connector.', configured: (s.connectedSources || []).length > 0 },
      { id: 'remoteDataStores', label: 'Project sync', title: 'Project sync', blurb: 'Where your project data is persisted outside this device -- GitHub today, more stores later.', configured: !!(activeIdentity && activeIdentity.githubToken && activeIdentity.githubToken.trim()) },
      { id: 'notifications', label: 'Notifications', title: 'Notifications', blurb: 'Get notified when someone @mentions you in a comment.', configured: !!s.mentionNotificationsEnabled }
    ];
    const activeSettingsSectionId = s.settingsSection || 'identity';
    const currentSettingsSectionDef = settingsSectionDefs.find(d => d.id === activeSettingsSectionId) || settingsSectionDefs[0];
    const ident = {
      lozengeText: activeIdentity ? activeIdentity.label : '',
      email: activeIdentity ? (activeIdentity.email || 'not set') : '',
      projectCountLabel: activeIdentity ? countLabel(projectCount(activeIdentity.id)) : '',
      dot: activeIdentity ? col(this.identityColor(activeIdentity.id)).dot : col('gray').dot,
      fg: activeIdentity ? col(this.identityColor(activeIdentity.id)).fg : col('gray').fg
    };
    // Unified switcher (desktop): one breadcrumb + two-column picker
    // replacing the old separate identity-pill / tracker-switcher
    // dropdowns. Left column ("scopes") previews on click without
    // committing anything -- switcherScopeId is purely a render-time
    // preview, never touches activeIdentityId/projectId until a PROJECT
    // row is actually clicked (selectSwitcherProject).
    const switcherActiveProject = s.projects.find(p => p.id === s.projectId) || null;
    const switcherHasShared = s.projects.some(p => !p.identityId);
    const switcherDefaultScopeId = switcherActiveProject
      ? (switcherActiveProject.identityId || 'shared')
      : (s.activeIdentityId || 'shared');
    const switcherScopeId = s.switcherScopeId || switcherDefaultScopeId;
    const switcherProjectsInScope = (scopeId) => {
      const list = scopeId === 'shared' ? s.projects.filter(p => !p.identityId) : s.projects.filter(p => p.identityId === scopeId);
      return list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    };
    const switcherScopeRows = []
      .concat(switcherHasShared ? [{
        id: 'shared', isSelected: switcherScopeId === 'shared',
        dashed: true, notDashed: false, initial: '', tileBg: 'transparent',
        label: 'Shared with you',
        sub: countLabel(s.projects.filter(p => !p.identityId).length),
        subFontFamily: 'inherit',
        borderColor: switcherScopeId === 'shared' ? 'var(--accent-fill)' : 'transparent',
        bg: switcherScopeId === 'shared' ? 'var(--surface)' : 'transparent',
        weight: switcherScopeId === 'shared' ? '600' : '450',
        onSelect: () => this.setState({ switcherScopeId: 'shared' })
      }] : [])
      .concat([...s.identities].sort((a, b) => (a.label || '').toLowerCase().localeCompare((b.label || '').toLowerCase())).map(idy => ({
        id: idy.id, isSelected: switcherScopeId === idy.id,
        dashed: false, notDashed: true, initial: (idy.label || '?')[0].toUpperCase(), tileBg: col(this.identityColor(idy.id)).dot,
        label: idy.label, sub: idy.email || 'no email set', subFontFamily: 'ui-monospace,monospace',
        borderColor: switcherScopeId === idy.id ? 'var(--accent-fill)' : 'transparent',
        bg: switcherScopeId === idy.id ? 'var(--surface)' : 'transparent',
        weight: switcherScopeId === idy.id ? '600' : '450',
        onSelect: () => this.setState({ switcherScopeId: idy.id }),
        cogColor: switcherScopeId === idy.id ? 'var(--text-tertiary)' : 'var(--n30)',
        cogBg: switcherScopeId === idy.id ? 'var(--surface-hover)' : 'transparent',
        onOpenSettings: e => {
          if (e) e.stopPropagation();
          const openSettings = () => this.setState({ settingsOpen: true, settingsSection: 'identity', switcherOpen: false });
          if (idy.id !== this.state.activeIdentityId) this.switchIdentity(idy.id, undefined, openSettings);
          else openSettings();
        }
      })));
    // Room Scoped Widget Mode has exactly one identity and no "Shared
    // with you"/switching concept to expose (see docs/FORMAT.md) -- the
    // switcher's own "scope" grouping label should read "room" here
    // rather than naming the (real, per-viewer) resolved identity, even
    // though the identity/scope LIST column itself is already hidden
    // separately (showIdentityChrome) -- this is the right column
    // ("+ New project in X", "PROJECTS IN X"), deliberately left visible
    // for live project switching, which still names the identity unless
    // corrected here too. Live-reported (Tom): "New project in toml".
    const switcherScopeName = (ROOM_MODE_CAPABILITIES && !ROOM_MODE_CAPABILITIES.multiIdentity)
      ? 'room'
      : (switcherScopeId === 'shared' ? 'Shared with you' : ((s.identities.find(i => i.id === switcherScopeId) || {}).label || ''));
    const switcherScopeLabel = switcherScopeId === 'shared' ? 'SHARED WITH YOU' : ('PROJECTS IN ' + switcherScopeName.toUpperCase());
    const switcherProjectRows = switcherProjectsInScope(switcherScopeId).map(p => ({
      id: p.id, name: p.name, isActive: p.id === s.projectId,
      bg: p.id === s.projectId ? 'var(--c25)' : 'transparent',
      onSelect: () => this.selectSwitcherProject(p)
    }));
    const switcherBreadcrumbIdentityLabel = switcherActiveProject
      ? (switcherActiveProject.identityId ? ((s.identities.find(i => i.id === switcherActiveProject.identityId) || {}).label || '') : 'Shared with you')
      : '';
    const switcherBreadcrumbIdentityColor = (switcherActiveProject && switcherActiveProject.identityId)
      ? col(this.identityColor(switcherActiveProject.identityId)).dot
      : 'var(--n24)';
    const switcher = {
      open: s.switcherOpen,
      // Room Scoped Widget Mode has exactly one, auto-bootstrapped
      // identity (see docs/FORMAT.md) -- ROOM_MODE_CAPABILITIES is null in
      // Local Mode (always show), and { multiIdentity: false, ... } once a
      // real host's wigwag:hello-ack confirms Room Mode. Replaces the old
      // externally-injected CSS hack (wigwag-matrix-host.html's former
      // hideIdentityChrome) with a real, single render path.
      showIdentityChrome: !ROOM_MODE_CAPABILITIES || !!ROOM_MODE_CAPABILITIES.multiIdentity,
      menuGridTemplateColumns: (ROOM_MODE_CAPABILITIES && !ROOM_MODE_CAPABILITIES.multiIdentity) ? '1fr' : '238px 1fr',
      pillBg: s.switcherOpen ? 'color-mix(in oklch, var(--surface) 80%, transparent)' : 'transparent',
      pillBorderColor: s.switcherOpen ? 'var(--border)' : 'transparent',
      onToggle: () => this.setState(st => ({ switcherOpen: !st.switcherOpen, switcherScopeId: null })),
      breadcrumbIdentityLabel: switcherBreadcrumbIdentityLabel,
      scopeHeading: 'WHERE',
      scopes: switcherScopeRows,
      addIdentityOpen: s.addIdentityOpen,
      notAddIdentityOpen: !s.addIdentityOpen,
      onToggleAddIdentity: () => this.setState(st => ({ addIdentityOpen: !st.addIdentityOpen, newIdentityLabelDraft: '', newIdentityEmailDraft: '' })),
      onCancelAddIdentity: () => this.setState({ addIdentityOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }),
      newLabelDraft: s.newIdentityLabelDraft,
      newEmailDraft: s.newIdentityEmailDraft,
      onNewLabelChange: e => this.setState({ newIdentityLabelDraft: e.target.value }),
      onNewEmailChange: e => this.setState({ newIdentityEmailDraft: e.target.value }),
      onNewIdentityKeyDown: e => {
        if (e.key === 'Enter') this.createIdentity(this.state.newIdentityLabelDraft, this.state.newIdentityEmailDraft);
        else if (e.key === 'Escape') { e.stopPropagation(); this.setState({ addIdentityOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }); }
      },
      onCreateIdentity: () => this.createIdentity(s.newIdentityLabelDraft, s.newIdentityEmailDraft),
      scopeLabel: switcherScopeLabel,
      scopeName: switcherScopeName,
      projects: switcherProjectRows,
      noProjects: switcherProjectRows.length === 0,
      // Tracker #169/4f07e72b follow-up: in Room Mode, "New project in..."
      // is subject to the exact same real, live moderator check as the
      // no-projects screen and the layout-proposal icon -- hidden for a
      // non-moderator rather than shown and left to bounce server-side.
      // Local Mode (ROOM_MODE_CAPABILITIES null) is completely unaffected.
      canCreateProject: switcherScopeId !== 'shared' && (!ROOM_MODE_CAPABILITIES || s.isRoomModerator),
      onCreateProject: () => {
        const targetIdentity = s.identities.find(i => i.id === switcherScopeId);
        if (targetIdentity && switcherScopeId !== s.activeIdentityId) {
          this._signingKey = null;
          this.setState({
            activeIdentityId: switcherScopeId,
            identityEmail: targetIdentity.email || '',
            githubToken: targetIdentity.githubToken || '',
            ...identityProxyFieldsFrom(targetIdentity),
            identityPublicKeyJwk: targetIdentity.signingPublicKeyJwk || null,
            identityPrivateKeyJwk: targetIdentity.signingPrivateKeyJwk || null,
            commentReads: this.commentReadsFor(switcherScopeId),
            issueSubscriptions: this.issueSubscriptionsFor(switcherScopeId)
          });
        }
        this.createBlankProject(this.nextUntitledProjectName(switcherScopeId), switcherScopeId);
        this.setState({ switcherOpen: false });
      }
    };
    const emailGate = {
      open: s.emailGateOpen,
      draft: s.emailGateDraft,
      onDraftChange: e => this.onEmailGateDraftChange(e),
      onCancel: () => this.cancelEmailGate(),
      onSubmit: () => this.submitEmailGate(),
      onKeyDown: e => {
        if (e.key === 'Enter') this.submitEmailGate();
        else if (e.key === 'Escape') { e.stopPropagation(); this.cancelEmailGate(); }
      }
    };
    const attributionGateProject = s.projects.find(p => p.id === s.projectId);
    const attributionGateLastIdentity = (attributionGateProject && s.attributionGateMode === 'mismatch')
      ? s.identities.find(i => i.id === attributionGateProject.identityId) : null;
    const attributionGateLastLabel = attributionGateLastIdentity ? attributionGateLastIdentity.label : '';
    const attributionGate = {
      open: s.attributionGateOpen,
      title: s.attributionGateMode === 'mismatch'
        ? ('Your last changes here were as ' + attributionGateLastLabel + '. Still ' + attributionGateLastLabel + '?')
        : 'Who’s making this change?',
      body: s.attributionGateMode === 'mismatch' ? '' : ((attributionGateProject ? attributionGateProject.name : 'This project') + ' was shared with you, so your name isn’t on it yet. Pick who you are here — it’ll be remembered.'),
      options: s.identities.map(idy => ({
        id: idy.id,
        label: idy.label,
        email: idy.email || 'no email set',
        initial: (idy.label || '?')[0].toUpperCase(),
        isSelected: idy.id === s.attributionGateSelectedId,
        tileBg: idy.id === s.attributionGateSelectedId ? col(this.identityColor(idy.id)).dot : 'var(--n15)',
        tileFg: idy.id === s.attributionGateSelectedId ? 'var(--ink-on-accent)' : 'var(--n13)',
        borderStyle: idy.id === s.attributionGateSelectedId ? '1.5px solid var(--accent-fill)' : '1px solid var(--border)',
        bgStyle: idy.id === s.attributionGateSelectedId ? 'var(--c25)' : 'transparent',
        onSelect: () => this.selectAttributionGateIdentity(idy.id)
      })),
      addOpen: s.attributionGateAddOpen,
      notAddOpen: !s.attributionGateAddOpen,
      onToggleAdd: () => this.openAttributionGateAdd(),
      onCancelAdd: () => this.setState({ attributionGateAddOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }),
      newLabelDraft: s.newIdentityLabelDraft,
      newEmailDraft: s.newIdentityEmailDraft,
      onNewLabelChange: e => this.setState({ newIdentityLabelDraft: e.target.value }),
      onNewEmailChange: e => this.setState({ newIdentityEmailDraft: e.target.value }),
      onCreateIdentity: () => this.createIdentityForAttributionGate(s.newIdentityLabelDraft, s.newIdentityEmailDraft),
      onCancel: () => this.cancelAttributionGate(),
      onSave: () => this.confirmAttributionGate()
    };

    // Mobile header + sheets + row list (design_handoff_mobile_header).
    // Desktop only loads the ACTIVE project's issues into state -- the
    // project sheet needs a count for every project in the identity, so
    // it reads each one's doc directly from localStorage, same
    // lightweight synchronous pattern switchProject() already uses for
    // the doc it's switching TO, just applied to every project in the
    // list instead of one.
    const mobileIssueCountFor = pid => {
      if (pid === s.projectId) return s.issues.filter(iss => !iss.deleted).length;
      const summary = this._projectSummaries[pid];
      return summary ? summary.issueCount : 0;
    };
    const mobileRepoFor = pid => {
      if (pid === s.projectId) return s.githubRepo || '';
      const summary = this._projectSummaries[pid];
      return summary ? summary.githubRepo : '';
    };
    // One-line rule description for a bound field's S5 second line --
    // the real condition for a single-row rule (same ruleRowCondition()
    // the rule builder itself uses to compile a row), a plain count/
    // "custom expression" fallback otherwise, same as ruleSummary().
    const mobileBoundSummary = def => {
      if (!def.linkedSourceId) return '';
      const rows = this.ruleDefRows(def);
      if (rows && rows.length === 1) return 'bound · ' + ruleRowCondition(rows[0]);
      return 'bound · ' + this.ruleSummary(def).toLowerCase();
    };
    const mobileMeta = s.projects.find(m => m.id === s.projectId) || null;
    const mobileMq = () => this.setState({ mobileActiveSheet: null });
    const mobileRowsSource = issues.map(issue => {
      const pillFields = [];
      const textFields = [];
      for (const colId of s.columnOrder) {
        const def = fieldDefs[colId];
        if (!def) continue;
        const v = issue.values[colId];
        if (def.type === 'select' && v) {
          const opt = (def.options || []).find(o => o.id === v);
          if (opt) pillFields.push({ id: colId + ':' + opt.id, label: opt.label, bg: col(opt.color).bg, fg: col(opt.color).fg, group: colId });
        } else if (def.type === 'multiselect' && Array.isArray(v) && v.length) {
          for (const optId of v) {
            const opt = (def.options || []).find(o => o.id === optId);
            if (opt) pillFields.push({ id: colId + ':' + optId, label: opt.label, bg: col(opt.color).bg, fg: col(opt.color).fg, group: colId });
          }
        } else if (def.type === 'text' && v && String(v).trim()) {
          textFields.push({ id: colId, label: def.label, value: String(v) });
        }
      }
      const linkedColId = Object.keys(fieldDefs).find(colId => issue.fieldRefs && issue.fieldRefs[colId] && (issue.fieldRefs[colId].system || 'github') === 'github');
      const ref = linkedColId ? issue.fieldRefs[linkedColId] : null;
      const createdAt = issue.history && issue.history.length ? issue.history[0].sortKey : null;
      return {
        id: issue.id,
        title: issue.values.title || '(untitled)',
        shortId: issue.id.slice(0, 8),
        age: relativeAge(createdAt),
        pillFields, hasPillFields: pillFields.length > 0,
        textFields, hasTextFields: textFields.length > 0,
        hasGithubRef: !!ref,
        githubRefLabel: ref ? (ref.owner + '/' + ref.repo + '#' + ref.num) : '',
        commentCount: latestCommentsById(issue.commentStreams.comments || []).length,
        hasComments: latestCommentsById(issue.commentStreams.comments || []).length > 0,
        onOpen: () => { this.openSlideOver(issue.id); this.setState({ mobileActiveSheet: 'row' }); },
        onOpenComments: (e) => { if (e) e.stopPropagation(); this.openSlideOver(issue.id); this.setState({ mobileActiveSheet: 'row', activityTab: 'comments' }); }
      };
    });
    const mobileJumpQueryStripped = s.filterQuery.trim().replace(/^#/, '');
    const mobileJumpResults = jumpMode ? jumpMatches.map(iss => ({
      id: iss.id,
      shortId: iss.id.slice(0, 8),
      title: iss.values.title || '(untitled)',
      onClick: () => { this.openJumpResult(iss.id); this.setState({ mobileActiveSheet: 'row', mobileFilterOpen: false, filterQuery: '', jumpDismissed: false }); }
    })) : [];
    let mobileRowDetail = null;
    if (s.mobileActiveSheet === 'row' && s.slideOverIssueId) {
      const issue = this.findIssue(s.slideOverIssueId);
      if (issue) {
        const mobileDescriptionColId = Object.keys(fieldDefs).find(id => id !== 'title' && fieldDefs[id].type === 'text' && (fieldDefs[id].label || '').trim().toLowerCase() === 'description');
        const mobileCommentEntries = latestCommentsById((issue.commentStreams && issue.commentStreams.comments) || []).map(c => ({
          actor: c.author || 'Someone', initial: (c.author || '?')[0].toUpperCase(), time: this.timeLabelFor(c), text: c.text, isRedacted: !!c.redacted, sortKey: c.sortKey || 0
        })).sort((a, b) => b.sortKey - a.sortKey);
        const mobileHistoryEntries = issue.history.filter(h => h.origin !== 'legacy-backfill').map(h => {
          const pill = this.buildActivityPill(h, fieldDefs);
          const fieldLabelParts = !pill ? this.buildActivityFieldLabel(h, fieldDefs) : null;
          return { actor: h.actor, time: this.timeLabelFor(h), text: h.text, sortKey: h.sortKey || 0, pill, hasPill: !!pill, fieldLabelParts, hasFieldLabel: !!fieldLabelParts, noPill: !pill && !fieldLabelParts, isRedacted: !!h.redacted };
        }).sort((a, b) => b.sortKey - a.sortKey);
        const mobileActiveActivity = s.activityTab === 'history' ? mobileHistoryEntries : mobileCommentEntries;
        const mobilePickerColId = s.activeCell && s.activeCell.issueId === issue.id ? s.activeCell.colId : null;
        const mobilePickerDef = mobilePickerColId ? fieldDefs[mobilePickerColId] : null;
        const mobilePickerIsSelect = !!mobilePickerDef && mobilePickerDef.type === 'select';
        const mobilePickerIsMulti = !!mobilePickerDef && mobilePickerDef.type === 'multiselect';
        const mobileFieldPicker = (mobilePickerIsSelect || mobilePickerIsMulti) ? {
          isMulti: mobilePickerIsMulti,
          title: mobilePickerDef.label,
          closeLabel: 'Done',
          onClose: () => this.setState({ activeCell: null, optionFilterQuery: '' }),
          options: mobilePickerIsSelect
            ? [{ id: '__clear__', label: '\u2014 No value \u2014', selected: !issue.values[mobilePickerColId], dotColor: 'var(--n41)', onSelect: () => this.selectOption(issue.id, mobilePickerColId, null) }]
                .concat((mobilePickerDef.options || []).map(o => ({ id: o.id, label: o.label, selected: o.id === issue.values[mobilePickerColId], dotColor: col(o.color).dot, onSelect: () => this.selectOption(issue.id, mobilePickerColId, o.id) })))
            : (mobilePickerDef.options || []).map(o => { const ids = issue.values[mobilePickerColId] || []; return { id: o.id, label: o.label, selected: ids.includes(o.id), dotColor: col(o.color).dot, onSelect: () => this.toggleMultiOption(issue.id, mobilePickerColId, o.id) }; })
        } : null;
        mobileRowDetail = {
          hasFieldPicker: !!mobileFieldPicker,
          fieldPicker: mobileFieldPicker,
          isCommentsTab: s.activityTab !== 'history',
          isHistoryTab: s.activityTab === 'history',
          commentCount: mobileCommentEntries.length,
          historyCount: mobileHistoryEntries.length,
          onSwitchToComments: () => this.setState({ activityTab: 'comments' }),
          onSwitchToHistory: () => this.setState({ activityTab: 'history' }),
          activity: mobileActiveActivity,
          noActivity: mobileActiveActivity.length === 0,
          newCommentDraft: s.newCommentDraft,
          onNewCommentDraftChange: e => this.setState({ newCommentDraft: e.target.value }),
          onPostComment: () => this.addComment(),
          title: issue.values.title || '(untitled)',
          shortId: issue.id.slice(0, 8),
          age: relativeAge(issue.history && issue.history.length ? issue.history[0].sortKey : null),
          copyLinkLabel: s.slideOverCopyLinkLabel,
          onCopyLink: () => this.copySlideOverLink(),
          hasDescription: !!mobileDescriptionColId,
          description: mobileDescriptionColId ? { label: fieldDefs[mobileDescriptionColId].label, rawText: issue.values[mobileDescriptionColId] || '' } : null,
          fields: realColumnOrder(s.columnOrder).filter(colId => colId !== mobileDescriptionColId).map(colId => {
            const def = fieldDefs[colId];
            const v = issue.values[colId];
            const isBound = fieldLocalBindState(issue, colId, this.liveRuleCtx(issue.id).localDerivedEntryIds) !== 'plain';
            const isPickerType = def.type === 'select' || def.type === 'multiselect';
            const isDateType = def.type === 'date';
            const isEditingDate = isDateType && !isBound && s.activeCell && s.activeCell.issueId === issue.id && s.activeCell.colId === colId;
            let displayValue = '', isPill = false, pillBg = '', pillFg = '';
            if (def.type === 'select' && v) {
              const opt = (def.options || []).find(o => o.id === v);
              if (opt) { displayValue = opt.label; isPill = true; pillBg = col(opt.color).bg; pillFg = col(opt.color).fg; }
            } else if (def.type === 'multiselect' && Array.isArray(v) && v.length) {
              displayValue = v.map(id => { const opt = (def.options || []).find(o => o.id === id); return opt ? opt.label : id; }).join(', ');
            } else {
              displayValue = v == null || v === '' ? '—' : (def.type === 'timestamp' ? relativeAge(v) : String(v));
            }
            let onTap;
            if (isBound) onTap = () => { this.setState({ mobileActiveSheet: null }); this.openRuleBuilder(colId); };
            else if (isPickerType) onTap = () => this.setState({ activeCell: { issueId: issue.id, colId }, optionFilterQuery: '' });
            else if (isDateType && !isEditingDate) onTap = () => this.startEdit(issue.id, colId, v || '');
            return {
              colId, label: def.label, displayValue, isPill, isPlainText: !isPill && !isEditingDate, pillBg, pillFg,
              isBound, boundSummary: isBound ? mobileBoundSummary(def) : '',
              showChevron: !isBound && (isPickerType || isDateType) && !isEditingDate,
              isEditingDate, dateDraft: isEditingDate ? s.editDraft : '',
              onDateDraftChange: e => this.setState({ editDraft: e.target.value }),
              onDateBlur: () => this.commitEdit(issue.id, colId),
              onTap
            };
          })
        };
      }
    }
    const mobile = {
      isSheetSwitcher: s.mobileActiveSheet === 'switcher',
      isSheetRow: s.mobileActiveSheet === 'row',
      isSheetSettings: s.mobileActiveSheet === 'settings',
      sheetVisible: !!s.mobileActiveSheet,
      onCloseSheet: () => { mobileMq(); this.setState({ mobileSettingsSection: null }); if (s.mobileActiveSheet === 'row') this.closeSlideOver(); },
      sheetTransform: s.mobileSheetDragY ? ('translateY(' + s.mobileSheetDragY + 'px)') : '',
      sheetTransition: s.mobileSheetDragging ? 'none' : 'transform 220ms cubic-bezier(0.2,0.8,0.2,1)',
      onSheetGripTouchStart: (e) => this.startMobileSheetDrag(e),
      onOpenSwitcher: () => this.setState({ mobileActiveSheet: 'switcher', switcherScopeId: null }),
      identityInitial: (switcherBreadcrumbIdentityLabel || '?')[0].toUpperCase(),
      identityColor: switcherBreadcrumbIdentityColor,
      projectName: mobileMeta ? mobileMeta.name : 'Untitled',
      headerCollapsed: s.mobileHeaderCollapsed,
      headerExpanded: !s.mobileHeaderCollapsed,
      onListScroll: e => {
        const collapsed = e.target.scrollTop > 24;
        if (collapsed !== s.mobileHeaderCollapsed) this.setState({ mobileHeaderCollapsed: collapsed });
      },
      headerPadding: s.mobileHeaderCollapsed ? '0 6px 0 14px' : '5px 6px 7px 14px',
      headerBorderColor: s.mobileHeaderCollapsed ? 'var(--n11)' : 'var(--n8)',
      headerShadow: s.mobileHeaderCollapsed ? '0 3px 8px rgba(0,0,0,0.07)' : 'none',
      projectFontSize: s.mobileHeaderCollapsed ? '15px' : '16px',
      projectFontWeight: s.mobileHeaderCollapsed ? '600' : '700',
      syncVisible: s.githubSyncStatus !== 'disconnected',
      syncSyncing: s.githubSyncStatus === 'syncing',
      syncSynced: s.githubSyncStatus === 'synced',
      syncError: s.githubSyncStatus === 'error',
      syncDetailOpen: s.mobileSyncDetailOpen,
      syncLabel: this.githubSyncLabel(),
      onToggleSyncDetail: () => this.setState(st => ({ mobileSyncDetailOpen: !st.mobileSyncDetailOpen })),
      onOverflowShare: () => { this.setState({ mobileOverflowOpen: false }); if (navigator.share) navigator.share({ title: mobileMeta ? mobileMeta.name : 'wigwag', text: this.buildSourceText() }).catch(() => {}); },
      overflowOpen: s.mobileOverflowOpen,
      onToggleOverflow: () => this.setState(st => ({ mobileOverflowOpen: !st.mobileOverflowOpen }), () => this.setupAppearanceControl()),
      onToggleReceiveMenu: () => this.setState(st => ({ mobileReceiveMenuOpen: !st.mobileReceiveMenuOpen })),
      receiveMenuOpen: s.mobileReceiveMenuOpen,
      onOverflowApplyUpdate: () => this.setState({ mobileReceiveMenuOpen: false, pasteMergeOpen: true, pasteMergeDraft: '' }),
      onOverflowImportProject: () => this.setState({ mobileReceiveMenuOpen: false, pasteImportOpen: true, pasteImportDraft: '' }),
      onOverflowSettings: () => this.setState({ mobileOverflowOpen: false, mobileActiveSheet: 'settings' }),
      onOverflowProjectSettings: () => { this.setState({ mobileOverflowOpen: false }); this.toggleProjectNotes(); },
      scopeTiles: []
        .concat(switcherHasShared ? [{
          id: 'shared', isShared: true, initial: '', name: 'Shared with you',
          subLabel: countLabel(s.projects.filter(m => !m.identityId).length),
          isActive: switcherScopeId === 'shared',
          rowBg: switcherScopeId === 'shared' ? 'var(--c25)' : 'transparent',
          avatarBg: 'transparent', avatarFg: 'var(--n24)', avatarBorder: '1.5px dashed var(--n24)',
          onSelect: () => this.setState({ switcherScopeId: 'shared' })
        }] : [])
        .concat([...s.identities].sort((a, b) => (a.label || '').toLowerCase().localeCompare((b.label || '').toLowerCase())).map(idy => ({
          id: idy.id, isShared: false, name: idy.label,
          subLabel: (idy.email || 'no email set') + ' · ' + countLabel(projectCount(idy.id)),
          initial: (idy.label || '?')[0].toUpperCase(),
          isActive: idy.id === switcherScopeId,
          rowBg: idy.id === switcherScopeId ? 'var(--c25)' : 'transparent',
          avatarBg: idy.id === switcherScopeId ? col(this.identityColor(idy.id)).dot : 'var(--n15)',
          avatarFg: idy.id === switcherScopeId ? 'var(--ink-on-accent)' : 'var(--n13)',
          avatarBorder: 'none',
          onSelect: () => this.setState({ switcherScopeId: idy.id })
        }))),
      onOpenAddIdentity: () => { this.setState({ mobileAddIdentityOpen: true, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }); },
      projectsSectionLabel: switcherScopeLabel,
      scopedProjects: switcherProjectsInScope(switcherScopeId).map(m => {
        const repo = mobileRepoFor(m.id);
        return {
          id: m.id, name: m.name, isActive: m.id === s.projectId,
          rowBg: m.id === s.projectId ? 'var(--c25)' : 'transparent',
          countLabel: mobileIssueCountFor(m.id) + ' issue' + (mobileIssueCountFor(m.id) === 1 ? '' : 's'),
          hasLink: !!repo, linkLabel: repo,
          onSelect: () => {
            if (m.identityId && m.identityId !== s.activeIdentityId) this.switchIdentity(m.identityId, m.id);
            else this.switchProject(m.id);
            mobileMq();
          }
        };
      }),
      rows: mobileRowsSource,
      noRows: mobileRowsSource.length === 0,
      rowDetail: mobileRowDetail,
      filterOpen: s.mobileFilterOpen,
      onOpenFilter: () => this.setState({ mobileFilterOpen: true }),
      onCancelFilter: () => this.setState({ mobileFilterOpen: false, filterQuery: '', jumpDismissed: false }),
      filterQuery: s.filterQuery,
      onFilterChange: e => this.setState({ filterQuery: e.target.value, jumpDismissed: false, jumpActiveIndex: 0 }),
      jumpMode, jumpResults: mobileJumpResults,
      addOpen: s.mobileAddOpen,
      onOpenAdd: () => this.setState({ mobileAddOpen: true, addItemDraft: '' }),
      onCancelAdd: () => this.setState({ mobileAddOpen: false, addItemDraft: '' }),
      addItemDraft: s.addItemDraft,
      onAddItemDraftChange: e => this.setState({ addItemDraft: e.target.value }),
      onSubmitAdd: () => { if (s.addItemDraft.trim()) this.addIssue(s.addItemDraft); this.setState({ mobileAddOpen: false, addItemDraft: '' }); },
      addIdentityOpen: s.mobileAddIdentityOpen,
      onCancelAddIdentity: () => this.setState({ mobileAddIdentityOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: '' }),
      newIdentityLabelDraft: s.newIdentityLabelDraft,
      onNewIdentityLabelDraftChange: e => this.setState({ newIdentityLabelDraft: e.target.value }),
      newIdentityEmailDraft: s.newIdentityEmailDraft,
      onNewIdentityEmailDraftChange: e => this.setState({ newIdentityEmailDraft: e.target.value }),
      onSubmitAddIdentity: () => { this.createIdentity(s.newIdentityLabelDraft, s.newIdentityEmailDraft); this.setState({ mobileAddIdentityOpen: false, newIdentityLabelDraft: '', newIdentityEmailDraft: '', mobileActiveSheet: null }); },
      settingsSectionsList: settingsSectionDefs.map(d => ({
        id: d.id, label: d.label, configured: d.configured,
        onPick: () => this.setState({ mobileSettingsSection: d.id })
      })),
      settingsSection: s.mobileSettingsSection,
      onBackFromSettingsSection: () => this.setState({ mobileSettingsSection: null }),
      isSettingsIdentity: s.mobileSettingsSection === 'identity',
      isSettingsGithub: s.mobileSettingsSection === 'github',
      isSettingsNotifications: s.mobileSettingsSection === 'notifications',
      settingsSectionTitle: (settingsSectionDefs.find(d => d.id === s.mobileSettingsSection) || {}).title || ''
    };
    return {
      ident,
      switcher,
      globalSearch: this.globalSearchVals(),
      emailGate,
      attributionGate,
      mobile,
      trackerName: (s.projects.find(m => m.id === s.projectId) || {}).name || 'Untitled',
      trackerNameParts: (() => {
        const name = (s.projects.find(m => m.id === s.projectId) || {}).name || 'Untitled';
        const bits = name.split('/');
        const parts = [];
        bits.forEach((bit, i) => {
          if (i > 0) parts.push({ text: '/', style: 'font-weight:300; opacity:0.6; margin:0 9px;' });
          parts.push({ text: bit, style: 'font-weight:700;' });
        });
        return parts;
      })(),
      trackerNameDraft: s.trackerNameDraft,
      onTrackerNameDraftChange: e => this.onTrackerNameDraftChange(e),
      onTrackerNameFocus: e => this.onTrackerNameFocus(e),
      // Still used by the "unknown project" notices (data-testid
      // unknown-project-import-btn/unknown-project-cold-import-btn) --
      // the switcher's own former "Import project..." entry point is gone
      // (tracker #143, dfb378b2, new_bits.zip's Send/Receive/Search
      // handoff Part B), Receive now covers that job too, but these
      // notices are a separate, still-needed way to bring in the exact
      // file a stale/foreign link pointed at.
      onImportProjectClick: () => { const el = document.querySelector('[data-testid="import-project-file-input"]'); if (el) el.click(); },
      // Always creates a NEW project rather than touching the current
      // one -- no confirm() needed (unlike the existing "Open file..."
      // flow, which replaces the working copy), since nothing existing is
      // at risk of being overwritten.
      onImportProjectFileChange: e => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const parsed = this.parseJsonl(String(reader.result || ''));
          this.handleImportParsed(parsed, file.name.replace(/\.[^.]+$/, ''));
        };
        reader.readAsText(file);
      },
      deleteProjectConfirmOpen: s.deleteProjectConfirmOpen,
      deleteProjectName: (s.projects.find(p => p.id === s.projectId) || {}).name || '',
      deleteProjectNameDraft: s.deleteProjectNameDraft,
      onDeleteProjectNameDraftChange: e => this.setState({ deleteProjectNameDraft: e.target.value }),
      deleteProjectConfirmEnabled: !!s.projects.find(p => p.id === s.projectId) && s.deleteProjectNameDraft === (s.projects.find(p => p.id === s.projectId) || {}).name,
      deleteProjectConfirmBg: (s.deleteProjectNameDraft === (s.projects.find(p => p.id === s.projectId) || {}).name) ? 'var(--c17)' : 'var(--n28)',
      deleteProjectConfirmColor: (s.deleteProjectNameDraft === (s.projects.find(p => p.id === s.projectId) || {}).name) ? '#fff' : 'var(--text-muted)',
      deleteProjectConfirmCursor: (s.deleteProjectNameDraft === (s.projects.find(p => p.id === s.projectId) || {}).name) ? 'pointer' : 'not-allowed',
      onCancelDeleteProject: () => this.setState({ deleteProjectConfirmOpen: false, deleteProjectNameDraft: '' }),
      onConfirmDeleteProject: () => this.deleteProject(),
      confirmDialog: s.confirmDialog ? {
        message: s.confirmDialog.message,
        confirmLabel: s.confirmDialog.confirmLabel,
        onCancel: () => this.setState({ confirmDialog: null }),
        onConfirm: () => { const cb = s.confirmDialog.onConfirm; this.setState({ confirmDialog: null }); if (cb) cb(); }
      } : null,
      pasteImportOpen: s.pasteImportOpen,
      pasteImportDraft: s.pasteImportDraft,
      onPasteImportDraftChange: e => this.setState({ pasteImportDraft: e.target.value }),
      onCancelPasteImport: () => this.setState({ pasteImportOpen: false, pasteImportDraft: '' }),
      onSubmitPasteImport: () => {
        const parsed = this.parseJsonl(this.state.pasteImportDraft);
        this.handleImportParsed(parsed, 'Pasted project');
        this.setState({ pasteImportOpen: false, pasteImportDraft: '' });
      },
      lastUpdatedLabel: this.lastUpdatedLabel(),
      formatVersionLabel: 'v' + FORMAT_VERSION,
      isMobileViewport: s.isMobileViewport,
      isDesktopViewport: !s.isMobileViewport,
      // tracker #153 (45556022): a Matrix widget host confirms itself via
      // the same ROOM_MODE_CAPABILITIES handshake ack Room Scoped Widget
      // Mode already uses for storage -- reused here as the "are we
      // embedded, cramped-for-space" signal the compact header needs.
      isWidgetMode: !!ROOM_MODE_CAPABILITIES,
      bootOverlayVisible: window.parent === window && s.bootOverlayPhase !== 'hidden',
      bootOverlayOpacity: s.bootOverlayPhase === 'fading' ? 0 : 1,
      bootOverlayPointerEvents: s.bootOverlayPhase === 'fading' ? 'none' : 'auto',
      deepLinkNotice: s.deepLinkNotice,
      onDismissDeepLinkNotice: () => this.setState({ deepLinkNotice: null }),
      appUpdateAvailable: s.appUpdateAvailable,
      onReloadForUpdate: () => location.reload(),
      onDismissAppUpdate: () => this.setState({ appUpdateAvailable: false }),
      unknownProjectNotice: s.unknownProjectNotice,
      onDismissUnknownProjectNotice: () => this.dismissUnknownProjectState('unknownProjectNotice'),
      unknownProjectCold: s.unknownProjectCold,
      notUnknownProjectCold: !s.unknownProjectCold,
      roomModeBootstrapping: false,
      notRoomModeBootstrapping: true,
      roomHasNoProjects: false,
      hasRoomWriteRejectedMessage: !!s.roomWriteRejectedMessage,
      roomWriteRejectedMessage: s.roomWriteRejectedMessage || null,
      onDismissRoomWriteRejected: () => this.setState({ roomWriteRejectedMessage: null }),
      // Tracker #169/4f07e72b: hidden entirely for a non-moderator (design
      // handoff's own call -- no disabled state, the icon just isn't
      // there), not merely disabled -- isRoomModerator is a real, live
      // Matrix power-level check (see isModeratorForStateEvent in
      // wigwag-core.js), not a client-side-only guess; the actual send is
      // still gated server-side regardless (belt-and-braces, same as
      // project creation).
      showProposeLayout: !!ROOM_MODE_CAPABILITIES && s.isRoomModerator,
      proposeLayoutConfirmOpen: s.proposeLayoutConfirmOpen,
      // Live-reported (Tom, 2026-09-29): a plain position:absolute popover
      // here silently did nothing visible -- the whole widget toolbar pill
      // has overflow:hidden (needed for its own rounded corners/clipping),
      // which clips ANY absolutely-positioned child that renders outside
      // the pill's own box, popover included. Same fix already used by
      // toggleExportMenu/widgetExportMenuAnchorStyle just below: compute
      // real, viewport-relative position:fixed coordinates from the
      // button's own getBoundingClientRect() at click time, escaping the
      // clip entirely.
      proposeLayoutConfirmAnchorStyle: 'position:fixed; top:' + (s.proposeLayoutConfirmAnchorTopPx || 0) + 'px; right:' + (s.proposeLayoutConfirmAnchorRightPx || 0) + 'px;',
      onToggleProposeLayoutConfirm: e => {
        const isOpen = s.proposeLayoutConfirmOpen;
        let anchorRightPx = 0, anchorTopPx = 0;
        if (!isOpen && e && e.currentTarget && e.currentTarget.getBoundingClientRect) {
          const rect = e.currentTarget.getBoundingClientRect();
          anchorRightPx = window.innerWidth - rect.right;
          anchorTopPx = rect.bottom + 6;
        }
        this.setState(st => ({ proposeLayoutConfirmOpen: !st.proposeLayoutConfirmOpen, proposeLayoutConfirmAnchorRightPx: anchorRightPx, proposeLayoutConfirmAnchorTopPx: anchorTopPx }));
      },
      onCancelProposeLayoutConfirm: () => this.setState({ proposeLayoutConfirmOpen: false }),
      onSendLayoutProposal: () => this.sendLayoutProposal(),
      layoutProposalBanner: (() => {
        // Only ever the ACTIVE project's proposal -- a room can hold more
        // than one project (#149), but this device's columnOrder/
        // columnWidths/hiddenFieldIds/freezeColId state (what Accept
        // writes to) belongs to whichever project is currently open, same
        // as every other per-project cosmetic pref.
        const proposal = s.layoutProposals[s.projectId];
        if (!proposal) return null;
        return {
          proposedByLabel: proposal.proposedBy || 'Someone',
          ageLabel: relativeAge(proposal.proposedAt) || 'just now',
          onAccept: () => this.acceptLayoutProposal(s.projectId, proposal),
          onDismiss: () => this.dismissLayoutProposal(s.projectId, proposal)
        };
      })(),
      onDismissUnknownProjectCold: () => this.dismissUnknownProjectState('unknownProjectCold'),
      onOpenSettingsFromCold: () => this.setState({ settingsOpen: true, settingsSection: 'identity' }),
      onOpenConnectRemote: () => this.openConnectRemote(),
      onOpenConnectRemoteFromNotice: () => this.openConnectRemote(s.unknownProjectNotice && s.unknownProjectNotice.wg),
      // Apply Update's own pre-merge gate (tracker #124, 5c3051e9) --
      // rendered top-level (see merge-overlay above), viewport-independent,
      // same as connectRemote below, since Apply Update is reachable from
      // both desktop and mobile.
      mergeGate: this.buildMergeGateViewModel(s),
      connectRemote: (() => {
        const outcome = this.connectRemoteOutcome();
        const probeRows = (s.connectRemoteProbeResults || []).map(r => {
          const idy = r.identityId !== 'public' ? s.identities.find(i => i.id === r.identityId) : null;
          const label = idy ? idy.label : 'Public access';
          let verdict = r.identityId === 'public' ? 'no credentials · checking…' : 'checking…';
          let squareBg = 'transparent', squareFg = '', dashed = true;
          if (r.status === 'write') { verdict = 'read and write'; squareBg = 'oklch(0.93 0.06 155)'; squareFg = 'oklch(0.42 0.11 155)'; dashed = false; }
          else if (r.status === 'read') { verdict = r.identityId === 'public' ? 'no credentials · public' : 'read only'; squareBg = 'oklch(0.93 0.06 155)'; squareFg = 'oklch(0.42 0.11 155)'; dashed = false; }
          else if (r.status === 'refused') { verdict = r.identityId === 'public' ? 'no credentials · private' : (r.reason === 'expired' ? 'token expired' : 'no access'); squareBg = 'var(--surface-selected)'; squareFg = 'var(--text-secondary)'; dashed = false; }
          return { identityId: r.identityId, label, verdict, squareBg, squareFg, dashed, notDashed: !dashed, isSuccess: r.status === 'write' || r.status === 'read', isRefused: r.status === 'refused' };
        });
        const parts = s.connectRemoteParsed || { host: '', owner: '', repo: '', branch: '', path: '' };
        return {
          open: s.connectRemoteOpen,
          address: s.connectRemoteAddress,
          onAddressChange: e => this.onConnectRemoteAddressChange(e),
          hasParsed: !!s.connectRemoteParsed,
          orgValue: parts.owner, repoValue: parts.repo, branchValue: parts.branch || '—', pathValue: parts.path || '—',
          editingParts: s.connectRemoteEditingParts,
          notEditingParts: !s.connectRemoteEditingParts,
          onToggleEditParts: () => this.setState(st => ({ connectRemoteEditingParts: !st.connectRemoteEditingParts })),
          editOwner: parts.owner, editRepo: parts.repo, editBranch: parts.branch, editPath: parts.path,
          onOwnerChange: e => this.onConnectRemotePartChange('owner', e),
          onRepoChange: e => this.onConnectRemotePartChange('repo', e),
          onBranchChange: e => this.onConnectRemotePartChange('branch', e),
          onPathChange: e => this.onConnectRemotePartChange('path', e),
          isProbing: !!s.connectRemoteProbeResults,
          probeRows,
          busy: s.connectRemoteBusy,
          error: s.connectRemoteError,
          hasError: !!s.connectRemoteError,
          isNoAccess: !!outcome && outcome.kind === 'no-access',
          canConnect: !!outcome && outcome.kind !== 'no-access' && !s.connectRemoteBusy,
          connectOpacity: (!!outcome && outcome.kind !== 'no-access' && !s.connectRemoteBusy) ? '1' : '0.45',
          connectLabel: s.connectRemoteBusy ? 'Connecting…' : 'Connect',
          onCancel: () => this.closeConnectRemote(),
          onConnect: () => this.onConnectRemoteConnect()
        };
      })(),
      settingsOpen: s.settingsOpen,
      toggleSettings: () => this.setState(st => ({ settingsOpen: !st.settingsOpen })),
      // settings-modal never unmounts for this transition (it just
      // slides) -- only needs the "visual" half, driven by the same
      // connectorFormVisible state the connector editor's own slide-in
      // uses, so both panels move in lockstep.
      settingsModalTransformOffset: s.connectorFormVisible ? '-100vw' : '0',
      githubToken: s.githubToken,
      onGithubTokenChange: e => this.updateActiveIdentityField('githubToken', e.target.value, 'githubToken'),
      githubOAuthClientId: s.githubOAuthClientId,
      onGithubOAuthClientIdChange: e => this.setState({ githubOAuthClientId: e.target.value.trim() }),
      githubOAuthProxyUrl: s.githubOAuthProxyUrl,
      onGithubOAuthProxyUrlChange: e => this.setState({ githubOAuthProxyUrl: e.target.value.trim() }),
      onSignInWithGithub: () => this.signInWithGithub(),
      githubRepo: s.githubRepo,
      onGithubRepoChange: e => this.onGithubConnectionSettingChange({ githubRepo: e.target.value.trim() }),
      githubRepoPath: s.githubRepoPath,
      onGithubRepoPathChange: e => this.onGithubConnectionSettingChange({ githubRepoPath: e.target.value.trim() }),
      githubRepoBranch: s.githubRepoBranch,
      onGithubRepoBranchChange: e => this.onGithubConnectionSettingChange({ githubRepoBranch: e.target.value.trim() }),
      githubTokenOverride: s.githubTokenOverride,
      onGithubTokenOverrideChange: e => this.onGithubConnectionSettingChange({ githubTokenOverride: e.target.value }),
      githubSyncVisible: !!(s.githubRepo && s.githubRepo.includes('/')),
      githubSyncColor: this.githubSyncColor(),
      onGithubSyncClick: () => this.onGithubSyncIndicatorClick(),
      githubFooterPath: (s.githubRepo || '') + '/' + (s.githubRepoPath || 'tracker.jsonl'),
      githubFooterSyncing: s.githubSyncStatus === 'syncing',
      githubFooterNotSyncing: s.githubSyncStatus !== 'syncing',
      githubFooterTitle: s.githubSyncStatus === 'error' ? s.githubSyncError : this.githubSyncLabel(),
      githubFooterHasRelative: s.githubSyncStatus === 'synced' && !!s.githubLastSyncedAt,
      githubFooterRelative: this.githubSyncRelativeSuffix().trim(),
      identityEmail: s.identityEmail,
      onIdentityEmailChange: e => this.updateActiveIdentityField('email', e.target.value, 'identityEmail'),
      isMatrixIdentity: !!(activeIdentity && activeIdentity.matrixUserId),
      isEmailIdentity: !(activeIdentity && activeIdentity.matrixUserId),
      githubProxyUrl: s.githubProxyUrl,
      onGithubProxyUrlChange: e => this.updateActiveIdentityField('githubProxyUrl', e.target.value, 'githubProxyUrl'),
      githubProxySecret: s.githubProxySecret,
      onGithubProxySecretChange: e => this.updateActiveIdentityField('githubProxySecret', e.target.value, 'githubProxySecret'),
      settingsIdentityLabel: (s.identities.find(i => i.id === s.activeIdentityId) || {}).label || '',
      onSettingsIdentityLabelChange: e => this.updateActiveIdentityField('label', e.target.value),
      settingsSections: settingsSectionDefs.map(d => ({
        id: d.id, label: d.label, configured: d.configured, dotColor: 'var(--accent-fill)',
        weight: d.id === activeSettingsSectionId ? '600' : '450',
        color: d.id === activeSettingsSectionId ? 'var(--text-primary)' : 'var(--n23)',
        bg: d.id === activeSettingsSectionId ? 'var(--surface-selected)' : 'transparent',
        onPick: () => this.setState({ settingsSection: d.id })
      })),
      settingsSectionTitle: currentSettingsSectionDef.title,
      settingsSectionBlurb: currentSettingsSectionDef.blurb,
      settingsIsIdentity: activeSettingsSectionId === 'identity',
      settingsIsRemoteDataStores: activeSettingsSectionId === 'remoteDataStores',
      settingsIsConnectedDataSources: activeSettingsSectionId === 'connectedDataSources',
      connectedSourcesSettings: (() => {
        const form = s.connectorFormOpen;
        const draft = form ? form.draft : null;
        // GitHub/Jira/Salesforce: real, hardcoded integrations (bridges/*.js
        // ported in-process -- see fetchJiraData/fetchSalesforceData/
        // fetchGithubData), not a user-editable macro. Each gets a
        // homogeneous editor SCREEN with the custom connector editor
        // (same sliding-modal chrome, same Settings row shape) but its own
        // FIELDS (root URL/username/credential -- see BUILTIN_INTEGRATIONS
        // for why the field set differs per system) and its own real
        // brand logo instead of a glyph/color picker.
        const builtinForm = s.builtinFormOpen;
        const builtinDraft = builtinForm ? builtinForm.draft : null;
        const builtinSpec = builtinForm ? BUILTIN_INTEGRATIONS[builtinForm.kind] : null;
        const isTauri = this.isTauriConnectorRuntime();
        const allConnectedSources = s.connectedSources || [];
        // One row per connectedSources entry, directly -- no fixed-3
        // concat (Tom's own ask: list only what's actually configured,
        // not one row per built-in regardless of state; an unconfigured
        // kind-tagged row simply isn't in connectedSources at all for a
        // fresh install now that migrateBuiltinConnectors stopped auto-
        // seeding, so it naturally doesn't appear here either). A kind-
        // tagged entry is disabled (shown, not hidden) outside Tauri --
        // except GitHub, whose unauthenticated access works in any
        // browser (see fetchGithubData/connectorMatches' own comments).
        // A macro connector's editing/credential/fetch is Tauri-only
        // entirely, so it's hidden outside Tauri rather than shown
        // disabled, same precedent this already had.
        const rows = allConnectedSources.map(c => {
          if (c.kind) {
            const configured = builtinKindConfigured(c);
            const disabled = c.kind !== 'github' && !isTauri;
            return {
              id: c.id, name: c.name, logoKind: c.kind, builtin: true,
              patternSummaryText: (c.rootUrl || '').trim() || 'Not configured',
              statusLabel: configured ? 'Connected' : 'Not configured', statusColor: configured ? col('green').dot : col('gray').dot,
              showEdit: !disabled, disabled, disabledNote: disabled ? 'Requires the desktop app' : '', rowOpacity: disabled ? '0.55' : '1',
              onEdit: () => this.openBuiltinSourceForm({ id: c.id, kind: c.kind })
            };
          }
          if (!isTauri) return null;
          const n = (c.patterns || []).length;
          return {
            id: c.id, name: c.name, glyph: c.glyph, color: c.color, builtin: false,
            patternSummaryText: n + ' pattern' + (n === 1 ? '' : 's') + (n ? ' · ' + (c.patterns[0].label || c.patterns[0].regex) : ''),
            statusLabel: c.credentialConfigured ? 'Connected' : 'Needs API key', statusColor: c.credentialConfigured ? col('green').dot : col('amber').dot,
            showEdit: true, disabled: false, disabledNote: '', rowOpacity: '1',
            onEdit: () => this.openEditConnectorForm(c.id)
          };
        }).filter(Boolean);
        const patterns = form ? draft.patterns.map((p, i) => {
          let errorText = '';
          if (p.regex.trim()) { try { new RegExp(p.regex); } catch (e) { errorText = 'Invalid regular expression'; } }
          return {
            regex: p.regex, label: p.label, hasError: !!errorText, errorText,
            onRegexChange: e => this.updateConnectorPattern(i, { regex: e.target.value }),
            onLabelChange: e => this.updateConnectorPattern(i, { label: e.target.value }),
            onRemove: () => this.removeConnectorPattern(i)
          };
        }) : [];
        const anyPatternError = patterns.some(p => p.hasError);
        const nameTrimmed = form ? draft.name.trim() : '';
        const macroTrimmed = form ? draft.macro.trim() : '';
        const canSave = !!form && !!nameTrimmed && !!macroTrimmed && !anyPatternError;
        const swatches = form ? PALETTE_ORDER.map(n => col(n).dot).map(c => ({
          color: c, border: draft.color === c ? '2px solid var(--text-strong)' : '2px solid transparent', onPick: () => this.updateConnectorDraft({ color: c })
        })) : [];
        const testResult = form ? form.testResult : null;
        const canRunTest = !!form && !!(form.testId && form.testId.trim()) && !!macroTrimmed && !form.testRunning;
        const builtinRootUrlTrimmed = builtinDraft ? builtinDraft.rootUrl.trim() : '';
        const canSaveBuiltin = !!builtinForm && !!builtinRootUrlTrimmed;
        return {
          rows,
          formVisible: !!form || !!builtinForm,
          // Both editors' markup lives as a sibling of the whole Settings
          // modal, not nested inside it (see docs/EDITING.md) --
          // settings-modal's own transform creates a new containing block
          // AND stacking context for any position:fixed descendant, which
          // a nested overlay couldn't out-rank no matter its own z-index.
          // customFormSlotOpen gates the custom connector editor's own
          // mount/unmount (the "slot" half of its slide-transition idiom
          // -- see connectorFormVisible/startConnectorFromTemplate);
          // connectorEditorSlideOffset drives its actual transform (the
          // "visual" half). builtinFormSlotOpen below is unrelated to any
          // of that -- the built-in editor is a plain small modal with no
          // slide animation (see cancelBuiltinForm's own comment), gated
          // directly on builtinFormOpen with nothing else to coordinate.
          customFormSlotOpen: !!form,
          builtinFormSlotOpen: !!builtinForm,
          connectorEditorSlideOffset: s.connectorFormVisible ? '0' : '100vw',
          builtinFormTitle: builtinSpec ? builtinSpec.name : '',
          builtinLogoKind: builtinForm ? builtinForm.kind : '',
          builtinRootUrlLabel: builtinSpec ? builtinSpec.rootUrlLabel : '',
          builtinRootUrlValue: builtinDraft ? builtinDraft.rootUrl : '', onBuiltinRootUrlChange: e => this.updateBuiltinDraft({ rootUrl: e.target.value }),
          builtinRootUrlPlaceholder: builtinSpec ? builtinSpec.rootUrlPlaceholder : '',
          showBuiltinUsername: !!(builtinSpec && builtinSpec.usernameLabel),
          builtinUsernameLabel: builtinSpec ? builtinSpec.usernameLabel : '',
          builtinUsernameValue: builtinDraft ? builtinDraft.username : '', onBuiltinUsernameChange: e => this.updateBuiltinDraft({ username: e.target.value }),
          builtinUsernamePlaceholder: builtinSpec ? builtinSpec.usernamePlaceholder : '',
          builtinCredentialLabel: builtinSpec ? builtinSpec.credentialLabel : '',
          builtinCredentialValue: builtinDraft ? builtinDraft.credentialDraft : '', onBuiltinCredentialChange: e => this.updateBuiltinDraft({ credentialDraft: e.target.value }),
          builtinCredentialPlaceholder: (builtinDraft && builtinDraft.hasCredential) ? '•••••••••••••••• (unchanged)' : (builtinSpec ? builtinSpec.credentialPlaceholder : ''),
          builtinHelperText: builtinSpec ? builtinSpec.helperText : '',
          // GitHub alone can be edited/used outside Tauri (root URL,
          // anonymous access) -- but a typed token still can't actually
          // be SAVED without keychain access, so swap the usual storage
          // note for one saying so, instead of letting it look like a
          // successful save that silently didn't persist.
          builtinKeychainNote: (builtinForm && builtinForm.kind === 'github' && !isTauri)
            ? 'A token needs the desktop app to save (OS keychain access) -- anonymous access already works without one.'
            : 'Stored in your OS keychain, never in the project file.',
          onSaveBuiltin: () => this.saveBuiltinForm(),
          onCancelBuiltin: () => this.cancelBuiltinForm(),
          saveBuiltinButtonBg: canSaveBuiltin ? 'var(--accent-fill)' : 'var(--n28)', saveBuiltinButtonCursor: canSaveBuiltin ? 'pointer' : 'not-allowed',
          showAddSource: this.isTauriConnectorRuntime(),
          typePickerVisible: s.addSourceTypePickerOpen,
          onCloseTypePicker: () => this.closeAddSourceTypePicker(),
          typeOptions: [
            { kind: 'jira', name: 'Jira', glyph: 'J', color: col('blue').dot, blurb: 'Issue keys and browse URLs', onPick: () => this.openBuiltinSourceForm({ id: null, kind: 'jira' }) },
            { kind: 'github', name: 'GitHub', glyph: 'G', color: col('gray').dot, blurb: 'Issue/PR URLs and owner/repo#123', onPick: () => this.openBuiltinSourceForm({ id: null, kind: 'github' }) },
            { kind: 'salesforce', name: 'Salesforce', glyph: 'S', color: col('teal').dot, blurb: 'Record Ids and Lightning URLs', onPick: () => this.openBuiltinSourceForm({ id: null, kind: 'salesforce' }) },
            { kind: 'blank', name: 'Blank custom', glyph: '+', color: col('red').dot, blurb: 'Start from scratch', onPick: () => this.startConnectorFromTemplate('blank') }
          ],
          onAddClick: () => this.openAddSourceTypePicker(),
          formTitle: form && form.id ? 'Edit source' : 'Add a source',
          onCancel: () => this.cancelConnectorForm(),
          onSave: () => this.saveConnectorForm(),
          isEditing: !!(form && form.id),
          onDelete: () => { if (form && form.id) this.deleteConnectorSource(form.id); },
          saveButtonBg: canSave ? 'var(--accent-fill)' : 'var(--n28)', saveButtonCursor: canSave ? 'pointer' : 'not-allowed',
          nameValue: draft ? draft.name : '', onNameChange: e => this.updateConnectorDraft({ name: e.target.value }),
          glyphValue: draft ? draft.glyph : '', onGlyphChange: e => this.updateConnectorDraft({ glyph: e.target.value }),
          previewGlyph: draft ? (draft.glyph || (draft.name ? draft.name[0].toUpperCase() : '?')) : '?',
          previewColor: draft ? draft.color : col('gray').dot,
          swatches,
          credentialDraftValue: draft ? draft.credentialDraft : '', onCredentialChange: e => this.updateConnectorDraft({ credentialDraft: e.target.value }),
          credentialPlaceholder: (draft && draft.hasCredential) ? '•••••••••••••••• (unchanged)' : 'Paste your API key / token',
          patterns, onAddPattern: () => this.addConnectorPattern(),
          macroValue: draft ? draft.macro : '', onMacroChange: e => this.updateConnectorDraft({ macro: e.target.value }),
          linkTextTemplateValue: draft ? draft.linkTextTemplate : '', onLinkTextTemplateChange: e => this.updateConnectorDraft({ linkTextTemplate: e.target.value }),
          testIdValue: form ? form.testId : '', onTestIdChange: e => this.onConnectorTestIdChange(e.target.value),
          onRunTest: () => this.runConnectorTest(),
          runButtonLabel: form && form.testRunning ? 'Running…' : 'Run',
          runButtonBg: canRunTest ? 'var(--accent-fill)' : 'var(--n28)', runButtonCursor: canRunTest ? 'pointer' : 'not-allowed',
          testHasResult: !!testResult, testOk: testResult ? testResult.ok : false,
          testTitle: testResult ? (testResult.ok ? 'Shaped successfully' : 'Macro threw an error') : '',
          testTitleColor: testResult ? (testResult.ok ? col('green').fg : col('red').fg) : '',
          testBorderColor: testResult ? (testResult.ok ? col('green').dot : col('red').dot) : '',
          testBgColor: testResult ? (testResult.ok ? col('green').bg : col('red').bg) : '',
          testTextColor: testResult ? (testResult.ok ? col('green').fg : col('red').fg) : '',
          testOutputText: testResult ? testResult.output : '',
          testResolvedIdLabel: testResult ? (testResult.matchedPattern ? ('Pattern matched → testing with: ' + testResult.resolvedId) : ('No pattern matched — testing with the typed value as-is: ' + testResult.resolvedId)) : ''
        };
      })(),
      settingsIsNotifications: activeSettingsSectionId === 'notifications',
      mentionNotificationsEnabled: s.mentionNotificationsEnabled,
      onToggleMentionNotifications: () => this.toggleMentionNotifications(),
      mentionToggleBorder: s.mentionNotificationsEnabled ? 'none' : '1.5px solid var(--n30)',
      mentionToggleBg: s.mentionNotificationsEnabled ? 'var(--accent-fill)' : 'transparent',
      mentionNotificationsUnsupported: s.notificationPermission === 'unsupported',
      mentionNotificationsFileOrigin: location.protocol === 'file:',
      mentionNotificationsBlocked: s.notificationPermission === 'denied' && location.protocol !== 'file:' && !(window.__TAURI__ && window.__TAURI__.notification),
      // Tauri has no per-site permission UI to send the user to -- "blocked"
      // there means the OS-level notification permission for the Wigwag app
      // itself was denied, fixed in System Settings (macOS)/Settings
      // (Windows)/notification settings (Linux), never "this page".
      mentionNotificationsBlockedTauri: s.notificationPermission === 'denied' && !!(window.__TAURI__ && window.__TAURI__.notification),
      installedAppVersion: s.installedAppVersion,
      canCheckForUpdates: this.isTauriUpdaterRuntime(),
      checkForUpdatesLabel: s.updateCheckState === 'checking' ? 'Checking\u2026' : s.updateCheckState === 'none' ? 'Up to date' : s.updateCheckState === 'error' ? 'Check failed' : s.updateCheckState === 'available' ? 'Update available' : 'Check for updates',
      onCheckForUpdatesClick: () => this.checkForUpdate(),
      connectorPickerMatches: s.connectorPickerOpen ? s.connectorPickerOpen.matches.map(m => ({
        glyph: m.connector.glyph, color: m.connector.color, name: m.connector.name,
        // A kind-tagged match (github/jira/salesforce) carries no
        // glyph/color of its own (those are macro-connector-only
        // fields) -- logoKind names which real brand mark the template
        // should render instead, '' for a true macro connector.
        logoKind: m.connector.kind || '',
        // Same requireAttribution gate every other apply*LinkToField call
        // site goes through (the single-match path in commitEdit included)
        // -- a write triggered from the picker is still a write.
        onPick: () => this.requireAttribution(() => this.applyLinkToField(s.connectorPickerOpen.issueId, s.connectorPickerOpen.colId, m))
      })) : [],
      connectorPickerVisible: !!s.connectorPickerOpen,
      onDismissConnectorPicker: () => this.setState({ connectorPickerOpen: null }),
      updateAvailableBanner: (() => {
        if (s.updateDismissed) return null;
        if (s.updatePhase === 'downloading') return { titleLabel: 'Downloading update\u2026', statusLabel: "Wigwag will restart automatically once it's ready.", showActions: false };
        if (s.updatePhase === 'installing') return { titleLabel: 'Update downloaded', statusLabel: 'Restarting\u2026', showActions: false };
        if (s.updatePhase === 'error') return {
          titleLabel: 'Update failed',
          statusLabel: s.updateError || 'Something went wrong -- try again later.',
          showActions: true,
          actionLabel: 'Try again',
          onUpdateNow: () => this.checkForUpdate(),
          onDismiss: () => this.dismissUpdate()
        };
        if (s.updateCheckState === 'available' && s.updateInfo) {
          return {
            titleLabel: 'Wigwag ' + s.updateInfo.version + ' is available' + (s.installedAppVersion ? ' (you\u2019re on ' + s.installedAppVersion + ')' : ''),
            statusLabel: 'Update now, or keep working and update next time you restart.',
            showActions: true,
            actionLabel: 'Update & Restart',
            onUpdateNow: () => this.confirmUpdate(),
            onDismiss: () => this.dismissUpdate()
          };
        }
        return null;
      })(),
      onSendTestNotification: () => this.sendTestNotification(),
      testNotificationMessage: s.testNotificationResult === 'sent' ? ((window.__TAURI__ && window.__TAURI__.notification)
          ? 'Sent -- did a notification actually appear? If not, check your system\'s notification settings for Wigwag (System Settings on Mac, notification settings on Windows, or your desktop\'s notification daemon on Linux).'
          : 'Sent -- did a notification actually appear? If not, check your OS notification settings for this browser (System Settings on Mac, notification settings on Windows, or your desktop\'s notification daemon on Linux).')
        : s.testNotificationResult === 'denied' ? ((window.__TAURI__ && window.__TAURI__.notification)
          ? 'Notifications are blocked for Wigwag at the OS level -- allow them in your system\'s notification settings first.'
          : 'Notifications are blocked for this page in your browser -- allow them there first.')
        : s.testNotificationResult === 'unsupported' ? 'This browser does not support notifications.'
        : s.testNotificationResult === 'error' ? ('Failed to send: ' + (s.testNotificationError || 'unknown error')) : '',
      hasTestNotificationMessage: !!s.testNotificationResult,
      pushRelayUrl: s.pushRelayUrl,
      onPushRelayUrlChange: e => this.updateActiveIdentityField('pushRelayUrl', e.target.value, 'pushRelayUrl'),
      pushRelaySecret: s.pushRelaySecret,
      onPushRelaySecretChange: e => this.updateActiveIdentityField('pushRelaySecret', e.target.value, 'pushRelaySecret'),
      onEnablePushNotifications: () => this.enablePushNotifications(),
      pushNotificationsMessage: s.pushNotificationsStatus === 'subscribed' ? 'Subscribed -- this device should now receive push notifications for @mentions even when wigwag is closed, as long as push-relay.js keeps running somewhere.'
        : s.pushNotificationsStatus === 'subscribing' ? 'Subscribing…'
        : s.pushNotificationsStatus === 'error' ? ('Failed: ' + (s.pushNotificationsError || 'unknown error')) : '',
      hasPushNotificationsMessage: !!s.pushNotificationsStatus,
      onCloseSettings: () => this.setState({ settingsOpen: false }),
      identityDetail: {
        signing: (activeIdentity && activeIdentity.signingPublicKeyJwk && activeIdentity.signingPublicKeyJwk.x) || (activeIdentity && activeIdentity.signingPublicKeyJwk ? 'Generated in this browser' : 'None yet'),
        projectCountLabel: activeIdentity ? countLabel(projectCount(activeIdentity.id)) : '—'
      },
      onExportCsv: () => this.downloadTextFile('\uFEFF' + this.buildCsvText(), this.exportFilename('csv'), 'text/csv'),
      onExportXlsx: () => this.buildXlsxBytes().then(bytes => this.downloadTextFile(bytes, this.exportFilename('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
      // "Open a file instead..." lives INSIDE the Receive modal itself now
      // (tracker #143, dfb378b2) -- must close pasteMergeOpen (and clear
      // its draft) when triggering the file picker, or the modal stays
      // open underneath the native file-choose dialog and intercepts
      // every click once a file is actually processed (confirmed live:
      // a second Receive attempt after a dismissed "brand new project?"
      // confirm hung forever, blocked by the still-open overlay).
      onImportMergeClick: () => { this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' }); const el = document.querySelector('[data-testid="merge-file-input"]'); if (el) el.click(); },
      onMergeFileChange: e => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || '');
          const parsed = this.parseJsonl(text);
          this.classifyIngestProvenance(text).then(result => {
            const inboundInfo = { exportedBy: result.envelope ? result.envelope.exported_by : '', exportedAt: result.envelope ? result.envelope.exported_at : null, provenance: result.provenance, fingerprint: result.fingerprint, envelope: result.envelope };
            this.handleApplyUpdateParsed(parsed, file.name.replace(/\.[^.]+$/, ''), inboundInfo);
          });
        };
        reader.readAsText(file);
      },
      onTogglePasteMerge: () => this.setState(st => ({ pasteMergeOpen: !st.pasteMergeOpen, pasteMergeDraft: '' })),
      pasteMergeOpen: s.pasteMergeOpen,
      pasteMergeDraft: s.pasteMergeDraft,
      onPasteMergeDraftChange: e => this.setState({ pasteMergeDraft: e.target.value }),
      onCancelPasteMerge: () => this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' }),
      // e.target === e.currentTarget means the mousedown landed on the
      // backdrop itself, not something inside the modal that bubbled up
      // -- so a drag-select starting inside the textarea and ending
      // outside it doesn't close the modal.
      onPasteMergeBackdrop: e => { if (e.target === e.currentTarget) this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' }); },
      onSubmitPasteMerge: () => {
        const text = this.state.pasteMergeDraft;
        const parsed = this.parseJsonl(text);
        this.classifyIngestProvenance(text).then(result => {
          const inboundInfo = { exportedBy: result.envelope ? result.envelope.exported_by : '', exportedAt: result.envelope ? result.envelope.exported_at : null, provenance: result.provenance, fingerprint: result.fingerprint, envelope: result.envelope };
          this.handleApplyUpdateParsed(parsed, 'Pasted update', inboundInfo);
        });
        this.setState({ pasteMergeOpen: false, pasteMergeDraft: '' });
      },
      exportMenuOpen: s.exportMenuOpen,
      widgetExportMenuAnchorStyle: 'position:fixed; top:' + (s.exportMenuAnchorTopPx || 0) + 'px; right:' + (s.exportMenuAnchorRightPx || 0) + 'px;',
      toggleExportMenu: e => {
        clearTimeout(this._sendCopiedTimer);
        const isOpen = s.exportMenuOpen;
        let anchorRightPx = 0, anchorTopPx = 0;
        if (!isOpen && ROOM_MODE_CAPABILITIES && e && e.currentTarget && e.currentTarget.getBoundingClientRect) {
          const rect = e.currentTarget.getBoundingClientRect();
          anchorRightPx = window.innerWidth - rect.right;
          anchorTopPx = rect.bottom + 6;
        }
        this.setState(st => ({ exportMenuOpen: !st.exportMenuOpen, sendCopied: false, exportMenuAnchorRightPx: anchorRightPx, exportMenuAnchorTopPx: anchorTopPx }));
      },
      onExportJsonl: () => { this.buildSignedExportText('full').then(text => this.downloadTextFile(text, this.exportFilename(), 'application/x-jsonl')); this.setState({ exportMenuOpen: false }); },
      onExportJsonlSquashed: () => { this.buildSignedExportText('squashed').then(text => this.downloadTextFile(text, this.exportFilename(), 'application/x-jsonl')); this.setState({ exportMenuOpen: false }); },
      onCopyToClipboard: () => {
        clearTimeout(this._sendCopiedTimer);
        this.buildSignedExportText('full')
          .then(text => this.writeToClipboard(text))
          .then(() => {
            this.setState({ sendCopied: true });
            this._sendCopiedTimer = setTimeout(() => this.setState({ sendCopied: false, exportMenuOpen: false }), 1100);
          })
          .catch(() => {});
      },
      sendCopyDone: !!s.sendCopied,
      sendCopyNotDone: !s.sendCopied,
      sendCopyTitle: s.sendCopied ? 'Copied to clipboard' : 'Copy to clipboard',
      sendCopyTitleColor: s.sendCopied ? 'var(--accent-ink)' : 'inherit',
      onExportHtml: () => {
        this.setState({ exportMenuOpen: false });
        this.buildHtmlExport()
          .then(html => this.downloadTextFile(html, this.exportFilename('html'), 'text/html'))
          .catch(err => window.alert('Could not build the HTML export: ' + err.message));
      },
      sourceView: s.sourceViewOpen,
      notSourceView: !s.sourceViewOpen,
      toggleSourceView: this.toggleSourceView,
      closeSourceView: this.closeSourceView,
      stopClick: this.stopClick,
      copySource: this.copySource,
      copyLabel: s.copyLabel,
      sourceFilename: s.sourceViewOpen ? this.exportFilename() : '',
      sourceSizeLabel: s.sourceViewOpen ? humanFileSize(new Blob([this.buildSourceText('full')]).size) : '',
      sourcePretty: s.sourceViewOpen ? this.prettySourceNodes() : null,
      onSourceCopy: this.onSourceCopy,
      filterQuery: s.filterQuery,
      onFilterChange: e => this.setState({ filterQuery: e.target.value, jumpDismissed: false, jumpActiveIndex: 0, filterSuggestDismissed: false, filterSuggestActiveIndex: 0 }),
      onFilterFocus: e => {
        let anchorLeft = 0, anchorTopPx = 0;
        // Anchor off the visibly-bordered wrap, not the bare (border:none)
        // input inside it -- the wrap's own padding otherwise puts the
        // input's rect several px above the wrap's real bottom border.
        const wrapEl = e && e.currentTarget && e.currentTarget.closest('[data-testid="filter-input-wrap"], [data-testid="widget-filter-field"]');
        if (wrapEl && wrapEl.getBoundingClientRect) {
          const a = this.computeAnchor(wrapEl, 280);
          anchorLeft = a.left; anchorTopPx = a.bottom + 3;
        }
        this.setState({ filterSuggestDismissed: false, filterSuggestAnchorLeft: anchorLeft, filterSuggestAnchorTopPx: anchorTopPx });
      },
      onFilterKeyDown: this.onFilterKeyDown,
      hasFilterQuery: !!s.filterQuery.trim(),
      onClearFilterQuery: () => this.setState({ filterQuery: '' }),
      widgetFilterOpen: s.widgetFilterOpen,
      onOpenWidgetFilter: this.onOpenWidgetFilter,
      onWidgetFilterKeyDown: this.onWidgetFilterKeyDown,
      onWidgetFilterBlur: this.onWidgetFilterBlur,
      onClearWidgetFilter: this.onClearWidgetFilter,
      // Shared no-op mousedown suppressor -- see the widget-filter-clear-btn
      // and filter-suggest-row incident notes above for why this matters.
      onSuppressMouseDown: e => e.preventDefault(),
      widgetFilterCountLabel: visibleIssueCount + ' of ' + s.issues.filter(i => !i.deleted).length,
      widgetFunnelColor: s.filterQuery.trim() ? '#3b5bdb' : 'var(--text-strong)',
      widgetFunnelBg: s.filterQuery.trim() ? '#e6ebfb' : 'transparent',
      widgetFunnelFill: s.filterQuery.trim() ? 'currentColor' : 'none',
      widgetToolbarPillClass: s.widgetFilterOpen ? 'wigwag-toolbar-forced-compact' : '',
      filterSuggestOpen: filterSuggestOpen && (!ROOM_MODE_CAPABILITIES || s.widgetFilterOpen), filterSuggestItems, filterSuggestIsValue: filterSuggest.mode === 'value',
      filterSuggestPopoverStyle: 'position:fixed; left:' + s.filterSuggestAnchorLeft + 'px; top:' + s.filterSuggestAnchorTopPx + 'px;',
      onTableScroll: (e) => {
        const el = e.currentTarget;
        if (el._lastScrollTop === el.scrollTop) return;
        el._lastScrollTop = el.scrollTop;
        this.measureTableOverflow();
      },
      rowsBelow: s.rowsBelow || 0,
      rowsBelowVisible: (s.rowsBelow || 0) > 0 && (s.rowsFitting || 0) >= 3,
      rowsBelowLabel: (s.rowsBelow || 0) === 1 ? '1 more below' : (s.rowsBelow || 0) + ' more below',
      onJumpToTableEnd: () => this.scrollTableToEnd(),
      addFieldOpen: s.addFieldOpen,
      toggleAddField: e => this.toggleAddField(e),
      addFieldPopoverStyle: 'position:fixed; left:' + s.addFieldAnchorLeft + 'px; max-height:' + s.addFieldMaxHeightPx + 'px; overflow-y:auto; ' +
        (s.addFieldOpenUpward ? ('bottom:' + s.addFieldAnchorBottomPx + 'px;') : ('top:' + s.addFieldAnchorTopPx + 'px;')),
      hasHiddenFields: s.hiddenFieldIds.length > 0,
      hiddenFields: s.hiddenFieldIds.map(id => ({ label: fieldDefs[id] ? fieldDefs[id].label : id, onShow: () => this.showField(id) })),
      newFieldName: s.newFieldName,
      onNewFieldNameChange: e => this.setState({ newFieldName: e.target.value }),
      newFieldType: s.newFieldType,
      onNewFieldTypeChange: e => this.setState({ newFieldType: e.target.value }),
      submitNewField: this.submitNewField,
      titleMenuOpen: s.openColMenuId === TITLE_COL_ID,
      onToggleTitleMenu: e => this.toggleColMenu(TITLE_COL_ID, e),
      titleMenuStyle: 'position:fixed; left:' + s.colMenuAnchorLeft + 'px; max-height:' + s.colMenuMaxHeightPx + 'px; overflow-y:auto; ' + (s.colMenuOpenUpward ? ('bottom:' + s.colMenuAnchorBottomPx + 'px;') : ('top:' + s.colMenuAnchorTopPx + 'px;')),
      titleIsSortAsc: s.sort.colId === 'title' && s.sort.dir === 'asc',
      titleIsSortDesc: s.sort.colId === 'title' && s.sort.dir === 'desc',
      onTitleSortAsc: () => (s.sort.colId === 'title' && s.sort.dir === 'asc') ? this.clearSort() : this.sortBy('title', 'asc'),
      onTitleSortDesc: () => (s.sort.colId === 'title' && s.sort.dir === 'desc') ? this.clearSort() : this.sortBy('title', 'desc'),
      columns, headerSegments, rows, cellPadding, titleCellPadding, titleHeaderPadding, totalWidth, titleWidth,
      isTableView, isKanbanView, groupByLabel, kanbanColumns,
      onClearGroupBy: () => this.clearGroupBy(),
      isSelecting, selectionCount: s.selectedIssueIds.length, visibleIssueCount,
      headerChecked: headerAllSelected, headerIndeterminate: headerSomeSelected,
      headerCheckboxBorder: (headerAllSelected || headerSomeSelected) ? 'none' : '1.5px solid var(--n30)',
      headerCheckboxBg: (headerAllSelected || headerSomeSelected) ? 'var(--accent-fill)' : 'transparent',
      // Widget-only: narrower gutter + smaller checkbox nudge lines the
      // checkbox up with the logo mark and "Issue" up with the project
      // title (live-reported, measured against real coordinates) --
      // desktop keeps its original 56px/8px.
      gutterWidth: ROOM_MODE_CAPABILITIES ? 36 : 56,
      gutterCheckboxMarginLeft: ROOM_MODE_CAPABILITIES ? '3px' : '8px',
      onToggleHeaderCheckbox: () => this.toggleHeaderCheckbox(),
      onClearSelection: () => this.setState({ selectedIssueIds: [] }),
      bulkBar: this.buildBulkBar(s, fieldDefs, isSelecting),
      refreshProgress: this.buildRefreshProgressView(s.refreshJobs[s.projectId]),
      headerJobChip: this.buildHeaderJobChip(s),
      statusBarOverflowOpen: s.statusBarOverflowOpen,
      onToggleStatusBarOverflow: () => this.setState(st => ({ statusBarOverflowOpen: !st.statusBarOverflowOpen })),
      statusBarRowFits: s.statusBarRowFits, statusBarRowOpacity: s.statusBarRowFits ? 1 : 0, statusBarRowPointerEvents: s.statusBarRowFits ? 'auto' : 'none',
      viewSourceSep: !!(s.githubRepo && s.githubRepo.includes('/')),
      appVersionLabel: s.installedAppVersion ? ('App ' + s.installedAppVersion + ((!this.isTauriUpdaterRuntime() || s.updateCheckState === 'none') ? '' : (' \u00b7 ' + (s.updateCheckState === 'checking' ? 'Checking\u2026' : s.updateCheckState === 'error' ? 'Check failed' : s.updateCheckState === 'available' ? 'Update available' : 'Check for updates')))) : '',
      isTauriWindowedRuntime: this.isTauriWindowedRuntime(),
      showMacTrafficLightSpacer: this.isTauriWindowedRuntime() && this.isTauriMacOS(),
      showCustomWindowControls: this.isTauriWindowedRuntime() && !this.isTauriMacOS(),
      onWindowMinimize: this.onWindowMinimize, onWindowToggleMaximize: this.onWindowToggleMaximize, onWindowClose: this.onWindowClose,
      tier2VerticalPadding: this.isTauriWindowedRuntime() ? '8px' : '20px',
      onStartResizeTitle: e => this.startColumnResize('title', 300, e),
      titleWrap: !!s.columnWrap.title,
      onToggleTitleWrap: () => this.toggleColumnWrap('title'),
      onToggleTitleFreeze: () => this.toggleFreeze(TITLE_COL_ID),
      titleIsFrozenHere: freezeColId === TITLE_COL_ID,
      isFrozenActive,
      // Each corner radius is its own single-token hole (never a multi-token
      // shorthand, never the literal word 'none') -- both forms intermittently
      // failed to resolve in this runtime, especially for the last item of a
      // looped list, which is what caused the "still broken" corners.
      tableRadius: ROOM_MODE_CAPABILITIES ? '0px' : (isFrozenActive ? '0px' : '0px 0px 8px 8px'),
      // The gutter's own border-left and the last row's own border-bottom already
      // draw the frozen block's edges (accent) -- keeping the table's own left/
      // bottom border too would put a second, normal-coloured line right beside them.
      tableBorderLeftOuter: ROOM_MODE_CAPABILITIES ? 'none' : (isFrozenActive ? '1px solid var(--surface)' : '1px solid var(--n34)'),
      tableBorderBottom: ROOM_MODE_CAPABILITIES ? 'none' : (isFrozenActive ? '1px solid var(--surface)' : '1px solid var(--n34)'),
      tableBorderRight: ROOM_MODE_CAPABILITIES ? 'none' : '1px solid var(--n34)',
      tableCardMargin: ROOM_MODE_CAPABILITIES ? '0' : ('0 28px ' + (s.tableOverflow ? '14px' : '0px') + ' ' + (isFrozenActive ? '-1px' : '28px')),
      headerRowBg: 'var(--surface-header)',
      tableCornerBorder: ROOM_MODE_CAPABILITIES ? 'none' : '1px solid var(--n34)',
      tableRegionInset: isFrozenActive ? 'padding-left:28px;' : '',
      // Tracker 0ff73acf: a short table stays content-height everywhere
      // EXCEPT the real Tauri window, where Tom wants the add-item bar
      // anchored to the bottom -- "it feels natural for a webpage to end
      // high up the page, but for a native window it feels unnatural."
      tableRegionFlex: this.isTauriWindowedRuntime() ? '1' : '0 1 auto',
      // Padding the scroll container by 1px (and pulling the content wrapper's
      // own margin in by the same 1px to net zero visually) keeps the sticky
      // frozen columns permanently past their "just became stuck" threshold --
      // even at scrollLeft:0 -- instead of sitting exactly on it, which is what
      // caused a 1px jump the moment scrolling started (a discrete browser
      // rounding difference between unstuck/static and stuck/sticky layout).
      tableScrollWrapPad: isFrozenActive ? 'padding-left:1px;' : '',
      tableInnerMarginLeftAdj: isFrozenActive ? '-1px' : '28px',
      showFreezePill: isFrozenActive && isTableView,
      showHiddenByColumnFiltersHint: isTableView && hiddenByColumnFiltersIssues.length > 0,
      hiddenByColumnFiltersLabel: hiddenByColumnFiltersIssues.length + ' match' + (hiddenByColumnFiltersIssues.length === 1 ? '' : 'es') + ' hidden by column filters' + (hiddenByColumnFiltersFellBackToDimmed ? ' (shown faded below)' : ''),
      onClearAllColumnFilters: () => this.clearAllColumnFilters(),
      freezeLabel: freezeColId === TITLE_COL_ID ? 'Issue' : (freezeColId && fieldDefs[freezeColId] ? fieldDefs[freezeColId].label : ''),
      onClearFreeze: () => this.clearFreeze(),
      moreBelowBottom: ROOM_MODE_CAPABILITIES ? '32px' : '-5px',
      appRootHeightStyle: ROOM_MODE_CAPABILITIES
        ? ('height:100vh; min-height:' + (44 + 32 + 68 + 44) + 'px; overflow:hidden; box-sizing:border-box; border:1px solid var(--n34); border-radius:10px;')
        : 'height:100vh; overflow:hidden;',
      showDesktopAddItem: !isSelecting && !ROOM_MODE_CAPABILITIES,
      showDesktopBulkBar: isSelecting && !ROOM_MODE_CAPABILITIES && !(s.refreshJobs[s.projectId] && s.refreshJobs[s.projectId].status === 'fetching'),
      showDesktopRefreshProgress: isSelecting && !ROOM_MODE_CAPABILITIES && !!(s.refreshJobs[s.projectId] && s.refreshJobs[s.projectId].status === 'fetching'),
      addItemTextIndent: (titleWidth < 90) ? '6px' : '12px',
      tableScrollWrapBg: ROOM_MODE_CAPABILITIES ? 'var(--n33)' : 'transparent',
      addItemShortcutHint: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌃ Space' : 'Ctrl Space',
      gutterHeaderStickyStyle: gutterStickyStyle(true, ''),
      headerRowBorderTop: ROOM_MODE_CAPABILITIES ? 'none' : (isFrozenActive ? 'none' : '1px solid var(--n34)'),
      headerRowBorderBottom: ROOM_MODE_CAPABILITIES ? '1px solid var(--n28)' : '1px solid var(--n15)',
      headerRadius: ROOM_MODE_CAPABILITIES ? '0px' : (isFrozenActive ? '0px' : (issues.length === 0 ? '8px' : '8px 8px 0px 0px')),
      headerGutterRadius: ROOM_MODE_CAPABILITIES ? '0px' : (isFrozenActive ? '0px' : (issues.length === 0 ? '8px 0px 0px 8px' : '8px 0px 0px 0px')),
      tableOverflow: s.tableOverflow,
      tableBottomSpacer: s.tableOverflow ? '14px' : '0px',
      addIssue: this.addIssue,
      addItemOpen: s.addItemOpen,
      addItemCollapsed: !s.addItemOpen,
      addItemDraft: s.addItemDraft,
      addItemBorderColor: s.addItemOpen ? 'var(--c54)' : 'var(--n34)',
      addItemCursor: s.addItemOpen ? 'text' : 'pointer',
      onAddItemBoxClick: this.onAddItemBoxClick,
      onAddItemPlusClick: this.onAddItemPlusClick,
      onAddItemDraftChange: e => this.setState({ addItemDraft: e.target.value }),
      onAddItemKeyDown: this.onAddItemKeyDown,
      onAddItemBlur: this.onAddItemBlur,
      onAddItemPaste: this.onAddItemPaste,
      bulkPaste: this.buildBulkPasteViewModel(s),
      bulkSummaryOpen: s.bulkSummaryOpen,
      onToggleBulkSummaryPopover: this.toggleBulkSummaryPopover,
      bulkSummaryPopoverStyle: 'position:fixed; left:' + s.bulkSummaryAnchorLeft + 'px; max-height:' + s.bulkSummaryMaxHeightPx + 'px; overflow-y:auto; ' + (s.bulkSummaryOpenUpward ? ('bottom:' + s.bulkSummaryAnchorBottomPx + 'px;') : ('top:' + s.bulkSummaryAnchorTopPx + 'px;')),
      fieldEditor, closeFieldEditor: this.closeFieldEditor,
      ruleBuilder: this.ruleBuilderVals(), closeRuleBuilder: this.closeRuleBuilder,
      slideOver, closeSlideOver: this.closeSlideOver,
      newCommentDraft: s.newCommentDraft,
      onNewCommentChange: e => this.setState({ newCommentDraft: e.target.value }),
      onNewCommentPaste: e => this.handleMarkdownLinkPaste(e, v => this.setState({ newCommentDraft: v })),
      onCommentKeyDown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.addComment(); } },
      addComment: this.addComment,
      editCommentDraft: s.editCommentDraft,
      onEditCommentDraftChange: e => this.setState({ editCommentDraft: e.target.value }),
      onEditCommentPaste: e => this.handleMarkdownLinkPaste(e, v => this.setState({ editCommentDraft: v })),
      onEditCommentKeyDown: e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.saveEditComment(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelEditComment(); }
      },
      saveEditComment: this.saveEditComment,
      cancelEditComment: this.cancelEditComment,
      note,
      closeProjectNotes: this.closeProjectNotes,
      onToggleNotes: () => this.toggleProjectNotes(),
      notesButtonColor: s.projectNotesOpen ? 'var(--n48)' : 'var(--text-strong)'
    };
  }
}
