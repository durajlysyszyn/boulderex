/**
 * Zaznaczanie chwytów – port algorytmu z prototyp-chwyty.html.
 *
 * Czysty TypeScript: bez canvasa, DOM i React Native. Dzięki temu da się go
 * testować w Node i przenieść poza wątek UI (worklet / wątek w tle).
 * Logika i stałe są celowo 1:1 z prototypem – test „zgodność z prototypem”
 * porównuje wyniki obu wersji piksel w piksel.
 *
 * 1) Mapa odległości geodezyjnej od miejsca tapnięcia: płynne cieniowanie chwytu kosztuje mało,
 *    ostre krawędzie (cień, granica chwyt–ściana/paczka) dużo.
 * 2) Próg dobierany automatycznie: szukamy momentu, w którym rosnący region „opiera się” o krawędź
 *    (plateau) albo tuż przed tym, jak wylewa się na ścianę. Wolimy mniejszy obiekt – chwyt, nie paczkę.
 * 3) Kontur: domknięcie, wypełnienie dziur, śledzenie brzegu i wygładzenie.
 */

export type Point = [number, number];

/** Zdjęcie robocze w przestrzeni Lab (po rozmyciu 3×3). */
export type LabImage = { w: number; h: number; lab: Float32Array };

/** Mapa odległości geodezyjnej w ramce wokół tapnięcia. */
export type Geo = {
  x0: number;
  y0: number;
  bw: number;
  bh: number;
  D: Float64Array;
  /** najmniejsza odległość na brzegu ramki (wewnątrz zdjęcia) */
  minB: number;
  /** posortowane odległości ≤ GMAX – do szybkiego liczenia pola dla progu */
  sorted: Float64Array;
  /** indeks punktu tapnięcia w ramce */
  si: number;
};

type Region = { b: Uint8Array; cnt: number; mx0: number; my0: number; mx1: number; my1: number };

/** Kształt chwytu we współrzędnych zdjęcia. */
export type HoldShape = {
  /** wygładzony obrys (zamknięty wielokąt) – do rysowania i zapisu */
  outline: Point[];
  /** maska do trafień: 1 = wnętrze chwytu; prostokąt (bx, by, w, h) */
  mask: Uint8Array;
  bx: number;
  by: number;
  w: number;
  h: number;
};

/** Wynik zaznaczenia tapnięciem. */
export type AutoHold = HoldShape & {
  /** punkt tapnięcia (zaokrąglony, w granicach zdjęcia) */
  x: number;
  y: number;
  /** próg użyty do konturu (null = nie znaleziono krawędzi – kółko) */
  t: number | null;
  /** próg dobrany automatycznie */
  ta: number | null;
  /** mapa geodezyjna – potrzebna, żeby suwak mógł szybko przeliczyć kontur */
  geo: Geo;
  /**
   * W miejscu tapnięcia był dużo mniejszy obiekt, ale uznany za otwór po śrubie
   * (za mały na ekranie przy tym przybliżeniu). Może chodziło o mały stopień – warto przybliżyć.
   */
  skippedSmall: boolean;
};

/* ---------- obraz i przestrzeń Lab ---------- */

/** RGBA (np. z getImageData / Skia readPixels) → Lab + rozmycie 3×3. */
export function rgbaToLab(rgba: ArrayLike<number>, w: number, h: number): LabImage {
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lin[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const lab = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const r = lin[rgba[j]],
      g = lin[rgba[j + 1]],
      b = lin[rgba[j + 2]];
    const fx = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.9505),
      fy = f(r * 0.2126 + g * 0.7152 + b * 0.0722),
      fz = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.089);
    lab[i * 3] = 116 * fy - 16;
    lab[i * 3 + 1] = 500 * (fx - fy);
    lab[i * 3 + 2] = 200 * (fy - fz);
  }
  // rozmycie 3×3 (rozdzielne: poziomo, potem pionowo)
  const t = new Float32Array(lab.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xa = x > 0 ? x - 1 : x,
        xb = x < w - 1 ? x + 1 : x;
      for (let c = 0; c < 3; c++)
        t[(y * w + x) * 3 + c] = (lab[(y * w + xa) * 3 + c] + lab[(y * w + x) * 3 + c] + lab[(y * w + xb) * 3 + c]) / 3;
    }
  for (let y = 0; y < h; y++) {
    const ya = y > 0 ? y - 1 : y,
      yb = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++)
        lab[(y * w + x) * 3 + c] = (t[(ya * w + x) * 3 + c] + t[(y * w + x) * 3 + c] + t[(yb * w + x) * 3 + c]) / 3;
  }
  return { w, h, lab };
}

