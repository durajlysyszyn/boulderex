import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  ColorMatrix,
  Group,
  Image,
  matchFont,
  Path,
  RoundedRect,
  Skia,
  Text,
  type SkFont,
  type SkImage,
} from '@shopify/react-native-skia';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import type { Point } from '../holds/segmentation';
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

const labelFont = matchFont({
  fontFamily: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif-condensed' }),
  fontSize: 12,
  fontWeight: 'bold',
});

export type WallViewHandle = { fit: () => void };

type Props = {
  image: SkImage;
  width: number;
  height: number;
  holds: Hold[];
  activeId: number | null;
  /** tapnięcie we współrzędnych zdjęcia; scale – punkty ekranu na piksel zdjęcia */
  onTap: (ix: number, iy: number, scale: number) => void;
  /** tryb obrysu palcem: jeden palec rysuje, dwa przesuwają i przybliżają */
  lasso: boolean;
  strokeColor: string;
  /** zakończony obrys palcem (punkty we współrzędnych zdjęcia) */
  onStroke: (points: Point[]) => void;
};

/**
 * Zdjęcie ścianki rysowane w Skia.
 * Widok: punkt zdjęcia p trafia na ekran w s·p + (tx, ty).
 */
const WallView = forwardRef<WallViewHandle, Props>(function WallView(
  { image, width, height, holds, activeId, onTap, lasso, strokeColor, onStroke },
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

  // tryb obrysu: przesuwanie wymaga dwóch palców, rysowanie jest włączone
  const navMinPointers = useSharedValue(1);
  const drawEnabled = useSharedValue(false);
  useEffect(() => {
    navMinPointers.value = lasso ? 2 : 1;
    drawEnabled.value = lasso;
  }, [lasso, navMinPointers, drawEnabled]);

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
    minPointers: navMinPointers,
    onUpdate: (e) => {
      'worklet';
      tx.value += e.changeX;
      ty.value += e.changeY;
    },
  });

  // obrys palcem – punkty we współrzędnych zdjęcia
  const stroke = useSharedValue<number[]>([]);
  const onStrokeRef = useRef(onStroke);
  onStrokeRef.current = onStroke;
  const draw = usePanGesture({
    enabled: drawEnabled,
    maxPointers: 1,
    minDistance: 4,
    runOnJS: true,
    onActivate: (e) => {
      stroke.value = [(e.x - tx.value) / s.value, (e.y - ty.value) / s.value];
    },
    onUpdate: (e) => {
      const p = stroke.value;
      const x = (e.x - tx.value) / s.value,
        y = (e.y - ty.value) / s.value;
      const lx = p[p.length - 2],
        ly = p[p.length - 1];
      // nowy punkt co ok. 2 pt na ekranie
      if (Math.hypot(x - lx, y - ly) * s.value >= 2) stroke.value = [...p, x, y];
    },
    onDeactivate: (e) => {
      const p = stroke.value;
      stroke.value = [];
      if (e.canceled || p.length < 6) return;
      const pts: Point[] = [];
      for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
      onStrokeRef.current(pts);
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

  const gesture = useSimultaneousGestures(pinch, pan, draw, tap);

  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: s.value },
  ]);
  // grubość linii i poświata stałe na ekranie, niezależnie od przybliżenia
  const lineW = useDerivedValue(() => 2.4 / s.value);
  const activeW = useDerivedValue(() => (2.4 * 3.2) / s.value);
  const glow = useDerivedValue(() => 7 / s.value);
  const strokeW = useDerivedValue(() => 2.5 / s.value);

  const strokePath = useDerivedValue(() => {
    const p = stroke.value;
    const b = Skia.PathBuilder.Make();
    if (p.length >= 4) {
      b.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) b.lineTo(p[i], p[i + 1]);
    }
    return b.detach();
  });
  // przerywana linia domykająca obrys (od ostatniego punktu do pierwszego)
  const closePath = useDerivedValue(() => {
    const p = stroke.value;
    const b = Skia.PathBuilder.Make();
    if (p.length >= 6) {
      b.moveTo(p[p.length - 2], p[p.length - 1]);
      b.lineTo(p[0], p[1]);
    }
    return b.detach();
  });

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
            <Path path={strokePath} style="stroke" strokeWidth={strokeW} strokeJoin="round" strokeCap="round" color={strokeColor} />
            <Path path={closePath} style="stroke" strokeWidth={strokeW} color="rgba(255,255,255,0.7)" />
          </Group>
          {holds
            .filter((h) => h.type === 'start' || h.type === 'top')
            .map((h) => (
              <HoldLabel key={h.id} hold={h} s={s} tx={tx} ty={ty} font={labelFont} />
            ))}
        </Canvas>
      </View>
    </GestureDetector>
  );
});

/** Napis START/TOP nad chwytem – stałej wielkości na ekranie, podąża za przybliżeniem. */
function HoldLabel({
  hold,
  s,
  tx,
  ty,
  font,
}: {
  hold: Hold;
  s: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  font: SkFont;
}) {
  const text = hold.type === 'start' ? 'START' : 'TOP';
  const tw = font.measureText(text).width + 10;
  const cx = hold.box.x + hold.box.w / 2,
    top = hold.box.y;
  const x = useDerivedValue(() => tx.value + cx * s.value - tw / 2);
  const y = useDerivedValue(() => Math.max(2, ty.value + top * s.value - 20));
  const textX = useDerivedValue(() => x.value + 5);
  const textY = useDerivedValue(() => y.value + 12);
  return (
    <Group>
      <RoundedRect x={x} y={y} width={tw} height={16} r={4} color={colors.hold[hold.type]} />
      <Text x={textX} y={textY} text={text} font={font} color="#0d0d0d" />
    </Group>
  );
}

export default WallView;

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: colors.stage },
});
