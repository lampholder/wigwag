'use strict';

// ---------- state ----------
let doc = null;           // {meta, issues}
let filename = 'tracker.jsonl';
let activeIssueId = null;    // issue shown in the side detail panel, if any
let sortState = null;     // { key: 'title'|'source'|'linked'|<field key>, dir: 'asc'|'desc' } | null
let filterQuery = '';     // keyword filter, matched against title (case-insensitive substring)
let draggedFieldKey = null; // field key currently being drag-reordered, if any
let pendingMerge = null;  // {doc, conflicts} awaiting resolution
let resolutions = {};     // conflict key -> chosen value (during modal)

const RESERVED_FIELD = 'title';
const OPTION_TYPES = ['enum', 'multiselect']; // field types that carry an options list
const COLOR_NAMES = ['red', 'amber', 'green', 'blue', 'teal', 'purple', 'pink', 'gray'];

// ---------- icons ----------
// Inline stroke-SVGs lifted directly from the Claude Design handoff's prototype
// markup (`Issue Tracker.dc.html`) — its README claims "no icon library, all
// glyphs are Unicode", but the actual prototype markup uses real hand-authored
// SVGs for these exact eight column/sort actions, so those take precedence
// over the README's (inaccurate) summary. stroke="currentColor" so each icon
// just inherits whatever color/opacity its containing element sets.
const ICON_SORT_ASC = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="2" y1="4" x2="8" y2="4"/><line x1="2" y1="8" x2="6.5" y2="8"/><line x1="2" y1="12" x2="5" y2="12"/><path d="M12 13V4M12 4l-2.5 2.5M12 4l2.5 2.5"/></svg>';
const ICON_SORT_DESC = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="2" y1="4" x2="8" y2="4"/><line x1="2" y1="8" x2="6.5" y2="8"/><line x1="2" y1="12" x2="5" y2="12"/><path d="M12 3v9M12 12l-2.5-2.5M12 12l2.5-2.5"/></svg>';
const ICON_EDIT_FIELD = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 4h8M2 8h5M2 12h3"/><path d="M11 13l4-4-2-2-4 4v2h2z"/></svg>';
const ICON_HIDE_FIELD = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l12 12"/><path d="M6.6 3.4A6.7 6.7 0 0 1 8 3.3c3.6 0 6 3 6.7 4.7-.3.75-1 1.9-2 2.9M9.9 9.9a2 2 0 0 1-2.8-2.8M4.2 4.9C2.9 5.9 2 7.2 1.3 8c.7 1.7 3.1 4.7 6.7 4.7 1 0 1.9-.2 2.7-.6"/></svg>';
const ICON_MOVE_LEFT = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8H3M3 8l4-4M3 8l4 4"/></svg>';
const ICON_MOVE_RIGHT = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
const ICON_MOVE_START = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="3" y2="13"/><path d="M13 8H5M5 8l4-4M5 8l4 4"/></svg>';
const ICON_MOVE_END = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><line x1="13" y1="3" x2="13" y2="13"/><path d="M3 8h8M7 4l4 4-4 4"/></svg>';

// ---------- persistence ----------
function saveLocal() {
  if (!doc) return;
  localStorage.setItem('tracker_doc', JSON.stringify(doc));
  localStorage.setItem('tracker_filename', filename);
}

function loadLocal() {
  const raw = localStorage.getItem('tracker_doc');
  if (!raw) return false;
  try {
    doc = JSON.parse(raw);
    doc.issues.forEach(replayIssue);
    filename = localStorage.getItem('tracker_filename') || filename;
    return true;
  } catch (e) {
    console.error('Failed to restore local tracker copy', e);
    return false;
  }
}

function getActor() {
  return localStorage.getItem('tracker_actor') || 'you';
}
function setActor(name) {
  localStorage.setItem('tracker_actor', name || 'you');
}

// ---------- parse / serialize ----------
function parseJSONL(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let meta = null;
  const issues = [];
  for (const line of lines) {
    const rec = JSON.parse(line);
    if (rec._type === 'meta') meta = rec;
    else if (rec._type === 'issue') issues.push(rec);
  }
  if (!meta) throw new Error('No meta record found in file.');
  if (!meta.hidden_field_keys) meta.hidden_field_keys = []; // absent in files predating "Hide field"
  // 'reference' was folded into 'text' (any text field now auto-detects links at
  // display time) — migrate anything saved under the old type so it still loads.
  meta.field_defs.forEach(fd => {
    if (fd.type === 'reference') fd.type = 'text';
    // Options used to be plain strings — migrate to {label, color} objects. The
    // stored field VALUE is still the label string either way, so no issue data
    // needs to change, only the field_def's own option list shape.
    if (Array.isArray(fd.options)) {
      fd.options = fd.options.map(o => (typeof o === 'string' ? { label: o, color: 'gray' } : o));
    }
  });
  issues.forEach(replayIssue);
  return { meta, issues };
}

function serializeJSONL(d, { squash = false } = {}) {
  const lines = [JSON.stringify(d.meta)];
  for (const issue of d.issues) {
    let events = issue.events;
    if (squash) events = squashFieldHistory(events);
    lines.push(JSON.stringify({ ...issue, events }));
  }
  return lines.join('\n') + '\n';
}

// Keep only the latest set_field event per field key (not zero of them —
// events are ground truth on reload, so dropping all of them would lose the
// current value too, not just the history of how it was reached).
function squashFieldHistory(events) {
  const latestByField = new Map();
  events.forEach(e => {
    if (e.op !== 'set_field') return;
    const cur = latestByField.get(e.field);
    if (!cur || e.lamport > cur.lamport) latestByField.set(e.field, e);
  });
  return events.filter(e => e.op !== 'set_field').concat([...latestByField.values()]);
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- event log / replay ----------
function nextLamport(issue) {
  return issue.events.reduce((max, e) => Math.max(max, e.lamport), 0) + 1;
}

function appendEvent(issue, partial) {
  const evt = {
    id: 'evt-' + crypto.randomUUID(),
    actor: getActor(),
    lamport: nextLamport(issue),
    ts: new Date().toISOString(),
    ...partial,
  };
  issue.events.push(evt);
  replayIssue(issue);
  saveLocal();
  render();
}

function replayIssue(issue) {
  const fields = {};
  const links = [];
  const sorted = [...issue.events].sort(
    (a, b) => a.lamport - b.lamport || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0)
  );
  for (const e of sorted) {
    if (e.op === 'set_field') {
      fields[e.field] = e.value;
    } else if (e.op === 'link_add') {
      const idx = links.findIndex(l => l.type === e.link.type && l.target === e.link.target);
      if (idx >= 0) links[idx] = { ...e.link };
      else links.push({ ...e.link });
    } else if (e.op === 'link_remove') {
      const idx = links.findIndex(l => l.type === e.link.type && l.target === e.link.target);
      if (idx >= 0) links.splice(idx, 1);
    }
  }
  issue.fields = fields;
  issue.links = links;
}

// ---------- hashing ----------
function sortObj(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
}

async function computeStateHash(d) {
  const canon = d.issues
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(i => ({
      id: i.id,
      fields: sortObj(i.fields || {}),
      links: (i.links || []).slice().sort((a, b) => (a.type + a.target).localeCompare(b.type + b.target)),
    }));
  const bytes = new TextEncoder().encode(JSON.stringify(canon));
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return 'sha256:' + hex;
}

// ---------- helpers ----------
function fieldDef(key, d = doc) {
  return d.meta.field_defs.find(f => f.key === key);
}
function visibleFieldDefs() {
  const hidden = new Set(doc.meta.hidden_field_keys || []);
  return doc.meta.field_defs.filter(fd => !hidden.has(fd.key));
}
function fieldLabel(key, d = doc) {
  const fd = fieldDef(key, d);
  return fd ? fd.label : key;
}
function displayTitle(issue) {
  if (issue.source) return (issue.source.cached && issue.source.cached.title) || 'Loading…';
  return issue.fields[RESERVED_FIELD] || '(untitled)';
}
function sourceBadge(issue) {
  if (!issue.source) return 'Local';
  if (issue.source.system === 'github') return `GitHub #${issue.source.number}`;
  if (issue.source.system === 'jira') return `Jira ${issue.source.key}`;
  return issue.source.system;
}
function issueById(id) {
  return doc.issues.find(i => i.id === id);
}

