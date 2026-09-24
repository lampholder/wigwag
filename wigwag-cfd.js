#!/usr/bin/env node
// Standalone cumulative flow diagram (CFD) generator, built directly on
// wigwag-core.js -- no changes to wigwag.html at all. Deliberately kept
// as its own throwaway tool rather than an app feature: a CFD is a
// once-in-a-while retrospective view, not something worth bloating the
// live editor with (per Tom's own call).
//
// Reads a wigwag .jsonl export -- use "Export as JSONL (full history)",
// NOT "squashed", since squashed keeps only each field's LATEST entry and
// destroys exactly the time-series data a CFD needs -- and reconstructs,
// for a chosen select field (e.g. Status), how many issues sat in each
// value on every day of the project's history, stacked and CUMULATIVE:
// each band's height is the count of issues that have reached that stage
// or later (by the field's own defined option order), so the classic CFD
// property holds -- the vertical gap between two band boundaries is WIP
// in that stage, and a widening gap over time signals a bottleneck. An
// issue with no value yet for the chosen field is simply not counted
// anywhere until it gets one -- there's no "(No value)" bucket -- so an
// untriaged backlog item (or one that's just never triaged at all) never
// shows up as noise in any band.
//
// Usage:
//   node wigwag-cfd.js <export.jsonl> --field "Status" [options]
//
// Options:
//   --field <label>         Required. Which field to build the CFD on.
//                            Works best for a select field (uses its
//                            options' own order as the workflow stages).
//                            Any other field type still produces a chart,
//                            but as a plain (non-cumulative) stacked count
//                            per distinct value, since there's no defined
//                            stage order to compute "reached or past" against.
//   --order "A,B,C"         Override the stage order (comma-separated
//                            option labels, earliest stage first) instead
//                            of trusting the field's own configured option
//                            order.
//   --exclude <id-prefix>   Repeatable. Drop an issue by id prefix (same
//                            #XXXXXXXX convention the app itself shows).
//   --exclude-where "Label=Value"
//                           Repeatable. Drop every issue whose CURRENT
//                            value for that field equals Value (case-
//                            insensitive) -- e.g. --exclude-where "Type=Chore".
//   --exclude-no-value      Drop every issue that STILL has no value for
//                            --field, even at the end of the range. An
//                            issue is already invisible in the chart for
//                            as long as it has no value (see below), so
//                            this only tidies up the reported issue count
//                            for one that never gets triaged at all.
//   --since YYYY-MM-DD      Override the chart's start date (default:
//                            earliest activity among the included issues).
//   --until YYYY-MM-DD      Override the chart's end date (default: latest
//                            activity anywhere in the file).
//   --out <name>            Base name for output files (default "cfd").
//                            Writes <name>.html (a self-contained chart,
//                            no network/build step, just open it) and
//                            <name>.csv (long format: date,bucket,count --
//                            the CURRENT-state count, not the cumulative
//                            band value, so it stays pivot-table-friendly
//                            for whatever else you want to do with it).
const fs = require('fs');
const core = require('./wigwag-core.js');

function usage() {
  console.log('Usage: node wigwag-cfd.js <export.jsonl> --field "<label>" [options]');
  console.log('  --order "A,B,C"                  override stage order (earliest first)');
  console.log('  --exclude <id-prefix>             repeatable, drop an issue by id prefix');
  console.log('  --exclude-where "Label=Value"      repeatable, drop issues by current field value');
  console.log('  --exclude-no-value                 drop issues with no current value for --field');
  console.log('  --since YYYY-MM-DD  --until YYYY-MM-DD');
  console.log('  --out <name>                       default "cfd" -> cfd.html + cfd.csv');
}

function parseArgs(argv) {
  const opts = { exclude: [], excludeWhere: [], out: 'cfd' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--field') opts.field = argv[++i];
    else if (a === '--order') opts.order = argv[++i];
    else if (a === '--exclude') opts.exclude.push(argv[++i]);
    else if (a === '--exclude-where') opts.excludeWhere.push(argv[++i]);
    else if (a === '--exclude-no-value') opts.excludeNoValue = true;
    else if (a === '--since') opts.since = argv[++i];
    else if (a === '--until') opts.until = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else positional.push(a);
  }
  opts.file = positional[0];
  return opts;
}

function findColIdByLabel(fieldDefs, label) {
  const target = label.trim().toLowerCase();
  return Object.keys(fieldDefs).find(colId => (fieldDefs[colId].label || '').toLowerCase() === target);
}

