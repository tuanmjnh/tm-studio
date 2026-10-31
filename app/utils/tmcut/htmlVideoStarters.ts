/**
 * Starter compositions for the HTML/CSS video studio.
 *
 * Every starter is a self-contained HTML document that follows the HyperFrames
 * contract (heygen-com/hyperframes, Apache-2.0): a `data-composition-id` root
 * and `window.__hf = { duration, seek(t) }`. The renderer seeks the document
 * frame by frame, so motion is a pure function of `t` — no requestAnimationFrame,
 * no CSS transitions, no Math.random. Each document is dependency-free (no CDN,
 * no fonts to download) so it renders identically offline and inside the
 * sandboxed preview iframe.
 *
 * These live in the host app, not in @tmcut/core: the core boundary check
 * forbids `window.`/`document.` in core sources (see tools/check-boundaries.mjs),
 * and a starter without a browser is not a composition.
 *
 * Sizing: the renderer sets the viewport to exactly width × height, so every
 * starter lays out in vw/vh and stays crisp at 1080p or 4K.
 */

export interface HtmlVideoStarterVariable {
  key: string
  label: string
  value: string
}

export interface HtmlVideoStarter {
  id: string
  name: string
  summary: string
  aspect: '9:16' | '16:9' | '1:1' | '4:5'
  width: number
  height: number
  fps: number
  durationSec: number
  /** Industry ids from @tmcut-core's INDUSTRY_CATALOG. `general` fits anything. */
  industries: string[]
  tags: string[]
  variables: HtmlVideoStarterVariable[]
  html: string
}

const kineticTitle = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kinetic title</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #07070d; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; justify-content: center; padding: 0 9vw; }
  .grid { position: absolute; inset: -4vw; background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px); background-size: 6.5vw 6.5vw; }
  .glow { position: absolute; width: 90vw; height: 90vw; border-radius: 50%; left: -20vw; top: -12vh; background: radial-gradient(circle at 35% 35%, var(--accent), transparent 64%); opacity: .5; filter: blur(5vw); }
  .eyebrow { position: relative; font-size: 2.9vw; letter-spacing: .4em; text-transform: uppercase; color: var(--accent); margin-bottom: 4.5vh; font-weight: 600; }
  h1 { position: relative; font-size: 11.6vw; line-height: 1.03; font-weight: 800; letter-spacing: -.025em; }
  .word { display: inline-block; will-change: transform, opacity, filter; }
  .bar { position: relative; height: .85vh; width: 22vw; background: var(--accent); margin-top: 5.5vh; border-radius: 999px; transform-origin: left center; }
  p { position: relative; margin-top: 4vh; font-size: 3.5vw; line-height: 1.45; color: rgba(255,255,255,.72); max-width: 80vw; }
</style>
</head>
<body>
<div id="root" data-composition-id="kinetic-title" data-start="0" data-width="1080" data-height="1920" data-duration="4">
  <div class="grid" id="grid"></div>
  <div class="glow" id="glow"></div>
  <div class="eyebrow" id="eyebrow">{{eyebrow}}</div>
  <h1 id="title">{{title}}</h1>
  <div class="bar" id="bar"></div>
  <p id="subtitle">{{subtitle}}</p>
</div>
<script>
(function () {
  var DURATION = 4;
  var title = document.getElementById('title');
  var words = title.textContent.trim().split(' ').filter(function (part) { return part.length > 0; });
  title.textContent = '';
  var spans = words.map(function (value) {
    var span = document.createElement('span');
    span.className = 'word';
    span.textContent = value;
    title.appendChild(span);
    title.appendChild(document.createTextNode(' '));
    return span;
  });
  var eyebrow = document.getElementById('eyebrow');
  var subtitle = document.getElementById('subtitle');
  var bar = document.getElementById('bar');
  var glow = document.getElementById('glow');
  var grid = document.getElementById('grid');

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }
  function fadeOut(t) { return easeOutCubic(clamp01((t - (DURATION - 0.65)) / 0.55)); }

  function seek(t) {
    var p = clamp01(t / DURATION);
    grid.style.transform = 'translate(' + (-p * 26) + 'px, ' + (-p * 26) + 'px)';
    glow.style.transform = 'translate(' + (p * 44) + 'px, ' + (p * 70) + 'px) scale(' + (1 + p * 0.12) + ')';
    eyebrow.style.opacity = easeOutCubic(clamp01(t / 0.55)) * (1 - fadeOut(t));
    for (var i = 0; i < spans.length; i += 1) {
      var k = easeOutCubic(clamp01((t - 0.25 - i * 0.09) / 0.6));
      spans[i].style.opacity = k;
      spans[i].style.transform = 'translateY(' + ((1 - k) * 74) + 'px)';
      spans[i].style.filter = 'blur(' + ((1 - k) * 12).toFixed(2) + 'px)';
    }
    bar.style.transform = 'scaleX(' + easeOutCubic(clamp01((t - 0.9) / 0.5)) + ')';
    bar.style.opacity = 1 - fadeOut(t);
    var sub = easeOutCubic(clamp01((t - 1.25) / 0.6));
    subtitle.style.opacity = sub * (1 - fadeOut(t) * 0.85);
    subtitle.style.transform = 'translateY(' + ((1 - sub) * 26) + 'px)';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const productFeatures = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Product features</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0b10; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; align-items: center; gap: 4.5vw; padding: 8vh 6vw; }
  .wash { position: absolute; width: 70vw; height: 70vw; border-radius: 50%; right: -26vw; top: -28vw; background: radial-gradient(circle, var(--accent), transparent 62%); opacity: .35; filter: blur(7vw); }
  .left { position: relative; width: 40%; }
  .kicker { font-size: 1.15vw; letter-spacing: .34em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin-bottom: 2.6vh; }
  h1 { font-size: 4.4vw; line-height: 1.06; font-weight: 800; letter-spacing: -.02em; }
  .left p { margin-top: 2.4vh; font-size: 1.35vw; line-height: 1.6; color: rgba(255,255,255,.6); max-width: 32vw; }
  .cards { position: relative; flex: 1; display: flex; flex-direction: column; gap: 1.9vh; }
  .card { display: flex; align-items: center; gap: 1.6vw; padding: 2.4vh 2vw; border-radius: 1.1vw; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.09); }
  .icon { flex: 0 0 auto; width: 4.2vw; height: 4.2vw; border-radius: 1vw; display: flex; align-items: center; justify-content: center; font-size: 1.7vw; background: color-mix(in srgb, var(--accent) 22%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 46%, transparent); }
  .card h2 { font-size: 1.65vw; font-weight: 700; margin-bottom: .7vh; }
  .card p { font-size: 1.15vw; line-height: 1.5; color: rgba(255,255,255,.58); }
  .rule { position: absolute; left: 0; bottom: 6.5vh; height: 2px; width: 44vw; background: linear-gradient(90deg, var(--accent), rgba(255,255,255,0)); opacity: .55; transform-origin: left center; }