/* ---------- mapa geodezyjna ---------- */

export const GMAX = 60;

/** Promień ramki obliczeń w punktach ekranu (ok. pół szerokości ekranu telefonu z zapasem). */
const VIEW_RADIUS = 250;
const NOISE = 1.3;
const STEP = 0.07;

/** Dijkstra od tapnięcia; koszt kroku = różnica koloru ponad poziom szumu. */
export function geodesic(img: LabImage, x: number, y: number, scale = DEFAULT_SCALE): Geo {
  const { w: W, h: H, lab } = img;
  // ramka: 12% zdjęcia, ale po przybliżeniu nie więcej niż to, co widać na ekranie
  // (chwyt większy niż ekran nie jest tym, w co celowano – a liczenie jest dużo szybsze)
  const M = Math.max(W, H),
    R = Math.min(Math.round(M * 0.12), Math.round(VIEW_RADIUS / scale));
  const x0 = Math.max(0, x - R),
    y0 = Math.max(0, y - R),
    x1 = Math.min(W - 1, x + R),
    y1 = Math.min(H - 1, y + R);
  const bw = x1 - x0 + 1,
    bh = y1 - y0 + 1,
    N = bw * bh,
    D = new Float64Array(N).fill(Infinity);

  // kopiec binarny (klucz, indeks)
  let cap = N * 2 + 64,
    hk = new Float64Array(cap),
    hi = new Int32Array(cap),
    hn = 0,
    popK = 0;
  const push = (i: number, k: number) => {
    if (hn >= cap) {
      cap *= 2;
      const a = new Float64Array(cap);
      a.set(hk);
      hk = a;
      const b = new Int32Array(cap);
      b.set(hi);
      hi = b;
    }
    let c = hn++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hk[p] <= k) break;
      hk[c] = hk[p];
      hi[c] = hi[p];
      c = p;
    }
    hk[c] = k;
    hi[c] = i;
  };
  const pop = () => {
    const k = hk[0],
      i = hi[0];
    hn--;
    if (hn > 0) {
      const lk = hk[hn],
        li = hi[hn];
      let c = 0;
      for (;;) {
        let m = c * 2 + 1;
        if (m >= hn) break;
        if (m + 1 < hn && hk[m + 1] < hk[m]) m++;
        if (hk[m] >= lk) break;
        hk[c] = hk[m];
        hi[c] = hi[m];
        c = m;
      }
      hk[c] = lk;
      hi[c] = li;
    }
    popK = k;
    return i;
  };

  // ziarno: małe kółko wokół tapnięcia
  const rs = Math.max(1, Math.round(M * 0.002));
  for (let dy = -rs; dy <= rs; dy++)
    for (let dx = -rs; dx <= rs; dx++) {
      if (dx * dx + dy * dy > rs * rs) continue;
      const px = x + dx,
        py = y + dy;
      if (px < x0 || py < y0 || px > x1 || py > y1) continue;
      const li = (py - y0) * bw + px - x0;
      D[li] = 0;
      push(li, 0);
    }

  const cost = (ka: number, kb: number) => {
    const dL = lab[ka] - lab[kb],
      da = lab[ka + 1] - lab[kb + 1],
      db = lab[ka + 2] - lab[kb + 2];
    const d = Math.sqrt(0.8 * dL * dL + da * da + db * db);
    return (d > NOISE ? d - NOISE : 0) + STEP;
  };
  while (hn) {
    const i = pop(),
      k = popK;
    if (k > D[i]) continue;
    if (k > GMAX) break;
    const lx = i % bw,
      ly = (i / bw) | 0,
      ka = ((ly + y0) * W + lx + x0) * 3;
    if (lx > 0) {
      const j = i - 1,
        n = k + cost(ka, ka - 3);
      if (n < D[j]) {
        D[j] = n;
        push(j, n);
      }
    }
    if (lx < bw - 1) {
      const j = i + 1,
        n = k + cost(ka, ka + 3);
      if (n < D[j]) {
        D[j] = n;
        push(j, n);
      }
    }
    if (ly > 0) {
      const j = i - bw,
        n = k + cost(ka, ka - W * 3);
      if (n < D[j]) {
        D[j] = n;
        push(j, n);
      }
    }
    if (ly < bh - 1) {
      const j = i + bw,
        n = k + cost(ka, ka + W * 3);
      if (n < D[j]) {
        D[j] = n;
        push(j, n);
      }
    }
  }

  // krawędź ramki (tylko boki wewnątrz zdjęcia – chwyt ucięty kadrem jest w porządku)
  let minB = Infinity;
  for (let i = 0; i < bw; i++) {
    if (y0 > 0) minB = Math.min(minB, D[i]);
    if (y1 < H - 1) minB = Math.min(minB, D[(bh - 1) * bw + i]);
  }
  for (let j = 0; j < bh; j++) {
    if (x0 > 0) minB = Math.min(minB, D[j * bw]);
    if (x1 < W - 1) minB = Math.min(minB, D[j * bw + bw - 1]);
  }
  const vals: number[] = [];
  for (let i = 0; i < N; i++) if (D[i] <= GMAX) vals.push(D[i]);
  const sorted = Float64Array.from(vals).sort();
  return { x0, y0, bw, bh, D, minB, sorted, si: (y - y0) * bw + x - x0 };
}

