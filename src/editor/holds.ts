import { Skia, type SkPath } from '@shopify/react-native-skia';
import { inShape, withThreshold, type AutoHold, type LabImage, type ManualHold, type Point } from '../holds/segmentation';

export type HoldType = 'start' | 'hand' | 'foot' | 'top';
export const HOLD_TYPES: HoldType[] = ['start', 'hand', 'foot', 'top'];

/** Część chwytu: zaznaczona tapnięciem (auto) albo obrysem palcem (ręczna). */
export type HoldPart = AutoHold | ManualHold;
export const isAuto = (p: HoldPart): p is AutoHold => 'geo' in p;

/**
 * Chwyt = jedna lub więcej części (np. dwukolorowy chwyt, „donut”, płytka ze strzałką).
 * „Dołącz” dodaje kolejną część do zaznaczonego chwytu.
 */
export type Hold = {
  id: number;
  type: HoldType;
  parts: HoldPart[];
  /** wszystkie obrysy jako jedna ścieżka Skia (we współrzędnych zdjęcia) */
  path: SkPath;
  /** prostokąt otaczający – do położenia napisów START/TOP */
  box: { x: number; y: number; w: number; h: number };
  /** komentarz autora, np. „w wariancie trudniejszym bez tego chwytu”, „tylko śliska część” */
  note?: string;
};

/** Najdłuższy komentarz do chwytu. */
export const NOTE_MAX = 200;

/** Wygładzony obrys → gładka krzywa przez środki boków (jak w prototypie). */
function addOutline(b: ReturnType<typeof Skia.PathBuilder.Make>, p: Point[]) {
  const n = p.length;
  if (n < 3) {
    const c = p[0] ?? [0, 0];
    b.addOval(Skia.XYWHRect(c[0] - 2, c[1] - 2, 4, 4));
    return;
  }
  const mid = (a: Point, c: Point): Point => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  const m = mid(p[n - 1], p[0]);
  b.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const m2 = mid(p[i], p[(i + 1) % n]);
    b.quadTo(p[i][0], p[i][1], m2[0], m2[1]);
  }
  b.close();
}

export function makeHold(id: number, type: HoldType, parts: HoldPart[], note?: string): Hold {
  const b = Skia.PathBuilder.Make();
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of parts) {
    addOutline(b, p.outline);
    x0 = Math.min(x0, p.bx);
    y0 = Math.min(y0, p.by);
    x1 = Math.max(x1, p.bx + p.w);
    y1 = Math.max(y1, p.by + p.h);
  }
  return { id, type, parts, path: b.detach(), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, ...(note ? { note } : {}) };
}

export const withType = (h: Hold, type: HoldType): Hold => ({ ...h, type });
export const withPart = (h: Hold, part: HoldPart): Hold => makeHold(h.id, h.type, [...h.parts, part], h.note);

/** Pusty / same spacje = brak komentarza. */
export function withNote(h: Hold, note: string): Hold {
  const n = note.trim().slice(0, NOTE_MAX);
  const { note: _old, ...rest } = h;
  return n ? { ...rest, note: n } : rest;
}

/** Ostatnia część zaznaczona tapnięciem – tę zmienia suwak konturu. */
export function lastAutoPart(h: Hold): AutoHold | null {
  for (let i = h.parts.length - 1; i >= 0; i--) {
    const p = h.parts[i];
    if (isAuto(p)) return p;
  }
  return null;
}

/** Suwak: nowy próg dla ostatniej części auto. */
export function withPartThreshold(img: LabImage, h: Hold, t: number): Hold {
  const last = lastAutoPart(h);
  if (!last) return h;
  const i = h.parts.lastIndexOf(last);
  const parts = [...h.parts];
  parts[i] = withThreshold(img, last, t);
  return makeHold(h.id, h.type, parts, h.note);
}

export const inHold = (h: Hold, ix: number, iy: number) => h.parts.some((p) => inShape(p, ix, iy));

/** Wszystkie obrysy w jednej ścieżce – do wycięcia „oświetlonych” chwytów z przyciemnionej ściany. */
export function unionPath(holds: Hold[]): SkPath {
  const b = Skia.PathBuilder.Make();
  for (const h of holds) b.addPath(h.path);
  return b.detach();
}