// ---------- mutations ----------
function createTracker(title) {
  doc = {
    meta: {
      _type: 'meta',
      format_version: '0.1.0',
      doc_id: crypto.randomUUID(),
      title: title || 'New tracker',
      field_defs: [
        { key: 'solution_status', label: 'Solution for milestone', type: 'enum', options: [
          { label: 'proposed', color: 'gray' }, { label: 'committed', color: 'blue' },
          { label: 'descoped', color: 'gray' }, { label: 'done', color: 'green' },
        ] },
        { key: 'rag', label: 'RAG', type: 'enum', options: [
          { label: 'Red', color: 'red' }, { label: 'Amber', color: 'amber' },
          { label: 'Green', color: 'green' }, { label: 'n/a', color: 'gray' },
        ] },
        { key: 'delivery_teams', label: 'Delivery teams affected', type: 'multiselect', options: [
          { label: 'Platform', color: 'blue' }, { label: 'Mobile', color: 'teal' },
          { label: 'Firmware', color: 'purple' }, { label: 'Ops', color: 'gray' },
        ] },
        { key: 'notes', label: 'Notes', type: 'text' },
      ],
      link_types: ['solved_by', 'blocks', 'duplicates', 'relates_to'],
      hidden_field_keys: [],
      state_hash: '',
      history_hashes: [],
    },
    issues: [],
  };
  filename = (title || 'tracker').replace(/\s+/g, '_').toLowerCase() + '.jsonl';
  saveLocal();
  render();
}

function addItemFromInput(input) {
  const text = input.value.trim();
  if (!text) return;
  if (!doc) createTracker('New tracker');
  const issue = { _type: 'issue', id: crypto.randomUUID(), source: null, fields: {}, links: [], events: [] };
  doc.issues.push(issue);
  // fields is a materialized cache rebuilt entirely from events on every
  // appendEvent — setting it directly here would just get wiped out.
  appendEvent(issue, { op: 'create' });
  const ghParsed = parseGithubIssueUrl(text);
  if (ghParsed) {
    // Dumping a GitHub issue/PR URL here means "this row IS that issue" —
    // bind it as the real source and pull its title, rather than storing
    // the raw URL as a local title string.
    attachGithub(issue, ghParsed.repo, ghParsed.number);
  } else {
    appendEvent(issue, { op: 'set_field', field: RESERVED_FIELD, value: text });
  }
  input.value = '';
}

// ---------- field def popover (add/edit a custom field) ----------
function openFieldPopover(existingKey, anchorEl) {
  if (!doc) createTracker('New tracker');
  closeFieldPopover();
  const existing = existingKey ? fieldDef(existingKey) : null;

  const hiddenDefs = !existing ? doc.meta.field_defs.filter(fd => (doc.meta.hidden_field_keys || []).includes(fd.key)) : [];

  const pop = document.createElement('div');
  pop.className = 'field-popover';
  pop.id = 'fieldPopover';
  pop.innerHTML = `
    ${hiddenDefs.length ? `
      <label>Hidden fields</label>
      <div class="fp-unhide-list">
        ${hiddenDefs.map(fd => `<button type="button" class="fp-unhide" data-key="${escapeHtml(fd.key)}">+ ${escapeHtml(fd.label)}</button>`).join('')}
      </div>
    ` : ''}
    <label>Field name</label>
    <input type="text" class="fp-label" value="${existing ? escapeHtml(existing.label) : ''}">
    <label>Type</label>
    <select class="fp-type" ${existing ? 'disabled' : ''}>
      <option value="text">Text</option>
      <option value="enum">Single select</option>
      <option value="multiselect">Multi-select</option>
    </select>
    ${existing ? '<div class="fp-hint">Type can’t be changed after creation.</div>' : ''}
    <div class="fp-options" hidden>
      <label>Options</label>
      <div class="fp-option-list"></div>
      <button type="button" class="fp-add-option">+ Add option</button>
    </div>
    <div class="fp-actions">
      ${existing ? '<button type="button" class="fp-delete">Delete field</button>' : ''}
      <span class="fp-spacer"></span>
      <button type="button" class="fp-cancel">Cancel</button>
      <button type="button" class="fp-save primary">Save</button>
    </div>
  `;
  document.body.appendChild(pop);

  pop.querySelectorAll('.fp-unhide').forEach(btn => {
    btn.addEventListener('click', () => {
      doc.meta.hidden_field_keys = doc.meta.hidden_field_keys.filter(k => k !== btn.dataset.key);
      saveLocal();
      closeFieldPopover();
      render();
    });
  });

  const typeSelect = pop.querySelector('.fp-type');
  typeSelect.value = existing ? existing.type : 'text';
  const optionsBox = pop.querySelector('.fp-options');
  const optionList = pop.querySelector('.fp-option-list');

  function refreshMoveButtons() {
    const rows = [...optionList.querySelectorAll('.fp-option-row')];
    rows.forEach((r, i) => {
      r.querySelector('.fp-option-up').disabled = i === 0;
      r.querySelector('.fp-option-down').disabled = i === rows.length - 1;
    });
  }

  function closeColorPalette() {
    optionList.querySelectorAll('.fp-color-palette').forEach(p => p.remove());
  }

  function openColorPalette(swatch) {
    const already = swatch.parentElement.querySelector('.fp-color-palette');
    closeColorPalette();
    if (already) return; // was already open on this row — just close it (toggle)
    const palette = document.createElement('div');
    palette.className = 'fp-color-palette';
    COLOR_NAMES.forEach(color => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'fp-color-dot opt-color-' + color + (swatch.dataset.color === color ? ' selected' : '');
      dot.title = color;
      dot.addEventListener('click', () => {
        swatch.dataset.color = color;
        swatch.className = 'fp-color-swatch opt-color-' + color;
        closeColorPalette();
      });
      palette.appendChild(dot);
    });
    swatch.closest('.fp-option-row').insertAdjacentElement('afterend', palette);
  }

  function addOptionRow(opt) {
    const row = document.createElement('div');
    row.className = 'fp-option-row';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'fp-option-move fp-option-up';
    upBtn.textContent = '↑';
    upBtn.addEventListener('click', () => {
      const prev = row.previousElementSibling;
      if (prev) optionList.insertBefore(row, prev);
      refreshMoveButtons();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'fp-option-move fp-option-down';
    downBtn.textContent = '↓';
    downBtn.addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next) optionList.insertBefore(next, row);
      refreshMoveButtons();
    });

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'fp-color-swatch opt-color-' + ((opt && opt.color) || 'gray');
    swatch.dataset.color = (opt && opt.color) || 'gray';
    swatch.title = 'Choose a color';
    swatch.addEventListener('click', () => openColorPalette(swatch));

    const input = document.createElement('input');
    input.type = 'text';
    input.value = (opt && opt.label) || '';

    const removeBtn = document.createElement('span');
    removeBtn.className = 'fp-option-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => { row.remove(); refreshMoveButtons(); });

    row.append(upBtn, downBtn, swatch, input, removeBtn);
    optionList.appendChild(row);
    refreshMoveButtons();
    return row;
  }
  function refreshOptionsVisibility() {
    optionsBox.hidden = !OPTION_TYPES.includes(typeSelect.value);
  }
  refreshOptionsVisibility();
  typeSelect.addEventListener('change', refreshOptionsVisibility);
  (existing && existing.options ? existing.options : []).forEach(addOptionRow);

  pop.querySelector('.fp-add-option').addEventListener('click', () => {
    addOptionRow(null).querySelector('input').focus();
  });
  pop.querySelector('.fp-cancel').addEventListener('click', closeFieldPopover);

  pop.querySelector('.fp-save').addEventListener('click', () => {
    const label = pop.querySelector('.fp-label').value.trim();
    if (!label) { alert('Field name is required.'); return; }
    const type = typeSelect.value;
    const seenLabels = new Set();
    const options = [...optionList.querySelectorAll('.fp-option-row')]
      .map(row => ({ label: row.querySelector('input').value.trim(), color: row.querySelector('.fp-color-swatch').dataset.color }))
      .filter(o => o.label && !seenLabels.has(o.label) && seenLabels.add(o.label));
    if (OPTION_TYPES.includes(type) && options.length === 0) { alert('Add at least one option.'); return; }

    if (existing) {
      existing.label = label;
      if (OPTION_TYPES.includes(type)) existing.options = options; else delete existing.options;
    } else {
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!key || key === RESERVED_FIELD || doc.meta.field_defs.some(f => f.key === key)) {
        alert('A field with that name already exists (or the name is reserved).');
        return;
      }
      const fd = { key, label, type };
      if (OPTION_TYPES.includes(type)) fd.options = options;
      doc.meta.field_defs.push(fd);
    }
    // Existing issues simply won't have a new key in `fields` until set — every
    // render path already treats a missing key as empty, so no seeding needed
    // (and seeding directly here wouldn't survive the next replay anyway).
    saveLocal();
    closeFieldPopover();
    render();
  });

  if (existing) {
    pop.querySelector('.fp-delete').addEventListener('click', () => {
      if (!confirm(`Delete field "${existing.label}"? Existing values are kept (hidden) in case you re-add it.`)) return;
      doc.meta.field_defs = doc.meta.field_defs.filter(f => f.key !== existing.key);
      saveLocal();
      closeFieldPopover();
      render();
    });
  }

  positionPopover(pop, anchorEl);
  setTimeout(() => document.addEventListener('mousedown', onFieldPopoverOutsideClick), 0);
}

