// KAIST exchange guide: static site generator.
// Reads draft/NN-*.md and data/*.json, writes docs/ for GitHub Pages.
// Run from anywhere: node site-src/build.mjs   (or: npm run build, inside site-src)

import { marked } from 'marked';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const GUIDE = resolve(SRC, '..');
const DRAFT = join(GUIDE, 'draft');
const OUT = join(GUIDE, 'docs');
const DATA = join(SRC, 'data');
const RATE = 215; // about 215 won to 1 krone (2025)
const SITE = 'KAIST exchange guide';

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn('  warn  ' + msg); };

/* ------------------------------------------------------------------ */
/* The eleven aisles. Used for stubs and as the fallback for anything  */
/* the data files leave out.                                            */
/* ------------------------------------------------------------------ */

const BASE = [
  { n: 1, slug: 'index', file: '01-should-you-go.md', ko: '갈까 말까', rom: 'galkka malkka', meaning: 'go or not?' },
  { n: 2, slug: 'applying', file: '02-applying.md', ko: '지원', rom: 'jiwon', meaning: 'applying' },
  { n: 3, slug: 'money', file: '03-money.md', ko: '돈', rom: 'don', meaning: 'money' },
  { n: 4, slug: 'before-you-fly', file: '04-before-you-fly.md', ko: '출국 전', rom: 'chulguk jeon', meaning: 'before leaving the country' },
  { n: 5, slug: 'arrival', file: '05-arrival.md', ko: '도착', rom: 'dochak', meaning: 'arrival' },
  { n: 6, slug: 'academics', file: '06-academics.md', ko: '공부', rom: 'gongbu', meaning: 'studying' },
  { n: 7, slug: 'campus-life', file: '07-campus-life.md', ko: '캠퍼스', rom: 'kaempeoseu', meaning: 'campus' },
  { n: 8, slug: 'food-and-nights-out', file: '08-food-and-nights-out.md', ko: '밥과 밤', rom: 'bapgwa bam', meaning: 'meals and nights' },
  { n: 9, slug: 'people', file: '09-people.md', ko: '사람들', rom: 'saramdeul', meaning: 'people' },
  { n: 10, slug: 'travel', file: '10-travel.md', ko: '여행', rom: 'yeohaeng', meaning: 'travel' },
  { n: 11, slug: 'leaving', file: '11-leaving-and-top-tips.md', ko: '떠나기', rom: 'tteonagi', meaning: 'leaving' },
];

