/* KAIST exchange guide: the budget calculator, printed as a thermal receipt (영수증).
   Hook: <div class="tool" data-tool="budget"></div> (optional data-src="./data/budget.json").
   Seeds from data/budget.json, or from an inline <script type="application/json" id="budget-data">.
   Inputs are saved in localStorage (wrapped; the tool works without it). The paper feeds once
   when the totals change, and not at all under prefers-reduced-motion. */
(function () {
  'use strict';

  var STORE_KEY = 'kaist-guide:budget:v1';
  var RATE_KEY = 'kaist-guide:rate:v1';
  var uid = 0;

  /* ---------- helpers ---------- */

  var store = {
    get: function (k) {
      try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode or blocked: fine */ }
    }
  };

  function readRate(fallback) {
    try {
      var v = parseFloat(window.localStorage.getItem(RATE_KEY));
      if (v >= 50 && v <= 2000) return v;
    } catch (e) { /* storage blocked */ }
    return fallback;
  }

  // Same reader as the price check: 10,000 / 10.000 / 46,51 / 1.234,56 / 1,234.56.
  function parseAmount(raw) {
    if (raw == null) return NaN;
    var s = String(raw).toLowerCase().replace(/[\s\u00a0\u202f']/g, '')
      .replace(/^(dkk|krw|kr\.?|won|\u20a9)/, '')
      .replace(/(dkk|krw|kr\.?|won|\uc6d0|\u20a9|months?|days?)$/, '');
    if (!s || !/^[0-9.,]+$/.test(s)) return NaN;
    var dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
    var dec = -1;
    if (dot > -1 && comma > -1) {
      dec = Math.max(dot, comma);
    } else if (dot > -1 || comma > -1) {
      var sep = dot > -1 ? '.' : ',';
      var at = s.lastIndexOf(sep);
      var count = s.split(sep).length - 1;
      var after = s.length - at - 1;
      var before = s.slice(0, at);
      if (count === 1 && (after !== 3 || before === '' || before === '0')) dec = at;
    }
    var intPart = (dec > -1 ? s.slice(0, dec) : s).replace(/[.,]/g, '');
    var frac = dec > -1 ? s.slice(dec + 1) : '';
    if (/[.,]/.test(frac) || (intPart === '' && frac === '')) return NaN;
    var n = parseFloat((intPart || '0') + (frac ? '.' + frac : ''));
    return isFinite(n) ? n : NaN;
  }

  function fmt(n, digits) {
    digits = digits || 0;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
  }
  function fmtWon(v) { return Math.abs(v) < 1000 ? fmt(Math.round(v)) : fmt(Math.round(v / 10) * 10); }
  function fmtRate(v) { return Math.abs(v - Math.round(v)) < 0.005 ? fmt(Math.round(v)) : fmt(v, 2); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // The receipt's monospace (with Hangul) and the tag's condensed numerals, loaded only where the tool is.
  function ensureFonts() {
    if (document.querySelector('link[data-tool-font]')) return;
    var fam = [];
    if (!document.querySelector('link[href*="Nanum+Gothic+Coding"]')) fam.push('family=Nanum+Gothic+Coding:wght@400;700');
    if (!document.querySelector('link[href*="fonts.googleapis.com"][href*="Archivo"]')) fam.push('family=Archivo:wdth,wght@62..100,600..900');
    if (!fam.length) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?' + fam.join('&') + '&display=swap';
    l.setAttribute('data-tool-font', '');
    document.head.appendChild(l);
  }

  /* ---------- icons (authored SVG) ---------- */

  var ICON = {
    records: '<svg class="tl-ico tl-ico--code" viewBox="0 0 18 11" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 0h1.6v11H0zM2.8 0h.8v11h-.8zM4.8 0h2.2v11H4.8zM8.2 0h.8v11h-.8zM10.2 0h1.6v11h-1.6zM13 0h.8v11H13zM15 0h2.4v11H15z"/></svg>',
    memory: '<svg class="tl-ico tl-ico--pen" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M11.2 1.8l3 3L5.4 13.6 1.6 14.4l.8-3.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.2 3.8l3 3" stroke="currentColor" stroke-width="1.7"/></svg>',
    budget: ''
  };
  // Lines from the January 2025 budget carry no mark; the lede says so once.
  var SOURCE = { records: 'from records', memory: 'from memory' };

  var GROUPS = [
    { per: 'once', ko: '한 번', en: 'Once' },
    { per: 'month', ko: '매달', en: 'Every month' },
    { per: 'day', ko: '매일', en: 'Every day' }
  ];

  /* ---------- EAN-13 barcode, drawn as SVG (in-store code, prefix 20) ---------- */

  var EAN = {
    L: ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'],
    G: ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'],
    R: ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'],
    P: ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
  };

  function ean13(twelve) {
    var d = twelve.split('').map(Number), sum = 0, i;
    for (i = 0; i < 12; i++) sum += d[i] * (i % 2 ? 3 : 1);
    d.push((10 - (sum % 10)) % 10);
    var bits = '101', parity = EAN.P[d[0]];
    for (i = 1; i <= 6; i++) bits += EAN[parity[i - 1]][d[i]];
    bits += '01010';
    for (i = 7; i <= 12; i++) bits += EAN.R[d[i]];
    bits += '101';
    var rects = '', x = 0;
    while (x < bits.length) {
      if (bits[x] === '1') {
        var start = x;
        while (x < bits.length && bits[x] === '1') x++;
        var tall = start < 3 || (start >= 45 && start < 50) || start >= 92;
        rects += '<rect x="' + (start + 7) + '" y="0" width="' + (x - start) + '" height="' + (tall ? 52 : 46) + '"/>';
      } else { x++; }
    }
    return {
      digits: d.join(''),
      svg: '<svg class="rc-code" viewBox="0 0 109 52" preserveAspectRatio="none" aria-hidden="true" focusable="false"><g fill="currentColor">' + rects + '</g></svg>'
    };
  }

  /* ---------- the tool ---------- */

  function loadData(hook) {
    var inline = document.getElementById('budget-data');
    if (inline) {
      try { return Promise.resolve(JSON.parse(inline.textContent)); } catch (e) { /* fall through to fetch */ }
    }
    var src = hook.getAttribute('data-src') || './data/budget.json';
    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('budget.json ' + r.status);
      return r.json();
    });
  }

  function build(hook, data) {
    var id = 'bud' + (++uid);
    var baseRate = +data.rate || 215;
    var rate = readRate(baseRate);
    var seedMonths = +data.months || 4;
    var seedDays = +data.days || 116;

    var lines = (data.lines || []).map(function (l) { return Object.assign({ kind: 'cost' }, l); })
      .concat((data.income || []).map(function (l) { return Object.assign({ kind: 'income' }, l); }));

    /* markup */

    function unitWord(l) { return l.unit === 'KRW' ? 'won' : 'kr'; }
    function perWords(l) {
      var cur = l.unit === 'KRW' ? 'in won' : 'in kroner';
      return l.per === 'month' ? cur + ', a month' : l.per === 'day' ? cur + ', a day' : cur;
    }

    function inputHTML(inputId, value, unit, describedBy) {
      return '<span class="tl-box"><input id="' + inputId + '" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" enterkeyhint="next" value="' + esc(value) + '"' +
        ' aria-describedby="' + describedBy + '"><span class="tl-unit" aria-hidden="true">' + unit + '</span></span>';
    }

    function lineHTML(l) {
      var inId = id + '-' + l.id;
      var src = SOURCE[l.source] || '';
      var note = l.note ? '<span class="bud-note-text">' + esc(l.note) + '</span>' : '';
      return '<div class="bud-line" data-line="' + esc(l.id) + '">' +
        '<label class="bud-label" for="' + inId + '">' + esc(l.label || l.en) + '<span class="tl-sr">, ' + perWords(l) + '</span></label>' +
        inputHTML(inId, fmt(l.amount, 2), unitWord(l), inId + '-note') +
        '<p class="bud-note" id="' + inId + '-note">' + note +
        (src ? '<span class="bud-src bud-src--' + esc(l.source) + '">' + (ICON[l.source] || '') + esc(src) + '</span>' : '') +
        '<span class="bud-err" hidden>Type a number, like 4,300.</span></p>' +
        '</div>';
    }

    function groupHTML(ko, en, inner, extraClass) {
      return '<fieldset class="bud-group' + (extraClass ? ' ' + extraClass : '') + '">' +
        '<legend class="bud-legend"><span class="bud-legend-ko" lang="ko" aria-hidden="true">' + ko + '</span><span>' + en + '</span></legend>' +
        inner + '</fieldset>';
    }

    var h = '<div class="bud" role="group" aria-labelledby="' + id + '-name">';
    h += '<div class="bud-head">' +
      '<p class="tool-name" id="' + id + '-name"><span class="tool-ko" lang="ko" aria-hidden="true">영수증</span><span>Your budget, as a receipt</span></p>' +
      '<p class="bud-lede">It starts with my own numbers from fall 2025. Lines without a mark come from my January 2025 budget. Change any line and the receipt prints again. What you type is saved in this browser only.</p>' +
      '<div class="bud-actions">' +
      '<button type="button" class="tl-btn tl-btn--ink" data-bud="mine">Back to my numbers</button>' +
      '<button type="button" class="tl-btn" data-bud="zero">Start from zero</button>' +
      '</div></div>';

    h += '<form class="bud-form" novalidate>';
    h += groupHTML('기간', 'How long',
      '<div class="bud-line" data-line="months">' +
        '<label class="bud-label" for="' + id + '-months">Months</label>' +
        inputHTML(id + '-months', fmt(seedMonths, 1), 'months', id + '-months-note') +
        '<p class="bud-note" id="' + id + '-months-note"><span class="bud-note-text">Every monthly line is multiplied by this</span><span class="bud-err" hidden>Type a number of months, like 4.</span></p>' +
      '</div>' +
      '<div class="bud-line" data-line="days">' +
        '<label class="bud-label" for="' + id + '-days">Days in Korea</label>' +
        inputHTML(id + '-days', fmt(seedDays), 'days', id + '-days-note') +
        '<p class="bud-note" id="' + id + '-days-note"><span class="bud-note-text">For food. Mine were ' + esc(data.period || '29 August to 23 December 2025') + '</span><span class="bud-err" hidden>Type a number of days, like 116.</span></p>' +
      '</div>', 'bud-group--period');
    GROUPS.forEach(function (g) {
      var inner = lines.filter(function (l) { return l.kind === 'cost' && l.per === g.per; }).map(lineHTML).join('');
      if (inner) h += groupHTML(g.ko, g.en, inner);
    });
    var income = lines.filter(function (l) { return l.kind === 'income'; }).map(lineHTML).join('');
    if (income) h += groupHTML('결제', 'Paid with', income, 'bud-group--income');
    h += '</form>';

    h += '<div class="bud-bar">' +
      '<p class="bud-bar-sum"><span class="bud-bar-label"><span lang="ko" aria-hidden="true">합계</span> Total</span> <b class="bud-bar-kr"></b>' +
      '<span class="bud-bar-more"></span></p>' +
      '<a class="bud-bar-link" href="#' + id + '-receipt">Receipt</a>' +
      '</div>';

    h += '<div class="bud-printer">' +
      '<div class="rc-slot" aria-hidden="true"></div>' +
      '<div class="rc-well"><div class="rc" id="' + id + '-receipt" role="region" aria-label="Receipt for your budget" tabindex="-1"></div></div>' +
      '</div>';
    h += '<p class="tl-sr" aria-live="polite" id="' + id + '-live"></p>';
    h += '</div>';

    hook.innerHTML = h;
    hook.classList.add('is-ready');

    var root = hook.querySelector('.bud');
    var form = hook.querySelector('.bud-form');
    var receipt = document.getElementById(id + '-receipt');
    var printer = hook.querySelector('.bud-printer');
    var live = document.getElementById(id + '-live');
    var barKr = hook.querySelector('.bud-bar-kr');
    var barMore = hook.querySelector('.bud-bar-more');
    var monthsIn = document.getElementById(id + '-months');
    var daysIn = document.getElementById(id + '-days');
    lines.forEach(function (l) { l.input = document.getElementById(id + '-' + l.id); });

    /* restore */

    var saved = store.get(STORE_KEY);
    if (saved && saved.v === 1) {
      if (typeof saved.months === 'string') monthsIn.value = saved.months;
      if (typeof saved.days === 'string') daysIn.value = saved.days;
      if (saved.vals) lines.forEach(function (l) { if (typeof saved.vals[l.id] === 'string') l.input.value = saved.vals[l.id]; });
      // show restored numbers the same way the blur does (6.284 becomes 6,284)
      [monthsIn, daysIn].concat(lines.map(function (l) { return l.input; })).forEach(function (input) {
        var v = parseAmount(input.value);
        if (!isNaN(v)) input.value = fmt(v, 2);
      });
    }

    function save() {
      var vals = {};
      lines.forEach(function (l) { vals[l.id] = l.input.value; });
      store.set(STORE_KEY, { v: 1, months: monthsIn.value, days: daysIn.value, vals: vals });
    }

    /* compute */

    function readNum(input) {
      var v = parseAmount(input.value);
      var bad = input.value.trim() !== '' && isNaN(v);
      input.setAttribute('aria-invalid', bad ? 'true' : 'false');
      var line = input.closest('.bud-line');
      var err = line && line.querySelector('.bud-err');
      if (err) err.hidden = !bad;
      return isNaN(v) ? 0 : v;
    }

    function compute() {
      var months = Math.min(readNum(monthsIn), 24);
      var days = Math.min(readNum(daysIn), 730);
      var rows = lines.map(function (l) {
        var v = readNum(l.input);
        var qty = l.per === 'month' ? months : l.per === 'day' ? days : 1;
        var local = v * qty;
        return { l: l, v: v, kr: Math.round(l.unit === 'KRW' ? local / rate : local) };
      });
      var costs = rows.filter(function (r) { return r.l.kind === 'cost' && r.kr > 0; });
      var pays = rows.filter(function (r) { return r.l.kind === 'income' && r.kr > 0; });
      var sum = function (list, test) { return list.reduce(function (s, r) { return s + (test && !test(r) ? 0 : r.kr); }, 0); };
      return {
        months: months, days: days, costs: costs, pays: pays,
        total: sum(costs),
        memory: sum(costs, function (r) { return r.l.source === 'memory'; }),
        paid: sum(pays)
      };
    }

    /* render */

    function qtyNote(r, c) {
      var won = r.l.unit === 'KRW' ? ' won' : '';
      if (r.l.per === 'month') return fmt(r.v, 2) + won + ' x ' + fmt(c.months, 1) + (c.months === 1 ? ' month' : ' months');
      if (r.l.per === 'day') return fmt(r.v, 2) + won + ' x ' + fmt(c.days, 1) + (c.days === 1 ? ' day' : ' days');
      if (won) return fmt(r.v) + won;
      return '';
    }

    function itemHTML(r, c) {
      var note = qtyNote(r, c);
      var ko = r.l.ko ? '<span class="rc-ko" lang="ko" aria-hidden="true">' + esc(r.l.ko) + '</span> ' : '';
      var star = r.l.source === 'memory' ? '<span aria-hidden="true"> *</span><span class="tl-sr">, from memory</span>' : '';
      return '<li><div class="rc-row"><span>' + ko + esc(r.l.en) + star + '</span><span>' + fmt(r.kr) + '</span></div>' +
        (note ? '<div class="rc-sub">' + esc(note) + '</div>' : '') + '</li>';
    }

    function rule(solid) { return '<div class="rc-rule' + (solid ? ' rc-rule--solid' : '') + '" aria-hidden="true"></div>'; }
    function ko(s) { return '<span class="rc-ko" lang="ko" aria-hidden="true">' + s + '</span> '; }

    function render(c) {
      var diff = c.paid - c.total;
      var code = ean13('2025' + String(Math.min(c.total, 99999)).padStart(5, '0') + String(Math.min(Math.abs(diff), 999)).padStart(3, '0'));
      var r = '';
      r += '<p class="rc-c rc-store"><span lang="ko" aria-hidden="true">카이스트 교환 가이드</span></p>';
      r += '<p class="rc-c rc-s">KAIST EXCHANGE GUIDE<br>AISLE 3, MONEY</p>';
      r += rule();
      r += '<div class="rc-row rc-s"><span>' + ko('영수증') + 'RECEIPT</span><span>FALL 2025</span></div>';
      r += '<div class="rc-row rc-s"><span>' + ko('기간') + 'PERIOD</span><span>' + fmt(c.months, 1) + ' MO, ' + fmt(c.days, 1) + ' DAYS</span></div>';
      r += rule();
      r += '<div class="rc-row rc-s"><span>' + ko('품목') + 'ITEM</span><span>KR</span></div>';
      if (c.costs.length) r += '<ul class="rc-list">' + c.costs.map(function (x) { return itemHTML(x, c); }).join('') + '</ul>';
      else r += '<p class="rc-s">No items yet. Type an amount in any line.</p>';
      r += rule();
      r += '<div class="rc-row"><span>' + ko('소계') + 'SUBTOTAL</span><span>' + fmt(c.total) + '</span></div>';
      if (c.memory > 0) r += '<div class="rc-row rc-s"><span>of which * from memory</span><span>' + fmt(c.memory) + '</span></div>';
      r += '<div class="rc-tag">' +
        '<span class="rc-tag-what">' + ko('합계') + 'TOTAL</span>' +
        '<span class="rc-tag-price"><span class="rc-tag-n">' + fmt(c.total) + '</span><span class="rc-tag-u">kr</span></span>' +
        '<span class="rc-tag-alt">about ' + fmtWon(c.total * rate) + ' won</span>' +
        '</div>';
      if (c.pays.length) {
        r += rule();
        r += '<div class="rc-row rc-s"><span>' + ko('결제') + 'PAID WITH</span><span>KR</span></div>';
        r += '<ul class="rc-list">' + c.pays.map(function (x) { return itemHTML(x, c); }).join('') + '</ul>';
        r += rule(true);
        if (diff < 0) r += '<div class="rc-row rc-strong"><span>' + ko('부족') + 'STILL TO FIND</span><span>' + fmt(-diff) + ' kr</span></div>';
        else r += '<div class="rc-row rc-strong"><span>' + ko('남음') + 'LEFT OVER</span><span>' + fmt(diff) + ' kr</span></div>';
        r += '<div class="rc-row rc-s"><span>in won, about</span><span>' + fmtWon(Math.abs(diff) * rate) + '</span></div>';
      }
      r += rule();
      r += '<p class="rc-s rc-foot">* From my memory. Unmarked lines are from my records or my January 2025 budget. ' +
        fmtRate(rate) + ' won to 1 krone' + (Math.abs(rate - baseRate) < 0.005 ? ' (2025).' : ', your rate.') + '</p>';
      r += '<div class="rc-barcode" aria-hidden="true">' + code.svg +
        '<p class="rc-c rc-s rc-digits">' + code.digits.charAt(0) + ' ' + code.digits.slice(1, 7) + ' ' + code.digits.slice(7) + '</p></div>';
      r += '<p class="rc-c rc-thanks">' + ko('감사합니다') + 'THANK YOU</p>';
      receipt.innerHTML = r;

      barKr.textContent = fmt(c.total) + ' kr';
      barMore.textContent = c.pays.length ? (diff < 0 ? fmt(-diff) + ' kr still to find' : fmt(diff) + ' kr left over') : 'about ' + fmtWon(c.total * rate) + ' won';
      fitPrinter();
    }

    function summary(c) {
      var diff = c.paid - c.total;
      return 'Total ' + fmt(c.total) + ' kroner, about ' + fmtWon(c.total * rate) + ' won.' +
        (c.pays.length ? (diff < 0 ? ' ' + fmt(-diff) + ' kroner still to find.' : ' ' + fmt(diff) + ' kroner left over.') : '');
    }

    /* the paper feed: one authored motion */

    function feed() {
      if (reduceMotion()) return;
      receipt.classList.remove('is-feeding');
      void receipt.offsetWidth; // restart
      receipt.classList.add('is-feeding');
    }
    receipt.addEventListener('animationend', function () { receipt.classList.remove('is-feeding'); });

    // On wide screens the receipt rides beside the inputs. CSS reads its height so a receipt
    // taller than the screen scrolls until its total and foot are in view, then stays.
    var fitQueued = false;
    function fitPrinter() {
      if (fitQueued) return;
      fitQueued = true;
      window.requestAnimationFrame(function () {
        fitQueued = false;
        printer.style.setProperty('--rc-h', printer.offsetHeight + 'px');
      });
    }
    window.addEventListener('resize', fitPrinter, { passive: true });

    var lastKey = null, lastSaid = '', timer = null;

    function update(announce) {
      var c = compute();
      render(c);
      var key = c.total + '|' + c.paid;
      if (announce && lastKey !== null && key !== lastKey) feed();
      lastKey = key;
      var s = summary(c);
      if (announce && s !== lastSaid) live.textContent = s;
      lastSaid = s;
    }

    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { update(true); save(); }, 400);
    }

    form.addEventListener('input', schedule);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    // Enter moves to the next field, like a till.
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      var all = Array.prototype.slice.call(form.querySelectorAll('input'));
      var next = all[all.indexOf(e.target) + 1];
      if (next) { next.focus(); next.select(); }
    });
    form.addEventListener('focusout', function (e) {
      var input = e.target;
      if (input.tagName !== 'INPUT') return;
      var v = parseAmount(input.value);
      if (!isNaN(v)) input.value = fmt(v, 2);
    });

    Array.prototype.forEach.call(hook.querySelectorAll('[data-bud]'), function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-bud');
        if (mode === 'mine') {
          monthsIn.value = fmt(seedMonths, 1);
          daysIn.value = fmt(seedDays);
          lines.forEach(function (l) { l.input.value = fmt(l.amount, 2); });
        } else {
          lines.forEach(function (l) { l.input.value = '0'; });
        }
        window.clearTimeout(timer);
        update(true);
        save();
      });
    });

    // The price check changed the rate.
    function onRate(v) {
      if (!(v >= 50 && v <= 2000) || Math.abs(v - rate) < 0.005) return;
      rate = v;
      update(true);
    }
    document.addEventListener('kaist:rate', function (e) { if (e.detail) onRate(e.detail.rate); });
    window.addEventListener('storage', function (e) { if (e.key === RATE_KEY) onRate(readRate(baseRate)); });

    // Fonts arriving late change the receipt height.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPrinter);

    update(false);
    root.setAttribute('data-state', 'ready');
  }

  function init(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-tool="budget"]'), function (hook) {
      if (hook.hasAttribute('data-ready')) return;
      hook.setAttribute('data-ready', '');
      ensureFonts();
      loadData(hook).then(function (data) {
        build(hook, data);
      }).catch(function () {
        hook.innerHTML = '<p class="tl-fail">The budget receipt could not load here. My budget table above has every number.</p>';
      });
    });
  }

  window.kaistTools = window.kaistTools || {};
  window.kaistTools.budget = init;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})();
