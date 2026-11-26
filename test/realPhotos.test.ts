// Regresje na prawdziwych zdjęciach ze ścianek.
// Zdjęcia: test/zdjecia/*-1400.jpg – już pomniejszone i obrócone jak w aplikacji (zdjęcie robocze).
// Współrzędne tapnięć pochodzą z logu aplikacji: „[chwyty] tapnięcie (x, y) w W×H …”.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { holdAt, rgbaToLab, type LabImage } from '../src/holds/segmentation.ts';

async function photo(name: string): Promise<LabImage> {
  const im = await loadImage(fileURLToPath(new URL(`./zdjecia/${name}`, import.meta.url)));
  const c = createCanvas(im.width, im.height);
  c.getContext('2d').drawImage(im, 0, 0);
  return rgbaToLab(c.getContext('2d').getImageData(0, 0, im.width, im.height).data, im.width, im.height);
}
const area = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);

describe('IMG_1005 (Obiekto): małe stopnie na żółtej paczce', async () => {
  const img = await photo('IMG_1005-1400.jpg');
  // stopnie mają ok. 10×6 px; paczka ok. 11 000 px
  const steps: [number, number, string][] = [
    [613, 711, 'czarny'],
    [610, 713, 'czarny (obok)'],
    [580, 697, 'fioletowy'],
    [580, 775, 'mały niebieski'],
  ];

  test('po przybliżeniu tapnięcie zaznacza stopień, nie paczkę', () => {
    for (const scale of [1, 1.5, 2.5]) {
      for (const [x, y, name] of steps) {
        const h = holdAt(img, x, y, { scale });
        const a = area(h.mask);
        assert.ok(a >= 40 && a <= 400, `${name}, przybliżenie ${scale}: pole ${a} px (paczka?)`);
        assert.ok(Math.abs(h.bx + h.w / 2 - x) < 15 && Math.abs(h.by + h.h / 2 - y) < 15, `${name}, przybliżenie ${scale}: obrys nie w miejscu tapnięcia`);
      }
    }
  });

  test('tapnięcie w krawędź małego stopnia (niebieski na paczce, lewa strona)', () => {
    // palec trafił w granicę niebieski–żółty: start z krawędzi rozlewał się na paczkę
    const h = holdAt(img, 98, 745, { scale: 3.82 });
    const a = area(h.mask);
    assert.ok(a >= 30 && a <= 200, `pole ${a} px`);
    assert.ok(Math.abs(h.bx + h.w / 2 - 96) < 6 && Math.abs(h.by + h.h / 2 - 746) < 6, 'obrys nie na stopniu');
  });

  test('żółty chwyt na żółtej paczce – po przybliżeniu chwyt, nie paczka', () => {
    const a = area(holdAt(img, 923, 495, { scale: 2.71 }).mask);
    assert.ok(a >= 400 && a <= 2000, `pole ${a} px (chwyt ok. 900 px, paczka ok. 15 000 px)`);
  });

  test('po przybliżeniu nigdy cała paczka', () => {
    for (const [x, y, s] of [[1037, 518, 2.68], [953, 545, 2.71], [98, 745, 3.82], [923, 495, 2.71]]) {
      const a = area(holdAt(img, x, y, { scale: s }).mask);
      assert.ok(a < 3000, `(${x}, ${y}): pole ${a} px`);
    }
  });

  test('ZNANE: słaby kontrast i ucięte kadrem', { todo: 'obrys ręczny / model AI' }, () => {
    const cases: [number, number, number, string, number, number][] = [
      [985, 507, 3.83, 'niebieski stopień z odblaskiem – tylko ciemna część', 110, 250],
      [953, 545, 2.71, 'kremowy stopień na żółtej paczce', 150, 500],
      [882, 458, 2.71, 'biały chwyt ze strzałką – zaznacza samą strzałkę', 400, 1200],
      [223, 489, 3.8, 'kremowy stopień na białej ścianie – nie widzi', 60, 300],
      [1037, 518, 2.68, 'stopień ucięty prawą krawędzią zdjęcia', 60, 400],
    ];
    for (const [x, y, s, name, lo, hi] of cases) {
      const h = holdAt(img, x, y, { scale: s });
      const a = area(h.mask);
      assert.ok(h.t != null && a >= lo && a <= hi, `${name}: pole ${a} px`);
    }
  });

  test('bez przybliżenia – gdy wyszła paczka, jest podpowiedź „przybliż”', () => {
    for (const [x, y, name] of steps) {
      const h = holdAt(img, x, y, { scale: 0.37 });
      if (area(h.mask) > 1000) assert.ok(h.skippedSmall, `${name}: zaznaczona paczka bez podpowiedzi`);
    }
  });
});
