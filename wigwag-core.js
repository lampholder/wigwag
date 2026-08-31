// wigwag's shared, environment-agnostic state/data core -- Phase 1 of the
// wigwag-core extraction (see /home/dev/.claude/plans/vast-cuddling-pnueli.md
// for the full design). This is the pure data-transformation logic wigwag.html
// and a future CLI both need to produce IDENTICAL results from: history-to-
// value derivation, project/issue hydration and migration, the rule-
// compilation engine, signable/redacted payload serialization, GitHub/Jira/
// Salesforce field pickers, markdown rendering, and the .xlsx export builder.
//
// Every line below this comment is moved VERBATIM out of wigwag.html's own
// bundled app source (the module-level code preceding `class Component
// extends DCLogic` -- see docs/EDITING.md for why that file can't be read/
// edited directly). Zero logic changes; this is a relocation, not a rewrite.
// wigwag.html bakes this same source back into itself (see the plan doc) so
// both environments run the exact same code, not a hand-synced copy.
//
// Dependencies: plain JS plus `crypto.subtle`/`crypto.randomUUID`,
// `CompressionStream` (native since Node 18), and `btoa`/`atob` (native
// since Node 16) -- all present in both a modern browser and Node ≥18 with
// zero polyfilling. No `document`/`window`/`this` anywhere in this file.


const COLORS = {
  red: { bg: 'var(--c26)', fg: 'var(--c27)', dot: 'var(--c28)' },
  amber: { bg: 'var(--c29)', fg: 'var(--c30)', dot: 'var(--c31)' },
  green: { bg: 'var(--c32)', fg: 'var(--c33)', dot: 'var(--c34)' },
  blue: { bg: 'var(--c20)', fg: 'var(--c3)', dot: 'var(--accent-fill)' },
  teal: { bg: 'var(--c35)', fg: 'var(--c36)', dot: 'var(--c37)' },
  pink: { bg: 'var(--c38)', fg: 'var(--c39)', dot: 'var(--c40)' },
  purple: { bg: 'var(--c41)', fg: 'var(--c42)', dot: 'var(--c43)' },
  gray: { bg: 'var(--surface-selected)', fg: 'var(--n59)', dot: 'var(--n39)' }
};
const PALETTE_ORDER = ['red', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];

