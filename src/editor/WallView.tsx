import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { BlurMask, Canvas, ColorMatrix, Group, Image, Path, type SkImage } from '@shopify/react-native-skia';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '../theme';
import { unionPath, type Hold } from './holds';

/** Zakres przybliżenia względem „dopasuj do ekranu” – jak w prototypie (0,9× … 10×). */
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 10;

/**
 * Przyciemnienie ściany poza zaznaczonymi chwytami – jak w prototypie:
 * kolor = (0,3·kanał + 0,7·szarość) · 0,33, szarość = 0,3R + 0,59G + 0,11B.
 */
const DIM = (() => {
  const g = [0.3, 0.59, 0.11];
  const row = (c: number) => g.map((v, i) => 0.33 * (0.7 * v + (i === c ? 0.3 : 0)));
  return [...row(0), 0, 0, ...row(1), 0, 0, ...row(2), 0, 0, 0, 0, 0, 1, 0];
})();

export type WallViewHandle = { fit: () => void };

type Props = {
  image: SkImage;
  width: number;
  height: number;
  holds: Hold[];
  activeId: number | null;
  /** tapnięcie we współrzędnych zdjęcia; scale – punkty ekranu na piksel zdjęcia */
  onTap: (ix: number, iy: number, scale: number) => void;
};

/**
 * Zdjęcie ścianki rysowane w Skia.
 * Widok: punkt zdjęcia p trafia na ekran w s·p + (tx, ty).
 * Dwa palce: przybliżanie wokół punktu między palcami + przesuwanie. Jeden palec: przesuwanie. Tapnięcie: chwyt.
 */
const WallView = forwardRef<WallViewHandle, Props>(function WallView(
  { image, width, height, holds, activeId, onTap },
  ref,
) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const s = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const fitS = useSharedValue(1);

  const fit = useCallback(
    (animated: boolean) => {
      if (!size) return;
      const f = Math.min(size.w / width, size.h / height);
      const nx = (size.w - width * f) / 2;
      const ny = (size.h - height * f) / 2;
      fitS.value = f;
      if (animated) {
        s.value = withTiming(f);
        tx.value = withTiming(nx);
        ty.value = withTiming(ny);
      } else {
        s.value = f;
        tx.value = nx;
        ty.value = ny;
      }
    },
    [size, width, height, fitS, s, tx, ty],
  );

  // nowe zdjęcie albo zmiana rozmiaru ekranu → dopasuj
  useEffect(() => fit(false), [fit]);
  useImperativeHandle(ref, () => ({ fit: () => fit(true) }), [fit]);

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      const ns = Math.min(fitS.value * MAX_ZOOM, Math.max(fitS.value * MIN_ZOOM, s.value * e.scaleChange));
      const k = ns / s.value;
      // punkt zdjęcia pod palcami zostaje pod palcami
      tx.value = e.focalX - (e.focalX - tx.value) * k;
      ty.value = e.focalY - (e.focalY - ty.value) * k;
      s.value = ns;
    },
  });

  const pan = usePanGesture({
    averageTouches: true,
    onUpdate: (e) => {
      'worklet';
      tx.value += e.changeX;
      ty.value += e.changeY;
    },
  });

  // zawsze najnowsza funkcja – gest nie musi się odtwarzać przy każdej zmianie chwytów
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const tap = useTapGesture({
    runOnJS: true,
    maxDistance: 10,
    maxDuration: 700,
    onActivate: (e) => {
      if (e.numberOfPointers !== 1) return;
      onTapRef.current((e.x - tx.value) / s.value, (e.y - ty.value) / s.value, s.value);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, tap);

  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: s.value },
  ]);
  // grubość linii i poświata stałe na ekranie, niezależnie od przybliżenia
  const lineW = useDerivedValue(() => 2.4 / s.value);
  const activeW = useDerivedValue(() => (2.4 * 3.2) / s.value);
  const glow = useDerivedValue(() => 7 / s.value);

  const lit = useMemo(() => unionPath(holds), [holds]);
  const active = holds.find((h) => h.id === activeId);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((old) => (old && old.w === w && old.h === h ? old : { w, h }));
  };

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.stage} onLayout={onLayout}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={transform}>
            {holds.length === 0 ? (
              <Image image={image} x={0} y={0} width={width} height={height} fit="fill" />
            ) : (
              <>
                <Image image={image} x={0} y={0} width={width} height={height} fit="fill">
                  <ColorMatrix matrix={DIM} />
                </Image>
                <Group clip={lit}>
                  <Image image={image} x={0} y={0} width={width} height={height} fit="fill" />
                </Group>
                {active && (
                  <Path path={active.path} style="stroke" strokeWidth={activeW} strokeJoin="round" color="rgba(255,255,255,0.95)" />
                )}
                {holds.map((h) => (
                  <Group key={h.id}>
                    <Path path={h.path} style="stroke" strokeWidth={lineW} strokeJoin="round" color={colors.hold[h.type]}>
                      <BlurMask blur={glow} style="solid" />
                    </Path>
                    <Path path={h.path} style="stroke" strokeWidth={lineW} strokeJoin="round" color={colors.hold[h.type]} />
                  </Group>
                ))}
              </>
            )}
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
});

export default WallView;

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: colors.stage },
});