// Same algorithm as wigwag-core.js's own deriveIssueValues, but frozen at
// a point in time: only entries with sortKey <= cutoff are visible. This
// is deliberately the exact same "highest sortKey wins" rule the app uses
// for "current" value -- a CFD is just that same derivation re-run at
// many different cutoffs instead of once at "now".
function valueAsOf(issue, colId, cutoff) {
  let best = null;
  for (const h of (issue.history || [])) {
    if (h.field !== colId || h.value === undefined) continue;
    if (h.sortKey > cutoff) continue;
    if (!best || h.sortKey > best.sortKey) best = h;
  }
  return best ? best.value : null;
}

function issueCreatedAt(issue) {
  let min = Infinity;
  for (const h of (issue.history || [])) if (typeof h.sortKey === 'number' && h.sortKey < min) min = h.sortKey;
  return min === Infinity ? Date.now() : min;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function toUtcDayStart(ms) { return Math.floor(ms / DAY_MS) * DAY_MS; }
function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

const HEX_PALETTE = core.PALETTE_ORDER.map(name => '#' + core.XLSX_PALETTE_HEX[name].fg);

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.file || !opts.field) { usage(); process.exitCode = opts.help ? 0 : 1; return; }

  const text = fs.readFileSync(opts.file, 'utf8');
  const doc = core.parseJsonl(text);
  if (!doc.fields) { console.error('Could not find a "fields" line in ' + opts.file + ' -- is this a real wigwag export?'); process.exitCode = 1; return; }

  const colId = findColIdByLabel(doc.fields, opts.field);
  if (!colId) {
    console.error('No field labeled "' + opts.field + '". Fields in this file: ' + Object.values(doc.fields).map(f => f.label).join(', '));
    process.exitCode = 1;
    return;
  }
  const fieldDef = doc.fields[colId];
  const isSelect = fieldDef.type === 'select';
  if (!isSelect) {
    console.warn('Warning: "' + fieldDef.label + '" is a "' + fieldDef.type + '" field, not select -- there is no defined stage order to compute "reached or past" against, so this will be a plain (non-cumulative) stacked count per distinct value instead of a real CFD.');
  }

  // Resolve exclude-where's field labels once, up front, so a typo fails
  // fast instead of silently excluding nothing.
  const excludeWhere = opts.excludeWhere.map(spec => {
    const eq = spec.indexOf('=');
    if (eq === -1) { console.error('--exclude-where expects "Label=Value", got: ' + spec); process.exit(1); }
    const label = spec.slice(0, eq).trim(), value = spec.slice(eq + 1).trim();
    const excludeColId = findColIdByLabel(doc.fields, label);
    if (!excludeColId) { console.error('--exclude-where: no field labeled "' + label + '"'); process.exit(1); }
    return { colId: excludeColId, def: doc.fields[excludeColId], value };
  });

  function currentDisplayValue(issue, forColId, forDef) {
    const raw = issue.values[forColId];
    if (forDef.type === 'select') {
      const opt = (forDef.options || []).find(o => o.id === raw);
      return opt ? opt.label : (raw == null ? '' : String(raw));
    }
    if (forDef.type === 'multiselect') return (raw || []).map(id => { const o = (forDef.options || []).find(x => x.id === id); return o ? o.label : id; });
    return raw == null ? '' : String(raw);
  }

  let issues = doc.issues.filter(iss => !opts.exclude.some(prefix => iss.id.toLowerCase().startsWith(prefix.toLowerCase())));
  issues = issues.filter(iss => !excludeWhere.some(({ colId: ec, def, value }) => {
    const disp = currentDisplayValue(iss, ec, def);
    return Array.isArray(disp) ? disp.some(v => v.toLowerCase() === value.toLowerCase()) : String(disp).toLowerCase() === value.toLowerCase();
  }));
  if (opts.excludeNoValue) issues = issues.filter(iss => currentDisplayValue(iss, colId, fieldDef) !== '');
  if (!issues.length) { console.error('No issues left after exclusions -- nothing to chart.'); process.exitCode = 1; return; }

  // Stage order: explicit --order wins; otherwise the field's own
  // configured option order (matches the pill order shown in the app),
  // which is the best available signal for "earliest to latest workflow
  // stage" without asking the user to specify it separately every time.
  let stageLabels;
  if (opts.order) stageLabels = opts.order.split(',').map(s => s.trim()).filter(Boolean);
  else if (isSelect) stageLabels = (fieldDef.options || []).map(o => o.label);
  else {
    const seen = new Set();
    for (const iss of issues) for (const h of (iss.history || [])) {
      if (h.field === colId && h.value != null) seen.add(String(h.value));
    }
    stageLabels = [...seen];
  }
  const optionIdToLabel = {};
  if (isSelect) for (const o of (fieldDef.options || [])) optionIdToLabel[o.id] = o.label;
  function labelForRawValue(raw) {
    if (raw == null) return null;
    return isSelect ? (optionIdToLabel[raw] || String(raw)) : String(raw);
  }
  const stageIndex = {};
  stageLabels.forEach((label, i) => { stageIndex[label] = i; });

  if (isSelect || opts.order) {
    console.log('Stage order (earliest to latest): ' + stageLabels.join(' -> '));
    console.log('(pass --order "A,B,C" to override if this isn\'t your real workflow order)');
  }

  // Sanity check: count each issue's own consecutive transitions for this
  // field and see how many go "backward" against the assumed order (a
  // reopened/regressed issue) versus "forward". A few backward moves are
  // normal (see the reopen case in the module's own test fixture); a LOT
  // of them is a real signal the assumed order doesn't match the actual
  // workflow, not just occasional regressions -- flag it rather than
  // silently drawing a chart that won't look like a sensible CFD.
  if (stageLabels.length > 1) {
    let forward = 0, backward = 0;
    for (const iss of issues) {
      const entries = (iss.history || [])
        .filter(h => h.field === colId && h.value != null)
        .sort((a, b) => a.sortKey - b.sortKey);
      for (let i = 1; i < entries.length; i++) {
        const fromLabel = labelForRawValue(entries[i - 1].value);
        const toLabel = labelForRawValue(entries[i].value);
        if (!(fromLabel in stageIndex) || !(toLabel in stageIndex)) continue;
        const diff = stageIndex[toLabel] - stageIndex[fromLabel];
        if (diff > 0) forward++;
        else if (diff < 0) backward++;
      }
    }
    const total = forward + backward;
    if (total >= 4 && backward / total > 0.3) {
      console.warn('Warning: ' + backward + ' of ' + total + ' observed transitions (' + Math.round(100 * backward / total) + '%) go BACKWARD against this stage order -- that\'s a lot more than the occasional reopen, and usually means the assumed order above doesn\'t match your real workflow. Try --order to fix it.');
    }
  }

  const createdAt = new Map(issues.map(iss => [iss.id, issueCreatedAt(iss)]));
  const startMs = opts.since ? Date.parse(opts.since + 'T00:00:00.000Z') : Math.min(...issues.map(iss => createdAt.get(iss.id)));
  const endMs = opts.until ? Date.parse(opts.until + 'T23:59:59.999Z') : Math.max(...doc.issues.flatMap(iss => (iss.history || []).map(h => h.sortKey || 0)));
  if (!(startMs <= endMs)) { console.error('Empty or invalid date range (--since must be on or before --until).'); process.exitCode = 1; return; }
  if (endMs < Date.parse('2000-01-01T00:00:00Z')) {
    console.warn('Warning: sortKey values in this file look far too small to be real timestamps (this can happen with hand-authored/test fixtures) -- the chart below will not reflect real calendar dates.');
  }

  const days = [];
  for (let d = toUtcDayStart(startMs); d <= endMs; d += DAY_MS) days.push(d);
  if (!days.length) days.push(toUtcDayStart(endMs));

  // csvRows: plain current-state counts per (date, bucket) -- easy to
  // pivot into whatever shape you want elsewhere. bandSeries: the
  // cumulative "reached this stage or later" counts the chart itself
  // draws, per the module comment above.
  //
  // An issue with no value for this field as of a given day (never
  // touched yet, or --exclude-no-value wouldn't have dropped it if it
  // stays that way forever) is simply not counted anywhere that day --
  // no "(No value)" bucket. It starts appearing, in whatever real bucket
  // applies, the day it first gets a value, same as issueCreatedAt would
  // suggest it should for THIS field specifically (which may well be
  // later than the issue's own creation date -- an untriaged backlog
  // item genuinely isn't part of the workflow yet).
  const csvRows = [['date', 'bucket', 'count']];
  const bandSeries = stageLabels.map(() => []); // bandSeries[i][dayIdx] = cumulative count at stage i

  for (const dayStart of days) {
    const cutoff = dayStart + DAY_MS - 1;
    const counts = {}; // label -> current-state count, for the CSV
    const cumulativeAtLeast = stageLabels.map(() => 0);
    for (const iss of issues) {
      const raw = valueAsOf(iss, colId, cutoff);
      const label = labelForRawValue(raw);
      if (label == null || !(label in stageIndex)) continue; // no value yet as of this day -- invisible until it has one
      counts[label] = (counts[label] || 0) + 1;
      const idx = stageIndex[label];
      for (let i = 0; i <= idx; i++) cumulativeAtLeast[i]++;
    }
    stageLabels.forEach((label, i) => bandSeries[i].push(cumulativeAtLeast[i]));
    const dateStr = isoDate(dayStart);
    for (const label of stageLabels) csvRows.push([dateStr, label, String(counts[label] || 0)]);
  }

  // Band thickness: stage i's own band = issues that have reached stage i
  // but not yet stage i+1 (its own WIP).
  //
  // Stacking is bottom-to-top DONE-first (latest stage at the bottom) --
  // per Tom's own call: the finished/terminal band anchors the chart as a
  // stable, monotonically-growing floor, with the more volatile earlier-
  // stage WIP flowing above it. This is purely a draw-order flip: the
  // underlying stage order used for the cumulative math and the backward-
  // transition sanity check above is unchanged (still earliest-to-latest),
  // and the CSV's per-day counts are unaffected either way.
  const thickness = stageLabels.map((_, i) => {
    const next = i + 1 < stageLabels.length ? bandSeries[i + 1] : days.map(() => 0);
    return bandSeries[i].map((v, di) => v - next[di]);
  }).reverse();
  const bandLabels = [...stageLabels].reverse();
  const bandColors = stageLabels.map((_, i) => HEX_PALETTE[i % HEX_PALETTE.length]).reverse();

  const csvPath = opts.out + '.csv';
  fs.writeFileSync(csvPath, csvRows.map(r => r.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',')).join('\n') + '\n');

  const htmlPath = opts.out + '.html';
  fs.writeFileSync(htmlPath, renderHtml({
    title: (doc.projectName || 'wigwag') + ' -- ' + fieldDef.label + ' CFD',
    days, bandLabels, bandColors, thickness,
    isCumulative: isSelect,
    issueCount: issues.length,
    fieldLabel: fieldDef.label
  }));

  console.log('Wrote ' + csvPath + ' and ' + htmlPath + ' (' + days.length + ' days, ' + issues.length + ' issues).');
}

