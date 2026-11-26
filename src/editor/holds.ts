import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { AutoHold, ManualHold, Point } from '../holds/segmentation';

export type HoldType = 'start' | 'hand' | 'foot' | 'top';
export const HOLD_TYPES: HoldType[] = ['start', 'hand', 'foot', 'top'];

export type Hold = {
  id: number;
  type: HoldType;
  shape: AutoHold | ManualHold;
  /** obrys jako ścieżka Skia (we współrzędnych zdjęcia) */
  path: SkPath;
};

/** Wygładzony obrys → gładka krzywa przez środki boków (jak w prototypie). */
export function outlinePath(p: Point[]): SkPath {
  const b = Skia.PathBuilder.Make();
  const n = p.length;
  if (n < 3) {
    const c = p[0] ?? [0, 0];
    b.addOval(Skia.XYWHRect(c[0] - 2, c[1] - 2, 4, 4));
    return b.detach();
  }
  const mid = (a: Point, c: Point): Point => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  const m = mid(p[n - 1], p[0]);
  b.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const m2 = mid(p[i], p[(i + 1) % n]);
    b.quadTo(p[i][0], p[i][1], m2[0], m2[1]);
  }
  b.close();
  return b.detach();
}

/** Wszystkie obrysy w jednej ścieżce – do wycięcia „oświetlonych” chwytów z przyciemnionej ściany. */
export function unionPath(holds: Hold[]): SkPath {
  const b = Skia.PathBuilder.Make();
  for (const h of holds) b.addPath(h.path);
  return b.detach();
}