function positionPopover(pop, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 4}px`;
  const maxLeft = window.innerWidth - 288;
  pop.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
}

function onFieldPopoverOutsideClick(e) {
  const pop = document.getElementById('fieldPopover');
  if (pop && !pop.contains(e.target)) closeFieldPopover();
}

function closeFieldPopover() {
  const pop = document.getElementById('fieldPopover');
  if (pop) pop.remove();
  document.removeEventListener('mousedown', onFieldPopoverOutsideClick);
}

// ---------- row context menu (right-click a row -> Delete, GitHub-Projects-style) ----------
// Generic floating action menu — used for both the per-row (Open/Delete) and
// per-column (Sort/Edit/Hide/Move) menus, so there's one popover mechanism,
// not two nearly-identical ones.
function openRowMenu(items, x, y) {
  closeRowMenu();
  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.id = 'rowMenu';
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'row-menu-item' + (item.danger ? ' danger' : '');
    btn.disabled = !!item.disabled;
    const main = document.createElement('span');
    main.className = 'row-menu-item-main';
    if (item.icon) {
      const iconSpan = document.createElement('span');
      iconSpan.className = 'row-menu-item-icon';
      iconSpan.innerHTML = item.icon;
      main.appendChild(iconSpan);
    }
    const labelSpan = document.createElement('span');
    labelSpan.className = 'row-menu-item-label';
    labelSpan.textContent = item.label;
    main.appendChild(labelSpan);
    btn.appendChild(main);
    if (item.marker) {
      const markerSpan = document.createElement('span');
      markerSpan.className = 'row-menu-item-marker';
      markerSpan.textContent = item.marker;
      btn.appendChild(markerSpan);
    }
    btn.addEventListener('click', () => {
      closeRowMenu();
      item.onClick();
    });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  menu.style.top = `${y}px`;
  menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
  setTimeout(() => document.addEventListener('mousedown', onRowMenuOutsideClick), 0);
}

function openIssueRowMenu(issue, x, y) {
  openRowMenu([
    { label: 'Open', onClick: () => openDetailPanel(issue.id) },
    { label: 'Delete', danger: true, onClick: () => deleteIssue(issue.id) },
  ], x, y);
}

function openColumnMenu(fd, anchorEl) {
  const defs = doc.meta.field_defs;
  const idx = defs.findIndex(f => f.key === fd.key);
  const rect = anchorEl.getBoundingClientRect();
  openRowMenu([
    {
      label: 'Sort ascending',
      icon: ICON_SORT_ASC,
      marker: sortState && sortState.key === fd.key && sortState.dir === 'asc' ? '✕' : '',
      onClick: () => { sortState = { key: fd.key, dir: 'asc' }; render(); },
    },
    {
      label: 'Sort descending',
      icon: ICON_SORT_DESC,
      marker: sortState && sortState.key === fd.key && sortState.dir === 'desc' ? '✕' : '',
      onClick: () => { sortState = { key: fd.key, dir: 'desc' }; render(); },
    },
    { label: 'Edit field…', icon: ICON_EDIT_FIELD, onClick: () => openFieldPopover(fd.key, anchorEl) },
    {
      label: 'Hide field',
      icon: ICON_HIDE_FIELD,
      onClick: () => {
        doc.meta.hidden_field_keys.push(fd.key);
        saveLocal();
        render();
      },
    },
    { label: 'Move left', icon: ICON_MOVE_LEFT, disabled: idx <= 0, onClick: () => moveField(fd.key, -1) },
    { label: 'Move right', icon: ICON_MOVE_RIGHT, disabled: idx >= defs.length - 1, onClick: () => moveField(fd.key, 1) },
    { label: 'Move to start', icon: ICON_MOVE_START, disabled: idx <= 0, onClick: () => moveFieldTo(fd.key, 0) },
    { label: 'Move to end', icon: ICON_MOVE_END, disabled: idx >= defs.length - 1, onClick: () => moveFieldTo(fd.key, defs.length - 1) },
  ], rect.left, rect.bottom + 4);
}

function moveField(key, delta) {
  const defs = doc.meta.field_defs;
  const idx = defs.findIndex(f => f.key === key);
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= defs.length) return;
  const [item] = defs.splice(idx, 1);
  defs.splice(newIdx, 0, item);
  saveLocal();
  render();
}

function moveFieldTo(key, targetIdx) {
  const defs = doc.meta.field_defs;
  const idx = defs.findIndex(f => f.key === key);
  const [item] = defs.splice(idx, 1);
  defs.splice(targetIdx, 0, item);
  saveLocal();
  render();
}

function onRowMenuOutsideClick(e) {
  const menu = document.getElementById('rowMenu');
  if (menu && !menu.contains(e.target)) closeRowMenu();
}

function closeRowMenu() {
  const menu = document.getElementById('rowMenu');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', onRowMenuOutsideClick);
}

async function attachGithub(issue, repo, number) {
  issue.source = { system: 'github', repo, number: Number(number), url: `https://github.com/${repo}/issues/${number}`, cached: {}, synced_at: null };
  saveLocal(); // so the binding survives even if the page closes before the fetch below finishes
  render(); // reflect the "Loading…" state immediately, don't wait on the fetch below to repaint
  await refreshFromGithub(issue);
}

function detachSource(issue) {
  issue.source = null;
  saveLocal();
  render();
}

function deleteIssue(issueId) {
  if (!doc) return;
  const issue = issueById(issueId);
  if (!issue) return;
  if (!confirm(`Delete "${displayTitle(issue)}"? This can't be undone.`)) return;

  // Links are a materialized cache derived from link_add/link_remove events —
  // splicing them out of .links directly would just get wiped on next replay,
  // so any issue linking to the one being deleted needs a real link_remove event.
  doc.issues.forEach(other => {
    if (other.id === issueId) return;
    const stale = other.links.filter(l => l.target === issueId);
    stale.forEach(l => appendEventTo(other, { op: 'link_remove', link: { type: l.type, target: l.target } }));
    if (stale.length) replayIssue(other);
  });

  doc.issues = doc.issues.filter(i => i.id !== issueId);
  if (activeIssueId === issueId) activeIssueId = null;
  saveLocal();
  render();
}

