// Przykładowa ścianka z prototypu (sampleWall), narysowana w Node przez @napi-rs/canvas.
// Znamy położenie i rozmiar każdego chwytu, więc można sprawdzać jakość zaznaczenia.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

type Rng = () => number;
const rng = (seed: number): Rng => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function drawHold(x: SKRSContext2D, cx: number, cy: number, R: number, col: string, r: Rng) {
  const n = 14,
    ph = r() * 6.3,
    p: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283,
      k = 0.8 + 0.18 * Math.sin(a * 2 + ph) + r() * 0.1;
    p.push([cx + Math.cos(a) * R * k * 1.15, cy + Math.sin(a) * R * k * 0.9]);
  }
  const path = () => {
    x.beginPath();
    for (let i = 0; i < n; i++) {
      const a = p[i],
        b = p[(i + 1) % n],
        m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (i) x.quadraticCurveTo(a[0], a[1], m[0], m[1]);
      else x.moveTo(m[0], m[1]);
    }
    x.quadraticCurveTo(p[0][0], p[0][1], (p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2);
    x.closePath();
  };
  x.save();
  x.shadowColor = 'rgba(0,0,0,.45)';
  x.shadowBlur = R * 0.45;
  x.shadowOffsetY = R * 0.22;
  x.fillStyle = col;
  path();
  x.fill();
  x.restore();
  const g = x.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.2);
  g.addColorStop(0, 'rgba(255,255,255,.2)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,.2)');
  x.fillStyle = g;
  path();
  x.fill();
  x.fillStyle = 'rgba(25,25,25,.85)';
  x.beginPath();
  x.arc(cx + R * 0.1, cy, Math.max(3, R * 0.12), 0, 7);
  x.fill();
}

/** [x, y, R] */
export type KnownHold = [number, number, number];

export const BLUE: KnownHold[] = [[600, 820, 30], [700, 700, 32], [560, 600, 28], [665, 480, 36], [545, 360, 30], [650, 240, 32], [595, 100, 42], [510, 860, 17], [735, 790, 16]];
export const ORANGE: KnownHold[] = [[110, 600, 32], [250, 560, 27], [390, 630, 34], [860, 590, 30], [990, 545, 27], [1110, 610, 34], [170, 740, 16], [930, 720, 16]];
/** małe stopnie na paczce w podobnym kolorze */
export const VOLUME_STEPS: KnownHold[] = [[990, 170, 15], [1080, 250, 13], [1060, 130, 12]];

export function sampleWall(): Canvas {
  const c = createCanvas(1200, 900),
    x = c.getContext('2d'),
    r = rng(11);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      x.fillStyle = `hsl(36 9% ${73 + r() * 7}%)`;
      x.fillRect(i * 300, j * 300, 300, 300);
    }
  const g = x.createLinearGradient(0, 0, 0, 900);
  g.addColorStop(0, 'rgba(255,255,255,.1)');
  g.addColorStop(1, 'rgba(0,0,0,.2)');
  x.fillStyle = g;
  x.fillRect(0, 0, 1200, 900);
  x.strokeStyle = 'rgba(0,0,0,.28)';
  x.lineWidth = 2;
  x.beginPath();
  for (let i = 300; i < 1200; i += 300) {
    x.moveTo(i, 0);
    x.lineTo(i, 900);
  }
  for (let j = 300; j < 900; j += 300) {
    x.moveTo(0, j);
    x.lineTo(1200, j);
  }
  x.stroke();
  x.fillStyle = 'rgba(45,42,38,.55)';
  for (let i = 18.75; i < 1200; i += 37.5)
    for (let j = 18.75; j < 900; j += 37.5) {
      x.beginPath();
      x.arc(i, j, 3, 0, 7);
      x.fill();
    }
  const BL = '#2463d6',
    OR = '#f07a16';
  // paczka (volume) z małymi stopniami w tym samym kolorze
  const VC = '#3d9b8e',
    vol = [[880, 90], [1150, 60], [1170, 330], [960, 400]];
  const volPath = () => {
    x.beginPath();
    vol.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.closePath();
  };
  x.save();
  x.shadowColor = 'rgba(0,0,0,.5)';
  x.shadowBlur = 30;
  x.shadowOffsetY = 14;
  x.fillStyle = VC;
  volPath();
  x.fill();
  x.restore();
  const vg = x.createLinearGradient(880, 60, 1170, 400);
  vg.addColorStop(0, 'rgba(255,255,255,.16)');
  vg.addColorStop(1, 'rgba(0,0,0,.22)');
  x.fillStyle = vg;
  volPath();
  x.fill();
  x.strokeStyle = 'rgba(0,0,0,.18)';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(1150, 60);
  x.lineTo(960, 400);
  x.stroke();
  for (const [a, b, rr] of VOLUME_STEPS) drawHold(x, a, b, rr, '#56b8a9', r);
  const placed: KnownHold[] = [...BLUE, ...ORANGE, [1020, 230, 170]];
  const others = ['#d8262f', '#2f9e44', '#f2c514', '#7a3fb8', '#1f1f22', '#f4f1ea', '#e04b9a', '#14a7b8'];
  const rest: [number, number, number, string][] = [];
  for (let k = 0; k < 400 && rest.length < 34; k++) {
    const rr = 16 + r() * 26,
      a = 40 + r() * 1120,
      b = 40 + r() * 820;
    if (placed.every(([px, py, pr]) => Math.hypot(px - a, py - b) > pr + rr + 22)) {
      placed.push([a, b, rr]);
      rest.push([a, b, rr, others[(r() * others.length) | 0]]);
    }
  }
  for (const [a, b, rr, col] of rest) drawHold(x, a, b, rr, col, r);
  for (const [a, b, rr] of BLUE) drawHold(x, a, b, rr, BL, r);
  for (const [a, b, rr] of ORANGE) drawHold(x, a, b, rr, OR, r);
  return c;
}
