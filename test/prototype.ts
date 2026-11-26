// Uruchamia oryginalny algorytm z prototyp-chwyty.html w Node – bez przepisywania.
// Wycina z pliku HTML fragment od `function setWall` do `const inHold` i podstawia
// brakujące zależności przeglądarki (canvas, Path2D, funkcje interfejsu).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D, type Canvas } from '@napi-rs/canvas';

export type ProtoHold = { x: number; y: number; t: number | null; ta: number | null; m: Uint8Array | null; bx: number; by: number; w: number; h: number };
export type Prototype = {
  setWall(cv: Canvas): void;
  makeHold(x: number, y: number, type: string, t: number | null): ProtoHold;
  trace(a: Uint8Array, w: number, h: number): [number, number][];
};

export function loadPrototype(): Prototype {
  const html = readFileSync(fileURLToPath(new URL('../prototyp-chwyty.html', import.meta.url)), 'utf8');
  const start = html.indexOf('function setWall(');
  const end = html.indexOf('const inHold=');
  if (start < 0 || end < 0) throw new Error('Nie znalazłem algorytmu w prototyp-chwyty.html');
  const code = `
    let W=0,H=0,src=null,lab=null,dim=null,holds=[],undo=[],activeId=null;
    const mk=(w,h)=>createCanvas(w,h);
    const fit=()=>{},compose=()=>{};
    ${html.slice(start, end)}
    return {setWall,makeHold,trace};`;
  return new Function('createCanvas', 'Path2D', code)(createCanvas, Path2D) as Prototype;
}