// Plain-text names the prose uses for other sections, longest first when matched.
const ALIASES = { Arrival: 'arrival' };

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pad2 = (n) => String(n).padStart(2, '0');
const href = (slug) => (slug === 'index' ? 'index.html' : `${slug}.html`);
const normSlug = (s) => String(s || '').replace(/\.html$/, '').replace(/^\.?\//, '') || 'index';

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
}
const plain = (html) => decodeEntities(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Typographic quotes and apostrophes in text nodes only (tags, attributes and code untouched).
// Presentation only: the words in draft/ stay exactly as written.
function smartQuotes(html) {
  let prev = ' ';
  let skip = 0;
  return html.split(/(<[^>]*>)/).map((part, i) => {
    if (i % 2 === 1) {
      if (/^<(code|pre|script|style)\b/i.test(part)) skip++;
      else if (/^<\/(code|pre|script|style)>/i.test(part)) skip = Math.max(0, skip - 1);
      return part;
    }
    if (skip || !part) return part;
    let t = part.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    let out = '';
    for (const ch of t) {
      const opens = /[\s(\[{/-]/.test(prev);
      if (ch === '"') out += opens ? '“' : '”';
      else if (ch === "'") out += opens ? '‘' : '’';
      else out += ch;
      prev = ch;
    }
    return out;
  }).join('');
}

function slugify(s) {
  return plain(s).toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-') || 'part';
}

const nf = (max = 3) => new Intl.NumberFormat('en-US', { maximumFractionDigits: max });
const fmt = (n) => nf(3).format(n);
function fmtWon(v) {
  const step = v >= 100000 ? 1000 : v >= 1000 ? 100 : 10;
  return nf(0).format(Math.round(v / step) * step);
}
function fmtKr(v) {
  if (v < 10) return nf(1).format(Math.round(v * 10) / 10);
  if (v < 1000) return nf(0).format(Math.round(v));
  return nf(0).format(Math.round(v / 10) * 10);
}

function readJSON(file) {
  const p = join(DATA, file);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { warn(`${file} is not valid JSON (${e.message}), using fallback`); return null; }
}

function copyDir(from, to, filter = () => true) {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of readdirSync(from)) {
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) n += copyDir(a, b, filter);
    else if (filter(name)) { copyFileSync(a, b); n++; }
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Authored icons (inline SVG, no glyph icons)                         */
/* ------------------------------------------------------------------ */

const ICON = {
  barcode: '<svg class="i-barcode" viewBox="0 0 18 11" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 0h1.6v11H0zM2.8 0h.8v11h-.8zM4.8 0h2.2v11H4.8zM8.2 0h.8v11h-.8zM10.2 0h1.6v11h-1.6zM13 0h.8v11H13zM15 0h2.4v11H15z"/></svg>',
  pencil: '<svg class="i-pencil" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M11.2 1.8l3 3L5.4 13.6 1.6 14.4l.8-3.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.2 3.8l3 3" stroke="currentColor" stroke-width="1.7"/></svg>',
  aisles: '<svg class="i-aisles" viewBox="0 0 20 16" aria-hidden="true" focusable="false"><path d="M1 1.5h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4v10.5M9 4v6M14 4v8.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
  close: '<svg class="i-close" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  prev: '<svg class="i-arrow" viewBox="0 0 20 14" aria-hidden="true" focusable="false"><path d="M19 7H2M7.5 1.5L2 7l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg class="i-arrow" viewBox="0 0 20 14" aria-hidden="true" focusable="false"><path d="M1 7h17M12.5 1.5L18 7l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg class="i-up" viewBox="0 0 14 16" aria-hidden="true" focusable="false"><path d="M7 15V2M1.5 7.5L7 2l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="6" fill="#ffffff"/>
  <rect x="3" y="4" width="26" height="5" rx="1" fill="#1f3fd6"/>
  <rect x="3" y="10" width="26" height="2.4" fill="#12b39b"/>
  <rect x="3" y="13.4" width="26" height="2.4" fill="#d4126e"/>
  <path d="M5.5 17.8V28h21V17.8" fill="none" stroke="#0b1626" stroke-width="2.4"/>
  <path d="M13.2 28v-6.6h5.6V28" fill="none" stroke="#0b1626" stroke-width="2.2"/>
  <rect x="7.6" y="20.2" width="3.4" height="3.6" fill="#0b1626"/>
  <rect x="21" y="20.2" width="3.4" height="3.6" fill="#0b1626"/>
</svg>
`;

/* ------------------------------------------------------------------ */
/* Load sections, with stubs when the data builder has not run yet     */
/* ------------------------------------------------------------------ */

function stripMarkers(text, file) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const found = [];
  lines.forEach((line, i) => {
    let res = '', j = 0, changed = false;
    for (;;) {
      const m = /\[(ASK|CHECK|TODO):/.exec(line.slice(j));
      if (!m) { res += line.slice(j); break; }
      const start = j + m.index;
      let depth = 0, k = start;
      for (; k < line.length; k++) {
        if (line[k] === '[') depth++;
        else if (line[k] === ']') { depth--; if (depth === 0) break; }
      }
      if (k >= line.length) { res += line.slice(j); break; } // unterminated: leave it
      found.push({ line: i + 1, kind: m[1], text: line.slice(start, k + 1) });
      res += line.slice(j, start).replace(/[ \t]+$/, '');
      j = k + 1;
      changed = true;
    }
    if (changed) {
      res = res.replace(/[ \t]+([.,;:!?)])/g, '$1');
      if (/^\s*$/.test(res)) return; // paragraph left empty: drop
      if (/^\s*([-*+]|\d+\.)\s*$/.test(res)) return; // empty list item: drop
    }
    out.push(res);
  });
  return { text: out.join('\n'), found };
}

function wordCount(md) {
  const t = md.replace(/<!--[\s\S]*?-->/g, ' ').replace(/[#*_|`>]/g, ' ');
  return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function readDraft(file) {
  const p = join(DRAFT, file);
  if (!existsSync(p)) throw new Error(`missing draft file: ${p}`);
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function loadSections() {
  let data = readJSON('sections.json');
  if (!Array.isArray(data)) {
    // Stub from the SECTIONS list so the frame can be built. The data builder overwrites it.
    data = BASE.map((b) => {
      const raw = readDraft(b.file);
      const { text } = stripMarkers(raw, b.file);
      const title = (/^##\s+(.+)$/m.exec(text) || [])[1] || b.slug;
      const words = wordCount(text);
      return { ...b, title, words, minutes: Math.ceil(words / 230), window: '', keyFigures: [], tip: null, stub: true };
    });
    mkdirSync(DATA, { recursive: true });
    writeFileSync(join(DATA, 'sections.json'), JSON.stringify(data, null, 2) + '\n');
    warn('data/sections.json was missing, wrote a stub from the SECTIONS list');
  }
  // Merge onto BASE so a partial file still builds.
  return BASE.map((b) => {
    const d = data.find((x) => x && (x.n === b.n || normSlug(x.slug) === b.slug)) || {};
    const s = { ...b, ...d, slug: normSlug(d.slug || b.slug), file: d.file || b.file };
    if (!s.title) {
      const raw = readDraft(s.file);
      s.title = (/^##\s+(.+)$/m.exec(raw) || [])[1] || s.slug;
    }
    if (!Number.isFinite(+s.words) || !s.words) s.words = wordCount(stripMarkers(readDraft(s.file), s.file).text);
    if (!Number.isFinite(+s.minutes) || !s.minutes) s.minutes = Math.ceil(s.words / 230);
    s.keyFigures = Array.isArray(s.keyFigures) ? s.keyFigures : [];
    return s;
  });
}

function loadHome(sections) {
  let home = readJSON('home.json');
  if (!home) {
    const raw = readDraft(sections[0].file);
    const about = (/### About me\n\n([^\n]+)\n\n([^\n]+)/.exec(raw) || []);
    const first = (about[1] || '').split(/(?<=\.)\s/)[0] || '';
    home = {
      headline: 'My KAIST exchange, from “should I apply?” to credits back at DTU',
      intro: first,
      scores: [],
      tips: [],
      stub: true,
    };
    mkdirSync(DATA, { recursive: true });
    writeFileSync(join(DATA, 'home.json'), JSON.stringify(home, null, 2) + '\n');
    warn('data/home.json was missing, wrote a stub');
  }
  return home;
}

/* ------------------------------------------------------------------ */
/* Markdown                                                             */
/* ------------------------------------------------------------------ */

marked.use({
  gfm: true,
  renderer: {
    link({ href: url, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const external = /^https?:\/\//i.test(url);
      return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${text}</a>`;
    },
  },
});

// Plain-text cross-references such as "(see Arrival and first weeks)" become links.
function linkCrossRefs(md, current, names, headings, file, log) {
  const alt = Object.keys(names).sort((a, b) => b.length - a.length).map(escRe).join('|');
  const nameRe = `(${alt})(?![\\w'-])`;
  const patterns = [
    { re: new RegExp(`\\b([Ss]ee) ${nameRe}`, 'g'), pre: 1, name: 2 },
    { re: new RegExp(`\\b(covered in|are in|is in) ${nameRe}`, 'g'), pre: 1, name: 2 },
    { re: new RegExp(`\\b([Tt]he) ${nameRe}(?= (?:section|page|aisle)\\b)`, 'g'), pre: 1, name: 2 },
    { re: new RegExp(`(^|[.!?] )${nameRe}(?= (?:has|covers) )`, 'g'), pre: 1, name: 2, glue: '' },
  ];
  const headAlt = headings.map((h) => escRe(h.text)).join('|');
  const internal = headAlt ? new RegExp(`\\b([Ss]ee) (${headAlt}) (below|above|further down)\\b`, 'gi') : null;

  const out = md.split('\n').map((line, i) => {
    if (/^\s*#/.test(line) || /^\s*<!--/.test(line)) return line;
    // leave existing links and autolinks alone
    const parts = line.split(/(\[[^\]]*\]\([^)]*\)|<https?:[^>]+>)/);
    return parts.map((seg, k) => {
      if (k % 2 === 1) return seg;
      let s = seg;
      for (const p of patterns) {
        s = s.replace(p.re, (...m) => {
          const pre = m[p.pre], name = m[p.name];
          const slug = names[name];
          if (!slug || slug === current) return m[0];
          log.push(`${file}:${i + 1} "${m[0].trim()}" -> ${href(slug)}`);
          const glue = p.glue ?? ' ';
          return `${pre}${glue}[${name}](${href(slug)})`;
        });
      }
      if (internal) {
        s = s.replace(internal, (whole, see, name, where) => {
          const h = headings.find((x) => x.text.toLowerCase() === name.toLowerCase());
          if (!h) return whole;
          log.push(`${file}:${i + 1} "${whole}" -> #${h.id}`);
          return `${see} [${name}](#${h.id}) ${where}`;
        });
      }
      return s;
    }).join('');
  });
  return out.join('\n');
}

// Isolate tool and checklist placeholders as their own HTML blocks.
function isolatePlaceholders(md) {
  return md.replace(/<!--\s*(tool|checklist)\s*:\s*([\w-]+)\s*-->/g, '\n\n<!--$1:$2-->\n\n');
}

function isNumericCell(t) {
  const s = t.replace(/\*\*/g, '').trim();
  if (!s) return null;
  return /^(about |roughly )?[-+]?\d[\d,.]*(\s?(×|x)\s?\d[\d,.]*)?(\s?(DKK|KRW|USD|kr|won|°C|%|ECTS|mm))?$/i.test(s);
}

function renderTable(tok, label, idx) {
  const cols = tok.header.length;
  const body = tok.rows.slice();
  let foot = null;
  const last = body[body.length - 1];
  if (last && /^\*\*\s*total\s*\*\*$/i.test(last[0].text.trim())) foot = body.pop();
  const numeric = tok.header.map((_, c) => {
    if (c === 0) return false;
    const vals = body.map((r) => isNumericCell(r[c]?.text || '')).filter((v) => v !== null);
    return vals.length > 0 && vals.filter(Boolean).length / vals.length >= 0.75;
  });
  const cell = (tag, c, text, extra = '') => {
    const cls = numeric[c] ? ' class="num"' : '';
    return `<${tag}${cls}${extra}>${marked.parseInline(text)}</${tag}>`;
  };
  let h = `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}${idx > 1 ? `, table ${idx}` : ', table'}">`;
  h += `<table class="${cols >= 3 ? 'table--wide' : 'table--narrow'}">`;
  h += '<thead><tr>' + tok.header.map((c, i) => cell('th', i, c.text, ' scope="col"')).join('') + '</tr></thead>';
  h += '<tbody>' + body.map((r) => '<tr>' + r.map((c, i) => cell('td', i, c.text)).join('') + '</tr>').join('') + '</tbody>';
  if (foot) h += '<tfoot><tr>' + foot.map((c, i) => cell('td', i, c.text)).join('') + '</tr></tfoot>';
  h += '</table></div>';
  return h;
}

function renderTokens(list) {
  return marked.parser(list);
}

/* Home-only components ------------------------------------------------ */

function scoresFromTable(tok) {
  return tok.rows.map((r) => ({ category: plain(marked.parseInline(r[0].text)), score: parseInt(r[1].text, 10), why: r[2]?.text || '' }));
}

function renderScores(scores) {
  const li = scores.map((s) => {
    const n = Math.max(0, Math.min(10, Math.round(+s.score || 0)));
    const slots = Array.from({ length: 10 }, (_, i) => `<span class="slot${i < n ? ' is-full' : ''}"></span>`).join('');
    return `<li class="score${n <= 4 ? ' is-low' : ''}">` +
      `<span class="score-name">${esc(s.category)}</span>` +
      `<span class="score-slots" role="img" aria-label="${n} out of 10">${slots}</span>` +
      `<span class="score-n" aria-hidden="true">${n}<small>/10</small></span>` +
      `<p class="score-why">${marked.parseInline(String(s.why || ''))}</p></li>`;
  }).join('');
  return `<ol class="scores">${li}</ol>`;
}

function tipsFromList(tok, names) {
  return tok.items.map((it) => {
    const see = /\s*\(see (?:\[([^\]]+)\]\([^)]*\)|([^)]+))\)\.?\s*$/;
    const m = see.exec(it.text);
    const slug = m ? names[m[1] || m[2]] : null;
    return { text: it.text.replace(see, '.'), slug: slug || 'index' };
  });
}

function renderTipWall(tips, bySlug) {
  const li = tips.map((t, i) => {
    const s = bySlug[normSlug(t.slug)];
    const text = String(t.text).replace(/\s*\(see [^)]*\)\.?\s*$/, '.');
    const where = s ? `Aisle ${s.n}, ${esc(s.title)}` : '';
    const inner = `<span class="sticker-badge" lang="ko" aria-hidden="true">꿀팁</span>` +
      `<span class="sticker-body"><span class="sticker-text">${marked.parseInline(text)}</span>` +
      (where ? `<span class="sticker-where">${where}</span>` : '') + '</span>';
    return s ? `<li><a class="sticker" href="${href(s.slug)}">${inner}</a></li>` : `<li><p class="sticker">${inner}</p></li>`;
  }).join('');
  return `<ul class="sticker-wall">${li}</ul>`;
}

/* Section body ------------------------------------------------------- */

function buildBody(section, ctx) {
  const raw = readDraft(section.file);
  const { text: stripped, found } = stripMarkers(raw, section.file);
  for (const f of found) console.log(`  marker ${section.file}:${f.line} ${f.text}`);
  ctx.markers.push(...found.map((f) => ({ file: section.file, ...f })));

  // headings first, so internal "see X below" references can resolve
  const used = new Set(['main', 'top', 'aisle-panel', 'directory', 'sign', 'key-figures']);
  const headings = [];
  for (const m of stripped.matchAll(/^###\s+(.+)$/gm)) {
    let id = slugify(marked.parseInline(m[1]));
    let k = 2;
    while (used.has(id)) id = `${slugify(m[1])}-${k++}`;
    used.add(id);
    headings.push({ text: plain(marked.parseInline(m[1])), id });
  }

  let md = linkCrossRefs(stripped, section.slug, ctx.names, headings, section.file, ctx.xrefs);
  md = isolatePlaceholders(md);

  const tokens = marked.lexer(md);
  const isHome = section.slug === 'index';
  const subTag = isHome ? 'h3' : 'h2';
  let html = '';
  let headingIdx = 0, current = section.title, tablesUnder = 0, pendingChecklist = null, droppedTitle = false;
  let description = '';
  const toc = [];

  for (const tok of tokens) {
    if (tok.type === 'space') continue;

    if (tok.type === 'heading') {
      if (tok.depth <= 2 && !droppedTitle) { droppedTitle = true; continue; } // the sign shows the title
      if (tok.depth === 3) {
        const h = headings[headingIdx++] || { id: slugify(tok.text), text: plain(marked.parseInline(tok.text)) };
        current = h.text; tablesUnder = 0;
        toc.push(h);
        html += `<${subTag} class="sub" id="${h.id}">${marked.parseInline(tok.text)}</${subTag}>\n`;
      } else {
        const lvl = Math.min(6, tok.depth + (isHome ? 0 : -1));
        html += `<h${lvl} class="minor">${marked.parseInline(tok.text)}</h${lvl}>\n`;
      }
      continue;
    }

    if (tok.type === 'html') {
      const m = /<!--(tool|checklist):([\w-]+)-->/.exec(tok.raw);
      if (m && m[1] === 'tool') { html += `<div class="tool" data-tool="${m[2]}"></div>\n`; ctx.tools.push(`${section.file}: tool ${m[2]}`); continue; }
      if (m && m[1] === 'checklist') { pendingChecklist = m[2]; continue; }
      if (/^\s*<!--[\s\S]*-->\s*$/.test(tok.raw)) continue; // other comments stay out of the page
      html += tok.raw;
      continue;
    }

    if (pendingChecklist && tok.type !== 'list') {
      warn(`${section.file}: checklist:${pendingChecklist} is not followed by a list, ignored`);
      pendingChecklist = null;
    }

    if (tok.type === 'table') {
      tablesUnder++;
      if (isHome && /^my scores$/i.test(current)) {
        const scores = ctx.home.scores?.length ? ctx.home.scores : scoresFromTable(tok);
        html += renderScores(scores) + '\n';
        continue;
      }
      html += renderTable(tok, current, tablesUnder) + '\n';
      continue;
    }

    if (tok.type === 'list') {
      if (isHome && /^top tips$/i.test(current)) {
        const tips = ctx.home.tips?.length ? ctx.home.tips : tipsFromList(tok, ctx.names);
        html += renderTipWall(tips, ctx.bySlug) + '\n';
        continue;
      }
      let out = renderTokens([tok]);
      if (pendingChecklist) {
        out = out.replace(/^<(ul|ol)/, `<$1 data-checklist="${pendingChecklist}"`);
        ctx.tools.push(`${section.file}: checklist ${pendingChecklist}`);
        pendingChecklist = null;
      }
      html += out;
      continue;
    }

    if (tok.type === 'paragraph' && !description) description = plain(marked.parseInline(tok.text));
    html += renderTokens([tok]);
  }
  if (pendingChecklist) warn(`${section.file}: checklist:${pendingChecklist} at the end of the file, ignored`);

  return { html, toc, description };
}

function metaDescription(text, fallback) {
  const src = (text || fallback || '').replace(/\s+/g, ' ').trim();
  if (src.length <= 160) return src;
  const sentences = src.match(/[^.!?]+[.!?]+(\s|$)/g) || [src];
  let out = '';
  for (const s of sentences) { if ((out + s).trim().length > 160) break; out += s; }
  out = out.trim();
  if (out.length >= 60) return out;
  const cut = src.slice(0, 157);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '...';
}

/* ------------------------------------------------------------------ */
/* Components                                                           */
/* ------------------------------------------------------------------ */

const UNIT = { DKK: 'kr', KRW: 'won', USD: 'USD', '%': '%', ECTS: 'ECTS', days: 'days', hours: 'hours' };
const UNIT_SR = { DKK: 'Danish kroner', KRW: 'Korean won', USD: 'US dollars', '%': 'percent', ECTS: 'ECTS points', days: 'days', hours: 'hours' };

function tagHTML(f) {
  const amount = +f.amount;
  const unit = f.unit || '';
  let u = UNIT[unit] ?? unit;
  if (amount === 1 && (unit === 'days' || unit === 'hours')) u = u.replace(/s$/, '');
  const about = f.prefix === 'about' ? '<span class="tag-about">about</span>' : '';
  let alt = '';
  if (unit === 'DKK') alt = `about ${fmtWon(amount * RATE)} won`;
  else if (unit === 'KRW') alt = `about ${fmtKr(amount / RATE)} kr`;
  const src = f.source === 'memory' ? 'memory' : 'records';
  const srcText = src === 'memory' ? '<span class="sr-only">From </span>Memory' : '<span class="sr-only">From </span>Records';
  return `<li class="tag" data-source="${src}">` +
    `<span class="tag-label">${esc(f.label)}</span>` +
    `<span class="tag-price">${about}<span class="tag-n">${fmt(amount)}</span><span class="tag-u">${esc(u)}</span>` +
    `<span class="sr-only"> (${esc(UNIT_SR[unit] || unit)})</span></span>` +
    (alt ? `<span class="tag-alt">${alt}</span>` : '') +
    (f.note ? `<span class="tag-note">${esc(f.note)}</span>` : '') +
    `<span class="tag-src">${src === 'memory' ? ICON.pencil : ICON.barcode}<span>${srcText}${f.year ? `, ${esc(f.year)}` : ''}</span></span>` +
    '</li>';
}

function shelfHTML(s) {
  if (!s.keyFigures.length) return '';
  const figs = s.keyFigures.slice(0, 5);
  const hasMoney = figs.some((f) => f.unit === 'DKK' || f.unit === 'KRW');
  return `<section class="shelf" aria-labelledby="kf-${s.slug}">` +
    `<h2 class="sr-only" id="kf-${s.slug}">Key figures</h2>` +
    `<ul class="shelf-tags" role="list" tabindex="0" aria-label="Key figures, ${figs.length} tags">${figs.map(tagHTML).join('')}</ul>` +
    `<p class="shelf-key"><span>${ICON.barcode} from my records</span><span>${ICON.pencil} from memory</span>` +
    (hasMoney ? '<span>Converted at about 215 won to 1 krone (2025)</span>' : '') + '</p>' +
    '</section>';
}

function tipHref(h, current) {
  if (!h) return '';
  const [slugPart, anchor] = String(h).split('#');
  const slug = normSlug(slugPart || current);
  if (slug === current) return anchor ? `#${anchor}` : '';
  return href(slug) + (anchor ? `#${anchor}` : '');
}

function stickerHTML(s) {
  if (!s.tip || !s.tip.text) return '';
  const link = tipHref(s.tip.href, s.slug);
  const inner = `<span class="sticker-badge" lang="ko" aria-hidden="true">꿀팁</span>` +
    `<span class="sticker-body"><span class="sticker-text"><span class="sr-only">Honey tip: </span>${marked.parseInline(String(s.tip.text))}</span></span>`;
  return `<div class="sticker-slot">${link ? `<a class="sticker" href="${esc(link)}">${inner}</a>` : `<p class="sticker">${inner}</p>`}</div>`;
}

function signHTML(s, level) {
  const meta = [
    `<span><i lang="ko-Latn">${esc(s.rom)}</i>, “${esc(s.meaning)}”</span>`,
    `<span>${s.minutes} min read</span>`,
    s.window ? `<span>Most useful ${esc(s.window)}</span>` : '',
  ].filter(Boolean).join('');
  return `<header class="sign" id="sign">` +
    `<h${level} class="sign-title" id="sign-title">` +
    `<span class="sign-no"><span class="sr-only">Aisle </span>${pad2(s.n)}</span>` +
    `<span class="sign-ko" lang="ko">${esc(s.ko)}</span>` +
    `<span class="sign-en">${esc(s.title)}</span>` +
    `</h${level}>` +
    `<p class="sign-meta">${meta}</p>` +
    '</header>';
}

function railHTML(sections, current, toc) {
  const items = sections.map((s) => {
    const isCur = s.slug === current;
    const link = isCur ? '#sign' : href(s.slug);
    const subs = isCur && toc.length
      ? `<ol class="rail-subs">${toc.map((h) => `<li><a href="#${h.id}" data-sub="${h.id}">${esc(h.text)}</a></li>`).join('')}</ol>`
      : '';
    return `<li class="rail-item" data-slug="${s.slug}">` +
      `<a class="rail-link" href="${link}"${isCur ? ' aria-current="page"' : ''}>` +
      `<span class="rail-no">${pad2(s.n)}</span><span class="rail-ko" lang="ko">${esc(s.ko)}</span><span class="rail-en">${esc(s.title)}</span></a>` +
      subs + '</li>';
  }).join('');
  return `<nav class="rail" id="aisle-panel" aria-label="Aisles">` +
    `<div class="rail-head"><span class="fascia" aria-hidden="true"></span>` +
    `<div class="rail-head-row"><p class="rail-title"><span lang="ko">안내도</span> Aisles</p>` +
    `<a class="rail-close" href="#main" aria-label="Close the aisle directory">${ICON.close}<span>Close</span></a></div></div>` +
    `<p class="rail-label"><span lang="ko" aria-hidden="true">안내도</span> Aisles</p>` +
    `<ol class="rail-list">${items}</ol>` +
    `<div class="rail-tool"><div class="tool tool--compact" data-tool="converter"></div></div>` +
    '</nav>';
}

function aisleNavHTML(sections, s) {
  const prev = sections.find((x) => x.n === s.n - 1);
  const next = sections.find((x) => x.n === s.n + 1);
  const plate = (x, dir) => `<a class="aisle-nav-link is-${dir}" href="${href(x.slug)}" rel="${dir}">` +
    `<span class="aisle-nav-dir">${dir === 'prev' ? ICON.prev + 'Previous aisle' : 'Next aisle' + ICON.next}</span>` +
    `<span class="aisle-nav-sign"><span class="aisle-nav-no">${pad2(x.n)}</span>` +
    `<span class="aisle-nav-ko" lang="ko">${esc(x.ko)}</span><span class="aisle-nav-en">${esc(x.title)}</span></span></a>`;
  const home = `<a class="aisle-nav-link is-next" href="index.html#directory">` +
    `<span class="aisle-nav-dir">Back to the directory${ICON.up}</span>` +
    `<span class="aisle-nav-sign"><span class="aisle-nav-ko" lang="ko">안내도</span><span class="aisle-nav-en">All 11 aisles</span></span></a>`;
  return `<nav class="aisle-nav" aria-label="Previous and next aisle">` +
    (prev ? plate(prev, 'prev') : '<span class="aisle-nav-gap"></span>') +
    (next ? plate(next, 'next') : home) +
    '</nav>';
}

function directoryHTML(sections) {
  const max = Math.max(...sections.map((s) => +s.words || 1));
  const items = sections.map((s) => {
    const len = Math.max(0.05, (+s.words || 0) / max).toFixed(3);
    const link = s.slug === 'index' ? '#sign' : href(s.slug);
    return `<li class="aisle" data-slug="${s.slug}" style="--len:${len}">` +
      `<a class="aisle-sign" href="${link}">` +
      `<span class="aisle-no">${pad2(s.n)}</span>` +
      `<span class="aisle-ko" lang="ko">${esc(s.ko)}</span>` +
      `<span class="aisle-en">${esc(s.title)}</span>` +
      `<span class="aisle-min">${s.minutes} min<span class="sr-only">, ${nf(0).format(s.words)} words</span></span>` +
      '</a></li>';
  }).join('');
  return `<section class="directory" id="directory" aria-labelledby="directory-h">` +
    `<div class="directory-head"><h2 class="directory-h" id="directory-h"><span lang="ko">안내도</span> Aisle directory</h2>` +
    `<p class="directory-note">Each sign hangs as long as its section. Walk in at the one for where you are now.</p></div>` +
    `<ol class="aisles">${items}</ol>` +
    '</section>';
}

/* ------------------------------------------------------------------ */
/* Page template                                                        */
/* ------------------------------------------------------------------ */

const CONTRACT = `<!--
THESIS: one exchange, shelved like the convenience store that fed it; refuses the travel-blog hero and card grid.
OWN-WORLD: fluorescent white, near-black ink, a three-stripe fascia (blue, teal, berry), yellow shelf tags for key amounts, berry 꿀팁 stickers for tips, a thermal receipt for the budget, Hangul-led aisle signs in Bagel Fat One over Pretendard.
STORY: a DTU student sees the whole journey as 11 aisles sized by length, walks into the one for their stage, gets the key numbers and one tip at the door, then reads Elias's honest account.
FIRST VIEWPORT: wordmark and fascia; a two-line headline and two sentences of intro; the 11 hanging aisle signs as the primary navigation, with a RESERVED tag on the last aisle opened.
FORM: convenience store, candidate 4 of 7, seed 4528fd65, simplified at Elias's request.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`;

const FONTS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>',
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..100,500..900&amp;family=Bagel+Fat+One&amp;family=Nanum+Gothic+Coding:wght@400;700&amp;display=swap">',
].join('\n');

// Classic deferred scripts, in this order. Deferred scripts run in order after parsing,
// like modules, but they also work when a page is opened straight from disk (file://).
const SCRIPTS = ['nav', 'progress', 'converter', 'budget', 'checklist']
  .map((m) => `<script defer src="js/${m}.js"></script>`).join('\n');

// Pages with the budget tool carry its seed inline, so the receipt prints without a fetch
// (patchy mobile data, file://). data/budget.json is still copied for anything else.
function inlineData(body) {
  if (!/data-tool="budget"/.test(body)) return '';
  const p = join(DATA, 'budget.json');
  if (!existsSync(p)) return '';
  const json = JSON.stringify(JSON.parse(readFileSync(p, 'utf8'))).replace(/</g, '\\u003c');
  return `<script type="application/json" id="budget-data">${json}</script>\n`;
}

function page({ slug, n, title, description, body }) {
  description = smartQuotes(String(description || ''));
  const fullTitle = slug === 'index' ? `${SITE}: one DTU student's fall 2025 at KAIST` : `${title} | ${SITE}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:locale" content="en_GB">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
${FONTS}
<link rel="stylesheet" href="css/site.css">
<link rel="stylesheet" href="css/tools.css">
</head>
<body id="top" data-slug="${slug}" data-n="${n}" data-title="${esc(title)}">
${CONTRACT}
<a class="skip" href="#main">Skip to the guide</a>
<header class="top">
  <div class="fascia" aria-hidden="true"></div>
  <div class="bar">
    <a class="wordmark" href="index.html"${slug === 'index' ? ' aria-current="page"' : ''}><span class="wordmark-ko" lang="ko">카이스트 교환</span><span class="wordmark-en">KAIST exchange guide</span></a>
    <a class="aisles-btn" href="#aisle-panel" aria-controls="aisle-panel">${ICON.aisles}<span>Aisles</span></a>
  </div>
</header>
${body}
<footer class="foot">
  <div class="foot-inner">
    <p>Written by Elias, a DTU student in AI and Data, about his fall 2025 exchange. Not an official DTU or KAIST page. Facts are from fall 2025 unless marked; check official pages for your year.</p>
    <a class="to-top" href="#top">${ICON.up}<span>Back to top</span></a>
  </div>
</footer>
${inlineData(body)}${SCRIPTS}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */

function build() {
  const t0 = Date.now();
  console.log('KAIST guide build');
  const sections = loadSections();
  const home = loadHome(sections);
  const bySlug = Object.fromEntries(sections.map((s) => [s.slug, s]));
  const names = Object.fromEntries(sections.map((s) => [s.title, s.slug]));
  for (const [k, v] of Object.entries(ALIASES)) if (!names[k]) names[k] = v;
  const ctx = { names, bySlug, home, markers: [], xrefs: [], tools: [] };

  if (existsSync(OUT)) {
    for (const name of readdirSync(OUT)) rmSync(join(OUT, name), { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });

  for (const s of sections) {
    const { html, toc, description } = buildBody(s, ctx);
    const level = s.slug === 'index' ? 2 : 1;
    const article = signHTML(s, level) + shelfHTML(s) + stickerHTML(s) +
      `<div class="prose">\n${html}</div>\n` + aisleNavHTML(sections, s);
    let body;
    if (s.slug === 'index') {
      const intro = String(home.intro || '');
      body = `<main id="main">
<section class="hero" aria-labelledby="hero-h">
  <h1 id="hero-h">${marked.parseInline(String(home.headline || s.title))}</h1>
  <p class="hero-intro">${marked.parseInline(intro)}</p>
  <p class="continue" data-continue hidden></p>
</section>
${directoryHTML(sections)}
<div class="frame frame--home">
${railHTML(sections, s.slug, toc)}
<article class="page" aria-labelledby="sign-title">
${article}
</article>
</div>
</main>`;
      s._description = metaDescription(intro, description);
    } else {
      body = `<div class="frame">
${railHTML(sections, s.slug, toc)}
<main id="main" class="page">
${article}
</main>
</div>`;
      s._description = metaDescription(description, `${s.title}: part of a DTU student's guide to an exchange at KAIST.`);
    }
    const out = page({ slug: s.slug, n: s.n, title: s.title, description: s._description, body: smartQuotes(body) });
    writeFileSync(join(OUT, href(s.slug)), out);
    console.log(`  page   ${href(s.slug).padEnd(26)} ${String(toc.length).padStart(2)} parts, ${s.keyFigures.length} tags${s.tip ? ', 1 tip' : ''}`);
  }

  // assets
  writeFileSync(join(OUT, 'favicon.svg'), FAVICON);
  writeFileSync(join(OUT, '.nojekyll'), '');
  const nCss = copyDir(join(SRC, 'css'), join(OUT, 'css'), (f) => f.endsWith('.css'));
  const nJs = copyDir(join(SRC, 'js'), join(OUT, 'js'), (f) => f.endsWith('.js'));
  const nData = copyDir(DATA, join(OUT, 'data'), (f) => f.endsWith('.json'));
  for (const f of ['css/site.css', 'css/tools.css', 'js/nav.js', 'js/progress.js', 'js/converter.js', 'js/budget.js', 'js/checklist.js']) {
    if (!existsSync(join(SRC, f))) warn(`site-src/${f} does not exist yet (linked from every page)`);
  }

  console.log(`  assets ${nCss} css, ${nJs} js, ${nData} data files, favicon.svg, .nojekyll`);
  console.log(`  links  ${ctx.xrefs.length} cross-references linked`);
  if (process.argv.includes('--verbose')) ctx.xrefs.forEach((x) => console.log('         ' + x));
  console.log(`  hooks  ${ctx.tools.length ? ctx.tools.join('; ') : 'no tool or checklist placeholders found'}`);
  console.log(`  marks  ${ctx.markers.length} [ASK/CHECK/TODO] markers stripped`);
  console.log(`Done in ${Date.now() - t0} ms, ${sections.length} pages in ${OUT}${warnings.length ? `, ${warnings.length} warnings` : ''}`);
}

try {
  build();
} catch (e) {
  console.error('Build failed: ' + (e && e.stack || e));
  process.exit(1);
}
