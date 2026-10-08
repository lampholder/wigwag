#!/usr/bin/env node
// A standalone, local schema/sanity checker for a wigwag .jsonl export --
// run it BEFORE importing a file you're unsure of. Built directly on
// wigwag-core.js (no browser, no network), so "this file is fine" here
// means "this file is fine to actually import" -- it runs the exact same
// parse/derive pipeline wigwag.html itself uses, not a reimplemented,
// possibly-divergent check.
//
// Tracker #185 (live-reported, wigwag.work/app): a field definition with
// no .label crashed the WHOLE table's render once merged in -- there was
// (and still is) no schema validation on import itself, so a malformed
// or hand-edited file can silently carry a problem like this until it's
// actually merged in. This script exists to catch that kind of thing
// locally, without needing to hand over the file itself.
//
// Usage: node wigwag-validate.js <path-to-export.jsonl>
//
// Exits 0 with no problems (warnings don't affect exit code), 1 if any
// problem was found, 2 on a usage/read/crash error.

const fs = require('fs');
const core = require('./wigwag-core.js');

const KNOWN_FIELD_TYPES = ['text', 'issue', 'select', 'multiselect', 'date', 'timestamp', 'commentStream'];
const PROJECT_SENTINEL_FIELDS = ['__project_name__', '__project_notes__'];
// A real export's first line is a signed envelope (type:'wigwag.export')
// -- expected and fine, not a bug. parseJsonl itself already silently
// skips any line whose type isn't 'fields'/'issue' (confirmed: every
// real call site in wigwag.html passes it the FULL text, envelope line
// included), so this mirrors that exactly rather than stripping the
// envelope out first.
const WIGWAG_EXPORT_TYPE = core.WIGWAG_EXPORT_TYPE || 'wigwag.export';

// A field-definition VALUE object (whether from the "fields" snapshot or
// from a single projectHistory entry's own .value) gets the identical
// check either way -- the bug this exists for (tracker #185) can come
// from either source, since deriveFieldDefs rebuilds the live fieldDefs
// from projectHistory on every merge, not just from the snapshot.
function checkFieldDef(colId, def, where, problems, warnings) {
  if (!def || typeof def !== 'object') {
    problems.push(where + ': field "' + colId + '" has no definition object at all');
    return;
  }
  if (!def.label || typeof def.label !== 'string' || !def.label.trim()) {
    problems.push(where + ': field "' + colId + '" has no (or an empty) label -- ' +
      'this is exactly the bug that crashed the whole table\'s render once (tracker #185). Give it a real label before importing.');
  }
  if (!def.type || !KNOWN_FIELD_TYPES.includes(def.type)) {
    problems.push(where + ': field "' + colId + '" has an unrecognized type ' + JSON.stringify(def.type));
  }
  if (def.type === 'select' || def.type === 'multiselect') {
    if (!Array.isArray(def.options)) {
      problems.push(where + ': field "' + colId + '" is type ' + def.type + ' but has no options array');
    } else {
      const seenIds = new Set();
      def.options.forEach((o, oi) => {
        if (!o || typeof o !== 'object' || !o.id) {
          problems.push(where + ': field "' + colId + '" option #' + oi + ' has no id');
          return;
        }
        if (seenIds.has(o.id)) warnings.push(where + ': field "' + colId + '" has two options with id "' + o.id + '"');
        seenIds.add(o.id);
        if (!o.label) warnings.push(where + ': field "' + colId + '" option "' + o.id + '" has no label');
      });
    }
  }
}

function checkHistoryEntry(h, where, problems, warnings) {
  if (!h || typeof h !== 'object') { problems.push(where + ': not an object'); return; }
  if (h.sortKey == null) warnings.push(where + ': no sortKey (legacy-style entry -- fine only if that\'s intentional)');
  if (!h.field && h.text === undefined) warnings.push(where + ': neither field nor text -- an empty narrative entry');
}

