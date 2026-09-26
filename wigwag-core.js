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
// Same epoch as xlsxDateSerial, but takes a raw ms-epoch number directly
// and keeps the fractional day component -- for a timestamp field's own
// value, which already carries real time-of-day precision unlike a plain
// date field's calendar-only string.
function xlsxDateTimeSerial(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return (ms - epoch) / 86400000;
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
      if (def && def.type === 'timestamp') {
        const serial = xlsxDateTimeSerial(raw);
        if (serial == null) return '';
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
// Includes the two sentinel ids (see below) so every "doc" builder that
// seeds a brand-new project's columnOrder straight from this function
// (import/paste/remote-fetch flows) gets a table with a working Title
// column and comment indicator immediately, with no dependency on also
// running it through reconcileColumnOrder first.
function defaultColumnOrder() { return [...SENTINEL_COLUMN_IDS, 'type', 'priority', 'linked', 'rag', 'teams', 'mitigation']; }
// Two fixed positions inside columnOrder that don't correspond to a real
// field -- they mark where the Title cell and the comment-count
// indicator render, so a real field can be moved to sit before Title or
// between Title and the indicator (previously impossible: both were
// hardcoded ahead of columnOrder's own render loop in the template,
// regardless of what columnOrder contained). Never draggable themselves,
// only valid drop targets -- see dropCol()/dragOverCol() call sites.
const TITLE_COL_ID = '__title__';
const COMMENTS_COL_ID = '__comments__';
const SENTINEL_COLUMN_IDS = [TITLE_COL_ID, COMMENTS_COL_ID];
// Strips the two sentinels back out for every call site that only ever
// meant "the real fields" (bulk-set-field menu, slide-over field list,
// mobile row detail, the per-row cell builder) -- none of those need to
// learn about sentinels individually.
function realColumnOrder(columnOrder) {
  return (columnOrder || []).filter(id => !SENTINEL_COLUMN_IDS.includes(id));
}
// 'comments' is excluded the same way 'title' is: both have a fixed
// sentinel position (see SENTINEL_COLUMN_IDS) rather than sitting among
// the ordinary reorderable fields, even though (tracker #108/a91db807)
// it's now a real fieldDefs entry like any other -- only its POSITION
// stays special, not its underlying storage/mechanism.
function canonicalColumnOrder(fieldDefs, hiddenFieldIds) {
  const visible = Object.keys(fieldDefs).filter(id => id !== 'title' && id !== 'comments' && !hiddenFieldIds.includes(id));
  const known = defaultColumnOrder().filter(id => visible.includes(id));
  const rest = visible.filter(id => !known.includes(id));
  return [...SENTINEL_COLUMN_IDS, ...known, ...rest];
}
function reconcileColumnOrder(override, fieldDefs, hiddenFieldIds) {
  const visible = Object.keys(fieldDefs).filter(id => id !== 'title' && id !== 'comments' && !hiddenFieldIds.includes(id));
  const fromOverride = (override || []).filter(id => visible.includes(id) || SENTINEL_COLUMN_IDS.includes(id));
  const missing = visible.filter(id => !fromOverride.includes(id));
  // A persisted columnOrder from before this feature existed has neither
  // sentinel -- prepend both at the very front (their historical,
  // hardcoded position) so an existing layout looks identical after
  // upgrading, rather than silently relocating Title/Comments.
  const missingSentinels = SENTINEL_COLUMN_IDS.filter(id => !fromOverride.includes(id));
  let result = missingSentinels.length ? [...missingSentinels, ...fromOverride] : fromOverride;
  if (missing.length) {
    const canonicalRest = canonicalColumnOrder(fieldDefs, hiddenFieldIds).filter(id => missing.includes(id));
    result = [...result, ...canonicalRest];
  }
  return result;
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
  if (filterDef.type === 'date') {
    // Unlike select/multiselect, a missing value is never a wildcard match
    // for an active date filter -- it's excluded, same as the handoff spec.
    if (value == null || value === '') return false;
    if (selected.from && value < selected.from) return false;
    if (selected.to && value > selected.to) return false;
    return true;
  }
  if (filterDef.type === 'timestamp') {
    // Same range-filter UI/semantics as 'date' (presets, from/to), but the
    // value is a raw ms-epoch number rather than a YYYY-MM-DD string, so
    // the boundary strings need converting to comparable epoch bounds
    // first -- a plain string compare here would silently never match.
    if (value == null || value === '') return false;
    if (selected.from && value < new Date(selected.from + 'T00:00:00').getTime()) return false;
    if (selected.to && value > new Date(selected.to + 'T23:59:59.999').getTime()) return false;
    return true;
  }
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
function columnFilterIsActive(filterValue) {
  if (!filterValue) return false;
  return Array.isArray(filterValue) ? filterValue.length > 0 : !!(filterValue.from || filterValue.to);
}
function computeColumnFilterExcludedIds(columnFilters, issues, fieldDefs) {
  const activeCols = Object.keys(columnFilters).filter(colId => fieldDefs[colId] && columnFilterIsActive(columnFilters[colId]));
  if (!activeCols.length) return [];
  return issues
    .filter(iss => !activeCols.every(colId => issueValueMatchesFilter(iss.values[colId], fieldDefs[colId], columnFilters[colId])))
    .map(iss => iss.id);
}
// Presets for the date-column filter (tracker #88) -- takes "now" as a
// parameter rather than reading Date.now() internally so it stays a pure,
// testable function. Computed from LOCAL calendar-day components, not
// toISOString() (which is UTC and can land on the wrong day depending on
// the viewer's timezone offset from midnight).
function localISODate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function dateFilterPresetRanges(now) {
  const daysAgo = n => { const d = new Date(now); d.setDate(d.getDate() - n); return localISODate(d); };
  const today = localISODate(now);
  const monthStart = localISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'last7', label: 'Last 7 days', from: daysAgo(6), to: today },
    { key: 'last30', label: 'Last 30 days', from: daysAgo(29), to: today },
    { key: 'thisMonth', label: 'This month', from: monthStart, to: today }
  ];
}
// Tracker #113 (bcee4751): GitHub-Projects-style `field:value` tokens in
// the same filter-bar text box the plain keyword search already uses --
// splits on whitespace, treating a "quoted span" (even embedded right
// after a colon, e.g. status:"In Progress") as one token so a
// multi-word value survives tokenizing.
function tokenizeFilterQuery(query) {
  return String(query || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
}
// commentStream fields have no single stored string/option value to
// filter by (their data lives in commentStreams, not issue.values) --
// excluded from field:value recognition entirely, so a label collision
// with one just falls back to plain keyword text instead of silently
// matching nothing.
function filterableFieldEntries(fieldDefs) {
  return Object.keys(fieldDefs)
    .filter(colId => fieldDefs[colId] && fieldDefs[colId].label && fieldDefs[colId].type !== 'commentStream')
    .map(colId => ({ colId, def: fieldDefs[colId] }));
}
// Splits a raw filter-bar string into recognized `field:value` tokens and
// whatever's left over (kept as the classic keyword-search remainder).
// A token only counts as a field token when its label actually matches a
// real, filterable field -- an unrecognized "label" (typo, or genuinely
// just a keyword containing a colon) falls back to plain keyword text
// rather than being silently dropped.
// A label or value that contains whitespace (e.g. the field "Delivery
// teams", or a value like "In Progress") round-trips through the filter
// bar quoted -- strip a matching pair of surrounding quotes before using
// either side of a token for real.
function stripQuotes(s) {
  return (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) ? s.slice(1, -1) : s;
}
function parseFilterQuery(query, fieldDefs) {
  const tokens = tokenizeFilterQuery(query);
  const labelToColId = {};
  for (const { colId, def } of filterableFieldEntries(fieldDefs)) labelToColId[def.label.toLowerCase()] = colId;
  const fieldTokens = [];
  const keywordParts = [];
  for (const tok of tokens) {
    // A leading "-" negates the token (-status:done -> exclude Done),
    // same convention GitHub's own issue search uses. Only recognized
    // once the rest actually resolves to a real field:value pair below --
    // a bare "-something" that doesn't parse that way falls through to
    // plain keyword text UNCHANGED (dash included), same as any other
    // unrecognized token.
    const negated = tok.length > 1 && tok.startsWith('-');
    const body = negated ? tok.slice(1) : tok;
    const colonIdx = body.indexOf(':');
    let matched = false;
    if (colonIdx > 0) {
      const label = stripQuotes(body.slice(0, colonIdx)).toLowerCase();
      const rawValue = stripQuotes(body.slice(colonIdx + 1));
      const colId = labelToColId[label];
      if (colId && rawValue) { fieldTokens.push({ colId, rawValue, negated }); matched = true; }
    }
    if (!matched) keywordParts.push(stripQuotes(tok));
  }
  return { fieldTokens, keyword: keywordParts.join(' ') };
}
function resolveFieldTokenOptionId(def, rawValue) {
  const q = rawValue.toLowerCase();
  const opt = (def.options || []).find(o => o.id.toLowerCase() === q || (o.label || '').toLowerCase() === q);
  return opt ? opt.id : null;
}
// null means "this token doesn't resolve to anything real" -- the caller
// treats that as ignore-this-token (still typing toward a valid value,
// e.g. mid-autocomplete) rather than a filter that excludes every issue.
function issueMatchesFieldToken(issue, colId, def, rawValue) {
  if (def.type === 'select') {
    const optId = resolveFieldTokenOptionId(def, rawValue);
    return optId ? issue.values[colId] === optId : null;
  }
  if (def.type === 'multiselect') {
    const optId = resolveFieldTokenOptionId(def, rawValue);
    return optId ? (issue.values[colId] || []).includes(optId) : null;
  }
  if (def.type === 'date') {
    const value = issue.values[colId];
    if (!value) return false;
    const q = rawValue.toLowerCase();
    const preset = dateFilterPresetRanges(new Date()).find(p => p.key.toLowerCase() === q || p.label.toLowerCase() === q);
    if (preset) return value >= preset.from && value <= preset.to;
    return value === rawValue;
  }
  if (def.type === 'timestamp') {
    // Only presets make sense here -- the value is a ms-epoch number with
    // no typed representation a user could match verbatim the way a date
    // field's own YYYY-MM-DD value can.
    const value = issue.values[colId];
    if (!value) return false;
    const q = rawValue.toLowerCase();
    const preset = dateFilterPresetRanges(new Date()).find(p => p.key.toLowerCase() === q || p.label.toLowerCase() === q);
    if (!preset) return null;
    return value >= new Date(preset.from + 'T00:00:00').getTime() && value <= new Date(preset.to + 'T23:59:59.999').getTime();
  }
  // text / issue: freeform, no enumerable value set to resolve against --
  // a plain case-insensitive substring match, same spirit as the classic
  // keyword search this sits alongside.
  const value = issue.values[colId];
  return typeof value === 'string' && value.toLowerCase().includes(rawValue.toLowerCase());
}
// Multiple POSITIVE tokens on the SAME field OR together (status:done
// status:"in progress" matches either); multiple NEGATIVE tokens on the
// same field AND together as exclusions (-status:done -status:wontfix
// means matching NEITHER); a field's positive and negative tokens (if
// both present) combine with AND; different fields always AND together --
// mirrors the existing checkbox column-filter semantics for the positive
// case, so the two mechanisms feel consistent even though they're
// independent layers.
function issueMatchesFieldTokens(issue, fieldTokens, fieldDefs) {
  const positiveByCol = {};
  const negativeByCol = {};
  for (const t of fieldTokens) {
    const bucket = t.negated ? negativeByCol : positiveByCol;
    (bucket[t.colId] = bucket[t.colId] || []).push(t.rawValue);
  }
  for (const colId in positiveByCol) {
    const def = fieldDefs[colId];
    if (!def) continue;
    const results = positiveByCol[colId].map(rv => issueMatchesFieldToken(issue, colId, def, rv)).filter(r => r !== null);
    if (results.length && !results.some(Boolean)) return false;
  }
  for (const colId in negativeByCol) {
    const def = fieldDefs[colId];
    if (!def) continue;
    // null (unresolved value -- still mid-autocomplete) is ignored here
    // too, same "not a real filter yet" treatment as the positive case --
    // it must never accidentally exclude everything.
    const results = negativeByCol[colId].map(rv => issueMatchesFieldToken(issue, colId, def, rv)).filter(r => r !== null);
    if (results.some(Boolean)) return false;
  }
  return true;
}
// The autocomplete panel's own data: what to suggest for whichever token
// is currently being typed (assumes the cursor sits at the end of the
// input, same simplifying assumption the existing #id jump feature
// already makes). No suggestions once a token is "closed" (query ends in
// whitespace) or nothing's been typed for it yet.
function computeFilterSuggestions(query, fieldDefs) {
  const none = { mode: null, colId: null, items: [] };
  // An empty box, or a query that just closed its last token with a
  // trailing space, means the NEXT token hasn't started yet -- treat
  // that the same as an empty in-progress token (suggests every field)
  // rather than showing nothing, so clicking into the box (or finishing
  // one token) always offers the full field list to keep typing from.
  const emptyToken = !query || /\s$/.test(query);
  const tokens = tokenizeFilterQuery(query);
  let current = emptyToken ? '' : tokens[tokens.length - 1];
  // Strip a leading "-" (negation) before matching -- carried through as
  // `negated` on every suggested item, so commitFilterSuggestion can put
  // it back. A lone "-" (nothing typed after it yet) is left alone: it
  // won't match any field label, so this naturally suggests nothing yet
  // rather than guessing.
  const negated = current.length > 1 && current.startsWith('-');
  if (negated) current = current.slice(1);
  const entries = filterableFieldEntries(fieldDefs);
  const colonIdx = current.indexOf(':');
  if (colonIdx === -1) {
    const q = current.toLowerCase();
    const items = entries.filter(({ def }) => def.label.toLowerCase().startsWith(q))
      .map(({ colId, def }) => ({ kind: 'field', colId, label: def.label, negated }));
    return items.length ? { mode: 'field', colId: null, items } : none;
  }
  const label = stripQuotes(current.slice(0, colonIdx)).toLowerCase();
  let rawValue = current.slice(colonIdx + 1);
  // stripQuotes only unwraps a genuinely CLOSED quoted pair (e.g. re-
  // parsing an already-committed value with no trailing space after it,
  // now that committing one doesn't force a space -- see
  // commitFilterSuggestion); a still-open quote (mid-typing, no closing
  // quote yet) falls back to stripping just the leading one.
  const strippedValue = stripQuotes(rawValue);
  if (strippedValue !== rawValue) rawValue = strippedValue;
  else if (rawValue.startsWith('"')) rawValue = rawValue.slice(1);
  const match = entries.find(({ def }) => def.label.toLowerCase() === label);
  if (!match) return none;
  const { colId, def } = match;
  const q = rawValue.toLowerCase();
  let items = [];
  if (def.type === 'select' || def.type === 'multiselect') {
    items = (def.options || []).filter(o => (o.label || '').toLowerCase().startsWith(q))
      .map(o => ({ kind: 'value', colId, value: o.label, color: o.color, negated }));
  } else if (def.type === 'date') {
    items = dateFilterPresetRanges(new Date()).filter(p => p.label.toLowerCase().startsWith(q))
      .map(p => ({ kind: 'value', colId, value: p.label, negated }));
  }
  return items.length ? { mode: 'value', colId, items } : none;
}
// Replaces the in-progress last token with the chosen suggestion's text --
// a field suggestion leaves the colon open for the value (e.g. "RAG:", or
// "\"Delivery teams\":" when the label itself has a space -- quoted the
// same way a multi-word VALUE already was, so re-parsing this same text
// later finds the label as one token, not split on its own space), no
// trailing space so the next keystroke stays part of the same token. A
// value suggestion closes the token the same way, also with no trailing
// space -- the user types their own separating space when they're ready
// to start another criterion (computeFilterSuggestions only offers the
// full field list again once the query actually ends in whitespace), so
// clicking never presumes a next token is coming.
//
// The query only actually HAS an in-progress last token to replace when
// it doesn't already end in whitespace -- if it does (a real, deliberate
// trailing space, or an empty box), every existing token is already
// complete/committed, so the new one is ADDED, not popped in place of the
// most recent real one.
function commitFilterSuggestion(query, suggestion, fieldDefs) {
  const def = fieldDefs[suggestion.colId];
  const label = /\s/.test(def.label) ? '"' + def.label + '"' : def.label;
  const prefix = suggestion.negated ? '-' : '';
  const emptyToken = !query || /\s$/.test(query);
  const tokens = tokenizeFilterQuery(query);
  if (!emptyToken) tokens.pop();
  if (suggestion.kind === 'field') {
    tokens.push(prefix + label + ':');
    return tokens.join(' ');
  }
  const needsQuote = /\s/.test(suggestion.value);
  tokens.push(prefix + label + ':' + (needsQuote ? '"' + suggestion.value + '"' : suggestion.value));
  return tokens.join(' ');
}
const COMMENT_READS_KEY = 'git_native_tracker_comment_reads_v1';
// Mention notifications (tracker issue #65, 178b0afa): a per-browser
// on/off preference (like appearance/columnWidths -- not project data,
// never exported) and a capped log of comment ids already delivered as a
// browser notification, so a poll that re-sees an already-notified
// comment (or a fresh page load re-hydrating the same project) never
// re-fires for it. Capped generously since it only needs to outlive
// however long comment ids realistically stick around in local state.
const MENTION_NOTIFICATIONS_KEY = 'git_native_tracker_mention_notifications_v1';
const NOTIFIED_MENTIONS_KEY = 'git_native_tracker_notified_mentions_v1';
const NOTIFIED_MENTIONS_CAP = 1000;
// A mention is the target's email appearing anywhere in the text, with or
// without a leading "@", word-bounded on both sides so "tom@lant.uk.evil.com"
// or "nottom@lant.uk" don't also count as mentioning "tom@lant.uk".
function textMentionsEmail(text, email) {
  if (!text || !email) return false;
  const esc = String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Negative lookahead/lookbehind (not \b) for both boundaries -- "." and
  // "-" are non-word chars, so \b alone would still call this a match
  // inside "nottom@lant.uk.evil.com" (a boundary exists right after "uk",
  // and before "tom", either way). Anything that could extend the email on
  // either side -- word char, dot, hyphen -- must not be adjacent to the
  // match.
  return new RegExp('(?<![\\w.-])' + esc + '(?![\\w.-])', 'i').test(text);
}
// Sort (ascending/descending): cosmetic-only, per-browser, per-project --
// same reasoning again. { [projectId]: { colId, dir } }.
const SORT_KEY = 'git_native_tracker_sort_v1';
// Project ids already ingested from an embedded "Export as HTML" snapshot
// -- an id only gets seeded-and-switched-to once, on the recipient's first
// ever open of that particular exported file, never again on later opens.
const SNAPSHOT_INGESTED_KEY = 'git_native_tracker_snapshot_ingested_v1';

function truncate(s, n) { if (!s) return s; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
// Powers the filter box's "jump, not filter" mode (tracker issue #62,
// bb9acbd4): an ID-shaped query (4+ hex/dash chars) that actually matches
// something switches the box from narrowing the table to offering the
// issue directly. Deliberately a PREFIX match against the full issue.id
// (never substring) -- a UUID's interior is meaningless to match on, and
// prefix is what a user pastes from a shortRef or a full id alike.
// Capped at 8 and sorted ascending so the panel's own list is stable and
// bounded regardless of how many issues share a prefix.
function matchingIssuesByIdPrefix(issues, query) {
  const stripped = String(query == null ? '' : query).trim().replace(/^#/, '');
  if (stripped.length < 4 || !/^[0-9a-f-]+$/i.test(stripped)) return [];
  const q = stripped.toLowerCase();
  return (issues || [])
    .filter(function (iss) { return String(iss.id || '').toLowerCase().indexOf(q) === 0; })
    .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
    .slice(0, 8);
}
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
// mutation): an edit appends a NEW entry to issues[].commentStreams[fieldId] sharing the
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
// Same wigwag: URI shape renderMarkdownInline's own prose-link detection
// matches (see its push('<a ... class="wigwag-ref-pill" ...')) -- pulled
// out so a caller that can't lean on the full markdown pipeline can reuse
// exactly the same detection. type:'issue' fields (Title chief among
// them) are deliberately single-line and never markdown-rendered, so an
// embedded reference mid-value -- as opposed to a fieldRef occupying the
// WHOLE value, which paste-to-resolve already handles -- had no path to
// becoming a real pill at all; this is that path.
const WIGWAG_URI_IN_TEXT_RE = /\bwigwag:\/(?:project|remote)\/[^\s<]+/g;
function splitEmbeddedWigwagLinks(text) {
  const s = String(text == null ? '' : text);
  const segments = [];
  let last = 0;
  WIGWAG_URI_IN_TEXT_RE.lastIndex = 0;
  let m;
  while ((m = WIGWAG_URI_IN_TEXT_RE.exec(s))) {
    if (m.index > last) segments.push({ text: s.slice(last, m.index), isLink: false });
    segments.push({ text: m[0], isLink: true });
    last = m.index + m[0].length;
  }
  if (last < s.length || !segments.length) segments.push({ text: s.slice(last), isLink: false });
  return segments;
}
// tracker issue #104 (29e69c41): pasting a link over a text selection
// wraps that selection in a markdown link instead of replacing it. Only
// triggers when the clipboard content is JUST a bare URL -- pasting a
// paragraph that happens to contain a link is a normal paste, not this.
function isPastedTextASingleUrl(text) {
  return /^https?:\/\/\S+$/.test(String(text == null ? '' : text).trim());
}
function wrapSelectionWithMarkdownLink(value, selStart, selEnd, url) {
  const selected = value.slice(selStart, selEnd);
  return value.slice(0, selStart) + '[' + selected + '](' + url + ')' + value.slice(selEnd);
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
  // Bare Matrix user ids (@localpart:server) -> the same person-pill
  // treatment an email address gets, minus the mailto: link -- there's no
  // universal, safely-clickable URI scheme for one here. The leading `@`
  // is what the plain email regex above can never match (it requires a
  // non-empty local part before the `@`), so there's no overlap between
  // the two passes.
  out = out.replace(/@[^\s:@]+:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g, function (mxid) {
    const colon = mxid.indexOf(':');
    const local = mxid.slice(0, colon), domain = mxid.slice(colon);
    return push('<span title="Matrix ID ' + mxid + '" class="email-pill"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4" r="2.1" stroke="currentColor" stroke-width="1.2"></circle><path d="M2.3 10.2c0-2.05 1.66-3.3 3.7-3.3s3.7 1.25 3.7 3.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path></svg><span>' + local + '<span style="opacity:0.6;">' + domain + '</span></span></span>');
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
// Matches a list-item line at any indentation -- capture groups are
// (indent whitespace, marker, content). A leading-whitespace variant is
// deliberately allowed at both the block-start check and the consume
// loop below, so a nested/indented item is recognized as a list item at
// all (rather than falling through to plain paragraph text, dash and
// all) and its indent depth drives real <ul>/<ol> nesting.
const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
// Groups a flat, indent-tagged list into a tree by relative indent depth
// -- deliberately not a fixed 2-/4-space tab width, so any consistent
// indent step nests correctly. minIndent is the indent of the first item
// at this level; a run of items at exactly that level are siblings, and
// a jump to a deeper indent recurses into the previous sibling's children.
function buildListTree(flat) {
  function build(pos, minIndent) {
    const items = [];
    let ordered = null;
    while (pos.i < flat.length && flat[pos.i].indent >= minIndent) {
      const cur = flat[pos.i];
      if (ordered === null) ordered = cur.ordered;
      pos.i++;
      let children = null;
      if (pos.i < flat.length && flat[pos.i].indent > cur.indent) children = build(pos, flat[pos.i].indent);
      items.push({ content: cur.content, children });
    }
    return { ordered, items };
  }
  return build({ i: 0 }, flat.length ? flat[0].indent : 0);
}
function renderListTree(tree) {
  const tag = tree.ordered ? 'ol' : 'ul';
  return '<' + tag + '>' + tree.items.map(function (it) {
    return '<li>' + renderMarkdownInline(it.content) + (it.children ? renderListTree(it.children) : '') + '</li>';
  }).join('') + '</' + tag + '>';
}
function renderMarkdown(raw) {
  const text = String(raw == null ? '' : raw);
  // Tracker #123 (d100c705)'s own conflict-marker grammar collides with
  // markdown's: a line starting with ">>>>>>> ..." reads as a blockquote,
  // and a lone "=======" line reads as a setext-heading underline for
  // whatever text preceded it. Any text carrying real, unresolved merge
  // markers is rendered as plain, escaped, whitespace-preserved text
  // instead -- never run through markdown interpretation -- so the
  // markers display literally rather than being mangled.
  if (hasUnresolvedMergeMarkers(text)) {
    return '<pre class="merge-markers-raw" style="white-space:pre-wrap; word-break:break-word; font-family:inherit; margin:0;">' + escapeHtml(text) + '</pre>';
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
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
    if (LIST_ITEM_RE.test(line)) {
      flush();
      const flat = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM_RE);
        if (!m) break;
        flat.push({ indent: m[1].length, ordered: /^\d+\.$/.test(m[2]), content: m[3] });
        i++;
      }
      parts.push(renderListTree(buildListTree(flat)));
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

// Created/Updated (type: 'timestamp') are never written via history --
// always derived straight from the issue's own activity, including
// comment streams (a new comment counts as an update, same as any field
// edit). Returns a raw ms-epoch number, not a formatted string, so
// precise relative-age display and numeric sorting both work for free.
function issueActivitySortKeys(issue) {
  const keys = (issue.history || []).map(h => h.sortKey).filter(k => typeof k === 'number');
  for (const stream in (issue.commentStreams || {})) {
    for (const entry of issue.commentStreams[stream]) {
      if (typeof entry.sortKey === 'number') keys.push(entry.sortKey);
    }
  }
  return keys;
}
function issueTimestampValue(issue, colId) {
  const keys = issueActivitySortKeys(issue);
  if (!keys.length) return null;
  return colId === 'created' ? Math.min(...keys) : Math.max(...keys);
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
    const def = fieldDefs[colId];
    // Always wins over any stray history entry for these ids (there
    // should never be one, but the derived value is authoritative either
    // way -- these fields are computed, not editable).
    if (def.type === 'timestamp') { values[colId] = issueTimestampValue(issue, colId); continue; }
    if (latestByField[colId]) { values[colId] = latestByField[colId].value; continue; }
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
// One-time, idempotent migration: the old top-level `comments` array
// becomes `commentStreams.comments` (tracker #108/a91db807) -- comment
// threads are now a generic per-field mechanism (any commentStream-typed
// field gets its own array the same shape), not a one-off issue property.
// No dual-support kept afterward: once migrated, `comments` is gone from
// the issue object entirely, and every other code path only ever reads/
// writes `commentStreams`.
function migrateLegacyComments(issue) {
  if (!('comments' in issue)) return issue;
  const { comments, ...rest } = issue;
  return { ...rest, commentStreams: { ...(issue.commentStreams || {}), comments: issue.commentStreams && issue.commentStreams.comments ? issue.commentStreams.comments : (comments || []) } };
}
// An issue's deletion state, derived the same "latest signed entry wins"
// way as everything else (tracker #149, live-reported): the Matrix bridge
// replays a room's full timeline on every reconnect, and a hard, unlogged
// removal (the old behavior) leaves nothing to stop an issue's original
// creation event from being read as "newly arrived" and re-added. A real
// reserved field id, never a genuine field (nobody defines one named
// this), makes deletion a normal, mergeable, sync-able fact instead of an
// out-of-band structural operation. No exclusion is needed in
// deriveIssueValues -- it only ever populates keys that exist in
// fieldDefs, and this id is never a real field definition.
const ISSUE_DELETED_FIELD_ID = '__deleted__';
function issueIsDeleted(history) {
  let latest = null;
  for (const h of (history || [])) {
    if (h.field !== ISSUE_DELETED_FIELD_ID || h.value === undefined) continue;
    if (!latest || h.sortKey > latest.sortKey) latest = h;
  }
  return !!(latest && latest.value === true);
}
function hydrateIssue(issue, fieldDefs) {
  const migrated = migrateLegacyComments(issue);
  const backfilled = backfillIssueHistoryFromValues(migrated, fieldDefs);
  return { ...backfilled, values: deriveIssueValues(backfilled, fieldDefs), fieldRefs: deriveIssueFieldRefs(backfilled, fieldDefs), deleted: issueIsDeleted(backfilled.history) };
}
// Project-level counterpart to deriveIssueValues -- but unlike issue
// values (where the SET of fields is fixed by fieldDefs and every value
// has a type-appropriate default), a field's very existence isn't
// derivable from history at all: field deletion stays a direct, unlogged
// removal (unlike issue deletion above, which switched to a real
// tombstone -- tracker #149 -- specifically because the Matrix bridge
// replays full history on reconnect; field definitions aren't replayed
// the same way, so this asymmetry is deliberate, not an oversight), so
// resurrecting a deleted field's old creation entry would be wrong.
// currentFieldDefs is the
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
// A project's name (tracker #149): historically local-only browser
// metadata (PROJECTS_KEY.milestones[].name), with only a NARRATIVE,
// field-less "Renamed project from X to Y" history entry left behind --
// readable by a human in the History tab, but not derivable by another
// browser the way a field definition is. Promoted to a real, derivable
// value here, following the exact same "latest signed entry wins"
// pattern as everything else in this format. Reserved, sentinel field id
// (never a real user-facing field) so it can never collide with an
// actual field definition of the same name -- deriveFieldDefs below
// explicitly excludes it for that reason.
const PROJECT_NAME_FIELD_ID = '__project_name__';
function deriveProjectName(projectHistory) {
  let latest = null;
  for (const h of (projectHistory || [])) {
    if (h.field !== PROJECT_NAME_FIELD_ID || h.value === undefined) continue;
    if (!latest || h.sortKey > latest.sortKey) latest = h;
  }
  // latest.value may itself be null (a tombstone, same convention as
  // deriveFieldDefs) -- returning it as-is collapses to the same "no
  // derived name" result a caller already handles for "never renamed".
  return latest ? latest.value : null;
}
function deriveFieldDefs(projectHistory) {
  const latestByField = {};
  for (const h of (projectHistory || [])) {
    if (!h.field || h.field === PROJECT_NAME_FIELD_ID || h.value === undefined) continue;
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
// Every project gets a commentStream field named 'comments' -- old data
// (from before commentStream fields existed) never had one, so synthesize
// it here. backfillProjectHistory (below) then generates the matching
// projectHistory entry automatically, the same way it already does for
// any other fieldDefs key with no history yet -- no bespoke history-entry
// code needed just for this.
function ensureCommentsFieldDef(fieldDefs) {
  if (Object.values(fieldDefs).some(d => d.type === 'commentStream')) return fieldDefs;
  return { ...fieldDefs, comments: { label: 'Comments', type: 'commentStream' } };
}
// Same pattern as ensureCommentsFieldDef: a project without these two
// reserved ids yet gets them added in-memory here, then
// backfillProjectHistory below turns that into a real backfilled
// project-history entry so it round-trips just like Comments does --
// including "deleting" one just brings it back on the next hydrate,
// which is fine, since neither field is meant to be removable.
function ensureTimestampFieldDefs(fieldDefs) {
  const withCreated = fieldDefs.created ? fieldDefs : { ...fieldDefs, created: { label: 'Created', type: 'timestamp' } };
  return withCreated.updated ? withCreated : { ...withCreated, updated: { label: 'Updated', type: 'timestamp' } };
}
// Shared load-time preparation for a project's schema coming from anywhere
// other than this session's own live edits -- mirrors hydrateIssue.
function hydrateProject(fieldDefs, projectHistory) {
  const ensuredFieldDefs = ensureTimestampFieldDefs(ensureCommentsFieldDef(fieldDefs));
  const backfilled = backfillProjectHistory(ensuredFieldDefs, projectHistory);
  // null (not '') when no field:'name' entry exists yet -- an older
  // project that predates this, or one that's never been renamed -- so a
  // caller can tell "no derived name yet" apart from "derived name is
  // empty" and fall back to its own locally-cached name instead.
  return { fieldDefs: deriveFieldDefs(backfilled), projectHistory: backfilled, projectName: deriveProjectName(backfilled) };
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
// A signed entry's `email` is really the author's *principal*: the
// canonical, stable, human-readable identifier they act under. For a
// locally-configured identity that's an email address; for a
// Matrix-originated identity (see wigwag-matrix-host.html) it's a Matrix
// user id, mirrored into the same `email` slot since the signed payload's
// field set is fixed and an unsigned attribution field would be
// forgeable. The two are unambiguously distinguishable: an MXID is always
// `@localpart:server`, and a real email never starts with `@` -- that
// `@`-prefix rule is the one and only discriminator; nothing else should
// invent a second way to tell them apart.
//
// One principal legitimately having multiple *signing keys* is the
// normal, expected steady state for a Matrix identity (the same person
// reconnecting from a different device mints a new local keypair every
// time -- there is no portable-key mechanism for ANY wigwag identity
// today). If per-entry key-trust (TOFU) is ever wired up against render
// time, "known principal, new key" must be treated as a neutral fact to
// record, not a warning to raise -- otherwise every multi-device Matrix
// user would trip it constantly.
const MATRIX_USER_ID_RE = /^@[^\s:]+:[^\s:]+$/;
function principalKind(principal) { return MATRIX_USER_ID_RE.test(String(principal || '')) ? 'matrix' : 'email'; }
function identityPrincipal(identity) { return (identity && (identity.email || identity.matrixUserId)) || ''; }
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
// Tracker #112 (b564316d): a persisted fieldRef for an externally-linked
// source (github/jira/salesforce) only ever carries display fields now
// (owner/repo/num, key/browseUrl, id/name/url) -- never the maximalist
// picked set (labels/status/etc, or Salesforce's whole field map), so a
// rule reading source.<system>.foo can't be safely re-evaluated from what
// disk actually holds. Detected structurally, on the RAW ref (before
// pickGithubFields/pickJiraFields/pickSalesforceFields default every key
// in): a trimmed github ref never has 'labels' at all; trimmed jira never
// has 'status'; trimmed salesforce never has 'fields'. This is also how
// the fetch/refresh flow's own transient, in-memory-only enriched ref
// (used to recompute bound fields against a live payload, then discarded
// before anything is persisted -- see applyGithubLinkToField and its
// Jira/Salesforce counterparts) is told apart from the real, trimmed one:
// the enriched ref legitimately has all those keys, so this same
// function safely takes the live-eval path for it.
function sourceRefHasFullData(ref) {
  if (!ref) return true; // no ref at all -- nothing to trim, buildSource's isLinked gate handles this
  if (ref.system === 'github') return 'labels' in ref;
  if (ref.system === 'jira') return 'status' in ref;
  if (ref.system === 'salesforce') return 'fields' in ref;
  return true; // wigwag (or any other system) was never given the maximalist treatment
}
// The history entry (if any) that most recently set colId's value --
// used to tell a rule-derived value apart from a manual one when the
// rule itself can no longer be safely re-run (see sourceRefHasFullData).
function latestEntryForField(issue, colId) {
  let latest = null;
  for (const h of issue.history || []) {
    if (h.field === colId && (!latest || (h.sortKey || 0) > (latest.sortKey || 0))) latest = h;
  }
  return latest;
}
// { isLinked:false } short-circuits before the rule even runs, for fields
// with no rule/no bound source AND for bound-but-not-yet-linked rows —
// callers use isLinked to decide whether to lock the cell / overwrite its
// materialized value at all.
function computeBoundValue(issue, colId, def) {
  if (!def.rule || !def.linkedSourceId) return { isLinked: false, computed: undefined };
  const sourceRef = issue.fieldRefs && issue.fieldRefs[def.linkedSourceId];
  if (!sourceRef) return { isLinked: false, computed: undefined };
  if (!sourceRefHasFullData(sourceRef)) {
    // Can't re-run the rule -- trust the last value a live refresh
    // actually computed, tracked via an explicit origin:'derived' marker
    // on this field's own most recent entry. Tracker #66's "a null
    // computation unlocks the field" behavior falls out of this for
    // free: a null result is never written (see applyLinkedRules below),
    // so a field that's never been refreshed, or whose last refresh
    // computed null, simply has no derived entry to find here.
    const latest = latestEntryForField(issue, colId);
    const locked = !!latest && latest.origin === 'derived';
    return { isLinked: true, computed: locked ? issue.values[colId] : undefined };
  }
  const source = buildSource(issue, def.linkedSourceId);
  return { isLinked: true, computed: evalRule(def.rule, source, issue.values) };
}
// Whether a field is currently rule-derived (and therefore locked from
// manual/bulk edit) for a specific issue -- every cell builder already
// inlines this same check; bulk Set-field is the first caller that needs
// it outside a per-cell render, hence pulling it out to a name.
// Locked only while the rule has a REAL (non-null) answer -- tracker
// issue #66 (bfdbe595): a rule that computes null for this issue leaves
// the field open for the user to fill in by hand instead of permanently
// blank. computed:[] (a multiselect rule deliberately choosing "no
// options") is a real answer, not null, and stays locked.
function isFieldLocked(issue, colId, def) {
  const bound = computeBoundValue(issue, colId, def);
  return bound.isLinked && bound.computed != null;
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
    const bound = computeBoundValue(iss, colId, def);
    // A null computed value means "hands off" (see isFieldLocked above) --
    // don't clear or overwrite whatever's currently there, whether that's
    // blank (never touched) or a manual override the user typed in while
    // the rule had nothing to say. The moment the rule computes a real
    // value again, this resumes overwriting on the very next call, same
    // as it always has -- the override is discarded with no special
    // tracking needed anywhere.
    if (!bound.isLinked || bound.computed == null) continue;
    values = applyComputedToField(values, colId, def, bound.computed);
  }
  return values === iss.values ? iss : { ...iss, values };
}
// Tracker #112 (b564316d): applyLinkedRules re-evaluates every bound field
// from the (now display-only, for an external system) PERSISTED fieldRef
// -- fine for a plain- or wigwag-sourced field, a no-op for one sourced
// from github/jira/salesforce (see computeBoundValue/sourceRefHasFullData
// above). This is the counterpart used at fetch/refresh time, when the
// caller has the real, live payload for sourceColId in hand -- evaluates
// only the fields bound to THAT source, against liveData directly, never
// touching issue.fieldRefs (which stays display-only; fieldRefs is
// derived purely from history, so there is no "temporarily attach the
// full payload" shortcut -- see deriveIssueFieldRefs). Same "null means
// hands off" rule as applyLinkedRules. Known gap: a copy-field-mode bound
// field's ROW CONDITION (computeBoundFieldRef, tracker #66 Part 2) still
// evaluates against the persisted (trimmed) ref, not liveData, if that
// condition itself reads source.<system>.foo -- narrow enough (condition
// text, not the common case of a plain value rule) to leave as a
// documented limitation rather than threading liveData through that path
// too.
function applyLiveLinkedRules(iss, fieldDefs, sourceColId, system, liveData) {
  const source = {
    text: iss.values[sourceColId] || '', isLinked: true,
    github: system === 'github' ? pickGithubFields(liveData) : null,
    jira: system === 'jira' ? pickJiraFields(liveData) : null,
    salesforce: system === 'salesforce' ? pickSalesforceFields(liveData) : null
  };
  let values = iss.values;
  for (const colId in fieldDefs) {
    const def = fieldDefs[colId];
    if (def.linkedSourceId !== sourceColId || !def.rule) continue;
    const computed = evalRule(def.rule, source, iss.values);
    if (computed == null) continue;
    values = applyComputedToField(values, colId, def, computed);
  }
  return values === iss.values ? iss : { ...iss, values };
}
// Tracker issue #66 (bfdbe595), Part 2: an issue-type bound field's THEN
// can be "copy field X" instead of a literal/expression -- row.then still
// compiles to a plain expression (values.X, via the existing "=" escape
// hatch) so computeBoundValue's own single-expression evaluation needs no
// changes for the VALUE. But a copied field's REAL link (fieldRef) can't
// come out of a bare expression evaluation, and computeBoundValue only
// ever sees the one fully-compiled rule string, not which row matched --
// so this re-runs the same one-row-at-a-time match rulePreview's results
// table already does, purely to find row.thenCopyFieldRefFrom for the
// winning row. Returns null for advanced/hand-written mode (no ruleRows
// at all), no match, or a row that isn't a field-copy -- the normal
// literal/expression path, unaffected.
function computeBoundFieldRef(issue, def) {
  const rows = Array.isArray(def.ruleRows) ? def.ruleRows : null;
  if (!rows || !def.linkedSourceId) return null;
  const source = buildSource(issue, def.linkedSourceId);
  if (!source.isLinked) return null;
  for (const r of rows) {
    if (!ruleRowCriteria(r).length) continue;
    if (evalRule(ruleRowCondition(r), source, issue.values) === true) {
      return r.thenCopyFieldRefFrom ? ((issue.fieldRefs && issue.fieldRefs[r.thenCopyFieldRefFrom]) || null) : null;
    }
  }
  return null;
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
    // numeric:true makes embedded digit runs compare by value ("2" < "10")
    // instead of character-by-character -- select/multiselect already
    // return zero-padded index strings, so this is a no-op for them; it
    // only changes behavior for text/title values that happen to be (or
    // contain) numbers.
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
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
// full plus a redacted trail for everything superseded. "Latest" is by
// sortKey, not array position -- history is normally already in that
// order (appendSignedHistory always pushes at the end with a monotonic
// sortKey, and unionByKey re-sorts by sortKey after any merge), but
// picking by position would silently keep the wrong entry unredacted if
// that ever weren't true, e.g. clock-skewed entries from a multi-device
// merge landing out of sortKey order in the array.
//
// fieldDefs (optional, only meaningful for an ISSUE's history -- pass
// nothing for projectHistory, whose own entries carry field
// *definitions*, not customer/third-party data) marks the difference
// between a field that's merely been superseded (redact everything but
// its current latest) and one that's been deleted from the project
// entirely (tombstoned in deriveFieldDefs -- gone from fieldDefs). A
// deleted field's "latest" entry serves no live purpose -- nothing in the
// app reads it any more -- so it gets redacted too, not kept around
// forever just because nothing happened to supersede it under its own
// (now-abandoned) field id.
function squashHistory(history, fieldDefs) {
  const latestByField = {};
  for (const h of history) {
    if (!h.field) continue;
    const existing = latestByField[h.field];
    if (!existing || h.sortKey > existing.sortKey) latestByField[h.field] = h;
  }
  const keepIds = new Set(Object.values(latestByField).map(h => h.id));
  return history.map(h => {
    if (!h.field) return h;
    const fieldDeleted = fieldDefs && !(h.field in fieldDefs);
    if (!fieldDeleted && keepIds.has(h.id)) return h;
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
// Dedupes every signed entry's inlined pubKey (a ~180-byte JWK, repeated
// verbatim on every entry from the same identity) into one per-project
// registry keyed by a short sequential id ("k0", "k1", ...) assigned in
// first-seen order -- tracker #132 (68d960f2). Dedup key is the JWK's own
// (x, y) curve coordinates (the actual key material), not JSON.stringify
// equality, since incidental JWK metadata (key_ops array order etc.)
// could otherwise vary without the key itself differing. Deliberately a
// plain synchronous string concatenation, not the existing async
// fingerprintPublicKey (crypto.subtle.digest) used for the user-facing
// TOFU fingerprint -- buildSourceText is called synchronously from many
// call sites (source-size label, GitHub-push diff check, clipboard/
// share), so its own key identity can't require an async hop. This
// registry is purely an internal storage/dedup detail, never shown to a
// user; the real TOFU fingerprint is untouched by this.
function keyRegistryEncoder() {
  const registry = {};
  const seen = new Map();
  function ref(pubKey) {
    if (!pubKey) return null;
    const idKey = pubKey.x + '|' + pubKey.y;
    let r = seen.get(idKey);
    if (!r) { r = 'k' + seen.size; seen.set(idKey, r); registry[r] = pubKey; }
    return r;
  }
  function encode(entry) {
    if (!entry || !entry.pubKey) return entry;
    const { pubKey, ...rest } = entry;
    return { ...rest, keyRef: ref(pubKey) };
  }
  return { registry, encode };
}
// doc: { projectId, projectName, fieldDefs, projectHistory, projectNotes,
// projectComments, issues } -- the full exportable project shape.
function buildSourceText(mode, doc) {
  const { projectId, projectName, fieldDefs, projectHistory: rawProjectHistory, projectNotes, projectComments, issues } = doc;
  const projectHistory = mode === 'squashed' ? squashHistory(rawProjectHistory) : rawProjectHistory;
  const keys = keyRegistryEncoder();
  const encodedProjectHistory = projectHistory.map(keys.encode);
  // A squashed export (tracker #149) drops a tombstoned issue's data
  // entirely, not just its history -- there's no reason a shared/archived
  // snapshot should carry a deleted issue at all. A 'full' export keeps
  // it (tombstone included), since that's exactly what needs to survive
  // for another device/party to correctly see the deletion rather than
  // resurrect the issue from its still-present creation entry.
  const exportedIssues = mode === 'squashed' ? issues.filter(iss => !issueIsDeleted(iss.history)) : issues;
  const issueLines = exportedIssues.map(iss => {
    const history = (mode === 'squashed' ? squashHistory(iss.history, fieldDefs) : iss.history).map(keys.encode);
    const commentStreams = {};
    for (const colId in (iss.commentStreams || {})) commentStreams[colId] = (iss.commentStreams[colId] || []).map(keys.encode);
    return { id: iss.id, num: iss.num, commentStreams, history };
  });
  const lines = [JSON.stringify({ type: 'fields', formatVersion: FORMAT_VERSION, generator: 'wigwag', fields: fieldDefs, projectHistory: encodedProjectHistory, keys: Object.keys(keys.registry).length ? keys.registry : undefined, id: projectId, name: projectName || undefined, projectNotes: projectNotes || undefined, projectComments: (projectComments && projectComments.length) ? projectComments : undefined })];
  for (const line of issueLines) lines.push(JSON.stringify({ type: 'issue', ...line }));
  return lines.join('\n');
}

// --- Merge provenance (tracker #122, a61676e0): signed export envelope
// and per-sender TOFU trust, per the merge_provenance.zip handoff --------
//
// The handoff specifies real SSH ed25519 signatures (ssh-keygen -Y sign/
// verify, an allowed_signers file). That's infeasible here: wigwag is a
// pure browser PWA with no filesystem or SSH-agent access. Reuses the
// EXISTING WebCrypto ECDSA P-256 identity-key signing instead (already
// used for every history entry -- see importSigningKey/signWithKey/
// verifyPayload above), applied one level up: to the export as a whole,
// not each entry within it. This is a second, complementary TOFU axis --
// "who exported this FILE" (an export transaction, e.g. Dave exporting a
// file that contains Tony's edits) -- distinct from the existing per-
// entry "who authored this EDIT" trust already documented in
// docs/FORMAT.md's "Identity and signing" section.
//
// exported_by is deliberately NOT the same thing as any edit's own
// author -- these differ constantly and conflating them is the mistake
// the handoff calls out first.
const WIGWAG_EXPORT_TYPE = 'wigwag.export';
const WIGWAG_EXPORT_VERSION = 1;

// The exact bytes that get hashed/signed: every record line (everything
// after the envelope), each terminated by \n, concatenated in file order
// -- matches buildSourceText's own one-line-per-record output, just
// pinning down the terminator convention so the hash is a pure function
// of content, independent of how a caller later joins/serializes lines.
function canonicalRecordsText(recordsBody) {
  if (!recordsBody) return '';
  return recordsBody.split('\n').filter(l => l.length).map(l => l + '\n').join('');
}

async function computeContentSha256Hex(recordsBody) {
  const bytes = new TextEncoder().encode(canonicalRecordsText(recordsBody));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// A short, stable, human-comparable identifier for a public key -- the
// TOFU comparison key, and what a future "Trust this key"/"Keep the old
// one" UI (tracker #124) would name. Derived from the JWK's own
// coordinates only (crv/x/y), not the whole object, so unrelated JWK
// metadata never perturbs it.
async function fingerprintPublicKey(pubKeyJwk) {
  if (!pubKeyJwk) return null;
  const canonical = JSON.stringify({ crv: pubKeyJwk.crv, x: pubKeyJwk.x, y: pubKeyJwk.y });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return 'SHA256:' + base64FromBytes(new Uint8Array(digest));
}

// Builds the envelope line for an export. publicKeyJwk/privateKeyJwk are
// the EXPORTING identity's own signing keypair -- the same one already
// used to sign every history entry. Signing is opt-in per identity,
// mirroring the existing per-entry rule: omit `sig` entirely (never
// generate a key silently) when the identity has none. The signature
// covers the ASCII hex of content_sha256, not the raw records -- cheap
// to verify, and it means the signature survives a re-hash if the
// envelope itself is ever rewritten (matches the handoff's own §1.3,
// substituting the signing primitive only).
async function buildExportEnvelope({ exportedBy, exportedAt, project, tracker, recordsBody, publicKeyJwk, privateKeyJwk }) {
  const recordLines = (recordsBody || '').split('\n').filter(l => l.length);
  const contentSha256 = await computeContentSha256Hex(recordsBody);
  const envelope = {
    type: WIGWAG_EXPORT_TYPE, v: WIGWAG_EXPORT_VERSION,
    exported_by: exportedBy || '', exported_at: exportedAt,
    project: project || undefined, tracker: tracker || undefined,
    records: recordLines.length, content_sha256: contentSha256
  };
  if (privateKeyJwk && publicKeyJwk) {
    const key = await importSigningKey(privateKeyJwk);
    const sig = await signWithKey(key, contentSha256);
    if (sig) envelope.sig = { alg: 'ECDSA-P256', pubKeyJwk: publicKeyJwk, sig };
  }
  return envelope;
}

// Splits a possibly-enveloped export back into { envelope, recordsBody }.
// A file with no real envelope on line 1 is v0 -- unsigned, unattributed,
// and every line is still a record; the whole text passes through as the
// records body unchanged (existing parseJsonl callers need no changes at
// all: it already ignores any line whose `type` it doesn't recognize,
// which is exactly how an envelope line reads to it today).
function parseExportEnvelope(text) {
  const nlIdx = text.indexOf('\n');
  const firstLine = nlIdx === -1 ? text : text.slice(0, nlIdx);
  let candidate = null;
  try { candidate = JSON.parse(firstLine); } catch (e) { /* not JSON -- v0 */ }
  if (candidate && typeof candidate === 'object' && candidate.type === WIGWAG_EXPORT_TYPE) {
    return { envelope: candidate, recordsBody: nlIdx === -1 ? '' : text.slice(nlIdx + 1) };
  }
  return { envelope: null, recordsBody: text };
}

// Verifies an envelope against the records body it claims to describe.
// hashValid is meaningful even for an unsigned envelope (a bot/CI export
// can still assert a hash worth checking); sigValid is null (not false)
// when there's no signature to check at all, so callers can tell "no
// signature" apart from "signature present but invalid" -- the handoff's
// own §1.4 distinction.
async function verifyExportEnvelope(envelope, recordsBody) {
  if (!envelope) return { hashValid: true, sigValid: null }; // v0 -- nothing asserted, nothing to distrust
  const actualHash = await computeContentSha256Hex(recordsBody);
  const hashValid = actualHash === envelope.content_sha256;
  if (!envelope.sig) return { hashValid, sigValid: null };
  const sigValid = await verifyPayload(envelope.content_sha256, envelope.sig.sig, envelope.sig.pubKeyJwk);
  return { hashValid, sigValid };
}

// --- TOFU trust store (per SENDER IDENTITY, not per project) -----------
// Pure functions over a plain { [senderEmail]: { fingerprint, pubKeyJwk,
// firstSeenAt, lastSeenAt } } object -- the actual localStorage key lives
// in wigwag.html/a CLI's own state, same split as every other *_KEY
// store this module names a constant for but never reads/writes itself.
const EXPORT_TRUST_KEY = 'git_native_tracker_export_trust_v1';

function lookupSenderTrust(trustStore, senderEmail) {
  return (trustStore && trustStore[senderEmail]) || null;
}

// 'first-seen': no prior record for this sender -- this fingerprint
// becomes the trusted one from here on (recorded by the caller, not this
// function -- see rememberSenderTrust). 'match': fingerprint equals what
// was already on file, quiet. 'changed': fingerprint differs -- the only
// LOUD state; priorFingerprint is included so a UI can name both, per
// the handoff's own requirement.
function classifySenderTrust(trustStore, senderEmail, fingerprint) {
  const existing = lookupSenderTrust(trustStore, senderEmail);
  if (!existing) return { state: 'first-seen', priorFingerprint: null };
  if (existing.fingerprint === fingerprint) return { state: 'match', priorFingerprint: null };
  return { state: 'changed', priorFingerprint: existing.fingerprint };
}

// Returns a NEW trust store with this sender's fingerprint recorded.
// Callers use this for the automatic 'first-seen' -> trusted transition
// (no gate to pass, per the handoff's "nothing here is a gate" rule) and
// for an explicit "Trust this key" action on a 'changed' sender (a
// future UI's job, tracker #124) -- never called automatically for
// 'changed' itself, since accepting a rotated key is the one real
// decision in this whole flow.
function rememberSenderTrust(trustStore, senderEmail, fingerprint, pubKeyJwk, now) {
  const existing = lookupSenderTrust(trustStore, senderEmail);
  return {
    ...(trustStore || {}),
    [senderEmail]: { fingerprint, pubKeyJwk, firstSeenAt: existing ? existing.firstSeenAt : now, lastSeenAt: now }
  };
}

// Combines hash/signature verification with TOFU trust into the single
// sig_state the handoff's own test ids expose (data-sig-state=
// "signed|unsigned|changed|damaged"). Per §1.4, a hash mismatch and an
// outright-invalid signature both get the SAME loud/amber visual
// treatment as a rotated key, but must be LABELLED distinctly -- `reason`
// carries that distinction; `sigState` alone stays one of the four enum
// values a future UI's data-sig-state attribute needs.
function classifyExportProvenance({ envelope, hashValid, sigValid, senderTrust }) {
  if (!envelope) return { sigState: 'unsigned', reason: 'no-envelope' };
  if (!hashValid) return { sigState: 'damaged', reason: 'hash-mismatch' };
  if (!envelope.sig) return { sigState: 'unsigned', reason: 'no-signature' };
  if (!sigValid) return { sigState: 'changed', reason: 'signature-invalid' };
  if (senderTrust && senderTrust.state === 'changed') return { sigState: 'changed', reason: 'key-changed', priorFingerprint: senderTrust.priorFingerprint };
  return { sigState: 'signed', reason: (senderTrust && senderTrust.state === 'first-seen') ? 'first-seen' : 'known-key' };
}

// Binary (1024-based) size, auto-scaling the unit so it stays legible
// whether a project is a few KB (the common case for most of its life)
// or has grown into MB territory (where GitHub itself starts to care --
// soft warnings above 50MB, hard rejection above 100MB per file).
function humanFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
// Tolerant line-by-line parse -- a malformed line is skipped rather than
// failing the whole import, since a partially-corrupted file (e.g. one
// truncated by a bad email client) should still recover what it can.
// fallbackFieldDefs is used only when the file has no 'fields' line of
// its own (a pure issues-only paste, say).
// Rehydrates an entry written against the shared key registry (tracker
// #132, 68d960f2) back to a full inline pubKey, so every downstream
// consumer (verifyPayload, squashHistory, TOFU trust, etc.) sees exactly
// the same {sig, sigRedacted, pubKey} shape it always has -- whether the
// file used the registry or (an older export, still fully valid) inlined
// pubKey directly on every entry. A no-op when keyRegistry is absent or
// the entry has no keyRef, so old-format files pass through unchanged.
function rehydrateKeyRef(entry, keyRegistry) {
  if (entry && entry.keyRef && !entry.pubKey && keyRegistry) return { ...entry, pubKey: keyRegistry[entry.keyRef] || null };
  return entry;
}
function parseJsonl(text, fallbackFieldDefs) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let fields = null, incomingProjectHistory = null, projectId = null, projectName = null, projectNotes = null, projectComments = null, incomingFormatVersion = null, keyRegistry = null;
  const issues = [];
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    if (!obj || typeof obj !== 'object') continue;
    if (obj.type === 'fields') {
      fields = obj.fields || null; incomingProjectHistory = obj.projectHistory || null; projectId = obj.id || null; projectName = obj.name || null;
      projectNotes = obj.projectNotes || null; projectComments = obj.projectComments || null; incomingFormatVersion = typeof obj.formatVersion === 'number' ? obj.formatVersion : null;
      keyRegistry = obj.keys || null;
    }
    else if (obj.type === 'issue') issues.push(obj);
  }
  if (keyRegistry) {
    if (incomingProjectHistory) incomingProjectHistory = incomingProjectHistory.map(h => rehydrateKeyRef(h, keyRegistry));
    for (const iss of issues) {
      if (iss.history) iss.history = iss.history.map(h => rehydrateKeyRef(h, keyRegistry));
      if (iss.commentStreams) {
        const cs = {};
        for (const colId in iss.commentStreams) cs[colId] = (iss.commentStreams[colId] || []).map(h => rehydrateKeyRef(h, keyRegistry));
        iss.commentStreams = cs;
      }
    }
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
// commentStreams is a map of independent per-field entry arrays (one per
// commentStream-typed field, 'comments' included) -- union each field's
// array separately, over the set of field ids present on EITHER side, so
// a field that only exists on one side (e.g. created locally, not yet
// seen by the other party) still comes through untouched.
function mergeCommentStreams(localStreams, incomingStreams) {
  const ids = new Set([...Object.keys(localStreams || {}), ...Object.keys(incomingStreams || {})]);
  const merged = {};
  for (const id of ids) {
    merged[id] = unionByKey((localStreams && localStreams[id]) || [], (incomingStreams && incomingStreams[id]) || [], c => commentKey(c));
  }
  return merged;
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
  const commentStreams = mergeCommentStreams(localIssue.commentStreams, incomingIssue.commentStreams);
  const fieldIds = new Set();
  for (const h of history) if (h.field) fieldIds.add(h.field);
  const overlappingFields = [];
  // touchedFields (tracker #124, 5c3051e9): every field the INCOMING file
  // genuinely brought something new to -- a strict superset of
  // overlappingFields (which requires BOTH sides to have independently
  // diverged). The handoff's own Level 2 table shows a row for every
  // field the merge touched, whether the local side also edited it
  // (winner: newest-edit-wins) or not (winner: incoming by default,
  // origin note "one copy only") -- overlappingFields alone silently
  // dropped the one-copy-only rows entirely.
  const touchedFields = [];
  for (const colId of fieldIds) {
    const localAuthored = localIssue.history.filter(h => h.field === colId && h.origin !== 'derived');
    const incomingAuthored = incomingIssue.history.filter(h => h.field === colId && h.origin !== 'derived');
    const localKeys = new Set(localAuthored.map(h => entryKey(h)));
    const incomingKeys = new Set(incomingAuthored.map(h => entryKey(h)));
    const localOnly = localAuthored.some(h => !incomingKeys.has(entryKey(h)));
    const incomingOnly = incomingAuthored.some(h => !localKeys.has(entryKey(h)));
    if (localOnly && incomingOnly) overlappingFields.push(colId);
    if (incomingOnly) touchedFields.push(colId);
  }
  const merged = { ...localIssue, commentStreams, history };
  // A tombstone (field: ISSUE_DELETED_FIELD_ID) flows through the same
  // generic history union above as any other field entry -- no special
  // merge-conflict handling needed, just re-derive deleted status fresh
  // like values/fieldRefs.
  const mergedIssue = { ...merged, values: deriveIssueValues(merged, fieldDefs), fieldRefs: deriveIssueFieldRefs(merged, fieldDefs), deleted: issueIsDeleted(history) };
  return { mergedIssue, overlappingFields, touchedFields };
}

// --- Diff3 (three-way prose merge) -- tracker #123 (d100c705), Part B of
// the merge_provenance.zip handoff (README §2.1-§2.2) ------------------
//
// Scalar fields (select/multiselect/date/issue) need no new logic here:
// "last edit wins" is already an emergent property of mergeIssuePair's
// history-union + deriveIssueValues' latest-sortKey-wins derivation.
// Prose fields (type:'text') get a real three-way merge instead, since
// overwriting one side's whole paragraph with the other's is far more
// destructive for free-form text than for a status dropdown.
//
// Implementation note: an earlier attempt aligned two INDEPENDENTLY
// computed two-way diffs (base->ours, base->theirs) positionally by
// hunk-start-offset. That breaks whenever the two diffs coalesce a
// shared region differently sized (verified live: a header edit on one
// side plus an unrelated same-line edit on the other got silently
// dropped). This uses the standard "common backbone" three-way-merge
// algorithm instead: find base lines left untouched by BOTH sides (via
// two independent LCS-match passes), use those as synchronization
// anchors, and resolve the segments BETWEEN anchors on their own merits
// -- the same approach `diff3`/`git merge-file` use.

// For each base line index, the ours/theirs index it's matched to via
// LCS, or -1 if that base line wasn't preserved on that side. O(n*m) DP
// -- fine for prose-sized fields, not meant for huge documents.
function lcsMatchToBase(baseLines, otherLines) {
  const n = baseLines.length, m = otherLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = baseLines[i] === otherLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const match = new Array(n).fill(-1);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (baseLines[i] === otherLines[j]) { match[i] = j; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return match;
}
function linesArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// markers: { openLine, midLine, closeLine } -- the exact three lines to
// splice around a conflicting region (see conflictMarkerLines below for
// the real grammar; a caller can pass placeholder strings for testing).
// segments (returned alongside text/hasConflict) is the per-LINE origin
// tag diff3Merge itself already knows during the merge but the flattened
// text alone can't recover afterward: {kind:'context'|'local'|'inbound'|
// 'marker', text}. Needed so a renderer can tint EVERY changed line by
// whose edit it came from (not just conflicting ones) -- the handoff's
// own "the merged body rendered inline as a diff... the actual artefact"
// requirement (README §3, Level 2). Purely additive: existing callers
// destructuring only {text, hasConflict} are unaffected.
function diff3Merge(base, ours, theirs, markers) {
  const baseLines = base.split('\n');
  const oursLines = ours.split('\n');
  const theirsLines = theirs.split('\n');
  const matchO = lcsMatchToBase(baseLines, oursLines);
  const matchT = lcsMatchToBase(baseLines, theirsLines);
  const backbone = [];
  for (let i = 0; i < baseLines.length; i++) { if (matchO[i] !== -1 && matchT[i] !== -1) backbone.push(i); }

  const out = [];
  const segments = [];
  let hasConflict = false;
  let prevBase = -1, prevOurs = -1, prevTheirs = -1;

  function push(kind, text) { out.push(text); segments.push({ kind, text }); }

  function emitGap(baseFrom, baseTo, oursFrom, oursTo, theirsFrom, theirsTo) {
    const baseSeg = baseLines.slice(baseFrom, baseTo);
    const oursSeg = oursLines.slice(oursFrom, oursTo);
    const theirsSeg = theirsLines.slice(theirsFrom, theirsTo);
    const oursChanged = !linesArraysEqual(oursSeg, baseSeg);
    const theirsChanged = !linesArraysEqual(theirsSeg, baseSeg);
    if (!oursChanged && !theirsChanged) { baseSeg.forEach(t => push('context', t)); return; }
    if (oursChanged && !theirsChanged) { oursSeg.forEach(t => push('local', t)); return; }
    if (!oursChanged && theirsChanged) { theirsSeg.forEach(t => push('inbound', t)); return; }
    if (linesArraysEqual(oursSeg, theirsSeg)) { oursSeg.forEach(t => push('context', t)); return; }
    hasConflict = true;
    push('marker', markers.openLine);
    oursSeg.forEach(t => push('local', t));
    push('marker', markers.midLine);
    theirsSeg.forEach(t => push('inbound', t));
    push('marker', markers.closeLine);
  }

  for (const b of backbone) {
    const o = matchO[b], t = matchT[b];
    emitGap(prevBase + 1, b, prevOurs + 1, o, prevTheirs + 1, t);
    push('context', baseLines[b]); // the anchor line itself -- identical on all three
    prevBase = b; prevOurs = o; prevTheirs = t;
  }
  emitGap(prevBase + 1, baseLines.length, prevOurs + 1, oursLines.length, prevTheirs + 1, theirsLines.length);
  return { text: out.join('\n'), hasConflict, segments };
}

function formatDateLabel(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
// Maps a classifyExportProvenance() result to the marker-grammar suffix
// text (README §2.2 names three: signed / unsigned / signed, new key).
// Extended with two real states the spec's own three options don't
// cover but the format still needs to say something honest about: an
// outright cryptographically-invalid signature, and a damaged (hash-
// mismatched) file -- both loud per §1.4, but distinctly labelled.
function provenanceMarkerSuffix(provenance) {
  if (!provenance || provenance.sigState === 'unsigned') return 'unsigned';
  if (provenance.sigState === 'damaged') return 'damaged';
  if (provenance.sigState === 'changed' && provenance.reason === 'signature-invalid') return 'signature invalid';
  if (provenance.sigState === 'changed') return 'signed, new key';
  return 'signed';
}
// Builds the three marker lines bracketing a conflict, per the handoff's
// own grammar (§2.2):
//   <<<<<<< local copy · <identity>
//   =======
//   >>>>>>> <identity> · export <date> · <signed|unsigned|signed, new key>
// localIdentity names whoever authored the LATEST local edit to this
// specific field (not necessarily the identity running the merge right
// now); inboundIdentity/exportedAt/provenance describe the incoming
// EXPORT TRANSACTION as a whole (see the export-envelope section of
// docs/FORMAT.md), not a specific edit within it.
function conflictMarkerLines(localIdentity, inboundIdentity, exportedAt, provenance) {
  const dateLabel = exportedAt ? formatDateLabel(exportedAt) : 'unknown date';
  return {
    openLine: '<<<<<<< local copy · ' + (localIdentity || 'unknown'),
    midLine: '=======',
    closeLine: '>>>>>>> ' + (inboundIdentity || 'unknown') + ' · export ' + dateLabel + ' · ' + provenanceMarkerSuffix(provenance)
  };
}
// Open question the handoff flags explicitly (§2.2) rather than
// deciding: does wigwag re-parse markers on every save (clears "needs a
// look" only when they're cleanly gone, survives a partial edit) or
// just detect the literal <<<<<<< prefix as inert text? Decided (see
// tracker #123/d100c705's own comment thread): the cheaper literal-
// prefix detection -- a full re-parse-on-save is real extra work for a
// benefit (surviving a half-deleted marker) that's easy to add later if
// it turns out to matter, whereas the reverse (removing an over-built
// mechanism) rarely happens in practice.
function hasUnresolvedMergeMarkers(text) {
  return typeof text === 'string' && text.split('\n').some(line => line.startsWith('<<<<<<<'));
}

// For every prose-typed (type:'text') field where BOTH sides authored
// entries the other hadn't seen (mergeIssuePair's own "overlapping"
// condition, recomputed here since this needs the actual base/ours/
// theirs TEXT, not just the boolean flag), runs a real diff3 merge and
// returns one entry descriptor per field that genuinely needs a new
// history entry -- "one new edit authored by the merging identity" per
// the handoff's own §2.1. Committing each entry (needs identity +
// signing) stays the caller's job, same split as computeDerivedChangeEntries
// above. inboundInfo describes the incoming EXPORT TRANSACTION (see
// classifyIngestProvenance in wigwag.html) -- {exportedBy, exportedAt,
// provenance} -- and may be null/omitted for a merge with no real
// envelope (e.g. a GitHub-sync-driven merge), in which case markers fall
// back to "unknown"/"unsigned" rather than crashing.
function computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, inboundInfo) {
  const info = inboundInfo || { exportedBy: '', exportedAt: null, provenance: null };
  const entries = [];
  const latestOf = list => list.length ? list.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)) : null;
  for (const colId in fieldDefs) {
    const def = fieldDefs[colId];
    if (!def || def.type !== 'text') continue;
    const localAuthored = (localIssue.history || []).filter(h => h.field === colId && h.origin !== 'derived');
    const incomingAuthored = (incomingIssue.history || []).filter(h => h.field === colId && h.origin !== 'derived');
    if (!localAuthored.length || !incomingAuthored.length) continue;
    const localKeys = new Set(localAuthored.map(h => entryKey(h)));
    const incomingKeys = new Set(incomingAuthored.map(h => entryKey(h)));
    const localOnly = localAuthored.some(h => !incomingKeys.has(entryKey(h)));
    const incomingOnly = incomingAuthored.some(h => !localKeys.has(entryKey(h)));
    if (!localOnly || !incomingOnly) continue; // not actually overlapping -- nothing to reconcile

    const sharedEntries = localAuthored.filter(h => incomingKeys.has(entryKey(h)));
    const baseEntry = latestOf(sharedEntries);
    const localLatest = latestOf(localAuthored);
    const incomingLatest = latestOf(incomingAuthored);
    const baseValue = baseEntry ? (baseEntry.value || '') : '';
    const oursValue = localLatest ? (localLatest.value || '') : '';
    const theirsValue = incomingLatest ? (incomingLatest.value || '') : '';
    if (oursValue === theirsValue) continue; // both sides already converged -- nothing new to record

    const markers = conflictMarkerLines(
      (localLatest && (localLatest.email || localLatest.actor)) || 'unknown',
      info.exportedBy, info.exportedAt, info.provenance
    );
    const { text: mergedValue, hasConflict } = diff3Merge(baseValue, oursValue, theirsValue, markers);
    if (mergedValue === oursValue) continue; // idempotent -- re-merging the same file twice is a no-op
    entries.push({
      colId, value: mergedValue, hasConflict,
      text: (def.label || colId) + (hasConflict ? ' updated by merge — merge conflicts require human review.' : ' updated by merge'),
      // Real entry ids only (never the values themselves) -- lets a
      // renderer regenerate the exact same diff3 segments later, fresh
      // against the issue's own live (redaction-respecting) history,
      // for the inline-diff view (buildMergeFieldDiffLines below).
      baseEntryId: baseEntry ? baseEntry.id : null,
      theirsEntryId: incomingLatest ? incomingLatest.id : null
    });
  }
  return entries;
}

// --- Local-only merge log -- tracker #123 (d100c705), README §2.3/§4 ---
// One record per merge, describing what the merge DID (not what the
// issues now contain -- the issues themselves stay the source of truth
// for that). Deliberately simpler than the handoff's own most-detailed
// illustrative shape (a full per-edit timeline for every touched field,
// every contributing edit individually listed) -- that level of detail
// is Part C's own rendering concern (tracker #124) and can be extended
// once the UI actually needs it; this captures enough to be genuinely
// useful today: which issues/fields were touched, whether each field's
// resolution was a plain scalar last-write-wins or a real diff3 merge
// (and whether that merge left markers), plus the full ingest
// provenance for the transaction as a whole.
//
// NEVER exported -- see docs/FORMAT.md's "export envelope" section and
// buildSourceText above, neither of which this type ever passes through.
// Storage (a per-project localStorage key, not a shared/synced one) is
// the caller's job, same split as every other *_KEY store this module
// only names a constant for.
const MERGE_LOG_TYPE = 'wigwag.merge';
const MERGE_LOG_VERSION = 1;
const MERGE_LOG_KEY_PREFIX = 'git_native_tracker_merge_log_v1:';
function mergeLogStorageKey(projectId) { return MERGE_LOG_KEY_PREFIX + projectId; }

function buildMergeRecord({ id, ingestedAt, ingestedBy, source, issues }) {
  return { type: MERGE_LOG_TYPE, v: MERGE_LOG_VERSION, id, ingested_at: ingestedAt, ingested_by: ingestedBy, source, issues };
}
// Per-issue field breakdown for one merge record: scalar fields flagged
// as overlapping (mergeIssuePair's own notice condition) get 'newest-
// edit-wins' + which side's edit is newer; prose fields already handled
// by computeMergeProseEntries get 'merged'/'merged-with-markers'.
// Per-field breakdown for one merge record. Beyond outcome/winner, each
// row also carries enough to (a) reconstruct Level 3's two-lane timeline
// and (b) know whether "Back out this update" can safely revert this
// field later -- WITHOUT duplicating any actual value/actor/time content
// into the merge log itself, which would go stale or leak past a later
// redaction. Only real history entry ids are stored; a renderer joins
// them live against the issue's own (redaction-respecting) current
// history:
// - localEntryIds/incomingEntryIds: every authored entry id each side
//   contributed for this field -- the raw material for the timeline.
// - preMergeLocalEntryId: the LOCAL side's own latest entry for this
//   field, from immediately before the merge -- what "Back out this
//   update" restores.
// - resultEntryId: the entry id that became this field's current value
//   as a DIRECT RESULT of this merge. Known immediately for a scalar
//   field (whichever side's own entry won); left null here for a prose
//   field, since diff3's new entry doesn't exist (and so has no real id)
//   until the caller actually signs and appends it -- the caller patches
//   this in afterward once that id is known (see wigwag.html's
//   startMerge). Comparing this against a field's CURRENT latest entry
//   id at rollback time is exactly how "has this field been edited again
//   since the merge, so backing out would clobber real newer work" gets
//   detected.
function buildMergeIssueSummary(issueId, localIssue, incomingIssue, touchedFields, proseEntries, fieldDefs) {
  const fields = [];
  const proseColIds = new Set((proseEntries || []).map(e => e.colId));
  const latestOf = list => list.length ? list.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)) : null;
  for (const colId of (touchedFields || [])) {
    if (proseColIds.has(colId)) continue; // reported via proseEntries below instead
    if (!fieldDefs[colId]) continue;
    const localAuthored = (localIssue.history || []).filter(h => h.field === colId && h.origin !== 'derived');
    const incomingAuthored = (incomingIssue.history || []).filter(h => h.field === colId && h.origin !== 'derived');
    const localLatest = latestOf(localAuthored);
    const incomingLatest = latestOf(incomingAuthored);
    const winner = (localLatest && incomingLatest)
      ? (localLatest.sortKey >= incomingLatest.sortKey ? 'local' : 'incoming')
      : (localLatest ? 'local' : 'incoming');
    // "newest-edit-wins" only when local ITSELF diverged (has an entry
    // incoming doesn't already know about) -- checking merely "localLatest
    // exists" is wrong: local's only entry might just be the same shared
    // ancestor entry incoming also carries (e.g. incoming is a clone of
    // local plus one new edit), which is genuinely "one copy only" even
    // though localLatest is truthy. Mirrors mergeIssuePair's own
    // localOnly/incomingOnly entryKey-based check exactly.
    const incomingKeys = new Set(incomingAuthored.map(h => entryKey(h)));
    const localKeys = new Set(localAuthored.map(h => entryKey(h)));
    const localGenuinelyDiverged = localAuthored.some(h => !incomingKeys.has(entryKey(h)));
    const outcome = localGenuinelyDiverged ? 'newest-edit-wins' : 'one-copy-only';
    fields.push({
      field: colId, outcome, winner,
      // Entries present (by entryKey) on BOTH sides are shared ancestor
      // history, not this merge's own contribution -- excluded from both
      // lists so the Level 3 timeline never shows the same real entry
      // twice, tagged as if each side had authored it independently (a
      // live bug found via tracker #132's own Merge History: a field
      // whose only local entry was the shared default/creation entry
      // showed that entry duplicated on both sides of the divider).
      localEntryIds: localAuthored.filter(h => !incomingKeys.has(entryKey(h))).map(h => h.id).filter(Boolean),
      incomingEntryIds: incomingAuthored.filter(h => !localKeys.has(entryKey(h))).map(h => h.id).filter(Boolean),
      preMergeLocalEntryId: localLatest ? (localLatest.id || null) : null,
      resultEntryId: (winner === 'local' ? localLatest : incomingLatest).id || null
    });
  }
  for (const entry of (proseEntries || [])) {
    const localAuthored = (localIssue.history || []).filter(h => h.field === entry.colId && h.origin !== 'derived');
    const incomingAuthored = (incomingIssue.history || []).filter(h => h.field === entry.colId && h.origin !== 'derived');
    const incomingKeys = new Set(incomingAuthored.map(h => entryKey(h)));
    const localKeys = new Set(localAuthored.map(h => entryKey(h)));
    const localLatest = latestOf(localAuthored);
    fields.push({
      field: entry.colId, outcome: entry.hasConflict ? 'merged-with-markers' : 'merged', markers: entry.hasConflict ? 1 : 0,
      localEntryIds: localAuthored.filter(h => !incomingKeys.has(entryKey(h))).map(h => h.id).filter(Boolean),
      incomingEntryIds: incomingAuthored.filter(h => !localKeys.has(entryKey(h))).map(h => h.id).filter(Boolean),
      preMergeLocalEntryId: localLatest ? (localLatest.id || null) : null,
      resultEntryId: null, // patched in by the caller once the new diff3 entry is actually signed/appended
      baseEntryId: entry.baseEntryId || null, theirsEntryId: entry.theirsEntryId || null
    });
  }
  return { id: issueId, fields };
}

// After a merge actually applies and any prose entries are signed/
// appended for real (so their true ids exist), the caller patches
// resultEntryId into the matching prose field row -- pure, so it's easy
// to test the patching logic in isolation from the async signing itself.
function patchMergeSummaryResultEntryId(mergeIssueSummaries, issueId, colId, resultEntryId) {
  return mergeIssueSummaries.map(summary => {
    if (summary.id !== issueId) return summary;
    return {
      ...summary,
      fields: summary.fields.map(f => (f.field === colId ? { ...f, resultEntryId } : f))
    };
  });
}

// Whether "Back out this update" can safely revert ONE field row: only
// when the field's CURRENT latest entry (by sortKey, among authored
// entries) is still the exact entry this merge produced. If something
// else has edited the field since, reverting would silently clobber that
// newer work -- refused here rather than done, matching wigwag's
// standing rule that nothing real is ever silently discarded.
function fieldStillSafeToRevert(currentIssue, fieldRow) {
  if (!fieldRow.resultEntryId || !fieldRow.preMergeLocalEntryId) return false;
  const authored = (currentIssue.history || []).filter(h => h.field === fieldRow.field && h.origin !== 'derived');
  if (!authored.length) return false;
  const currentLatest = authored.reduce((a, b) => (b.sortKey > a.sortKey ? b : a));
  return currentLatest.id === fieldRow.resultEntryId;
}

// Computes the revert entries for "Back out this update" -- one new
// signed entry per field that's still safe to revert (see
// fieldStillSafeToRevert), restoring the LOCAL value from immediately
// before the merge. Fields that have since been redacted (the pre-merge
// entry no longer carries a value) or edited again are skipped, each
// with a reason a UI can surface -- never silently guessed at.
function computeMergeRollbackEntries(mergeRecord, issuesById, fieldDefs) {
  const results = [];
  for (const issueSummary of (mergeRecord.issues || [])) {
    const currentIssue = issuesById[issueSummary.id];
    if (!currentIssue) { results.push({ issueId: issueSummary.id, field: null, skipped: 'issue-not-found' }); continue; }
    for (const fieldRow of issueSummary.fields) {
      const def = fieldDefs[fieldRow.field];
      if (!def) { results.push({ issueId: issueSummary.id, field: fieldRow.field, skipped: 'field-deleted' }); continue; }
      if (!fieldStillSafeToRevert(currentIssue, fieldRow)) {
        results.push({ issueId: issueSummary.id, field: fieldRow.field, skipped: 'changed-since-merge' });
        continue;
      }
      const preEntry = (currentIssue.history || []).find(h => h.id === fieldRow.preMergeLocalEntryId);
      if (!preEntry || preEntry.redacted || preEntry.value === undefined) {
        results.push({ issueId: issueSummary.id, field: fieldRow.field, skipped: 'pre-merge-value-unavailable' });
        continue;
      }
      results.push({
        issueId: issueSummary.id, field: fieldRow.field, skipped: null,
        value: preEntry.value,
        text: (def.label || fieldRow.field) + ' reverted — merge backed out'
      });
    }
  }
  return results;
}

// Level 1+2 view model for the Apply Update gate (tracker #124, 5c3051e9,
// merge_provenance.zip): turns previewMerge's raw computed result
// (mergeIssueSummaries) plus the ingest provenance classification
// (classifyIngestProvenance's own {envelope, provenance, fingerprint})
// into a flat, render-ready shape -- pure, so it's unit-testable without
// a DOM. Level 3 (the full two-lane timeline) is built separately, on
// demand, by buildMergeFieldTimeline below, since it needs to walk one
// specific field's real history entries.
// Renders one field's SETTLED value for the Level 2 table -- a real
// color-coded pill for a select field's resolved option (matching how
// pills render everywhere else in the product), plain readable text for
// everything else. issue is the (already-merged, values-derived) issue;
// returns null if there's genuinely no value to show (prose fields
// render their diff instead, handled separately by the caller).
// The actual resolution logic shared by mergeSettledValueView (the
// CURRENT settled value) and the Level 3 timeline (every HISTORICAL
// value along the way) -- a select/multiselect field's real stored
// value is an opaque option id (e.g. "opt_1787164390598"), never
// meaningful to show directly. Resolves it to the option's real label +
// color, same as every other pill in the product.
function resolveFieldValueView(def, val) {
  if (!def) return { text: (val === undefined || val === null || val === '') ? '—' : String(val), isPill: false };
  if (def.type === 'select') {
    const opt = (def.options || []).find(o => o.id === val);
    if (opt) { const c = col(opt.color); return { text: opt.label, isPill: true, bg: c.bg, fg: c.fg }; }
    return { text: (val === undefined || val === null || val === '') ? '—' : String(val), isPill: false };
  }
  if (def.type === 'multiselect') {
    const labels = (Array.isArray(val) ? val : []).map(id => { const o = (def.options || []).find(x => x.id === id); return o ? o.label : id; });
    return { text: labels.length ? labels.join(', ') : '—', isPill: false };
  }
  return { text: (val === undefined || val === null || val === '') ? '—' : String(val), isPill: false };
}
function mergeSettledValueView(issue, colId, def) {
  if (!issue || !issue.values) return { text: '—', isPill: false };
  return resolveFieldValueView(def, issue.values[colId]);
}

function buildMergePreviewViewModel(computed, ingestProvenance, fieldDefs) {
  const prov = ingestProvenance || {};
  const envelope = prov.envelope || null;
  const classification = prov.provenance || { sigState: 'unsigned', reason: null };
  const sourceInfo = { exportedBy: envelope ? envelope.exported_by : '', exportedAt: envelope ? envelope.exported_at : null, sigState: classification.sigState };
  const issues = (computed.mergeIssueSummaries || []).map(summary => {
    const mergedIssue = (computed.mergedIssues || []).find(mi => mi.id === summary.id);
    const title = (mergedIssue && mergedIssue.values && mergedIssue.values.title) || '(untitled)';
    const fields = summary.fields.map(f => {
      const def = fieldDefs[f.field] || {};
      const editCount = (f.localEntryIds || []).length + (f.incomingEntryIds || []).length;
      const isProse = f.outcome === 'merged' || f.outcome === 'merged-with-markers';
      const diff = (isProse && mergedIssue) ? buildMergeFieldDiffLines(mergedIssue, f, sourceInfo) : null;
      const settled = isProse ? null : mergeSettledValueView(mergedIssue, f.field, def);
      return {
        field: f.field, label: def.label || f.field, outcome: f.outcome, winner: f.winner || null,
        markers: f.markers || 0, editCount,
        origin: isProse ? '' : (f.outcome === 'newest-edit-wins' ? 'newest edit wins' : 'one copy only'),
        isProse,
        settledText: settled ? settled.text : '', settledIsPill: settled ? settled.isPill : false,
        settledPillBg: settled ? settled.bg : null, settledPillFg: settled ? settled.fg : null,
        diffLines: diff ? diff.lines : []
      };
    });
    return { issueId: summary.id, title, fields };
  });
  return {
    sigState: classification.sigState || 'unsigned',
    reason: classification.reason || null,
    priorFingerprint: classification.priorFingerprint || null,
    exportedBy: envelope ? envelope.exported_by : '',
    exportedAt: envelope ? envelope.exported_at : null,
    recordsCount: envelope ? envelope.records : null,
    contentSha256: envelope ? envelope.content_sha256 : null,
    fingerprint: prov.fingerprint || null,
    issueCount: issues.length,
    issues
  };
}

// Level 3: a two-lane (local vs incoming) timeline for ONE field of ONE
// merge -- joined live against the issue's OWN current history, so a
// later redaction is reflected automatically instead of ever duplicating
// content into the merge log itself. An entry id no longer found in
// history (e.g. redacted since) is simply omitted, not synthesized.
function buildMergeFieldTimeline(issue, fieldRow) {
  const byId = new Map((issue.history || []).map(h => [h.id, h]));
  const toEvent = side => id => {
    const h = byId.get(id);
    if (!h) return null;
    return { side, id: h.id, time: h.time, actor: h.actor, email: h.email, value: h.value, sortKey: h.sortKey };
  };
  return []
    .concat((fieldRow.localEntryIds || []).map(toEvent('local')))
    .concat((fieldRow.incomingEntryIds || []).map(toEvent('incoming')))
    .filter(Boolean)
    .sort((a, b) => (a.sortKey > b.sortKey ? 1 : -1));
}

// Level 3 is per-ISSUE, not per-field (README §3: "Show the timeline —
// N edits across both copies" appears once per issue, combining every
// field the merge touched into one down-is-time, across-is-the-copy
// view). Composes buildMergeFieldTimeline across all of an issue's
// touched fields, tagging each event with its field, then adds
// prevValue: "what that lane's own author was looking at on their own
// copy" -- tracked independently per (side, field) pair, NOT the other
// side's value, matching the handoff's own example (Tom moving Priority
// Medium->Urgent without ever seeing Tony's own move to High).
function buildMergeIssueTimeline(issue, fields) {
  const raw = [];
  for (const f of (fields || [])) {
    for (const e of buildMergeFieldTimeline(issue, f)) raw.push({ ...e, field: f.field });
  }
  raw.sort((a, b) => (a.sortKey > b.sortKey ? 1 : -1));
  const prevByLaneField = {};
  return raw.map(e => {
    const key = e.side + '|' + e.field;
    const prevValue = Object.prototype.hasOwnProperty.call(prevByLaneField, key) ? prevByLaneField[key] : null;
    prevByLaneField[key] = e.value;
    return { ...e, prevValue };
  });
}

// The real inline diff for ONE prose field row -- README §3, Level 2's
// own emphatic requirement: "the merged body rendered inline as a
// diff... not a summary, not the word 'merged': the actual artefact,
// because the artefact is the thing that needs looking at." Regenerated
// FRESH each time from the field row's own base/local/theirs entry ids
// (never duplicated into the merge log itself) joined live against the
// issue's own real, redaction-respecting history -- exactly the same
// "join ids live" principle buildMergeFieldTimeline already uses.
// sourceInfo is the merge record's own envelope summary
// ({exported_by/exportedBy, exported_at/exportedAt, sig_state/sigState})
// -- enough to regenerate the exact conflict-marker suffix the real
// merge produced. Returns null when any of the three sides has since
// been redacted -- nothing safe to reconstruct, never synthesized.
function buildMergeFieldDiffLines(issue, fieldRow, sourceInfo) {
  if (!fieldRow.baseEntryId || !fieldRow.theirsEntryId || !fieldRow.preMergeLocalEntryId) return null;
  const byId = new Map((issue.history || []).map(h => [h.id, h]));
  const baseEntry = byId.get(fieldRow.baseEntryId);
  const localEntry = byId.get(fieldRow.preMergeLocalEntryId);
  const theirsEntry = byId.get(fieldRow.theirsEntryId);
  if (!baseEntry || !localEntry || !theirsEntry) return null;
  const info = sourceInfo || {};
  const markers = conflictMarkerLines(
    localEntry.email || localEntry.actor || 'unknown',
    info.exported_by || info.exportedBy || 'unknown',
    info.exported_at || info.exportedAt || null,
    { sigState: info.sig_state || info.sigState || 'unsigned' }
  );
  const { segments, hasConflict } = diff3Merge(baseEntry.value || '', localEntry.value || '', theirsEntry.value || '', markers);
  return { hasConflict, lines: segments };
}

// Whether a past merge log record still needs a human's attention -- the
// Merge History section's own badge condition (tracker #124, 5c3051e9).
// Deliberately narrow: a badge appears only for something genuinely
// unresolved, never just because a merge happened at all -- a signature
// that never got a trust decision (still 'changed'/'damaged'), or a
// prose field that still literally carries unresolved conflict markers
// in its CURRENT value (checked live against issuesById, not the merge
// log's own frozen field list -- a field the person already resolved by
// hand stops flagging automatically).
function mergeRecordNeedsAttention(record, issuesById) {
  if (record.source && (record.source.sig_state === 'changed' || record.source.sig_state === 'damaged')) return true;
  return (record.issues || []).some(issueSummary => {
    const issue = issuesById[issueSummary.id];
    if (!issue || !issue.values) return false;
    return issueSummary.fields.some(f => f.markers && typeof issue.values[f.field] === 'string' && hasUnresolvedMergeMarkers(issue.values[f.field]));
  });
}

// The full pure half of a merge: pairs up local issues with their
// incoming counterpart (via mergeIssuePair) and folds in whichever
// incoming issues are genuinely new (not present locally at all),
// carrying each one's own real history over as-is -- no synthetic
// "merged in" annotation stamped on top of it. A pulled/merged issue's
// provenance is already fully explained by its own history; adding a
// local note on top of every one of them (there can be hundreds, on a
// first connect to an existing project) is noise, not signal.
// inboundInfo (tracker #123, d100c705): {exportedBy, exportedAt,
// provenance} describing the incoming export transaction, threaded down
// into computeMergeProseEntries so a conflict marker can name the real
// sender. Optional -- every existing caller passing only 3 args keeps
// working unchanged (falls back to "unknown"/"unsigned" markers), which
// matters for merge call sites with no real envelope (e.g. a GitHub-
// sync-driven merge, which was never part of this feature's scope).
function computeIssueMerge(localIssues, parsedIssues, fieldDefs, inboundInfo) {
  const localById = new Map(localIssues.map(i => [i.id, i]));
  const mergedIssues = [];
  const notices = {};
  const proseMergeEntries = {};
  const mergeIssueSummaries = [];
  for (const localIssue of localIssues) {
    const incomingIssue = parsedIssues.find(i => i.id === localIssue.id);
    if (!incomingIssue) { mergedIssues.push(localIssue); continue; }
    const { mergedIssue, overlappingFields, touchedFields } = mergeIssuePair(localIssue, incomingIssue, fieldDefs);
    mergedIssues.push(mergedIssue);
    if (overlappingFields.length) notices[localIssue.id] = overlappingFields;
    const entries = computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, inboundInfo);
    if (entries.length) proseMergeEntries[localIssue.id] = entries;
    if (touchedFields.length || entries.length) {
      mergeIssueSummaries.push(buildMergeIssueSummary(localIssue.id, localIssue, incomingIssue, touchedFields, entries, fieldDefs));
    }
  }
  let nextNum = localIssues.reduce((m, i) => Math.max(m, i.num || 0), 0) + 1;
  for (const incomingIssue of parsedIssues) {
    if (localById.has(incomingIssue.id)) continue;
    mergedIssues.push({
      id: incomingIssue.id, num: nextNum++, fieldRefs: incomingIssue.fieldRefs || {}, fieldLoading: {},
      values: incomingIssue.values || {}, commentStreams: incomingIssue.commentStreams || {}, history: incomingIssue.history || []
    });
  }
  return { mergedIssues, notices, proseMergeEntries, mergeIssueSummaries };
}
// True if applying this computed merge would land anything at all --
// tracker #124 (5c3051e9)'s own gate needs this to know when to disable
// "Merge update" and say so, rather than mergeIssueSummaries.length
// alone, which misses two real cases: a genuinely NEW issue that didn't
// exist locally before (computeIssueMerge's own second loop pushes it
// straight into mergedIssues, no summary entry -- there was never a
// local counterpart to diff touchedFields against), and a comment-only
// change (comments union via the completely separate mergeCommentStreams
// mechanism, which never populates mergeIssueSummaries at all -- see
// FORMAT.md's own "comment-stream entries are never contested on merge,
// only ever unioned").
function mergeHasRealChanges(localIssues, computed) {
  if ((computed.mergeIssueSummaries || []).length) return true;
  const localById = new Map((localIssues || []).map(i => [i.id, i]));
  for (const mi of (computed.mergedIssues || [])) {
    const local = localById.get(mi.id);
    if (!local) return true; // a genuinely new issue
    const ids = new Set([...Object.keys(mi.commentStreams || {}), ...Object.keys(local.commentStreams || {})]);
    for (const id of ids) {
      if (((mi.commentStreams || {})[id] || []).length !== ((local.commentStreams || {})[id] || []).length) return true;
    }
  }
  return false;
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
    const valueChanged = JSON.stringify(before === undefined ? null : before) !== JSON.stringify(after === undefined ? null : after);
    const srcDef = fieldDefs[def.linkedSourceId];
    const srcLabel = srcDef ? srcDef.label : def.linkedSourceId;
    // Tracker issue #66 (bfdbe595), Part 2: a "copy field X" bound row
    // carries X's own real fieldRef along with its value -- copied here
    // via commitSignedEntry's normal fieldRef param, so it lands in real
    // signed history and therefore in issue.fieldRefs (deriveIssueFieldRefs),
    // exactly like a link a person pasted in directly. Any OTHER field
    // bound with this one as its own linkedSourceId can then read
    // source.github/source.jira/etc. from it for real, not just matching
    // text. null for every other bound field type/mode, unaffected.
    const fieldRef = computeBoundFieldRef(issue, def);
    // A copy-field's own fieldRef can go stale even when its copied VALUE
    // doesn't change (e.g. refreshing the source Jira/GitHub issue changes
    // its metadata shape -- tracker #112's trimming -- but not its title).
    // Re-persist whenever the copied ref itself moved too, not just the
    // value, so a source refresh always propagates through the copy.
    const beforeFieldRef = (issue.fieldRefs && issue.fieldRefs[colId]) || null;
    const hasFieldRefRelationship = fieldRef !== null || beforeFieldRef !== null;
    const fieldRefChanged = hasFieldRefRelationship && JSON.stringify(fieldRef) !== JSON.stringify(beforeFieldRef);
    if (!valueChanged && !fieldRefChanged) continue;
    const displayVal = displayValueForHistory(def, after);
    const source = buildSource(issue, def.linkedSourceId);
    const derivedFrom = source.text ? ('state of ' + source.text + ' in column ' + srcLabel) : srcLabel;
    entries.push({ colId, text: (def.label || colId) + ' set to ' + displayVal + ' (derived from ' + derivedFrom + ')', value: after, fieldRef });
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

// Deterministic, dependency-free low-poly triangulated-mesh background for
// the project header (tracker #83), seeded by the project's own id: the
// same project always regenerates the same mesh, different projects get
// different ones, with nothing stored. A jittered point grid is
// triangulated by splitting each grid cell into two triangles, each
// flat-shaded with the average of its own 3 vertex colors -- vertex colors
// come from interpolating across a per-seed two-color palette, plus a small
// per-point lightness jitter for texture. This is the same well-known
// low-poly-gradient technique the design handoff's own Trianglify
// reference is built on, reimplemented locally (no CDN dependency) since
// wigwag is a single-file, no-build-step, offline-capable app.
function headerMeshHash(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function headerMeshRng(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function headerMeshHexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function headerMeshRgbToHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
const HEADER_MESH_WIDTH = 1600;
const HEADER_MESH_HEIGHT = 160;
const HEADER_MESH_CELL_SIZE = 110;
const HEADER_MESH_VARIANCE = 0.85;
const HEADER_MESH_PALETTES = [
  ['#f6d9c4', '#5b2a86'], ['#bfe6fb', '#124b8f'], ['#cdebc9', '#1c5e2c'],
  ['#ffe2b0', '#c34a00'], ['#e7c3ee', '#5e1a80'], ['#fff2b0', '#a35a00'],
  ['#bfe9e2', '#0d5c52'], ['#f8c6da', '#94134f']
];
function computeHeaderMeshTriangles(seed) {
  const width = HEADER_MESH_WIDTH, height = HEADER_MESH_HEIGHT;
  const cellSize = HEADER_MESH_CELL_SIZE, variance = HEADER_MESH_VARIANCE;
  const rand = headerMeshRng(headerMeshHash(seed));
  const palette = HEADER_MESH_PALETTES[Math.floor(rand() * HEADER_MESH_PALETTES.length)];
  const [ar, ag, ab] = headerMeshHexToRgb(palette[0]);
  const [br, bg, bb] = headerMeshHexToRgb(palette[1]);
  const cols = Math.ceil(width / cellSize) + 1;
  const rows = Math.ceil(height / cellSize) + 1;
  const jitter = cellSize * variance * 0.5;
  const points = [];
  for (let j = 0; j < rows; j++) {
    const row = [];
    for (let i = 0; i < cols; i++) {
      const x = i * cellSize + (i > 0 && i < cols - 1 ? (rand() * 2 - 1) * jitter : 0);
      const y = j * cellSize + (j > 0 && j < rows - 1 ? (rand() * 2 - 1) * jitter : 0);
      const u = cols > 1 ? i / (cols - 1) : 0;
      const shade = 1 + (rand() * 2 - 1) * 0.12;
      row.push({ x, y, r: (ar + (br - ar) * u) * shade, g: (ag + (bg - ag) * u) * shade, b: (ab + (bb - ab) * u) * shade });
    }
    points.push(row);
  }
  const avgColor = (a, b, c) => headerMeshRgbToHex((a.r + b.r + c.r) / 3, (a.g + b.g + c.g) / 3, (a.b + b.b + c.b) / 3);
  const triangles = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const p00 = points[j][i], p10 = points[j][i + 1], p01 = points[j + 1][i], p11 = points[j + 1][i + 1];
      triangles.push({ points: [[p00.x, p00.y], [p10.x, p10.y], [p01.x, p01.y]], fill: avgColor(p00, p10, p01) });
      triangles.push({ points: [[p10.x, p10.y], [p11.x, p11.y], [p01.x, p01.y]], fill: avgColor(p10, p11, p01) });
    }
  }
  return { width, height, triangles };
}

// --- Matrix backend adapter -------------------------------------------
// Consumed by wigwag-matrix-host.html (a separate, non-bundled file --
// see the "wigwag as a Matrix widget" plan), never by wigwag.html itself.
// wigwag's own append-only signed-history model maps directly onto
// Matrix's TIMELINE (regular room events), not state events: each
// history/comment entry becomes one room event, so there is no chunking/
// blob-splitting scheme to design -- a Matrix timeline already handles
// arbitrarily long, paginated, append-only event streams as a first-
// class concept, the same thing an issue's history array already is.
// There is deliberately no separate "current state" event either --
// deriveIssueValues/deriveFieldDefs already recompute everything fresh
// from a flat list of entries, the same way parseJsonl's callers already
// rely on for a .jsonl file.
const WIGWAG_MATRIX_ENTRY_TYPE = 'dev.wigwag.entry';
const WIGWAG_MATRIX_EVENT_VERSION = 1;

// Encodes one signed history/comment entry as a Matrix room event's
// content. Deliberately never carries keyRef -- that dedup (tracker
// #132) exists to shrink a repeated ~180-byte pubKey JWK across many
// lines of ONE JSONL FILE; on Matrix every entry is already its own
// independently-sized event, so inline pubKey is simplest and correct
// here, not a gap to close later.
// projectId is optional -- a room predating this field (or a caller not
// yet distinguishing multiple projects) omits it entirely, which
// hydrateProjectFromMatrixTimeline below treats as "the room's one
// legacy/default project" by default. Once a room genuinely holds
// several projects, every NEW entry a client sends should carry its
// real projectId explicitly -- untagged is a legacy shape to keep
// reading, not one to keep writing.
function matrixEventContentFromEntry({ scope, issueId, stream, entry, projectId }) {
  const content = { v: WIGWAG_MATRIX_EVENT_VERSION, scope, stream: stream || null, entry };
  if (scope === 'issue') content.issueId = issueId;
  if (projectId) content.projectId = projectId;
  return content;
}
// Inverse of matrixEventContentFromEntry. Tolerant of malformed or
// foreign event content -- returns null rather than throwing, same
// discipline as parseJsonl's own per-line try/catch, since a real room's
// timeline may carry ordinary chat or other widgets' events alongside
// wigwag's own.
function entryFromMatrixEvent(rawEvent) {
  try {
    const content = rawEvent && rawEvent.content;
    if (!content || content.v !== WIGWAG_MATRIX_EVENT_VERSION) return null;
    if (content.scope !== 'issue' && content.scope !== 'project') return null;
    if (!content.entry || typeof content.entry !== 'object') return null;
    if (content.scope === 'issue' && !content.issueId) return null;
    return { scope: content.scope, issueId: content.issueId || null, stream: content.stream || null, entry: content.entry, projectId: content.projectId || null };
  } catch (e) { return null; }
}
const WIGWAG_MATRIX_ENTRIES_TYPE = 'dev.wigwag.entries';
// Bulk-transport optimization (tracker #149, live-reported): a one-time
// bulk operation -- adopting a newly-imported project into a room, say --
// sending one event per entry hit real homeserver rate limiting hard
// enough to matter. Fewer, bigger requests sidesteps that at the source,
// rather than only retrying through it (sendMatrixEntry's own
// retry-with-backoff below still matters for this too, just less often).
// Each item in `items` is exactly the per-entry content
// matrixEventContentFromEntry already produces -- carried inside one
// event's array instead of each being its own event. Never used for a
// normal single incremental edit; one event per entry is already optimal
// there (nothing to batch).
function matrixEventContentFromEntries(items) {
  return { v: WIGWAG_MATRIX_EVENT_VERSION, items: items.map(item => matrixEventContentFromEntry(item)) };
}
// Inverse of matrixEventContentFromEntries. Tolerant like
// entryFromMatrixEvent: a malformed batch event, or one bad item inside an
// otherwise-good batch, is skipped rather than throwing away (or crashing
// on) the whole thing. Returns an array (possibly empty), not a single
// item or null, since one batch event decodes to many entries.
function entriesFromMatrixEvent(rawEvent) {
  try {
    const content = rawEvent && rawEvent.content;
    if (!content || content.v !== WIGWAG_MATRIX_EVENT_VERSION || !Array.isArray(content.items)) return [];
    return content.items.map(item => entryFromMatrixEvent({ content: item })).filter(Boolean);
  } catch (e) { return []; }
}
// Project index (tracker f6b39bf0/#153, live-reported rate-limit incident):
// a Matrix STATE event, not a timeline event -- deliberately the one
// exception to this whole adapter's "no separate current-state event"
// stance (see the top-of-section comment above). Two things a state event
// gives that a timeline entry can't: (1) always instantly and completely
// readable via a current-state fetch, immune to how much unrelated room
// traffic sits between "now" and when a project was created, unlike
// scanning a timeline that might have to page arbitrarily far back; (2)
// Matrix's own power-level model gates STATE events at `state_default`
// (typically 50) by default, unlike ordinary messages (`events_default`,
// typically 0) -- Tom's explicit call was to lean on exactly this as a
// real access-control gate, not just a discoverability optimization: only
// room moderators can create a new project. `state_key` is the project id
// itself (one state event per project, "exists or doesn't" -- content
// carries no authoritative data of its own; a project's name/fields/
// issues are still derived purely from its signed timeline entries, same
// as ever). Backward compatibility for every room that predates this
// event type lives in discoverProjects (wigwag-matrix-host.html), not
// here: a project already evidenced by real timeline entries is never
// gated retroactively.
const WIGWAG_MATRIX_PROJECT_STATE_TYPE = 'dev.wigwag.project';
function matrixStateEventContentFromProjectCreation({ createdAt, createdBy }) {
  return { v: WIGWAG_MATRIX_EVENT_VERSION, createdAt: createdAt || null, createdBy: createdBy || null };
}
// Tolerant like entryFromMatrixEvent: a state_key is required (Matrix
// itself guarantees one is present on any real state event, but a
// malformed/foreign event is still handled the same defensive way as
// everything else in this adapter).
function projectIdFromMatrixStateEvent(rawEvent) {
  if (!rawEvent || rawEvent.type !== WIGWAG_MATRIX_PROJECT_STATE_TYPE) return null;
  if (typeof rawEvent.state_key !== 'string' || !rawEvent.state_key) return null;
  return rawEvent.state_key;
}
// Room snapshot (tracker f6b39bf0/#153, f1c7098f/#154): a repackaging of a
// project's full history-so-far into fewer, more recent events, so a fresh
// connect only needs the LATEST snapshot plus whatever's newer, not the
// room's entire timeline from the start. Deliberately NOT a squash to
// current values -- "history is the sole source of truth" (docs/FORMAT.md)
// still holds; every entry keeps its own real signature, just repackaged.
// This is also what makes it a real E2EE fix (tracker f1c7098f), not just
// a pagination one: a fresh snapshot is a NEW event, encrypted under
// whatever Megolm session is current when it's sent, so a member who
// joined after the original entries but before the snapshot still gets
// it -- they're a current member when the snapshot's own session is
// shared, unlike the old individual entries.
//
// A snapshot's payload is one client-side-encrypted media blob (tracker
// f6b39bf0, live-reported rate-limit incident), not a set of chunk
// events. The original event-chunking design (mirroring NeoBoard's
// manifest+chunk pattern) turned out to BE the problem, not just an
// efficiency question: a 1500-entry project chunked at 25/event meant ~60
// sequential room-event sends, which is exactly the kind of burst a real
// homeserver's rate limiter targets -- and a chunk send that permanently
// failed partway through left a manifest promising N chunks with fewer
// actually delivered, which (correctly, by the completeness rule) gets
// discarded entirely on read, taking the WHOLE project down with it, not
// just some missing entries. A single blob has no such partial state:
// either the download+decrypt+hash-check succeeds, or the snapshot didn't
// happen and it's a full tail replay -- nothing in between. It also cuts
// the write side from ~60 room-event sends to ~2 (one media upload, one
// small manifest event), almost entirely avoiding the per-room event-send
// rate limiter this incident actually hit. Confirmed via MSC4039 ("Access
// the Content repository with the Widget API") that the widget transport
// can reach the media repo too, not just the direct transport -- see
// wigwag-matrix-host.html's uploadSnapshotBlob/downloadSnapshotBlob.
//
// Encryption follows Matrix's own established EncryptedFile convention
// (the same shape Element already uses for encrypted images/files in
// E2EE rooms) rather than inventing a bespoke format: AES-CTR, a JWK key,
// a base64 iv/counter, and a sha256 hash of the CIPHERTEXT (checked
// BEFORE ever attempting to decrypt, so a corrupted/tampered blob is
// caught cleanly rather than fed to the cipher). The media repo itself
// provides no confidentiality on its own -- the manifest event carrying
// the key material is what's actually protected (it's an ordinary
// Megolm-encrypted room event like any other), so only a current room
// member who can decrypt the manifest ever gets the key needed to decrypt
// the blob.
const WIGWAG_MATRIX_SNAPSHOT_TYPE = 'dev.wigwag.snapshot';
// 64-bit counter within the 128-bit IV (the other 64 bits are the fixed
// nonce half) -- the same split Matrix's own AES-CTR encrypted-media
// convention uses.
const SNAPSHOT_AES_CTR_LENGTH = 64;
async function encryptSnapshotPayload(plaintextBytes) {
  const key = await crypto.subtle.generateKey({ name: 'AES-CTR', length: 256 }, true, ['encrypt', 'decrypt']);
  const counter = crypto.getRandomValues(new Uint8Array(16));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter, length: SNAPSHOT_AES_CTR_LENGTH }, key, plaintextBytes));
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));
  return {
    ciphertext,
    encryption: { key: jwk, iv: base64FromBytes(counter), hashes: { sha256: base64FromBytes(hashBytes) }, v: 'v2' }
  };
}
// Tolerant like every other decode in this adapter: any failure (missing
// key material, a hash mismatch -- corrupted or tampered ciphertext,
// caught BEFORE ever decrypting -- a bad key, a decrypt error) returns
// null rather than throwing. The caller treats null exactly like "no
// snapshot exists" and falls back to a full replay -- never a partial or
// silently-wrong hydration.
async function decryptSnapshotPayload({ ciphertext, encryption }) {
  try {
    if (!ciphertext || !encryption || !encryption.key || !encryption.iv || !encryption.hashes || !encryption.hashes.sha256) return null;
    const actualHashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));
    if (base64FromBytes(actualHashBytes) !== encryption.hashes.sha256) return null;
    const key = await crypto.subtle.importKey('jwk', encryption.key, { name: 'AES-CTR' }, false, ['decrypt']);
    const counter = bytesFromBase64(encryption.iv);
    const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: SNAPSHOT_AES_CTR_LENGTH }, key, ciphertext);
    return new Uint8Array(plaintextBuf);
  } catch (e) { return null; }
}
// The manifest/anchor event: points at the encrypted blob (mxc + the key
// material needed to decrypt it) and declares the highest sortKey
// included, so a caller that finds this snapshot knows exactly which
// (much smaller) tail of newer entries still needs pulling separately.
// createdAt (wall-clock ms, tracker f6b39bf0's cadence-floor follow-up) is
// when this snapshot was WRITTEN, not derived from the entries' own
// sortKeys (cutoffSortKey) -- a quiet project's last real edit could be
// long ago even on a snapshot taken today. Lets a reconnecting bridge
// seed its own "when did we last snapshot this project" bookkeeping
// accurately, without needing to have been the one that wrote it.
function matrixEventContentFromSnapshotManifest({ projectId, snapshotId, cutoffSortKey, mxc, size, encryption, createdAt }) {
  return { v: WIGWAG_MATRIX_EVENT_VERSION, projectId, snapshotId, cutoffSortKey, mxc, size, encryption, createdAt };
}
function snapshotManifestFromMatrixEvent(rawEvent) {
  try {
    const content = rawEvent && rawEvent.content;
    if (!content || content.v !== WIGWAG_MATRIX_EVENT_VERSION) return null;
    if (!content.snapshotId || !content.projectId || !content.mxc || !content.encryption) return null;
    return { projectId: content.projectId, snapshotId: content.snapshotId, cutoffSortKey: content.cutoffSortKey || 0, mxc: content.mxc, size: content.size || 0, encryption: content.encryption, createdAt: content.createdAt || 0 };
  } catch (e) { return null; }
}
// Pure and synchronous, unlike resolving a snapshot's actual payload
// below -- picks the highest-cutoffSortKey manifest per project out of
// whatever raw events a caller has already pulled. Callers use this to
// decide WHICH snapshot (if any) is worth resolving before paying for the
// download.
function findLatestSnapshotManifests(rawEvents) {
  const manifestsByProject = new Map(); // projectId -> latest manifest seen
  for (const rawEvent of (rawEvents || [])) {
    if (!rawEvent || rawEvent.type !== WIGWAG_MATRIX_SNAPSHOT_TYPE) continue;
    const manifest = snapshotManifestFromMatrixEvent(rawEvent);
    if (!manifest) continue;
    const existing = manifestsByProject.get(manifest.projectId);
    if (!existing || manifest.cutoffSortKey >= existing.cutoffSortKey) manifestsByProject.set(manifest.projectId, manifest);
  }
  return manifestsByProject;
}
// Async, unlike findLatestSnapshotManifests above -- actually fetches and
// decrypts a given manifest's blob. `downloadFn(mxc)` is transport-
// supplied (direct: a plain fetch against the media API; widget:
// org.matrix.msc4039.download_file) and must resolve to
// `{status:'ok', bytes}` or an error shape; this never assumes which.
// Returns `{items}` (the same {scope, issueId, stream, entry, projectId}
// shape entryFromMatrixEvent/entriesFromMatrixEvent already produce) on
// full success, or null on ANY failure at all -- a failed download, a
// hash/decrypt failure (see decryptSnapshotPayload), or malformed JSON
// are all treated identically by the caller: this snapshot doesn't
// count, fall back to a full replay for this project.
async function resolveSnapshotPayload(manifest, { downloadFn }) {
  try {
    const downloadResult = await downloadFn(manifest.mxc);
    if (!downloadResult || downloadResult.status !== 'ok' || !downloadResult.bytes) return null;
    const plaintextBytes = await decryptSnapshotPayload({ ciphertext: downloadResult.bytes, encryption: manifest.encryption });
    if (!plaintextBytes) return null;
    const parsed = JSON.parse(new TextDecoder().decode(plaintextBytes));
    if (!Array.isArray(parsed)) return null;
    const items = parsed.map(item => entryFromMatrixEvent({ content: item })).filter(Boolean);
    return { items };
  } catch (e) { return null; }
}
// Decodes a flat list of raw Matrix events (single dev.wigwag.entry OR
// batch dev.wigwag.entries, any order, foreign/malformed events silently
// skipped) into one flat array of {scope, issueId, stream, entry,
// projectId} items -- the same shape entryFromMatrixEvent/
// entriesFromMatrixEvent already produce, just uniformly flattened. Used
// wherever a caller needs to reason about individual entries directly
// (e.g. filtering out ones a found snapshot already covers, see
// createMatrixBridge's own connect() in wigwag-matrix-host.html) rather
// than feeding raw events straight into hydrateProjectFromMatrixTimeline.
function decodeAllMatrixEntryItems(rawEvents) {
  const items = [];
  for (const rawEvent of (rawEvents || [])) {
    if (rawEvent && rawEvent.type === WIGWAG_MATRIX_ENTRIES_TYPE) {
      items.push(...entriesFromMatrixEvent(rawEvent));
    } else {
      const decoded = entryFromMatrixEvent(rawEvent);
      if (decoded) items.push(decoded);
    }
  }
  return items;
}
// The Matrix analog of parseJsonl: takes a flat list of raw Matrix room
// events (any order -- callers are not required to pre-sort, and a
// mixed-in foreign/malformed event is simply skipped), already filtered
// to WIGWAG_MATRIX_ENTRY_TYPE, and reconstructs the same
// {fields, projectHistory, issues, ...} shape parseJsonl produces for a
// real .jsonl file, so every existing derivation/merge/render function
// downstream (hydrateProject/hydrateIssue/deriveFieldDefs/
// deriveIssueValues) is reused completely unchanged.
//
// num is DERIVED here (sorted by each issue's own earliest entry
// sortKey, id as tiebreak) rather than stored, since Matrix's timeline
// has no serialization point equivalent to GitHub's sha-conditional PUT
// -- two clients creating an issue "simultaneously" from two different
// rooms/sessions is a real possibility, and deriving num (like every
// other materialized value in this format) means it self-corrects on
// the next load rather than two issues ever colliding on one number.
//
// projectName/projectNotes/projectComments are not represented in the
// Matrix event shape at all yet -- a deliberate v1 gap, not an oversight
// (see the "wigwag as a Matrix widget" plan): the caller
// (wigwag-matrix-host.html) already knows which Matrix room maps to
// which local project id from its own bootstrap, independent of
// anything in the timeline, so projectName is accepted as a
// caller-supplied override here rather than derived.
//
// A room can hold more than one project's worth of entries in one
// timeline (tracker #149, confirmed necessary live -- importing an
// existing project into a room must keep its own identity, not get
// mangled into "the" room's one project). `projectId` says which
// project THIS hydration pass is for; an entry matches it if its own
// content.projectId equals it, OR the entry has no projectId at all
// AND `includeUntaggedEntries` is true (default) -- untagged is the
// legacy shape every entry had before this field existed, so treating
// it as "belongs to the one default project" keeps a room's existing
// history intact. A caller hydrating anything OTHER than that legacy
// default project should pass `includeUntaggedEntries: false`
// explicitly, so a second project's hydration never silently absorbs
// the first project's untagged history.
function hydrateProjectFromMatrixTimeline(rawEvents, opts) {
  const { fieldDefs: fallbackFieldDefs, projectId, projectName, includeUntaggedEntries } = opts || {};
  const includeUntagged = includeUntaggedEntries !== false;
  const projectHistory = [];
  const issueHistoryById = new Map();
  const commentStreamsById = new Map();
  for (const rawEvent of (rawEvents || [])) {
    // A batch event (bulk-transport optimization, tracker #149) expands
    // into the same per-item shape a normal single-entry event decodes to
    // -- everything below is blind to which shape an entry originally
    // arrived as.
    const decodedItems = (rawEvent && rawEvent.type === WIGWAG_MATRIX_ENTRIES_TYPE)
      ? entriesFromMatrixEvent(rawEvent)
      : [entryFromMatrixEvent(rawEvent)].filter(Boolean);
    for (const decoded of decodedItems) {
    const matchesThisProject = decoded.projectId ? decoded.projectId === projectId : includeUntagged;
    if (!matchesThisProject) continue;
    if (decoded.scope === 'project') { projectHistory.push(decoded.entry); continue; }
    const issueId = decoded.issueId;
    if (decoded.stream) {
      if (!commentStreamsById.has(issueId)) commentStreamsById.set(issueId, {});
      const streams = commentStreamsById.get(issueId);
      if (!streams[decoded.stream]) streams[decoded.stream] = [];
      streams[decoded.stream].push(decoded.entry);
    } else {
      if (!issueHistoryById.has(issueId)) issueHistoryById.set(issueId, []);
      issueHistoryById.get(issueId).push(decoded.entry);
    }
    }
  }
  const issueIds = new Set([...issueHistoryById.keys(), ...commentStreamsById.keys()]);
  const rawIssues = [...issueIds].map(id => ({
    id, history: issueHistoryById.get(id) || [], commentStreams: commentStreamsById.get(id) || {}
  }));
  const earliestSortKey = issue => issue.history.reduce((m, h) => (typeof h.sortKey === 'number' && h.sortKey < m) ? h.sortKey : m, Infinity);
  rawIssues.sort((a, b) => (earliestSortKey(a) - earliestSortKey(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  rawIssues.forEach((issue, i) => { issue.num = i + 1; });

  const ensuredFieldDefs = ensureCommentsFieldDef(fallbackFieldDefs || {});
  const backfilledProjectHistory = backfillProjectHistory(ensuredFieldDefs, projectHistory);
  const fieldDefs = deriveFieldDefs(backfilledProjectHistory);
  const hydratedIssues = rawIssues.map(iss => hydrateIssue(iss, fieldDefs));
  // A real, derivable field:'name' entry (tracker #149) always wins over
  // the caller's fallback (e.g. a room-name-derived placeholder) -- the
  // fallback only applies once, before any project-scope rename entry has
  // ever been written to this timeline.
  const derivedProjectName = deriveProjectName(backfilledProjectHistory);
  return {
    fields: fieldDefs, projectHistory: backfilledProjectHistory, issues: hydratedIssues,
    projectId: projectId || null, projectName: derivedProjectName || projectName || null, projectNotes: null, projectComments: null,
    formatVersion: WIGWAG_MATRIX_EVENT_VERSION
  };
}

// Direct Matrix Client-Server API helpers -- wigwag-matrix-host.html's
// own standalone-mode transport (a personal access token, same shape as
// GitHub sync's own personal-token model, not a widget concept at all).
// Same discipline as pullGithubFile/pushGithubFile/probeGithubRepoAccess:
// injected fetchImpl, discriminated-union {status, ...} returns, never
// throw on network/HTTP failure -- the caller decides how to surface it.
async function resolveMatrixRoomAlias({ fetchImpl, homeserverUrl, accessToken, alias }) {
  try {
    const url = homeserverUrl.replace(/\/$/, '') + '/_matrix/client/v3/directory/room/' + encodeURIComponent(alias);
    const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (res.status === 404) return { status: 'not-found' };
    if (!res.ok) return { status: 'error', message: 'Matrix returned ' + res.status };
    const data = await res.json();
    return { status: 'ok', roomId: data.room_id };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
// dir: 'b' (backwards, newest-first -- the default, matching a normal
// scrollback fetch) or 'f' (forwards, for resuming from a stored cursor).
// from, if given, is a previous response's own `end` pagination token.
// limit, if given, caps how many events one call returns -- omitted means
// whatever the homeserver's own default is (often small; a caller that
// needs a real room's full history should pass an explicit limit and loop
// on `end` until a call returns an empty chunk, see createDirectTransport's
// own pullInitial in wigwag-matrix-host.html).
async function fetchMatrixRoomEntries({ fetchImpl, homeserverUrl, accessToken, roomId, from, dir, limit }) {
  try {
    // dev.wigwag.project (a state event) rides this same type-filtered
    // pull deliberately -- Matrix state events are also ordinary timeline
    // events at the position they were sent, so a project created WHILE
    // an already-connected viewer's poll is running is picked up here with
    // zero extra mechanism, same as any other new entry. A cold connect's
    // reliable, order-independent discovery still comes from a real
    // current-state fetch (getMatrixRoomState), not from however far back
    // this pagination happens to reach.
    const filter = encodeURIComponent(JSON.stringify({ types: [WIGWAG_MATRIX_ENTRY_TYPE, WIGWAG_MATRIX_ENTRIES_TYPE, WIGWAG_MATRIX_SNAPSHOT_TYPE, WIGWAG_MATRIX_PROJECT_STATE_TYPE] }));
    let url = homeserverUrl.replace(/\/$/, '') + '/_matrix/client/v3/rooms/' + encodeURIComponent(roomId) + '/messages?dir=' + (dir || 'b') + '&filter=' + filter;
    if (from) url += '&from=' + encodeURIComponent(from);
    if (limit) url += '&limit=' + encodeURIComponent(limit);
    const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (res.status === 403) return { status: 'forbidden' };
    if (res.status === 404) return { status: 'not-found' };
    if (!res.ok) return { status: 'error', message: 'Matrix returned ' + res.status };
    const data = await res.json();
    return { status: 'ok', events: data.chunk || [], end: data.end || null };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
// txnId must be unique per request (the client, not the server, owns
// idempotency here) -- a random-enough string the caller generates once
// per attempt, retried with the SAME txnId on a network retry so a
// flaky connection can never double-send the same entry.
//
// Retries on 429 (M_LIMIT_EXCEEDED) -- tracker #149, live-reported: bulk-
// adopting a large imported project (createMatrixBridge's
// adoptLocalProjects, wigwag-matrix-host.html) sends one PUT per history
// entry in a tight loop with no pacing, which real homeservers rate-limit
// under real-world burst volume. Before this fix, a 429 was treated as a
// terminal error -- the entry was silently dropped (visible live as two
// viewers disagreeing on a project's name: whichever entry carrying the
// real name happened to lose the race showed a generic "Project
// <short-id>" placeholder instead). Honors the server's own
// retry_after_ms when present, exponential backoff otherwise, same
// txnId every attempt (a retried PUT is idempotent).
const MATRIX_SEND_MAX_RETRIES = 6;
// Shared by sendMatrixEntry, sendMatrixEntries, and (via an explicit
// stateKey) sendMatrixProjectStateEvent -- identical PUT-with-retry
// mechanics regardless of event type/content shape, or whether this is a
// timeline send (txnId-keyed) or a state write (state_key-keyed). A state
// PUT needs no txnId at all: overwrite-by-state_key is already idempotent
// server-side (a retried PUT with the same content is a genuine no-op),
// unlike a timeline send where the SAME txnId is what makes a retry safe.
// Shared by putMatrixEvent AND the media upload below (tracker f6b39bf0's
// media-blob snapshot rework) -- any Matrix HTTP call (a /send or /state
// PUT, a media upload POST) can hit the same M_LIMIT_EXCEEDED response
// under burst volume, so this is the one place the retry loop lives.
// Returns the real fetch Response on the first non-429 status, or on a
// 429 once retries are exhausted (the caller sees that final 429 itself
// and reports it -- its body is deliberately never read here in that
// case, so the caller can still safely call .json()/.text() on it
// exactly once, same discipline as everywhere else in this file). Only
// ever reads the response body itself when about to retry (extracting
// retry_after_ms), never on a response it's handing back. Throws only on
// a genuine network-level failure -- the caller's own try/catch turns
// that into its own {status:'error'} shape, matching existing per-caller
// conventions; not caught here so a network error on a retry attempt
// still terminates immediately rather than retrying into a wall.
async function fetchWithMatrixRetry429(fetchImpl, url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, init);
    if (res.status !== 429) return res;
    if (attempt >= MATRIX_SEND_MAX_RETRIES) return res;
    let retryAfterMs = 1000 * Math.pow(2, attempt);
    try { const body = await res.json(); if (typeof body.retry_after_ms === 'number') retryAfterMs = body.retry_after_ms; } catch (e) { /* no/invalid JSON body -- keep the backoff default */ }
    await new Promise(resolve => setTimeout(resolve, retryAfterMs));
  }
}
async function putMatrixEvent({ fetchImpl, homeserverUrl, accessToken, roomId, eventType, content, txnId, stateKey }) {
  const base = homeserverUrl.replace(/\/$/, '') + '/_matrix/client/v3/rooms/' + encodeURIComponent(roomId);
  const url = (stateKey !== undefined)
    ? base + '/state/' + eventType + '/' + encodeURIComponent(stateKey)
    : base + '/send/' + eventType + '/' + encodeURIComponent(txnId);
  try {
    const res = await fetchWithMatrixRetry429(fetchImpl, url, { method: 'PUT', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(content) });
    if (res.status === 403) return { status: 'forbidden' };
    if (res.status === 429) return { status: 'error', message: 'rate-limited (429) after ' + MATRIX_SEND_MAX_RETRIES + ' retries' };
    if (!res.ok) return { status: 'error', message: 'Matrix returned ' + res.status };
    const data = await res.json();
    return { status: 'ok', eventId: data.event_id };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
async function sendMatrixEntry({ fetchImpl, homeserverUrl, accessToken, roomId, content, txnId }) {
  return putMatrixEvent({ fetchImpl, homeserverUrl, accessToken, roomId, eventType: WIGWAG_MATRIX_ENTRY_TYPE, content, txnId });
}
// Bulk-transport optimization (tracker #149) -- see
// matrixEventContentFromEntries above. `content` is already the batch
// shape (matrixEventContentFromEntries's own return value); this just
// PUTs it as a dev.wigwag.entries event instead of dev.wigwag.entry,
// reusing the exact same retry-on-429 mechanics.
async function sendMatrixEntries({ fetchImpl, homeserverUrl, accessToken, roomId, content, txnId }) {
  return putMatrixEvent({ fetchImpl, homeserverUrl, accessToken, roomId, eventType: WIGWAG_MATRIX_ENTRIES_TYPE, content, txnId });
}
// Same retry-on-429 mechanics, for the snapshot manifest event.
async function sendMatrixSnapshotManifest({ fetchImpl, homeserverUrl, accessToken, roomId, content, txnId }) {
  return putMatrixEvent({ fetchImpl, homeserverUrl, accessToken, roomId, eventType: WIGWAG_MATRIX_SNAPSHOT_TYPE, content, txnId });
}
// State write, not a timeline send -- stateKey (the project id) replaces
// txnId. A 'forbidden' result here (putMatrixEvent's existing 403 handling,
// unchanged) is Matrix's own power-level check doing exactly its job: the
// connecting user isn't a room moderator. The caller is responsible for
// turning that into a real, visible "only moderators can add projects
// here" message -- never a silent drop (tracker f6b39bf0, live-reported
// double-send incident: a rejected/failed write must never look like it
// succeeded).
async function sendMatrixProjectStateEvent({ fetchImpl, homeserverUrl, accessToken, roomId, projectId, content }) {
  return putMatrixEvent({ fetchImpl, homeserverUrl, accessToken, roomId, eventType: WIGWAG_MATRIX_PROJECT_STATE_TYPE, content, stateKey: projectId });
}
// Current room state, in one call -- unlike /messages, this is never
// paginated and never a function of how much unrelated history sits in
// the room: it's always the complete, current answer. Used at connect
// time to find every dev.wigwag.project state event reliably, regardless
// of room chattiness (see that event type's own comment above).
async function getMatrixRoomState({ fetchImpl, homeserverUrl, accessToken, roomId }) {
  try {
    const url = homeserverUrl.replace(/\/$/, '') + '/_matrix/client/v3/rooms/' + encodeURIComponent(roomId) + '/state';
    const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (res.status === 403) return { status: 'forbidden' };
    if (!res.ok) return { status: 'error', message: 'Matrix returned ' + res.status };
    const data = await res.json();
    return { status: 'ok', events: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
// Direct-transport media repo access (tracker f6b39bf0's media-blob
// snapshot rework) -- the widget transport's own equivalent goes through
// MSC4039's upload_file/download_file actions instead (wigwag-matrix-
// host.html), never this. Upload stays on the plain, still-current
// /_matrix/media/v3/upload -- confirmed MSC3916 ("Authentication for
// media") moved download/config to the new /_matrix/client/v1/media/*
// namespace but explicitly left upload alone, pending a future MSC.
// Download uses that new, authenticated endpoint (the legacy
// unauthenticated one is deprecated).
async function uploadMatrixMedia({ fetchImpl, homeserverUrl, accessToken, bytes }) {
  try {
    const url = homeserverUrl.replace(/\/$/, '') + '/_matrix/media/v3/upload?filename=snapshot.bin';
    const res = await fetchWithMatrixRetry429(fetchImpl, url, { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/octet-stream' }, body: bytes });
    if (res.status === 429) return { status: 'error', message: 'rate-limited (429) after ' + MATRIX_SEND_MAX_RETRIES + ' retries' };
    if (!res.ok) return { status: 'error', message: 'Matrix media upload returned ' + res.status };
    const data = await res.json();
    return { status: 'ok', mxc: data.content_uri };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
// mxc://<server>/<mediaId> -- the only shape a real homeserver ever hands
// back from an upload, but tolerant of a malformed one anyway (never
// throws on a corrupt manifest field).
function parseMxcUri(mxc) {
  const m = /^mxc:\/\/([^/]+)\/([^/?#]+)$/.exec(mxc || '');
  return m ? { serverName: m[1], mediaId: m[2] } : null;
}
async function downloadMatrixMedia({ fetchImpl, homeserverUrl, accessToken, mxc }) {
  try {
    const parsed = parseMxcUri(mxc);
    if (!parsed) return { status: 'error', message: 'invalid mxc URI: ' + mxc };
    const url = homeserverUrl.replace(/\/$/, '') + '/_matrix/client/v1/media/download/' + encodeURIComponent(parsed.serverName) + '/' + encodeURIComponent(parsed.mediaId);
    const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) return { status: 'error', message: 'Matrix media download returned ' + res.status };
    const buf = await res.arrayBuffer();
    return { status: 'ok', bytes: new Uint8Array(buf) };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
// Matrix generally has no equivalent of GitHub's "public, unauthenticated
// read" tier (a room needs history_visibility: world_readable for that,
// which is unusual) -- so the realistic outcome space here is smaller
// than probeGithubRepoAccess's: either the token's own account is
// already joined (read+write, ordinary room events need no elevated
// power level) or it isn't (no-access). world-readable is detected but
// not designed around.
async function probeMatrixRoomAccess({ fetchImpl, homeserverUrl, accessToken, roomId }) {
  try {
    // Fetching a single message with limit=0 is cheaper and more direct
    // than a separate membership lookup: 200 means readable, 403 means
    // not joined and not world-readable, 404 means the room id is wrong.
    const url = homeserverUrl.replace(/\/$/, '') + '/_matrix/client/v3/rooms/' + encodeURIComponent(roomId) + '/messages?dir=b&limit=0';
    const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (res.status === 403) return { status: 'no-access' };
    if (res.status === 404) return { status: 'no-access' };
    if (!res.ok) return { status: 'error', message: 'Matrix returned ' + res.status };
    return { status: 'can-read-write' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

const WigwagCoreExports = {
  xlsxCrc32, xlsxDeflateRaw, xlsxU16, xlsxU32, XLSX_DOS_TIME, XLSX_DOS_DATE, xlsxBuildZip, xlsxEscape, xlsxColLetter, xlsxDateSerial, xlsxDateTimeSerial, XLSX_PALETTE_HEX, xlsxFieldHref, xlsxBuildStyles, xlsxStylesXml, buildXlsxWorkbook, blankProjectFieldDefs, WIDTHS, defaultFieldDefs, defaultColumnOrder, canonicalColumnOrder, reconcileColumnOrder, TITLE_COL_ID, COMMENTS_COL_ID, SENTINEL_COLUMN_IDS, realColumnOrder, FORMAT_VERSION, STORAGE_KEY, SECRETS_KEY, PROJECTS_KEY, SESSION_PROJECT_KEY, IDENTITIES_KEY, COLUMN_WIDTHS_KEY, WRAP_KEY, COLUMN_ORDER_KEY, COLUMN_FILTERS_KEY, UNSET_FILTER_VALUE, issueValueMatchesFilter, computeColumnFilterExcludedIds, tokenizeFilterQuery, parseFilterQuery, issueMatchesFieldToken, issueMatchesFieldTokens, computeFilterSuggestions, commitFilterSuggestion, COMMENT_READS_KEY, SORT_KEY, SNAPSHOT_INGESTED_KEY, MENTION_NOTIFICATIONS_KEY, NOTIFIED_MENTIONS_KEY, NOTIFIED_MENTIONS_CAP, textMentionsEmail, truncate, splitHighlightSegments, matchingIssuesByIdPrefix, splitEmbeddedWigwagLinks, relativeAge, formatNow, JIRA_KEY_RE, SF_ID_PREFIXES, salesforceObjectTypeFromId, refInfo, col, pickGithubFields, pickJiraFields, pickSalesforceFields, escapeHtml, renderMarkdownInline, renderMarkdown, commentGroupKey, latestCommentsById, deriveIssueValues, backfillIssueHistoryFromValues, deriveIssueFieldRefs, ISSUE_DELETED_FIELD_ID, issueIsDeleted, hydrateIssue, migrateLegacyComments, deriveFieldDefs, PROJECT_NAME_FIELD_ID, deriveProjectName, backfillProjectHistory, hydrateProject, ensureCommentsFieldDef, ensureTimestampFieldDefs, issueActivitySortKeys, issueTimestampValue, base64FromBytes, bytesFromBase64, base64FromText, textFromBase64, MATRIX_USER_ID_RE, principalKind, identityPrincipal, SIGN_ALG, signablePayload, signableProjectPayload, redactedPayload, redactedProjectPayload, signableCommentPayload, redactedCommentPayload, signableProjectCommentPayload, redactedProjectCommentPayload, RULE_NO_OPERAND_OPS, S, ruleCondition, ruleRowCriteria, ruleRowCondition, optionLabelForThen, ruleThenLiteral, compileRuleRows, COLORS, PALETTE_ORDER, buildSource, evalRule, computeBoundValue, isFieldLocked, applyComputedToField, applyLinkedRules, applyLiveLinkedRules, computeBoundFieldRef, sortValue, computeSortSnapshot, issueCreatedAt,
  importSigningKey, signWithKey, verifyPayload, advanceSortKey, commitSignedEntry,
  squashHistory, displayValueForHistory, buildSourceText, keyRegistryEncoder, rehydrateKeyRef, humanFileSize, parseJsonl, entryKey, commentKey, unionByKey, mergeCommentStreams, mergeIssuePair, computeIssueMerge, mergeHasRealChanges, computeFieldDefsMerge, computeDerivedChangeEntries,
  isPastedTextASingleUrl, wrapSelectionWithMarkdownLink,
  buildGithubContentsUrl, buildGithubContentsHeaders, buildGithubCommitMessage, pullGithubFile, pushGithubFile, probeGithubRepoAccess, computeHeaderMeshTriangles, columnFilterIsActive, localISODate, dateFilterPresetRanges,
  WIGWAG_EXPORT_TYPE, WIGWAG_EXPORT_VERSION, canonicalRecordsText, computeContentSha256Hex, fingerprintPublicKey, buildExportEnvelope, parseExportEnvelope, verifyExportEnvelope,
  EXPORT_TRUST_KEY, lookupSenderTrust, classifySenderTrust, rememberSenderTrust, classifyExportProvenance,
  diff3Merge, formatDateLabel, provenanceMarkerSuffix, conflictMarkerLines, hasUnresolvedMergeMarkers, computeMergeProseEntries,
  MERGE_LOG_TYPE, MERGE_LOG_VERSION, mergeLogStorageKey, buildMergeRecord, buildMergeIssueSummary,
  patchMergeSummaryResultEntryId, fieldStillSafeToRevert, computeMergeRollbackEntries,
  buildMergePreviewViewModel, buildMergeFieldTimeline, mergeRecordNeedsAttention, buildMergeFieldDiffLines, mergeSettledValueView, buildMergeIssueTimeline, resolveFieldValueView,
  WIGWAG_MATRIX_ENTRY_TYPE, WIGWAG_MATRIX_ENTRIES_TYPE, WIGWAG_MATRIX_EVENT_VERSION, matrixEventContentFromEntry, entryFromMatrixEvent, matrixEventContentFromEntries, entriesFromMatrixEvent, sendMatrixEntries, hydrateProjectFromMatrixTimeline,
  WIGWAG_MATRIX_PROJECT_STATE_TYPE, matrixStateEventContentFromProjectCreation, projectIdFromMatrixStateEvent, sendMatrixProjectStateEvent, getMatrixRoomState,
  WIGWAG_MATRIX_SNAPSHOT_TYPE, encryptSnapshotPayload, decryptSnapshotPayload, matrixEventContentFromSnapshotManifest, snapshotManifestFromMatrixEvent, findLatestSnapshotManifests, resolveSnapshotPayload, decodeAllMatrixEntryItems, sendMatrixSnapshotManifest,
  resolveMatrixRoomAlias, fetchMatrixRoomEntries, sendMatrixEntry, probeMatrixRoomAccess,
  fetchWithMatrixRetry429, uploadMatrixMedia, downloadMatrixMedia, parseMxcUri
};

// wigwag.html carries its own separately-maintained inline copy of this
// module (window.WigwagCore) instead of a <script src> to it, since
// wigwag.html's whole point is being one self-contained, offline-capable
// file -- an external file reference was never an option there, and that
// tradeoff is unrelated to this branch. This one IS meant for a plain
// <script> tag: wigwag-matrix-host.html (see the "wigwag as a Matrix
// widget" plan) is a separate, non-portable, always-online file with no
// such constraint, so it can include this file directly rather than
// needing a THIRD hand-copied mirror. Existing require() consumers
// (wigwag-cli.js, wigwag-client.js, wigwag-agent.js, wigwag-core.test.js)
// are unaffected -- module.exports is still set exactly as before.
if (typeof module !== 'undefined' && module.exports) module.exports = WigwagCoreExports;
if (typeof window !== 'undefined') window.WigwagCore = WigwagCoreExports;
