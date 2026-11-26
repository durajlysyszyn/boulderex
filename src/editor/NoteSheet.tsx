import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n/pl';
import { colors } from '../theme';
import { NOTE_MAX } from './holds';

type Props = {
  visible: boolean;
  /** obecny komentarz (pusty = nowy) */
  note: string;
  onSave: (note: string) => void;
  onClose: () => void;
};

/** Okno komentarza do chwytu (wysuwane od dołu, nad klawiaturą). */
export default function NoteSheet({ visible, note, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(note);
  useEffect(() => {
    if (visible) setText(note);
  }, [visible, note]);

  const left = NOTE_MAX - text.length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t.photo.cancel} />
        <View style={[styles.card, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>{t.editor.noteTitle}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t.editor.notePlaceholder}
            placeholderTextColor={colors.mute}
            multiline
            maxLength={NOTE_MAX}
            autoFocus
            textAlignVertical="top"
          />
          <Text style={[styles.counter, left < 20 && styles.counterLow]}>{left}</Text>
          <View style={styles.row}>
            {note ? (
              <Pressable
                style={({ pressed }) => [styles.b, styles.warn, pressed && styles.pressed]}
                onPress={() => onSave('')}
                accessibilityRole="button"
              >
                <Text style={styles.warnText}>{t.editor.noteDelete}</Text>
              </Pressable>
            ) : null}
            <View style={styles.spacer} />
            <Pressable style={({ pressed }) => [styles.b, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
              <Text style={styles.bText}>{t.photo.cancel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.b, styles.pri, pressed && styles.pressed]}
              onPress={() => onSave(text)}
              accessibilityRole="button"
            >
              <Text style={styles.priText}>{t.editor.noteSave}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  card: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    paddingTop: 18,
    paddingHorizontal: 18,
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: '700', marginBottom: 12 },
  input: {
    minHeight: 96,
    maxHeight: 180,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0f1012',
    color: colors.ink,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  counter: { color: colors.mute, fontSize: 12, textAlign: 'right', marginTop: 4, marginBottom: 12 },
  counterLow: { color: colors.accent },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  spacer: { flex: 1 },
  b: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.btn,
    justifyContent: 'center',
  },
  bText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  pri: { backgroundColor: colors.accent, borderColor: colors.accent },
  priText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  warn: {},
  warnText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