/* ---------- automatyczny próg ---------- */

function areaAt(sorted: Float64Array, t: number) {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * Przybliżenie widoku: ile punktów ekranu przypada na piksel zdjęcia roboczego.
 * Domyślnie – typowy widok „dopasuj” na telefonie (zdjęcie 1400 px na ok. 400 pt).
 */
export const DEFAULT_SCALE = 0.3;

/**
 * Średnica (w punktach ekranu), poniżej której mały ciemny obiekt uznajemy za otwór po śrubie.
 * Mniejszego obiektu nie da się celowo tapnąć palcem; większy – np. mały stopień po przybliżeniu –
 * użytkownik widzi i tapnął go świadomie.
 */
const HOLE_MAX_SCREEN_D = 12;

/** Zaznaczony obszar tyle razy większy od najmniejszego obiektu pod palcem → podpowiedź „przybliż”. */
const SKIPPED_RATIO = 80;

/** Największe pole (w px zdjęcia), które może być otworem po śrubie przy danym przybliżeniu. */
function holeArea(img: LabImage, scale: number) {
  const M = Math.max(img.w, img.h);
  const onScreen = Math.PI * (HOLE_MAX_SCREEN_D / 2 / scale) ** 2;
  return { small: Math.min(Math.PI * (M * 0.0045) ** 2, onScreen), dark: Math.min(Math.PI * (M * 0.0055) ** 2, onScreen) };
}

/**
 * Automatyczny próg: pierwsze „plateau” – obszar przestaje rosnąć, bo region oparł się o krawędź chwytu –
 * albo ostatni próg przed „wybuchem”. Pomija otwory po śrubach, woli chwyt niż paczkę.
 */
export function autoT(img: LabImage, g: Geo, scale = DEFAULT_SCALE): number | null {
  const { ev, tc, A, maxA } = thresholdEvents(img, g);
  const smallA = holeArea(img, scale).small;
  if (!ev.length) return tc;
  let best = ev[0];
  // pierwszy znaleziony obiekt to otwór po śrubie? weź następny, rozsądnej wielkości
  if (A(best) < smallA) {
    const nx = ev.find((e) => A(e) >= smallA && A(e) <= Math.min(maxA, A(best) * 120));
    if (nx != null) best = nx;
  }
  // wolimy chwyt niż całą paczkę
  if (tc != null && tc < best && A(tc) >= smallA && A(best) > 4 * A(tc)) return tc;
  return best;
}

/**
 * Kandydaci na próg: ev – progi, przy których region oparł się o krawędź (rosnąco),
 * tc – pierwsza słabsza krawędź (albo null).
 */
export function thresholdEvents(img: LabImage, g: Geo) {
  const M = Math.max(img.w, img.h),
    minA = Math.PI * (M * 0.0028) ** 2,
    smallA = Math.PI * (M * 0.0045) ** 2,
    maxA = Math.PI * (M * 0.05) ** 2,
    dt = 0.25,
    Dl = 1.5;
  const tMax = Math.min(GMAX - 2, g.minB - 0.5),
    A = (t: number) => areaAt(g.sorted, t),
    sc = (t: number) => (A(t + Dl) - A(t - Dl)) / A(t);
  const ev: number[] = [];
  let run: { a: number; b: number } | null = null,
    tc: number | null = null;
  const endRun = () => {
    if (run && run.b - run.a >= 3) ev.push(Math.min(run.a + (run.b - run.a) * 0.6, run.a + 6));
    run = null;
  };
  for (let t = Dl; t <= tMax; t += dt) {
    const a = A(t);
    if (a < minA) {
      run = null;
      continue;
    }
    const s = sc(t);
    // a) plateau: region oparł się o wyraźną krawędź
    if (s < 0.12) {
      if (!run) run = { a: t, b: t };
      run.b = t;
    } else endRun();
    // b) ostatni próg przed „wybuchem” (wylanie na ścianę/paczkę), o ile przedtem rósł spokojnie
    if (t >= 3 && A(t + 2) > a * 2.2 && a < A(t - 2) * 1.6) ev.push(t);
    // c) słabsza krawędź (magnezja, połysk, chwyt na paczce w podobnym kolorze)
    if (tc == null && a <= maxA && s < 0.22) tc = t;
  }
  endRun();
  ev.sort((a, b) => a - b);
  return { ev, tc: tc as number | null, A, minA, smallA, maxA };
}

/* ---------- region i jego ocena ---------- */

function region(g: Geo, t: number): Region {
  const { bw, bh, D, si } = g,
    N = bw * bh,
    b = new Uint8Array(N);
  let cnt = 0,
    mx0 = bw,
    my0 = bh,
    mx1 = 0,
    my1 = 0;
  for (let i = 0; i < N; i++)
    if (D[i] <= t) {
      b[i] = 1;
      cnt++;
      const lx = i % bw,
        ly = (i / bw) | 0;
      if (lx < mx0) mx0 = lx;
      if (lx > mx1) mx1 = lx;
      if (ly < my0) my0 = ly;
      if (ly > my1) my1 = ly;
    }
  b[si] = 1;
  return { b, cnt, mx0, my0, mx1, my1 };
}

/** Czy region otacza punkt (x, y) – leży w nim albo w jego dziurze. */
function encloses(g: Geo, r: Region, x: number, y: number) {
  const { bw, bh } = g,
    lx = x - g.x0,
    ly = y - g.y0;
  if (lx < 0 || ly < 0 || lx >= bw || ly >= bh) return false;
  if (r.b[ly * bw + lx]) return true;
  const v = new Uint8Array(bw * bh),
    q = new Int32Array(bw * bh);
  let qt = 0,
    qh = 0;
  const add = (i: number) => {
    if (!v[i] && !r.b[i]) {
      v[i] = 1;
      q[qt++] = i;
    }
  };
  for (let i = 0; i < bw; i++) {
    add(i);
    add((bh - 1) * bw + i);
  }
  for (let j = 0; j < bh; j++) {
    add(j * bw);
    add(j * bw + bw - 1);
  }
  while (qh < qt) {
    const i = q[qh++],
      cx = i % bw,
      cy = (i / bw) | 0;
    if (cx > 0) add(i - 1);
    if (cx < bw - 1) add(i + 1);
    if (cy > 0) add(i - bw);
    if (cy < bh - 1) add(i + bw);
  }
  return !v[ly * bw + lx];
}

function meanL(img: LabImage, g: Geo, r: Region) {
  let s = 0,
    n = 0;
  for (let i = 0; i < r.b.length; i++)
    if (r.b[i]) {
      s += img.lab[(((i / g.bw) | 0) + g.y0) * img.w * 3 + ((i % g.bw) + g.x0) * 3];
      n++;
    }
  return n ? s / n : 0;
}

/** Średnia jasność pasa tuż za brzegiem regionu. */
function bandL(img: LabImage, g: Geo, r: Region, w: number) {
  const { bw, bh } = g;
  let s = 0,
    n = 0;
  for (let y = Math.max(0, r.my0 - w); y <= Math.min(bh - 1, r.my1 + w); y++)
    for (let x = Math.max(0, r.mx0 - w); x <= Math.min(bw - 1, r.mx1 + w); x++) {
      const i = y * bw + x;
      if (r.b[i]) continue;
      let near = false;
      for (let k = 1; k <= w && !near; k++)
        near = !!((x >= k && r.b[i - k]) || (x + k < bw && r.b[i + k]) || (y >= k && r.b[i - k * bw]) || (y + k < bh && r.b[i + k * bw]));
      if (near) {
        s += img.lab[((y + g.y0) * img.w + x + g.x0) * 3];
        n++;
      }
    }
  return n ? s / n : 0;
}

/** Różnica koloru (jak w koszcie kroku: jasność z wagą 0,8) między dwoma pikselami. */
function labDist(img: LabImage, x1: number, y1: number, x2: number, y2: number) {
  const cl = (v: number, m: number) => Math.max(0, Math.min(m - 1, v));
  const a = (cl(y1, img.h) * img.w + cl(x1, img.w)) * 3,
    b = (cl(y2, img.h) * img.w + cl(x2, img.w)) * 3,
    L = img.lab;
  const dL = L[a] - L[b],
    da = L[a + 1] - L[b + 1],
    db = L[a + 2] - L[b + 2];
  return Math.sqrt(0.8 * dL * dL + da * da + db * db);
}

/** Siła krawędzi w punkcie: największa różnica koloru między sąsiadami po przeciwnych stronach. */
function edgeAt(img: LabImage, x: number, y: number) {
  return Math.max(
    labDist(img, x - 1, y, x + 1, y),
    labDist(img, x, y - 1, x, y + 1),
    labDist(img, x - 1, y - 1, x + 1, y + 1),
    labDist(img, x - 1, y + 1, x + 1, y - 1),
  );
}

/** Tapnięcie w krawędź: powyżej tej różnicy koloru między sąsiadami punkt startu leży na granicy obiektów. */
const EDGE = 12;
/** Jak daleko (w punktach ekranu) szukać jednolitego miejsca obok krawędzi – ok. niedokładność palca. */
const FINGER = 16;

/** Czy region dochodzi do punktu (x, y) na odległość ≤ d px. */
function near(g: Geo, r: Region, x: number, y: number, d: number) {
  for (let yy = y - d; yy <= y + d; yy++)
    for (let xx = x - d; xx <= x + d; xx++) {
      const lx = xx - g.x0,
        ly = yy - g.y0;
      if (lx >= 0 && ly >= 0 && lx < g.bw && ly < g.bh && r.b[ly * g.bw + lx]) return true;
    }
  return false;
}

/**
 * Wybór regionu: najpierw ziarno w punkcie tapnięcia.
 * Gdy tapnięcie trafiło w krawędź (granica stopień–paczka), próbujemy też jednolitych miejsc tuż obok
 * i bierzemy najmniejszy obiekt przy palcu. Pierścień ziaren – gdy tapnięcie trafiło w otwór/śrubę.
 */
export function segment(
  img: LabImage,
  x: number,
  y: number,
  scale = DEFAULT_SCALE,
): { g: Geo; t: number | null; firstArea: number | null } {
  const M = Math.max(img.w, img.h),
    rho = Math.max(5, Math.round(M * 0.008)),
    maxA = Math.PI * (M * 0.05) ** 2;
  const g0 = geodesic(img, x, y, scale),
    t0 = autoT(img, g0, scale),
    r0 = t0 == null ? null : region(g0, t0);
  // pole najmniejszego obiektu w punkcie tapnięcia – do podpowiedzi „przybliż”
  const e0 = thresholdEvents(img, g0),
    firstArea = e0.ev.length ? e0.A(e0.ev[0]) : null;
  // mały i ciemniejszy od otoczenia = pewnie otwór/śruba
  const holeLike = (g: Geo, r: Region) => r.cnt < holeArea(img, scale).dark && meanL(img, g, r) <= bandL(img, g, r, 3) - 15;

  if (edgeAt(img, x, y) >= EDGE) {
    const c: { g: Geo; t: number; r: Region }[] = [];
    if (r0 && t0 != null && !holeLike(g0, r0)) c.push({ g: g0, t: t0, r: r0 });
    const reach = Math.max(2, Math.min(rho, Math.round(FINGER / scale)));
    // obiekty leżą po obu stronach krawędzi: szukamy w poprzek niej (kierunek największej zmiany koloru)
    const axes = [
      [0, labDist(img, x - 1, y, x + 1, y)],
      [Math.PI / 2, labDist(img, x, y - 1, x, y + 1)],
      [Math.PI / 4, labDist(img, x - 1, y - 1, x + 1, y + 1)],
      [-Math.PI / 4, labDist(img, x - 1, y + 1, x + 1, y - 1)],
    ].sort((p, q) => q[1] - p[1]);
    for (const a of [axes[0][0], axes[0][0] + Math.PI]) {
      // w tym kierunku, w zasięgu palca: najbardziej jednolite miejsce (najsłabsza krawędź)
      let best: [number, number, number] | null = null;
      for (let d = 1; d <= reach; d++) {
        const sx = Math.round(x + Math.cos(a) * d),
          sy = Math.round(y + Math.sin(a) * d);
        if (sx < 1 || sy < 1 || sx >= img.w - 1 || sy >= img.h - 1) break;
        const e = edgeAt(img, sx, sy);
        if (e < EDGE && (!best || e < best[2])) best = [sx, sy, e];
      }
      if (!best) continue;
      const [sx, sy] = best;
      if (c.some((o) => near(o.g, o.r, sx, sy, 0))) continue;
      const g = geodesic(img, sx, sy, scale),
        t = autoT(img, g, scale);
      if (t == null) continue;
      const r = region(g, t);
      if (near(g, r, x, y, reach) && !holeLike(g, r) && r.cnt <= maxA) c.push({ g, t, r });
    }
    if (c.length) {
      c.sort((a, b) => a.r.cnt - b.r.cnt);
      return { g: c[0].g, t: c[0].t, firstArea };
    }
  }

  if (r0 && !holeLike(g0, r0)) return { g: g0, t: t0, firstArea };
  const c: { g: Geo; t: number; r: Region }[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2,
      sx = Math.round(x + Math.cos(a) * rho),
      sy = Math.round(y + Math.sin(a) * rho);
    if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
    if (
      c.some((o) => {
        const lx = sx - o.g.x0,
          ly = sy - o.g.y0;
        return lx >= 0 && ly >= 0 && lx < o.g.bw && ly < o.g.bh && o.r.b[ly * o.g.bw + lx];
      })
    )
      continue;
    const g = geodesic(img, sx, sy, scale),
      t = autoT(img, g, scale);
    if (t == null) continue;
    const r = region(g, t);
    if (encloses(g, r, x, y) && meanL(img, g, r) > bandL(img, g, r, 3) - 15 && r.cnt <= maxA) c.push({ g, t, r });
  }
  if (c.length) {
    c.sort((a, b) => a.r.cnt - b.r.cnt);
    return { g: c[0].g, t: c[0].t, firstArea };
  }
  return { g: g0, t: t0, firstArea };
}

/* ---------- kontur ---------- */

/** Śledzenie brzegu maski (sąsiedztwo 8). Zwraca piksele brzegu po kolei. */
export function trace(a: Uint8Array, w: number, h: number): Point[] {
  let st = -1;
  for (let i = 0; i < a.length; i++)
    if (a[i]) {
      st = i;
      break;
    }
  if (st < 0) return [];
  const dx = [1, 1, 0, -1, -1, -1, 0, 1],
    dy = [0, 1, 1, 1, 0, -1, -1, -1],
    at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x];
  const dir = (ddx: number, ddy: number) => {
    for (let k = 0; k < 8; k++) if (dx[k] === ddx && dy[k] === ddy) return k;
    return 4;
  };
  let x = st % w,
    y = (st / w) | 0,
    b = 4;
  const sx = x,
    sy = y,
    pts: Point[] = [];
  for (let n = 0; n < a.length * 3; n++) {
    pts.push([x, y]);
    let f = false;
    for (let k = 1; k <= 8; k++) {
      const nd = (b + k) % 8,
        nx = x + dx[nd],
        ny = y + dy[nd];
      if (at(nx, ny)) {
        const pd = (b + k + 7) % 8,
          px = x + dx[pd],
          py = y + dy[pd];
        x = nx;
        y = ny;
        b = dir(px - x, py - y);
        f = true;
        break;
      }
    }
    if (!f || (x === sx && y === sy)) break;
  }
  return pts;
}

