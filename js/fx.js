// Konfetti auf einer Leinwand: Papierschnipsel, Bänder und Sterne mit Schwerkraft, Luftwiderstand
// und Flattern. Bewegung wird abgeschaltet, wenn das System reduzierte Bewegung verlangt.

const GRAVITY = 0.3; // Pixel pro Frame² bei 60 Bildern pro Sekunde
const DRAG = 0.985;
const EXTRA_COLORS = ['#3a9ad9', '#ff7eb6', '#ffd23f'];
const SHAPES = ['rect', 'rect', 'rect', 'circle', 'ribbon', 'ribbon', 'star'];

let canvas = null;
let ctx = null;
let particles = [];
let frame = 0;
let lastTime = 0;

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Farben aus dem aktuellen Design (Grün, Gelb, Akzent, Lila) plus ein paar fröhliche Extras.
function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const colors = ['--correct', '--present', '--accent', '--grape']
    .map((name) => style.getPropertyValue(name).trim())
    .filter(Boolean);
  return [...colors, ...EXTRA_COLORS];
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  ctx = canvas.getContext('2d');
  document.body.append(canvas);
  resize();
  window.addEventListener('resize', resize);
}

function removeCanvas() {
  window.removeEventListener('resize', resize);
  canvas?.remove();
  canvas = null;
  ctx = null;
}

const random = (min, max) => min + Math.random() * (max - min);

function spawn(x, y, angle, speed, colors) {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  particles.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    shape,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: shape === 'ribbon' ? random(14, 22) : random(7, 12),
    rotation: random(0, Math.PI * 2),
    spin: random(-0.18, 0.18),
    tilt: random(0, Math.PI * 2),
    tiltSpeed: random(0.06, 0.16),
    wobble: random(0, Math.PI * 2),
    wobbleSpeed: random(0.04, 0.1),
    // Papier fällt langsam: jedes Stück hat seine eigene Höchstgeschwindigkeit.
    terminal: random(2.2, 4.2),
    age: 0,
    life: random(170, 260),
  });
}

function drawStar(size) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? size / 2 : size / 4.5;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

function drawRibbon(size) {
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    ctx.lineTo((t - 0.5) * size, Math.sin(t * Math.PI * 2) * size * 0.14);
  }
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ctx.fillStyle;
  ctx.stroke();
}

function draw(p) {
  // Das Kippen um die eigene Achse lässt die Schnipsel im Licht aufblitzen.
  const flip = Math.cos(p.tilt);
  const fade = Math.min(1, (p.life - p.age) / 40);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.translate(p.x + Math.sin(p.wobble) * 6, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(1, Math.max(0.12, Math.abs(flip)));
  ctx.fillStyle = p.color;
  if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
  else if (p.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.shape === 'star') drawStar(p.size * 1.2);
  else drawRibbon(p.size);
  // Rückseite etwas dunkler.
  if (flip < 0 && p.shape !== 'ribbon') {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
  }
  ctx.restore();
}

function step(time) {
  const dt = lastTime ? Math.min(2.5, (time - lastTime) / (1000 / 60)) : 1;
  lastTime = time;
  const height = window.innerHeight;
  ctx.clearRect(0, 0, window.innerWidth, height);
  const drag = DRAG ** dt;
  particles = particles.filter((p) => {
    p.age += dt;
    p.vx *= drag;
    p.vy = p.vy * drag + GRAVITY * dt;
    if (p.vy > p.terminal) p.vy = p.terminal;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.spin * dt;
    p.tilt += p.tiltSpeed * dt;
    p.wobble += p.wobbleSpeed * dt;
    if (p.age >= p.life || p.y > height + 40) return false;
    draw(p);
    return true;
  });
  if (particles.length) frame = requestAnimationFrame(step);
  else {
    frame = 0;
    lastTime = 0;
    removeCanvas();
  }
}

function start() {
  if (!frame) frame = requestAnimationFrame(step);
}

// Großer Sieg: zwei Kanonen schießen von unten links und rechts schräg nach oben.
function cannons(count, colors) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // So schnell, dass die Schnipsel etwa bis zum oberen Viertel fliegen.
  const base = Math.sqrt(2 * GRAVITY * height * 0.75) * 1.25;
  const waves = 3;
  for (let wave = 0; wave < waves; wave++) {
    setTimeout(() => {
      ensureCanvas();
      for (let i = 0; i < count / waves / 2; i++) {
        // Links schräg nach oben rechts, rechts gespiegelt nach oben links.
        spawn(-10, height * 0.9, random(-1.25, -0.85), base * random(0.65, 1.1), colors);
        spawn(width + 10, height * 0.9, Math.PI - random(-1.25, -0.85), base * random(0.65, 1.1), colors);
      }
      start();
    }, wave * 120);
  }
}

// Kleiner Ausbruch an einer Stelle (Anteile der Bildschirmbreite und -höhe), leicht nach oben gerichtet.
function burst(count, origin, colors, power) {
  ensureCanvas();
  const x = origin.x * window.innerWidth;
  const y = origin.y * window.innerHeight;
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + random(-1, 1) * Math.PI * 0.75;
    spawn(x, y, angle, random(0.35, 1) * power, colors);
  }
  start();
}

// kind: 'win' (Kanonen von beiden Seiten) oder 'burst' (Ausbruch an origin).
export function burstConfetti({ kind = 'win', count = 160, origin = { x: 0.5, y: 0.45 }, colors = null, power = 13 } = {}) {
  if (reducedMotion()) return;
  const palette = colors?.length ? colors : themeColors();
  ensureCanvas();
  if (kind === 'win') cannons(count, palette);
  else burst(count, origin, palette, power);
}
