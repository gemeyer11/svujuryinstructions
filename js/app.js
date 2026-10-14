/* Jury Instruction Builder - main UI logic. Runs entirely in the browser. */
(function () {
  'use strict';

  const P = window.InfoParser;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const LS_SETTINGS = 'jib.settings.v1';
  const LS_LIBRARY = 'jib.library.v1';
  const CATEGORIES = ['standard', 'elements', 'optional'];

  const DEFAULT_SETTINGS = {
    court: 'IN THE SIXTH JUDICIAL CIRCUIT COURT FOR THE COUNTY OF OAKLAND',
    pa: '',
    office: "Oakland County Prosecutor's Office",
    apa: '',
    apaP: '',
    address: '1200 North Telegraph Road\nPontiac, MI 48341',
    contact: '',
    defense: '',
    intro: 'The People of the State of Michigan, by {{APA}}, Assistant Prosecuting Attorney, request under MCR 2.512 that the Court instruct the jury as set forth below.',
    closing: 'The People reserve the right to withdraw, modify, or supplement these requests based on the evidence admitted at trial and the rulings of the Court.',
    spacing: '1.5',
    newPage: false,
    given: false,
    countLabel: true,
  };

  let library = null; // { meta, instructions, source, loadedAt }
  const state = {
    caseInfo: { defendant: '', caseNumber: '', judge: '' },
    counts: [], // { id, number, description, mcl (string), date, complainant }
    items: [], // compiled instructions, in order
    compiled: false,
    step: 1,
  };
  let settings = loadSettings();
  let uidSeq = 1;
  const uid = () => 'i' + Date.now().toString(36) + (uidSeq++);

  // ---------------------------------------------------------------- utils

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function numKey(n) {
    // "20.28a" -> [20, 28, "a"] for natural sorting; "TBD" sorts last.
    const m = /^(\d+)(?:\.(\d+))?([a-z]*)/i.exec(String(n || ''));
    return m ? [parseInt(m[1], 10), parseInt(m[2] || '0', 10), (m[3] || '').toLowerCase()] : [9999, 0, ''];
  }
  function cmpNum(a, b) {
    const x = numKey(a), y = numKey(b);
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s\-'.(])([a-z])/g, (m, p, c) => p + c.toUpperCase())
      .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase())
      .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function safeFileName(s) {
    return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- settings

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      return Object.assign({}, DEFAULT_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
  }

  const SETTING_FIELDS = {
    's-court': 'court', 's-pa': 'pa', 's-office': 'office', 's-apa': 'apa', 's-apa-p': 'apaP',
    's-address': 'address', 's-contact': 'contact', 's-defense': 'defense', 's-intro': 'intro',
    's-closing': 'closing', 's-spacing': 'spacing',
  };
  const SETTING_CHECKS = { 's-newpage': 'newPage', 's-given': 'given', 's-count-label': 'countLabel' };

  function bindSettings() {
    for (const [id, key] of Object.entries(SETTING_FIELDS)) {
      const el = document.getElementById(id);
      el.value = settings[key] || '';
      el.addEventListener('input', () => { settings[key] = el.value; saveSettings(); renderExport(); });
    }
    for (const [id, key] of Object.entries(SETTING_CHECKS)) {
      const el = document.getElementById(id);
      el.checked = !!settings[key];
      el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); });
    }
    const d = $('#s-date');
    const now = new Date();
    d.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------- library

  function validateLibrary(data) {
    const errors = [];
    const list = Array.isArray(data) ? data : data && data.instructions;
    if (!Array.isArray(list)) return { errors: ['The file has no "instructions" list.'], instructions: [] };
    const ids = new Set();
    const out = [];
    list.forEach((e, i) => {
      const where = `Entry ${i + 1}${e && e.id ? ' (' + e.id + ')' : ''}`;
      if (!e || typeof e !== 'object') { errors.push(where + ' is not an object.'); return; }
      if (!e.id) { errors.push(where + ' has no id.'); return; }
      if (ids.has(e.id)) errors.push(where + ': duplicate id.');
      ids.add(e.id);
      if (!CATEGORIES.includes(e.category)) errors.push(where + ': category must be standard, elements, or optional.');
      if (typeof e.text !== 'string') errors.push(where + ': text must be a string.');
      if (e.category === 'elements' && (!Array.isArray(e.mcl) || !e.mcl.length)) errors.push(where + ': elements instructions need at least one MCL section.');
      out.push({
        id: String(e.id),
        number: String(e.number == null ? 'TBD' : e.number),
        title: String(e.title || ''),
        category: e.category,
        group: e.group || (e.category === 'optional' ? 'Other' : ''),
        position: e.position === 'end' ? 'end' : 'beginning',
        order: e.order != null && e.order !== '' && Number.isFinite(Number(e.order)) ? Number(e.order) : null,
        mcl: Array.isArray(e.mcl) ? e.mcl.map(String) : [],
        text: Array.isArray(e.text) ? e.text.join('\n') : String(e.text || ''),
        lastAmended: e.lastAmended || '',
        ifApplicable: !!e.ifApplicable,
      });
    });
    return { errors, instructions: out, meta: (data && data.meta) || {} };
  }

  function setLibrary(data, source) {
    const v = validateLibrary(data);
    if (!v.instructions.length) throw new Error(v.errors[0] || 'No instructions found.');
    library = { meta: v.meta, instructions: v.instructions, errors: v.errors, source, loadedAt: new Date().toISOString() };
    renderLibraryBanner();
    if (state.step === 2) renderInstructions();
  }

  async function loadLibrary() {
    try {
      const res = await fetch('instructions.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setLibrary(data, 'instructions.json');
      try { localStorage.removeItem(LS_LIBRARY); } catch (e) { /* ignore */ }
      return;
    } catch (e) {
      if (location.protocol.startsWith('http')) {
        showLibraryError('Could not read instructions.json: ' + e.message + '. Check that it is valid JSON (see README).');
      }
    }
    // Opened from disk: use the copy the user picked last time, if any.
    try {
      const cached = JSON.parse(localStorage.getItem(LS_LIBRARY) || 'null');
      if (cached && cached.data) {
        setLibrary(cached.data, 'saved copy of ' + (cached.name || 'instructions.json') + ' (loaded ' + new Date(cached.savedAt).toLocaleDateString() + ')');
        return;
      }
    } catch (e) { /* fall through */ }
    $('#lib-modal').classList.remove('hidden');
  }

  function showLibraryError(msg) {
    const b = $('#library-banner');
    b.className = 'banner warn';
    b.innerHTML = esc(msg) + ' <label class="btn small">Load instructions.json<input type="file" accept=".json" class="lib-pick" hidden></label>';
  }

  async function readLibraryFile(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON: ' + e.message); }
    setLibrary(data, file.name);
    try {
      localStorage.setItem(LS_LIBRARY, JSON.stringify({ name: file.name, savedAt: Date.now(), data }));
    } catch (e) { /* too large or storage blocked; works for this session only */ }
    $('#lib-modal').classList.add('hidden');
    toast('Loaded ' + library.instructions.length + ' instructions from ' + file.name);
  }

  function isPlaceholderText(t) {
    return /\[\s*PLACEHOLDER/i.test(t || '');
  }

  function renderLibraryBanner() {
    const b = $('#library-banner');
    if (!library) return;
    const n = library.instructions.length;
    const ph = library.instructions.filter((i) => isPlaceholderText(i.text)).length;
    const tbd = library.instructions.filter((i) => /^tbd$/i.test(i.number)).length;
    const parts = [`<strong>Library:</strong> ${n} instructions from ${esc(library.source)}`];
    if (library.meta && library.meta.lastUpdated) parts.push('updated ' + esc(library.meta.lastUpdated));
    let warn = '';
    if (ph) warn += ` &middot; <strong>${ph}</strong> still have placeholder text`;
    if (tbd) warn += ` &middot; <strong>${tbd}</strong> need an M Crim JI number`;
    if (library.errors.length) warn += ` &middot; <strong>${library.errors.length}</strong> format problem(s) <a href="#" id="lib-errors">show</a>`;
    b.className = 'banner ' + (warn ? 'warn' : 'info');
    b.innerHTML = parts.join(' &middot; ') + warn +
      ' <label class="btn small">Load different file<input type="file" accept=".json" class="lib-pick" hidden></label>';
    const le = $('#lib-errors');
    if (le) le.addEventListener('click', (e) => { e.preventDefault(); alert(library.errors.join('\n')); });
  }

  // ---------------------------------------------------------------- step 1: case

  function newCount(c = {}) {
    return {
      id: uid(),
      number: c.number || state.counts.length + 1,
      description: c.description || '',
      mcl: Array.isArray(c.mcl) ? c.mcl.join(', ') : c.mcl || '',
      date: c.date || '',
      complainant: c.complainant || '',
    };
  }

  function countMcl(c) {
    return c.mcl.split(/[,;]+/).map((s) => P.normalizeMcl(s)).filter(Boolean);
  }

  function bindCaseFields() {
    const map = { 'f-defendant': 'defendant', 'f-case': 'caseNumber', 'f-judge': 'judge' };
    for (const [id, key] of Object.entries(map)) {
      const el = document.getElementById(id);
      el.addEventListener('input', () => { state.caseInfo[key] = el.value; });
    }
    $('#btn-titlecase').addEventListener('click', () => {
      const el = $('#f-defendant');
      el.value = titleCase(el.value);
      state.caseInfo.defendant = el.value;
    });
    $('#btn-add-count').addEventListener('click', () => {
      state.counts.push(newCount());
      renderCounts();
      const rows = $$('.count-row');
      if (rows.length) $('input[data-f="description"]', rows[rows.length - 1]).focus();
    });
  }

  function renderCaseFields() {
    $('#f-defendant').value = state.caseInfo.defendant;
    $('#f-case').value = state.caseInfo.caseNumber;
    $('#f-judge').value = state.caseInfo.judge;
  }

  function renderCounts() {
    const wrap = $('#counts');
    if (!state.counts.length) {
      wrap.innerHTML = '<div class="empty">No counts yet. Upload the Information or add counts by hand.</div>';
      return;
    }
    wrap.innerHTML = state.counts.map((c, i) => `
      <div class="count-row" data-id="${c.id}">
        <div class="count-num">Count ${esc(c.number)}</div>
        <label>Offense<input type="text" data-f="description" value="${esc(c.description)}"></label>
        <label>MCL<input type="text" data-f="mcl" value="${esc(c.mcl)}" placeholder="750.520b(1)(a)"></label>
        <label>Offense date<input type="text" data-f="date" value="${esc(c.date)}"></label>
        <label>Complainant<input type="text" data-f="complainant" value="${esc(c.complainant)}" placeholder="Initials"></label>
        <button type="button" class="btn icon danger" data-act="del" title="Remove count ${esc(c.number)}" aria-label="Remove count">&times;</button>
      </div>`).join('');
    $$('.count-row', wrap).forEach((row) => {
      const c = state.counts.find((x) => x.id === row.dataset.id);
      $$('input', row).forEach((inp) => inp.addEventListener('input', () => { c[inp.dataset.f] = inp.value; }));
      $('[data-act=del]', row).addEventListener('click', () => {
        state.counts = state.counts.filter((x) => x !== c);
        state.counts.forEach((x, i) => { x.number = i + 1; });
        renderCounts();
      });
    });
  }

  async function handleInfoFile(file) {
    const status = $('#file-status');
    status.textContent = 'Reading ' + file.name + '…';
    try {
      const text = await P.fileToText(file);
      $('#raw-text').textContent = text;
      $('#raw-details').classList.remove('hidden');
      if (!text.trim()) {
        status.textContent = file.name + ': no readable text. If this is a scanned PDF, enter the case information by hand.';
        return;
      }
      const parsed = P.parseInformation(text);
      state.caseInfo.defendant = parsed.defendant || state.caseInfo.defendant;
      state.caseInfo.caseNumber = parsed.caseNumber || state.caseInfo.caseNumber;
      state.caseInfo.judge = parsed.judge || state.caseInfo.judge;
      if (parsed.counts.length) state.counts = parsed.counts.map((c) => newCount(c));
      renderCaseFields();
      renderCounts();
      const missing = [];
      if (!parsed.defendant) missing.push('defendant');
      if (!parsed.caseNumber) missing.push('case number');
      if (!parsed.judge) missing.push('judge');
      if (!parsed.counts.length) missing.push('counts');
      const noMcl = parsed.counts.filter((c) => !c.mcl.length).length;
      status.textContent = `${file.name}: found ${parsed.counts.length} count(s).` +
        (missing.length ? ' Could not find: ' + missing.join(', ') + '.' : '') +
        (noMcl ? ` ${noMcl} count(s) have no MCL citation.` : '') + ' Review below.';
    } catch (e) {
      console.error(e);
      status.textContent = 'Could not read ' + file.name + ': ' + e.message;
    }
  }

  function bindUpload() {
    const dz = $('#dropzone');
    const input = $('#file-input');
    input.addEventListener('change', () => { if (input.files[0]) handleInfoFile(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleInfoFile(f); });
    // Stop a file dropped elsewhere from making the browser navigate away.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- compile

  function libById(id) { return library && library.instructions.find((i) => i.id === id); }

  // Elements instructions that best match a count's MCL citations.
  function matchElements(count) {
    if (!library) return [];
    const cites = countMcl(count);
    let best = 0;
    let hits = [];
    for (const ins of library.instructions) {
      if (ins.category !== 'elements') continue;
      let score = 0;
      for (const c of cites) for (const l of ins.mcl) score = Math.max(score, P.mclMatchScore(c, l));
      if (!score) continue;
      if (score > best) { best = score; hits = [ins]; } else if (score === best) hits.push(ins);
    }
    return hits;
  }

  function makeItem(ins, countId = null, auto = false) {
    return {
      uid: uid(), libId: ins.id, number: ins.number, title: ins.title, category: ins.category,
      group: ins.group, position: ins.position, ifApplicable: ins.ifApplicable, countId, text: ins.text, auto, edited: false,
    };
  }

  function countSignature() {
    return JSON.stringify(state.counts.map((c) => [c.id, countMcl(c)]));
  }

  function fullCompile() {
    if (!library) { toast('Load the instruction library first.'); return; }
    // Standard instructions follow their "order" field; any without one go after, by number.
    const std = library.instructions.filter((i) => i.category === 'standard').sort((a, b) =>
      (a.order ?? Infinity) - (b.order ?? Infinity) || cmpNum(a.number, b.number));
    const begin = std.filter((i) => i.position !== 'end').map((i) => makeItem(i, null, true));
    const end = std.filter((i) => i.position === 'end').map((i) => makeItem(i, null, true));
    const elems = [];
    for (const c of state.counts) for (const ins of matchElements(c)) elems.push(makeItem(ins, c.id, true));
    state.items = [...begin, ...elems, ...end];
    state.compiled = true;
    state.compiledSig = countSignature();
  }

  // Bring elements instructions in line with the counts without discarding
  // the user's edits, ordering, or add-ons.
  function syncCompile() {
    if (!state.compiled) { fullCompile(); return; }
    const countIds = new Set(state.counts.map((c) => c.id));
    state.items = state.items.filter((it) => !it.countId || countIds.has(it.countId) || it.edited);
    for (const c of state.counts) {
      const want = matchElements(c);
      const wantIds = new Set(want.map((w) => w.id));
      state.items = state.items.filter((it) => !(it.auto && !it.edited && it.countId === c.id && it.category === 'elements' && !wantIds.has(it.libId)));
      for (const ins of want) {
        if (state.items.some((it) => it.countId === c.id && it.libId === ins.id)) continue;
        insertItem(makeItem(ins, c.id, true));
      }
    }
    state.compiledSig = countSignature();
  }

  // Elements go after the last elements instruction; everything else goes
  // ahead of the closing instructions (or at the very end if it is one).
  function insertItem(item) {
    const items = state.items;
    let at = items.length;
    if (item.category === 'elements') {
      let lastEl = -1;
      items.forEach((it, i) => { if (it.category === 'elements') lastEl = i; });
      if (lastEl >= 0) at = lastEl + 1;
      else { const e = items.findIndex((it) => it.position === 'end'); if (e >= 0) at = e; }
    } else if (item.position !== 'end') {
      const e = items.findIndex((it) => it.position === 'end');
      if (e >= 0) at = e;
    }
    items.splice(at, 0, item);
  }

  // ---------------------------------------------------------------- placeholders

  function contextFor(item) {
    const ctx = {
      DEFENDANT: state.caseInfo.defendant,
      CASE_NUMBER: state.caseInfo.caseNumber,
      JUDGE: state.caseInfo.judge,
      COUNTY: 'Oakland',
      APA: settings.apa,
    };
    const c = item && item.countId && state.counts.find((x) => x.id === item.countId);
    if (c) {
      Object.assign(ctx, {
        COUNT: String(c.number),
        OFFENSE: c.description,
        MCL: countMcl(c)[0] ? 'MCL ' + countMcl(c)[0] : '',
        DATE: c.date,
        COMPLAINANT: c.complainant,
      });
    }
    return ctx;
  }

  const PH_RX = /\{\{\s*([A-Z_]+)\s*\}\}/g;

  function fill(text, ctx) {
    return (text || '').replace(PH_RX, (m, k) => (ctx[k] != null && String(ctx[k]).trim() !== '' ? ctx[k] : m));
  }

  function unfilled(text) {
    return [...new Set([...(text || '').matchAll(PH_RX)].map((m) => m[1]))];
  }

  function titleHtml(t) {
    return t && t.trim() ? esc(t) : '<span class="muted">(title needed)</span>';
  }

  function previewHtml(text) {
    return esc(text)
      .replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, '<span class="ph" title="No value for this placeholder">{{$1}}</span>')
      .replace(/(\[\s*PLACEHOLDER[^\]]*\])/gi, '<span class="placeholder-text">$1</span>');
  }

  // ---------------------------------------------------------------- warnings

  function collectWarnings() {
    const w = [];
    if (!state.items.length) w.push({ level: 'err', msg: 'No instructions are selected.' });
    for (const c of state.counts) {
      if (!state.items.some((it) => it.countId === c.id && it.category === 'elements')) {
        w.push({ level: 'err', msg: `Count ${c.number} (${c.description || 'no description'}) has no elements instruction.` });
      }
    }
    const stillPh = state.items.filter((it) => isPlaceholderText(it.text)).map((it) => it.number);
    if (stillPh.length) {
      w.push({ level: 'err', msg: `${stillPh.length} instruction(s) still have placeholder text instead of the official language: M Crim JI ${stillPh.join(', ')}.` });
    }
    for (const it of state.items) {
      const label = `M Crim JI ${it.number} ${it.title}`.trim();
      const filled = fill(it.text, contextFor(it));
      const missing = unfilled(filled);
      if (missing.length) {
        const countOnly = missing.filter((k) => ['COUNT', 'OFFENSE', 'MCL', 'DATE', 'COMPLAINANT'].includes(k));
        const hint = countOnly.length && !it.countId ? ' Assign it to a count in Review & Edit.' : '';
        w.push({ level: 'warn', msg: `${label}: no value for ${missing.map((k) => '{{' + k + '}}').join(', ')}.${hint}` });
      }
    }
    const noNum = state.items.filter((it) => !it.number || /^tbd$/i.test(it.number)).map((it) => it.title);
    if (noNum.length) w.push({ level: 'warn', msg: `No M Crim JI number yet: ${noNum.join('; ')}.` });
    const cond = state.items.filter((it) => it.ifApplicable).map((it) => it.number);
    if (cond.length) w.push({ level: 'warn', msg: `Included only if applicable. Confirm each applies to this trial or remove it: M Crim JI ${cond.join(', ')}.` });
    const noTitle = state.items.filter((it) => !it.title.trim()).map((it) => it.number);
    if (noTitle.length) w.push({ level: 'warn', msg: `No title yet (heading will show only the number): M Crim JI ${noTitle.join(', ')}.` });
    return w;
  }

  function renderWarnings(el, list) {
    el.innerHTML = list.map((x) => `<div class="flag ${x.level}">${esc(x.msg)}</div>`).join('');
  }

  // ---------------------------------------------------------------- step 2: instructions

  function renderInstructions() {
    if (!library) return;
    const flags = $('#flags');
    const html = [];
    if (state.compiled && state.compiledSig !== countSignature()) {
      html.push('<div class="flag warn">The counts changed since this list was compiled. <button type="button" class="btn small" id="btn-sync">Update elements instructions</button></div>');
    }
    if (!state.counts.length) html.push('<div class="flag warn">No counts entered, so no elements instructions were added.</div>');
    const elementsLib = library.instructions.filter((i) => i.category === 'elements').sort((a, b) => cmpNum(a.number, b.number));
    for (const c of state.counts) {
      const got = state.items.filter((it) => it.countId === c.id && it.category === 'elements');
      const cites = countMcl(c);
      const label = `<strong>Count ${esc(c.number)}</strong> &ndash; ${esc(c.description || 'no description')} ${cites.length ? '(MCL ' + esc(cites.join(', ')) + ')' : ''}`;
      if (got.length) {
        html.push(`<div class="flag ok">${label} &rarr; ${got.map((g) => 'M Crim JI ' + esc(g.number) + ' ' + esc(g.title)).join('; ')}</div>`);
      } else {
        html.push(`<div class="flag err">${label}: ${cites.length ? 'no elements instruction in the library matches this MCL section.' : 'no MCL citation entered.'}
          <br><select data-count="${c.id}" class="pick-elem"><option value="">Choose an elements instruction&hellip;</option>
          ${elementsLib.map((i) => `<option value="${esc(i.id)}">M Crim JI ${esc(i.number)} &ndash; ${esc(i.title)} (${esc(i.mcl.join(', '))})</option>`).join('')}
          </select></div>`);
      }
    }
    flags.innerHTML = html.join('');
    const sync = $('#btn-sync');
    if (sync) sync.addEventListener('click', () => { syncCompile(); renderInstructions(); toast('Elements instructions updated.'); });
    $$('.pick-elem', flags).forEach((sel) => sel.addEventListener('change', () => {
      const ins = libById(sel.value);
      if (!ins) return;
      insertItem(makeItem(ins, sel.dataset.count, false));
      renderInstructions();
    }));

    // Summary of the set, grouped.
    const groups = [
      ['Standard', state.items.filter((i) => i.category === 'standard')],
      ['Elements', state.items.filter((i) => i.category === 'elements')],
      ['Optional', state.items.filter((i) => i.category === 'optional')],
    ];
    $('#compiled-summary').innerHTML = groups.map(([name, list]) => `
      <div class="summary-group"><h3>${name} (${list.length})</h3>
      ${list.length ? list.map((it) => {
        const c = it.countId && state.counts.find((x) => x.id === it.countId);
        return `<div class="summary-item"><span class="num">M Crim JI ${esc(it.number)}</span><span>${titleHtml(it.title)}${c ? ' <span class="muted">(Count ' + esc(c.number) + ')</span>' : ''}</span>
          ${isPlaceholderText(it.text) ? '<span class="tag ph">placeholder text</span>' : ''}</div>`;
      }).join('') : '<div class="empty">None</div>'}</div>`).join('');

    renderOptional();
  }

  function renderOptional() {
    const q = ($('#opt-search').value || '').trim().toLowerCase();
    const list = library.instructions
      .filter((i) => i.category === 'optional')
      .filter((i) => !q || [i.number, i.title, i.group, i.text].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.group.localeCompare(b.group) || cmpNum(a.number, b.number));
    const byGroup = new Map();
    for (const i of list) {
      if (!byGroup.has(i.group)) byGroup.set(i.group, []);
      byGroup.get(i.group).push(i);
    }
    const box = $('#optional-list');
    if (!list.length) { box.innerHTML = '<div class="empty">No optional instructions match.</div>'; return; }
    box.innerHTML = [...byGroup.entries()].map(([g, arr]) => `
      <div class="opt-group"><h3>${esc(g)}</h3>
      ${arr.map((i) => `<label class="opt-item"><input type="checkbox" value="${esc(i.id)}" ${state.items.some((it) => it.libId === i.id) ? 'checked' : ''}>
        <span><span class="num">M Crim JI ${esc(i.number)}</span> ${esc(i.title)}${isPlaceholderText(i.text) ? ' <span class="tag ph">placeholder</span>' : ''}</span></label>`).join('')}
      </div>`).join('');
    $$('input[type=checkbox]', box).forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) insertItem(makeItem(libById(cb.value)));
      else state.items = state.items.filter((it) => it.libId !== cb.value);
      renderInstructions();
    }));
  }

  // ---------------------------------------------------------------- step 3: review

  function renderReview() {
    renderWarnings($('#review-warnings'), collectWarnings());
    const list = $('#review-list');
    if (!state.items.length) { list.innerHTML = '<li class="empty">Nothing selected. Go back to add instructions.</li>'; return; }
    const countOpts = (sel) => '<option value="">No count</option>' + state.counts.map((c) =>
      `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>Count ${esc(c.number)}</option>`).join('');
    list.innerHTML = state.items.map((it, i) => `
      <li class="ri${it.collapsed ? ' collapsed' : ''}" data-uid="${it.uid}">
        <div class="ri-head">
          <span class="ri-handle" title="Drag to reorder">&#8942;&#8942;</span>
          <span class="ri-idx">${i + 1}.</span>
          <span class="ri-title"><span class="num">M Crim JI ${esc(it.number)}</span>${titleHtml(it.title)}</span>
          <span class="tag ${it.category}">${it.category}</span>
          ${it.ifApplicable ? '<span class="tag ph" title="Keep only if it applies to this trial">if applicable</span>' : ''}
          ${it.edited ? '<span class="tag">edited</span>' : ''}
          <span class="ri-tools">
            <select data-act="count" title="Which count fills {{COUNT}}, {{DATE}}, etc.">${countOpts(it.countId)}</select>
            <button type="button" class="btn icon small" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
            <button type="button" class="btn icon small" data-act="down" title="Move down" ${i === state.items.length - 1 ? 'disabled' : ''}>&darr;</button>
            <button type="button" class="btn small" data-act="edit">${it.editing ? 'Done' : 'Edit'}</button>
            <button type="button" class="btn icon small" data-act="collapse" title="${it.collapsed ? 'Expand' : 'Collapse'}">${it.collapsed ? '&#9662;' : '&#9652;'}</button>
            <button type="button" class="btn icon small danger" data-act="remove" title="Remove">&times;</button>
          </span>
        </div>
        <div class="ri-body">
          ${it.editing ? `
            <div class="ri-edit">
              <div class="grid2">
                <label>M Crim JI number<input type="text" data-f="number" value="${esc(it.number)}"></label>
                <label>Title<input type="text" data-f="title" value="${esc(it.title)}"></label>
              </div>
              <label>Text &mdash; placeholders like {{DEFENDANT}} fill in automatically
                <textarea data-f="text" rows="10">${esc(it.text)}</textarea></label>
              <div class="ri-edit-tools">
                <button type="button" class="btn small" data-act="reset">Reset to library text</button>
                <button type="button" class="btn small primary" data-act="edit">Done</button>
              </div>
            </div>` : `<div class="ri-preview">${previewHtml(fill(it.text, contextFor(it)))}</div>`}
        </div>
      </li>`).join('');

    $$('.ri', list).forEach((li) => {
      const it = state.items.find((x) => x.uid === li.dataset.uid);
      const idx = () => state.items.indexOf(it);
      li.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        const i = idx();
        if (act === 'up' && i > 0) [state.items[i - 1], state.items[i]] = [state.items[i], state.items[i - 1]];
        else if (act === 'down' && i < state.items.length - 1) [state.items[i + 1], state.items[i]] = [state.items[i], state.items[i + 1]];
        else if (act === 'remove') state.items.splice(i, 1);
        else if (act === 'edit') it.editing = !it.editing;
        else if (act === 'collapse') it.collapsed = !it.collapsed;
        else if (act === 'reset') {
          const ins = libById(it.libId);
          if (ins && confirm('Replace this text with the library version? Your edits to this instruction will be lost.')) {
            Object.assign(it, { text: ins.text, number: ins.number, title: ins.title, edited: false });
          }
        }
        renderReview();
      });
      $('select[data-act=count]', li).addEventListener('change', (e) => { it.countId = e.target.value || null; renderReview(); });
      $$('[data-f]', li).forEach((inp) => inp.addEventListener('input', () => {
        it[inp.dataset.f] = inp.value;
        it.edited = true;
      }));
      setupDrag(li, it);
    });
  }

  let dragItem = null;
  function setupDrag(li, it) {
    const handle = $('.ri-handle', li);
    handle.addEventListener('mousedown', () => { li.draggable = true; });
    handle.addEventListener('mouseup', () => { li.draggable = false; });
    li.addEventListener('dragstart', (e) => {
      dragItem = it;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', it.uid);
    });
    li.addEventListener('dragend', () => {
      li.draggable = false;
      dragItem = null;
      $$('.ri').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after'));
    });
    li.addEventListener('dragover', (e) => {
      if (!dragItem || dragItem === it) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      li.classList.toggle('drop-after', after);
      li.classList.toggle('drop-before', !after);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      if (!dragItem || dragItem === it) return;
      e.preventDefault();
      const after = li.classList.contains('drop-after');
      state.items.splice(state.items.indexOf(dragItem), 1);
      state.items.splice(state.items.indexOf(it) + (after ? 1 : 0), 0, dragItem);
      renderReview();
    });
  }

  // ---------------------------------------------------------------- step 4: export

  function exportName() {
    const parts = ["People's Proposed Jury Instructions"];
    if (state.caseInfo.caseNumber) parts.push(state.caseInfo.caseNumber);
    if (state.caseInfo.defendant) parts.push(state.caseInfo.defendant);
    return safeFileName(parts.join(' - ')) + '.docx';
  }

  function renderExport() {
    if (state.step !== 4) return;
    $('#export-name').textContent = exportName();
    const w = collectWarnings();
    if (!settings.apa) w.unshift({ level: 'warn', msg: 'Enter the Assistant Prosecuting Attorney name for the caption and signature block.' });
    renderWarnings($('#export-warnings'), w);
  }

  async function doExport() {
    const errs = collectWarnings().filter((x) => x.level === 'err');
    if (errs.length && !confirm('There are unresolved problems:\n\n' + errs.map((e) => '• ' + e.msg).join('\n') + '\n\nExport anyway?')) return;
    const items = state.items.map((it) => {
      const c = it.countId && state.counts.find((x) => x.id === it.countId);
      return {
        number: it.number,
        title: it.title,
        countLabel: settings.countLabel && c && it.category === 'elements' ? 'Count ' + c.number : '',
        text: fill(it.text, contextFor(it)),
      };
    });
    const s = Object.assign({}, settings, {
      intro: fill(settings.intro, contextFor(null)),
      closing: fill(settings.closing, contextFor(null)),
      date: $('#s-date').value,
    });
    try {
      const blob = await window.DocxExport.build({ caseInfo: state.caseInfo, items, settings: s });
      download(blob, exportName());
      toast('Downloaded ' + exportName());
    } catch (e) {
      console.error(e);
      alert('Export failed: ' + e.message);
    }
  }

  // ---------------------------------------------------------------- drafts

  function saveDraft() {
    const data = {
      kind: 'jury-instruction-draft', version: 1, savedAt: new Date().toISOString(),
      caseInfo: state.caseInfo, counts: state.counts, compiled: state.compiled, compiledSig: state.compiledSig,
      items: state.items.map(({ editing, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const name = safeFileName('Jury instructions draft - ' + (state.caseInfo.caseNumber || 'case') + '.json');
    download(blob, name);
    toast('Draft saved. It contains case information, so store it with the case file.');
  }

  async function openDraft(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.kind !== 'jury-instruction-draft') throw new Error('This is not a draft saved by this app.');
      state.caseInfo = Object.assign({ defendant: '', caseNumber: '', judge: '' }, data.caseInfo);
      state.counts = data.counts || [];
      state.items = data.items || [];
      state.compiled = !!data.compiled;
      state.compiledSig = data.compiledSig;
      renderCaseFields();
      renderCounts();
      goto(state.items.length ? 3 : 1);
      toast('Draft opened.');
    } catch (e) {
      alert('Could not open draft: ' + e.message);
    }
  }

  // ---------------------------------------------------------------- navigation

  function goto(step) {
    if (step > 1 && !library) { toast('Load the instruction library first.'); $('#lib-modal').classList.remove('hidden'); return; }
    if (step > 1 && !state.compiled) fullCompile();
    state.step = step;
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== String(step)));
    $$('.step').forEach((b) => {
      const n = parseInt(b.dataset.step, 10);
      b.classList.toggle('active', n === step);
      b.classList.toggle('done', n < step);
    });
    if (step === 2) renderInstructions();
    if (step === 3) renderReview();
    if (step === 4) renderExport();
    window.scrollTo(0, 0);
  }

  function init() {
    bindSettings();
    bindCaseFields();
    bindUpload();
    renderCounts();

    $$('.step').forEach((b) => b.addEventListener('click', () => goto(parseInt(b.dataset.step, 10))));
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => goto(parseInt(b.dataset.goto, 10))));
    $('#btn-compile').addEventListener('click', () => {
      if (!library) { $('#lib-modal').classList.remove('hidden'); return; }
      syncCompile();
      goto(2);
    });
    $('#btn-recompile').addEventListener('click', () => {
      if (state.items.some((i) => i.edited || !i.auto) && !confirm('Rebuild from scratch? Your edits, reordering, and add-ons will be cleared.')) return;
      fullCompile();
      renderInstructions();
    });
    $('#opt-search').addEventListener('input', renderOptional);
    $('#btn-export').addEventListener('click', doExport);
    $('#btn-save-draft').addEventListener('click', saveDraft);
    $('#draft-input').addEventListener('change', (e) => { if (e.target.files[0]) openDraft(e.target.files[0]); e.target.value = ''; });

    // Library file pickers (modal + banner).
    document.addEventListener('change', (e) => {
      if (e.target.id === 'lib-input' || e.target.classList.contains('lib-pick')) {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) readLibraryFile(f).catch((err) => alert(err.message));
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.counts.length || state.items.length) { e.preventDefault(); e.returnValue = ''; }
    });

    loadLibrary();
  }

  init();
})();
