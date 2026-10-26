// Kleine Effekte. Bewegung wird abgeschaltet, wenn das System reduzierte Bewegung verlangt.

const CONFETTI_COLORS = ['#c9442a', '#f5b32a', '#2a8540', '#2678bb', '#8257e0', '#ff8a65'];

// Ein kurzer Konfetti-Regen über den ganzen Bildschirm, bei einem Sieg.
export function burstConfetti({ count = 60, duration = 1600 } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.random() * 300}ms`;
    piece.style.animationDuration = `${duration + Math.random() * 600}ms`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty('--spin', `${Math.random() * 720 - 360}deg`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), duration + 1500);
}
