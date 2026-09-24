/* KAIST exchange guide: tickable checklists.
   Hook: any <ul data-checklist="ID">. Each top-level <li> gets a native checkbox; ticks are
   saved per list ID in localStorage (wrapped; the list still works without it), keyed by each
   item's text so a later edit to one item does not shift the others. A "Clear ticks" button
   follows the list. */
(function () {
  'use strict';

  var PREFIX = 'kaist-guide:checklist:';
  var INLINE = /^(A|ABBR|B|BDI|BDO|BR|CITE|CODE|DATA|DFN|EM|I|KBD|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|WBR|IMG|SVG)$/;

  var store = {
    get: function (k) {
      try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (k, v) {
      try {
        if (v == null) window.localStorage.removeItem(k);
        else window.localStorage.setItem(k, JSON.stringify(v));
      } catch (e) { /* private mode or blocked: ticks last for this visit */ }
    }
  };

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list'; }

  function phrasingOnly(li) {
    for (var n = li.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && !INLINE.test(n.tagName)) return false;
    }
    return true;
  }

  var used = {};

  function build(ul) {
    if (ul.hasAttribute('data-ready')) return;
    ul.setAttribute('data-ready', '');
    var listId = ul.getAttribute('data-checklist') || 'list';
    var base = 'ck-' + slug(listId);
    if (used[base]) base += '-' + (++used[base]); else used[base] = 1;
    var key = PREFIX + listId;
    var saved = store.get(key);
    var done = {};
    if (saved && saved.v === 1 && Array.isArray(saved.done)) saved.done.forEach(function (k) { done[k] = true; });

    var items = Array.prototype.filter.call(ul.children, function (el) { return el.tagName === 'LI'; });
    var seen = {};
    var boxes = items.map(function (li, i) {
      var text = li.textContent.replace(/\s+/g, ' ').trim();
      var k = hash(text);
      if (seen[k]) k += '-' + i;
      seen[k] = true;

      var boxId = base + '-' + (i + 1);
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'ck-box';
      box.id = boxId;
      box.setAttribute('data-key', k);

      var label;
      if (phrasingOnly(li)) {
        label = document.createElement('label');
        label.htmlFor = boxId;
      } else {
        // Block content (paragraphs, nested lists) cannot sit in a <label>.
        label = document.createElement('div');
        label.id = boxId + '-text';
        box.setAttribute('aria-labelledby', label.id);
        label.addEventListener('click', function (e) {
          if (e.target.closest('a, button, input, select, textarea, summary, label')) return;
          box.click();
        });
      }
      label.className = 'ck-text';
      while (li.firstChild) label.appendChild(li.firstChild);
      li.appendChild(box);
      li.appendChild(label);
      li.classList.add('ck-item');

      box.checked = !!done[k];
      li.classList.toggle('is-done', box.checked);
      return box;
    });
    ul.classList.add('ck-list');

    var meta = document.createElement('p');
    meta.className = 'ck-meta';
    meta.innerHTML = '<span class="ck-count"></span><button type="button" class="tl-link ck-clear">Clear ticks</button>';
    ul.parentNode.insertBefore(meta, ul.nextSibling);
    var count = meta.querySelector('.ck-count');
    var clear = meta.querySelector('.ck-clear');

    function sync() {
      var ticked = boxes.filter(function (b) { return b.checked; });
      count.textContent = ticked.length + ' of ' + boxes.length + ' done';
      clear.hidden = ticked.length === 0;
      store.set(key, ticked.length ? { v: 1, done: ticked.map(function (b) { return b.getAttribute('data-key'); }) } : null);
    }

    ul.addEventListener('change', function (e) {
      var b = e.target;
      if (!b.classList || !b.classList.contains('ck-box')) return;
      b.parentNode.classList.toggle('is-done', b.checked);
      sync();
    });

    clear.addEventListener('click', function () {
      boxes.forEach(function (b) { b.checked = false; b.parentNode.classList.remove('is-done'); });
      sync();
      if (boxes[0]) boxes[0].focus(); // the button hides itself, so focus goes back to the list
    });

    sync();
  }

  function init(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('ul[data-checklist]'), build);
  }

  window.kaistTools = window.kaistTools || {};
  window.kaistTools.checklist = init;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})();