// --- .xlsx export: hand-rolled OOXML + ZIP, no external library --------
// Real dropdowns (data validation) for single-select fields, real
// hyperlinks for linked fields, cell colors matching each option's
// configured color, and real date types -- richer than CSV can carry,
// and opens cleanly in both Excel and Google Sheets. The ZIP container
// uses the browser's own native CompressionStream('deflate-raw') for
// compression, so no bundled deflate/zip library is needed to keep this
// a self-contained single file.
function xlsxCrc32(bytes) {
  const table = xlsxCrc32.table || (xlsxCrc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
async function xlsxDeflateRaw(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
function xlsxU16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
function xlsxU32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
// Fixed mod-date/time per entry -- correctness doesn't depend on it, and
// a fixed value keeps output reproducible.
const XLSX_DOS_TIME = 0, XLSX_DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
async function xlsxBuildZip(entries) {
  const enc = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBytes = enc.encode(name);
    const dataBytes = enc.encode(content);
    const crc = xlsxCrc32(dataBytes);
    const compressed = await xlsxDeflateRaw(dataBytes);
    const localHeader = new Uint8Array([
      ...xlsxU32(0x04034b50), ...xlsxU16(20), ...xlsxU16(0x0800), ...xlsxU16(8),
      ...xlsxU16(XLSX_DOS_TIME), ...xlsxU16(XLSX_DOS_DATE), ...xlsxU32(crc),
      ...xlsxU32(compressed.length), ...xlsxU32(dataBytes.length),
      ...xlsxU16(nameBytes.length), ...xlsxU16(0)
    ]);
    localParts.push(localHeader, nameBytes, compressed);
    const localEntrySize = localHeader.length + nameBytes.length + compressed.length;
    const centralHeader = new Uint8Array([
      ...xlsxU32(0x02014b50), ...xlsxU16(20), ...xlsxU16(20), ...xlsxU16(0x0800), ...xlsxU16(8),
      ...xlsxU16(XLSX_DOS_TIME), ...xlsxU16(XLSX_DOS_DATE), ...xlsxU32(crc),
      ...xlsxU32(compressed.length), ...xlsxU32(dataBytes.length),
      ...xlsxU16(nameBytes.length), ...xlsxU16(0), ...xlsxU16(0), ...xlsxU16(0), ...xlsxU16(0),
      ...xlsxU32(0), ...xlsxU32(offset)
    ]);
    centralParts.push(centralHeader, nameBytes);
    offset += localEntrySize;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const p of centralParts) centralSize += p.length;
  const eocd = new Uint8Array([
    ...xlsxU32(0x06054b50), ...xlsxU16(0), ...xlsxU16(0),
    ...xlsxU16(entries.length), ...xlsxU16(entries.length),
    ...xlsxU32(centralSize), ...xlsxU32(centralStart), ...xlsxU16(0)
  ]);
  const allParts = [...localParts, ...centralParts, eocd];
  const total = allParts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of allParts) { out.set(p, pos); pos += p.length; }
  return out;
}
function xlsxEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function xlsxColLetter(n) {
  let s = '';
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// Excel/Sheets serial date: days since 1899-12-30 (the historical
// "1900 is a leap year" bug baked into the format).
function xlsxDateSerial(isoDateStr) {
  const d = new Date(isoDateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((d.getTime() - epoch) / 86400000);
}
// Hex equivalents of this app's own option-color tokens (converted from
// the same oklch values as the live :root theme) -- fixed, light values
// independent of dark mode, since an exported spreadsheet should read
// the same regardless of which theme the app happened to be in.
const XLSX_PALETTE_HEX = {
  red: { bg: 'FFE3DF', fg: '90101A' }, amber: { bg: 'FCEDCD', fg: '7E4B00' },
  green: { bg: 'D5F5DA', fg: '0B5D2A' }, teal: { bg: 'D1F3F2', fg: '005E60' },
  blue: { bg: 'D9EFFD', fg: '005589' }, purple: { bg: 'EFE6FF', fg: '603B93' },
  pink: { bg: 'FFE2EE', fg: '8A2B60' }, gray: { bg: 'ECEFF1', fg: '4B4D50' }
};
function xlsxFieldHref(ref) {
  if (!ref) return null;
  if ((ref.system || 'github') === 'jira') return ref.browseUrl || null;
  return 'https://github.com/' + ref.owner + '/' + ref.repo + '/issues/' + ref.num;
}
function xlsxBuildStyles() {
  const fonts = [
    { sz: 11 }, { sz: 11, bold: true }, { sz: 11, color: '1155CC', underline: true }
  ];
  const fills = [null, null];
  const colorFontIdx = {}, colorFillIdx = {};
  for (const name of PALETTE_ORDER) {
    colorFillIdx[name] = fills.length; fills.push(XLSX_PALETTE_HEX[name].bg);
    colorFontIdx[name] = fonts.length; fonts.push({ sz: 11, color: XLSX_PALETTE_HEX[name].fg });
  }
  const numFmts = [{ id: 164, code: 'yyyy\\-mm\\-dd' }];
  const cellXfs = [
    { fontId: 0, fillId: 0, numFmtId: 0 }, { fontId: 1, fillId: 0, numFmtId: 0 },
    { fontId: 0, fillId: 0, numFmtId: 164 }, { fontId: 2, fillId: 0, numFmtId: 0 }
  ];
  const colorXfIdx = {};
  for (const name of PALETTE_ORDER) { colorXfIdx[name] = cellXfs.length; cellXfs.push({ fontId: colorFontIdx[name], fillId: colorFillIdx[name], numFmtId: 0 }); }
  return { fonts, fills, numFmts, cellXfs, colorXfIdx, XF_DEFAULT: 0, XF_HEADER: 1, XF_DATE: 2, XF_HYPERLINK: 3 };
}
function xlsxStylesXml(styles) {
  const fontXml = styles.fonts.map(f => {
    let s = '<font><sz val="' + f.sz + '"/>';
    if (f.bold) s += '<b/>';
    if (f.underline) s += '<u/>';
    if (f.color) s += '<color rgb="FF' + f.color + '"/>';
    s += '<name val="Calibri"/></font>';
    return s;
  }).join('');
  const fillXml = styles.fills.map((bg, i) => {
    if (i === 0) return '<fill><patternFill patternType="none"/></fill>';
    if (i === 1) return '<fill><patternFill patternType="gray125"/></fill>';
    return '<fill><patternFill patternType="solid"><fgColor rgb="FF' + bg + '"/><bgColor indexed="64"/></patternFill></fill>';
  }).join('');
  const numFmtXml = styles.numFmts.map(f => '<numFmt numFmtId="' + f.id + '" formatCode="' + f.code + '"/>').join('');
  const xfXml = styles.cellXfs.map(xf => {
    const applyFill = xf.fillId > 1 ? ' applyFill="1"' : '';
    const applyFont = xf.fontId > 0 ? ' applyFont="1"' : '';
    const applyNumFmt = xf.numFmtId > 0 ? ' applyNumberFormat="1"' : '';
    return '<xf numFmtId="' + xf.numFmtId + '" fontId="' + xf.fontId + '" fillId="' + xf.fillId + '" borderId="0" xfId="0"' + applyFont + applyFill + applyNumFmt + '/>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="' + styles.numFmts.length + '">' + numFmtXml + '</numFmts>' +
    '<fonts count="' + styles.fonts.length + '">' + fontXml + '</fonts>' +
    '<fills count="' + styles.fills.length + '">' + fillXml + '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + styles.cellXfs.length + '">' + xfXml + '</cellXfs></styleSheet>';
}
async function buildXlsxWorkbook({ sheetName, colIds, fieldDefs, issues }) {
  const styles = xlsxBuildStyles();
  const safeSheetName = (sheetName || 'Sheet1').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet1';
  const rels = [];
  let relCounter = 1;
  const rows = [];
  const nCols = colIds.length;
  const nRows = issues.length + 1;
  {
    const cells = colIds.map((id, i) => {
      const label = (fieldDefs[id] && fieldDefs[id].label) || id;
      return '<c r="' + xlsxColLetter(i + 1) + '1" t="inlineStr" s="' + styles.XF_HEADER + '"><is><t xml:space="preserve">' + xlsxEscape(label) + '</t></is></c>';
    }).join('');
    rows.push('<row r="1">' + cells + '</row>');
  }
  const dataValidations = [];
  colIds.forEach((id, i) => {
    const def = fieldDefs[id];
    if (!def || def.type !== 'select' || !def.options || !def.options.length) return;
    const joined = def.options.map(o => o.label).join(',');
    if (joined.includes('"') || joined.length > 250) return;
    const col = xlsxColLetter(i + 1);
    dataValidations.push('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="' + col + '2:' + col + nRows + '"><formula1>&quot;' + xlsxEscape(joined) + '&quot;</formula1></dataValidation>');
  });
  const hyperlinksAll = [];
  issues.forEach((issue, rowIdx) => {
    const r = rowIdx + 2;
    const cells = colIds.map((id, i) => {
      const def = fieldDefs[id];
      const cellRef = xlsxColLetter(i + 1) + r;
      const ref = issue.fieldRefs && issue.fieldRefs[id];
      const raw = issue.values ? issue.values[id] : undefined;
      if (def && def.type === 'select') {
        const opt = (def.options || []).find(o => o.id === raw);
        const label = opt ? opt.label : (raw == null ? '' : String(raw));
        if (!label) return '';
        const xf = (opt && styles.colorXfIdx[opt.color]) || styles.XF_DEFAULT;
        return '<c r="' + cellRef + '" t="inlineStr" s="' + xf + '"><is><t xml:space="preserve">' + xlsxEscape(label) + '</t></is></c>';
      }
      if (def && def.type === 'multiselect') {
        const ids = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const label = ids.map(oid => { const o = (def.options || []).find(x => x.id === oid); return o ? o.label : oid; }).join('; ');
        if (!label) return '';
        return '<c r="' + cellRef + '" t="inlineStr" s="' + styles.XF_DEFAULT + '"><is><t xml:space="preserve">' + xlsxEscape(label) + '</t></is></c>';
      }
      if (def && def.type === 'date') {
        if (!raw) return '';
        const serial = xlsxDateSerial(raw);
        if (serial == null) return '<c r="' + cellRef + '" t="inlineStr" s="' + styles.XF_DEFAULT + '"><is><t xml:space="preserve">' + xlsxEscape(raw) + '</t></is></c>';
        return '<c r="' + cellRef + '" s="' + styles.XF_DATE + '"><v>' + serial + '</v></c>';
      }
      const text = raw == null ? '' : String(raw);
      const href = xlsxFieldHref(ref);
      if (href) {
        const relId = 'rId' + (relCounter++);
        rels.push({ id: relId, target: href });
        hyperlinksAll.push({ ref: cellRef, relId });
        return '<c r="' + cellRef + '" t="inlineStr" s="' + styles.XF_HYPERLINK + '"><is><t xml:space="preserve">' + xlsxEscape(text) + '</t></is></c>';
      }
      if (!text) return '';
      return '<c r="' + cellRef + '" t="inlineStr" s="' + styles.XF_DEFAULT + '"><is><t xml:space="preserve">' + xlsxEscape(text) + '</t></is></c>';
    });
    rows.push('<row r="' + r + '">' + cells.join('') + '</row>');
  });
  const hyperlinksXml = hyperlinksAll.length ? '<hyperlinks>' + hyperlinksAll.map(h => '<hyperlink ref="' + h.ref + '" r:id="' + h.relId + '"/>').join('') + '</hyperlinks>' : '';
  const dimEnd = xlsxColLetter(nCols) + nRows;
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="A1:' + dimEnd + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols><col min="1" max="' + nCols + '" width="26" customWidth="1"/></cols>' +
    '<sheetData>' + rows.join('') + '</sheetData>' +
    '<autoFilter ref="A1:' + dimEnd + '"/>' +
    (dataValidations.length ? '<dataValidations count="' + dataValidations.length + '">' + dataValidations.join('') + '</dataValidations>' : '') +
    hyperlinksXml + '</worksheet>';
  const relsXml = rels.length
    ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.map(rr => '<Relationship Id="' + rr.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xlsxEscape(rr.target) + '" TargetMode="External"/>').join('') + '</Relationships>'
    : null;
  const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  const rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="' + xlsxEscape(safeSheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const workbookRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const entries = [
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: xlsxStylesXml(styles) },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ];
  if (relsXml) entries.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', content: relsXml });
  return xlsxBuildZip(entries);
}

// Starter field schema for a brand-new blank project -- lifted from
// example.jsonl (see docs/EDITING.md for how it's regenerated).
function blankProjectFieldDefs() { return {"title":{"label":"Issue","type":"issue"},"f_1787164202568":{"label":"Priority","type":"select","options":[{"id":"opt_1787164226963","label":"Urgent","color":"purple","emoji":""},{"id":"opt_1787164229357","label":"High","color":"red","emoji":""},{"id":"opt_1787164233013","label":"Medium","color":"amber","emoji":""},{"id":"opt_1787164235630","label":"Low","color":"green","emoji":""}]},"f_1787164210795":{"label":"Remedy","type":"issue"},"f_1787164327071":{"label":"RAG","type":"select","options":[{"id":"opt_1787164345232","label":"🔴","color":"red","emoji":""},{"id":"opt_1787164350517","label":"🟡","color":"amber","emoji":""},{"id":"opt_1787164355074","label":"🟢","color":"green","emoji":""}]},"f_1787164381749":{"label":"Status","type":"select","options":[{"id":"opt_1787164390598","label":"Todo","color":"amber","emoji":""},{"id":"opt_1787164393422","label":"In Progress","color":"blue","emoji":""},{"id":"opt_1787164396972","label":"Blocked","color":"red","emoji":""},{"id":"opt_1787164398993","label":"Done","color":"green","emoji":""}]}}; }
const WIDTHS = { type: 150, priority: 118, linked: 190, rag: 150, teams: 200, mitigation: 190 };
function defaultFieldDefs() {
  return {
    title: { label: 'Issue', type: 'issue' },
    linked: { label: 'Related', type: 'issue' },
    type: { label: 'Type', type: 'select', linkedSourceId: 'title', rule: 'source.github && source.github.labels.includes("bug") ? "bug" : "enhancement"', options: [
      { id: 'bug', label: 'Bug', color: 'red', emoji: '' },
      { id: 'enhancement', label: 'Enhancement', color: 'blue', emoji: '' },
      { id: 'chore', label: 'Chore', color: 'gray', emoji: '' }
    ] },
    priority: { label: 'Priority', type: 'select', options: [
      { id: 'p0', label: 'P0', color: 'red', emoji: '' },
      { id: 'p1', label: 'P1', color: 'amber', emoji: '' },
      { id: 'p2', label: 'P2', color: 'gray', emoji: '' }
    ] },
    rag: { label: 'RAG', type: 'select', options: [
      { id: 'green', label: 'On track', color: 'green', emoji: '🟢' },
      { id: 'amber', label: 'At risk', color: 'amber', emoji: '🟡' },
      { id: 'red', label: 'Off track', color: 'red', emoji: '🔴' }
    ] },
    teams: { label: 'Delivery teams', type: 'multiselect', options: [
      { id: 'platform', label: 'Platform', color: 'blue' }, { id: 'ops', label: 'Ops', color: 'teal' }, { id: 'mobile', label: 'Mobile', color: 'purple' },
      { id: 'web', label: 'Web', color: 'pink' }, { id: 'infra', label: 'Infra', color: 'gray' }
    ] },
    mitigation: { label: 'Mitigation', type: 'text' }
  };
}
function defaultColumnOrder() { return ['type', 'priority', 'linked', 'rag', 'teams', 'mitigation']; }
function canonicalColumnOrder(fieldDefs, hiddenFieldIds) {
  const visible = Object.keys(fieldDefs).filter(id => id !== 'title' && !hiddenFieldIds.includes(id));
  const known = defaultColumnOrder().filter(id => visible.includes(id));
  const rest = visible.filter(id => !known.includes(id));
  return [...known, ...rest];
}
function reconcileColumnOrder(override, fieldDefs, hiddenFieldIds) {
  const visible = Object.keys(fieldDefs).filter(id => id !== 'title' && !hiddenFieldIds.includes(id));
  const fromOverride = (override || []).filter(id => visible.includes(id));
  const missing = visible.filter(id => !fromOverride.includes(id));
  if (!missing.length) return fromOverride;
  const canonicalRest = canonicalColumnOrder(fieldDefs, hiddenFieldIds).filter(id => missing.includes(id));
  return [...fromOverride, ...canonicalRest];
}
const FORMAT_VERSION = 1;
const STORAGE_KEY = 'git_native_tracker_v1';
// Secrets (GitHub token, Jira proxy URL) live under a deliberately separate
// key — never read by persist()/loadPersisted() (the tracker's own,
// exportable state) or buildSourceText() (export / "View source"), so a
// token can never end up in a JSONL export or a git commit.
const SECRETS_KEY = 'git_native_tracker_secrets_v1';
const PROJECTS_KEY = 'git_native_tracker_milestones_v1';
const SESSION_PROJECT_KEY = 'git_native_tracker_session_project_v1';
const IDENTITIES_KEY = 'git_native_tracker_identities_v1';
// Column widths: cosmetic-only, per-browser -- deliberately never read by
// persist()/loadPersisted() or buildSourceText(), same reasoning as
// SECRETS_KEY above. { [projectId]: { [colId]: px } }.
const COLUMN_WIDTHS_KEY = 'git_native_tracker_col_widths_v1';
// Wrap-vs-truncate per text/issue-type column (including the title, under
// the key 'title'): cosmetic-only, per-browser, per-project -- same
// reasoning as COLUMN_WIDTHS_KEY above. { [projectId]: { [colId]: boolean } }.
const WRAP_KEY = 'git_native_tracker_wrap_v1';
// Column order: cosmetic-only, per-browser, per-project -- same
// reasoning as COLUMN_WIDTHS_KEY. { [projectId]: [colId, ...] }. Absent
// (not just empty) means "no override saved yet, use canonical order" --
// see reconcileColumnOrder().
const COLUMN_ORDER_KEY = 'git_native_tracker_col_order_v1';
// Column value filters: cosmetic-only, per-browser, per-project -- same
// reasoning again. { [projectId]: { [colId]: [optionId, ...] } }.
const COLUMN_FILTERS_KEY = 'git_native_tracker_col_filters_v1';
// A synthetic filter-option id meaning "this field has no value" -- lives
// in the same columnFilters[colId] array as real option ids, so
// toggleColumnFilterValue/the checkbox markup need no special-casing at
// all, only the matching predicate below does.
const UNSET_FILTER_VALUE = '__unset__';
function issueValueMatchesFilter(value, filterDef, selected) {
  if (filterDef.type === 'multiselect') {
    const arr = Array.isArray(value) ? value : [];
    if (selected.includes(UNSET_FILTER_VALUE) && arr.length === 0) return true;
    return arr.some(x => selected.includes(x));
  }
  if (selected.includes(UNSET_FILTER_VALUE) && (value == null || value === '')) return true;
  return selected.includes(value);
}
// Column filters are "sticky": this snapshot of hidden issue ids is only
// ever recomputed at the moment a filter's own criteria change (see the
// call sites below) -- never on a plain edit or a new row, so neither
// makes a row jump out from under you. Excluded ids, not included ids, so
// a brand-new issue (however it arrives -- typed, merged, imported) is
// visible by construction, with nothing to special-case at its own
// creation site.
function computeColumnFilterExcludedIds(columnFilters, issues, fieldDefs) {
  const activeCols = Object.keys(columnFilters).filter(colId => columnFilters[colId] && columnFilters[colId].length && fieldDefs[colId]);
  if (!activeCols.length) return [];
  return issues
    .filter(iss => !activeCols.every(colId => issueValueMatchesFilter(iss.values[colId], fieldDefs[colId], columnFilters[colId])))
    .map(iss => iss.id);
}
const COMMENT_READS_KEY = 'git_native_tracker_comment_reads_v1';
// Sort (ascending/descending): cosmetic-only, per-browser, per-project --
// same reasoning again. { [projectId]: { colId, dir } }.
const SORT_KEY = 'git_native_tracker_sort_v1';
// Project ids already ingested from an embedded "Export as HTML" snapshot
// -- an id only gets seeded-and-switched-to once, on the recipient's first
// ever open of that particular exported file, never again on later opens.
const SNAPSHOT_INGESTED_KEY = 'git_native_tracker_snapshot_ingested_v1';

function truncate(s, n) { if (!s) return s; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function splitHighlightSegments(text, query) {
  const q = (query || '').trim();
  if (!q || !text) return [{ text: text || '', isMatch: false, notMatch: true }];
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const segments = [];
  let i = 0;
  while (i < text.length) {
    const idx = lowerText.indexOf(lowerQ, i);
    if (idx === -1) { segments.push({ text: text.slice(i), isMatch: false, notMatch: true }); break; }
    if (idx > i) segments.push({ text: text.slice(i, idx), isMatch: false, notMatch: true });
    segments.push({ text: text.slice(idx, idx + q.length), isMatch: true, notMatch: false });
    i = idx + q.length;
  }
  if (!segments.length) segments.push({ text, isMatch: false, notMatch: true });
  return segments;
}

function relativeAge(ms) {
  if (!ms) return '';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}
function formatNow() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/i;
// First 3 chars of any Salesforce Id reliably identify a standard object
// (custom objects get an org-assigned prefix with no fixed meaning, hence
// the fallback) -- lets a reference show a nicer label immediately, before
// the proxy round-trip even completes.
const SF_ID_PREFIXES = {
  '001': 'Account', '003': 'Contact', '005': 'User', '006': 'Opportunity',
  '00Q': 'Lead', '500': 'Case', '701': 'Campaign', '800': 'Contract',
  '801': 'Order', '02i': 'Asset', '00T': 'Task', '00U': 'Event'
};
function salesforceObjectTypeFromId(id) {
  return SF_ID_PREFIXES[(id || '').slice(0, 3)] || 'Salesforce record';
}
function refInfo(text) {
  if (!text) return null;
  const t = text.trim();
  const sf = t.match(/^https?:\/\/[\w-]+\.lightning\.force\.com\/lightning\/r\/(?:[\w]+\/)?([a-zA-Z0-9]{15,18})\/view\/?(?:[?#].*)?$/i)
    || t.match(/^https?:\/\/[\w-]+\.(?:my\.)?salesforce\.com\/([a-zA-Z0-9]{15,18})\/?(?:[?#].*)?$/i);
  if (sf) return { href: t, label: salesforceObjectTypeFromId(sf[1]) + ': ' + sf[1] };
  if (/^https?:\/\//i.test(t)) return { href: t, label: truncate(t.replace(/^https?:\/\//i, ''), 40) };
  const gh = t.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (gh) return { href: 'https://github.com/' + gh[1] + '/issues/' + gh[2], label: t };
  if (JIRA_KEY_RE.test(t)) return { href: null, label: t.toUpperCase() };
  return null;
}
function col(name) { return COLORS[name] || COLORS.gray; }
function pickGithubFields(obj) {
  return {
    key: obj.key || '', labels: obj.labels || [], description: obj.description || '', status: obj.status || '',
    statusCategory: obj.statusCategory || '', issueType: obj.issueType || '', assignees: obj.assignees || [],
    reporter: obj.reporter || '', created: obj.created || '', updated: obj.updated || '',
    resolution: obj.resolution || '', resolutionDate: obj.resolutionDate || '', fixVersions: obj.fixVersions || [],
    project: obj.project || ''
  };
}
function pickJiraFields(obj) {
  return {
    key: obj.key || '', labels: obj.labels || [], description: obj.description || '', status: obj.status || '',
    statusCategory: obj.statusCategory || '', issueType: obj.issueType || '', priority: obj.priority || '',
    assignee: obj.assignee || '', reporter: obj.reporter || '', created: obj.created || '', updated: obj.updated || '',
    dueDate: obj.dueDate || '', resolution: obj.resolution || '', resolutionDate: obj.resolutionDate || '',
    components: obj.components || [], fixVersions: obj.fixVersions || [], project: obj.project || ''
  };
}
// Unlike Jira's fixed issue schema, a Salesforce record's meaningful
// fields vary entirely by object type (and are admin-configurable per org
// via each object's Compact Layout) -- name/status/owner are best-effort
// convenience aliases the proxy fills in when it can find them, and
// "fields" is the raw flattened Compact Layout map for anything else a
// rule needs (e.g. source.salesforce.fields.Amount on an Opportunity).
function pickSalesforceFields(obj) {
  return {
    id: obj.id || '', objectType: obj.objectType || '', name: obj.name || '',
    status: obj.status || '', owner: obj.owner || '', url: obj.url || '',
    lastModified: obj.lastModified || '', fields: obj.fields || {}
  };
}
// The template engine HTML-escapes every {{ }} interpolation (confirmed by
// testing: typing "<b>" into a title renders as literal text, not a bold
// element), so there is no way to hand it trusted HTML through a render
// prop -- rendered comment HTML gets set via a plain DOM innerHTML pass
// instead (see hydrateCommentMarkdown), keyed off a data-testid container
// the template leaves empty. That pass is itself the XSS boundary:
// escapeHtml() runs on the ENTIRE raw text before any markdown syntax is
// interpreted, so every transformation below only ever wraps already-
// escaped, inert text in a fixed set of known-safe tags -- it can never
// introduce a live tag/attribute from what the comment author wrote. A
// subset of GFM: **bold**, *italic*, ~~strike~~, `code`, fenced ``` code
// blocks, [links](url) (http/https/mailto only), lists, blockquotes,
// headings, paragraphs (single newline -> <br>, blank line -> new
// paragraph). Deliberately NOT supported: raw HTML passthrough (security),
// images, bare-URL autolinking, nested lists, reference-style links -- a
// comment box does not need full CommonMark fidelity.
//
// Editing keeps the append-only shape of everything else this app
// persists (mirrors how a field's history is a log of every set, never a
// mutation): an edit appends a NEW entry to issues[].comments sharing the
// ORIGINAL comment's id, with a fresh time/sortKey. Nothing already in the
// array is ever changed or removed. latestCommentsById() derives what to
// actually display -- one bubble per id, showing the latest entry's text
// but the EARLIEST entry's time (so editing does not bump a comment's
// position in the thread), flagging wasEdited when more than one entry
// shares an id.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function renderMarkdownInline(line) {
  let out = escapeHtml(line);
  const stash = [];
  const MARK = '';
  const push = function (html) { stash.push(html); return MARK + (stash.length - 1) + MARK; };
  out = out.replace(/`([^`]+)`/g, function (m, code) { return push('<code>' + code + '</code>'); });
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
    const trimmed = url.trim();
    return /^(https?:|mailto:)/i.test(trimmed) ? push('<a href="' + trimmed + '" target="_blank" rel="noopener noreferrer">' + label + '</a>') : label;
  });
  out = out.replace(/\bwigwag:\/(?:project|remote)\/[^\s<]+/g, function (m) {
    return push('<a href="#" class="wigwag-ref-pill" data-wigwag-ref="' + escapeHtml(m) + '">' + m + '</a>');
  });
  // Bare URLs -> real links, with no markdown wrapping required. Trailing
  // sentence punctuation is trimmed off the link (a closing paren is only
  // trimmed if it isn't balancing an opening one inside the URL itself, so
  // a Wikipedia-style "(disambiguation)" URL doesn't lose its own paren).
  out = out.replace(/\bhttps?:\/\/[^\s<]+/g, function (m) {
    let url = m, trail = '';
    while (url.length) {
      const last = url[url.length - 1];
      if (!/[.,!?;:'")\]]/.test(last)) break;
      if (last === ')') {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes <= opens) break;
      }
      trail = last + trail;
      url = url.slice(0, -1);
    }
    if (!url) return m;
    return push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>') + trail;
  });
  // Bare email addresses -> a person pill (local part at full strength,
  // dimmed domain in one flex child so the pill's own gap doesn't land
  // between them). Domain must end on an alphanumeric label so a
  // sentence-final period isn't swallowed into the address.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, function (email) {
    const at = email.indexOf('@');
    const local = email.slice(0, at), domain = email.slice(at);
    return push('<a href="mailto:' + email + '" title="Email ' + email + '" class="email-pill"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4" r="2.1" stroke="currentColor" stroke-width="1.2"></circle><path d="M2.3 10.2c0-2.05 1.66-3.3 3.7-3.3s3.7 1.25 3.7 3.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path></svg><span>' + local + '<span style="opacity:0.6;">' + domain + '</span></span></a>');
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
  const restoreRe = new RegExp(MARK + '(\\d+)' + MARK, 'g');
  out = out.replace(restoreRe, function (m, idx) { return stash[Number(idx)]; });
  return out;
}
function renderMarkdown(raw) {
  const lines = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').split('\n');
  const parts = [];
  let para = [];
  const flush = function () { if (para.length) { parts.push('<p>' + para.map(renderMarkdownInline).join('<br>') + '</p>'); para = []; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      parts.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flush(); const lvl = heading[1].length; parts.push('<h' + lvl + '>' + renderMarkdownInline(heading[2]) + '</h' + lvl + '>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
      parts.push('<blockquote>' + quote.map(renderMarkdownInline).join('<br>') + '</blockquote>');
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      parts.push('<ul>' + items.map(function (it) { return '<li>' + renderMarkdownInline(it) + '</li>'; }).join('') + '</ul>');
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      parts.push('<ol>' + items.map(function (it) { return '<li>' + renderMarkdownInline(it) + '</li>'; }).join('') + '</ol>');
      continue;
    }
    if (line.trim() === '') { flush(); i++; continue; }
    para.push(line);
    i++;
  }
  flush();
  return parts.join('');
}
// One display bubble per comment id: latest entry's text, earliest entry's
// time/sortKey (so an edit doesn't move the comment in the thread). Groups
// by the same id-with-legacy-fallback key the merge path already uses (see
// commentKey() on the component -- comments imported from before ids
// existed, or from an external source, may not have one) so two genuinely
// different id-less comments never collapse into a single bubble.
function commentGroupKey(c) { return c.id || ('legacy|' + (c.sortKey || 0) + '|' + (c.author || '') + '|' + (c.text || '')); }
function latestCommentsById(comments) {
  const byKey = new Map();
  for (const c of (comments || [])) {
    const key = commentGroupKey(c);
    const g = byKey.get(key);
    if (!g) byKey.set(key, { first: c, latest: c });
    else {
      if (c.sortKey > g.latest.sortKey) g.latest = c;
      if (c.sortKey < g.first.sortKey) g.first = c;
    }
  }
  return Array.from(byKey.values()).map(function (entry) {
    const first = entry.first, latest = entry.latest;
    return { id: first.id, author: first.author, email: first.email, time: first.time, sortKey: first.sortKey,
      text: latest.text, wasEdited: latest.sortKey !== first.sortKey, redacted: !!latest.redacted };
  });
}

// Derives an issue's current field values from its own append-only
// history log -- the same "log is the source of truth, values are a
// projection" pattern latestCommentsById() already uses for comments,
// one level over: for each field, the entry with the highest sortKey
// wins. A field with no history entry at all falls back to the same
// type-appropriate default buildDefaultValues() gives a freshly-created
// issue ('' for text/issue, [] for multiselect, null otherwise).
function deriveIssueValues(issue, fieldDefs) {
  const latestByField = {};
  for (const h of (issue.history || [])) {
    if (!h.field || h.value === undefined) continue;
    const existing = latestByField[h.field];
    if (!existing || h.sortKey > existing.sortKey) latestByField[h.field] = h;
  }
  const values = {};
  for (const colId in fieldDefs) {
    if (latestByField[colId]) { values[colId] = latestByField[colId].value; continue; }
    const def = fieldDefs[colId];
    values[colId] = def.type === 'multiselect' ? [] : (def.type === 'text' || def.type === 'issue' ? '' : null);
  }
  return values;
}
// Migration safety net: fills genuine GAPS only (a field with a real
// stored value but zero history entries at all -- older data, or
// anything that arrived via import/paste/merge before history became
// authoritative). Deliberately does not try to reconcile a field that
// already HAS history but disagrees with the stored value -- that's a
// real data-integrity question, not a safe additive backfill. Naturally
// idempotent: once a field has any history entry (including one this
// function just added), it's no longer a gap, so re-running this adds
// nothing further -- no separate "have I migrated" guard needed, unlike
// the localStorage-key-guarded migrations elsewhere in this file.
function backfillIssueHistoryFromValues(issue, fieldDefs) {
  const fieldsWithHistory = new Set();
  const fieldsWithFieldRefHistory = new Set();
  for (const h of (issue.history || [])) {
    if (!h.field) continue;
    fieldsWithHistory.add(h.field);
    if (h.fieldRef !== undefined) fieldsWithFieldRefHistory.add(h.field);
  }
  const oldestSortKey = (issue.history && issue.history.length) ? Math.min.apply(null, issue.history.map(function (h) { return h.sortKey || 0; })) : 0;
  const earliestTime = (issue.history && issue.history.length) ? issue.history[0].time : formatNow();
  const backfillEntries = [];
  for (const colId in fieldDefs) {
    const hasFieldRef = issue.fieldRefs && issue.fieldRefs[colId];
    if (!fieldsWithHistory.has(colId)) {
      const storedValue = issue.values ? issue.values[colId] : undefined;
      if (storedValue !== undefined) {
        const def = fieldDefs[colId];
        const isDefaultish = def.type === 'multiselect' ? (Array.isArray(storedValue) && storedValue.length === 0) : (storedValue === '' || storedValue === null);
        if (!isDefaultish) {
          backfillEntries.push({
            id: 'backfill-' + issue.id + '-' + colId,
            time: earliestTime, actor: 'system', email: '',
            text: (def.label || colId) + ' (backfilled from existing data)',
            field: colId, value: storedValue,
            fieldRef: hasFieldRef ? issue.fieldRefs[colId] : undefined,
            origin: 'legacy-backfill', sortKey: oldestSortKey - 1,
            sig: null, sigRedacted: null, pubKey: null
          });
        }
      }
      continue;
    }
    // Field already has history (so no value backfill needed) but every
    // existing entry predates fieldRef tracking -- a real link (owner/repo/
    // num or a Jira key) would otherwise be silently lost. Carries no
    // value, only a fieldRef, so it never competes with the real
    // value-setting entries during derivation.
    if (hasFieldRef && !fieldsWithFieldRefHistory.has(colId)) {
      const def = fieldDefs[colId];
      backfillEntries.push({
        id: 'backfill-ref-' + issue.id + '-' + colId,
        time: earliestTime, actor: 'system', email: '',
        text: (def.label || colId) + ' link (backfilled from existing data)',
        field: colId, value: undefined,
        fieldRef: issue.fieldRefs[colId],
        origin: 'legacy-backfill', sortKey: oldestSortKey - 1,
        sig: null, sigRedacted: null, pubKey: null
      });
    }
  }
  if (!backfillEntries.length) return issue;
  return { ...issue, history: [...issue.history, ...backfillEntries] };
}
// Derives current fieldRefs (GitHub/Jira link metadata) the same way
// deriveIssueValues derives values -- latest history entry per field that
// explicitly carries a fieldRef (commitEdit always sets fieldRef:null when
// committing plain text over a field, so a field that was linked and then
// edited away correctly resolves to no ref, not a stale one). Entries with
// no fieldRef key at all (select/multiselect edits, derived/bound-field
// recomputes) are irrelevant here -- those field types never carry a ref.
function deriveIssueFieldRefs(issue, fieldDefs) {
  const latestByField = {};
  for (const h of (issue.history || [])) {
    if (!h.field || h.fieldRef === undefined) continue;
    const existing = latestByField[h.field];
    if (!existing || h.sortKey > existing.sortKey) latestByField[h.field] = h;
  }
  const fieldRefs = {};
  for (const colId in latestByField) fieldRefs[colId] = latestByField[colId].fieldRef;
  return fieldRefs;
}
// Shared load-time preparation for an issue coming from anywhere other than
// this session's own live edits (localStorage, an imported/pasted/merged
// file, a GitHub pull): backfill any pre-history gaps, then (re)populate
// values/fieldRefs fresh from history, which is now their sole source.
function hydrateIssue(issue, fieldDefs) {
  const backfilled = backfillIssueHistoryFromValues(issue, fieldDefs);
  return { ...backfilled, values: deriveIssueValues(backfilled, fieldDefs), fieldRefs: deriveIssueFieldRefs(backfilled, fieldDefs) };
}
// Project-level counterpart to deriveIssueValues -- but unlike issue
// values (where the SET of fields is fixed by fieldDefs and every value
// has a type-appropriate default), a field's very existence isn't
// derivable from history at all: field deletion stays a direct, unlogged
// removal (same reasoning as issue deletion -- see docs/EDITING.md /
// the plan's "explicitly not touched" list), so resurrecting a deleted
// field's old creation entry would be wrong. currentFieldDefs is the
// authoritative KEY SET (which fields exist right now, maintained
// directly by submitNewField/deleteField); this only re-derives each
// existing key's CONTENT (label/type/options/linkedSourceId/rule) from
// the latest project-history entry for that field, falling back to
// whatever's already there for a field with no history yet (a genuine
// migration gap -- backfillProjectHistory closes this before derive ever
// needs to use the fallback in practice).
// Field EXISTENCE, not just field VALUES, comes purely from this fold --
// no ambient "currentFieldDefs" parameter, matching how every other
// derivation in this app already works (issue values, comments: latest
// signed entry per key wins). A field exists iff it has a history entry
// and that entry's latest value (by sortKey) isn't null -- value: null
// is a removal tombstone (unambiguous: a real field definition is always
// an object, never null). This is deliberate: an earlier version took a
// second "fallback" fieldDefs argument and unioned it in, which is
// exactly what let a stale/polluted ambient value permanently reinject
// fields with no real history backing on every future merge -- a real,
// live incident (2026-08-31, see the plan doc). There is no longer any
// parameter here for that kind of value to leak in through.
function deriveFieldDefs(projectHistory) {
  const latestByField = {};
  for (const h of (projectHistory || [])) {
    if (!h.field || h.value === undefined) continue;
    const existing = latestByField[h.field];
    if (!existing || h.sortKey > existing.sortKey) latestByField[h.field] = h;
  }
  const fieldDefs = {};
  for (const colId in latestByField) {
    const value = latestByField[colId].value;
    if (value === null) continue; // tombstoned -- most recent event was a removal
    fieldDefs[colId] = value;
  }
  // The built-in "Issue" field is conceptually always issue-typed -- it's
  // what GitHub/Jira/Salesforce linking and the "Related"-style
  // bound-source concept model themselves on. Older data (including this
  // app's own pre-existing default) may still have it stored as
  // type:'text'; normalized unconditionally here since this is the one
  // place every fieldDefs computation actually funnels through
  // (hydrateProject, startMerge, every appendProjectHistory) -- patching
  // any single caller's input wouldn't be reliable, since a stale value
  // baked into a real or backfilled history entry would keep winning
  // above. Only .type is touched; a customized label survives untouched.
  if (fieldDefs.title && fieldDefs.title.type !== 'issue') {
    fieldDefs.title = { ...fieldDefs.title, type: 'issue' };
  }
  return fieldDefs;
}
// Migration safety net, mirroring backfillIssueHistoryFromValues: any
// field currently in fieldDefs with zero project-history entries (older
// data, or anything that arrived via import/paste/merge before schema
// changes became logged) gets one synthesized entry carrying its whole
// current definition as value -- same "log the whole new definition, not
// a delta" shape every real edit uses.
function backfillProjectHistory(fieldDefs, projectHistory) {
  const fieldsWithHistory = new Set();
  for (const h of (projectHistory || [])) { if (h.field) fieldsWithHistory.add(h.field); }
  const oldestSortKey = (projectHistory && projectHistory.length) ? Math.min.apply(null, projectHistory.map(function (h) { return h.sortKey || 0; })) : 0;
  const earliestTime = (projectHistory && projectHistory.length) ? projectHistory[0].time : formatNow();
  const backfillEntries = [];
  for (const colId in fieldDefs) {
    if (fieldsWithHistory.has(colId)) continue;
    backfillEntries.push({
      id: 'backfill-field-' + colId,
      time: earliestTime, actor: 'system', email: '',
      text: (fieldDefs[colId].label || colId) + ' (backfilled from existing data)',
      field: colId, value: fieldDefs[colId],
      origin: 'legacy-backfill', sortKey: oldestSortKey - 1,
      sig: null, sigRedacted: null, pubKey: null
    });
  }
  if (!backfillEntries.length) return projectHistory || [];
  return [...(projectHistory || []), ...backfillEntries];
}
// Shared load-time preparation for a project's schema coming from anywhere
// other than this session's own live edits -- mirrors hydrateIssue.
function hydrateProject(fieldDefs, projectHistory) {
  const backfilled = backfillProjectHistory(fieldDefs, projectHistory);
  return { fieldDefs: deriveFieldDefs(backfilled), projectHistory: backfilled };
}


function base64FromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function bytesFromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function base64FromText(text) { return base64FromBytes(new TextEncoder().encode(text)); }
function textFromBase64(b64) { return new TextDecoder().decode(bytesFromBase64(b64.replace(/\n/g, ''))); }
const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' };
// Deterministic subset of a history entry that gets signed — fixed key
// order (source-literal object, not a generic canonicalizer) is enough
// here since this only ever needs to round-trip through this same app,
// not interoperate with an external signer. Explicitly not designed to be
// bulletproof — a lightweight "this really came from me" marker for
// sharing between collaborators, not a security boundary.
function signablePayload(issueId, entry) {
  return JSON.stringify({
    issueId, id: entry.id, field: entry.field || null,
    value: entry.value === undefined ? null : entry.value,
    text: entry.text, time: entry.time, sortKey: entry.sortKey,
    actor: entry.actor, email: entry.email || ''
  });
}
function signableProjectPayload(projectId, entry) {
  return JSON.stringify({
    projectId, id: entry.id, field: entry.field || null,
    value: entry.value === undefined ? null : entry.value,
    text: entry.text, time: entry.time, sortKey: entry.sortKey,
    actor: entry.actor, email: entry.email || ''
  });
}
// The redacted (content-free) counterpart to signablePayload/
// signableProjectPayload -- exactly the subset squashHistory's tombstone
// keeps, no more, no less: the two must always agree, or a legitimately-
// redacted tombstone would fail to verify.
function redactedPayload(issueId, entry) {
  return JSON.stringify({
    issueId, id: entry.id, field: entry.field || null,
    time: entry.time, sortKey: entry.sortKey,
    actor: entry.actor, email: entry.email || '', origin: entry.origin || 'authored'
  });
}
function redactedProjectPayload(projectId, entry) {
  return JSON.stringify({
    projectId, id: entry.id, field: entry.field || null,
    time: entry.time, sortKey: entry.sortKey,
    actor: entry.actor, email: entry.email || '', origin: entry.origin || 'authored'
  });
}
// Comment counterparts -- same two-signature shape, no `field`/`actor`
// (comments use `author`).
function signableCommentPayload(issueId, entry) {
  return JSON.stringify({
    issueId, id: entry.id, text: entry.text, time: entry.time, sortKey: entry.sortKey,
    author: entry.author, email: entry.email || ''
  });
}
function redactedCommentPayload(issueId, entry) {
  return JSON.stringify({
    issueId, id: entry.id, time: entry.time, sortKey: entry.sortKey,
    author: entry.author, email: entry.email || ''
  });
}
function signableProjectCommentPayload(projectId, entry) {
  return JSON.stringify({
    projectId, id: entry.id, text: entry.text, time: entry.time, sortKey: entry.sortKey,
    author: entry.author, email: entry.email || ''
  });
}
function redactedProjectCommentPayload(projectId, entry) {
  return JSON.stringify({
    projectId, id: entry.id, time: entry.time, sortKey: entry.sortKey,
    author: entry.author, email: entry.email || ''
  });
}

// A bound field's rule is authored as an ordered list of conditions and
// COMPILED to the same single expression string the engine has always
// evaluated (def.rule) -- that string stays the one source of truth for
// eval, export and history, so nothing downstream needs to know rows
// exist. def.ruleRows/def.ruleFallback are the authored form kept
// alongside it; hand-editing the expression clears ruleRows, which is what
// puts the field into advanced mode (no parser, no round-trip guessing).
const RULE_NO_OPERAND_OPS = ['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'];
// String-coerces and lowercases for a safe, case-insensitive comparison
// -- null/undefined -> ''. Available inside every compiled rule/condition
// as S (see evalRule), so compiled conditions read as S(x) === "value"
// instead of spelling this out inline every time.
function S(v) { return String(v == null ? '' : v).toLowerCase(); }
function ruleCondition(criterion) {
  const s = criterion.subject || 'source.text';
  const raw = criterion.operand == null ? '' : String(criterion.operand);
  const q = JSON.stringify(raw);
  const lc = JSON.stringify(raw.toLowerCase());
  switch (criterion.op) {
    case 'includes': return s + '?.some(x => S(x) === ' + lc + ')';
    case 'notIncludes': return '!' + s + '?.some(x => S(x) === ' + lc + ')';
    case 'is': return 'S(' + s + ') === ' + lc;
    case 'isNot': return 'S(' + s + ') !== ' + lc;
    case 'contains': return 'S(' + s + ').includes(' + lc + ')';
    case 'notContains': return '!S(' + s + ').includes(' + lc + ')';
    case 'startsWith': return 'S(' + s + ').startsWith(' + lc + ')';
    case 'matches': return 'new RegExp(' + q + ', "i").test(S(' + s + '))';
    case 'isEmpty': return '!(' + s + ' ?? "").length';
    case 'isNotEmpty': return '!!(' + s + ' ?? "").length';
    case 'isTrue': return s + ' === true';
    case 'isFalse': return s + ' !== true';
    default: return 'false';
  }
}
// Normalizes a row to its criteria array -- transparently upgrades the
// legacy flat {subject,op,operand} shape (a row IS its own single
// criterion, pre-AND-support) so old persisted rules keep working
// without a migration pass.
function ruleRowCriteria(row) {
  if (Array.isArray(row.criteria)) return row.criteria;
  return [{ subject: row.subject, op: row.op, operand: row.operand }];
}
// A row's full condition: every criterion ANDed together. Each criterion
// is parenthesized so future operator additions can't accidentally change
// how adjacent criteria associate.
function ruleRowCondition(row) {
  return ruleRowCriteria(row).map(c => '(' + ruleCondition(c) + ')').join(' && ');
}
// A leading "=" in a THEN value means "the rest is an expression, not a
// literal" -- the one escape hatch that keeps string manipulation
// (=source.github?.description.slice(0,80)) available without leaving the
// row editor.
// A select/multiselect THEN value is stored as the option's internal id
// (needed so the THEN <select>/chips can show the right current
// selection) -- resolved to that option's LABEL here so the compiled/
// displayed expression reads as a real value ("Bug") instead of a
// storage id ("opt_1786483538357"). applyComputedToField already matches
// a computed value against either an option's id or its label, so this
// only changes what the expression looks like, never what it evaluates
// to.
function optionLabelForThen(id, def) {
  if (!def || (def.type !== 'select' && def.type !== 'multiselect')) return id;
  const opt = (def.options || []).find(o => o.id === id);
  return opt ? opt.label : id;
}
function ruleThenLiteral(v, def) {
  if (Array.isArray(v)) return JSON.stringify(v.map(id => optionLabelForThen(id, def)));
  if (v == null) return 'null';
  const s = String(v);
  if (s.charAt(0) === '=') return '(' + s.slice(1) + ')';
  return JSON.stringify(optionLabelForThen(s, def));
}
function compileRuleRows(rows, fallback, def) {
  const parts = (rows || [])
    .filter(r => r && ruleRowCriteria(r).length && ruleRowCriteria(r).every(c => c && c.subject && c.op))
    .map(r => ruleRowCondition(r) + '\n  ? ' + ruleThenLiteral(r.then, def));
  const fb = ruleThenLiteral(fallback === undefined ? null : fallback, def);
  if (!parts.length) return fb;
  return parts.join('\n  : ') + '\n  : ' + fb;
}


// --- Phase 2 of the wigwag-core extraction (see the plan doc) ---------
// Rule/bound-value resolution and sort-order computation -- these were
// instance methods touching `this.state` in at most one line each
// (applyLinkedRules read this.state.fieldDefs directly; the rest called
// only sibling pure methods). Moved verbatim except for that one
// signature change (applyLinkedRules now takes fieldDefs explicitly).
function buildSource(issue, linkedSourceId) {
  if (!linkedSourceId) return { text: '', isLinked: false, github: null, jira: null, salesforce: null };
  const ref = issue.fieldRefs && issue.fieldRefs[linkedSourceId];
  const system = ref ? (ref.system || 'github') : null;
  return {
    text: issue.values[linkedSourceId] || '',
    isLinked: !!ref,
    github: system === 'github' ? pickGithubFields(ref) : null,
    jira: system === 'jira' ? pickJiraFields(ref) : null,
    salesforce: system === 'salesforce' ? pickSalesforceFields(ref) : null
  };
}
function evalRule(ruleStr, source, values) {
  try {
    const fn = new Function('source', 'values', 'S', 'return (' + ruleStr + ');');
    return fn(source, values, S);
  } catch (e) { return undefined; }
}
// { isLinked:false } short-circuits before the rule even runs, for fields
// with no rule/no bound source AND for bound-but-not-yet-linked rows —
// callers use isLinked to decide whether to lock the cell / overwrite its
// materialized value at all.
function computeBoundValue(issue, def) {
  if (!def.rule || !def.linkedSourceId) return { isLinked: false, computed: undefined };
  const source = buildSource(issue, def.linkedSourceId);
  if (!source.isLinked) return { isLinked: false, computed: undefined };
  return { isLinked: true, computed: evalRule(def.rule, source, issue.values) };
}
// Whether a field is currently rule-derived (and therefore locked from
// manual/bulk edit) for a specific issue -- every cell builder already
// inlines this same computeBoundValue(...).isLinked check; bulk
// Set-field is the first caller that needs it outside a per-cell
// render, hence pulling it out to a name.
function isFieldLocked(issue, def) {
  return computeBoundValue(issue, def).isLinked;
}
// select: computed matched against option id/label -> that option's id (or
// null if nothing matches). multiselect: computed may be an array or a
// single value; each entry is matched the same way and invalid entries are
// dropped. text: computed is coerced to a string directly.
function applyComputedToField(values, colId, def, computed) {
  if (def.type === 'select') {
    const opt = (def.options || []).find(o => o.id === computed || (o.label || '').toLowerCase() === String(computed).toLowerCase());
    const next = opt ? opt.id : null;
    return next === values[colId] ? values : { ...values, [colId]: next };
  }
  if (def.type === 'multiselect') {
    const arr = Array.isArray(computed) ? computed : (computed == null ? [] : [computed]);
    const ids = arr.map(v => {
      const opt = (def.options || []).find(o => o.id === v || (o.label || '').toLowerCase() === String(v).toLowerCase());
      return opt ? opt.id : null;
    }).filter(Boolean);
    const cur = values[colId] || [];
    const same = cur.length === ids.length && cur.every((v, i) => v === ids[i]);
    return same ? values : { ...values, [colId]: ids };
  }
  const next = computed == null ? '' : String(computed);
  return next === values[colId] ? values : { ...values, [colId]: next };
}
function applyLinkedRules(iss, fieldDefs) {
  let values = iss.values;
  for (const colId in fieldDefs) {
    const def = fieldDefs[colId];
    const bound = computeBoundValue(iss, def);
    if (!bound.isLinked) continue;
    values = applyComputedToField(values, colId, def, bound.computed);
  }
  return values === iss.values ? iss : { ...iss, values };
}
function sortValue(issue, colId, def) {
  if (colId === 'title') return issue.values.title || '';
  if (!def) return '';
  if (def.type === 'select') { const idx = (def.options || []).findIndex(o => o.id === issue.values[colId]); return idx === -1 ? 'zzz' : String(idx).padStart(4, '0'); }
  if (def.type === 'multiselect') {
    const ids = issue.values[colId] || [];
    if (!ids.length) return 'zzz';
    const idxs = ids.map(id => (def.options || []).findIndex(o => o.id === id)).filter(i => i !== -1);
    return idxs.length ? String(Math.min(...idxs)).padStart(4, '0') : 'zzz';
  }
  return issue.values[colId] || '';
}
// An issue's earliest logged event (its own "Created" entry, always the
// lowest sortKey in its history chronologically) as a stable creation-
// order key. Immutable once set -- unlike issue.num (which only reflects
// the order a browser first became aware of an issue, not its true age:
// an issue merged in from elsewhere gets numbered above all of a local
// project's existing issues regardless of how old it actually is) or raw
// array position (which a merge can reorder relative to true creation
// order), this is preserved verbatim through every merge, so it's safe
// to sort by on every render with no snapshotting needed.
function issueCreatedAt(issue) {
  const sortKeys = (issue.history || []).map(h => h.sortKey).filter(k => typeof k === 'number');
  return sortKeys.length ? Math.min(...sortKeys) : 0;
}
// Row order should only change when the sort itself is set/changed or the
// page is reloaded -- never as a side effect of editing a field, even the
// sorted-by column. See wigwag.html's own switchProject/sortBy/boot-time
// callers for where this gets (re)computed and why -- never on every
// render, so there's no per-tick mechanism that could misbehave.
// Ties (including two issues with no set value at all) fall back to
// creation date, not sort stability -- Array.sort's stability reflects
// current array position, which a merge can reorder independently of
// true creation order.
function computeSortSnapshot(sort, issues, fieldDefs) {
  if (!sort.colId) return null;
  const def = sort.colId === 'title' ? null : fieldDefs[sort.colId];
  const withValues = issues.map(iss => ({ id: iss.id, values: deriveIssueValues(iss, fieldDefs), createdAt: issueCreatedAt(iss) }));
  withValues.sort((a, b) => {
    const av = sortValue(a, sort.colId, def), bv = sortValue(b, sort.colId, def);
    const cmp = String(av).localeCompare(String(bv));
    if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
    return a.createdAt - b.createdAt;
  });
  return withValues.map(i => i.id);
}

// --- Phase 3 of the wigwag-core extraction (see the plan doc) ---------
// The write path: signing primitives + the shared two-phase commit shape.
// getSigningKey's caching (an instance field) and nextSortKey's counter
// (also an instance field) stay in wigwag.html/a CLI's own state -- only
// the actual crypto call and the counter arithmetic move here.
async function importSigningKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, SIGN_ALG, false, ['sign']);
}
async function signWithKey(key, payloadStr) {
  if (!key) return null;
  try {
    const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payloadStr));
    return base64FromBytes(new Uint8Array(sigBuf));
  } catch (e) { return null; }
}
// Used both for verifying a history entry's own signature and for the
// TOFU identity check on import/merge.
async function verifyPayload(payloadStr, sigBase64, pubKeyJwk) {
  if (!sigBase64 || !pubKeyJwk) return false;
  try {
    const key = await crypto.subtle.importKey('jwk', pubKeyJwk, SIGN_ALG, false, ['verify']);
    const sigBytes = bytesFromBase64(sigBase64);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, new TextEncoder().encode(payloadStr));
  } catch (e) { return false; }
}
// Strictly-increasing sortKey for every history entry/comment this app
// generates, so two events written in the same millisecond never tie.
function advanceSortKey(lastSortKey) {
  const now = Date.now();
  return now > lastSortKey ? now : lastSortKey + 1;
}
// The single funnel every history/comment append-or-edit call site goes
// through (appendSignedHistory, appendProjectHistory, addComment,
// saveEditComment, postProjectComment, saveEditProjectComment): commit an
// unsigned entry immediately (synchronous, optimistic), sign it in the
// background, patch the signature on once both signings resolve.
// entryBase: the caller-built entry object minus sig/sigRedacted/pubKey --
// shape varies by call site (history entries carry field/value/fieldRef;
// comments don't), this function only ever touches .id/.sortKey.
// payloads: { signable, redacted } strings, built by the caller via the
// existing signable*/redacted* functions above.
// store: { sign(payloadStr) => Promise<string|null>,
//          insertUnsigned(entry) => void,
//          patchSignature(id, sortKey, sig, sigRedacted, pubKey) => void,
//          currentPubKey() => jwk|null }
function commitSignedEntry(entryBase, payloads, store) {
  const entry = { ...entryBase, sig: null, sigRedacted: null, pubKey: null };
  store.insertUnsigned(entry);
  return Promise.all([store.sign(payloads.signable), store.sign(payloads.redacted)])
    .then(([sig, sigRedacted]) => {
      if (!sig && !sigRedacted) return;
      store.patchSignature(entry.id, entry.sortKey, sig, sigRedacted, store.currentPubKey());
    });
}

// --- Phase 4a of the wigwag-core extraction (see the plan doc) --------
// Export/import serialization, merge, and GitHub Contents-API sync
// mechanics. Credentials/sync-target (token, owner/repo/path/branch) are
// always explicit parameters here -- never read from state/localStorage
// -- so a CLI can call the exact same functions wigwag.html does.

// A history/comment entry not selected as the field's latest gets its
// prose/value stripped down to a redacted stub -- used for the
// "squashed" export mode, which keeps only the latest entry per field in
// full plus a redacted trail for everything superseded.
function squashHistory(history) {
  const latestByField = {};
  for (const h of history) { if (h.field) latestByField[h.field] = h; }
  const keepIds = new Set(Object.values(latestByField).map(h => h.id));
  return history.map(h => {
    if (!h.field || keepIds.has(h.id)) return h;
    return {
      id: h.id, time: h.time, actor: h.actor, email: h.email,
      field: h.field, origin: h.origin, sortKey: h.sortKey,
      redacted: true, sigRedacted: h.sigRedacted, pubKey: h.pubKey
    };
  });
}
function displayValueForHistory(def, value) {
  if (def.type === 'select') {
    const opt = (def.options || []).find(o => o.id === value);
    return opt ? opt.label : (value == null || value === '' ? '—' : String(value));
  }
  if (def.type === 'multiselect') {
    const ids = Array.isArray(value) ? value : (value ? [value] : []);
    if (!ids.length) return '—';
    return ids.map(id => { const opt = (def.options || []).find(o => o.id === id); return opt ? opt.label : id; }).join(', ');
  }
  return value == null || value === '' ? '—' : String(value);
}
// doc: { projectId, projectName, fieldDefs, projectHistory, projectNotes,
// projectComments, issues } -- the full exportable project shape.
function buildSourceText(mode, doc) {
  const { projectId, projectName, fieldDefs, projectHistory: rawProjectHistory, projectNotes, projectComments, issues } = doc;
  const projectHistory = mode === 'squashed' ? squashHistory(rawProjectHistory) : rawProjectHistory;
  const lines = [JSON.stringify({ type: 'fields', formatVersion: FORMAT_VERSION, generator: 'wigwag', fields: fieldDefs, projectHistory, id: projectId, name: projectName || undefined, projectNotes: projectNotes || undefined, projectComments: (projectComments && projectComments.length) ? projectComments : undefined })];
  for (const iss of issues) {
    const history = mode === 'squashed' ? squashHistory(iss.history) : iss.history;
    lines.push(JSON.stringify({ type: 'issue', id: iss.id, num: iss.num, comments: iss.comments, history }));
  }
  return lines.join('\n');
}
// Tolerant line-by-line parse -- a malformed line is skipped rather than
// failing the whole import, since a partially-corrupted file (e.g. one
// truncated by a bad email client) should still recover what it can.
// fallbackFieldDefs is used only when the file has no 'fields' line of
// its own (a pure issues-only paste, say).
function parseJsonl(text, fallbackFieldDefs) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let fields = null, incomingProjectHistory = null, projectId = null, projectName = null, projectNotes = null, projectComments = null, incomingFormatVersion = null;
  const issues = [];
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    if (obj.type === 'fields') {
      fields = obj.fields || null; incomingProjectHistory = obj.projectHistory || null; projectId = obj.id || null; projectName = obj.name || null;
      projectNotes = obj.projectNotes || null; projectComments = obj.projectComments || null; incomingFormatVersion = typeof obj.formatVersion === 'number' ? obj.formatVersion : null;
    }
    else if (obj.type === 'issue') issues.push(obj);
  }
  const effectiveFields = fields || fallbackFieldDefs;
  const hydratedIssues = issues.map(iss => hydrateIssue(iss, effectiveFields));
  const projectHistory = fields ? backfillProjectHistory(fields, incomingProjectHistory || []) : (incomingProjectHistory || []);
  return { fields, projectHistory, issues: hydratedIssues, projectId, projectName, projectNotes, projectComments, formatVersion: incomingFormatVersion };
}
// A stable identity for a history/comment entry for union-dedup purposes.
// Real entries always have an id; the original seed data's history
// predates ids, so those fall back to a composite of their other fields
// -- stable enough to dedupe on, since two independently-authored entries
// are exceedingly unlikely to collide on sortKey+actor+field+text.
function entryKey(h) { return h.id || ('legacy|' + (h.sortKey || 0) + '|' + (h.actor || '') + '|' + (h.field || '') + '|' + (h.text || '')); }
function commentKey(c) { return c.id || ('legacy|' + (c.sortKey || 0) + '|' + (c.author || '') + '|' + (c.text || '')); }
function unionByKey(localList, incomingList, keyFn) {
  const map = new Map();
  for (const item of localList) map.set(keyFn(item), item);
  for (const item of incomingList) if (!map.has(keyFn(item))) map.set(keyFn(item), item);
  return [...map.values()].sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
}
// Unions both sides' history/comments (nothing is ever dropped -- a
// losing edit is still sitting right there in history) and re-derives
// values/fieldRefs fresh, the same derivation every other write path
// uses. No blocking conflict step: whichever side's entry has the higher
// sortKey naturally wins the derivation. overlappingFields flags any
// field where BOTH sides had authored entries the other hadn't seen yet
// (origin !== 'derived' -- two independently-computed bound values
// disagreeing isn't an authorship overlap) purely so the caller can
// surface a lightweight, non-blocking notice; it does not affect the
// merge result itself.
function mergeIssuePair(localIssue, incomingIssue, fieldDefs) {
  const history = unionByKey(localIssue.history, incomingIssue.history, h => entryKey(h));
  const comments = unionByKey(localIssue.comments, incomingIssue.comments, c => commentKey(c));
  const fieldIds = new Set();
  for (const h of history) if (h.field) fieldIds.add(h.field);
  const overlappingFields = [];
  for (const colId of fieldIds) {
    const localAuthored = localIssue.history.filter(h => h.field === colId && h.origin !== 'derived');
    const incomingAuthored = incomingIssue.history.filter(h => h.field === colId && h.origin !== 'derived');
    const localKeys = new Set(localAuthored.map(h => entryKey(h)));
    const incomingKeys = new Set(incomingAuthored.map(h => entryKey(h)));
    const localOnly = localAuthored.some(h => !incomingKeys.has(entryKey(h)));
    const incomingOnly = incomingAuthored.some(h => !localKeys.has(entryKey(h)));
    if (localOnly && incomingOnly) overlappingFields.push(colId);
  }
  const merged = { ...localIssue, comments, history };
  const mergedIssue = { ...merged, values: deriveIssueValues(merged, fieldDefs), fieldRefs: deriveIssueFieldRefs(merged, fieldDefs) };
  return { mergedIssue, overlappingFields };
}
// The full pure half of a merge: pairs up local issues with their
// incoming counterpart (via mergeIssuePair) and folds in whichever
// incoming issues are genuinely new (not present locally at all),
// carrying each one's own real history over as-is -- no synthetic
// "merged in" annotation stamped on top of it. A pulled/merged issue's
// provenance is already fully explained by its own history; adding a
// local note on top of every one of them (there can be hundreds, on a
// first connect to an existing project) is noise, not signal.
function computeIssueMerge(localIssues, parsedIssues, fieldDefs) {
  const localById = new Map(localIssues.map(i => [i.id, i]));
  const mergedIssues = [];
  const notices = {};
  for (const localIssue of localIssues) {
    const incomingIssue = parsedIssues.find(i => i.id === localIssue.id);
    if (!incomingIssue) { mergedIssues.push(localIssue); continue; }
    const { mergedIssue, overlappingFields } = mergeIssuePair(localIssue, incomingIssue, fieldDefs);
    mergedIssues.push(mergedIssue);
    if (overlappingFields.length) notices[localIssue.id] = overlappingFields;
  }
  let nextNum = localIssues.reduce((m, i) => Math.max(m, i.num || 0), 0) + 1;
  for (const incomingIssue of parsedIssues) {
    if (localById.has(incomingIssue.id)) continue;
    mergedIssues.push({
      id: incomingIssue.id, num: nextNum++, fieldRefs: incomingIssue.fieldRefs || {}, fieldLoading: {},
      values: incomingIssue.values || {}, comments: incomingIssue.comments || [], history: incomingIssue.history || []
    });
  }
  return { mergedIssues, notices };
}
// The fieldDefs/projectHistory half of a merge -- independent of issues,
// only runs when the incoming file actually carries a 'fields' line (a
// pure issues-only paste has nothing to merge here). No ambient
// "localFieldDefs" parameter -- the merged field set comes entirely from
// the merged (unioned, already merge-safe) history, same as everything
// else this function touches. See deriveFieldDefs's own comment for why.
function computeFieldDefsMerge(localProjectHistory, parsedFields, parsedProjectHistory) {
  if (!parsedFields) return null;
  const mergedProjectHistory = unionByKey(localProjectHistory, parsedProjectHistory || [], h => entryKey(h));
  const mergedFieldDefs = deriveFieldDefs(mergedProjectHistory);
  return { mergedProjectHistory, mergedFieldDefs };
}
// The pure half of logDerivedChanges: which rule-bound fields actually
// changed value on this issue, and what the resulting history entry
// should say. Committing each entry (needs identity + signing) stays the
// caller's job, same split as every other write path.
function computeDerivedChangeEntries(issue, beforeValues, fieldDefs) {
  const entries = [];
  for (const colId in fieldDefs) {
    const def = fieldDefs[colId];
    if (!def.linkedSourceId) continue;
    const before = beforeValues[colId];
    const after = issue.values[colId];
    if (JSON.stringify(before === undefined ? null : before) === JSON.stringify(after === undefined ? null : after)) continue;
    const srcDef = fieldDefs[def.linkedSourceId];
    const srcLabel = srcDef ? srcDef.label : def.linkedSourceId;
    const displayVal = displayValueForHistory(def, after);
    const source = buildSource(issue, def.linkedSourceId);
    const derivedFrom = source.text ? ('state of ' + source.text + ' in column ' + srcLabel) : srcLabel;
    entries.push({ colId, text: (def.label || colId) + ' set to ' + displayVal + ' (derived from ' + derivedFrom + ')', value: after });
  }
  return entries;
}

// GitHub Contents-API sync mechanics. repo is always "owner/repo"; token/
// fetchImpl/target are always explicit params, never read from state.
function buildGithubContentsUrl(repo, path, branch) {
  const p = (path || 'tracker.jsonl').trim();
  const b = (branch || '').trim();
  const encodedPath = p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return 'https://api.github.com/repos/' + repo + '/contents/' + encodedPath + (b ? '?ref=' + encodeURIComponent(b) : '');
}
function buildGithubContentsHeaders(token, hasBody) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}
function buildGithubCommitMessage(issueCount) {
  return 'Update via Git-native Tracker: ' + issueCount + ' issue' + (issueCount === 1 ? '' : 's');
}
// Generalizes both a plain "connect" GET (no etag) and a conditional
// poll GET (etag set -> a 304 comes back as 'not-modified', free against
// rate limits). Never throws -- network/parse failures come back as
// {status:'error'} for the caller to handle however fits that call site.
async function pullGithubFile({ fetchImpl, repo, path, branch, token, etag }) {
  const headers = buildGithubContentsHeaders(token, false);
  if (etag) headers['If-None-Match'] = etag;
  let res;
  try {
    res = await fetchImpl(buildGithubContentsUrl(repo, path, branch), { headers });
  } catch (e) {
    return { status: 'error', message: e.message };
  }
  if (res.status === 304) return { status: 'not-modified' };
  if (res.status === 404) return { status: 'not-found' };
  if (!res.ok) return { status: 'error', message: 'GitHub returned ' + res.status };
  const newEtag = res.headers.get('ETag') || null;
  let data;
  try { data = await res.json(); } catch (e) { return { status: 'error', message: 'Invalid response from GitHub' }; }
  return { status: 'ok', text: textFromBase64(data.content), sha: data.sha, etag: newEtag };
}
// sha, if given, makes this a conditional PUT (GitHub itself rejects with
// 409/422 -- surfaced here as {status:'conflict'} -- if the file moved
// under us; it's never silently overwritten). Omit sha to create a new
// file.
async function pushGithubFile({ fetchImpl, repo, path, branch, token, text, sha, commitMessage, authorName, authorEmail }) {
  const body = {
    message: commitMessage,
    content: base64FromText(text),
    author: { name: authorName, email: authorEmail || 'unknown@example.invalid' }
  };
  if (branch) body.branch = branch;
  if (sha) body.sha = sha;
  let res;
  try {
    res = await fetchImpl(buildGithubContentsUrl(repo, path, branch), { method: 'PUT', headers: buildGithubContentsHeaders(token, true), body: JSON.stringify(body) });
  } catch (e) {
    return { status: 'error', message: e.message };
  }
  if (res.status === 409 || res.status === 422) return { status: 'conflict' };
  if (!res.ok) return { status: 'error', message: 'GitHub returned ' + res.status };
  let data;
  try { data = await res.json(); } catch (e) { return { status: 'error', message: 'Invalid response from GitHub' }; }
  return { status: 'ok', sha: data.content && data.content.sha };
}
// One request, with or without a token. GitHub returns 404 (not 403) for
// a private repo a token can't see, same as for one that doesn't exist
// at all, so both read as "refused" here; an unauthenticated 200 means
// the repo is public (no permissions object comes back without a token,
// so success alone is the signal).
async function probeGithubRepoAccess(owner, repo, token, fetchImpl) {
  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetchImpl('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), { headers, cache: 'no-store' });
    if (res.status === 401) return { status: 'refused', reason: 'expired' };
    if (res.status === 404) return { status: 'refused', reason: token ? 'not-a-member' : 'unknown' };
    if (!res.ok) return { status: 'refused', reason: 'unknown' };
    if (!token) return { status: 'read' };
    const data = await res.json();
    return { status: data.permissions && data.permissions.push ? 'write' : 'read' };
  } catch (e) {
    return { status: 'refused', reason: 'unknown' };
  }
}

module.exports = {
  xlsxCrc32, xlsxDeflateRaw, xlsxU16, xlsxU32, XLSX_DOS_TIME, XLSX_DOS_DATE, xlsxBuildZip, xlsxEscape, xlsxColLetter, xlsxDateSerial, XLSX_PALETTE_HEX, xlsxFieldHref, xlsxBuildStyles, xlsxStylesXml, buildXlsxWorkbook, blankProjectFieldDefs, WIDTHS, defaultFieldDefs, defaultColumnOrder, canonicalColumnOrder, reconcileColumnOrder, FORMAT_VERSION, STORAGE_KEY, SECRETS_KEY, PROJECTS_KEY, SESSION_PROJECT_KEY, IDENTITIES_KEY, COLUMN_WIDTHS_KEY, WRAP_KEY, COLUMN_ORDER_KEY, COLUMN_FILTERS_KEY, UNSET_FILTER_VALUE, issueValueMatchesFilter, computeColumnFilterExcludedIds, COMMENT_READS_KEY, SORT_KEY, SNAPSHOT_INGESTED_KEY, truncate, splitHighlightSegments, relativeAge, formatNow, JIRA_KEY_RE, SF_ID_PREFIXES, salesforceObjectTypeFromId, refInfo, col, pickGithubFields, pickJiraFields, pickSalesforceFields, escapeHtml, renderMarkdownInline, renderMarkdown, commentGroupKey, latestCommentsById, deriveIssueValues, backfillIssueHistoryFromValues, deriveIssueFieldRefs, hydrateIssue, deriveFieldDefs, backfillProjectHistory, hydrateProject, base64FromBytes, bytesFromBase64, base64FromText, textFromBase64, SIGN_ALG, signablePayload, signableProjectPayload, redactedPayload, redactedProjectPayload, signableCommentPayload, redactedCommentPayload, signableProjectCommentPayload, redactedProjectCommentPayload, RULE_NO_OPERAND_OPS, S, ruleCondition, ruleRowCriteria, ruleRowCondition, optionLabelForThen, ruleThenLiteral, compileRuleRows, COLORS, PALETTE_ORDER, buildSource, evalRule, computeBoundValue, isFieldLocked, applyComputedToField, applyLinkedRules, sortValue, computeSortSnapshot, issueCreatedAt,
  importSigningKey, signWithKey, verifyPayload, advanceSortKey, commitSignedEntry,
  squashHistory, displayValueForHistory, buildSourceText, parseJsonl, entryKey, commentKey, unionByKey, mergeIssuePair, computeIssueMerge, computeFieldDefsMerge, computeDerivedChangeEntries,
  buildGithubContentsUrl, buildGithubContentsHeaders, buildGithubCommitMessage, pullGithubFile, pushGithubFile, probeGithubRepoAccess
};
