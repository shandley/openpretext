  (function () {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.reveal').forEach(function (e) { e.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(function (e) { io.observe(e); });
  })();

  // Keep the anchor scroll offset in sync with the actual (variable-height) header.
  var bar = document.querySelector('header.bar');
  if (bar) {
    var syncOffset = function () {
      document.documentElement.style.scrollPaddingTop = (bar.offsetHeight + 8) + 'px';
    };
    window.addEventListener('resize', syncOffset, { passive: true });
    if (window.ResizeObserver) { new ResizeObserver(syncOffset).observe(bar); }
    syncOffset();
  }

  // Scrollspy: mark the nav link for the section currently under the header.
  (function () {
    var links = Array.prototype.slice.call(document.querySelectorAll('.bar-links a[href^="#"]'));
    var items = links.map(function (a) {
      return { a: a, sec: document.getElementById(a.getAttribute('href').slice(1)) };
    }).filter(function (m) { return m.sec; });
    if (!items.length) return;
    var bar = document.querySelector('header.bar');
    function docTop(el) { return el.getBoundingClientRect().top + window.pageYOffset; }
    function update() {
      var barH = bar ? bar.offsetHeight : 56;
      var probe = window.pageYOffset + barH + 12;
      var current = null;
      for (var i = 0; i < items.length; i++) {
        if (docTop(items[i].sec) <= probe) current = items[i];
      }
      links.forEach(function (a) { a.classList.remove('active'); a.removeAttribute('aria-current'); });
      if (current) { current.a.classList.add('active'); current.a.setAttribute('aria-current', 'true'); }
    }
    var ticking = false;
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(function () { update(); ticking = false; }); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  })();

  // Interactive P(s) demo: one slider drives a synthetic contact map and its decay curve.
  (function () {
    var root = document.getElementById('ps-demo');
    if (!root) return;
    var canvas = document.getElementById('ps-map');
    var slider = document.getElementById('ps-exp');
    var valEl = document.getElementById('ps-val');
    var msgEl = document.getElementById('ps-msg');
    var lineEl = document.getElementById('ps-line');
    var dotsEl = document.getElementById('ps-dots');
    if (!canvas || !canvas.getContext || !slider) return;
    var mctx = canvas.getContext('2d');
    var N = canvas.width; // 140

    // Resolve theme tokens to rgb triples (works in light and dark).
    var pc = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;';
    root.appendChild(probe);
    function toRGB(str) {
      // Rasterize to a pixel so any color space (oklch, rgb, hex) resolves to sRGB.
      pc.fillStyle = '#888';
      pc.fillStyle = str;
      pc.fillRect(0, 0, 1, 1);
      var d = pc.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    function token(expr) { probe.style.color = expr; return toRGB(getComputedStyle(probe).color); }
    var cold, hot;
    function readColors() { cold = token('var(--ground)'); hot = token('var(--data)'); }

    // Stable per-cell noise so the map does not flicker between redraws.
    var noise = new Float32Array(N * N);
    for (var i = 0; i < N; i++) {
      for (var j = 0; j < N; j++) {
        var r = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
        noise[i * N + j] = r - Math.floor(r);
      }
    }
    // Stable dot positions for the curve scatter.
    var dots = [];
    for (var k = 0; k < 34; k++) {
      var rk = Math.sin(k * 33.71) * 9999; rk = rk - Math.floor(rk);
      var jk = Math.sin(k * 7.13) * 9999; jk = (jk - Math.floor(jk)) * 2 - 1;
      dots.push({ t: 0.03 + rk * 0.95, j: jk * 6 });
    }

    var img = mctx.createImageData(N, N);
    var data = img.data;
    function drawMap(exp) {
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var d = Math.abs(x - y);
          var base = d === 0 ? 1 : Math.pow(d, exp);
          var t = base * (0.8 + 0.4 * noise[y * N + x]);
          if (t > 1) t = 1; else if (t < 0) t = 0;
          t = Math.pow(t, 0.75);
          var idx = (y * N + x) * 4;
          data[idx] = cold[0] + (hot[0] - cold[0]) * t;
          data[idx + 1] = cold[1] + (hot[1] - cold[1]) * t;
          data[idx + 2] = cold[2] + (hot[2] - cold[2]) * t;
          data[idx + 3] = 255;
        }
      }
      mctx.putImageData(img, 0, 0);
    }

    var X0 = 24, Y0 = 16, X1 = 190, H = 112;
    function yEnd(exp) { return Y0 + (-exp) / 2 * H; }
    function drawPlot(exp) {
      var ye = yEnd(exp);
      lineEl.setAttribute('y2', ye.toFixed(1));
      var slope = (ye - Y0) / (X1 - X0);
      var out = '';
      for (var k = 0; k < dots.length; k++) {
        var cx = X0 + dots[k].t * (X1 - X0);
        var cy = Y0 + slope * (cx - X0) + dots[k].j;
        if (cy < Y0) cy = Y0; if (cy > 127) cy = 127;
        out += '<circle class="ps-dot" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="1.6"/>';
      }
      dotsEl.innerHTML = out;
    }

    var MSG = {
      shallow: 'Too shallow. Contacts barely fade with distance, a hint of poor compaction or a misassembly joining distant regions.',
      healthy: 'Healthy. Contacts fall off the way they do in a well-assembled chromosome.',
      steep: 'Too steep. The signal drops faster than real chromatin, usually a sign of over-corrected data.'
    };
    function fmt(exp) { return '−' + Math.abs(exp).toFixed(2); }
    function render() {
      var exp = parseFloat(slider.value);
      drawMap(exp);
      drawPlot(exp);
      valEl.textContent = fmt(exp);
      var zone = exp > -1.0 ? 'shallow' : (exp >= -1.5 ? 'healthy' : 'steep');
      msgEl.textContent = MSG[zone];
      root.classList.toggle('is-healthy', zone === 'healthy');
    }

    readColors();
    render();
    slider.addEventListener('input', render);
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () { readColors(); render(); };
    if (mq.addEventListener) mq.addEventListener('change', onTheme);
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  })();

  // Compartment / saddle demo: one slider drives a checkerboard map and its saddle plot.
  (function () {
    var root = document.getElementById('cp-demo');
    if (!root) return;
    var mapC = document.getElementById('cp-map');
    var sadC = document.getElementById('cp-saddle');
    var slider = document.getElementById('cp-str');
    var valEl = document.getElementById('cp-val');
    var msgEl = document.getElementById('cp-msg');
    if (!mapC || !mapC.getContext || !sadC || !slider) return;
    var mctx = mapC.getContext('2d');
    var sctx = sadC.getContext('2d');
    var N = mapC.width, S = sadC.width;
    var pc = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;';
    root.appendChild(probe);
    function toRGB(str) { pc.fillStyle = '#888'; pc.fillStyle = str; pc.fillRect(0, 0, 1, 1); var d = pc.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; }
    function tok(expr) { probe.style.color = expr; return toRGB(getComputedStyle(probe).color); }
    var cold, hot;
    function readColors() { cold = tok('var(--ground)'); hot = tok('var(--data)'); }
    function mix(t, i) { return cold[i] + (hot[i] - cold[i]) * t; }

    var ev = new Float32Array(N);
    for (var i = 0; i < N; i++) { ev[i] = Math.sin(i / N * Math.PI * 3); }
    var noise = new Float32Array(N * N);
    for (var a = 0; a < N; a++) { for (var b = 0; b < N; b++) { var r = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; noise[a * N + b] = r - Math.floor(r); } }
    var img = mctx.createImageData(N, N), data = img.data;
    function drawMap(str) {
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var d = Math.abs(x - y);
          var base = d === 0 ? 1 : Math.pow(d, -1.05);
          var comp = ev[x] * ev[y];
          var longRange = Math.exp(-d / (N * 0.7));
          var checker = str * (comp > 0 ? comp : 0) * 0.55 * longRange;
          var t = 0.65 * base + checker;
          t = t * (0.85 + 0.3 * noise[y * N + x]);
          if (t > 1) t = 1; else if (t < 0) t = 0;
          t = Math.pow(t, 0.8);
          var idx = (y * N + x) * 4;
          data[idx] = mix(t, 0); data[idx + 1] = mix(t, 1); data[idx + 2] = mix(t, 2); data[idx + 3] = 255;
        }
      }
      mctx.putImageData(img, 0, 0);
    }
    var K = 10, cat = [];
    for (var c = 0; c < K; c++) { cat.push(-1 + 2 * (c / (K - 1))); }
    function drawSaddle(str) {
      var mn = Infinity, mx = -Infinity, a, b, v;
      for (a = 0; a < K; a++) { for (b = 0; b < K; b++) { v = 1 + str * cat[a] * cat[b]; if (v < mn) mn = v; if (v > mx) mx = v; } }
      var rng = (mx - mn) || 1, cell = S / K;
      sctx.clearRect(0, 0, S, S);
      for (a = 0; a < K; a++) {
        for (b = 0; b < K; b++) {
          v = (1 + str * cat[a] * cat[b] - mn) / rng; v = Math.pow(v, 0.8);
          sctx.fillStyle = 'rgb(' + Math.round(mix(v, 0)) + ',' + Math.round(mix(v, 1)) + ',' + Math.round(mix(v, 2)) + ')';
          sctx.fillRect(Math.floor(b * cell), Math.floor((K - 1 - a) * cell), Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
    var MSG = {
      weak: 'Weak. A and B barely separate; the checkerboard is faint and the saddle corners are flat.',
      typ: 'Typical. Clear compartments, the pattern a well-assembled genome usually shows.',
      strong: 'Strong. A sharp checkerboard, with the saddle corners pulled far apart.'
    };
    function render() {
      var s = parseFloat(slider.value);
      drawMap(s); drawSaddle(s);
      valEl.textContent = s.toFixed(2);
      var zone = s < 0.2 ? 'weak' : (s <= 0.7 ? 'typ' : 'strong');
      msgEl.textContent = MSG[zone];
      root.classList.toggle('is-healthy', zone === 'typ');
    }
    readColors(); render();
    slider.addEventListener('input', render);
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () { readColors(); render(); };
    if (mq.addEventListener) mq.addEventListener('change', onTheme);
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  })();

  // Misassembly signature demo: tabs draw the pattern each error makes on the map.
  (function () {
    var root = document.getElementById('ms-demo');
    if (!root) return;
    var canvas = document.getElementById('ms-map');
    if (!canvas || !canvas.getContext) return;
    var mctx = canvas.getContext('2d');
    var N = canvas.width;
    var pc = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;';
    root.appendChild(probe);
    function toRGB(str) { pc.fillStyle = '#888'; pc.fillStyle = str; pc.fillRect(0, 0, 1, 1); var d = pc.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; }
    function tok(expr) { probe.style.color = expr; return toRGB(getComputedStyle(probe).color); }
    var cold, hot;
    function readColors() { cold = tok('var(--ground)'); hot = tok('var(--data)'); }
    function mix(t, i) { return cold[i] + (hot[i] - cold[i]) * t; }
    var noise = new Float32Array(N * N);
    for (var a = 0; a < N; a++) { for (var b = 0; b < N; b++) { var r = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; noise[a * N + b] = r - Math.floor(r); } }
    var img = mctx.createImageData(N, N), data = img.data;
    function draw(kind) {
      var h = N / 2, s0 = 0.32 * N, s1 = 0.68 * N, mid = (s0 + s1) / 2, bs = N / 6;
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var d = Math.abs(x - y);
          var t = d === 0 ? 1 : Math.pow(d, -1.05);
          if (kind === 'inversion') {
            if (x >= s0 && x <= s1 && y >= s0 && y <= s1) {
              var anti = Math.exp(-Math.pow(((x + y) / 2 - mid) / (0.045 * N), 2));
              if (0.92 * anti > t) t = 0.92 * anti;
            }
          } else if (kind === 'wrongjoin') {
            if ((x < h) !== (y < h)) t *= 0.05;
          } else if (kind === 'chimera') {
            var w = 0.02 * N;
            if (Math.abs(x - h) < w || Math.abs(y - h) < w) t *= 0.06;
            if ((x < h) !== (y < h)) t *= 0.3;
          } else if (kind === 'fragmented') {
            if (Math.floor(x / bs) !== Math.floor(y / bs)) t *= 0.1 + 0.16 * noise[y * N + x];
          }
          t = t * (0.85 + 0.3 * noise[y * N + x]);
          if (t > 1) t = 1; else if (t < 0) t = 0;
          t = Math.pow(t, 0.8);
          var idx = (y * N + x) * 4;
          data[idx] = mix(t, 0); data[idx + 1] = mix(t, 1); data[idx + 2] = mix(t, 2); data[idx + 3] = 255;
        }
      }
      mctx.putImageData(img, 0, 0);
    }
    var INFO = {
      inversion: { title: 'Inversion', see: 'A bright streak running against the diagonal, a butterfly or bow-tie crossing the main line.', act: 'Flip the reversed segment. Select the contig and press F.' },
      wrongjoin: { title: 'Wrong join', see: 'Two blocks meeting at a point on the diagonal with a dark square between them, so there is no contact across the join.', act: 'Cut at the junction. The two pieces belong to different chromosomes.' },
      chimera: { title: 'Chimera', see: 'A dark cross inside a single contig, splitting it into two squares that barely talk to each other.', act: 'Cut the contig at the break. It was built from two different places.' },
      fragmented: { title: 'Fragmented', see: 'Many small blocks scattered along the diagonal instead of a few large chromosome squares.', act: 'Order and join the pieces, then scaffold them. Auto-sort does most of it.' }
    };
    var tabs = root.querySelectorAll('.ms-tab');
    var capEl = document.getElementById('ms-cap');
    var titleEl = document.getElementById('ms-title');
    var seeEl = document.getElementById('ms-see');
    var doEl = document.getElementById('ms-do');
    function select(kind, btn) {
      for (var i = 0; i < tabs.length; i++) { tabs[i].classList.remove('is-active'); }
      if (btn) btn.classList.add('is-active');
      draw(kind);
      var info = INFO[kind];
      capEl.textContent = info.title; titleEl.textContent = info.title; seeEl.textContent = info.see; doEl.textContent = info.act;
    }
    for (var i = 0; i < tabs.length; i++) {
      (function (t) { t.addEventListener('click', function () { select(t.getAttribute('data-kind'), t); }); })(tabs[i]);
    }
    function currentKind() { var el = root.querySelector('.ms-tab.is-active'); return el ? el.getAttribute('data-kind') : 'inversion'; }
    readColors(); select('inversion', tabs[0]);
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () { readColors(); draw(currentKind()); };
    if (mq.addEventListener) mq.addEventListener('change', onTheme);
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  })();

  // Join support demo: a slider weakens the contact across a junction; a threshold flags it,
  // and a scaffold toggle turns the same depletion into an intended, unflagged boundary.
  (function () {
    var root = document.getElementById('join-demo');
    if (!root) return;
    var mapC = document.getElementById('join-map');
    var crossC = document.getElementById('join-cross');
    var slider = document.getElementById('join-sig');
    var scaffold = document.getElementById('join-scaffold');
    var stateEl = document.getElementById('join-state');
    var msgEl = document.getElementById('join-msg');
    if (!mapC || !mapC.getContext || !crossC || !crossC.getContext || !slider) return;
    var mctx = mapC.getContext('2d');
    var xctx = crossC.getContext('2d');
    var N = mapC.width, h = N / 2;
    var pc = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;';
    root.appendChild(probe);
    function toRGB(str) { pc.fillStyle = '#888'; pc.fillStyle = str; pc.fillRect(0, 0, 1, 1); var d = pc.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; }
    function tok(expr) { probe.style.color = expr; return toRGB(getComputedStyle(probe).color); }
    var cold, hot, faint, ground;
    function readColors() { cold = tok('var(--ground)'); hot = tok('var(--data)'); faint = tok('var(--ink-faint)'); ground = tok('var(--ground)'); }
    function mix(t, i) { return cold[i] + (hot[i] - cold[i]) * t; }
    function rgb(a) { return 'rgb(' + Math.round(a[0]) + ',' + Math.round(a[1]) + ',' + Math.round(a[2]) + ')'; }

    var THRESH = 0.35;
    function crossFactor(sig) { return 0.04 + 0.96 * sig; }

    var noise = new Float32Array(N * N);
    for (var a = 0; a < N; a++) { for (var b = 0; b < N; b++) { var r = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; noise[a * N + b] = r - Math.floor(r); } }
    var img = mctx.createImageData(N, N), data = img.data;

    function drawMap(sig, flagged) {
      var cf = crossFactor(sig);
      for (var y = 0; y < N; y++) {
        for (var x = 0; x < N; x++) {
          var d = Math.abs(x - y);
          var base = d === 0 ? 1 : Math.pow(d, -1.05);
          var same = (x < h) === (y < h);
          var t = same ? base : base * cf;
          t = t * (0.85 + 0.3 * noise[y * N + x]);
          if (t > 1) t = 1; else if (t < 0) t = 0;
          t = Math.pow(t, 0.8);
          var idx = (y * N + x) * 4;
          data[idx] = mix(t, 0); data[idx + 1] = mix(t, 1); data[idx + 2] = mix(t, 2); data[idx + 3] = 255;
        }
      }
      mctx.putImageData(img, 0, 0);
      // Faint, always-visible boundary lines so a supported join still reads as a junction.
      mctx.strokeStyle = 'rgba(' + Math.round(faint[0]) + ',' + Math.round(faint[1]) + ',' + Math.round(faint[2]) + ',0.55)';
      mctx.lineWidth = 1;
      mctx.beginPath(); mctx.moveTo(h + 0.5, 0); mctx.lineTo(h + 0.5, N); mctx.moveTo(0, h + 0.5); mctx.lineTo(N, h + 0.5); mctx.stroke();
      if (flagged) drawFlag(mctx, h, h);
    }

    // Red marker at the junction, outlined in the ground colour so it reads on a dark square.
    function drawFlag(ctx, cx, cy) {
      var s = 7;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s, cy);
      ctx.closePath();
      ctx.fillStyle = rgb(hot);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = rgb(ground);
      ctx.fill();
      ctx.stroke();
    }

    // Cross-boundary profile: contact from an anchor inside contig A as we move across the seam.
    var anchor = h - 6, M = 14, plotH = N - 2 * M;
    function drawCross(sig, flagged) {
      var cf = crossFactor(sig);
      xctx.clearRect(0, 0, N, N);
      xctx.fillStyle = rgb(cold);
      xctx.fillRect(0, 0, N, N);
      // baseline + junction line
      xctx.strokeStyle = 'rgba(' + Math.round(faint[0]) + ',' + Math.round(faint[1]) + ',' + Math.round(faint[2]) + ',0.5)';
      xctx.lineWidth = 1;
      xctx.beginPath(); xctx.moveTo(4, N - M + 0.5); xctx.lineTo(N - 4, N - M + 0.5);
      xctx.moveTo(h + 0.5, M - 4); xctx.lineTo(h + 0.5, N - M + 4); xctx.stroke();
      function vy(x) {
        var d = Math.abs(x - anchor);
        var v = d === 0 ? 1 : Math.pow(d, -1.05);
        if (x >= h) v *= cf;
        v = Math.pow(v < 0 ? 0 : (v > 1 ? 1 : v), 0.5);
        return (N - M) - v * plotH;
      }
      // filled area under the curve
      xctx.beginPath();
      xctx.moveTo(4, N - M);
      for (var x = 4; x <= N - 4; x++) { xctx.lineTo(x, vy(x)); }
      xctx.lineTo(N - 4, N - M);
      xctx.closePath();
      xctx.fillStyle = 'rgba(' + Math.round(hot[0]) + ',' + Math.round(hot[1]) + ',' + Math.round(hot[2]) + ',0.16)';
      xctx.fill();
      // the curve
      xctx.beginPath();
      for (var x2 = 4; x2 <= N - 4; x2++) { if (x2 === 4) xctx.moveTo(x2, vy(x2)); else xctx.lineTo(x2, vy(x2)); }
      xctx.strokeStyle = rgb(hot); xctx.lineWidth = 2.2; xctx.lineJoin = 'round'; xctx.stroke();
      if (flagged) drawFlag(xctx, h, vy(h + 1));
    }

    var MSG = {
      supported: 'Contact carries across the seam about as strongly as it holds inside each contig. The join looks real.',
      weak: 'Contact falls away across the boundary, the dark square at the junction. Inside one scaffold that is a wrong join or a misorder, worth a cut or a reorder.',
      boundary: 'These contigs are on different scaffolds, so the drop is expected. This is an intended chromosome boundary and stays unflagged even though contact is depleted across it.'
    };
    function render() {
      var sig = parseFloat(slider.value);
      var depleted = sig < THRESH;
      var isBoundary = scaffold.checked;
      var flagged = depleted && !isBoundary;
      drawMap(sig, flagged);
      drawCross(sig, flagged);
      stateEl.classList.remove('is-supported', 'is-weak', 'is-boundary');
      if (isBoundary) {
        stateEl.classList.add('is-boundary');
        stateEl.textContent = 'Intended boundary';
        msgEl.textContent = MSG.boundary;
      } else if (flagged) {
        stateEl.classList.add('is-weak');
        stateEl.textContent = 'Weak join flagged';
        msgEl.textContent = MSG.weak;
      } else {
        stateEl.classList.add('is-supported');
        stateEl.textContent = 'Supported';
        msgEl.textContent = MSG.supported;
      }
    }
    readColors(); render();
    slider.addEventListener('input', render);
    scaffold.addEventListener('change', render);
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () { readColors(); render(); };
    if (mq.addEventListener) mq.addEventListener('change', onTheme);
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  })();
