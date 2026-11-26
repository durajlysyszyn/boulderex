import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useImage } from '@shopify/react-native-skia';
import { holdAt, manualHold, type LabImage, type Point } from '../holds/segmentation';
import { t } from '../i18n/pl';
import { colors } from '../theme';
import {
  HOLD_TYPES,
  inHold,
  lastAutoPart,
  makeHold,
  withPart,
  withNote,
  withPartThreshold,
  withType,
  type Hold,
  type HoldPart,
  type HoldType,
} from './holds';
import type { WallImage } from './prepareWallImage';
import NoteSheet from './NoteSheet';
import { labFromSkImage } from './wallPixels';
import WallView, { type WallViewHandle } from './WallView';

const MAX_UNDO = 80;
/** Zakres suwaka konturu – jak w prototypie. */
const T_MIN = 1;
const T_MAX = 55;

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
  const [lasso, setLasso] = useState(false);
  /** „Dołącz”: następne tapnięcie / obrys dołącza część do zaznaczonego chwytu */
  const [joining, setJoining] = useState(false);
  const [toast, setToast] = useState<string | null>(t.editor.hint);
  /** zmiana wartości suwaka „z zewnątrz” (Auto, Cofnij) – odśwież suwak */
  const [sliderRev, setSliderRev] = useState(0);
  const nextId = useRef(1);
  const wallRef = useRef<WallViewHandle>(null);

  // nowe zdjęcie → wyczyść i policz Lab (raz na zdjęcie)
  useEffect(() => {
    setLab(null);
    setHolds([]);
    setUndo([]);
    setActiveId(null);
    setJoining(false);
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
    const id = setTimeout(() => setToast(null), toast === t.editor.hint ? 9000 : 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const active = holds.find((h) => h.id === activeId) ?? null;

  const pushUndo = () => setUndo((u) => [...u.slice(-(MAX_UNDO - 1)), holds]);
  const commit = (next: Hold[]) => {
    pushUndo();
    setHolds(next);
  };

  const select = (id: number | null) => {
    setActiveId(id);
    setJoining(false);
  };

  /** Nowa część: dołącz do zaznaczonego chwytu albo utwórz nowy chwyt. */
  const addPart = (part: HoldPart) => {
    if (joining && active) {
      commit(holds.map((h) => (h === active ? withPart(h, part) : h)));
      setJoining(false);
      return;
    }
    const h = makeHold(nextId.current++, mode, [part]);
    commit([...holds, h]);
    select(h.id);
  };

  // logika z prototypu: tapnięcie w inny chwyt – wybierz go; w wybrany – ten sam typ usuwa, inny zmienia typ;
  // poza chwytami – nowy chwyt (albo nowa część, gdy włączone „Dołącz”)
  const onTap = (ix: number, iy: number, scale: number) => {
    if (!lab || ix < 0 || iy < 0 || ix >= lab.w || iy >= lab.h) return;
    if (toast === t.editor.hint) setToast(null);
    const hit = [...holds].reverse().find((h) => inHold(h, ix, iy));
    if (joining && hit) {
      // „Dołącz” czeka na kawałek poza chwytami – tapnięcie w chwyt kończy dołączanie
      setJoining(false);
      if (hit.id !== activeId) select(hit.id);
      return;
    }
    if (hit && hit.id !== activeId) {
      select(hit.id);
      return;
    }
    if (hit) {
      if (hit.type === mode) {
        commit(holds.filter((h) => h !== hit));
        select(null);
      } else {
        commit(holds.map((h) => (h === hit ? withType(h, mode) : h)));
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
    addPart(shape);
    if (shape.ta == null) setToast(t.editor.noEdge);
    else if (shape.skippedSmall) setToast(t.editor.zoomForSmall);
  };

  const onStroke = (pts: Point[]) => {
    const m = manualHold(pts);
    if (!m) {
      setToast(t.editor.strokeTooSmall);
      return;
    }
    addPart(m);
  };

  // suwak konturu – przeliczenie najwyżej raz na klatkę
  const pendingT = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const onSlide = (v: number) => {
    pendingT.current = v;
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const tv = pendingT.current;
      if (tv == null || !lab) return;
      setHolds((hs) => hs.map((h) => (h.id === activeId ? withPartThreshold(lab, h, tv) : h)));
    });
  };
  const resetAuto = () => {
    const p = active && lastAutoPart(active);
    if (!lab || !active || !p || p.ta == null || p.t === p.ta) return;
    commit(holds.map((h) => (h === active ? withPartThreshold(lab, h, p.ta!) : h)));
    setSliderRev((r) => r + 1);
  };

  const [noteOpen, setNoteOpen] = useState(false);
  const saveNote = (note: string) => {
    setNoteOpen(false);
    if (!active || (active.note ?? '') === note.trim()) return;
    commit(holds.map((h) => (h === active ? withNote(h, note) : h)));
  };

  const removeActive = () => {
    if (!active) return;
    commit(holds.filter((h) => h !== active));
    select(null);
  };

  const doUndo = () => {
    if (!undo.length) return;
    const prev = undo[undo.length - 1];
    setUndo(undo.slice(0, -1));
    setHolds(prev);
    setSliderRev((r) => r + 1);
    if (!prev.some((h) => h.id === activeId)) select(null);
  };

  const doClear = () => {
    if (!holds.length) return;
    commit([]);
    select(null);
  };

  const toggleLasso = () => {
    const on = !lasso;
    setLasso(on);
    if (on) setToast(t.editor.lassoHint);
  };

  const toggleJoin = () => {
    const on = !joining;
    setJoining(on);
    if (on) setToast(lasso ? t.editor.joinHintLasso : t.editor.joinHint);
  };

  const count = (k: HoldType) => holds.filter((h) => h.type === k).length;
  const autoPart = active ? lastAutoPart(active) : null;
  const tVal = autoPart ? (autoPart.t ?? autoPart.ta ?? 12) : 12;

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
            lasso={lasso}
            strokeColor={colors.hold[mode]}
            onStroke={onStroke}
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
        <View style={styles.floating} pointerEvents="box-none">
          <Pressable
            style={({ pressed }) => [styles.fab, lasso && styles.fabOn, pressed && styles.pressed]}
            onPress={toggleLasso}
            accessibilityRole="button"
            accessibilityState={{ selected: lasso }}
          >
            <Text style={[styles.fabText, lasso && styles.fabTextOn]}>{t.editor.lasso}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
            onPress={() => wallRef.current?.fit()}
            accessibilityRole="button"
            accessibilityLabel={t.photo.fitView}
          >
            <Text style={styles.fabText}>{t.editor.fit}</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + 10 }]}>
        {/* zaznaczony chwyt: kontur; dołącz, komentarz, usuń; treść komentarza */}
        <View style={styles.holdBar}>
          {active ? (
            <>
              <Text style={styles.holdLabel}>{autoPart ? t.editor.contour : t.editor.manualContour}</Text>
              <Slider
                key={`${active.id}-${active.parts.length}-${sliderRev}`}
                style={styles.slider}
                minimumValue={T_MIN}
                maximumValue={T_MAX}
                step={0.5}
                value={tVal}
                disabled={!autoPart}
                onSlidingStart={pushUndo}
                onValueChange={onSlide}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.line}
                thumbTintColor={autoPart ? colors.ink : colors.mute}
              />
              <SmallButton label={t.editor.auto} onPress={resetAuto} disabled={!autoPart || autoPart.t === autoPart.ta} />
            </>
          ) : (
            <Text style={styles.holdHint}>{lasso ? t.editor.barHintLasso : t.editor.barHint}</Text>
          )}
        </View>
        {active && (
          <View style={styles.holdActs}>
            <SmallButton label={t.editor.join} onPress={toggleJoin} on={joining} grow />
            <SmallButton label={t.editor.note} onPress={() => setNoteOpen(true)} on={!!active.note} grow />
            <SmallButton label={t.editor.remove} onPress={removeActive} grow />
          </View>
        )}
        {active?.note ? (
          <Pressable onPress={() => setNoteOpen(true)} accessibilityRole="button" accessibilityHint={t.editor.noteEdit}>
            <Text style={styles.noteText} numberOfLines={2}>
              „{active.note}”
            </Text>
          </Pressable>
        ) : null}
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
      <NoteSheet visible={noteOpen && !!active} note={active?.note ?? ''} onSave={saveNote} onClose={() => setNoteOpen(false)} />
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

function SmallButton({
  label,
  onPress,
  disabled,
  on,
  grow,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  on?: boolean;
  grow?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.small, grow && styles.grow, on && styles.smallOn, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
    >
      <Text style={[styles.smallText, on && styles.smallTextOn]}>{label}</Text>
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  busyText: { color: colors.ink, fontSize: 16 },
  floating: { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 },
  fab: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
  },
  fabOn: { backgroundColor: colors.accent },
  fabText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  fabTextOn: { color: colors.onAccent },
  panel: {
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  holdBar: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  holdLabel: { color: colors.mute, fontSize: 13 },
  holdHint: { color: colors.mute, fontSize: 13, flex: 1, textAlign: 'center' },
  slider: { flex: 1, height: 40 },
  small: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.btn,
    justifyContent: 'center',
  },
  smallOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  grow: { flex: 1, alignItems: 'center' },
  holdActs: { flexDirection: 'row', gap: 6 },
  noteText: { color: colors.ink, fontSize: 14, fontStyle: 'italic', paddingHorizontal: 4 },
  smallText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  smallTextOn: { color: colors.onAccent },
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