async function refreshFromGithub(issue) {
  if (!issue.source || issue.source.system !== 'github') return;
  const { repo, number } = issue.source;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`);
    if (!res.ok) {
      alert(`GitHub fetch failed (${res.status}). Public repos only in this version.`);
      return;
    }
    const data = await res.json();
    issue.source.cached = {
      title: data.title,
      assignee: data.assignee ? data.assignee.login : null,
      state: data.state,
      labels: (data.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
    };
    issue.source.synced_at = new Date().toISOString();
    saveLocal();
    render();
  } catch (e) {
    alert('GitHub fetch failed: ' + e.message);
  }
}

async function doExport(squash) {
  const prev = doc.meta.state_hash;
  const newHash = await computeStateHash(doc);
  if (prev) doc.meta.history_hashes = [...doc.meta.history_hashes, prev];
  doc.meta.state_hash = newHash;
  saveLocal();
  const text = serializeJSONL(doc, { squash });
  const suffix = squash ? '.squashed' : '.full';
  const base = filename.replace(/\.jsonl$/, '');
  download(base + suffix + '.jsonl', text);
  render();
}

// ---------- merge ----------
function diffEventsById(localEvents, incomingEvents) {
  const localIds = new Set(localEvents.map(e => e.id));
  const incomingIds = new Set(incomingEvents.map(e => e.id));
  const shared = localEvents.filter(e => incomingIds.has(e.id));
  const localOnly = localEvents.filter(e => !incomingIds.has(e.id));
  const incomingOnly = incomingEvents.filter(e => !localIds.has(e.id));
  return { shared, localOnly, incomingOnly };
}

function latestFieldTouches(events) {
  const map = {};
  for (const e of events) {
    if (e.op !== 'set_field') continue;
    if (!map[e.field] || e.lamport > map[e.field].lamport) map[e.field] = { value: e.value, lamport: e.lamport };
  }
  return map;
}

function mergeIssue(localIssue, incomingIssue, conflictsOut, localDoc) {
  const { shared, localOnly, incomingOnly } = diffEventsById(localIssue.events, incomingIssue.events);
  const localTouches = latestFieldTouches(localOnly);
  const incomingTouches = latestFieldTouches(incomingOnly);
  const conflictFields = Object.keys(localTouches).filter(k => k in incomingTouches);

  const byId = new Map();
  [...shared, ...localOnly, ...incomingOnly].forEach(e => byId.set(e.id, e));
  const mergedEvents = [...byId.values()];

  const merged = { ...localIssue, events: mergedEvents };
  replayIssue(merged);

  if (conflictFields.length) {
    const baseTouches = latestFieldTouches(shared);
    conflictFields.forEach(field => {
      conflictsOut.push({
        issueId: localIssue.id,
        issueTitle: displayTitle(localIssue),
        field,
        label: fieldLabel(field, localDoc),
        localValue: localTouches[field].value,
        incomingValue: incomingTouches[field].value,
      });
      // Safe default until a human resolves it: roll back to the last value both sides agreed on.
      merged.fields[field] = field in baseTouches ? baseTouches[field].value : merged.fields[field];
    });
  }

  if (localIssue.source && incomingIssue.source) {
    merged.source = (incomingIssue.source.synced_at || '') > (localIssue.source.synced_at || '')
      ? incomingIssue.source
      : localIssue.source;
  } else {
    merged.source = localIssue.source || incomingIssue.source;
  }
  return merged;
}

function mergeDocs(localDoc, incomingDoc) {
  const conflicts = [];
  const localById = Object.fromEntries(localDoc.issues.map(i => [i.id, i]));
  const incomingById = Object.fromEntries(incomingDoc.issues.map(i => [i.id, i]));
  const allIds = new Set([...Object.keys(localById), ...Object.keys(incomingById)]);
  const mergedIssues = [];
  for (const id of allIds) {
    const l = localById[id];
    const r = incomingById[id];
    if (l && r) {
      mergedIssues.push(mergeIssue(l, r, conflicts, localDoc));
    } else {
      const solo = JSON.parse(JSON.stringify(l || r));
      replayIssue(solo);
      mergedIssues.push(solo);
    }
  }
  const fieldDefs = [...localDoc.meta.field_defs];
  const existingKeys = new Set(fieldDefs.map(f => f.key));
  incomingDoc.meta.field_defs.forEach(fd => { if (!existingKeys.has(fd.key)) fieldDefs.push(fd); });
  const linkTypes = Array.from(new Set([...localDoc.meta.link_types, ...incomingDoc.meta.link_types]));
  const mergedMeta = { ...localDoc.meta, field_defs: fieldDefs, link_types: linkTypes };
  return { doc: { meta: mergedMeta, issues: mergedIssues }, conflicts };
}

function conflictKey(c) {
  return c.issueId + '::' + c.field;
}

function openMergeModal(mergeResult) {
  pendingMerge = mergeResult;
  resolutions = {};
  const modal = document.getElementById('conflictModal');
  const list = document.getElementById('conflictList');
  if (mergeResult.conflicts.length === 0) {
    applyMerge();
    return;
  }
  list.innerHTML = '';
  mergeResult.conflicts.forEach(c => {
    const key = conflictKey(c);
    resolutions[key] = { mode: 'local' };
    const div = document.createElement('div');
    div.className = 'conflict-item';
    div.innerHTML = `
      <h4>${escapeHtml(c.issueTitle)} — ${escapeHtml(c.label)}</h4>
      <label class="conflict-option"><input type="radio" name="${key}" value="local" checked> Your value: <strong>${escapeHtml(String(c.localValue))}</strong></label>
      <label class="conflict-option"><input type="radio" name="${key}" value="incoming"> Their value: <strong>${escapeHtml(String(c.incomingValue))}</strong></label>
      <label class="conflict-option"><input type="radio" name="${key}" value="custom"> Custom: <input type="text" data-custom="${key}" placeholder="write a new value"></label>
    `;
    div.querySelectorAll(`input[name="${CSS.escape(key)}"]`).forEach(input => {
      input.addEventListener('change', () => { resolutions[key].mode = input.value; });
    });
    div.querySelector(`input[data-custom="${CSS.escape(key)}"]`).addEventListener('input', e => {
      resolutions[key].custom = e.target.value;
    });
    list.appendChild(div);
  });
  modal.hidden = false;
}

function applyMerge() {
  if (!pendingMerge) return;
  const { doc: mergedDoc, conflicts } = pendingMerge;
  conflicts.forEach(c => {
    const key = conflictKey(c);
    const res = resolutions[key] || { mode: 'local' };
    let value = c.localValue;
    if (res.mode === 'incoming') value = c.incomingValue;
    else if (res.mode === 'custom') value = res.custom;
    const issue = mergedDoc.issues.find(i => i.id === c.issueId);
    appendEventTo(issue, { op: 'set_field', field: c.field, value });
  });
  mergedDoc.issues.forEach(replayIssue);
  doc = mergedDoc;
  pendingMerge = null;
  document.getElementById('conflictModal').hidden = true;
  saveLocal();
  render();
}

function appendEventTo(issue, partial) {
  const evt = {
    id: 'evt-' + crypto.randomUUID(),
    actor: getActor(),
    lamport: nextLamport(issue),
    ts: new Date().toISOString(),
    ...partial,
  };
  issue.events.push(evt);
}

function cancelMerge() {
  pendingMerge = null;
  document.getElementById('conflictModal').hidden = true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isUrl(value) {
  return /^https?:\/\/\S+$/i.test((value || '').trim());
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---------- GitHub link preview (for "reference" fields) ----------
// In-memory only, keyed by URL — not persisted to the file. This is a
// convenience preview, distinct from a real `source` binding: a reference
// field points at *some* related issue, not necessarily this one's source
// of truth, so it deliberately doesn't touch source/events/merge at all.
const githubPreviewCache = new Map();

function parseGithubIssueUrl(url) {
  const m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/i.exec((url || '').trim());
  return m ? { repo: `${m[1]}/${m[2]}`, number: m[3] } : null;
}

function ensureGithubPreview(url) {
  if (githubPreviewCache.has(url)) return;
  const parsed = parseGithubIssueUrl(url);
  if (!parsed) return;
  githubPreviewCache.set(url, { status: 'loading' });
  // Wrapped in Promise.resolve().then(...) so a *synchronous* throw from fetch()
  // itself (malformed URL, CSP, etc.) becomes a rejection caught below, instead
  // of propagating up through render() and breaking the whole table/panel.
  Promise.resolve()
    .then(() => fetch(`https://api.github.com/repos/${parsed.repo}/issues/${parsed.number}`))
    .then(res => {
      if (!res.ok) throw new Error('status ' + res.status);
      return res.json();
    })
    .then(data => {
      githubPreviewCache.set(url, {
        status: 'ok',
        title: data.title,
        state: data.state,
        assignee: data.assignee ? data.assignee.login : null,
        isPr: !!data.pull_request,
      });
      render();
    })
    .catch(() => {
      githubPreviewCache.set(url, { status: 'error' });
      render();
    });
}

function refreshGithubPreview(url) {
  githubPreviewCache.delete(url);
  ensureGithubPreview(url);
}

