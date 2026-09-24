// KAIST guide: checks over the built site in docs/.
// Usage: node site-src/check.mjs            static checks (pages, links, anchors, ids, text, privacy)
//        node site-src/check.mjs --browser  also opens every page in headless Edge at 390 and 1440 wide
//                                           (sideways scroll, console errors, tools rendered)
// Exit code 1 when any check fails. Privacy hits are failures; grade mentions are listed for a human.

import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const SRC = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(SRC, '..', 'docs');
const PAGES = ['index', 'applying', 'money', 'before-you-fly', 'arrival', 'academics', 'campus-life',
  'food-and-nights-out', 'people', 'travel', 'leaving'].map((s) => `${s}.html`);

// Privacy patterns live in a local file that is never committed (../private/privacy-patterns.json:
// { "block": ["regex", ...], "allow": ["regex", ...] }, case-insensitive). The list itself names
// what must stay private, so it cannot ship in a public repo.
const PRIVACY_FILE = resolve(SRC, '..', 'private', 'privacy-patterns.json');
let PRIVACY = [], PRIVACY_OK = [];
if (existsSync(PRIVACY_FILE)) {
  const p = JSON.parse(readFileSync(PRIVACY_FILE, 'utf8'));
  PRIVACY = (p.block || []).map((s) => new RegExp(s, 'i'));
  PRIVACY_OK = (p.allow || []).map((s) => new RegExp(s, 'i'));
} else {
  console.warn(`privacy: ${PRIVACY_FILE} not found, privacy check skipped`);
}
// Grade talk about him, for a human to read (not a failure by itself).
const GRADES = /\bGPA\b|\bgrades?\b|\bgraded\b|\b[ABCDF][+-]?(?= (?:in|on|grade|for)\b)|\bscored\b|\bmy (?:score|result|mark)s?\b|\bpassed all five\b/gi;