function renderHtml({ title, days, bandLabels, bandColors, thickness, isCumulative, issueCount, fieldLabel }) {
  const W = 960, H = 480, padL = 50, padR = 20, padT = 20, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = days.length;
  const totals = days.map((_, di) => thickness.reduce((s, series) => s + series[di], 0));
  const maxTotal = Math.max(1, ...totals);
  const x = i => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = v => padT + plotH - (v / maxTotal) * plotH;

  let cum = days.map(() => 0);
  const paths = bandLabels.map((label, bi) => {
    const series = thickness[bi];
    const top = series.map((v, di) => cum[di] + v);
    const bottom = cum.slice();
    cum = top;
    const topPts = top.map((v, di) => [x(di), y(v)]);
    const botPts = bottom.map((v, di) => [x(di), y(v)]).reverse();
    const d = 'M ' + [...topPts, ...botPts].map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L ') + ' Z';
    return { label, color: bandColors[bi], d };
  });

  const yTicks = 5;
  const gridlines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.round((maxTotal / yTicks) * i);
    return { y: y(v), v };
  });
  const xTickEvery = Math.max(1, Math.ceil(n / 8));
  const xTicks = days.map((d, i) => ({ x: x(i), label: new Date(d).toISOString().slice(0, 10) })).filter((_, i) => i % xTickEvery === 0 || i === n - 1);

  const legend = paths.map(p =>
    '<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;">' +
    '<span style="width:12px;height:12px;border-radius:2px;background:' + p.color + ';display:inline-block;"></span>' +
    escapeHtml(p.label) + '</span>'
  ).join('');

  const areas = paths.map(p => '<path d="' + p.d + '" fill="' + p.color + '" stroke="white" stroke-width="0.5"></path>').join('\n');
  const gridSvg = gridlines.map(g =>
    '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + g.y.toFixed(1) + '" y2="' + g.y.toFixed(1) + '" stroke="#e5e7eb" stroke-width="1"></line>' +
    '<text x="' + (padL - 8) + '" y="' + (g.y + 4).toFixed(1) + '" font-size="11" fill="#6b7280" text-anchor="end">' + g.v + '</text>'
  ).join('\n');
  const xAxisSvg = xTicks.map(t =>
    '<text x="' + t.x.toFixed(1) + '" y="' + (H - padB + 16) + '" font-size="11" fill="#6b7280" text-anchor="middle">' + t.label + '</text>'
  ).join('\n');

  const note = isCumulative
    ? 'Each band is cumulative -- its height is every issue that has reached that stage or later, so a widening band signals a growing bottleneck.'
    : 'Non-select field: plain current-state counts per value, not a cumulative stage chart (no defined stage order to compute "reached or past" against).';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; margin: 24px; color: #1f2328; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .sub { font-size: 12.5px; color: #6b7280; margin-bottom: 16px; }
  .legend { font-size: 12.5px; margin-top: 10px; }
  svg { max-width: 100%; height: auto; }
</style>
</head><body>
<h1>${escapeHtml(title)}</h1>
<div class="sub">${issueCount} issues &middot; ${escapeHtml(fieldLabel)} &middot; ${note}</div>
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  ${gridSvg}
  ${areas}
  ${xAxisSvg}
</svg>
<div class="legend">${legend}</div>
</body></html>`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

main();