/** Brzeg pikselowy → wygładzony obrys we współrzędnych zdjęcia (środki pikseli). */
function smoothOutline(pts: Point[], ox: number, oy: number): Point[] {
  let p: Point[] = pts.map(([x, y]) => [x + ox + 0.5, y + oy + 0.5]);
  const n = p.length;
  if (n < 4) return p;
  const k = Math.max(1, Math.min(4, Math.round(n / 40)));
  for (let pass = 0; pass < 2; pass++) {
    const q: Point[] = [];
    for (let i = 0; i < n; i++) {
      let sx = 0,
        sy = 0;
      for (let j = -k; j <= k; j++) {
        const r = p[(i + j + n) % n];
        sx += r[0];
        sy += r[1];
      }
      q.push([sx / (2 * k + 1), sy / (2 * k + 1)]);
    }
    p = q;
  }
  return p;
}

/** Rozdzielne rozszerzanie (dil) / zwężanie maski kwadratem promienia r. */
function morph(a: Uint8Array, w: number, h: number, r: number, dil: boolean) {
  const t = new Uint8Array(a.length),
    o = new Uint8Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = dil ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k,
          s = xx < 0 || xx >= w ? 0 : a[y * w + xx];
        if (dil && s) {
          v = 1;
          break;
        }
        if (!dil && !s) {
          v = 0;
          break;
        }
      }
      t[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = dil ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k,
          s = yy < 0 || yy >= h ? 0 : t[yy * w + x];
        if (dil && s) {
          v = 1;
          break;
        }
        if (!dil && !s) {
          v = 0;
          break;
        }
      }
      o[y * w + x] = v;
    }
  return o;
}