// ---------- rendering ----------
// Problem/solution is a typed link (`solved_by`) shown as an inline "Linked"
// pill rather than a nested sub-row — every issue gets exactly one row.
function getLinkedPillInfo(issue) {
  const solvedBy = issue.links.find(l => l.type === 'solved_by');
  if (solvedBy) {
    const target = issueById(solvedBy.target);
    if (target) return { role: 'solution', label: `Solution: ${displayTitle(target)}`, targetId: target.id };
  }
  const incoming = doc.issues.find(other => other.id !== issue.id
    && (other.links || []).some(l => l.type === 'solved_by' && l.target === issue.id));
  if (incoming) return { role: 'problem', label: `Problem: ${displayTitle(incoming)}`, targetId: incoming.id };
  return null;
}

function renderLinkedCell(issue) {
  const info = getLinkedPillInfo(issue);
  if (!info) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = '—';
    return span;
  }
  const pill = document.createElement('span');
  pill.className = 'chip linked-pill linked-' + info.role;
  pill.textContent = truncate(info.label, 40);
  pill.title = info.label;
  pill.addEventListener('click', e => {
    e.stopPropagation();
    openDetailPanel(info.targetId);
  });
  return pill;
}

function render() {
  const hasDoc = !!doc;
  document.getElementById('docTitle').textContent = hasDoc ? doc.meta.title : 'No tracker loaded';
  document.getElementById('docMeta').textContent = hasDoc
    ? `${doc.issues.length} issue${doc.issues.length === 1 ? '' : 's'} · format v${doc.meta.format_version} · ${filename}`
    : '';
  document.getElementById('btnMerge').disabled = !hasDoc;
  document.getElementById('btnExport').disabled = !hasDoc;
  document.getElementById('dropHint').hidden = hasDoc;
  document.getElementById('actorInput').value = getActor();

  renderTableHead();
  renderTableBody();
  renderDetailPanel();
}

function makeSortableHeader(label, sortKey) {
  const th = document.createElement('th');
  th.className = 'sortable-th';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'th-label';
  labelSpan.textContent = label;
  th.appendChild(labelSpan);
  const isActive = sortState && sortState.key === sortKey;
  const descActive = isActive && sortState.dir === 'desc';
  const arrowBtn = document.createElement('span');
  arrowBtn.className = 'sort-arrow-btn' + (isActive ? ' active' : '');
  arrowBtn.title = 'Sort';
  arrowBtn.dataset.dir = descActive ? 'desc' : 'asc'; // test hook — real signal is the icon swap below
  arrowBtn.innerHTML = descActive ? ICON_SORT_DESC : ICON_SORT_ASC;
  th.appendChild(arrowBtn);
  th.addEventListener('click', e => {
    if (e.target.closest('.th-edit-icon')) return; // editing is a separate affordance, don't also sort
    toggleSort(sortKey);
  });
  return th;
}

function wireColumnDrag(th, fieldKey) {
  th.draggable = true;
  th.addEventListener('dragstart', e => { draggedFieldKey = fieldKey; e.stopPropagation(); });
  th.addEventListener('dragover', e => {
    if (draggedFieldKey && draggedFieldKey !== fieldKey) {
      e.preventDefault();
      e.stopPropagation();
      th.classList.add('drag-over');
    }
  });
  th.addEventListener('dragleave', () => th.classList.remove('drag-over'));
  th.addEventListener('drop', e => {
    e.preventDefault();
    // This is a column-reorder drop, not a file drop — don't let it also
    // reach document.body's "drop a file anywhere to open it" handler.
    e.stopPropagation();
    th.classList.remove('drag-over');
    if (!draggedFieldKey || draggedFieldKey === fieldKey) return;
    const defs = doc.meta.field_defs;
    const fromIdx = defs.findIndex(f => f.key === draggedFieldKey);
    if (fromIdx === -1) return;
    const [moved] = defs.splice(fromIdx, 1);
    // Recompute the target index AFTER removal — indices shift once the
    // dragged item is spliced out, so finding it beforehand would insert
    // one slot too late whenever dragging forward in the list.
    const toIdx = defs.findIndex(f => f.key === fieldKey);
    defs.splice(toIdx === -1 ? defs.length : toIdx, 0, moved);
    saveLocal();
    render();
  });
  th.addEventListener('dragend', () => { draggedFieldKey = null; });
}

function renderTableHead() {
  const tr = document.getElementById('tableHead');
  tr.innerHTML = '';

  const numTh = document.createElement('th');
  numTh.className = 'th-rownum';
  tr.appendChild(numTh);

  const titleTh = makeSortableHeader('Title', 'title');
  titleTh.classList.add('th-title');
  tr.appendChild(titleTh);

  const sourceTh = makeSortableHeader('Source', 'source');
  sourceTh.classList.add('th-source');
  tr.appendChild(sourceTh);

  const linkedTh = makeSortableHeader('Linked', 'linked');
  linkedTh.classList.add('th-linked');
  tr.appendChild(linkedTh);

  if (doc) {
    visibleFieldDefs().forEach(fd => {
      const th = makeSortableHeader(fd.label, fd.key);
      th.classList.add('th-field');
      const menuIcon = document.createElement('span');
      menuIcon.className = 'th-edit-icon';
      menuIcon.textContent = '⋯';
      menuIcon.title = 'Column actions';
      menuIcon.addEventListener('click', e => { e.stopPropagation(); openColumnMenu(fd, th); });
      th.appendChild(menuIcon);
      wireColumnDrag(th, fd.key);
      tr.appendChild(th);
    });
  }
  const addTh = document.createElement('th');
  addTh.className = 'th-add-field';
  addTh.textContent = '+';
  addTh.title = 'Add field';
  addTh.addEventListener('click', () => openFieldPopover(null, addTh));
  tr.appendChild(addTh);
}

