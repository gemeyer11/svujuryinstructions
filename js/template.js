/* Fills instruction text for one count: picks tagged bracketed alternatives,
 * then swaps in {{PLACEHOLDERS}}.
 *
 * Alternative syntax (see README):
 *   [[ (1)(a): text for (1)(a) || (1)(b): text for (1)(b) || "fellatio" "oral": text ]]
 *
 * Text that couldn't be resolved comes back wrapped in HL_OPEN/HL_CLOSE so the
 * review screen and the .docx can highlight it. */
(function (root) {
  'use strict';

  const HL_OPEN = '\u0001';
  const HL_CLOSE = '\u0002';
  const PH_RX = /\{\{\s*([A-Z_]+)\s*\}\}/g;

  function normalizeMcl(s) {
    return String(s || '').toLowerCase().replace(/m\.?\s*c\.?\s*l\.?\s*a?\.?/g, '').replace(/§/g, '').replace(/\s+/g, '');
  }

  // Parse "(1)(a) 750.520b(2)(b) \"penis\"" into tokens.
  function parseTag(tag) {
    const tokens = [];
    const rx = /"([^"]+)"|'([^']+)'|(\d{1,3}\.\d+[a-z]{0,2}(?:\([0-9a-z]{1,4}\))*)|((?:\([0-9a-z]{1,4}\))+)/gi;
    let m;
    let consumed = '';
    while ((m = rx.exec(tag))) {
      consumed += m[0];
      if (m[1] || m[2]) tokens.push({ kind: 'keyword', value: (m[1] || m[2]).trim().toLowerCase() });
      else if (m[3]) tokens.push({ kind: 'cite', value: normalizeMcl(m[3]) });
      else tokens.push({ kind: 'sub', value: m[4].toLowerCase().replace(/\s+/g, '') });
    }
    // Anything left over that isn't whitespace/commas/"or" means this wasn't a tag.
    const leftover = tag.replace(rx, '').replace(/\b(?:or|and)\b|[,\s|/]/gi, '');
    return leftover ? [] : tokens;
  }

  function tokenMatches(tok, cites, act) {
    if (tok.kind === 'keyword') {
      const kw = tok.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp('\\b' + kw, 'i').test(act || '');
    }
    if (tok.kind === 'cite') {
      return cites.some((c) => c === tok.value || (c.startsWith(tok.value) && c.charAt(tok.value.length) === '('));
    }
    // Subsection: compare against the part of each cite after the section number.
    return cites.some((c) => {
      const i = c.indexOf('(');
      const sub = i >= 0 ? c.slice(i) : '';
      return sub === tok.value || sub.startsWith(tok.value);
    });
  }

  // Find [[ ... ]] groups. Returns [{start, end, body}].
  function findGroups(text) {
    const out = [];
    let i = 0;
    while ((i = text.indexOf('[[', i)) !== -1) {
      const end = text.indexOf(']]', i + 2);
      if (end === -1) break;
      out.push({ start: i, end: end + 2, body: text.slice(i + 2, end) });
      i = end + 2;
    }
    return out;
  }

  function parseOptions(body) {
    return body.split('||').map((raw) => {
      const colon = raw.indexOf(':');
      const tagText = colon >= 0 ? raw.slice(0, colon) : '';
      const tokens = colon >= 0 ? parseTag(tagText) : [];
      return {
        tag: tokens.length ? tagText.trim() : '',
        tokens,
        text: (tokens.length ? raw.slice(colon + 1) : raw).trim(),
      };
    }).filter((o) => o.text);
  }

  // Bracket and highlight every option, line by line so highlights never
  // cross a paragraph break.
  function unresolved(options) {
    const pieces = options.map((o) => '[' + o.text + ']');
    const joined = pieces.join(pieces.some((p) => p.includes('\n')) ? '\n' : ' ');
    return joined.split('\n').map((ln) => (ln.trim() ? HL_OPEN + ln + HL_CLOSE : ln)).join('\n');
  }

  function resolveAlternatives(text, info) {
    const cites = (info.cites || []).map(normalizeMcl);
    const act = info.act || '';
    const groups = findGroups(text || '');
    if (!groups.length) return { text: text || '', unresolved: 0 };
    let out = '';
    let last = 0;
    let open = 0;
    for (const g of groups) {
      out += text.slice(last, g.start);
      last = g.end;
      const options = parseOptions(g.body);
      const hits = options.filter((o) => o.tokens.some((t) => tokenMatches(t, cites, act)));
      if (hits.length === 1) out += hits[0].text;
      else { out += unresolved(options); open++; }
    }
    out += text.slice(last);
    return { text: out, unresolved: open };
  }

  // Full render: alternatives first, then placeholders. Unknown or empty
  // placeholders stay as {{NAME}} so they're easy to spot.
  function render(text, ctx, info) {
    const r = resolveAlternatives(text, info || {});
    const filled = r.text.replace(PH_RX, (m, k) => (ctx[k] != null && String(ctx[k]).trim() !== '' ? ctx[k] : m));
    return { text: filled, unresolved: r.unresolved };
  }

  function unfilled(text) {
    return [...new Set([...(text || '').matchAll(PH_RX)].map((m) => m[1]))];
  }

  // "a \u0001b\u0002 c" -> [{text:'a ', hl:false}, {text:'b', hl:true}, {text:' c', hl:false}]
  function segments(line) {
    const out = [];
    const rx = /\u0001([\s\S]*?)\u0002/g;
    let last = 0;
    let m;
    while ((m = rx.exec(line))) {
      if (m.index > last) out.push({ text: line.slice(last, m.index), hl: false });
      out.push({ text: m[1], hl: true });
      last = rx.lastIndex;
    }
    if (last < line.length) out.push({ text: line.slice(last), hl: false });
    return out;
  }

  function strip(text) {
    return String(text || '').replace(/[\u0001\u0002]/g, '');
  }

  const api = { render, resolveAlternatives, unfilled, segments, strip, parseTag, HL_OPEN, HL_CLOSE, PH_RX };
  root.Template = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