/** Kółko – gdy nie znaleziono krawędzi chwytu (t == null). */
function circleShape(img: LabImage, cx: number, cy: number): HoldShape {
  const r = Math.round(Math.max(img.w, img.h) * 0.012);
  const bx = cx - r,
    by = cy - r,
    w = 2 * r + 1,
    h = 2 * r + 1,
    mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - r) ** 2 + (y - r) ** 2 <= r * r) mask[y * w + x] = 1;
  const outline: Point[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    outline.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { outline, mask, bx, by, w, h };
}

/** Kontur dla danego progu: domknięcie, wypełnienie dziur, śledzenie brzegu, wygładzenie. */
export function shapeAt(img: LabImage, g: Geo, t: number | null, x: number, y: number): HoldShape {
  if (t == null) return circleShape(img, x, y);
  const res = region(g, t),
    rc = Math.max(1, Math.min(8, Math.round(Math.sqrt(res.cnt / Math.PI) * 0.12))),
    P = rc + 2;
  const pw = res.mx1 - res.mx0 + 1 + 2 * P,
    ph = res.my1 - res.my0 + 1 + 2 * P,
    ox = g.x0 + res.mx0 - P,
    oy = g.y0 + res.my0 - P;
  let a = new Uint8Array(pw * ph);
  for (let yy = res.my0; yy <= res.my1; yy++)
    for (let xx = res.mx0; xx <= res.mx1; xx++) if (res.b[yy * g.bw + xx]) a[(yy - res.my0 + P) * pw + xx - res.mx0 + P] = 1;
  a = morph(morph(a, pw, ph, rc, true), pw, ph, rc, false);
  // wypełnienie dziur: wszystko, czego nie da się osiągnąć z brzegu ramki, należy do chwytu
  const v = new Uint8Array(pw * ph),
    q = new Int32Array(pw * ph);
  let qh = 0,
    qt = 0;
  const add = (i: number) => {
    if (!v[i] && !a[i]) {
      v[i] = 1;
      q[qt++] = i;
    }
  };
  for (let i = 0; i < pw; i++) {
    add(i);
    add((ph - 1) * pw + i);
  }
  for (let j = 0; j < ph; j++) {
    add(j * pw);
    add(j * pw + pw - 1);
  }
  while (qh < qt) {
    const i = q[qh++],
      lx = i % pw,
      ly = (i / pw) | 0;
    if (lx > 0) add(i - 1);
    if (lx < pw - 1) add(i + 1);
    if (ly > 0) add(i - pw);
    if (ly < ph - 1) add(i + pw);
  }
  for (let i = 0; i < a.length; i++) if (!v[i]) a[i] = 1;
  return { outline: smoothOutline(trace(a, pw, ph), ox, oy), mask: a, bx: ox, by: oy, w: pw, h: ph };
}

