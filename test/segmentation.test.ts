import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Canvas } from '@napi-rs/canvas';
import { holdAt, inShape, manualHold, rgbaToLab, trace, withThreshold, type LabImage, type Point } from '../src/holds/segmentation.ts';
import { loadPrototype, type Prototype } from './prototype.ts';
import { BLUE, ORANGE, VOLUME_STEPS, sampleWall, type KnownHold } from './sampleWall.ts';

let wall: Canvas;
let img: LabImage;
let proto: Prototype;

before(() => {
  wall = sampleWall();
  const d = wall.getContext('2d').getImageData(0, 0, wall.width, wall.height).data;
  img = rgbaToLab(d, wall.width, wall.height);
  proto = loadPrototype();
  proto.setWall(wall);
});

function area(poly: Point[]) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(s) / 2;
}
function centroid(mask: Uint8Array, bx: number, by: number, w: number) {
  let sx = 0,
    sy = 0,
    n = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      sx += (i % w) + bx + 0.5;
      sy += ((i / w) | 0) + by + 0.5;
      n++;
    }
  return [sx / n, sy / n, n] as const;
}

/* Punkty tapnięć do porównania z prototypem: środki chwytów, śruby, obok chwytów, losowe. */
function taps(): Point[] {
  const out: Point[] = [];
  for (const [x, y, R] of [...BLUE, ...ORANGE, ...VOLUME_STEPS]) {
    out.push([x, y], [x + R * 0.1, y], [x - R * 0.4, y + R * 0.3]);
  }
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 25; i++) out.push([r() * 1199, r() * 899]);
  out.push([0, 0], [1199, 899], [3, 450]); // rogi i brzeg
  return out;
}

describe('zgodność z prototypem', () => {
  test('próg automatyczny i maska identyczne jak w prototyp-chwyty.html', () => {
    for (const [x, y] of taps()) {
      const a = holdAt(img, x, y);
      const b = proto.makeHold(x, y, 'hand', null);
      const at = `tapnięcie (${x.toFixed(1)}, ${y.toFixed(1)})`;
      assert.equal(a.ta, b.ta, `${at}: próg automatyczny`);
      assert.equal(a.t, b.t, `${at}: próg`);
      if (b.t == null) continue; // kółko – prototyp nie ma maski
      assert.deepEqual([a.bx, a.by, a.w, a.h], [b.bx, b.by, b.w, b.h], `${at}: ramka maski`);
      assert.ok(Buffer.from(a.mask).equals(Buffer.from(b.m!)), `${at}: maska`);
      assert.deepEqual(trace(a.mask, a.w, a.h), proto.trace(b.m!, b.w, b.h), `${at}: brzeg`);
    }
  });

  test('suwak (ręczny próg) daje to samo co prototyp', () => {
    const [x, y] = BLUE[3];
    const base = holdAt(img, x, y);
    for (const t of [4, 8.5, 15, 30]) {
      const a = withThreshold(img, base, t);
      const b = proto.makeHold(x, y, 'hand', t);
      assert.ok(Buffer.from(a.mask).equals(Buffer.from(b.m!)), `próg ${t}`);
    }
  });
});

describe('jakość zaznaczenia na przykładowej ściance', () => {
  // Chwyt ma kształt elipsy ok. 1,15R × 0,9R × (0,8…1,08) → pole ok. 0,84·πR².
  const check = (h: KnownHold, tapX: number, tapY: number) => {
    const [x, y, R] = h;
    const hold = holdAt(img, tapX, tapY);
    assert.notEqual(hold.t, null, `chwyt (${x}, ${y}): nie znaleziono krawędzi`);
    const [cx, cy] = centroid(hold.mask, hold.bx, hold.by, hold.w);
    const expected = 0.84 * Math.PI * R * R,
      got = area(hold.outline);
    assert.ok(Math.hypot(cx - x, cy - y) < R * 0.35, `chwyt (${x}, ${y}): środek obrysu za daleko (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
    assert.ok(got > expected * 0.5 && got < expected * 1.8, `chwyt (${x}, ${y}): pole ${got.toFixed(0)}, oczekiwane ok. ${expected.toFixed(0)}`);
    assert.ok(inShape(hold, x, y), `chwyt (${x}, ${y}): środek poza maską`);
  };

  test('tapnięcie w środek chwytu zaznacza cały chwyt', () => {
    for (const h of [...BLUE, ...ORANGE]) check(h, h[0], h[1]);
  });

  // Znane słabości algorytmu z prototypu (oryginał zachowuje się identycznie – patrz test zgodności):
  // czarna śruba na ciemnoniebieskim chwycie i stopień, którego środek przykrywa śruba.
  const isKnownWeak = (h: KnownHold) =>
    (h[0] === 700 && h[1] === 700) || (h[0] === 650 && h[1] === 240) || (h[0] === 990 && h[1] === 170);
  const ok = (list: KnownHold[]) => list.filter((h) => !isKnownWeak(h));
  const weak = (list: KnownHold[]) => list.filter(isKnownWeak);

  test('tapnięcie w śrubę zaznacza chwyt, nie otwór', () => {
    for (const h of ok([...BLUE, ...ORANGE])) check(h, h[0] + h[2] * 0.1, h[1]);
  });

  test('stopień na paczce: zaznacza stopień, nie całą paczkę', () => {
    for (const h of ok(VOLUME_STEPS)) check(h, h[0], h[1]);
  });

  test('ZNANE: śruba na ciemnym chwycie / śruba w środku małego stopnia', { todo: 'poprawić algorytm' }, () => {
    for (const h of weak([...BLUE, ...ORANGE])) check(h, h[0] + h[2] * 0.1, h[1]);
    for (const h of weak(VOLUME_STEPS)) check(h, h[0], h[1]);
  });
});

describe('tryb ręczny', () => {
  test('obrys palcem daje zamknięty wielokąt z maską', () => {
    const stroke: Point[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      stroke.push([500 + Math.cos(a) * 40, 300 + Math.sin(a) * 25]);
    }
    const m = manualHold(stroke)!;
    assert.ok(m);
    assert.ok(inShape(m, 500, 300));
    assert.ok(!inShape(m, 545, 300));
    const a = area(m.outline);
    assert.ok(Math.abs(a - Math.PI * 40 * 25) / (Math.PI * 40 * 25) < 0.1, `pole ${a}`);
  });

  test('za mały obrys jest odrzucany', () => {
    assert.equal(manualHold([[10, 10], [11, 10], [12, 11]]), null);
    assert.equal(manualHold([[10, 10]]), null);
  });
});
