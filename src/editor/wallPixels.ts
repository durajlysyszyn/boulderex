import { AlphaType, ColorType, type SkImage } from '@shopify/react-native-skia';
import { rgbaToLab, type LabImage } from '../holds/segmentation';

/** Piksele zdjęcia (RGBA) → obraz Lab dla algorytmu zaznaczania. */
export function labFromSkImage(image: SkImage): LabImage {
  const width = image.width(),
    height = image.height();
  const px = image.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!px || px instanceof Float32Array) throw new Error('Nie udało się odczytać pikseli zdjęcia');
  return rgbaToLab(px, width, height);
}
