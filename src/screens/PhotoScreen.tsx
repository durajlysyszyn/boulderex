import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { t } from '../i18n/pl';
import { colors } from '../theme';
import WallView, { WallViewHandle } from '../editor/WallView';
import { prepareWallImage, WallImage } from '../editor/prepareWallImage';

export default function PhotoScreen() {
  const insets = useSafeAreaInsets();
  const [wall, setWall] = useState<WallImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallRef = useRef<WallViewHandle>(null);

  async function pickFromGallery() {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (result.canceled) return;
      setBusy(true);
      setWall(await prepareWallImage(result.assets[0].uri));
    } catch {
      setError(t.photo.pickError);
    } finally {
      setBusy(false);
    }
  }

  if (!wall) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.title}>{t.photo.title}</Text>
        <Text style={styles.subtitle}>{t.photo.subtitle}</Text>
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.busyText}>{t.photo.preparing}</Text>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={pickFromGallery}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t.photo.pickFromGallery}</Text>
          </Pressable>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.full}>
      <WallView ref={wallRef} wall={wall} />
      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={pickFromGallery}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.secondaryText}>{t.photo.changePhoto}</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={() => wallRef.current?.fit()}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{t.photo.fitView}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: { color: colors.ink, fontSize: 32, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: colors.mute, fontSize: 16, textAlign: 'center', marginBottom: 28 },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  primaryText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
  busy: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  busyText: { color: colors.mute, fontSize: 16 },
  error: { color: colors.danger, marginTop: 16, textAlign: 'center' },
  full: { flex: 1, backgroundColor: colors.stage },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  secondary: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
