(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement, body = document.body;
  var scroller = $('scroller'), tocSel = $('toc'), jump = $('jump');

  /* ------------------------------------------------------------------ settings */
  var THEMES = [['github-light', 'GitHub'], ['github-colorful', 'GitHub Colorful'], ['github-dark', 'GitHub Dark'],
    ['vscode-dark', 'VS Code Dark+'], ['notion', 'Notion'], ['solarized', 'Solarized'], ['dracula', 'Dracula']];
  var DEFAULTS = {
    theme: 'github-light', split: '1', fitMode: 'default', zoom: 100, tables: 'auto', minScale: 60,
    live: true, pollSec: 1, sidebar: false,
    pdfTheme: 'github-light', margin: 18,
    hl: '{doc}', hc: '', hr: '', fl: '{date}', fc: '', fr: 'Page {page} of {pages}',
    wm: false, wmText: 'CONFIDENTIAL'
  };
  var SPEC = [
    ['Appearance'],
    ['theme', 'Theme', 'select', THEMES],
    ['Pages'],
    ['split', 'Split pages on', 'select', [['1', 'H1 only'], ['2', 'H1 and H2']], 'Use H1 and H2 for documents with few H1 headings.'],
    ['fitMode', 'Page fit', 'select', [['default', 'Default'], ['width', 'Fit to width'], ['height', 'Fit to height']], 'Also on the toolbar. Width scales content to fill the screen width; height shrinks long pages to one screen.'],
    ['zoom', 'Zoom in Default view (%)', 'number', [25, 300]],
    ['minScale', 'Fit-to-height minimum size (%)', 'number', [30, 100]],
    ['tables', 'Tables', 'select', [['auto', 'Wrap columns (toggle shown on wide tables)'], ['scroll', 'Scroll sideways (toggle shown on wide tables)']]],
    ['Files'],
    ['live', 'Live reload when the file changes', 'check'],
    ['pollSec', 'Check for changes every (seconds)', 'number', [1, 60]],
    ['sidebar', 'Show folder sidebar by default', 'check'],
    ['PDF export'],
    ['pdfTheme', 'Theme used in PDF', 'select', [['current', 'Same as screen']].concat(THEMES)],
    ['margin', 'Page margin (mm)', 'number', [5, 40]],
    ['hl', 'Header - left', 'text'], ['hc', 'Header - centre', 'text'], ['hr', 'Header - right', 'text'],
    ['fl', 'Footer - left', 'text'], ['fc', 'Footer - centre', 'text'], ['fr', 'Footer - right', 'text'],
    ['*hint', 'Tokens: {doc} document name, {date} today, {page} page number, {pages} page count. Leave blank for none. For example, put Confidential in the header centre.'],
    ['wm', 'Diagonal watermark on every page', 'check'],
    ['wmText', 'Watermark text', 'text']
  ];
  var S = {};

  function loadSettings(cb) {
    var done = function (saved) { S = Object.assign({}, DEFAULTS, saved || {}); if (saved && saved.autoFit && !saved.fitMode) S.fitMode = 'height'; cb(); };
    try {
      chrome.storage.sync.get('settings', function (r) { done(r && r.settings); });
    } catch (e) {
      try { done(JSON.parse(localStorage.getItem('mdslides-settings'))); } catch (e2) { done(null); }
    }
  }
  function saveSettings() {
    try { chrome.storage.sync.set({ settings: S }); } catch (e) { /* ignore */ }
    try { localStorage.setItem('mdslides-settings', JSON.stringify(S)); } catch (e) { /* ignore */ }
  }
  function getRecent(cb) { try { chrome.storage.local.get('recent', function (r) { cb((r && r.recent) || []); }); } catch (e) { cb([]); } }
  function addRecent(url) {
    getRecent(function (list) {
      list = list.filter(function (x) { return x.url !== url; });
      list.unshift({ url: url, name: decodeURIComponent(url.replace(/^.*\//, '').split('?')[0]) });
      try { chrome.storage.local.set({ recent: list.slice(0, 8) }); } catch (e) { /* ignore */ }
    });
  }

  /* ------------------------------------------------------------------ state */
  var sections = [], cur = 0, hasDoc = false, docName = 'document';
  var srcUrl = null, lastText = null, pollTimer = null, slugMap = {}, imgCache = new Map();
  var dirUrl = null, docFile = '';

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ------------------------------------------------------------------ parsing */
  function plainText(tok) { return (tok.text || '').replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, '$1'); }
  function slug(t) { return t.trim().toLowerCase().replace(/[^\w\- \u00c0-\uffff]/g, '').replace(/ /g, '-'); }
  function isRelative(s) { return !!s && !/^([a-z][a-z0-9+.\-]*:|\/\/|#)/i.test(s); }

  function setupMarked() {
    if (setupMarked.done || typeof hljs === 'undefined') return;
    setupMarked.done = true;
    marked.use({ renderer: { code: function (code, info) {
      var lang = ((info || '').match(/\S+/) || [''])[0], v;
      try {
        v = (lang && hljs.getLanguage(lang)) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : hljs.highlightAuto(code).value;
      } catch (e) { return false; }
      return '<pre><code class="hljs' + (lang ? ' language-' + lang : '') + '">' + v.replace(/\n$/, '') + '\n</code></pre>';
    } } });
  }

  // heading ids, relative images/links -> inert markers, resolved after render
  function post(html, idx, used) {
    var t = document.createElement('template'); t.innerHTML = html;
    var r = t.content;
    r.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(function (h) {
      var id = slug(h.textContent), n = used[id] = (used[id] === undefined ? 0 : used[id] + 1);
      if (n) id += '-' + n;
      h.id = 'h-' + id; slugMap[id] = idx;
    });
    r.querySelectorAll('img').forEach(function (im) {
      var s = im.getAttribute('src') || '';
      if (srcUrl && isRelative(s)) { try { im.setAttribute('data-local', new URL(s, srcUrl).href); im.removeAttribute('src'); } catch (e) { /* ignore */ } }
      else if (/^file:/i.test(s)) { im.setAttribute('data-local', s); im.removeAttribute('src'); }
    });
    r.querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href');
      if (h.charAt(0) === '#') return;
      if (srcUrl && isRelative(h)) {
        try {
          var u = new URL(h, srcUrl); u.hash = '';
          a.setAttribute('data-local', u.href);
          if (/\.(md|markdown)$/i.test(u.pathname)) a.setAttribute('data-md', '1');
        } catch (e) { /* ignore */ }
      } else if (/^(https?:|mailto:)/i.test(h)) { a.target = '_blank'; a.rel = 'noopener'; }
    });
    return t.innerHTML;
  }

  function parse(md) {
    setupMarked();
    md = md.replace(/^\uFEFF/, '');
    slugMap = {};
    var toks = marked.lexer(md), lvl = parseInt(S.split, 10) || 1;
    var groups = [], g = null, h1 = '';
    toks.forEach(function (t) {
      if (t.type === 'heading' && t.depth <= lvl) {
        if (t.depth === 1) h1 = plainText(t);
        g = { title: plainText(t), level: t.depth, crumb: t.depth > 1 ? h1 : '', toks: [t] }; groups.push(g);
      } else {
        if (!g) { g = { title: null, level: 1, crumb: '', toks: [] }; groups.push(g); }
        g.toks.push(t);
      }
    });
    groups = groups.filter(function (x) { return x.toks.some(function (t) { return t.type !== 'space'; }); });
    var used = {};
    sections = groups.map(function (x, i) {
      var arr = x.toks.slice(); arr.links = toks.links;
      return { title: x.title || (i === 0 ? 'Introduction' : 'Section ' + (i + 1)), level: x.level, crumb: x.crumb, html: post(marked.parser(arr), i, used) };
    });
    hasDoc = sections.length > 0;
  }

  /* ------------------------------------------------------------------ images, code, tables */
  function svg(path) { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; }
  var ICON = {
    fitW: svg('<path d="M4 5v14M20 5v14M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3"/>'),
    actual: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 9.5l2-1.2V16"/>'),
    fitH: svg('<path d="M5 4h14M5 20h14M12 8v8M12 8l-3 3M12 8l3 3M12 16l-3-3M12 16l3-3"/>'),
    wrap: svg('<path d="M4 6h16M4 12h11a3 3 0 010 6h-4M11 18l-2-2M11 18l-2 2M4 18h3"/>'),
    scroll: svg('<path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3"/>'),
    expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')
  };
  function dataUrl(u) {
    if (!imgCache.has(u)) {
      imgCache.set(u, fetch(u).then(function (r) { if (!r.ok) throw new Error('missing'); return r.blob(); }).then(function (b) {
        return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); });
      }));
    }
    return imgCache.get(u);
  }

  function makeSortable(table) {
    var ths = table.querySelectorAll('thead th'), tb = table.tBodies[0];
    if (!tb || !ths.length) return;
    var orig = [].slice.call(tb.rows);
    function val(r, ci) { return (r.cells[ci] ? r.cells[ci].textContent : '').trim(); }
    function num(s) { var n = parseFloat(s.replace(/[,%$\u20ac\u00a3\s]/g, '')); return isNaN(n) || !/\d/.test(s) ? null : n; }
    ths.forEach(function (th, ci) {
      th.classList.add('sortable');
      th.addEventListener('click', function () {
        var dir = th.dataset.dir === 'asc' ? 'desc' : th.dataset.dir === 'desc' ? '' : 'asc';
        ths.forEach(function (x) { x.removeAttribute('data-dir'); });
        if (dir) th.dataset.dir = dir;
        var rows = orig.slice();
        if (dir) rows.sort(function (a, b) {
          var x = val(a, ci), y = val(b, ci), nx = num(x), ny = num(y), c;
          if (x === '' || y === '') c = (x === '') - (y === '');
          else if (nx !== null && ny !== null) c = nx - ny;
          else c = x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
          return dir === 'asc' ? c : -c;
        });
        rows.forEach(function (r) { tb.appendChild(r); });
      });
    });
  }

  function decorate(b) {
    b.querySelectorAll('img[data-local]').forEach(function (im) {
      dataUrl(im.dataset.local).then(function (u) { im.src = u; fitSoon(); })
        .catch(function () { im.alt = (im.alt || 'image') + ' (not found)'; im.title = im.dataset.local; });
    });
    b.querySelectorAll('pre').forEach(function (pre) {
      var w = document.createElement('div'); w.className = 'codewrap';
      pre.parentNode.insertBefore(w, pre); w.appendChild(pre);
      var btn = document.createElement('button'); btn.className = 'copybtn'; btn.textContent = 'Copy'; btn.type = 'button';
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(pre.innerText).then(function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1200); },
          function () { btn.textContent = 'Failed'; });
      });
      w.appendChild(btn);
    });
    b.querySelectorAll('table').forEach(function (tb) {
      var blk = document.createElement('div'); blk.className = 'tableblock';
      var bar = document.createElement('div'); bar.className = 'tbar'; bar.hidden = true;
      var w = document.createElement('div'); w.className = 'tablewrap';
      tb.parentNode.insertBefore(blk, tb); blk.appendChild(bar); blk.appendChild(w); w.appendChild(tb); makeSortable(tb);
      bar.innerHTML = '<button type="button" class="tmode"></button><button type="button" class="texp" title="Open table full screen">' + ICON.expand + '</button>';
      var mode = S.tables === 'scroll' ? 'scroll' : 'wrap';
      var apply = function () {
        w.classList.toggle('scroll', mode === 'scroll');
        var btn = bar.querySelector('.tmode');
        btn.innerHTML = mode === 'scroll' ? ICON.wrap : ICON.scroll;
        btn.title = mode === 'scroll' ? 'Wrap columns to fit the page' : 'Scroll sideways (natural width)';
      };
      apply();
      bar.querySelector('.tmode').addEventListener('click', function () { mode = mode === 'scroll' ? 'wrap' : 'scroll'; apply(); });
      bar.querySelector('.texp').addEventListener('click', function () { openTable(tb); });
    });
  }

  // show the toggle bar only on tables whose natural width does not fit the page
  function checkWide(scope) {
    scope.querySelectorAll('.tableblock').forEach(function (blk) {
      var w = blk.querySelector('.tablewrap'), tb = w.firstElementChild, bar = blk.querySelector('.tbar');
      if (!blk.offsetParent) return;
      var wasScroll = w.classList.contains('scroll');
      w.classList.remove('scroll'); w.classList.add('measure');
      var nat = tb.offsetWidth, avail = w.clientWidth;
      w.classList.remove('measure'); if (wasScroll) w.classList.add('scroll');
      bar.hidden = !(nat > avail + 1);
    });
  }

  function openTable(tb) {
    var c = tb.cloneNode(true);
    c.querySelectorAll('th').forEach(function (th) { th.removeAttribute('data-dir'); th.classList.remove('sortable'); });
    $('ovBody').innerHTML = ''; $('ovBody').appendChild(c); makeSortable(c);
    $('ovTitle').textContent = docName; $('tblOverlay').hidden = false;
  }
  function closeTable() { $('tblOverlay').hidden = true; $('ovBody').innerHTML = ''; }

  /* ------------------------------------------------------------------ render / navigation */
  function emptyState() {
    scroller.innerHTML = '<div id="drop"><div class="box"><h2>MD Slides</h2>' +
      '<p>Open a local <b>.md</b> file in Chrome, or paste its path below.</p>' +
      '<div class="row2"><input id="pathIn" placeholder="D:\\folder\\file.md  or  file:///..."><button id="pathGo">Open</button></div>' +
      '<div id="recentBox"></div>' +
      '<p>You can also drop a .md file here (static copy). Press <kbd>?</kbd> for help.</p></div></div>';
    $('pathGo').addEventListener('click', function () { openPath($('pathIn').value); });
    $('pathIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') openPath(this.value); });
    getRecent(function (list) {
      if (!list.length) return;
      var h = '<h4>Recent</h4><ul>' + list.map(function (x, i) { return '<li data-i="' + i + '" title="' + esc(decodeURIComponent(x.url)) + '">' + esc(x.name) + '</li>'; }).join('') + '</ul>';
      $('recentBox').innerHTML = h;
      $('recentBox').querySelectorAll('li').forEach(function (li) { li.addEventListener('click', function () { openSrc(list[+li.dataset.i].url); }); });
    });
    $('total').textContent = ''; jump.value = ''; jump.disabled = true;
    tocSel.innerHTML = ''; tocSel.style.display = 'none';
    $('prev').disabled = $('next').disabled = true; $('progress').style.width = '0';
  }

  function buildToc() {
    tocSel.innerHTML = ''; tocSel.style.display = sections.length > 1 ? '' : 'none';
    sections.forEach(function (s, i) {
      var o = document.createElement('option'); o.value = i;
      var t = s.title.length > 48 ? s.title.slice(0, 47) + '\u2026' : s.title;
      o.textContent = (s.level > 1 ? '\u00a0\u00a0\u00a0' : '') + (i + 1) + '. ' + t;
      tocSel.appendChild(o);
    });
  }

  function render() {
    if (!hasDoc) { emptyState(); return; }
    var all = body.classList.contains('all');
    scroller.innerHTML = '';
    sections.forEach(function (s, i) {
      var p = document.createElement('section'); p.className = 'page'; p.dataset.i = i;
      var b = document.createElement('div'); b.className = 'markdown-body';
      b.innerHTML = (s.crumb ? '<div class="crumb">' + esc(s.crumb) + '</div>' : '') + s.html;
      decorate(b); p.appendChild(b);
      if (!all && i !== cur) p.style.display = 'none';
      scroller.appendChild(p);
    });
    jump.disabled = false;
    update(true);
  }

  function update(resetScroll) {
    if (!hasDoc) return;
    var all = body.classList.contains('all');
    if (!all) {
      scroller.querySelectorAll('.page').forEach(function (p) { p.style.display = (+p.dataset.i === cur) ? '' : 'none'; });
      if (resetScroll) scroller.scrollTop = 0;
    }
    if (document.activeElement !== jump) jump.value = cur + 1;
    $('total').textContent = '/ ' + sections.length;
    tocSel.value = cur;
    $('prev').disabled = cur <= 0; $('next').disabled = cur >= sections.length - 1;
    $('progress').style.width = (sections.length > 1 ? (cur / (sections.length - 1)) * 100 : 100) + '%';
    try { history.replaceState(null, '', location.pathname + location.search + '#' + (cur + 1)); } catch (e) { /* ignore */ }
    fit();
  }

  function go(i) {
    if (!hasDoc) return;
    i = Math.max(0, Math.min(sections.length - 1, i));
    if (body.classList.contains('all')) {
      cur = i; var el = scroller.querySelector('.page[data-i="' + i + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth' });
      update(false); return;
    }
    if (i === cur) return;
    cur = i; update(true);
  }

  /* zoom / fit: 'default' = manual zoom (S.zoom %); 'width' scales so a 960px layout fills the width; 'height' shrinks the current page to one screen */
  var STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300], effZoom = 100, fitTimer = null;
  function fitSoon() { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 80); }
  function px(v) { return parseFloat(v) || 0; }
  function fitUi(mode, eff) {
    effZoom = eff;
    $('zPct').textContent = eff + '%';
    [['fitDef', 'default'], ['fitW', 'width'], ['fitH', 'height']].forEach(function (x) {
      var el = $(x[0]); el.classList.toggle('on', x[1] === mode); el.setAttribute('aria-pressed', x[1] === mode);
    });
  }
  function fit() {
    var all = body.classList.contains('all'), mode = S.fitMode || 'default', eff = 100;
    var bodies = scroller.querySelectorAll('.markdown-body');
    bodies.forEach(function (b) { b.style.zoom = ''; });
    body.classList.toggle('fit', mode === 'height' && !all);
    body.classList.toggle('fitw', mode === 'width');
    var pg = scroller.querySelector('.page[data-i="' + cur + '"]');
    if (mode === 'default') {
      eff = Math.max(25, Math.min(300, S.zoom || 100));
      if (eff !== 100) bodies.forEach(function (b) { b.style.zoom = eff / 100; });
    } else if (pg && mode === 'width') {
      var sc = getComputedStyle(scroller), pc = getComputedStyle(pg);
      var w = scroller.clientWidth - px(sc.paddingLeft) - px(sc.paddingRight) - px(pc.paddingLeft) - px(pc.paddingRight) - px(pc.borderLeftWidth) - px(pc.borderRightWidth);
      var z = Math.max(0.6, Math.min(3, w / 960));
      bodies.forEach(function (b) { b.style.zoom = z; });
      eff = Math.round(z * 100);
    } else if (pg && mode === 'height' && !all) {
      var b = pg.firstChild, min = Math.max(0.3, (S.minScale || 60) / 100);
      var over = function (zz) { b.style.zoom = zz; return scroller.scrollHeight > scroller.clientHeight + 1; };
      if (!over(1)) { b.style.zoom = ''; }
      else if (over(min)) { b.style.zoom = min; eff = Math.round(min * 100); }
      else {
        var lo = min, hi = 1;
        for (var k = 0; k < 8; k++) { var mid = (lo + hi) / 2; if (over(mid)) hi = mid; else lo = mid; }
        b.style.zoom = lo; eff = Math.round(lo * 100);
      }
    }
    fitUi(mode, eff);
    checkWide(all ? scroller : (pg || scroller));
  }
  function setFit(mode) {
    S.fitMode = mode; saveSettings();
    var sel = $('s_fitMode'); if (sel) sel.value = mode;
    fit();
  }
  function zoomBy(dir) {
    var cur100 = effZoom, next = cur100;
    if (dir > 0) { next = STEPS.find(function (x) { return x > cur100; }) || 300; }
    else { for (var i = STEPS.length - 1; i >= 0; i--) { if (STEPS[i] < cur100) { next = STEPS[i]; break; } } if (next === cur100) next = 25; }
    S.zoom = next; S.fitMode = 'default'; saveSettings();
    var sel = $('s_fitMode'); if (sel) sel.value = 'default';
    var zs = $('s_zoom'); if (zs) zs.value = next;
    fit();
  }
  function zoomReset() { S.zoom = 100; setFit('default'); var zs = $('s_zoom'); if (zs) zs.value = 100; }

  function jumpToId(slugId) {
    var idx = slugMap[slugId];
    if (idx === undefined) return false;
    go(idx);
    var el = scroller.querySelector('[id="h-' + slugId.replace(/"/g, '') + '"]');
    if (el) el.scrollIntoView();
    return true;
  }

  /* ------------------------------------------------------------------ loading a document */
  function load(text, name, mode) {   // mode: 'first' | 'live' | undefined (static)
    var keepScroll = mode === 'live' ? scroller.scrollTop : 0;
    if (mode !== 'live' || text !== lastText) imgCache.clear();
    lastText = text;
    docFile = name || 'document'; docName = docFile.replace(/\.[^.]*$/, '');
    $('docTitle').textContent = docFile; document.title = docName + ' - MD Slides';
    parse(text); buildToc();
    if (mode === 'first') { var h = parseInt((location.hash || '').slice(1), 10); cur = (h >= 1 && h <= sections.length) ? h - 1 : 0; }
    else if (mode === 'live') cur = Math.min(cur, sections.length - 1);
    else cur = 0;
    render();
    if (mode === 'live') scroller.scrollTop = keepScroll;
  }

  function nameOf(u) { try { return decodeURIComponent(u.split('#')[0].split('?')[0].replace(/^.*\//, '')); } catch (e) { return u; } }
  function setLive(ok) {
    var t = $('liveTag'); t.hidden = !(srcUrl && S.live);
    t.textContent = ok ? '\u25cf live' : '\u25cf file not readable'; t.classList.toggle('off', !ok);
  }
  function pull() {
    if (!srcUrl) return;
    fetch(srcUrl, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); }).then(function (t) {
      setLive(true);
      if (t !== lastText) { var first = lastText === null; load(t, nameOf(srcUrl), first ? 'first' : 'live'); }
    }).catch(function () { setLive(false); });
  }
  function restartPoll() {
    clearInterval(pollTimer); pollTimer = null;
    if (srcUrl && S.live) pollTimer = setInterval(function () { if (!document.hidden) pull(); }, Math.max(1, S.pollSec || 1) * 1000);
    setLive(true);
  }

  function toFileUrl(p) {
    p = (p || '').trim().replace(/^"|"$/g, '');
    if (!p) return '';
    if (/^(file|https?):/i.test(p)) return p;
    if (/^[a-z]:[\\/]/i.test(p)) return 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
    if (/^\\\\/.test(p)) return 'file:' + encodeURI(p.replace(/\\/g, '/'));
    return '';
  }
  function openPath(p) {
    var u = toFileUrl(p);
    if (!u) { toast('Enter a full path like D:\\folder\\file.md'); return; }
    openSrc(u, true);
  }
  function openSrc(u, push) {
    u = u.split('#')[0];
    if (push !== false) { try { history.pushState(null, '', location.pathname + '?src=' + encodeURIComponent(u)); } catch (e) { /* ignore */ } }
    srcUrl = u; lastText = null; cur = 0;
    addRecent(u);
    pull(); restartPoll();
    showDir(u.replace(/[^/]*$/, ''), u);
  }

  /* ------------------------------------------------------------------ folder sidebar */
  function dirName(u) { try { return decodeURIComponent(u.replace(/\/$/, '').replace(/^.*\//, '')) || u; } catch (e) { return u; } }
  function parseListing(html, base) {
    var out = [], re = /addRow\("((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)",(\d)/g, m;
    function dec(s) { try { return JSON.parse('"' + s + '"'); } catch (e) { return s; } }
    while ((m = re.exec(html))) {
      var name = dec(m[1]), href = dec(m[2]);
      if (name === '..' || name.charAt(0) === '.') continue;
      var isDir = m[3] === '1';
      if (!isDir && !/\.(md|markdown)$/i.test(name)) continue;
      out.push({ name: name, dir: isDir, url: new URL(href, base).href });
    }
    out.sort(function (a, b) { return (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); });
    return out;
  }
  function showDir(d, curFile) {
    dirUrl = d;
    var list = $('fileList'); $('sideTitle').textContent = dirName(d); $('sideTitle').title = decodeURIComponent(d);
    list.innerHTML = '<li class="msg">Loading\u2026</li>';
    fetch(d, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
      var items = parseListing(t, d);
      list.innerHTML = '';
      var parent = d.replace(/[^/]+\/$/, '');
      if (parent !== d && /^file:\/\/\/[^/]+\/.+/i.test(d)) items.unshift({ name: '..', dir: true, url: parent });
      if (!items.length) list.innerHTML = '<li class="msg">No Markdown files here.</li>';
      items.forEach(function (it) {
        var li = document.createElement('li');
        li.textContent = (it.dir ? '\ud83d\udcc1 ' : '') + it.name; li.title = it.name;
        if (!it.dir && curFile && it.url === curFile) li.className = 'cur';
        li.addEventListener('click', function () { if (it.dir) showDir(it.url, srcUrl); else openSrc(it.url); });
        list.appendChild(li);
      });
    }).catch(function () { list.innerHTML = '<li class="msg">Folder listing unavailable. Make sure \u201cAllow access to file URLs\u201d is on.</li>'; });
  }
  function toggleSide(force) {
    var side = $('side'), show = force === undefined ? side.hidden : force;
    side.hidden = !show; $('sideBtn').classList.toggle('on', show);
    if (show && !dirUrl && srcUrl) showDir(srcUrl.replace(/[^/]*$/, ''), srcUrl);
    setTimeout(fit, 0);
  }

  /* ------------------------------------------------------------------ theme / mode / settings UI */
  function setTheme(t) {
    if (!THEMES.some(function (x) { return x[0] === t; })) t = 'github-light';
    S.theme = t; root.setAttribute('data-theme', t);
    var sel = $('s_theme'); if (sel) sel.value = t;
    fitSoon();
  }
  function cycleTheme() {
    var i = THEMES.findIndex(function (x) { return x[0] === S.theme; });
    setTheme(THEMES[(i + 1) % THEMES.length][0]); saveSettings();
  }
  function toggleMode() {
    var all = body.classList.toggle('all');
    $('modeBtn').textContent = all ? 'Slides' : 'All pages'; $('modeBtn').classList.toggle('on', all);
    var c = cur; render(); if (all) go(c);
  }

  function buildSettings() {
    var h = '';
    SPEC.forEach(function (f) {
      if (f.length === 1) { h += '<h4>' + esc(f[0]) + '</h4>'; return; }
      if (f[0] === '*hint') { h += '<div class="hint">' + esc(f[1]) + '</div>'; return; }
      var k = f[0], id = 's_' + k, ctl;
      if (f[2] === 'select') ctl = '<select id="' + id + '">' + f[3].map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      else if (f[2] === 'check') ctl = '<input type="checkbox" id="' + id + '">';
      else if (f[2] === 'number') ctl = '<input type="number" id="' + id + '" min="' + f[3][0] + '" max="' + f[3][1] + '">';
      else ctl = '<input type="text" id="' + id + '">';
      h += '<div class="row"><label for="' + id + '">' + esc(f[1]) + '</label>' + ctl + '</div>' + (f[4] ? '<div class="hint">' + esc(f[4]) + '</div>' : '');
    });
    $('setBody').innerHTML = h;
    SPEC.forEach(function (f) {
      if (f.length === 1 || f[0] === '*hint') return;
      var k = f[0], el = $('s_' + k);
      el.addEventListener('change', function () {
        S[k] = f[2] === 'check' ? el.checked : f[2] === 'number' ? (parseInt(el.value, 10) || DEFAULTS[k]) : el.value;
        saveSettings(); applySetting(k);
      });
    });
  }
  function fillSettings() {
    SPEC.forEach(function (f) {
      if (f.length === 1 || f[0] === '*hint') return;
      var el = $('s_' + f[0]);
      if (f[2] === 'check') el.checked = !!S[f[0]]; else el.value = S[f[0]];
    });
  }
  function applySetting(k) {
    if (k === 'theme') setTheme(S.theme);
    else if (k === 'split') { if (lastText !== null) load(lastText, docFile, 'live'); }
    else if (k === 'fitMode' || k === 'minScale' || k === 'zoom') fit();
    else if (k === 'tables') { if (lastText !== null) load(lastText, docFile, 'live'); }
    else if (k === 'live' || k === 'pollSec') restartPoll();
    else if (k === 'sidebar') toggleSide(S.sidebar);
  }

  /* ------------------------------------------------------------------ exports */
  function download(name, mime, content) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function cssStr(tpl) {
    var date = new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }), parts = [];
    (tpl || '').split(/(\{page\}|\{pages\})/).forEach(function (seg) {
      if (seg === '{page}') parts.push('counter(page)');
      else if (seg === '{pages}') parts.push('counter(pages)');
      else if (seg) parts.push('"' + seg.replace(/\{doc\}/g, docName).replace(/\{date\}/g, date).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"');
    });
    return parts.join(' ') || '""';
  }
  function printCss() {
    var box = 'font:9pt "Segoe UI",Arial,sans-serif;color:#888;';
    return '@page{size:auto;margin:' + (S.margin || 18) + 'mm;' + [['top-left', 'hl'], ['top-center', 'hc'], ['top-right', 'hr'],
      ['bottom-left', 'fl'], ['bottom-center', 'fc'], ['bottom-right', 'fr']].map(function (x) {
      return '@' + x[0] + '{content:' + cssStr(S[x[1]]) + ';' + box + '}';
    }).join('') + '}';
  }

  function exportHtml() {
    if (!hasDoc) return;
    toast('Building HTML\u2026');
    fetch('viewer.css').then(function (r) { return r.text(); }).then(function (css) {
      var chain = Promise.resolve(), parts = [];
      sections.forEach(function (s) {
        chain = chain.then(function () {
          var t = document.createElement('template');
          t.innerHTML = (s.crumb ? '<div class="crumb">' + esc(s.crumb) + '</div>' : '') + s.html;
          var imgs = [].slice.call(t.content.querySelectorAll('img[data-local]'));
          return Promise.all(imgs.map(function (im) {
            return dataUrl(im.dataset.local).then(function (u) { im.src = u; }).catch(function () { /* leave broken */ });
          })).then(function () {
            t.content.querySelectorAll('[data-local],[data-md]').forEach(function (e) { e.removeAttribute('data-local'); e.removeAttribute('data-md'); });
            parts.push('<section class="page"><div class="markdown-body">' + t.innerHTML.replace(/ id="h-/g, ' id="') + '</div></section>');
          });
        });
      });
      return chain.then(function () {
        var html = '<!doctype html>\n<html lang="en" data-theme="' + S.theme + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<title>' + esc(docName) + '</title><style>' + css + '\n' + printCss() +
          '\nbody{display:block;height:auto}#main{display:block}#stage{position:static}#scroller{position:static;padding:24px}.page{margin-bottom:24px;min-height:0}</style></head>' +
          '<body class="all' + (S.wm ? ' wmon' : '') + '"><div id="scroller">' + parts.join('\n') + '</div><div id="wm">' + esc(S.wmText) + '</div></body></html>';
        download(docName + '.html', 'text/html;charset=utf-8', html);
        toast('Exported ' + docName + '.html');
      });
    }).catch(function () { toast('Export failed'); });
  }

  var printState = null;
  window.addEventListener('beforeprint', function () {
    if (!hasDoc) return;
    printState = { theme: root.getAttribute('data-theme'), title: document.title };
    root.setAttribute('data-theme', S.pdfTheme === 'current' ? S.theme : S.pdfTheme);
    var st = document.createElement('style'); st.id = 'printStyle'; st.textContent = printCss(); document.head.appendChild(st);
    $('wm').textContent = S.wmText; body.classList.toggle('wmon', !!S.wm);
    document.title = docName;
    scroller.querySelectorAll('.page').forEach(function (p) { p.style.display = ''; });
  });
  window.addEventListener('afterprint', function () {
    if (!printState) return;
    root.setAttribute('data-theme', printState.theme); document.title = printState.title;
    var st = $('printStyle'); if (st) st.remove();
    body.classList.remove('wmon'); printState = null; update(false);
  });

  /* ------------------------------------------------------------------ events */
  $('prev').addEventListener('click', function () { go(cur - 1); });
  $('next').addEventListener('click', function () { go(cur + 1); });
  tocSel.addEventListener('change', function () { go(+tocSel.value); tocSel.blur(); });
  $('modeBtn').addEventListener('click', toggleMode);
  $('zIn').addEventListener('click', function () { zoomBy(1); });
  $('zOut').addEventListener('click', function () { zoomBy(-1); });
  $('zPct').addEventListener('click', zoomReset);
  $('fitDef').innerHTML = ICON.actual; $('fitW').innerHTML = ICON.fitW; $('fitH').innerHTML = ICON.fitH;
  $('fitDef').addEventListener('click', function () { setFit('default'); });
  $('fitW').addEventListener('click', function () { setFit('width'); });
  $('fitH').addEventListener('click', function () { setFit('height'); });
  $('ovClose').addEventListener('click', closeTable);
  $('sideBtn').addEventListener('click', function () { toggleSide(); });
  $('sideRefresh').addEventListener('click', function () { if (dirUrl) showDir(dirUrl, srcUrl); });
  $('openBtn').addEventListener('click', function () { var p = prompt('Path or URL of a Markdown file:'); if (p) openPath(p); });
  $('htmlBtn').addEventListener('click', exportHtml);
  $('pdfBtn').addEventListener('click', function () { if (hasDoc) window.print(); });
  $('setBtn').addEventListener('click', function () { fillSettings(); $('setDlg').showModal(); });
  $('setClose').addEventListener('click', function () { $('setDlg').close(); });
  $('helpBtn').addEventListener('click', function () { $('helpDlg').showModal(); });
  $('helpClose').addEventListener('click', function () { $('helpDlg').close(); });
  $('setReset').addEventListener('click', function () { S = Object.assign({}, DEFAULTS); saveSettings(); fillSettings(); setTheme(S.theme); toggleSide(S.sidebar); restartPoll(); if (lastText !== null) load(lastText, docFile, 'live'); fit(); });
  window.addEventListener('resize', fitSoon);

  jump.addEventListener('focus', function () { jump.select(); });
  jump.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var n = parseInt(jump.value, 10); if (!isNaN(n)) go(n - 1); jump.blur(); update(false); }
    else if (e.key === 'Escape') { jump.blur(); update(false); }
    e.stopPropagation();
  });
  jump.addEventListener('blur', function () { if (hasDoc) jump.value = cur + 1; });

  scroller.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = a.getAttribute('href');
    if (h.charAt(0) === '#') {
      e.preventDefault();
      var id; try { id = decodeURIComponent(h.slice(1)); } catch (x) { id = h.slice(1); }
      jumpToId(id.toLowerCase()) || jumpToId(id);
    } else if (a.dataset.md) { e.preventDefault(); openSrc(a.dataset.local); }
    else if (a.dataset.local) { e.preventDefault(); try { chrome.tabs.create({ url: a.dataset.local }); } catch (x) { toast('Cannot open this link'); } }
  });

  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); body.classList.add('dragging'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); body.classList.remove('dragging'); }); });
  document.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () { srcUrl = null; clearInterval(pollTimer); setLive(true); dirUrl = null; load(r.result, f.name); };
    r.readAsText(f);
  });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if (!$('tblOverlay').hidden) { if (e.key === 'Escape') closeTable(); return; }
    if (document.querySelector('dialog[open]')) return;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); go(cur + 1); break;
      case 'ArrowLeft': e.preventDefault(); go(cur - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(sections.length - 1); break;
      case 'g': case 'G': e.preventDefault(); jump.focus(); break;
      case 'a': case 'A': toggleMode(); break;
      case 'b': case 'B': toggleSide(); break;
      case 't': case 'T': cycleTheme(); break;
      case '+': case '=': zoomBy(1); break;
      case '-': case '_': zoomBy(-1); break;
      case '0': case 'd': case 'D': zoomReset(); break;
      case 'w': case 'W': setFit('width'); break;
      case 'h': case 'H': setFit('height'); break;
      case 'o': case 'O': $('openBtn').click(); break;
      case 'f': case 'F': if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen(); break;
      case '?': $('helpDlg').showModal(); break;
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(); });
  window.addEventListener('popstate', function () {
    var q = new URLSearchParams(location.search).get('src');
    if (q) openSrc(q, false);
  });

  /* ------------------------------------------------------------------ start */
  buildSettings();
  loadSettings(function () {
    setTheme(S.theme); fillSettings();
    emptyState();
    var q = new URLSearchParams(location.search).get('src');
    if (q) openSrc(q, false);
    if (S.sidebar) toggleSide(true);
  });
})();
