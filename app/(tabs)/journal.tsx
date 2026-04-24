// Journal tab — a dedicated journaling space, not a session history list.
// Matches the web version: lock-header, serif "Journal" heading, two prompt
// cards (FREE FLOW + DEEP DIVE), and a recent-entries list below.
//
// Entries live in AsyncStorage only — never leave the device. Tapping a card
// opens the in-file WriteModal (Free Flow is blank; Deep Dive shows a random
// prompt at the top).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, FlatList, TextInput, Modal,
  StyleSheet, KeyboardAvoidingView, Platform, Animated, Easing,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { colors, radii, spacing } from '../../constants/theme';
import { journal, JournalEntry, JournalKind } from '../../services/journal';
import { getUserId } from '../../services/user';
import { api } from '../../services/api';

export default function JournalScreen() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [writing, setWriting] = useState<{ kind: JournalKind; prompt?: string } | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const userId = await getUserId();
    const localEntries = await journal.list();
    console.log(
      '[journal] loaded local entries=', localEntries.length,
      'userId=', userId.slice(0, 8),
    );
    setEntries(localEntries);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.content.toLowerCase().includes(q));
  }, [entries, query]);

  function openCard(kind: JournalKind) {
    Haptics.selectionAsync().catch(() => {});
    setWriting({
      kind,
      prompt: kind === 'deepdive' ? journal.randomDeepDivePrompt() : undefined,
    });
  }

  async function handleSave(content: string) {
    if (!writing) return;
    if (content.trim()) {
      await journal.add(writing.kind, content, writing.prompt);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    setWriting(null);
    await load();
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
      >
        {/* === Private header === */}
        <View style={styles.privateRow}>
          <Ionicons name="lock-closed" size={11} color={colors.creamFaint} />
          <Text style={styles.privateText}>Private — only you can see this</Text>
        </View>
        <Text style={styles.heading}>Journal</Text>
        <Text style={styles.subheading}>A quiet space just for you.</Text>

        {/* === FREE FLOW card === */}
        <Pressable style={styles.card} onPress={() => openCard('freeflow')}>
          <Text style={styles.cardLabel}>FREE FLOW</Text>
          <Text style={styles.cardTitle}>Just write. No rules. This is yours.</Text>
          <Text style={styles.cardBody}>
            A blank space. Type or speak. No AI, no questions. Whatever is present.
          </Text>
        </Pressable>

        {/* === DEEP DIVE card === */}
        <Pressable style={styles.card} onPress={() => openCard('deepdive')}>
          <Text style={styles.cardLabel}>DEEP DIVE · FREE ASSOCIATION</Text>
          <Text style={styles.cardTitle}>Let the slide open.</Text>
          <Text style={styles.cardBody}>
            Something a little different. A guided invitation into free association —
            unfiltered, uncensored, whatever comes up.
          </Text>
        </Pressable>

        {/* === RECENT ENTRIES === */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>RECENT ENTRIES</Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={14} color={colors.creamFaint} style={{ marginRight: 8 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your entries…"
            placeholderTextColor={colors.creamFaint}
            style={styles.searchInput}
          />
        </View>

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {query ? 'No entries match that search.' : 'No entries yet. Your words will live here.'}
            </Text>
          </View>
        ) : (
          filtered.map((e) => <EntryRow key={e.id} entry={e} />)
        )}
      </ScrollView>

      {writing ? (
        <WriteModal
          kind={writing.kind}
          prompt={writing.prompt}
          onClose={() => setWriting(null)}
          onSave={handleSave}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ============================================================================
// Entry row — compact preview of a saved journal entry
// ============================================================================
function EntryRow({ entry }: { entry: JournalEntry }) {
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const preview = entry.content.slice(0, 120) + (entry.content.length > 120 ? '…' : '');
  return (
    <View style={styles.entry}>
      <View style={styles.entryTop}>
        <Text style={styles.entryDate}>{dateStr}</Text>
        <Text style={styles.entryKind}>
          {entry.kind === 'deepdive' ? 'DEEP DIVE' : 'FREE FLOW'}
        </Text>
      </View>
      {entry.prompt ? <Text style={styles.entryPrompt}>{entry.prompt}</Text> : null}
      <Text style={styles.entryText}>{preview}</Text>
    </View>
  );
}

// ============================================================================
// Write modal — full-screen writing space
// ============================================================================
function WriteModal({
  kind, prompt, onClose, onSave,
}: {
  kind: JournalKind;
  prompt?: string;
  onClose: () => void;
  onSave: (content: string) => void;
}) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const insets = useSafeAreaInsets();

  // Pulse animation for the mic button while recording.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!recording) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  async function startRecord() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone off', 'Grant mic access in Settings to dictate.');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (e) {
      console.warn('[journal-mic] start failed:', (e as Error).message);
      setRecording(false);
    }
  }

  async function stopRecordAndAppend() {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      setRecording(false);
      if (!uri) return;
      setTranscribing(true);
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      const transcript = await api.transcribe(uri, mime);
      setTranscribing(false);
      const t = (transcript || '').trim();
      if (!t) return;
      Haptics.selectionAsync().catch(() => {});
      // Append to whatever the user has already typed. A space separator keeps
      // paragraph flow natural when dictating multiple passes.
      setText((prev) => (prev.trim() ? prev.replace(/\s+$/, '') + ' ' + t : t));
    } catch (e) {
      console.warn('[journal-mic] stop/transcribe failed:', (e as Error).message);
      setRecording(false);
      setTranscribing(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header — paddingTop explicitly includes safe-area top inset so the
              X and Save buttons clear the iPhone notch/Dynamic Island on every
              device. Both tap targets are 44x44 for reliable touch. */}
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable
              onPress={onClose}
              style={styles.headerBtn}
              hitSlop={10}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={colors.creamDim} />
            </Pressable>
            <Text style={styles.modalTitle}>
              {kind === 'deepdive' ? 'Deep Dive' : 'Free Flow'}
            </Text>
            <Pressable
              onPress={() => onSave(text)}
              style={styles.headerBtn}
              hitSlop={10}
              accessibilityLabel="Save entry"
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>

          {prompt ? (
            <View style={styles.promptBox}>
              <Text style={styles.promptText}>{prompt}</Text>
            </View>
          ) : null}

          <TextInput
            value={text}
            onChangeText={setText}
            editable={!transcribing}
            multiline
            placeholder={kind === 'deepdive'
              ? "Just let it come — unfiltered, uncensored…"
              : "Type or tap the mic to speak. Whatever is present."}
            placeholderTextColor={colors.creamFaint}
            style={styles.textarea}
            selectionColor={colors.amber}
            autoFocus
            textAlignVertical="top"
          />

          {/* Dictation mic — appends the transcript to the text area. Same
              pipeline as Chat's ChatInput: /api/transcribe → text. No TTS,
              no auto-send. User reviews/edits then taps Save. */}
          {recording ? (
            <View style={styles.recordingRow}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingLabel}>Recording… tap mic to finish</Text>
            </View>
          ) : null}
          <View style={styles.micRow}>
            <Pressable
              onPress={recording ? stopRecordAndAppend : startRecord}
              disabled={transcribing}
              accessibilityLabel={recording ? 'Stop dictation' : 'Start voice dictation'}
            >
              <Animated.View
                style={[
                  styles.micBtn,
                  recording && styles.micRecording,
                  recording ? { transform: [{ scale: pulse }] } : null,
                ]}
              >
                {transcribing ? (
                  <ActivityIndicator size="small" color={colors.amber} />
                ) : (
                  <Ionicons
                    name={recording ? 'stop' : 'mic'}
                    size={20}
                    color={recording ? '#fff' : colors.amber}
                  />
                )}
              </Animated.View>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scrollBody: { padding: spacing.lg, paddingBottom: spacing.xxl },

  privateRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: spacing.sm, marginBottom: spacing.md,
  },
  privateText: { color: colors.creamFaint, fontSize: 11, letterSpacing: 0.5 },

  heading: {
    color: colors.cream,
    // Serif fallback — a proper google-font load lands in a follow-up; system
    // serif already gives the heading the warmer feel the web has.
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 40,
    fontWeight: '400',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  subheading: {
    color: colors.creamDim, fontSize: 14, fontStyle: 'italic',
    textAlign: 'center', marginTop: 4, marginBottom: spacing.xl,
  },

  card: {
    backgroundColor: '#1a1612',
    borderRadius: radii.md,
    borderColor: 'rgba(230,180,122,0.15)',
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardLabel: {
    color: colors.amber, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.6, marginBottom: spacing.sm,
  },
  cardTitle: {
    color: colors.cream,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 22, fontWeight: '500', marginBottom: 8, lineHeight: 28,
  },
  cardBody: { color: colors.creamDim, fontSize: 14, lineHeight: 21 },

  sectionLabel: {
    color: colors.amber, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.8, marginBottom: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.backgroundCard, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, color: colors.cream, fontSize: 13 },

  empty: {
    padding: spacing.lg, alignItems: 'center',
    borderStyle: 'dashed', borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, marginTop: spacing.xs,
  },
  emptyText: { color: colors.creamFaint, fontSize: 13, fontStyle: 'italic', textAlign: 'center' },

  entry: {
    backgroundColor: colors.backgroundCard, borderRadius: radii.md,
    borderColor: colors.border, borderWidth: 1,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  entryTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  entryDate: { color: colors.amber, fontSize: 12, fontWeight: '600' },
  entryKind: { color: colors.creamFaint, fontSize: 9, letterSpacing: 1.2 },
  entryPrompt: { color: colors.creamDim, fontStyle: 'italic', fontSize: 13, marginBottom: 6 },
  entryText: { color: colors.cream, fontSize: 14, lineHeight: 21 },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    // paddingTop applied inline (insets.top + 12) so the header clears the
    // iPhone notch/Dynamic Island regardless of device.
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  modalTitle: { color: colors.amber, fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  saveText: { color: colors.amber, fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  headerBtn: {
    // 44x44 minimum touch target so Close/Save are reliably tappable even when
    // the iOS status bar compresses the header on small devices.
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
  },

  // Dictation mic — bottom-right of the modal, floats above the keyboard
  // avoider so it stays tappable while the user is typing too.
  micRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  micBtn: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 1, borderColor: colors.amberDim,
    backgroundColor: 'rgba(20,19,26,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  micRecording: {
    backgroundColor: '#d4726a',
    borderColor: '#d4726a',
    shadowColor: '#d4726a', shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  recordingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingTop: 4, paddingBottom: 2,
  },
  recordingDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#d4726a',
    shadowColor: '#d4726a', shadowOpacity: 0.7, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
  },
  recordingLabel: {
    color: '#d4726a', fontSize: 11, fontWeight: '600',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },

  promptBox: {
    margin: spacing.md, padding: spacing.md,
    backgroundColor: colors.backgroundCard, borderRadius: radii.md,
    borderLeftWidth: 2, borderLeftColor: colors.amber,
  },
  promptText: {
    color: colors.cream,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: 18, fontStyle: 'italic', lineHeight: 26,
  },

  textarea: {
    flex: 1,
    padding: spacing.md,
    color: colors.cream, fontSize: 17, lineHeight: 26,
  },
});
