// Aisle directory: the Aisles panel on phones, and the "you are here" marker
// for subheadings in the rail. Works without JavaScript too: the Aisles link
// opens the panel with :target, and every rail link is a plain link.
// Runs as a classic deferred script (works over file:// too); wrapped so nothing leaks into the global scope.
(function () {
'use strict';

const PANEL_QUERY = '(max-width: 1023.98px)';

function initPanel() {
  const panel = document.getElementById('aisle-panel');
  const opener = document.querySelector('.aisles-btn');
  if (!panel || !opener) return;
  const closer = panel.querySelector('.rail-close');
  const phone = window.matchMedia(PANEL_QUERY);
  // everything that is not the panel or one of its ancestors
  const outside = () => {
    const out = [];
    for (let node = panel; node && node !== document.body && node.parentElement; node = node.parentElement) {
      for (const sib of node.parentElement.children) {
        if (sib !== node && sib.tagName !== 'SCRIPT') out.push(sib);
      }
    }
    return out;
  };
  let lastFocus = null;

  // upgrade the no-JS links into buttons
  for (const el of [opener, closer]) {
    if (!el) continue;
    el.setAttribute('role', 'button');
    el.addEventListener('keydown', (e) => {
      if (e.key === ' ') { e.preventDefault(); el.click(); }
    });
  }
  opener.setAttribute('aria-expanded', 'false');

  const isOpen = () => panel.classList.contains('is-open');

  function focusables() {
    return Array.from(panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function open() {
    if (isOpen()) return;
    lastFocus = document.activeElement;
    panel.classList.add('is-open');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    opener.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('panel-open');
    // keep everything else out of reach while the panel covers the page
    for (const el of outside()) el.inert = true;
    // start at the current aisle, so its subheadings are in view
    const cur = panel.querySelector('.rail-link[aria-current="page"]');
    if (cur) panel.scrollTop = Math.max(0, cur.offsetTop - 96);
    (closer || focusables()[0] || panel).focus({ preventScroll: true });
  }

  function close(returnFocus = true) {
    if (!isOpen()) return;
    panel.classList.remove('is-open');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    opener.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('panel-open');
    for (const el of outside()) el.inert = false;
    if (returnFocus) (lastFocus && document.contains(lastFocus) ? lastFocus : opener).focus({ preventScroll: true });
  }

  opener.addEventListener('click', (e) => {
    if (!phone.matches) return; // the rail is already on screen
    e.preventDefault();
    isOpen() ? close() : open();
  });
  if (closer) closer.addEventListener('click', (e) => { e.preventDefault(); close(); });

  panel.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // a jump inside the page closes the panel and lands on the heading
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a === closer || !isOpen()) return;
    const url = new URL(a.href, location.href);
    if (url.pathname === location.pathname && url.hash) close(false);
  });

  const onChange = () => { if (!phone.matches) close(false); };
  phone.addEventListener ? phone.addEventListener('change', onChange) : phone.addListener(onChange);

  // arrived with #aisle-panel (the no-JS route)? open it properly
  if (location.hash === '#aisle-panel' && phone.matches) {
    history.replaceState(null, '', location.pathname + location.search);
    open();
  }
}

function initSubheadings() {
  const rail = document.getElementById('aisle-panel');
  if (!rail) return;
  const links = Array.from(rail.querySelectorAll('.rail-subs a[data-sub]'));
  if (!links.length) return;
  const heads = links.map((a) => document.getElementById(a.dataset.sub)).filter(Boolean);
  if (!heads.length) return;
  let current = null, ticking = false;

  function update() {
    ticking = false;
    const line = window.innerHeight * 0.3;
    let found = null;
    for (const h of heads) {
      if (h.getBoundingClientRect().top <= line) found = h; else break;
    }
    const id = found ? found.id : null;
    if (id === current) return;
    current = id;
    for (const a of links) {
      if (a.dataset.sub === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    // keep the marker visible inside the sticky rail without moving the page
    const active = links.find((a) => a.dataset.sub === id);
    if (active && !rail.classList.contains('is-open') && rail.scrollHeight > rail.clientHeight) {
      const r = active.getBoundingClientRect(), box = rail.getBoundingClientRect();
      if (r.top < box.top + 40) rail.scrollTop -= box.top + 40 - r.top;
      else if (r.bottom > box.bottom - 40) rail.scrollTop += r.bottom - (box.bottom - 40);
    }
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

function start() {
  initPanel();
  initSubheadings();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