function toggleSort(key) {
  sortState = sortState && sortState.key === key
    ? { key, dir: sortState.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' };
  render();
}

function sortValue(issue, key) {
  if (key === 'title') return displayTitle(issue);
  if (key === 'source') return sourceBadge(issue);
  if (key === 'linked') {
    const info = getLinkedPillInfo(issue);
    return info ? info.label : undefined; // undefined -> sorts unlinked-last, matches spec
  }
  const fd = fieldDef(key);
  const v = issue.fields[key];
  if (fd && fd.type === 'multiselect') return (v || []).join(', ');
  return v;
}

function sortRows(rows, { key, dir }) {
  const withValue = [];
  const empty = [];
  rows.forEach(g => {
    const v = sortValue(g.issue, key);
    (v === undefined || v === null || v === '' ? empty : withValue).push(g);
  });
  withValue.sort((a, b) => {
    const av = String(sortValue(a.issue, key)).toLowerCase();
    const bv = String(sortValue(b.issue, key)).toLowerCase();
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
  // Blank values sort last regardless of direction — matches spreadsheet convention.
  return [...withValue, ...empty];
}

function renderTableBody() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  if (!doc) return;
  const q = filterQuery.trim().toLowerCase();
  let rows = doc.issues
    .filter(issue => !q || displayTitle(issue).toLowerCase().includes(q))
    .map(issue => ({ issue }));
  if (sortState) rows = sortRows(rows, sortState);
  rows.forEach(({ issue }, index) => {
    tbody.appendChild(renderRow(issue, { number: index + 1 }));
  });
}

function renderRow(issue, { number = null } = {}) {
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  if (issue.id === activeIssueId) tr.classList.add('active');

  // Dedicated row-number/chevron column, separate from Title (per design spec).
  // Flex layout lives on the inner wrapper, not the <td> itself — see the
  // matching note on title-cell-inner below for why.
  const numTd = document.createElement('td');
  numTd.className = 'rownum-cell';
  const numInner = document.createElement('div');
  numInner.className = 'rownum-cell-inner';
  numTd.appendChild(numInner);
  const menuTrigger = document.createElement('span');
  menuTrigger.className = 'row-menu-trigger';
  menuTrigger.textContent = '▼';
  menuTrigger.title = 'Row actions';
  menuTrigger.addEventListener('click', e => {
    e.stopPropagation();
    const rect = menuTrigger.getBoundingClientRect();
    openIssueRowMenu(issue, rect.left, rect.bottom + 4);
  });
  numInner.appendChild(menuTrigger);
  if (number !== null) {
    const numberSpan = document.createElement('span');
    numberSpan.className = 'row-number';
    numberSpan.textContent = String(number);
    numInner.appendChild(numberSpan);
  }
  tr.appendChild(numTd);

  const titleTd = document.createElement('td');
  titleTd.className = 'title-cell';
  // The flex layout lives on this inner wrapper, not the <td> itself — a <td>
  // needs to stay in table-cell display to correctly share row height/border
  // position with its sibling cells; forcing display:flex directly on it broke that.
  const titleInner = document.createElement('div');
  titleInner.className = 'title-cell-inner';
  titleTd.appendChild(titleInner);

  if (!issue.source) {
    titleInner.appendChild(makeClickToEditCell(issue, {
      renderDisplay: () => {
        const span = document.createElement('span');
        span.className = 'title-text';
        span.textContent = displayTitle(issue);
        return span;
      },
      getValue: () => issue.fields[RESERVED_FIELD] || '',
      onCommit: newValue => {
        const ghParsed = parseGithubIssueUrl(newValue);
        if (ghParsed) attachGithub(issue, ghParsed.repo, ghParsed.number);
        else appendEvent(issue, { op: 'set_field', field: RESERVED_FIELD, value: newValue });
      },
    }));
  } else {
    const titleSpan = document.createElement('span');
    titleSpan.className = 'title-text';
    titleSpan.textContent = displayTitle(issue);
    titleInner.appendChild(titleSpan);
  }
  tr.appendChild(titleTd);

  const sourceTd = document.createElement('td');
  const sourceBadgeSpan = document.createElement('span');
  sourceBadgeSpan.className = 'badge clickable';
  sourceBadgeSpan.textContent = sourceBadge(issue);
  sourceBadgeSpan.title = 'Open full detail';
  sourceBadgeSpan.addEventListener('click', () => openDetailPanel(issue.id));
  sourceTd.appendChild(sourceBadgeSpan);
  tr.appendChild(sourceTd);

  const linkedTd = document.createElement('td');
  linkedTd.appendChild(renderLinkedCell(issue));
  tr.appendChild(linkedTd);

  visibleFieldDefs().forEach(fd => {
    const td = document.createElement('td');
    td.appendChild(renderFieldCellEditable(issue, fd));
    tr.appendChild(td);
  });

  // Matches the header's trailing "+" add-field column — without this, every
  // body row has one fewer cell than the header, and the columns misalign.
  tr.appendChild(document.createElement('td'));

  return tr;
}

function renderFieldCellEditable(issue, fd) {
  const value = issue.fields[fd.key];
  if (fd.type === 'enum') return makeEnumCell(issue, fd);
  if (fd.type === 'multiselect') return makeMultiselectCell(issue, fd);
  // text — auto-detects & "referencifies" its own content at display time (URL /
  // GitHub owner/repo#N shorthand / Jira-style key); the stored value is always
  // plain text, there's no separate "reference" field type anymore.
  return makeClickToEditCell(issue, {
    renderDisplay: () => renderTextDisplay(value),
    getValue: () => value || '',
    onCommit: newValue => appendEvent(issue, { op: 'set_field', field: fd.key, value: newValue }),
  });
}

// Recognizes the auto-detect patterns from the design spec. Returns null for
// plain (non-referenceable) text. `gh` is set only when the value resolves to
// a real GitHub issue/PR (full URL or `owner/repo#N` shorthand) — that's the
// one case we go further than the spec and live-fetch a real title/state for.
function detectReference(value) {
  const v = (value || '').trim();
  if (!v) return null;
  if (isUrl(v)) {
    const gh = parseGithubIssueUrl(v);
    const href = gh ? `https://github.com/${gh.repo}/issues/${gh.number}` : v;
    return { kind: 'url', href, gh, fallbackLabel: truncate(v.replace(/^https?:\/\//i, ''), 40) };
  }
  const shortMatch = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(v);
  if (shortMatch) {
    const gh = { repo: shortMatch[1], number: shortMatch[2] };
    return { kind: 'github-shorthand', href: `https://github.com/${gh.repo}/issues/${gh.number}`, gh, fallbackLabel: v };
  }
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(v)) {
    return { kind: 'jira', href: null, gh: null, fallbackLabel: v };
  }
  return null;
}

function renderTextDisplay(value) {
  const v = (value || '').trim();
  if (!v) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = '—';
    return span;
  }
  const detected = detectReference(v);
  if (!detected) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = truncate(v, 60);
    return span;
  }
  if (detected.kind === 'jira') {
    const chip = document.createElement('span');
    chip.className = 'chip ref-chip';
    chip.textContent = truncate(v, 40);
    return chip;
  }
  return renderReferenceChip(detected);
}

function renderReferenceChip({ href, fallbackLabel, gh }) {
  const wrap = document.createElement('span');
  wrap.className = 'ref-cell';

  let label = fallbackLabel;
  let preview = null;
  if (gh) {
    ensureGithubPreview(href);
    preview = githubPreviewCache.get(href);
    if (preview && preview.status === 'ok') label = truncate(preview.title, 40);
  }

  const chip = document.createElement('span');
  chip.className = 'chip ref-chip';
  chip.textContent = label;
  chip.title = fallbackLabel;
  wrap.appendChild(chip);

  if (preview && preview.status === 'ok') {
    const stateBadge = document.createElement('span');
    stateBadge.className = 'chip gh-state-' + preview.state;
    stateBadge.textContent = (preview.isPr ? 'PR ' : '') + preview.state;
    wrap.appendChild(stateBadge);
  }

  // A real <a> so makeClickToEditCell's `e.target.closest('a')` check exempts
  // just this icon from re-entering edit mode — clicking the chip itself edits,
  // per spec; only this dedicated icon navigates.
  const openIcon = document.createElement('a');
  openIcon.className = 'ref-open-icon';
  openIcon.href = href;
  openIcon.target = '_blank';
  openIcon.rel = 'noopener noreferrer';
  openIcon.title = 'Open ' + href;
  openIcon.textContent = '↗';
  wrap.appendChild(openIcon);

  return wrap;
}

// A cell that shows a rendered value by default; clicking anywhere in it
// (except an inner <a>, which should still navigate normally) swaps in a
// focused text input, committing the change on blur/Enter, reverting on Escape.
function makeClickToEditCell(issue, { renderDisplay, getValue, onCommit }) {
  const container = document.createElement('div');
  container.className = 'cell-click-edit';

  function showDisplay() {
    container.innerHTML = '';
    container.appendChild(renderDisplay());
  }

  function showEditor() {
    container.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-input';
    input.value = getValue();
    container.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    function commit() {
      if (settled) return;
      settled = true;
      const newValue = input.value;
      if (newValue !== getValue()) onCommit(newValue); // triggers render(), which rebuilds this cell fresh
      else showDisplay(); // unchanged — nothing will re-render this cell, so revert manually
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { settled = true; showDisplay(); }
    });
  }

  container.addEventListener('click', e => {
    if (e.target.closest('a')) return; // let links navigate, don't enter edit mode
    if (container.querySelector('input')) return; // already editing
    showEditor();
  });

  showDisplay();
  return container;
}

// Shared list UI for both single- and multi-select popovers: a title, a live
// filter input, and a scrollable list of rows (colored dot + label + checkmark
// when selected). Differs only in isSelected/onPick/whether a clear row shows.
function buildOptionSearchList({ options, isSelected, onPick, title, allowClear }) {
  const wrap = document.createElement('div');
  wrap.className = 'select-popover';

  const heading = document.createElement('div');
  heading.className = 'select-popover-title';
  heading.textContent = title;
  wrap.appendChild(heading);

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'select-popover-search';
  search.placeholder = 'Filter…';
  wrap.appendChild(search);

  const list = document.createElement('div');
  list.className = 'select-popover-list';
  wrap.appendChild(list);

  function buildRow(label, color, selected) {
    const row = document.createElement('div');
    row.className = 'select-popover-row' + (selected ? ' selected' : '');
    const check = document.createElement('span');
    check.className = 'select-popover-check';
    check.textContent = selected ? '✓' : '';
    row.appendChild(check);
    if (color) row.appendChild(makeColorDot(color));
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    row.appendChild(labelSpan);
    return row;
  }

  function renderList() {
    list.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    if (allowClear && (!q || '—'.includes(q))) {
      const row = buildRow('—', null, isSelected(null));
      row.addEventListener('click', () => onPick(null));
      list.appendChild(row);
    }
    options.filter(o => !q || o.label.toLowerCase().includes(q)).forEach(o => {
      const row = buildRow(o.label, o.color, isSelected(o.label));
      row.addEventListener('click', () => onPick(o.label));
      list.appendChild(row);
    });
  }

  search.addEventListener('input', renderList);
  renderList();
  setTimeout(() => search.focus(), 0);
  return { el: wrap, refresh: renderList };
}

function makeColorDot(color) {
  const dot = document.createElement('span');
  dot.className = 'opt-dot opt-color-' + (color || 'gray');
  return dot;
}

function makeEnumCell(issue, fd) {
  const value = issue.fields[fd.key];
  const opt = value ? fd.options.find(o => o.label === value) : null;
  const wrap = document.createElement('div');
  wrap.className = 'cell-enum';

  const pill = document.createElement('span');
  pill.className = 'chip enum-pill' + (opt ? ' opt-color-' + (opt.color || 'gray') : '') + (value ? '' : ' empty');
  pill.textContent = value || '—';
  wrap.appendChild(pill);

  const arrow = document.createElement('span');
  arrow.className = 'select-arrow';
  wrap.appendChild(arrow);

  wrap.addEventListener('click', e => {
    e.stopPropagation();
    openEnumCellPopover(issue, fd, wrap);
  });
  return wrap;
}

function openEnumCellPopover(issue, fd, anchorEl) {
  closeCellPopover();
  const pop = document.createElement('div');
  pop.className = 'field-popover';
  pop.id = 'cellPopover';
  const current = issue.fields[fd.key] || '';

  const { el } = buildOptionSearchList({
    options: fd.options,
    isSelected: label => (label === null ? !current : label === current),
    onPick: label => {
      closeCellPopover();
      appendEvent(issue, { op: 'set_field', field: fd.key, value: label || '' });
    },
    title: 'Select an item',
    allowClear: true,
  });
  pop.appendChild(el);

  document.body.appendChild(pop);
  positionPopover(pop, anchorEl);
  setTimeout(() => document.addEventListener('mousedown', onCellPopoverOutsideClick), 0);
}

function makeMultiselectCell(issue, fd) {
  const wrap = document.createElement('div');
  wrap.className = 'cell-multiselect';

  const chipsWrap = document.createElement('span');
  chipsWrap.className = 'tag-row';
  (issue.fields[fd.key] || []).forEach(v => {
    const opt = fd.options.find(o => o.label === v);
    const chip = document.createElement('span');
    chip.className = 'chip' + (opt ? ' opt-color-' + (opt.color || 'gray') : '');
    chip.textContent = v;
    chipsWrap.appendChild(chip);
  });
  wrap.appendChild(chipsWrap);

  const arrow = document.createElement('span');
  arrow.className = 'select-arrow';
  wrap.appendChild(arrow);

  wrap.addEventListener('click', e => {
    e.stopPropagation();
    openMultiselectCellPopover(issue, fd, wrap);
  });
  return wrap;
}

function openMultiselectCellPopover(issue, fd, anchorEl) {
  closeCellPopover();
  const pop = document.createElement('div');
  pop.className = 'field-popover';
  pop.id = 'cellPopover';
  const currentSet = () => new Set(issue.fields[fd.key] || []);

  const { el, refresh } = buildOptionSearchList({
    options: fd.options,
    isSelected: label => currentSet().has(label),
    onPick: label => {
      const next = currentSet();
      if (next.has(label)) next.delete(label); else next.add(label);
      appendEvent(issue, { op: 'set_field', field: fd.key, value: [...next] });
      refresh(); // stays open — multi-select toggles, doesn't close on pick
    },
    title: 'Select items',
    allowClear: false,
  });
  pop.appendChild(el);

  document.body.appendChild(pop);
  positionPopover(pop, anchorEl);
  setTimeout(() => document.addEventListener('mousedown', onCellPopoverOutsideClick), 0);
}

function onCellPopoverOutsideClick(e) {
  const pop = document.getElementById('cellPopover');
  if (pop && !pop.contains(e.target)) closeCellPopover();
}

function closeCellPopover() {
  const pop = document.getElementById('cellPopover');
  if (pop) pop.remove();
  document.removeEventListener('mousedown', onCellPopoverOutsideClick);
}

function openDetailPanel(issueId) {
  activeIssueId = issueId;
  render();
}

function closeDetailPanel() {
  activeIssueId = null;
  render();
}

function renderDetailPanel() {
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('panelOverlay');
  const issue = activeIssueId && doc ? issueById(activeIssueId) : null;
  if (!issue) {
    panel.hidden = true;
    overlay.hidden = true;
    return;
  }
  panel.hidden = false;
  overlay.hidden = false;
  document.getElementById('panelTitle').textContent = displayTitle(issue);
  const body = document.getElementById('panelBody');
  body.innerHTML = '';
  body.appendChild(renderFieldsSection(issue));
  body.appendChild(renderSourceSection(issue));
  body.appendChild(renderLinksSection(issue));
  body.appendChild(renderCommentsSection(issue));
  body.appendChild(renderEventLogSection(issue));
}

function renderFieldsSection(issue) {
  const section = document.createElement('div');
  section.className = 'detail-section';
  section.innerHTML = '<h4>Fields</h4>';

  if (!issue.source) {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<label>Title</label><input type="text" value="${escapeHtml(issue.fields[RESERVED_FIELD] || '')}" placeholder="Or paste a GitHub issue/PR URL">`;
    row.querySelector('input').addEventListener('change', e => {
      const ghParsed = parseGithubIssueUrl(e.target.value);
      if (ghParsed) attachGithub(issue, ghParsed.repo, ghParsed.number);
      else appendEvent(issue, { op: 'set_field', field: RESERVED_FIELD, value: e.target.value });
    });
    section.appendChild(row);
  }

  doc.meta.field_defs.forEach(fd => {
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = fd.label;
    row.appendChild(label);

    if (fd.type === 'enum') {
      const select = document.createElement('select');
      select.innerHTML = '<option value="">—</option>' + fd.options.map(o => `<option value="${escapeHtml(o.label)}">${escapeHtml(o.label)}</option>`).join('');
      select.value = issue.fields[fd.key] || '';
      select.addEventListener('change', () => appendEvent(issue, { op: 'set_field', field: fd.key, value: select.value }));
      row.appendChild(select);
    } else if (fd.type === 'multiselect') {
      const group = document.createElement('div');
      group.className = 'checkbox-group';
      const current = new Set(issue.fields[fd.key] || []);
      fd.options.forEach(o => {
        const id = `${issue.id}-${fd.key}-${o.label}`;
        const wrap = document.createElement('label');
        wrap.appendChild(makeColorDot(o.color));
        wrap.insertAdjacentHTML('beforeend', ` <input type="checkbox" id="${id}" ${current.has(o.label) ? 'checked' : ''}> ${escapeHtml(o.label)}`);
        wrap.querySelector('input').addEventListener('change', e => {
          const next = new Set(issue.fields[fd.key] || []);
          if (e.target.checked) next.add(o.label); else next.delete(o.label);
          appendEvent(issue, { op: 'set_field', field: fd.key, value: [...next] });
        });
        group.appendChild(wrap);
      });
      row.appendChild(group);
    } else {
      // text — same auto-detect (URL / GitHub shorthand / Jira key) as the table
      // cell, but kept as a full textarea here since the panel has room for
      // genuinely long notes; the detected reference just gets an "Open" link
      // alongside it rather than replacing the editor with a single-line input.
      const textarea = document.createElement('textarea');
      textarea.value = issue.fields[fd.key] || '';
      textarea.addEventListener('change', () => appendEvent(issue, { op: 'set_field', field: fd.key, value: textarea.value }));
      row.appendChild(textarea);
      const detected = detectReference(issue.fields[fd.key]);
      if (detected && detected.href) {
        const open = document.createElement('a');
        open.className = 'ref-link';
        open.href = detected.href;
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.textContent = 'Open ↗';
        row.appendChild(open);
      }
    }
    section.appendChild(row);

    if (fd.type === 'text') {
      const detected = detectReference(issue.fields[fd.key]);
      if (detected && detected.gh) {
        ensureGithubPreview(detected.href);
        section.appendChild(renderGithubPreviewBox(detected.href));
      }
    }
  });
  return section;
}

function renderGithubPreviewBox(url) {
  const box = document.createElement('div');
  box.className = 'source-box gh-preview';
  const preview = githubPreviewCache.get(url);
  if (!preview || preview.status === 'loading') {
    box.textContent = 'Loading details from GitHub…';
    return box;
  }
  if (preview.status === 'error') {
    box.innerHTML = '<span class="muted">Couldn’t load details from GitHub (private repo, rate-limited, or offline).</span>';
  } else {
    box.innerHTML = `
      <div><strong>${escapeHtml(preview.title)}</strong></div>
      <div>${preview.isPr ? 'Pull request' : 'Issue'} ·
        <span class="chip gh-state-${escapeHtml(preview.state)}">${escapeHtml(preview.state)}</span>
        ${preview.assignee ? ' · Assignee: ' + escapeHtml(preview.assignee) : ''}
      </div>
    `;
  }
  const refresh = document.createElement('button');
  refresh.textContent = 'Refresh';
  refresh.addEventListener('click', () => refreshGithubPreview(url));
  box.appendChild(refresh);
  return box;
}

function renderSourceSection(issue) {
  const section = document.createElement('div');
  section.className = 'detail-section';
  section.innerHTML = '<h4>Source</h4>';

  if (issue.source) {
    const box = document.createElement('div');
    box.className = 'source-box';
    const c = issue.source.cached || {};
    box.innerHTML = `
      <div><code>${escapeHtml(issue.source.system)}</code> ${escapeHtml(issue.source.repo || issue.source.key || '')}${issue.source.number ? ' #' + issue.source.number : ''}</div>
      <div>Assignee: ${escapeHtml(c.assignee || 'none')} · State: ${escapeHtml(c.state || 'unknown')}</div>
      <div class="muted">Last synced: ${issue.source.synced_at ? new Date(issue.source.synced_at).toLocaleString() : 'never'}</div>
    `;
    section.appendChild(box);
    const actions = document.createElement('div');
    actions.style.marginTop = '0.4rem';
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    if (issue.source.system === 'github') {
      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = 'Refresh from GitHub';
      refreshBtn.addEventListener('click', () => refreshFromGithub(issue));
      actions.appendChild(refreshBtn);
    }
    const detachBtn = document.createElement('button');
    detachBtn.textContent = 'Detach';
    detachBtn.addEventListener('click', () => detachSource(issue));
    actions.appendChild(detachBtn);
    section.appendChild(actions);
  } else {
    const form = document.createElement('div');
    form.className = 'attach-form';
    form.innerHTML = `
      <input type="text" placeholder="owner/repo" data-role="repo" size="16">
      <input type="text" placeholder="issue #" data-role="number" size="6">
      <button>Attach GitHub issue</button>
    `;
    form.querySelector('button').addEventListener('click', () => {
      const repo = form.querySelector('[data-role=repo]').value.trim();
      const number = form.querySelector('[data-role=number]').value.trim();
      if (repo && number) attachGithub(issue, repo, number);
    });
    section.appendChild(form);
  }
  return section;
}

function renderLinksSection(issue) {
  const section = document.createElement('div');
  section.className = 'detail-section';
  section.innerHTML = '<h4>Links</h4>';

  issue.links.forEach(link => {
    const target = issueById(link.target);
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `<span>${escapeHtml(link.type)}${link.status ? ` (${escapeHtml(link.status)})` : ''} → ${escapeHtml(target ? displayTitle(target) : link.target)}</span> <span class="remove">remove</span>`;
    row.querySelector('.remove').addEventListener('click', () => appendEvent(issue, { op: 'link_remove', link: { type: link.type, target: link.target } }));
    section.appendChild(row);
  });

  const others = doc.issues.filter(i => i.id !== issue.id);
  if (others.length) {
    const form = document.createElement('div');
    form.className = 'add-link';
    form.innerHTML = `
      <select data-role="type">${doc.meta.link_types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select>
      <select data-role="target">${others.map(i => `<option value="${i.id}">${escapeHtml(displayTitle(i))}</option>`).join('')}</select>
      <input type="text" data-role="status" placeholder="status (optional)" size="10">
      <button>Add link</button>
    `;
    form.querySelector('button').addEventListener('click', () => {
      const type = form.querySelector('[data-role=type]').value;
      const target = form.querySelector('[data-role=target]').value;
      const status = form.querySelector('[data-role=status]').value.trim();
      appendEvent(issue, { op: 'link_add', link: { type, target, ...(status ? { status } : {}) } });
    });
    section.appendChild(form);
  }
  return section;
}

function renderCommentsSection(issue) {
  const section = document.createElement('div');
  section.className = 'detail-section';
  section.innerHTML = '<h4>Comments</h4>';

  issue.events.filter(e => e.op === 'comment').sort((a, b) => a.lamport - b.lamport).forEach(e => {
    const div = document.createElement('div');
    div.className = 'comment';
    div.innerHTML = `<div class="meta">${escapeHtml(e.actor)} · ${new Date(e.ts).toLocaleString()}</div><div>${escapeHtml(e.body)}</div>`;
    section.appendChild(div);
  });

  const addForm = document.createElement('div');
  addForm.className = 'add-comment';
  addForm.innerHTML = `<textarea placeholder="Add a comment&hellip;"></textarea><button>Add</button>`;
  addForm.querySelector('button').addEventListener('click', () => {
    const textarea = addForm.querySelector('textarea');
    if (textarea.value.trim()) {
      appendEvent(issue, { op: 'comment', body: textarea.value.trim() });
    }
  });
  section.appendChild(addForm);
  return section;
}

function renderEventLogSection(issue) {
  const section = document.createElement('div');
  section.className = 'detail-section';
  const details = document.createElement('details');
  details.innerHTML = '<summary style="cursor:pointer;color:var(--muted);font-size:0.8rem;">Raw event log</summary>';
  const log = document.createElement('div');
  log.className = 'event-log';
  [...issue.events].sort((a, b) => a.lamport - b.lamport).forEach(e => {
    const div = document.createElement('div');
    div.textContent = JSON.stringify(e);
    log.appendChild(div);
  });
  details.appendChild(log);
  section.appendChild(details);
  return section;
}

// ---------- wiring ----------
function handleOpenFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      doc = parseJSONL(reader.result);
      filename = file.name;
      activeIssueId = null;
      sortState = null;
      filterQuery = '';
      document.getElementById('filterInput').value = '';
      saveLocal();
      render();
    } catch (e) {
      alert('Could not parse file: ' + e.message);
    }
  };
  reader.readAsText(file);
}

function handleMergeFile(file) {
  if (!doc) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = parseJSONL(reader.result);
      const result = mergeDocs(doc, incoming);
      openMergeModal(result);
    } catch (e) {
      alert('Could not parse incoming file: ' + e.message);
    }
  };
  reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!loadLocal()) {
    render();
  } else {
    render();
  }

  document.getElementById('actorInput').addEventListener('change', e => setActor(e.target.value));

  document.getElementById('btnNew').addEventListener('click', () => {
    const title = prompt('Tracker title:', 'New tracker');
    if (title !== null) createTracker(title);
  });

  document.getElementById('btnOpen').addEventListener('click', () => document.getElementById('fileOpen').click());
  document.getElementById('fileOpen').addEventListener('change', e => {
    if (e.target.files[0]) handleOpenFile(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('btnMerge').addEventListener('click', () => document.getElementById('fileMerge').click());
  document.getElementById('fileMerge').addEventListener('change', e => {
    if (e.target.files[0]) handleMergeFile(e.target.files[0]);
    e.target.value = '';
  });

  const exportMenu = document.getElementById('exportMenu');
  document.getElementById('btnExport').addEventListener('click', () => exportMenu.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown')) exportMenu.classList.remove('open');
  });
  document.getElementById('btnExportFull').addEventListener('click', () => { exportMenu.classList.remove('open'); doExport(false); });
  document.getElementById('btnExportSquashed').addEventListener('click', () => { exportMenu.classList.remove('open'); doExport(true); });

  document.getElementById('addItemInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addItemFromInput(e.target);
  });
  document.getElementById('filterInput').addEventListener('input', e => {
    filterQuery = e.target.value;
    renderTableBody(); // filtering doesn't change header/panel/toolbar, just the row list
  });
  document.getElementById('btnClosePanel').addEventListener('click', closeDetailPanel);
  document.getElementById('btnDeleteIssue').addEventListener('click', () => {
    if (activeIssueId) deleteIssue(activeIssueId);
  });
  document.getElementById('panelOverlay').addEventListener('click', closeDetailPanel);
  document.getElementById('btnApplyMerge').addEventListener('click', applyMerge);
  document.getElementById('btnCancelMerge').addEventListener('click', cancelMerge);

  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleOpenFile(file);
  });
});
