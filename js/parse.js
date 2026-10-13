/* Reads text out of the uploaded Information and pulls out the case data.
 * Everything here runs locally. Nothing is sent anywhere. */
(function (root) {
  'use strict';

  // ---------- File -> text ----------

  let workerLoading = null;

  // pdf.js normally parses in a Web Worker, but browsers refuse to start a
  // worker for a page opened straight from disk (file://). Loading the worker
  // bundle as a plain script makes pdf.js parse on the main thread instead,
  // which works everywhere and is fast enough for a charging document.
  function ensurePdfWorker() {
    if (root.pdfjsWorker) return Promise.resolve();
    if (workerLoading) return workerLoading;
    workerLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdf.worker.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load vendor/pdf.worker.min.js'));
      document.head.appendChild(s);
    });
    return workerLoading;
  }

  async function pdfToText(arrayBuffer) {
    await ensurePdfWorker();
    const pdfjs = root.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
    }).promise;

    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items));
    }
    await doc.destroy();
    return pages.join('\n\n');
  }

  // Rebuild reading-order lines from positioned text runs.
  function itemsToLines(items) {
    const runs = items
      .filter((it) => typeof it.str === 'string' && it.str.length)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: Math.abs(it.transform[3]) || 10,
      }));
    runs.sort((a, b) => b.y - a.y || a.x - b.x);

    const lines = [];
    for (const r of runs) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - r.y) <= Math.max(2, r.h * 0.4)) last.runs.push(r);
      else lines.push({ y: r.y, runs: [r] });
    }
    return lines
      .map((ln) => {
        ln.runs.sort((a, b) => a.x - b.x);
        let out = '';
        let end = null;
        for (const r of ln.runs) {
          if (end !== null) {
            const gap = r.x - end;
            if (gap > r.h * 1.5) out += '   ';
            else if (gap > r.h * 0.15 && !/\s$/.test(out) && !/^\s/.test(r.str)) out += ' ';
          }
          out += r.str;
          end = r.x + r.w;
        }
        return out.replace(/[ \t]+$/, '');
      })
      .join('\n');
  }

  async function docxToText(arrayBuffer) {
    const res = await root.mammoth.extractRawText({ arrayBuffer });
    return res.value;
  }

  async function fileToText(file) {
    const buf = await file.arrayBuffer();
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfToText(buf);
    if (name.endsWith('.docx')) return docxToText(buf);
    if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save it as .docx or PDF and try again.');
    throw new Error('Unsupported file type. Use a PDF or .docx file.');
  }

  // ---------- MCL citations ----------

  // "MCL § 750.520b (1)(a)" -> "750.520b(1)(a)"
  function normalizeMcl(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/m\.?\s*c\.?\s*l\.?\s*a?\.?/g, '')
      .replace(/§/g, '')
      .replace(/\s+/g, '')
      .replace(/^[.,;:]+|[.,;:]+$/g, '');
  }

  // PACC-style code "750.520B1A" -> "750.520b(1)(a)"
  function paccToMcl(code) {
    const m = /^(\d{1,3})\.(\d+[a-z]?)(\d+)?([a-z]+)?$/i.exec(code.trim());
    if (!m) return null;
    let out = m[1] + '.' + m[2].toLowerCase();
    if (m[3]) out += '(' + m[3] + ')';
    if (m[4]) out += m[4].toLowerCase().split('').map((c) => '(' + c + ')').join('');
    return out;
  }

  const MCL_PREFIXED = /\b(?:M\.?\s?C\.?\s?L\.?\s?A?\.?|MCLA)\s*§*\s*(\d{1,3}\.\d+[a-z]{0,2}(?:\s?\(\s?[0-9a-z]{1,4}\s?\))*)/gi;
  const MCL_BARE = /(?:^|[\s(\[,;])((?:750|752|333|257|324|28|722|767|768|769|780|791)\.\d+[a-z]{0,2}(?:\([0-9a-z]{1,4}\))*)/gi;
  const PACC = /\[\s*((?:750|752|333|257)\.\d+[A-Z0-9]*)\s*\]/g;

  function extractMcl(text) {
    const found = [];
    const add = (c) => {
      const n = normalizeMcl(c);
      if (n && !found.includes(n)) found.push(n);
    };
    let m;
    MCL_PREFIXED.lastIndex = 0;
    while ((m = MCL_PREFIXED.exec(text))) add(m[1]);
    if (!found.length) {
      MCL_BARE.lastIndex = 0;
      while ((m = MCL_BARE.exec(text))) add(m[1]);
    }
    if (!found.length) {
      PACC.lastIndex = 0;
      while ((m = PACC.exec(text))) {
        const c = paccToMcl(m[1]);
        if (c) add(c);
      }
    }
    return found;
  }

  // How specifically a library citation covers a charged citation.
  // 0 = no match. Exact match beats a parent section.
  function mclMatchScore(charged, libCite) {
    const a = normalizeMcl(charged);
    const b = normalizeMcl(libCite);
    if (!a || !b) return 0;
    if (a === b) return b.length + 1000;
    if (a.startsWith(b) && a.charAt(b.length) === '(') return b.length;
    return 0;
  }

  // ---------- Information -> case data ----------

  const DATE_RX = String.raw`(?:\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})`;

  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').replace(/^[\s,:;.\-–—]+|[\s,:;\-–—]+$/g, '').trim();
  }

  function findCaseNumber(text) {
    let m = /\b(\d{2,4}-\d{3,7}-[A-Z]{2})\b/.exec(text);
    if (m) return m[1];
    m = /Case\s*(?:No\.?|Number|#)\s*[:.]?\s*([0-9][0-9A-Z\-]{4,})/i.exec(text);
    return m ? m[1] : '';
  }

  function findJudge(text) {
    const rxs = [
      /\bHon(?:orable|\.)?\s+([A-Z][A-Za-z.'\-]+(?:[ \t]+[A-Z][A-Za-z.'\-]+){0,3})/,
      /\bJudge\s*(?:Name)?\s*:\s*([A-Z][A-Za-z.'\-]+(?:[ \t]+[A-Z][A-Za-z.'\-]+){0,3})/i,
      /\bJudge\s+([A-Z][A-Za-z.'\-]+(?:[ \t]+[A-Z][A-Za-z.'\-]+){0,3})/,
    ];
    for (const rx of rxs) {
      const m = rx.exec(text);
      if (m) {
        const name = m[1].replace(/\s+(?:P\d+|Circuit|Court|Bar|No)\b.*$/i, '').trim();
        if (name && !/^(of|the|and)$/i.test(name)) return name;
      }
    }
    return '';
  }

  function findDefendant(text) {
    const rxs = [
      /Defendant(?:'s)?\s*(?:Name)?\s*:\s*([A-Z][A-Za-z.,'\- ]{2,60}?)(?:\s{2,}|\n|$)/,
      /PEOPLE\s+OF\s+THE\s+STATE\s+OF\s+MICHIGAN[\s,]*(?:Plaintiff[,.]?\s*)?(?:v\.?|vs\.?|-v-|versus)\s+([A-Z][A-Za-z.,'\- ]{2,60}?)\s*(?:,?\s*Defendant|\n|\s{2,}|$)/i,
      /\n\s*(?:v\.?|vs\.?|-v-)\s*\n\s*([A-Z][A-Za-z.,'\- ]{2,60}?)\s*(?:,?\s*Defendant|\n|$)/,
    ];
    for (const rx of rxs) {
      const m = rx.exec(text);
      if (m) {
        const name = clean(m[1]).replace(/,?\s*(?:Defendant|DOB|D\.O\.B).*$/i, '').trim();
        if (name && !/^(Plaintiff|Defendant)$/i.test(name)) return name;
      }
    }
    return '';
  }

  function findDate(text) {
    let m = new RegExp(String.raw`between\s+(${DATE_RX})\s+(?:and|through|to)\s+(${DATE_RX})`, 'i').exec(text);
    if (m) return 'between ' + m[1] + ' and ' + m[2];
    m = new RegExp(String.raw`on\s+or\s+about\s+(${DATE_RX})`, 'i').exec(text);
    if (m) return m[1];
    m = headerDate(text);
    if (m) return m;
    m = new RegExp(String.raw`\bon\s+(${DATE_RX})`, 'i').exec(text);
    return m ? m[1] : '';
  }

  // "Date of Offense: 03/15/2025" style field at the top of the form.
  function headerDate(text) {
    const m = new RegExp(String.raw`(?:(?:Offense|Incident)\s+Date|Date\s+of\s+(?:Offense|Incident))\s*:?\s*(${DATE_RX})`, 'i').exec(text);
    return m ? m[1] : '';
  }

  function romanToInt(s) {
    const map = { I: 1, V: 5, X: 10, L: 50 };
    let total = 0;
    const up = s.toUpperCase();
    for (let i = 0; i < up.length; i++) {
      const v = map[up[i]], next = map[up[i + 1]] || 0;
      total += v < next ? -v : v;
    }
    return total;
  }

  // Strip noise from an offense title line.
  function cleanOffenseTitle(s) {
    return clean(
      s
        .replace(MCL_PREFIXED, '')
        .replace(PACC, '')
        .replace(/\b(?:FELONY|MISDEMEANOR)\s*[:\-].*$/i, '')
        .replace(/\bcontrary to\b.*$/i, '')
        .replace(/\(\s*\)/g, '')
    );
  }

  const COUNT_END = /\n\s*(?:HABITUAL\s+OFFENDER|NOTICE\s+OF|SENTENCE\s+ENHANCEMENT|Upon\s+conviction|Prosecuting\s+Attorney|Respectfully|Dated?\s*:)/i;

  function findCounts(text) {
    const rx = /(?:^|\n)[ \t]*COUNT\s+(\d{1,3}|[IVXL]{1,6})\b\s*[:.\-–—]?\s*/gi;
    const hits = [];
    let m;
    while ((m = rx.exec(text))) hits.push({ idx: m.index, end: rx.lastIndex, label: m[1] });
    if (!hits.length) {
      // Some forms don't start the count label at the beginning of a line.
      const rx2 = /\bCOUNT\s+(\d{1,3})\s*[:.\-–—]\s*/g;
      while ((m = rx2.exec(text))) hits.push({ idx: m.index, end: rx2.lastIndex, label: m[1] });
    }

    const counts = [];
    hits.forEach((h, i) => {
      let body = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].idx : text.length);
      const stop = COUNT_END.exec(body);
      if (stop) body = body.slice(0, stop.index);

      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
      let title = '';
      for (const l of lines.slice(0, 3)) {
        title = cleanOffenseTitle(l);
        if (title && !/^(did|defendant|the defendant)\b/i.test(title)) break;
        title = '';
      }
      const num = /^\d+$/.test(h.label) ? parseInt(h.label, 10) : romanToInt(h.label);
      counts.push({
        number: num,
        description: title,
        mcl: extractMcl(body),
        date: findDate(body),
        complainant: '',
      });
    });

    // Drop duplicates (e.g. a summary table that repeats "COUNT 1").
    const seen = new Map();
    for (const c of counts) {
      const prev = seen.get(c.number);
      if (!prev || (!prev.mcl.length && c.mcl.length)) seen.set(c.number, c);
    }
    return [...seen.values()].sort((a, b) => a.number - b.number);
  }

  function parseInformation(text) {
    const t = (text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    const counts = findCounts(t);
    const fallbackDate = headerDate(t);
    counts.forEach((c) => { if (!c.date) c.date = fallbackDate; });
    return {
      defendant: findDefendant(t),
      caseNumber: findCaseNumber(t),
      judge: findJudge(t),
      counts,
    };
  }

  const api = { fileToText, parseInformation, normalizeMcl, paccToMcl, extractMcl, mclMatchScore, itemsToLines };
  root.InfoParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
