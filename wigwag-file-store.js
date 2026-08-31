// File-based storage for a wigwag CLI, built directly on wigwag-core.js.
// Mirrors this repo's own wigwag-client.js/wigwag-agent.js split: this is
// a plain library (no argv parsing, no console output) -- wigwag-cli.js
// is the thin wrapper around it. See
// /home/dev/.claude/plans/vast-cuddling-pnueli.md (Phase 4b) for the
// design this implements.
//
// FileProjectStore reads/writes a project's tracker.jsonl directly via
// wigwag-core.js's buildSourceText/parseJsonl -- the SAME file format
// GitHub sync already pushes/pulls, so round-tripping between this CLI
// and a browser is trivial. A small sidecar JSON file
// (.wigwag-config.json) holds the two fields the .jsonl format doesn't
// carry: hiddenFieldIds and the GitHub sync target (repo/path/branch).
//
// CredentialStore reads one identity object (id/label/email/githubToken/
// jiraProxyUrl/salesforceProxyUrl/signingPublicKeyJwk/
// signingPrivateKeyJwk) from a file -- the same shape wigwag.html's
// IDENTITIES_KEY stores per-identity, and the same shape already
// documented in this repo's own wigwag_tracker file (reuses
// wigwag-client.js's loadIdentity, which already knows how to pull that
// JSON block out of a prose-plus-JSON file like wigwag_tracker -- no
// second parser for the same format). No "active identity" concept: a
// CLI invocation always acts as exactly one identity, resolved once at
// startup and passed through explicitly.
const fs = require('fs');
const path = require('path');
const core = require('./wigwag-core.js');
const { loadIdentity } = require('./wigwag-client.js');

const TRACKER_FILENAME = 'tracker.jsonl';
const CONFIG_FILENAME = '.wigwag-config.json';
const LOCK_FILENAME = '.wigwag-lock';

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}

class FileProjectStore {
  constructor(dir) {
    this.dir = dir;
    this.trackerPath = path.join(dir, TRACKER_FILENAME);
    this.configPath = path.join(dir, CONFIG_FILENAME);
    this.lockPath = path.join(dir, LOCK_FILENAME);
  }

  _loadConfig() {
    if (!fs.existsSync(this.configPath)) return {};
    return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
  }

  // Exclusive advisory lock on this directory for the duration of a
  // write -- a second CLI invocation against the same dir while one is
  // already writing fails fast with a clear error instead of both
  // racing to save() and one silently clobbering the other's changes.
  // A lock whose recorded pid is no longer running (a crashed prior
  // invocation, most likely) is detected as stale and taken over.
  acquireLock() {
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      fs.writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }), { flag: 'wx' });
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let holder = null;
    try { holder = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')); } catch (e) { /* unreadable -- treat as stale below */ }
    if (holder && holder.pid && isProcessAlive(holder.pid)) {
      throw new Error(`Another wigwag-cli.js process (pid ${holder.pid}, started ${holder.time}) is already writing to ${this.dir}.`);
    }
    fs.writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
  }

  releaseLock() {
    try { fs.unlinkSync(this.lockPath); } catch (e) { /* already gone -- fine */ }
  }

  // Loads the project doc, hydrated the same way wigwag.html hydrates on
  // boot (parseJsonl already runs every issue through hydrateIssue;
  // hydrateProject derives fieldDefs fresh from projectHistory rather
  // than trusting a possibly-stale stored copy, same as the browser).
  // Returns a fresh, empty doc if no tracker.jsonl exists yet -- the
  // equivalent of opening wigwag.html against a brand-new project.
  //
  // Deliberately {} here, NOT defaultFieldDefs() -- that's the app's
  // "New Project" starter-field seed, a real opinionated shape (title/
  // linked/type/priority/rag/teams/mitigation), not a neutral "nothing
  // yet" placeholder. A first pull into an empty checkout merges this
  // value against the remote's real fields (computeFieldDefsMerge); a
  // non-empty placeholder here means every one of its fields survives
  // that merge as if it were real local state, permanently polluting the
  // REMOTE project's own field set once pushed. Confirmed live: this
  // exact bug added 6 bogus fields (and 6 synthetic "Created field"
  // backfill history entries) to lampholder/wigwag on 2026-08-31.
  load() {
    const config = this._loadConfig();
    const base = {
      projectId: config.projectId || null, projectName: config.projectName || null,
      hiddenFieldIds: config.hiddenFieldIds || [],
      githubRepo: config.githubRepo || '', githubRepoPath: config.githubRepoPath || TRACKER_FILENAME, githubRepoBranch: config.githubRepoBranch || ''
    };
    if (!fs.existsSync(this.trackerPath)) {
      return Object.assign(base, {
        fieldDefs: {}, projectHistory: [],
        projectNotes: '', projectComments: [], issues: []
      });
    }
    const text = fs.readFileSync(this.trackerPath, 'utf8');
    const parsed = core.parseJsonl(text, config.fieldDefs || {});
    const { fieldDefs, projectHistory } = core.hydrateProject(parsed.fields || {}, parsed.projectHistory || []);
    return Object.assign(base, {
      projectId: parsed.projectId || base.projectId,
      projectName: parsed.projectName || base.projectName,
      fieldDefs, projectHistory,
      projectNotes: parsed.projectNotes || '', projectComments: parsed.projectComments || [],
      issues: parsed.issues // already hydrated (values/fieldRefs derived) by parseJsonl
    });
  }

  // Writes tracker.jsonl in full (unsquashed) mode -- matches what
  // wigwag.html's own "Export JSONL" produces -- plus the sidecar config.
  save(doc) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.trackerPath, core.buildSourceText('full', doc));
    fs.writeFileSync(this.configPath, JSON.stringify({
      projectId: doc.projectId, projectName: doc.projectName,
      hiddenFieldIds: doc.hiddenFieldIds || [],
      githubRepo: doc.githubRepo || '', githubRepoPath: doc.githubRepoPath || TRACKER_FILENAME, githubRepoBranch: doc.githubRepoBranch || ''
    }, null, 2) + '\n');
  }
}

const CredentialStore = {
  // Throws if the file doesn't exist or doesn't carry a signing key --
  // a CLI invocation with no usable identity can't do anything
  // meaningful (every write needs to sign), so failing loudly here beats
  // a confusing failure deep inside a commitSignedEntry call later.
  load(filePath) {
    const identity = loadIdentity(filePath);
    if (!identity || !identity.signingPrivateKeyJwk) {
      throw new Error('Invalid credentials file at ' + filePath + ' -- expected an identity object with a signingPrivateKeyJwk.');
    }
    return identity;
  }
};

module.exports = { FileProjectStore, CredentialStore, TRACKER_FILENAME, CONFIG_FILENAME, LOCK_FILENAME };
