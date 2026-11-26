import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { t } from '../i18n/pl';
import { colors } from '../theme';

type Photo = { uri: string; width: number; height: number };

export default function PhotoScreen() {
  const insets = useSafeAreaInsets();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFromGallery() {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (result.canceled) return;
      const { uri, width, height } = result.assets[0];
      setPhoto({ uri, width, height });
    } catch {
      setError(t.photo.pickError);
    }
  }

  if (!photo) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.title}>{t.photo.title}</Text>
        <Text style={styles.subtitle}>{t.photo.subtitle}</Text>
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={pickFromGallery}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{t.photo.pickFromGallery}</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.full}>
      {/* contain: całe zdjęcie widoczne, bez przycinania – potrzebne do zaznaczania chwytów */}
      <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={pickFromGallery}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{t.photo.changePhoto}</Text>
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
  error: { color: colors.danger, marginTop: 16, textAlign: 'center' },
  full: { flex: 1, backgroundColor: colors.stage },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  secondary: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  secondaryText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