// The whole check, pure data in / data out (no process.exit, no stdout)
// so it's directly unit-testable -- see wigwag-validate.test.js. Returns
// { problems, warnings, notes, stats }.
async function validateJsonl(text) {
  const problems = [];
  const warnings = [];
  const notes = [];

  // ---- Pass 1: raw line-by-line shape checks. Deliberately independent
  // of the real parser below -- catches a problem even if the real
  // parser's own "latest sortKey wins" derivation would currently paper
  // over it (e.g. a bad entry that happens not to be the winning one
  // today, but would become live the moment a newer entry for that field
  // is redacted or rolled back). ----
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let fieldsLineCount = 0;
  const issueIdCounts = new Map();

  rawLines.forEach((line, i) => {
    const lineNum = i + 1;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      problems.push('Line ' + lineNum + ': not valid JSON (' + e.message + ')');
      return;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      problems.push('Line ' + lineNum + ': not a JSON object');
      return;
    }

    if (obj.type === 'fields') {
      fieldsLineCount++;
      const where = 'Line ' + lineNum + ' (fields)';
      if (!obj.fields || typeof obj.fields !== 'object') {
        problems.push(where + ': no "fields" object at all');
      } else {
        for (const colId in obj.fields) checkFieldDef(colId, obj.fields[colId], where, problems, warnings);
      }
      if (obj.projectHistory !== undefined && !Array.isArray(obj.projectHistory)) {
        problems.push(where + ': projectHistory is present but not an array');
      } else {
        (obj.projectHistory || []).forEach((h, hi) => {
          const hwhere = where + ', projectHistory[' + hi + ']';
          checkHistoryEntry(h, hwhere, problems, warnings);
          if (h && h.field && h.value !== undefined && h.value !== null && !PROJECT_SENTINEL_FIELDS.includes(h.field) && h.field !== '__deleted__') {
            checkFieldDef(h.field, h.value, hwhere, problems, warnings);
          }
        });
      }
      if (obj.projectComments !== undefined && !Array.isArray(obj.projectComments)) {
        problems.push(where + ': projectComments is present but not an array');
      } else {
        (obj.projectComments || []).forEach((c, ci) => {
          const cwhere = where + ', projectComments[' + ci + ']';
          if (!c || typeof c !== 'object') { problems.push(cwhere + ': not an object'); return; }
          if (!c.text) warnings.push(cwhere + ': no text');
          if (!c.author) warnings.push(cwhere + ': no author');
          if (c.sortKey == null) warnings.push(cwhere + ': no sortKey');
        });
      }
    } else if (obj.type === 'issue') {
      const where = 'Line ' + lineNum + ' (issue ' + (obj.id || '?') + ')';
      if (!obj.id) problems.push(where + ': issue has no id');
      else issueIdCounts.set(obj.id, (issueIdCounts.get(obj.id) || 0) + 1);
      if (obj.history !== undefined && !Array.isArray(obj.history)) {
        problems.push(where + ': history is present but not an array');
      } else {
        (obj.history || []).forEach((h, hi) => checkHistoryEntry(h, where + ', history[' + hi + ']', problems, warnings));
      }
      if (obj.commentStreams && typeof obj.commentStreams === 'object') {
        for (const fieldId in obj.commentStreams) {
          const stream = obj.commentStreams[fieldId];
          if (!Array.isArray(stream)) { problems.push(where + ': commentStreams["' + fieldId + '"] is not an array'); continue; }
          stream.forEach((c, ci) => {
            const cwhere = where + ', commentStreams["' + fieldId + '"][' + ci + ']';
            if (!c || typeof c !== 'object') { problems.push(cwhere + ': not an object'); return; }
            if (!c.text) warnings.push(cwhere + ': no text');
          });
        }
      }
    } else if (obj.type === WIGWAG_EXPORT_TYPE && lineNum === 1) {
      // The signed export envelope -- checked separately below, not here.
    } else {
      warnings.push('Line ' + lineNum + ': unrecognized type ' + JSON.stringify(obj.type) + ' (ignored by the real app parser)');
    }
  });

  if (fieldsLineCount === 0) problems.push('No "fields" line found at all -- this is not a valid wigwag export.');
  if (fieldsLineCount > 1) warnings.push(fieldsLineCount + ' "fields" lines found -- only the last one is used, earlier ones are silently ignored.');
  for (const [id, count] of issueIdCounts) {
    if (count > 1) warnings.push('Issue id ' + id + ' appears ' + count + ' times -- only the last one survives parsing.');
  }

  // ---- Pass 2: the signed export envelope, if present -- same check
  // the app itself runs on ingest (classifyIngestProvenance), so a
  // tampered-with or hand-edited file (content changed after signing)
  // shows up here as damaged, not silently accepted. ----
  if (typeof core.parseExportEnvelope === 'function' && typeof core.verifyExportEnvelope === 'function') {
    const { envelope, recordsBody } = core.parseExportEnvelope(text);
    if (!envelope) {
      notes.push('No signed export envelope (a v0/legacy export, or hand-edited without resigning) -- nothing to verify provenance against.');
    } else {
      const { hashValid, sigValid } = await core.verifyExportEnvelope(envelope, recordsBody);
      if (!hashValid) {
        problems.push('The export envelope\'s content hash does NOT match the file\'s own records -- the file was edited after it was exported/signed (or truncated/corrupted in transit).');
      } else if (sigValid === false) {
        problems.push('The export envelope\'s signature does not verify against its own embedded public key -- treat this file as untrusted.');
      } else {
        notes.push('Export envelope OK: exported by ' + (envelope.exported_by || 'unknown') + ' at ' + (envelope.exported_at || 'unknown time') +
          (sigValid === true ? ', signature verified' : ', unsigned') + '.');
      }
    }
  }

  // ---- Pass 3: run the REAL parse/derive pipeline (parseJsonl ->
  // deriveFieldDefs, hydrateIssue), the exact code the app itself runs --
  // catches a problem only visible AFTER real "latest sortKey wins"
  // derivation, not just by eyeballing each raw entry in isolation. ----
  try {
    const parsed = core.parseJsonl(text, core.defaultFieldDefs());
    // parsed.fields is just the raw "fields" snapshot as-authored --
    // parseJsonl itself never re-derives it from projectHistory. A real
    // merge does, via deriveFieldDefs(mergedProjectHistory) -- so a bad
    // field hiding only in projectHistory (not yet reflected in the
    // snapshot) would sail through a check of parsed.fields alone and
    // only surface once actually merged in. Derive it here too, the same
    // way a real merge would, so this check predicts that outcome.
    const derivedFields = typeof core.deriveFieldDefs === 'function' && parsed.projectHistory
      ? core.deriveFieldDefs(parsed.projectHistory)
      : parsed.fields;
    if (derivedFields) {
      for (const colId in derivedFields) {
        const def = derivedFields[colId];
        if (!def.label || !String(def.label).trim()) {
          problems.push('After real derivation: field "' + colId + '" resolves to a definition with no label -- ' +
            'this is what the running app would actually use, regardless of what any single raw line looks like.');
        }
      }
    }
    for (const iss of (parsed.issues || [])) {
      try {
        core.hydrateIssue(iss, derivedFields || parsed.fields || {});
      } catch (e) {
        problems.push('Issue ' + (iss.id || '?') + ': crashed during real hydration (' + e.message + ')');
      }
    }
  } catch (e) {
    problems.push('The real parser itself crashed on this file: ' + e.message);
  }

  return { problems, warnings, notes, stats: { lineCount: rawLines.length, fieldsLineCount, issueCount: issueIdCounts.size } };
}

function report(result) {
  const { problems, warnings, notes, stats } = result;
  console.log('Checked ' + stats.lineCount + ' line(s): ' + stats.fieldsLineCount + ' fields line(s), ' + stats.issueCount + ' issue(s).\n');
  if (problems.length) {
    console.log('✗ ' + problems.length + ' problem(s) found:\n');
    problems.forEach(p => console.log('  - ' + p));
  } else {
    console.log('✓ No problems found.');
  }
  if (warnings.length) {
    console.log('\n' + warnings.length + ' warning(s) (probably fine, worth a glance):\n');
    warnings.forEach(w => console.log('  - ' + w));
  }
  if (notes.length) console.log('\n' + notes.join('\n'));
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node wigwag-validate.js <path-to-export.jsonl>');
    process.exitCode = 2;
    return;
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error('Could not read ' + file + ': ' + e.message);
    process.exitCode = 2;
    return;
  }
  const result = await validateJsonl(text);
  report(result);
  process.exitCode = result.problems.length ? 1 : 0;
}

if (require.main === module) {
  main().catch(e => {
    console.error('wigwag-validate.js crashed: ' + (e && e.stack || e));
    process.exitCode = 2;
  });
}

module.exports = { validateJsonl, report, main };
