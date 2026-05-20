// Map Voice bar — bottom of the Map tab (polish round 7).
//
// Replaces the press-and-hold MapVoiceButton + MapVoicePanel (entry
// modal + 10-min cap timer) with two mics side-by-side:
//
//   SELF (left, ●)        SELF-LIKE (right, ◆)  ← disabled in Phase 1
//
// Self mic flow:
//   tap-and-hold → records audio → release → POST audio to
//   /api/map-voice/turn → server returns transcript + Self reply
//   text + detected part + base64 MP3. Client plays the MP3 and
//   fires onDetectedPart so the map lights the blended part.
//
// First-time explainer modal plays the very first time the user
// taps Self; flag stored server-side via /api/map-voice/explainer-
// seen so it never plays again. The Self-like mic shows a "need
// belief established" tooltip on tap; it's otherwise inert until
// Phase 2.
//
// Each mic has a small (i) icon next to it that opens a brief
// description popup ("Self — pure presence …" / "Self-like part —
// active leadership …").
//
// No cap UI, no timer, no balance indicator — those went away
// with the Realtime pipeline. The server still rate-limits at
// 200 turns/24h per user.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Modal, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
// Use the legacy expo-file-system surface (cacheDirectory,
// writeAsStringAsync, EncodingType) — same import path the other
// places in this codebase (app/settings.tsx, app/account/delete.tsx)
// use. The new top-level API removed these symbols.
import * as FileSystem from 'expo-file-system/legacy';
import {
  useAudioRecorder, AudioModule, RecordingPresets,
  setAudioModeAsync, createAudioPlayer,
} from 'expo-audio';

import { colors, fonts, spacing, radii } from '../../constants/theme';
import { api } from '../../services/api';

type VoiceState = 'idle' | 'recording' | 'thinking' | 'speaking';
type ModalKind = null | 'explainer' | 'selfInfo' | 'selfLikeInfo' | 'selfLikeDisabled';

const MIN_HOLD_MS = 300;          // discard accidental taps shorter than this
const SELF_LABEL = 'SELF';
const SELF_LIKE_LABEL = 'SELF-LIKE';

const EXPLAINER_BODY = [
  // Mirrors the spec verbatim. The render path splits this into
  // paragraphs so the prose breathes.
  "Most of the time, when a part is loud — anxious, harsh, fearful — you don't notice. You ARE the anxiety. That's called blending. You're fused with the part. From the inside, it just feels like you.",
  "When you tap a mic and speak, the AI listens for which part is talking through you. That part lights up on the map — you see it externally, separate from you. That's unblending happening in real time. The moment you see \"oh, that's a part — I'm not that,\" a small space opens.",
  "Then a voice responds:",
];
const EXPLAINER_SELF_LINE =
  '🎙 Self — "I see you. I\'m here." Pure presence. When you need to be witnessed and settle — without being managed.';
const EXPLAINER_SELF_LIKE_LINE =
  '🎙 Self-like part — "I hear you, AND we\'re going a different way." Active leadership. When you need to hold a line with a part — make a different choice, redirect.';
const EXPLAINER_FOOTNOTE =
  "(Self-like part becomes available once you've established your belief for a part — different from what the part believes.)";

const SELF_INFO_BODY =
  "Self — pure presence. Speak; the part you're blended with lights up; Self responds to that part. Use when you need to be witnessed and settle.";
const SELF_LIKE_INFO_BODY =
  "Self-like part — active leadership. Speak; the part lights up; Self-like part responds from your established belief. Use when you need help holding a line with a part.";
const SELF_LIKE_DISABLED_BODY =
  "Self-like part — for active leadership when you need to hold a line with a part. Requires your own belief for the part first — different from what the part believes. Tap any part below to start that work.";

type Props = {
  sessionId: string;
  onDetectedPart?: (part: string, label?: string | null) => void;
};

