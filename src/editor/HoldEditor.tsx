import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useImage } from '@shopify/react-native-skia';
import { holdAt, inShape, type LabImage } from '../holds/segmentation';
import { t } from '../i18n/pl';
import { colors } from '../theme';
import { HOLD_TYPES, outlinePath, type Hold, type HoldType } from './holds';
import type { WallImage } from './prepareWallImage';
import { labFromSkImage } from './wallPixels';
import WallView, { type WallViewHandle } from './WallView';

const MAX_UNDO = 80;

type Props = {
  wall: WallImage;
  /** „Galeria” – wybór innego zdjęcia (ekran nadrzędny pyta o potwierdzenie) */
  onChangePhoto: (hasHolds: boolean) => void;
  changingPhoto: boolean;
};

export default function HoldEditor({ wall, onChangePhoto, changingPhoto }: Props) {
  const insets = useSafeAreaInsets();
  const image = useImage(wall.uri);
  const [lab, setLab] = useState<LabImage | null>(null);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [undo, setUndo] = useState<Hold[][]>([]);
  const [mode, setMode] = useState<HoldType>('hand');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(t.editor.hint);
  const nextId = useRef(1);
  const wallRef = useRef<WallViewHandle>(null);

  // nowe zdjęcie → wyczyść i policz Lab (raz na zdjęcie)
  useEffect(() => {
    setLab(null);
    setHolds([]);
    setUndo([]);
    setActiveId(null);
    if (!image) return;
    // setTimeout: najpierw niech się pokaże „Analizuję zdjęcie…”
    const id = setTimeout(() => {
      const t0 = performance.now();
      setLab(labFromSkImage(image));
      console.log(`[chwyty] Lab ${image.width()}×${image.height()}: ${Math.round(performance.now() - t0)} ms`);
    }, 50);
    return () => clearTimeout(id);
  }, [image]);

  // komunikat znika sam
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast === t.editor.hint ? 9000 : 2400);
    return () => clearTimeout(id);
  }, [toast]);

  const commit = (next: Hold[]) => {
    setUndo((u) => [...u.slice(-(MAX_UNDO - 1)), holds]);
    setHolds(next);
  };

  // logika z prototypu: tapnięcie w inny chwyt – wybierz go; w wybrany – ten sam typ usuwa, inny zmienia typ;
  // poza chwytami – nowy chwyt
  const onTap = (ix: number, iy: number, scale: number) => {
    if (!lab || ix < 0 || iy < 0 || ix >= lab.w || iy >= lab.h) return;
    if (toast === t.editor.hint) setToast(null);
    const hit = [...holds].reverse().find((h) => inShape(h.shape, ix, iy));
    if (hit && hit.id !== activeId) {
      setActiveId(hit.id);
      return;
    }
    if (hit) {
      if (hit.type === mode) {
        commit(holds.filter((h) => h !== hit));
        setActiveId(null);
      } else {
        commit(holds.map((h) => (h === hit ? { ...h, type: mode } : h)));
      }
      return;
    }
    const t0 = performance.now();
    const shape = holdAt(lab, ix, iy, { scale });
    const area = shape.mask.reduce((a, v) => a + v, 0);
    // współrzędne w zdjęciu roboczym (lab.w × lab.h) – pozwalają odtworzyć tapnięcie w testach
    console.log(
      `[chwyty] tapnięcie (${Math.round(ix)}, ${Math.round(iy)}) w ${lab.w}×${lab.h}: ` +
        `${Math.round(performance.now() - t0)} ms, próg ${shape.t == null ? '–' : shape.t.toFixed(2)}, pole ${area} px, ` +
        `przybliżenie ${scale.toFixed(2)}`,
    );
    const h: Hold = { id: nextId.current++, type: mode, shape, path: outlinePath(shape.outline) };
    commit([...holds, h]);
    setActiveId(h.id);
    if (shape.ta == null) setToast(t.editor.noEdge);
    else if (shape.skippedSmall) setToast(t.editor.zoomForSmall);
  };

  const doUndo = () => {
    if (!undo.length) return;
    const prev = undo[undo.length - 1];
    setUndo(undo.slice(0, -1));
    setHolds(prev);
    if (!prev.some((h) => h.id === activeId)) setActiveId(null);
  };

  const doClear = () => {
    if (!holds.length) return;
    commit([]);
    setActiveId(null);
  };

  const count = (k: HoldType) => holds.filter((h) => h.type === k).length;

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {image && (
          <WallView
            ref={wallRef}
            image={image}
            width={wall.width}
            height={wall.height}
            holds={holds}
            activeId={activeId}
            onTap={onTap}
          />
        )}
        {toast && (
          <View style={[styles.toast, { top: insets.top + 12 }]} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
        {(!image || !lab) && (
          <View style={styles.busy} pointerEvents="none">
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.busyText}>{t.editor.analyzing}</Text>
          </View>
        )}
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          onPress={() => wallRef.current?.fit()}
          accessibilityRole="button"
          accessibilityLabel={t.photo.fitView}
        >
          <Text style={styles.fabText}>{t.editor.fit}</Text>
        </Pressable>
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.modes}>
          {HOLD_TYPES.map((k) => {
            const on = k === mode;
            const c = colors.hold[k];
            return (
              <Pressable
                key={k}
                onPress={() => setMode(k)}
                style={[styles.mode, on && { borderColor: c, backgroundColor: c + '33' }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <View style={[styles.dot, { backgroundColor: c, shadowColor: c }]} />
                <Text style={styles.modeText}>{t.editor.holdTypes[k]}</Text>
                <Text style={styles.modeCount}>{count(k)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.acts}>
          <Action label={t.editor.gallery} onPress={() => onChangePhoto(holds.length > 0)} busy={changingPhoto} />
          <Action label={t.editor.undo} onPress={doUndo} disabled={!undo.length} />
          <Action label={t.editor.clear} onPress={doClear} disabled={!holds.length} />
        </View>
      </View>
    </View>
  );
}

function Action({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.act, (disabled || busy) && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.actText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1, backgroundColor: colors.stage, overflow: 'hidden' },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toastText: { color: colors.ink, fontSize: 14, textAlign: 'center' },
  busy: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  busyText: { color: colors.ink, fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
  },
  fabText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  panel: {
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  modes: { flexDirection: 'row', gap: 6 },
  mode: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 2,
  },
  dot: { width: 11, height: 11, borderRadius: 6, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  modeText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  modeCount: { color: colors.mute, fontSize: 12 },
  acts: { flexDirection: 'row', gap: 6 },
  act: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: colors.btn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
