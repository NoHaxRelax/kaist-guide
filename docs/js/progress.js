// "Where you stopped": remembers the last aisle and subheading a reader had
// open, and hangs a 예약 RESERVED tag on it in the home directory and the rail.
// Uses localStorage when it can; the site works the same without it.
// Runs as a classic deferred script (works over file:// too); wrapped so nothing leaks into the global scope.
(function () {
'use strict';

const KEY = 'kaist-guide:progress:v1';

const store = {
  get() {
    try { const v = window.localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  },
  set(v) {
    try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode or blocked: fine */ }
  },
};

const pageHref = (slug) => (slug === 'index' ? 'index.html' : `${slug}.html`);
const safeSlug = (s) => String(s || '').replace(/[^a-z0-9-]/g, '');
const safeId = (s) => String(s || '').replace(/[^a-z0-9-]/g, '');

function reservedTag(srText) {
  const tag = document.createElement('span');
  tag.className = 'reserved';
  const ko = document.createElement('span');
  ko.className = 'reserved-ko';
  ko.lang = 'ko';
  ko.setAttribute('aria-hidden', 'true');
  ko.textContent = '예약';
  const en = document.createElement('span');
  en.setAttribute('aria-hidden', 'true');
  en.textContent = 'Reserved';
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = srText;
  tag.append(ko, en, sr);
  return tag;
}

function arrow() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M1 7h17M12.5 1.5L18 7l-5.5 5.5');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

function showReserved(prev, current) {
  const slug = safeSlug(prev.slug);
  if (!slug) return;
  const where = prev.heading ? `${prev.title}, ${prev.heading}` : prev.title;

  // home directory
  const sign = document.querySelector(`.aisle[data-slug="${slug}"] .aisle-sign`);
  if (sign) sign.append(reservedTag(`, you stopped here last time${prev.heading ? `, at ${prev.heading}` : ''}`));

  // rail: on the aisle, or on the subheading when it is this page
  const item = document.querySelector(`.rail-item[data-slug="${slug}"]`);
  if (item) {
    const sub = slug === current && prev.id ? item.querySelector(`.rail-subs a[data-sub="${safeId(prev.id)}"]`) : null;
    (sub || item).append(reservedTag(sub ? ', you stopped here last time' : `, you stopped here last time${prev.heading ? `, at ${prev.heading}` : ''}`));
  }

  // "Continue where you stopped" on the home page
  const cont = document.querySelector('[data-continue]');
  if (cont && !(slug === current && !prev.id)) {
    const a = document.createElement('a');
    a.href = (slug === current ? '' : pageHref(slug)) + (prev.id ? `#${safeId(prev.id)}` : '');
    const label = document.createElement('span');
    label.textContent = 'Continue where you stopped';
    const w = document.createElement('span');
    w.className = 'continue-where';
    w.textContent = `(${where})`;
    a.append(arrow(), label, w);
    cont.replaceChildren(a);
    cont.hidden = false;
  }
}

function track(prev, current) {
  const body = document.body;
  const n = Number(body.dataset.n) || 0;
  const title = body.dataset.title || '';
  const isHome = current === 'index';
  const sign = document.getElementById('sign');
  const heads = Array.from(document.querySelectorAll('.prose .sub[id]'));
  let lastKey = null, ticking = false, scrolled = false;

  function inAisle() {
    // on the home page, reading only counts once you are past the directory
    if (!isHome) return true;
    return !!sign && sign.getBoundingClientRect().top <= window.innerHeight * 0.6;
  }

  function currentHeading() {
    const line = window.innerHeight * 0.3;
    let found = null;
    for (const h of heads) {
      if (h.getBoundingClientRect().top <= line) found = h; else break;
    }
    return found;
  }

  function save(force) {
    ticking = false;
    if (!inAisle()) return;
    const h = currentHeading();
    const key = `${current}#${h ? h.id : ''}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    store.set({
      slug: current, n, title,
      id: h ? h.id : '',
      heading: h ? h.textContent.trim() : '',
      y: Math.round(window.scrollY),
      t: Date.now(),
    });
  }

  // opening an aisle counts as having it open, but keep the old spot on a quick revisit
  if (!isHome && !(prev && prev.slug === current)) save(true);
  else if (prev && prev.slug === current) lastKey = `${current}#${prev.id || ''}`;

  window.addEventListener('scroll', () => {
    scrolled = true;
    if (!ticking) { ticking = true; requestAnimationFrame(() => save(false)); }
  }, { passive: true });
  window.addEventListener('pagehide', () => { if (scrolled) save(true); });
}

function start() {
  const current = document.body.dataset.slug;
  if (!current) return;
  const prev = store.get();
  if (prev && prev.slug && prev.title) showReserved(prev, current);
  track(prev, current);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
