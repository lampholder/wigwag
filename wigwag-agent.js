#!/usr/bin/env node
// CLI for interacting with the live wigwag tracker (the project this repo
// itself is developed against, github.com/lampholder/wigwag) as the
// persistent "Claude" identity -- see `wigwag_tracker` at the repo root
// for the identity/credentials this reads, and CLAUDE.md for when to use
// this (backlog/TODO tracking for wigwag itself lives in that tracker,
// not in scratch markdown files).
//
// This file is just argv parsing and output formatting -- the actual
// browser-driving/interaction logic (a real headless wigwag.html instance
// via Playwright, real signed history entries, real Connect Remote flow)
// lives in wigwag-client.js. See that file for the full rationale.
//
// Usage:
//   node wigwag-agent.js list
//   node wigwag-agent.js show <num-or-id-prefix>
//   node wigwag-agent.js add-issue "Title text"
//   node wigwag-agent.js comment <num-or-id-prefix> "Comment text"
//   node wigwag-agent.js set-field <num-or-id-prefix> "<Field label>" <value>
//     (value is an option's exact label for a select field, or plain
//     text for a text field)
//
// Each invocation connects fresh (see wigwag-client.js's connect()) --
// there's no persistent profile, so every call re-syncs from GitHub
// first. That's deliberate: it means every read/write always reflects
// the current state of the real file, never a stale local copy. Costs
// ~10-20s per call (browser launch + the real ~4s push debounce) -- fine
// for backlog-grooming cadence, not meant for high-frequency use.
const { connect } = require('./wigwag-client');

function formatIssueLine(iss) {
  return `#${String(iss.num).padEnd(3)} [${iss.id.slice(0, 8)}] (${iss.status || ''})  ${iss.values.title || '(untitled)'}`;
}

async function cmdList(client) {
  const { projectId, issues } = await client.list();
  console.log(`Project ${projectId} -- ${issues.length} issues\n`);
  for (const iss of issues) console.log(formatIssueLine(iss));
}

async function cmdShow(client, numOrId) {
  if (!numOrId) throw new Error('Usage: show <num-or-id-prefix>');
  const issue = await client.getIssue(numOrId);
  console.log(`#${issue.num} [${issue.id}]\n`);
  for (const colId in issue.fieldDefs) {
    const def = issue.fieldDefs[colId];
    const raw = issue.values[colId];
    const value = def.type === 'select' ? ((def.options || []).find(o => o.id === raw) || {}).label || raw : raw;
    console.log(`  ${(def.label || colId).padEnd(16)} ${value === undefined || value === null || value === '' ? '—' : value}`);
  }
  const activity = [
    ...issue.comments.map(c => ({ time: c.time, sortKey: c.sortKey, text: c.redacted ? '(redacted)' : `${c.author}: ${c.text}` })),
    ...issue.history.filter(h => h.origin !== 'legacy-backfill').map(h => ({ time: h.time, sortKey: h.sortKey, text: h.redacted ? '(redacted)' : h.text }))
  ].sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
  if (activity.length) {
    console.log('\nActivity:');
    for (const a of activity) console.log(`  ${a.time}  ${a.text}`);
  }
}

async function cmdAddIssue(client, title) {
  if (!title) throw new Error('Usage: add-issue "<title>"');
  const { syncStatus } = await client.addIssue(title);
  console.log('Added issue:', title);
  if (syncStatus) console.log('Sync status:', syncStatus);
}

async function cmdComment(client, numOrId, text) {
  if (!numOrId || !text) throw new Error('Usage: comment <num-or-id> "<text>"');
  const { num, syncStatus } = await client.comment(numOrId, text);
  console.log(`Commented on #${num}`);
  if (syncStatus) console.log('Sync status:', syncStatus);
}

async function cmdSetField(client, numOrId, fieldLabel, value) {
  if (!numOrId || !fieldLabel || value === undefined) throw new Error('Usage: set-field <num-or-id> "<field label>" <value>');
  const { num, syncStatus } = await client.setField(numOrId, fieldLabel, value);
  console.log(`Set "${fieldLabel}" on #${num} to "${value}"`);
  if (syncStatus) console.log('Sync status:', syncStatus);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const commands = {
    list: (client) => cmdList(client),
    show: (client) => cmdShow(client, args[0]),
    'add-issue': (client) => cmdAddIssue(client, args.join(' ')),
    comment: (client) => cmdComment(client, args[0], args.slice(1).join(' ')),
    'set-field': (client) => cmdSetField(client, args[0], args[1], args.slice(2).join(' ')),
  };
  if (!commands[cmd]) {
    console.log('Usage: node wigwag-agent.js <list|show|add-issue|comment|set-field> [args]');
    console.log('  list');
    console.log('  show <num-or-id-prefix>');
    console.log('  add-issue "<title>"');
    console.log('  comment <num-or-id-prefix> "<text>"');
    console.log('  set-field <num-or-id-prefix> "<field label>" <value>');
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  const client = await connect();
  try {
    await commands[cmd](client);
  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err.message || err); process.exitCode = 1; });