export function MapVoiceBar({ sessionId: _sessionId, onDetectedPart }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  const [modal, setModal] = useState<ModalKind>(null);
  const [explainerSeen, setExplainerSeen] = useState<boolean | undefined>(undefined);
  const [holdSec, setHoldSec] = useState(0);

  // Recording infra — same expo-audio hook the chat tab voice-note
  // path uses. HIGH_QUALITY gives m4a on iOS / mp4 on Android, both
  // of which Cartesia accepts.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const wantRecordingRef = useRef(false);
  const pressStartTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the explainer-seen flag once on mount. Result is cached
  // for this session; the POST/dismiss path updates it locally so
  // subsequent taps in the same session don't re-show the modal.
  useEffect(() => {
    let cancelled = false;
    api.getMapVoiceExplainerStatus()
      .then(({ seen }) => { if (!cancelled) setExplainerSeen(seen); })
      .catch(() => { if (!cancelled) setExplainerSeen(false); });
    return () => { cancelled = true; };
  }, []);

  // Unmount cleanup — make sure no recorder / player is left running.
  useEffect(() => () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { recorder.stop(); } catch {}
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    playerRef.current = null;
  }, [recorder]);

  // -------- Self mic — press-and-hold --------
  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        console.log('[map-voice-bar] mic permission denied');
        return;
      }
      try {
        await setAudioModeAsync({
          allowsRecording: true, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
      } catch {}
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('recording');
      setHoldSec(0);
      pressStartTimeRef.current = Date.now();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      tickRef.current = setInterval(() => {
        setHoldSec(Math.floor((Date.now() - pressStartTimeRef.current) / 1000));
      }, 250);
    } catch (e) {
      console.warn('[map-voice-bar] startRecording failed:', (e as Error)?.message);
      setState('idle');
    }
  }, [state, recorder]);

  const sendAudio = useCallback(async (uri: string, mime: string) => {
    setState('thinking');
    try {
      const result = await api.mapVoiceTurn(uri, mime);
      if (!result) {
        console.warn('[map-voice-bar] turn returned null');
        setState('idle');
        return;
      }
      if ('error' in result) {
        console.warn('[map-voice-bar] turn error:', result.error, result.message);
        setState('idle');
        return;
      }
      // Light up the detected part on the map before audio starts —
      // the visual hits at the same beat the user starts hearing the
      // reply, which is the whole point of the unblending moment.
      try { onDetectedPart?.(result.detected_part, result.part_label); } catch {}

      // Decode the base64 MP3 into a temp file, then play. data: URIs
      // work on iOS but not reliably on Android; the file-based path
      // is cross-platform.
      const tmpUri = `${FileSystem.cacheDirectory ?? ''}map-voice-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(tmpUri, result.audio_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
      const player = createAudioPlayer({ uri: tmpUri });
      playerRef.current = player;
      setState('speaking');
      player.play();
      // Poll for completion — when the audio ends, drop back to idle.
      // expo-audio's status callbacks are inconsistent across versions
      // so a small interval is the most robust signal.
      const playCheck = setInterval(() => {
        try {
          const s = player.currentStatus;
          if (s?.didJustFinish || (s && s.duration > 0 && s.currentTime >= s.duration - 0.05)) {
            clearInterval(playCheck);
            setState('idle');
            try { player.remove(); } catch {}
            playerRef.current = null;
            FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
          }
        } catch {}
      }, 200);
    } catch (e) {
      console.warn('[map-voice-bar] sendAudio threw:', (e as Error)?.message);
      setState('idle');
    }
  }, [onDetectedPart]);

  const stopAndDispatch = useCallback(async () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const heldMs = Date.now() - pressStartTimeRef.current;
    try {
      await recorder.stop();
      try {
        await setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
      } catch {}
    } catch (e) {
      console.warn('[map-voice-bar] recorder.stop threw:', (e as Error)?.message);
    }
    if (heldMs < MIN_HOLD_MS) {
      console.log('[map-voice-bar] hold too short — discarding');
      setState('idle');
      return;
    }
    const uri = recorder.uri;
    if (!uri) {
      console.warn('[map-voice-bar] no recording uri');
      setState('idle');
      return;
    }
    const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/mp4';
    sendAudio(uri, mime);
  }, [recorder, sendAudio]);

  const onSelfPressIn = useCallback(() => {
    if (state !== 'idle') return;
    wantRecordingRef.current = true;
    // First-time check — if the user has not seen the explainer
    // modal yet, show it INSTEAD of starting the recording. The
    // recording starts on the next tap, after dismiss.
    if (explainerSeen === false) {
      setModal('explainer');
      wantRecordingRef.current = false;
      return;
    }
    startRecording();
  }, [state, explainerSeen, startRecording]);

  const onSelfPressOut = useCallback(() => {
    if (!wantRecordingRef.current) return;
    wantRecordingRef.current = false;
    if (state === 'recording') stopAndDispatch();
  }, [state, stopAndDispatch]);

  const dismissExplainer = useCallback(() => {
    setModal(null);
    setExplainerSeen(true);
    api.markMapVoiceExplainerSeen().catch(() => {});
  }, []);

  // -------- Render --------
  const selfMicActive = state === 'recording';
  const thinking = state === 'thinking';
  const speaking = state === 'speaking';

  return (
    <>
      <View style={styles.bar} pointerEvents="box-none">
        <View style={styles.col}>
          <Text style={styles.glyph}>●</Text>
          <Pressable
            onPressIn={onSelfPressIn}
            onPressOut={onSelfPressOut}
            hitSlop={8}
            style={[
              styles.mic,
              selfMicActive && styles.micRecording,
              thinking && styles.micThinking,
              speaking && styles.micSpeaking,
            ]}
            accessibilityLabel="Self — hold to speak"
            accessibilityRole="button"
          >
            {thinking ? (
              <ActivityIndicator color={colors.amber} />
            ) : (
              <Ionicons
                name="mic"
                size={22}
                color={selfMicActive || speaking ? '#fff' : colors.amber}
              />
            )}
          </Pressable>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{SELF_LABEL}</Text>
            <Pressable
              onPress={() => setModal('selfInfo')}
              hitSlop={8}
              style={styles.infoBtn}
              accessibilityLabel="What does Self do"
            >
              <Ionicons name="information-circle-outline" size={14} color={colors.creamDim} />
            </Pressable>
          </View>
          {selfMicActive ? (
            <Text style={styles.hint}>recording… {holdSec}s</Text>
          ) : null}
        </View>

        <View style={[styles.col, styles.colDisabled]}>
          <Text style={[styles.glyph, styles.glyphDim]}>◆</Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setModal('selfLikeDisabled');
            }}
            hitSlop={8}
            style={[styles.mic, styles.micDisabled]}
            accessibilityLabel="Self-like part — not yet available"
            accessibilityRole="button"
          >
            <Ionicons name="mic" size={22} color={colors.creamFaint} />
          </Pressable>
          <View style={styles.labelRow}>
            <Pressable
              onPress={() => setModal('selfLikeInfo')}
              hitSlop={8}
              style={styles.infoBtn}
              accessibilityLabel="What does Self-like part do"
            >
              <Ionicons name="information-circle-outline" size={14} color={colors.creamFaint} />
            </Pressable>
            <Text style={[styles.label, styles.labelDim]}>{SELF_LIKE_LABEL}</Text>
          </View>
        </View>
      </View>

      {/* First-time explainer modal. */}
      <Modal
        visible={modal === 'explainer'}
        transparent
        animationType="fade"
        onRequestClose={dismissExplainer}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={dismissExplainer}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Seeing your parts, hearing Self speak to them</Text>
            {EXPLAINER_BODY.map((p, i) => (
              <Text key={i} style={styles.cardBody}>{p}</Text>
            ))}
            <Text style={[styles.cardBody, styles.cardLine]}>{EXPLAINER_SELF_LINE}</Text>
            <Text style={[styles.cardBody, styles.cardLine]}>{EXPLAINER_SELF_LIKE_LINE}</Text>
            <Text style={[styles.cardBody, styles.cardFootnote]}>{EXPLAINER_FOOTNOTE}</Text>
            <Pressable onPress={dismissExplainer} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Self (i) popup. */}
      <Modal
        visible={modal === 'selfInfo'}
        transparent
        animationType="fade"
        onRequestClose={() => setModal(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Self</Text>
            <Text style={styles.cardBody}>{SELF_INFO_BODY}</Text>
            <Pressable onPress={() => setModal(null)} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Self-like part (i) popup. */}
      <Modal
        visible={modal === 'selfLikeInfo'}
        transparent
        animationType="fade"
        onRequestClose={() => setModal(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Self-like part</Text>
            <Text style={styles.cardBody}>{SELF_LIKE_INFO_BODY}</Text>
            <Pressable onPress={() => setModal(null)} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Self-like disabled — Phase 1 placeholder tooltip. */}
      <Modal
        visible={modal === 'selfLikeDisabled'}
        transparent
        animationType="fade"
        onRequestClose={() => setModal(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Not yet available</Text>
            <Text style={styles.cardBody}>{SELF_LIKE_DISABLED_BODY}</Text>
            <Pressable onPress={() => setModal(null)} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Bottom bar — sits ABOVE the ProgressStrip footer. Two columns of
  // equal width with the mics centered. No background — sits over
  // the map's deep-navy directly.
  bar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 50,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
  },
  col: {
    alignItems: 'center',
    minWidth: 100,
  },
  colDisabled: { opacity: 0.4 },
  glyph: {
    color: colors.amber,
    fontSize: 11,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  glyphDim: { color: colors.creamFaint },
  mic: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(20,19,26,0.9)',
    borderWidth: 2, borderColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.amber, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  micRecording: { backgroundColor: '#d4726a', borderColor: '#d4726a' },
  micThinking:  { backgroundColor: colors.backgroundSecondary },
  micSpeaking:  { backgroundColor: '#8A7AAA', borderColor: '#8A7AAA' },
  micDisabled: {
    borderColor: colors.creamFaint,
    shadowOpacity: 0,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  label: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  labelDim: { color: colors.creamFaint },
  infoBtn: {
    padding: 2,
  },
  hint: {
    marginTop: 4,
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 11,
  },

  // Modals — shared backdrop + card styling. Single GOT IT button on
  // each. Cards use Cormorant for the body to match the chat /
  // welcome aesthetic; titles + button stay sans for UI chrome.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#0e0e1a',
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.25)',
  },
  cardTitle: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    lineHeight: 28,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  cardBody: {
    color: colors.cream,
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  cardLine: { fontStyle: 'italic' },
  cardFootnote: {
    color: colors.creamDim,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  gotItBtn: {
    backgroundColor: colors.amber,
    paddingVertical: 14,
    borderRadius: radii.pill,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  gotItText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.4,
  },
});
