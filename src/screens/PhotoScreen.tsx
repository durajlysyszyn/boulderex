import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { t } from '../i18n/pl';
import { colors } from '../theme';
import HoldEditor from '../editor/HoldEditor';
import { prepareWallImage, type WallImage } from '../editor/prepareWallImage';

export default function PhotoScreen() {
  const insets = useSafeAreaInsets();
  const [wall, setWall] = useState<WallImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (wall) Alert.alert(t.photo.pickError);
      else setError(t.photo.pickError);
    } finally {
      setBusy(false);
    }
  }

  function changePhoto(hasHolds: boolean) {
    if (!hasHolds) return void pickFromGallery();
    Alert.alert(t.photo.replaceTitle, t.photo.replaceText, [
      { text: t.photo.cancel, style: 'cancel' },
      { text: t.photo.replace, style: 'destructive', onPress: () => void pickFromGallery() },
    ]);
  }

  if (wall) return <HoldEditor wall={wall} onChangePhoto={changePhoto} changingPhoto={busy} />;

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
  pressed: { opacity: 0.7 },
});
