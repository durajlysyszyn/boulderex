import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Canvas, Group, Image, useImage } from '@shopify/react-native-skia';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '../theme';
import type { WallImage } from './prepareWallImage';

/** Zakres przybliżenia względem „dopasuj do ekranu” – jak w prototypie (0,9× … 10×). */
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 10;

export type WallViewHandle = { fit: () => void };

type Props = { wall: WallImage };

/**
 * Zdjęcie ścianki rysowane w Skia.
 * Widok: punkt zdjęcia p trafia na ekran w s·p + (tx, ty).
 * Dwa palce: przybliżanie wokół punktu między palcami + przesuwanie. Jeden palec: przesuwanie.
 */
const WallView = forwardRef<WallViewHandle, Props>(function WallView({ wall }, ref) {
  const image = useImage(wall.uri);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const s = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const fitS = useSharedValue(1);

  const fit = useCallback(
    (animated: boolean) => {
      if (!size) return;
      const f = Math.min(size.w / wall.width, size.h / wall.height);
      const nx = (size.w - wall.width * f) / 2;
      const ny = (size.h - wall.height * f) / 2;
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
    [size, wall.width, wall.height, fitS, s, tx, ty],
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

  const gesture = useSimultaneousGestures(pinch, pan);

  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: s.value },
  ]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((old) => (old && old.w === width && old.h === height ? old : { w: width, h: height }));
  };

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.stage} onLayout={onLayout}>
        <Canvas style={StyleSheet.absoluteFill}>
          {image && (
            <Group transform={transform}>
              <Image image={image} x={0} y={0} width={wall.width} height={wall.height} fit="fill" />
            </Group>
          )}
        </Canvas>
      </View>
    </GestureDetector>
  );
});

export default WallView;

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: colors.stage },
});