const fails = [];
const notes = [];
const fail = (area, msg) => fails.push(`${area.padEnd(8)} ${msg}`);

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const rel = (p) => p.slice(DOCS.length + 1).replace(/\\/g, '/');

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
// what a reader can see or hear: text nodes plus alt/title/aria-label/content attributes
function readerText(html) {
  const attrs = [...html.matchAll(/\s(?:alt|title|aria-label|content|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  const text = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decode(text + ' ' + attrs.join(' ')).replace(/\s+/g, ' ');
}
const around = (s, i, n = 60) => s.slice(Math.max(0, i - n), i + n).replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ */

if (!existsSync(DOCS)) { console.error(`no docs/ at ${DOCS}; run the build first`); process.exit(1); }

// 1. pages and assets
for (const p of PAGES) if (!existsSync(join(DOCS, p))) fail('pages', `missing ${p}`);
for (const a of ['.nojekyll', 'favicon.svg', 'css/site.css', 'css/tools.css', 'js/nav.js', 'js/progress.js',
  'js/converter.js', 'js/budget.js', 'js/checklist.js', 'data/sections.json', 'data/home.json', 'data/budget.json']) {
  if (!existsSync(join(DOCS, a))) fail('assets', `missing ${a}`);
}

const files = walk(DOCS);
const html = Object.fromEntries(files.filter((f) => f.endsWith('.html')).map((f) => [rel(f), readFileSync(f, 'utf8')]));
const ids = {};
for (const [name, src] of Object.entries(html)) {
  const list = [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ids[name] = new Set(list);
  const seen = new Set();
  for (const id of list) { if (seen.has(id)) fail('ids', `${name}: duplicate id "${id}"`); seen.add(id); }
}

// 2. links, anchors and id references
let nLinks = 0, nExternal = 0;
for (const [name, src] of Object.entries(html)) {
  for (const m of src.matchAll(/\s(href|src)="([^"]*)"/g)) {
    const url = decode(m[2]);
    if (/^(https?:|mailto:|tel:|data:)/i.test(url)) { nExternal++; continue; }
    nLinks++;
    if (!url) { fail('links', `${name}: empty ${m[1]}`); continue; }
    const [pathPart, hash] = url.split('#');
    const target = pathPart ? rel(resolve(DOCS, dirname(name), pathPart.split('?')[0])) : name;
    if (!existsSync(join(DOCS, target))) { fail('links', `${name}: ${url} (no file ${target})`); continue; }
    if (hash !== undefined) {
      if (!hash) { if (pathPart) continue; fail('links', `${name}: bare "#"`); continue; }
      const t = ids[target];
      if (!t) { fail('links', `${name}: ${url} (anchor into a non-page)`); continue; }
      if (!t.has(decodeURIComponent(hash))) fail('anchors', `${name}: ${url} (no id "${hash}" in ${target})`);
    }
  }
  for (const m of src.matchAll(/\s(aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g)) {
    for (const id of m[2].split(/\s+/)) if (!ids[name].has(id)) fail('ids', `${name}: ${m[1]} points at missing id "${id}"`);
  }
}

// 3. text rules over the pages
for (const [name, src] of Object.entries(html)) {
  const t = readerText(src);
  for (const m of t.matchAll(/\[(ASK|CHECK|TODO)\b|\b(TODO|FIXME|lorem ipsum)\b/gi)) fail('markers', `${name}: "${around(t, m.index)}"`);
  for (const m of src.matchAll(/[\u2014\u2013]/g)) fail('dashes', `${name}: ${m[0] === '\u2014' ? 'em' : 'en'} dash near "${around(src, m.index, 40)}"`);
}
// dashes and markers in the text the scripts and data put on screen
for (const f of files.filter((x) => /\.(js|json)$/.test(x))) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/[\u2014\u2013]/g)) fail('dashes', `${rel(f)}: dash near "${around(s, m.index, 40)}"`);
  for (const m of s.matchAll(/\[(ASK|CHECK|TODO):/g)) fail('markers', `${rel(f)}: "${around(s, m.index)}"`);
}

// 4. privacy over everything that ships
for (const f of files.filter((x) => /\.(html|js|json|css|svg|txt|md)$/.test(x))) {
  const raw = readFileSync(f, 'utf8');
  const s = f.endsWith('.html') ? readerText(raw) + ' ' + raw.replace(/<[^>]+>/g, ' ') : raw;
  const hits = new Set();
  for (const re of PRIVACY) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of s.matchAll(g)) {
      const ctx = around(s, m.index, 50);
      if (PRIVACY_OK.some((ok) => ok.test(s.slice(Math.max(0, m.index - 20), m.index + 20)))) {
        notes.push(`allowed  ${rel(f)}: ${m[0]}: "${ctx}"`); continue;
      }
      hits.add(`${m[0]}: "${ctx}"`);
    }
  }
  for (const h of hits) fail('privacy', `${rel(f)}: ${h}`);
}
// grade talk: listed for review
for (const [name, src] of Object.entries(html)) {
  const t = readerText(src);
  const seen = new Set();
  for (const m of t.matchAll(GRADES)) {
    // only first-person sentences: grades as a topic are fine, his own results are not
    const start = Math.max(t.lastIndexOf('. ', m.index) + 2, m.index - 160);
    const end = t.indexOf('. ', m.index); const sentence = t.slice(start, end < 0 ? m.index + 160 : end + 1).trim();
    if (!/\b(I|I’d|I’m|my|me)\b/.test(sentence) || seen.has(sentence)) continue;
    seen.add(sentence);
    notes.push(`grades   ${name}: "${sentence}"`);
  }
}

/* ------------------------------------------------------------------ */
/* 5. browser checks (optional)                                         */
/* ------------------------------------------------------------------ */

async function browserChecks() {
  const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
  if (!EDGE) { fail('browser', 'Edge not found, skipped'); return; }
  const PORT = 9800 + Math.floor(Math.random() * 150);
  const profile = mkdtempSync(join(tmpdir(), 'kaist-check-'));
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let wsUrl;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(250);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

  const probe = `JSON.stringify((() => {
    const d = document.documentElement;
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= d.clientWidth + 1) return false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return false;
      }
      return getComputedStyle(el).position !== 'fixed';
    }).slice(0, 4).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' ' + Math.round(el.getBoundingClientRect().right));
    const tool = (sel) => { const el = document.querySelector(sel); return el ? el.children.length > 0 : null; };
    return { sw: d.scrollWidth, cw: d.clientWidth, wide,
      compact: tool('.rail-tool .tool--compact'), converter: tool('.prose .tool[data-tool="converter"]'),
      budget: tool('.tool[data-tool="budget"]'), receipt: !!document.querySelector('.rc'),
      checklists: [...document.querySelectorAll('ul[data-checklist]')].map((u) => u.querySelectorAll('input[type=checkbox]').length) };
  })())`;

  for (const v of [{ tag: '390', width: 390, height: 844, dpr: 2, mobile: true }, { tag: '1440', width: 1440, height: 900, dpr: 1, mobile: false }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile });
    for (const p of PAGES) {
      errors.length = 0;
      await send('Page.navigate', { url: pathToFileURL(join(DOCS, p)).href });
      await sleep(1600);
      const r = JSON.parse((await send('Runtime.evaluate', { expression: probe, returnByValue: true })).result.result.value);
      if (r.sw > r.cw) fail('scroll', `${p} @${v.tag}: page scrolls sideways (${r.sw} > ${r.cw}) ${r.wide.join(', ')}`);
      for (const e of errors.filter((e) => !/fonts\.(googleapis|gstatic)|cdn\.jsdelivr|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(e || ''))) fail('console', `${p} @${v.tag}: ${e}`);
      if (r.compact === false) fail('tools', `${p} @${v.tag}: compact converter in the rail did not render`);
      if (r.converter === false) fail('tools', `${p} @${v.tag}: inline converter did not render`);
      if (r.budget === false || (r.budget && !r.receipt)) fail('tools', `${p} @${v.tag}: budget receipt did not render`);
      r.checklists.forEach((n, i) => { if (!n) fail('tools', `${p} @${v.tag}: checklist ${i + 1} has no tick boxes`); });
      if (v.tag === '390') notes.push(`browser  ${p}: ${r.sw}/${r.cw}px, ${r.checklists.length} checklists${r.budget ? ', receipt' : ''}${r.converter ? ', converter' : ''}`);
    }
  }
  ws.close(); edge.kill();
}

if (process.argv.includes('--browser')) await browserChecks();

/* ------------------------------------------------------------------ */

console.log(`KAIST guide checks: ${Object.keys(html).length} pages, ${nLinks} internal links and assets, ${nExternal} external`);
if (process.argv.includes('--verbose') || notes.length) for (const n of notes) console.log('  ' + n);
if (fails.length) {
  console.log(`\n${fails.length} failed:`);
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
console.log('All checks passed.');
