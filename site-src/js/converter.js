/* KAIST exchange guide: price check (가격 확인), won to kroner and back.
   Hook: <div class="tool" data-tool="converter"></div> renders the full version
   (two linked fields, a result line, an editable rate and three of my own prices).
   Hook: <div class="tool tool--compact" data-tool="converter"></div> renders the compact
   version (two linked fields and a result line) for the aisle directory.
   Optional attributes on the hook: data-rate="215" (default rate), data-won="10000" (start value).
   The rate a reader types is shared with every converter and the budget receipt through
   localStorage and a "kaist:rate" event on document. Works without localStorage. */
(function () {
  'use strict';

  var DEFAULT_RATE = 215;
  var RATE_KEY = 'kaist-guide:rate:v1';
  var uid = 0;

  /* ---------- shared helpers ---------- */

  function readRate(fallback) {
    try {
      var v = parseFloat(window.localStorage.getItem(RATE_KEY));
      if (v >= 50 && v <= 2000) return v;
    } catch (e) { /* storage blocked */ }
    return fallback;
  }
  function writeRate(v) {
    try {
      if (v == null) window.localStorage.removeItem(RATE_KEY);
      else window.localStorage.setItem(RATE_KEY, String(v));
    } catch (e) { /* storage blocked: the rate still applies on this page */ }
  }

  // Reads 10,000 / 10.000 / 10 000 / 46,51 / 46.51 / 1.234,56 / 1,234.56 / 213100 won.
  // A single separator followed by exactly three digits is a thousands mark; otherwise a decimal.
  function parseAmount(raw) {
    if (raw == null) return NaN;
    var s = String(raw).toLowerCase().replace(/[\s\u00a0\u202f']/g, '')
      .replace(/^(dkk|krw|kr\.?|won|\u20a9)/, '')
      .replace(/(dkk|krw|kr\.?|won|\uc6d0|\u20a9)$/, '');
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
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  }
  // Kroner: two decimals under 1,000 unless the amount is whole; whole kroner above.
  function fmtKr(v) {
    if (Math.abs(v) >= 1000) return fmt(Math.round(v));
    return Math.abs(v - Math.round(v)) < 0.005 ? fmt(Math.round(v)) : fmt(v, 2);
  }
  // Won: whole won under 1,000, rounded to 10 won above (there are no smaller coins).
  function fmtWon(v) {
    return Math.abs(v) < 1000 ? fmt(Math.round(v)) : fmt(Math.round(v / 10) * 10);
  }
  function fmtRate(v) { return Math.abs(v - Math.round(v)) < 0.005 ? fmt(Math.round(v)) : fmt(v, 2); }

  /* ---------- markup ---------- */

  var SWAP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8.5h15l-4-4M20 15.5H5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function field(id, label, unit, value, describedBy) {
    return '<div class="cv-field">' +
      '<label class="cv-label" for="' + id + '">' + label + '</label>' +
      '<span class="tl-box"><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" enterkeyhint="done" value="' + value + '"' +
      (describedBy ? ' aria-describedby="' + describedBy + '"' : '') + '>' +
      '<span class="tl-unit" aria-hidden="true">' + unit + '</span></span></div>';
  }

  function build(hook) {
    if (hook.hasAttribute('data-ready')) return;
    hook.setAttribute('data-ready', '');
    var compact = hook.classList.contains('tool--compact') || hook.getAttribute('data-variant') === 'compact';
    var id = 'cv' + (++uid);
    var baseRate = parseFloat(hook.getAttribute('data-rate')) || DEFAULT_RATE;
    var rate = readRate(baseRate);
    var startWon = parseAmount(hook.getAttribute('data-won'));
    if (isNaN(startWon)) startWon = 10000;

    var h = '<div class="cv' + (compact ? ' cv--compact' : '') + '" role="group" aria-labelledby="' + id + '-name">';
    h += '<p class="tool-name" id="' + id + '-name"><span class="tool-ko" lang="ko" aria-hidden="true">가격 확인</span><span>Price check</span></p>';
    if (!compact) {
      h += '<p class="cv-lede" id="' + id + '-help">Type an amount in either box. Commas and dots both work, so 10.000 and 46,51 are fine.</p>';
    }
    h += '<div class="cv-fields">';
    h += field(id + '-won', compact ? 'Won' : 'Korean won', 'won', fmt(startWon), compact ? '' : id + '-help');
    if (!compact) h += '<span class="cv-swap">' + SWAP_ICON + '</span>';
    h += field(id + '-dkk', compact ? 'Kroner' : 'Danish kroner', 'kr', fmtKr(startWon / rate), compact ? '' : id + '-help');
    h += '</div>';
    h += '<p class="cv-result" id="' + id + '-out"></p>';
    if (!compact) {
      h += '<div class="cv-rate">' +
        '<label class="cv-label" for="' + id + '-rate">Rate</label>' +
        '<span class="tl-box tl-box--sm"><input id="' + id + '-rate" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" enterkeyhint="done" value="' + fmtRate(rate) + '" aria-describedby="' + id + '-rate-note"></span>' +
        '<span class="cv-rate-note" id="' + id + '-rate-note">won to 1 krone. The guide uses 215, the 2025 rate.</span>' +
        '<button type="button" class="tl-link" data-cv="reset-rate" hidden>Use 215 again</button>' +
        '</div>';
      h += '<div class="cv-try"><span class="cv-try-label">Try one of mine:</span>' +
        '<button type="button" class="tl-chip" data-won="76390">NHI, a month</button>' +
        '<button type="button" class="tl-chip" data-won="213100">My Uber to Incheon</button>' +
        '<button type="button" class="tl-chip" data-dkk="6084">SU, a month</button>' +
        '</div>';
    }
    h += '<p class="tl-sr" aria-live="polite" id="' + id + '-live"></p>';
    h += '</div>';
    hook.innerHTML = h;

    var won = document.getElementById(id + '-won');
    var dkk = document.getElementById(id + '-dkk');
    var out = document.getElementById(id + '-out');
    var live = document.getElementById(id + '-live');
    var rateIn = document.getElementById(id + '-rate');
    var resetBtn = hook.querySelector('[data-cv="reset-rate"]');
    var side = 'won';
    var liveTimer = null;

    function say(text) {
      window.clearTimeout(liveTimer);
      liveTimer = window.setTimeout(function () { live.textContent = text; }, 900);
    }

    function setInvalid(input, bad) { input.setAttribute('aria-invalid', bad ? 'true' : 'false'); }

    function show(text, html) {
      out.innerHTML = html;
      say(text);
    }

    function fromWon(quiet) {
      side = 'won';
      var v = parseAmount(won.value);
      var empty = won.value.trim() === '';
      setInvalid(won, !empty && isNaN(v));
      setInvalid(dkk, false);
      if (isNaN(v)) {
        dkk.value = '';
        out.innerHTML = empty ? 'Type an amount in either box.' : 'Type a number, like 10,000 or 46,51.';
        return;
      }
      var kr = v / rate;
      dkk.value = fmtKr(kr);
      var text = fmt(v, v % 1 ? 2 : 0) + ' won is about ' + fmtKr(kr) + ' kr';
      if (quiet) out.innerHTML = resultHTML(fmt(v, v % 1 ? 2 : 0), 'won', fmtKr(kr), 'kr');
      else show(text, resultHTML(fmt(v, v % 1 ? 2 : 0), 'won', fmtKr(kr), 'kr'));
    }

    function fromDkk(quiet) {
      side = 'dkk';
      var v = parseAmount(dkk.value);
      var empty = dkk.value.trim() === '';
      setInvalid(dkk, !empty && isNaN(v));
      setInvalid(won, false);
      if (isNaN(v)) {
        won.value = '';
        out.innerHTML = empty ? 'Type an amount in either box.' : 'Type a number, like 10,000 or 46,51.';
        return;
      }
      var w = v * rate;
      won.value = fmtWon(w);
      var text = fmtKr(v) + ' kr is about ' + fmtWon(w) + ' won';
      if (quiet) out.innerHTML = resultHTML(fmtKr(v), 'kr', fmtWon(w), 'won');
      else show(text, resultHTML(fmtKr(v), 'kr', fmtWon(w), 'won'));
    }

    function resultHTML(a, ua, b, ub) {
      return '<span class="cv-n">' + a + '</span> ' + ua + ' is about <span class="cv-n cv-n--to">' + b + '</span> ' + ub +
        (compact ? ' <span class="cv-at">at ' + fmtRate(rate) + ' won to 1 kr</span>' : '');
    }

    function redo(quiet) { if (side === 'won') fromWon(quiet); else fromDkk(quiet); }

    won.addEventListener('input', function () { fromWon(false); });
    dkk.addEventListener('input', function () { fromDkk(false); });
    won.addEventListener('blur', function () { var v = parseAmount(won.value); if (!isNaN(v) && side === 'won') won.value = fmt(v, v % 1 ? 2 : 0); });
    dkk.addEventListener('blur', function () { var v = parseAmount(dkk.value); if (!isNaN(v) && side === 'dkk') dkk.value = fmtKr(v); });

    function syncRateUI() {
      if (resetBtn) resetBtn.hidden = Math.abs(rate - baseRate) < 0.005;
    }

    if (rateIn) {
      rateIn.addEventListener('input', function () {
        var v = parseAmount(rateIn.value);
        var ok = v >= 50 && v <= 2000;
        setInvalid(rateIn, rateIn.value.trim() !== '' && !ok);
        if (!ok) return;
        rate = v;
        writeRate(Math.abs(v - baseRate) < 0.005 ? null : v);
        syncRateUI();
        redo(false);
        broadcast(v);
      });
      rateIn.addEventListener('blur', function () {
        rateIn.value = fmtRate(rate);
        setInvalid(rateIn, false);
      });
      resetBtn.addEventListener('click', function () {
        rate = baseRate;
        rateIn.value = fmtRate(rate);
        setInvalid(rateIn, false);
        writeRate(null);
        syncRateUI();
        redo(false);
        broadcast(rate);
        rateIn.focus();
      });
    }

    Array.prototype.forEach.call(hook.querySelectorAll('[data-won], [data-dkk]'), function (b) {
      b.addEventListener('click', function () {
        if (b.hasAttribute('data-won')) { won.value = fmt(+b.getAttribute('data-won')); fromWon(false); }
        else { dkk.value = fmt(+b.getAttribute('data-dkk')); fromDkk(false); }
      });
    });

    // Another converter (or another tab) changed the rate.
    function onRate(v) {
      if (!(v >= 50 && v <= 2000) || Math.abs(v - rate) < 0.005) return;
      rate = v;
      if (rateIn && document.activeElement !== rateIn) rateIn.value = fmtRate(rate);
      syncRateUI();
      redo(true);
    }
    document.addEventListener('kaist:rate', function (e) { if (e.detail && e.detail.from !== id) onRate(e.detail.rate); });
    window.addEventListener('storage', function (e) { if (e.key === RATE_KEY) onRate(readRate(baseRate)); });

    function broadcast(v) {
      var ev;
      try { ev = new CustomEvent('kaist:rate', { detail: { rate: v, from: id } }); } catch (e) { return; }
      document.dispatchEvent(ev);
    }

    syncRateUI();
    fromWon(true);
  }

  function init(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-tool="converter"]'), build);
  }

  window.kaistTools = window.kaistTools || {};
  window.kaistTools.converter = init;
  window.kaistTools.parseAmount = parseAmount;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})();