</style>
</head>
<body>
<div id="root" data-composition-id="product-features" data-start="0" data-width="1920" data-height="1080" data-duration="6">
  <div class="wash" id="wash"></div>
  <div class="left">
    <div class="kicker" id="kicker">{{kicker}}</div>
    <h1 id="heading">{{heading}}</h1>
    <p id="blurb">{{blurb}}</p>
  </div>
  <div class="cards" id="cards">
    <div class="card" data-card="0"><div class="icon">&#10022;</div><div><h2>{{feature1}}</h2><p>{{detail1}}</p></div></div>
    <div class="card" data-card="1"><div class="icon">&#9889;</div><div><h2>{{feature2}}</h2><p>{{detail2}}</p></div></div>
    <div class="card" data-card="2"><div class="icon">&#9672;</div><div><h2>{{feature3}}</h2><p>{{detail3}}</p></div></div>
  </div>
  <div class="rule" id="rule"></div>
</div>
<script>
(function () {
  var DURATION = 6;
  var wash = document.getElementById('wash');
  var kicker = document.getElementById('kicker');
  var heading = document.getElementById('heading');
  var blurb = document.getElementById('blurb');
  var rule = document.getElementById('rule');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }
  function easeOutBack(x) { var c = 1.70158; var p = x - 1; return 1 + (c + 1) * p * p * p + c * p * p; }
  function exit(t) { return easeOutCubic(clamp01((t - (DURATION - 0.7)) / 0.6)); }

  function seek(t) {
    var p = clamp01(t / DURATION);
    wash.style.transform = 'translate(' + (-p * 60) + 'px, ' + (p * 40) + 'px)';
    var head = easeOutCubic(clamp01(t / 0.7));
    kicker.style.opacity = head;
    heading.style.opacity = head;
    heading.style.transform = 'translateY(' + ((1 - head) * 40) + 'px)';
    var blurbIn = easeOutCubic(clamp01((t - 0.35) / 0.6));
    blurb.style.opacity = blurbIn;
    blurb.style.transform = 'translateY(' + ((1 - blurbIn) * 24) + 'px)';
    rule.style.transform = 'scaleX(' + easeOutCubic(clamp01((t - 0.5) / 1.2)) + ')';
    for (var i = 0; i < cards.length; i += 1) {
      var k = easeOutBack(clamp01((t - 0.55 - i * 0.32) / 0.75));
      var opacity = clamp01((t - 0.55 - i * 0.32) / 0.5);
      cards[i].style.opacity = opacity * (1 - exit(t));
      cards[i].style.transform = 'translateX(' + ((1 - k) * 90) + 'px)';
    }
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const priceReveal = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Price reveal</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0b0710; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10vh 8vw; text-align: center; }
  .halo { position: absolute; width: 120vw; height: 120vw; border-radius: 50%; left: -10vw; top: 12vh; background: radial-gradient(circle, color-mix(in srgb, var(--accent) 55%, transparent), transparent 58%); opacity: .5; filter: blur(9vw); }
  .brand { position: absolute; top: 8vh; font-size: 2.6vw; letter-spacing: .45em; text-transform: uppercase; color: rgba(255,255,255,.5); font-weight: 600; }
  .badge { position: relative; padding: 1.5vh 3.4vw; border-radius: 999px; background: var(--accent); color: #0b0710; font-size: 2.9vw; font-weight: 800; letter-spacing: .04em; margin-bottom: 4.5vh; }
  .product { position: relative; font-size: 4.4vw; font-weight: 600; color: rgba(255,255,255,.86); margin-bottom: 2.4vh; }
  .old { position: relative; font-size: 5.4vw; color: rgba(255,255,255,.42); text-decoration: line-through; text-decoration-thickness: .35vw; margin-bottom: 1.2vh; }
  .price { position: relative; font-size: 18vw; font-weight: 800; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; text-shadow: 0 0 9vw color-mix(in srgb, var(--accent) 70%, transparent); }
  .cta { position: absolute; bottom: 9vh; padding: 2.2vh 5vw; border-radius: 999px; border: 2px solid rgba(255,255,255,.28); font-size: 3vw; font-weight: 600; color: rgba(255,255,255,.92); }
</style>
</head>
<body>
<div id="root" data-composition-id="price-reveal" data-start="0" data-width="1080" data-height="1920" data-duration="5">
  <div class="halo" id="halo"></div>
  <div class="brand">{{brand}}</div>
  <div class="badge" id="badge">{{badge}}</div>
  <div class="product" id="product">{{product}}</div>
  <div class="old" id="old">{{oldPrice}}</div>
  <div class="price" id="price">{{newPrice}}</div>
  <div class="cta" id="cta">{{cta}}</div>
</div>
<script>
(function () {
  var DURATION = 5;
  var halo = document.getElementById('halo');
  var badge = document.getElementById('badge');
  var product = document.getElementById('product');
  var old = document.getElementById('old');
  var price = document.getElementById('price');
  var cta = document.getElementById('cta');

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }
  function easeOutBack(x) { var c = 2.4; var p = x - 1; return 1 + (c + 1) * p * p * p + c * p * p; }

  function seek(t) {
    var p = clamp01(t / DURATION);
    halo.style.transform = 'translate(0,' + (Math.sin(p * Math.PI) * -6) + 'vh) scale(' + (1 + p * 0.1) + ')';
    var productIn = easeOutCubic(clamp01(t / 0.55));
    product.style.opacity = productIn;
    product.style.transform = 'translateY(' + ((1 - productIn) * 30) + 'px)';
    var oldIn = easeOutCubic(clamp01((t - 0.55) / 0.45));
    old.style.opacity = oldIn * 0.9;
    var priceIn = easeOutBack(clamp01((t - 0.95) / 0.7));
    price.style.opacity = clamp01((t - 0.95) / 0.4);
    price.style.transform = 'scale(' + (0.6 + priceIn * 0.4) + ')';
    var badgeIn = easeOutBack(clamp01((t - 1.55) / 0.5));
    badge.style.opacity = clamp01((t - 1.55) / 0.3);
    badge.style.transform = 'translateY(' + ((1 - badgeIn) * 50) + 'px) rotate(-3deg)';
    var ctaIn = easeOutCubic(clamp01((t - 2.1) / 0.6));
    cta.style.opacity = ctaIn;
    cta.style.transform = 'translateY(' + ((1 - ctaIn) * 26) + 'px)';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const statCounter = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Stat counter</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #08090f; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; justify-content: center; padding: 0 9vw; }
  .ring { position: absolute; width: 78vw; height: 78vw; border-radius: 50%; right: -30vw; top: -18vw; border: 1px solid rgba(255,255,255,.07); }
  .ring.two { width: 58vw; height: 58vw; right: -20vw; top: -8vw; }
  .accent { position: absolute; width: 3px; height: 46vh; left: 9vw; top: 27vh; background: var(--accent); opacity: .85; }
  .label { position: relative; margin-left: 5vw; font-size: 1.4vw; letter-spacing: .38em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  .value { position: relative; margin-left: 4.4vw; font-size: 17vw; font-weight: 800; line-height: 1; letter-spacing: -.045em; font-variant-numeric: tabular-nums; }
  .suffix { font-size: 9vw; color: var(--accent); }
  .caption { position: relative; margin-left: 5vw; margin-top: 3vh; font-size: 2vw; line-height: 1.5; color: rgba(255,255,255,.62); max-width: 46vw; }
  .track { position: relative; margin-left: 5vw; margin-top: 5vh; width: 42vw; height: .8vh; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; }
  .fill { height: 100%; width: 100%; background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 40%, #ffffff)); transform-origin: left center; }
</style>
</head>
<body>
<div id="root" data-composition-id="stat-counter" data-start="0" data-width="1920" data-height="1080" data-duration="5">
  <div class="ring"></div>
  <div class="ring two"></div>
  <div class="accent" id="accent"></div>
  <div class="label" id="label">{{label}}</div>
  <div class="value"><span id="value">0</span><span class="suffix">{{suffix}}</span></div>
  <div class="caption" id="caption">{{caption}}</div>
  <div class="track"><div class="fill" id="fill"></div></div>
</div>
<script>
(function () {
  var DURATION = 5;
  var accent = document.getElementById('accent');
  var label = document.getElementById('label');
  var value = document.getElementById('value');
  var caption = document.getElementById('caption');
  var fill = document.getElementById('fill');
  var target = Number('{{value}}'.replace(/[^0-9.]/g, '')) || 0;
  var decimals = ('{{value}}'.split('.')[1] || '').replace(/[^0-9]/g, '').length;
  var grouped = ('{{value}}'.indexOf(',') >= 0);

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }
  function format(n) {
    var rounded = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
    if (!grouped) return rounded;
    var parts = rounded.split('.');
    parts[0] = parts[0].replace(/[0-9]+/, function (digits) {
      var out = '';
      for (var i = 0; i < digits.length; i += 1) {
        if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
        out += digits.charAt(i);
      }
      return out;
    });
    return parts.join('.');
  }

  function seek(t) {
    accent.style.transform = 'scaleY(' + easeOutCubic(clamp01(t / 0.6)) + ')';
    accent.style.opacity = 1 - easeOutCubic(clamp01((t - (DURATION - 0.55)) / 0.5));
    var head = easeOutCubic(clamp01(t / 0.55));
    label.style.opacity = head;
    var count = easeOutCubic(clamp01((t - 0.25) / 1.9));
    value.textContent = format(target * count);
    var cap = easeOutCubic(clamp01((t - 0.9) / 0.7));
    caption.style.opacity = cap;
    caption.style.transform = 'translateY(' + ((1 - cap) * 20) + 'px)';
    fill.style.transform = 'scaleX(' + clamp01((t - 0.3) / 2.2) + ')';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const lowerThird = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lower third</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0c0d12; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; background: radial-gradient(120% 90% at 78% 18%, #1c2030 0%, #0c0d12 58%); }
  .vignette { position: absolute; inset: 0; background: radial-gradient(80% 60% at 50% 45%, transparent 40%, rgba(0,0,0,.55) 100%); }
  .tag { position: absolute; top: 8vh; left: 7vw; display: flex; align-items: center; gap: .9vw; font-size: 1.05vw; letter-spacing: .3em; text-transform: uppercase; color: rgba(255,255,255,.6); font-weight: 700; }
  .dot { width: .8vw; height: .8vw; border-radius: 50%; background: #ff3b5c; box-shadow: 0 0 1.4vw #ff3b5c; }
  .lower { position: absolute; left: 7vw; bottom: 13vh; display: flex; align-items: stretch; }
  .edge { width: .55vw; background: var(--accent); border-radius: 999px; transform-origin: bottom center; }
  .panel { position: relative; padding: 2.6vh 2.6vw 2.6vh 2.2vw; background: rgba(10,11,16,.82); backdrop-filter: blur(2vw); border: 1px solid rgba(255,255,255,.09); border-left: none; border-radius: 0 1.1vw 1.1vw 0; overflow: hidden; }
  .panel .shine { position: absolute; inset: 0; background: linear-gradient(100deg, color-mix(in srgb, var(--accent) 26%, transparent), transparent 58%); transform-origin: left center; }
  .name { position: relative; font-size: 3.2vw; font-weight: 800; letter-spacing: -.015em; }
  .role { position: relative; margin-top: .9vh; font-size: 1.35vw; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  .brand { position: absolute; right: 7vw; bottom: 13vh; font-size: 1.15vw; letter-spacing: .3em; text-transform: uppercase; color: rgba(255,255,255,.4); font-weight: 700; }
</style>
</head>
<body>
<div id="root" data-composition-id="lower-third" data-start="0" data-width="1920" data-height="1080" data-duration="6">
  <div class="vignette"></div>
  <div class="tag"><span class="dot" id="dot"></span>{{tag}}</div>
  <div class="lower">
    <div class="edge" id="edge"></div>
    <div class="panel" id="panel">
      <div class="shine" id="shine"></div>
      <div class="name">{{name}}</div>
      <div class="role">{{role}}</div>
    </div>
  </div>
  <div class="brand">{{brand}}</div>
</div>
<script>
(function () {
  var DURATION = 6;
  var edge = document.getElementById('edge');
  var panel = document.getElementById('panel');
  var shine = document.getElementById('shine');
  var dot = document.getElementById('dot');

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }
  function easeInCubic(x) { return x * x * x; }

  function seek(t) {
    var inK = easeOutCubic(clamp01((t - 0.25) / 0.55));
    var outK = easeInCubic(clamp01((t - (DURATION - 0.85)) / 0.6));
    var show = inK * (1 - outK);
    edge.style.transform = 'scaleY(' + (0.001 + show) + ')';
    panel.style.opacity = show;
    panel.style.transform = 'translateX(' + ((1 - inK) * -40 + outK * -70) + 'px)';
    shine.style.transform = 'translateX(' + (-100 + easeOutCubic(clamp01((t - 0.55) / 1.5)) * 220) + '%)';
    var pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.6);
    dot.style.opacity = 0.45 + pulse * 0.55;
    dot.style.transform = 'scale(' + (1 + pulse * 0.28) + ')';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const gradientLoop = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gradient loop</title>
<style>
  :root { --accent: {{accent}}; --accent2: {{accent2}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #05060a; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  .blob { position: absolute; border-radius: 50%; filter: blur(11vw); opacity: .85; mix-blend-mode: screen; will-change: transform; }
  .b1 { width: 78vw; height: 78vw; left: -12vw; top: 6vh; background: radial-gradient(circle, var(--accent), transparent 66%); }
  .b2 { width: 70vw; height: 70vw; right: -16vw; top: 30vh; background: radial-gradient(circle, var(--accent2), transparent 66%); }
  .b3 { width: 62vw; height: 62vw; left: 16vw; bottom: -18vh; background: radial-gradient(circle, #ffffff, transparent 62%); opacity: .3; }
  .grain { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.35), transparent 30%, transparent 70%, rgba(0,0,0,.5)); }
  .word { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 2.2vh; }
  .brand { font-size: 8.2vw; font-weight: 800; letter-spacing: -.03em; text-shadow: 0 1.2vw 4vw rgba(0,0,0,.45); }
  .sub { font-size: 1.9vw; letter-spacing: .5em; text-transform: uppercase; color: rgba(255,255,255,.72); font-weight: 600; }
</style>
</head>
<body>
<div id="root" data-composition-id="gradient-loop" data-start="0" data-width="1080" data-height="1920" data-duration="6">
  <div class="blob b1" id="b1"></div>
  <div class="blob b2" id="b2"></div>
  <div class="blob b3" id="b3"></div>
  <div class="grain"></div>
  <div class="word" id="word">
    <div class="brand">{{brand}}</div>
    <div class="sub">{{tagline}}</div>
  </div>
</div>
<script>
(function () {
  var DURATION = 6;
  var b1 = document.getElementById('b1');
  var b2 = document.getElementById('b2');
  var b3 = document.getElementById('b3');
  var word = document.getElementById('word');
  var TAU = Math.PI * 2;

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }

  function seek(t) {
    var phase = (t / DURATION) * TAU;
    b1.style.transform = 'translate(' + (Math.sin(phase) * 7) + 'vw, ' + (Math.cos(phase) * 9) + 'vh) scale(' + (1 + Math.sin(phase) * 0.07) + ')';
    b2.style.transform = 'translate(' + (Math.sin(phase + 2.1) * 9) + 'vw, ' + (Math.cos(phase + 2.1) * 6) + 'vh) scale(' + (1 + Math.cos(phase + 2.1) * 0.08) + ')';
    b3.style.transform = 'translate(' + (Math.sin(phase + 4.2) * 6) + 'vw, ' + (Math.cos(phase + 4.2) * 7) + 'vh)';
    var wordIn = easeOutCubic(clamp01(t / 1.2));
    word.style.opacity = wordIn;
    word.style.transform = 'translateY(' + ((1 - wordIn) * 3) + 'vh)';
    word.style.letterSpacing = (0.02 - wordIn * 0.02) + 'em';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const blankComposition = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Blank composition</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0a0f; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 8vw; }
  h1 { font-size: 9vw; font-weight: 800; letter-spacing: -.02em; }
</style>
</head>
<body>
<div id="root" data-composition-id="blank" data-start="0" data-width="1080" data-height="1920" data-duration="3">
  <h1 id="title">{{title}}</h1>
</div>
<script>
(function () {
  var DURATION = 3;
  var title = document.getElementById('title');

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }

  function seek(t) {
    var k = easeOutCubic(clamp01(t / 0.9));
    title.style.opacity = k;
    title.style.transform = 'translateY(' + ((1 - k) * 40) + 'px)';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const voiceCaptions = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Voice captions</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #04050a; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; justify-content: flex-end; padding: 0 8vw 13vh; }
  .glow { position: absolute; width: 130vw; height: 130vw; left: 50%; bottom: -78vw; margin-left: -65vw; border-radius: 50%; background: radial-gradient(circle, var(--accent), transparent 62%); opacity: .3; filter: blur(6vw); }
  .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(4,5,10,.2) 0%, rgba(4,5,10,.05) 45%, rgba(4,5,10,.72) 100%); }
  .eyebrow { position: absolute; top: 11vh; left: 8vw; font-size: 2.6vw; letter-spacing: .38em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  .caption { position: relative; font-size: 7.4vw; line-height: 1.26; font-weight: 800; letter-spacing: -.012em; }
  .w { display: inline-block; color: #fff; opacity: .3; will-change: opacity, transform; }
  .track { position: absolute; left: 8vw; right: 8vw; bottom: 7vh; height: .55vh; background: rgba(255,255,255,.14); border-radius: 999px; overflow: hidden; }
  .fill { width: 100%; height: 100%; background: var(--accent); transform-origin: left center; transform: scaleX(0); }
</style>
</head>
<body>
<div id="root" data-composition-id="voice-captions" data-cues="{{cues}}" data-start="0" data-width="1080" data-height="1920" data-duration="5">
  <div class="glow"></div>
  <div class="scrim"></div>
  <div class="eyebrow" id="eyebrow">{{eyebrow}}</div>
  <div class="caption" id="caption"></div>
  <div class="track"><div class="fill" id="fill"></div></div>
</div>
<script>
(function () {
  var DURATION = 5;
  var root = document.getElementById('root');
  var caption = document.getElementById('caption');
  var eyebrow = document.getElementById('eyebrow');
  var fill = document.getElementById('fill');

  // Cues arrive as a JSON array in a data attribute: the studio escapes
  // variable values, and attribute entities are decoded by the parser, so the
  // JSON survives without a second unescape step.
  var cues = [];
  try {
    var raw = JSON.parse(root.getAttribute('data-cues') || '[]');
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i += 1) {
        var cue = raw[i] || {};
        var text = String(cue.text == null ? '' : cue.text).trim();
        var start = Math.max(0, Number(cue.start) || 0);
        var end = Number(cue.end) || 0;
        if (text && end > start) cues.push({ start: start, end: end, words: text.split(/\\s+/) });
      }
    }
  } catch (err) {
    cues = [];
  }
  cues.sort(function (a, b) { return a.start - b.start; });
  if (cues.length) DURATION = Math.max(DURATION, cues[cues.length - 1].end);

  var active = -1;
  var nodes = [];

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }

  function mount(index) {
    caption.textContent = '';
    nodes = [];
    if (index < 0) return;
    var words = cues[index].words;
    for (var i = 0; i < words.length; i += 1) {
      var span = document.createElement('span');
      span.className = 'w';
      span.textContent = words[i];
      span.style.opacity = 0.3;
      caption.appendChild(span);
      if (i < words.length - 1) caption.appendChild(document.createTextNode(' '));
      nodes.push(span);
    }
  }

  function seek(t) {
    var time = Math.max(0, Number(t) || 0);
    var index = -1;
    for (var i = 0; i < cues.length; i += 1) {
      if (time >= cues[i].start && time < cues[i].end) { index = i; break; }
    }
    if (index !== active) {
      active = index;
      mount(index);
    }
    if (index >= 0) {
      var cue = cues[index];
      // Karaoke: the cue's duration is split evenly across its words, so the
      // lit word always matches the fraction of the cue that has elapsed.
      var span = Math.max(0.001, cue.end - cue.start);
      var progress = clamp01((time - cue.start) / span) * nodes.length;
      for (var w = 0; w < nodes.length; w += 1) {
        var k = easeOutCubic(clamp01(progress - w));
        nodes[w].style.opacity = String(0.3 + 0.7 * k);
        nodes[w].style.color = k > 0.5 ? 'var(--accent)' : '#ffffff';
        nodes[w].style.transform = 'translateY(' + ((1 - k) * 5) + 'px)';
      }
    }
    var fade = Math.min(clamp01(time / 0.5), clamp01((DURATION - time) / 0.4));
    eyebrow.style.opacity = String(fade);
    if (caption) caption.style.opacity = String(Math.min(clamp01((time + 0.15) / 0.25), clamp01((DURATION - time) / 0.3)));
    fill.style.transform = 'scaleX(' + clamp01(time / DURATION) + ')';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const menuBoard = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Menu board</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #120b06; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff8ef; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; justify-content: center; padding: 0 8vw; }
  .glow { position: absolute; width: 110vw; height: 110vw; right: -55vw; top: -32vw; border-radius: 50%; background: radial-gradient(circle, var(--accent), transparent 62%); opacity: .26; filter: blur(7vw); }
  .eyebrow { position: relative; font-size: 2.6vw; letter-spacing: .42em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  h1 { position: relative; margin-top: 3vh; font-size: 11.5vw; line-height: 1.03; font-weight: 800; letter-spacing: -.03em; }
  .price { position: relative; align-self: flex-start; margin-top: 5vh; padding: 2.1vh 4vw; border: .35vh solid var(--accent); border-radius: 999px; font-size: 6.2vw; font-weight: 700; color: var(--accent); }
  .note { position: relative; margin-top: 4.5vh; font-size: 3.3vw; color: rgba(255,248,239,.66); }
  .rule { position: relative; height: .4vh; width: 100%; margin-top: 6.5vh; background: rgba(255,248,239,.16); overflow: hidden; }
  .rule .fill { width: 100%; height: 100%; background: var(--accent); transform-origin: left center; transform: scaleX(0); }
</style>
</head>
<body>
<div id="root" data-composition-id="menu-board" data-start="0" data-width="1080" data-height="1920" data-duration="5">
  <div class="glow"></div>
  <div class="eyebrow" id="eyebrow">{{eyebrow}}</div>
  <h1 id="dish">{{dish}}</h1>
  <div class="price" id="price">{{price}}</div>
  <p class="note" id="note">{{note}}</p>
  <div class="rule"><div class="fill" id="fill"></div></div>
</div>
<script>
(function () {
  var DURATION = 5;
  var eyebrow = document.getElementById('eyebrow');
  var dish = document.getElementById('dish');
  var price = document.getElementById('price');
  var note = document.getElementById('note');
  var fill = document.getElementById('fill');

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }

  function seek(t) {
    var time = Math.max(0, Number(t) || 0);
    var a = easeOutCubic(clamp01(time / 0.55));
    var b = easeOutCubic(clamp01((time - 0.3) / 0.7));
    var c = easeOutCubic(clamp01((time - 0.75) / 0.6));
    var d = easeOutCubic(clamp01((time - 1.15) / 0.6));
    eyebrow.style.opacity = String(a);
    dish.style.opacity = String(b);
    dish.style.transform = 'translateY(' + ((1 - b) * 34) + 'px) scale(' + (0.96 + 0.04 * b) + ')';
    price.style.opacity = String(c);
    price.style.transform = 'translateY(' + ((1 - c) * 26) + 'px)';
    note.style.opacity = String(d * 0.9);
    fill.style.transform = 'scaleX(' + clamp01(time / DURATION) + ')';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const bookingCta = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Booking call to action</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0b0a10; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 8vw; }
  .halo { position: absolute; width: 120vw; height: 120vw; left: 50%; top: 50%; margin: -60vw 0 0 -60vw; border-radius: 50%; background: radial-gradient(circle, var(--accent), transparent 58%); opacity: .22; filter: blur(8vw); }
  .brand { position: relative; font-size: 2.5vw; letter-spacing: .46em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  h1 { position: relative; margin-top: 4vh; font-size: 9.4vw; line-height: 1.1; font-weight: 800; letter-spacing: -.025em; }
  .price { position: relative; margin-top: 3.4vh; font-size: 4vw; color: rgba(255,255,255,.72); }
  .cta { position: relative; margin-top: 7vh; padding: 2.6vh 6vw; border-radius: 999px; background: var(--accent); color: #0b0a10; font-size: 3.9vw; font-weight: 800; letter-spacing: .01em; }
  .fine { position: relative; margin-top: 3.5vh; font-size: 2.6vw; color: rgba(255,255,255,.45); }
</style>
</head>
<body>
<div id="root" data-composition-id="booking-cta" data-start="0" data-width="1080" data-height="1920" data-duration="6">
  <div class="halo"></div>
  <div class="brand" id="brand">{{brand}}</div>
  <h1 id="service">{{service}}</h1>
  <div class="price" id="price">{{price}}</div>
  <div class="cta" id="cta">{{cta}}</div>
  <div class="fine" id="fine">{{fine}}</div>
</div>
<script>
(function () {
  var DURATION = 6;
  var brand = document.getElementById('brand');
  var service = document.getElementById('service');
  var price = document.getElementById('price');
  var cta = document.getElementById('cta');
  var fine = document.getElementById('fine');

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }

  function seek(t) {
    var time = Math.max(0, Number(t) || 0);
    var a = easeOutCubic(clamp01(time / 0.5));
    var b = easeOutCubic(clamp01((time - 0.25) / 0.65));
    var c = easeOutCubic(clamp01((time - 0.85) / 0.55));
    // The button breathes after it lands: a sine of seek time, not a timer.
    var pulse = c >= 1 ? 1 + 0.018 * Math.sin((time - 1.4) * 6.2) : c;
    brand.style.opacity = String(a);
    service.style.opacity = String(b);
    service.style.transform = 'translateY(' + ((1 - b) * 30) + 'px)';
    price.style.opacity = String(c * 0.95);
    cta.style.opacity = String(clamp01((time - 1.05) / 0.4));
    cta.style.transform = 'scale(' + (0.86 + 0.14 * easeOutCubic(clamp01((time - 1.05) / 0.45))) * pulse + ')';
    fine.style.opacity = String(easeOutCubic(clamp01((time - 1.8) / 0.6)) * 0.8);
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const listingReveal = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Listing reveal</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #08090d; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: grid; grid-template-columns: 1.15fr 1fr; align-items: center; gap: 4vw; padding: 0 7vw; }
  .panel { position: relative; }
  .kicker { font-size: 1.5vw; letter-spacing: .42em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  h1 { margin-top: 2.4vh; font-size: 6.4vw; line-height: 1.04; font-weight: 800; letter-spacing: -.025em; }
  .address { margin-top: 2.4vh; font-size: 1.9vw; color: rgba(255,255,255,.6); }
  .meta { margin-top: 4vh; display: flex; gap: 2.6vw; font-size: 1.7vw; color: rgba(255,255,255,.82); }
  .meta span { padding: 1.1vh 1.6vw; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; }
  .price { margin-top: 4.5vh; font-size: 4.6vw; font-weight: 800; color: var(--accent); }
  .agent { margin-top: 1.6vh; font-size: 1.5vw; color: rgba(255,255,255,.4); }
  .card { position: relative; aspect-ratio: 4 / 5; border-radius: 1.6vw; overflow: hidden; background: linear-gradient(160deg, rgba(255,255,255,.1), rgba(255,255,255,.02)); border: 1px solid rgba(255,255,255,.12); }
  .card .sky { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.55)); }
  .card .accent { position: absolute; inset: 0; background: radial-gradient(120% 80% at 80% 0%, var(--accent), transparent 60%); opacity: .3; }
  .badge { position: absolute; top: 1.6vw; left: 1.6vw; padding: .8vh 1.2vw; border-radius: 999px; background: var(--accent); color: #08090d; font-size: 1.2vw; font-weight: 800; letter-spacing: .08em; }
  .card .line { position: absolute; left: 1.6vw; right: 1.6vw; bottom: 1.6vw; height: 1px; background: rgba(255,255,255,.28); }
</style>
</head>
<body>
<div id="root" data-composition-id="listing-reveal" data-start="0" data-width="1920" data-height="1080" data-duration="6">
  <div class="panel" id="panel">
    <div class="kicker" id="kicker">{{kicker}}</div>
    <h1 id="title">{{title}}</h1>
    <div class="address" id="address">{{address}}</div>
    <div class="meta" id="meta">
      <span id="meta1">{{meta1}}</span>
      <span id="meta2">{{meta2}}</span>
      <span id="meta3">{{meta3}}</span>
    </div>
    <div class="price" id="price">{{price}}</div>
    <div class="agent" id="agent">{{agent}}</div>
  </div>
  <div class="card" id="card">
    <div class="accent"></div>
    <div class="sky"></div>
    <div class="badge" id="badge">{{badge}}</div>
    <div class="line"></div>
  </div>
</div>
<script>
(function () {
  var DURATION = 6;
  var panel = document.getElementById('panel');
  var card = document.getElementById('card');
  var parts = ['kicker', 'title', 'address', 'meta', 'price', 'agent'].map(function (id) {
    return document.getElementById(id);
  });

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }

  function seek(t) {
    var time = Math.max(0, Number(t) || 0);
    for (var i = 0; i < parts.length; i += 1) {
      var k = easeOutCubic(clamp01((time - 0.15 * i) / 0.6));
      parts[i].style.opacity = String(k);
      parts[i].style.transform = 'translateY(' + ((1 - k) * 18) + 'px)';
    }
    var cardIn = easeOutCubic(clamp01((time - 0.35) / 0.9));
    card.style.opacity = String(cardIn);
    card.style.transform = 'translateY(' + ((1 - cardIn) * 46) + 'px) scale(' + (0.94 + 0.06 * cardIn) + ')';
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const countdown = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Countdown</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #05070c; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .ring { position: absolute; width: 62vw; height: 62vw; border-radius: 50%; background: conic-gradient(var(--accent) 0deg, rgba(255,255,255,.07) 0deg); }
  .hole { position: absolute; width: 55vw; height: 55vw; border-radius: 50%; background: #05070c; }
  .count { position: relative; font-size: 30vw; line-height: 1; font-weight: 800; letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
  .label { position: absolute; bottom: 12vh; font-size: 3.2vw; letter-spacing: .3em; text-transform: uppercase; color: rgba(255,255,255,.55); }
  .top { position: absolute; top: 11vh; font-size: 2.4vw; letter-spacing: .42em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<div id="root" data-composition-id="countdown" data-start="0" data-width="1080" data-height="1920" data-duration="4">
  <div class="ring" id="ring"></div>
  <div class="hole"></div>
  <div class="top" id="top">{{eyebrow}}</div>
  <div class="count" id="count">3</div>
  <div class="label" id="label">{{label}}</div>
</div>
<script>
(function () {
  var DURATION = 4;
  var STEP = 0.8;
  var MARKS = ['3', '2', '1', 'GO'];
  var ring = document.getElementById('ring');
  var count = document.getElementById('count');
  var top = document.getElementById('top');
  var label = document.getElementById('label');
  var current = -1;

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

  function seek(t) {
    var time = Math.max(0, Number(t) || 0);
    var index = Math.min(MARKS.length - 1, Math.floor(time / STEP));
    var local = clamp01((time - index * STEP) / STEP);
    if (index !== current) {
      current = index;
      count.textContent = MARKS[index];
    }
    // Pop big on the beat, settle to rest: scale and opacity are both
    // functions of the position inside the step.
    var pop = 1 + 0.22 * (1 - local) * (1 - local);
    count.style.opacity = String(0.25 + 0.75 * (1 - local * local));
    count.style.transform = 'scale(' + pop + ')';
    count.style.color = index === MARKS.length - 1 ? 'var(--accent)' : '#ffffff';
    ring.style.background = 'conic-gradient(var(--accent) ' + (clamp01(time / DURATION) * 360) + 'deg, rgba(255,255,255,.07) 0deg)';
    top.style.opacity = String(clamp01(time / 0.4));
    label.style.opacity = String(clamp01((time - 0.3) / 0.5) * 0.9);
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

const petSpotlight = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pet spotlight</title>
<style>
  :root { --accent: {{accent}}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0710; }
  body { font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 9vw; }
  .glow { position: absolute; width: 100vw; height: 100vw; left: 50%; top: 50%; margin: -50vw 0 0 -50vw; border-radius: 50%; background: radial-gradient(circle, var(--accent), transparent 60%); opacity: .24; filter: blur(8vw); }
  .dot { position: absolute; border-radius: 50%; background: var(--accent); opacity: .18; }
  .tag { position: relative; padding: 1.2vh 2.6vw; border-radius: 999px; border: .3vh solid var(--accent); color: var(--accent); font-size: 2.4vw; letter-spacing: .3em; text-transform: uppercase; font-weight: 700; }
  h1 { position: relative; margin-top: 4.5vh; font-size: 15vw; line-height: .98; font-weight: 800; letter-spacing: -.04em; }
  .breed { position: relative; margin-top: 3.4vh; font-size: 3.6vw; color: rgba(255,255,255,.68); }
  .foot { position: absolute; bottom: 9vh; font-size: 2.5vw; letter-spacing: .34em; text-transform: uppercase; color: rgba(255,255,255,.4); }
</style>
</head>
<body>
<div id="root" data-composition-id="pet-spotlight" data-start="0" data-width="1080" data-height="1920" data-duration="5">
  <div class="glow"></div>
  <div class="dot" id="d1" style="width:16vw;height:16vw;left:8vw;top:14vh"></div>
  <div class="dot" id="d2" style="width:9vw;height:9vw;right:10vw;top:22vh"></div>
  <div class="dot" id="d3" style="width:12vw;height:12vw;right:14vw;bottom:18vh"></div>
  <div class="dot" id="d4" style="width:6vw;height:6vw;left:16vw;bottom:26vh"></div>
  <div class="tag" id="tag">{{tag}}</div>
  <h1 id="name">{{name}}</h1>
  <div class="breed" id="breed">{{breed}}</div>
  <div class="foot" id="foot">{{foot}}</div>
</div>
<script>
(function () {
  var DURATION = 5;
  var tag = document.getElementById('tag');
  var name = document.getElementById('name');
  var breed = document.getElementById('breed');
  var foot = document.getElementById('foot');
  var dots = [document.getElementById('d1'), document.getElementById('d2'), document.getElementById('d3'), document.getElementById('d4')];

  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function easeOutBack(x) {
    var c = 1.70158;
    var rest = x - 1;
    return 1 + (c + 1) * rest * rest * rest + c * rest * rest;
  }
  function easeOutCubic(x) { var rest = 1 - x; return 1 - rest * rest * rest; }

  function seek(t) {
    var time = Math.max(0, Number(t) || 0);
    var a = easeOutCubic(clamp01(time / 0.5));
    var b = clamp01((time - 0.2) / 0.7);
    var c = easeOutCubic(clamp01((time - 0.7) / 0.6));
    tag.style.opacity = String(a);
    name.style.opacity = String(clamp01((time - 0.2) / 0.35));
    name.style.transform = 'scale(' + (0.7 + 0.3 * easeOutBack(b)) + ')';
    breed.style.opacity = String(c);
    breed.style.transform = 'translateY(' + ((1 - c) * 22) + 'px)';
    foot.style.opacity = String(easeOutCubic(clamp01((time - 1.1) / 0.6)) * 0.85);
    for (var i = 0; i < dots.length; i += 1) {
      dots[i].style.opacity = String(0.12 + 0.1 * Math.sin(time * 2.4 + i));
    }
  }

  seek(0);
  window.__hf = { duration: DURATION, seek: seek };
})();
</script>
</body>
</html>`

export const HTML_VIDEO_STARTERS: HtmlVideoStarter[] = [
  {
    id: 'kinetic-title',
    name: 'Kinetic title',
    summary: 'Word-by-word headline reveal on a moving grid — the default vertical hook.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 4,
    industries: ['general', 'creator'],
    tags: ['title', 'hook', 'vertical'],
    variables: [
      { key: 'eyebrow', label: 'Eyebrow', value: 'New drop' },
      { key: 'title', label: 'Headline', value: 'Made with HTML and CSS' },
      { key: 'subtitle', label: 'Subtitle', value: 'Every frame is a function of time.' },
      { key: 'accent', label: 'Accent color', value: '#7c5cff' }
    ],
    html: kineticTitle
  },
  {
    id: 'product-features',
    name: 'Product features',
    summary: 'Three feature cards slide in beside a headline — landscape explainer.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 6,
    industries: ['tech', 'education'],
    tags: ['product', 'features', 'landscape'],
    variables: [
      { key: 'kicker', label: 'Kicker', value: 'What is new' },
      { key: 'heading', label: 'Heading', value: 'Everything you need, in one place' },
      { key: 'blurb', label: 'Blurb', value: 'A short paragraph that sets up the three points on the right.' },
      { key: 'feature1', label: 'Feature 1', value: 'Instant preview' },
      { key: 'detail1', label: 'Detail 1', value: 'Scrub the timeline and see the real composition.' },
      { key: 'feature2', label: 'Feature 2', value: 'Deterministic render' },
      { key: 'detail2', label: 'Detail 2', value: 'The same HTML always produces the same frames.' },
      { key: 'feature3', label: 'Feature 3', value: 'No plugins' },
      { key: 'detail3', label: 'Detail 3', value: 'Plain HTML and CSS — works offline.' },
      { key: 'accent', label: 'Accent color', value: '#38e0b0' }
    ],
    html: productFeatures
  },
  {
    id: 'price-reveal',
    name: 'Price reveal',
    summary: 'Old price struck through, new price pops with a badge — vertical promo.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 5,
    industries: ['ecommerce', 'fashion'],
    tags: ['commerce', 'promo', 'vertical'],
    variables: [
      { key: 'brand', label: 'Brand', value: 'AFTERLIGHT' },
      { key: 'badge', label: 'Badge', value: 'SAVE 40%' },
      { key: 'product', label: 'Product', value: 'Creator bundle' },
      { key: 'oldPrice', label: 'Old price', value: '$149' },
      { key: 'newPrice', label: 'New price', value: '$89' },
      { key: 'cta', label: 'Call to action', value: 'Order today' },
      { key: 'accent', label: 'Accent color', value: '#ff4d80' }
    ],
    html: priceReveal
  },
  {
    id: 'stat-counter',
    name: 'Stat counter',
    summary: 'A number counts up with a progress bar — proof points and results.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 5,
    industries: ['finance', 'tech'],
    tags: ['data', 'proof', 'landscape'],
    variables: [
      { key: 'label', label: 'Label', value: 'Render throughput' },
      { key: 'value', label: 'Value', value: '12400' },
      { key: 'suffix', label: 'Suffix', value: '+' },
      { key: 'caption', label: 'Caption', value: 'Frames captured per hour on a single laptop.' },
      { key: 'accent', label: 'Accent color', value: '#f4c95d' }
    ],
    html: statCounter
  },
  {
    id: 'lower-third',
    name: 'Lower third',
    summary: 'Name and role wipe in over a studio backdrop — interviews and clips.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 6,
    industries: ['creator', 'events', 'travel'],
    tags: ['interview', 'name', 'landscape'],
    variables: [
      { key: 'tag', label: 'Corner tag', value: 'Studio interview' },
      { key: 'name', label: 'Name', value: 'Linh Tran' },
      { key: 'role', label: 'Role', value: 'Creative director' },
      { key: 'brand', label: 'Brand', value: 'AFTERLIGHT' },
      { key: 'accent', label: 'Accent color', value: '#4da3ff' }
    ],
    html: lowerThird
  },
  {
    id: 'voice-captions',
    name: 'Voice captions',
    summary: 'Karaoke captions driven by timed cues — pair a voiceover with the segments AutoCaptions wrote.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 5,
    industries: ['education', 'medical'],
    tags: ['captions', 'karaoke', 'voice', 'vertical'],
    variables: [
      { key: 'eyebrow', label: 'Eyebrow', value: 'Narration' },
      { key: 'cues', label: 'Cues (JSON)', value: '[{"start":0,"end":1.4,"text":"Every frame"},{"start":1.4,"end":2.9,"text":"is a function of time"},{"start":2.9,"end":4.6,"text":"and now of your voice"}]' },
      { key: 'accent', label: 'Accent color', value: '#4de3a6' }
    ],
    html: voiceCaptions
  },
  {
    id: 'gradient-loop',
    name: 'Gradient loop',
    summary: 'Blurred gradient blobs drifting in a seamless loop — background plate.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 6,
    industries: ['general'],
    tags: ['background', 'loop', 'vertical'],
    variables: [
      { key: 'brand', label: 'Brand', value: 'AFTERLIGHT' },
      { key: 'tagline', label: 'Tagline', value: 'Stories in motion' },
      { key: 'accent', label: 'Accent color A', value: '#7c5cff' },
      { key: 'accent2', label: 'Accent color B', value: '#ff4d80' }
    ],
    html: gradientLoop
  },
  {
    id: 'blank',
    name: 'Blank',
    summary: 'Minimal 3-second skeleton — start from scratch with the seek contract wired.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 3,
    industries: ['general'],
    tags: ['blank', 'starter'],
    variables: [
      { key: 'title', label: 'Title', value: 'Your first frame' }
    ],
    html: blankComposition
  },
  {
    id: 'menu-board',
    name: 'Menu board',
    summary: 'Dish, price and a progress rule — daily specials for restaurants and cafes.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 5,
    industries: ['fnb'],
    tags: ['menu', 'food', 'vertical'],
    variables: [
      { key: 'eyebrow', label: 'Eyebrow', value: 'Today only' },
      { key: 'dish', label: 'Dish', value: 'Charred lemongrass chicken' },
      { key: 'price', label: 'Price', value: '129K' },
      { key: 'note', label: 'Note', value: 'Served with ginger rice and pickled greens.' },
      { key: 'accent', label: 'Accent color', value: '#ff8a3d' }
    ],
    html: menuBoard
  },
  {
    id: 'booking-cta',
    name: 'Booking call to action',
    summary: 'Service, price and a breathing book-now button — salons, clinics, studios.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 6,
    industries: ['beauty', 'services', 'medical'],
    tags: ['booking', 'cta', 'vertical'],
    variables: [
      { key: 'brand', label: 'Brand', value: 'LUMIÈRE STUDIO' },
      { key: 'service', label: 'Service', value: 'Balayage + gloss' },
      { key: 'price', label: 'Price', value: 'From 1,200K' },
      { key: 'cta', label: 'Call to action', value: 'Book this week' },
      { key: 'fine', label: 'Fine print', value: 'Slots open Tue–Sat, 9:00–19:00.' },
      { key: 'accent', label: 'Accent color', value: '#f2b8a2' }
    ],
    html: bookingCta
  },
  {
    id: 'listing-reveal',
    name: 'Listing reveal',
    summary: 'Property or vehicle card with spec pills and price — real estate and dealers.',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 6,
    industries: ['realestate', 'automotive'],
    tags: ['listing', 'property', 'landscape'],
    variables: [
      { key: 'kicker', label: 'Kicker', value: 'Just listed' },
      { key: 'title', label: 'Title', value: 'Riverside loft, district 2' },
      { key: 'address', label: 'Address', value: '18 Nguyen Cu Trinh, floor 6' },
      { key: 'meta1', label: 'Spec 1', value: '2 bed' },
      { key: 'meta2', label: 'Spec 2', value: '1 bath' },
      { key: 'meta3', label: 'Spec 3', value: '74 m²' },
      { key: 'price', label: 'Price', value: '4.35B' },
      { key: 'agent', label: 'Agent', value: 'Linh Tran · +84 90 000 0000' },
      { key: 'badge', label: 'Badge', value: 'NEW' },
      { key: 'accent', label: 'Accent color', value: '#c9a227' }
    ],
    html: listingReveal
  },
  {
    id: 'countdown',
    name: 'Countdown',
    summary: 'A four-step countdown with a filling ring — launches, drops, live sessions.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 4,
    industries: ['health', 'events'],
    tags: ['countdown', 'launch', 'vertical'],
    variables: [
      { key: 'eyebrow', label: 'Eyebrow', value: 'Live class' },
      { key: 'label', label: 'Label', value: 'Starts now' },
      { key: 'accent', label: 'Accent color', value: '#4da3ff' }
    ],
    html: countdown
  },
  {
    id: 'pet-spotlight',
    name: 'Pet spotlight',
    summary: 'Name pops in with drifting accents — grooming, vet and pet-shop promos.',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 5,
    industries: ['pets'],
    tags: ['pet', 'spotlight', 'vertical'],
    variables: [
      { key: 'tag', label: 'Tag', value: 'Pet of the week' },
      { key: 'name', label: 'Name', value: 'Mochi' },
      { key: 'breed', label: 'Breed', value: 'Shiba Inu · 2 years' },
      { key: 'foot', label: 'Footer', value: 'PixiePaws grooming' },
      { key: 'accent', label: 'Accent color', value: '#ff7ba8' }
    ],
    html: petSpotlight
  }
]

export function htmlVideoStarter(id: string): HtmlVideoStarter | null {
  return HTML_VIDEO_STARTERS.find(starter => starter.id === id) || null
}

/** The document handed to the sandboxed preview iframe. */
export function buildHtmlVideoPreviewDocument(html: string): string {
  const bridge = `<script>
(function () {
  function post(message) {
    try { parent.postMessage(message, '*'); } catch (err) {}
  }
  function current() {
    return window.__hf && typeof window.__hf.seek === 'function' ? window.__hf : null;
  }
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type !== 'hf:seek') return;
    var hf = current();
    if (!hf) return;
    try {
      var result = hf.seek(Number(data.time) || 0);
      if (result && typeof result.then === 'function') {
        result.then(function () { post({ type: 'hf:frame', time: Number(data.time) || 0 }); });
      } else {
        post({ type: 'hf:frame', time: Number(data.time) || 0 });
      }
    } catch (err) {
      post({ type: 'hf:error', message: String(err && err.message ? err.message : err) });
    }
  });
  window.addEventListener('error', function (event) {
    post({ type: 'hf:error', message: String(event.message || 'runtime error') });
  });
  var attempts = 0;
  var timer = setInterval(function () {
    var hf = current();
    if (hf) {
      clearInterval(timer);
      post({ type: 'hf:ready', duration: Number(hf.duration) || 0 });
      return;
    }
    attempts += 1;
    if (attempts > 200) {
      clearInterval(timer);
      post({ type: 'hf:error', message: 'Composition never exposed __hf.seek(t)' });
    }
  }, 25);
})();
</script>`
  return `${html}\n${bridge}`
}
