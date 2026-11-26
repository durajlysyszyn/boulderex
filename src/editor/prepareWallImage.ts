import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Maksymalny dłuższy bok zdjęcia roboczego – jak w prototypie (MAXS = 1400).
 * W tych współrzędnych będą zapisywane wielokąty chwytów.
 */
export const MAX_SIDE = 1400;

export type WallImage = { uri: string; width: number; height: number };

/**
 * Zmniejsza zdjęcie do MAX_SIDE i zapisuje je jako JPEG.
 * Natywny dekoder od razu uwzględnia orientację EXIF, więc piksele
 * są „wyprostowane” i nie trzymamy w pamięci zdjęcia 24–48 Mpx.
 */
export async function prepareWallImage(uri: string): Promise<WallImage> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const { width, height } = original;
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));

  const ctx = ImageManipulator.manipulate(original);
  if (k < 1) {
    ctx.resize(width >= height ? { width: Math.round(width * k) } : { height: Math.round(height * k) });
  }
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
