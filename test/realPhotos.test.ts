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

  test('bez przybliżenia – gdy wyszła paczka, jest podpowiedź „przybliż”', () => {
    for (const [x, y, name] of steps) {
      const h = holdAt(img, x, y, { scale: 0.37 });
      if (area(h.mask) > 1000) assert.ok(h.skippedSmall, `${name}: zaznaczona paczka bez podpowiedzi`);
    }
  });
});