/**
 * Tapnięcie w (x, y) we współrzędnych zdjęcia → chwyt.
 * t – próg z suwaka (np. przy wczytywaniu zapisanego balda); null = automatyczny.
 * scale – przybliżenie widoku w chwili tapnięcia (punkty ekranu na piksel zdjęcia).
 */
export function holdAt(
  img: LabImage,
  x: number,
  y: number,
  { t = null, scale = DEFAULT_SCALE }: { t?: number | null; scale?: number } = {},
): AutoHold {
  x = Math.max(0, Math.min(img.w - 1, Math.round(x)));
  y = Math.max(0, Math.min(img.h - 1, Math.round(y)));
  const r = segment(img, x, y, scale);
  const tt = t == null ? r.t : t;
  const shape = shapeAt(img, r.g, tt, x, y);
  // śruba w chwycie to ok. 1/35–1/70 jego pola; stopień na paczce – ok. 1/80–1/160 paczki
  const area = shape.mask.reduce((a, v) => a + v, 0);
  const skippedSmall = r.firstArea != null && area > SKIPPED_RATIO * r.firstArea;
  return { ...shape, x, y, t: tt, ta: r.t, geo: r.g, skippedSmall };
}

/** Suwak: przelicza kontur istniejącego chwytu dla nowego progu (bez ponownego Dijkstry). */
export function withThreshold(img: LabImage, hold: AutoHold, t: number): AutoHold {
  return { ...hold, ...shapeAt(img, hold.geo, t, hold.x, hold.y), t };
}

/* ---------- tryb ręczny ---------- */

export type ManualHold = HoldShape & {
  /** obrys do zapisu w bazie (zaokrąglony do 0,1 px) */
  poly: Point[];
};

function pointInPolygon(poly: Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Obrys palcem → wygładzony wielokąt + maska do trafień. null = obrys za mały. */
export function manualHold(stroke: Point[]): ManualHold | null {
  const pts: Point[] = [];
  for (const p of stroke) {
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= 1.5) pts.push([p[0], p[1]]);
  }
  if (pts.length < 3) return null;
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const n = pts.length,
    k = Math.max(1, Math.min(3, Math.round(n / 30)));
  const outline: Point[] = pts.map((_, i) => {
    let sx = 0,
      sy = 0;
    for (let j = -k; j <= k; j++) {
      const r = pts[(i + j + n) % n];
      sx += r[0];
      sy += r[1];
    }
    return [sx / (2 * k + 1), sy / (2 * k + 1)];
  });
  const bx = Math.floor(x0) - 2,
    by = Math.floor(y0) - 2,
    w = Math.ceil(x1 - x0) + 5,
    h = Math.ceil(y1 - y0) + 5,
    mask = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (pointInPolygon(outline, bx + xx + 0.5, by + yy + 0.5)) mask[yy * w + xx] = 1;
  return {
    poly: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
    outline,
    mask,
    bx,
    by,
    w,
    h,
  };
}

/* ---------- trafienia ---------- */

/** Czy punkt zdjęcia (ix, iy) leży w chwycie. */
export function inShape(s: HoldShape, ix: number, iy: number) {
  const lx = Math.floor(ix - s.bx),
    ly = Math.floor(iy - s.by);
  return lx >= 0 && ly >= 0 && lx < s.w && ly < s.h && s.mask[ly * s.w + lx] === 1;
}
