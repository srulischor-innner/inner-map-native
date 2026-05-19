// MapVoicePanel — wraps the press-and-hold MapVoiceButton with the
// metered "session" layer introduced in polish round 4:
//
//   idle   → a mic FAB. Tapping it opens the entry modal.
//   entry  → modal with the Map Voice explainer + (conditional)
//            balance indicator + START. START calls
//            POST /api/voice-usage/session — a monthly_cap_reached
//            response shows the cap message instead of entering.
//   active → the real MapVoiceButton (walkie-talkie) is rendered,
//            plus a mm:ss timer. At 8:00 a "2 minutes left" banner
//            appears; at 10:00 the session auto-ends with a closing
//            line. An End (×) control lets the user finish early.
//
// On every session end (auto, manual, or unmount) the elapsed
// duration is reported to POST /api/voice-usage/session/:id/end so
// the server can record cost against the monthly cap.
//
// The 10-minute ceiling is enforced here client-side because the
// Map Voice audio path is a direct client↔OpenAI Realtime WebSocket
// (the server only mints the ephemeral token) — the server can't
// close a socket it isn't in. The server still clamps the reported
// duration to 600s as a billing backstop.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Modal, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing, radii } from '../../constants/theme';
import { api } from '../../services/api';
import { MapVoiceButton } from './MapVoiceButton';

// 10-minute per-session ceiling + the 8-minute "2 minutes left"
// warning. Mirrors VOICE_SESSION_MAX_SEC on the server.
const SESSION_MAX_SEC = 600;
const TWO_MIN_WARNING_SEC = 480;
// How long the auto-end closing line stays on screen before the
// panel returns to idle.
const CLOSING_MESSAGE_MS = 6500;

const BODY_COPY =
  'Map Voice is for short conversations to check where you are on ' +
  'the map right now. Use it to unblend — to step back from a part ' +
  "you're caught in, so you can see what's running the show. Brief " +
  'and focused.';

const CLOSING_LINE =
  "Time's up. Step back from this part and notice the ground you've got now.";

type PanelState = 'idle' | 'entry' | 'active';

type VoiceUsage = {
  usedUsd: number;
  capUsd: number;
  periodEnd: string;
  approxMinutesRemaining: number;
};

// "2026-06-01T00:00:00Z" → "June 1". Falls back to the raw string
// if parsing fails so the cap message is never blank.
function formatPeriodEnd(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MapVoicePanel({
  sessionId,
  onDetectedPart,
}: {
  sessionId: string;
  onDetectedPart?: (part: string, label?: string | null) => void;
}) {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [usage, setUsage] = useState<VoiceUsage | null>(null);
  const [capMessage, setCapMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [twoMinWarning, setTwoMinWarning] = useState(false);
  const [closingMessage, setClosingMessage] = useState<string | null>(null);

  // The active session handle + its start time. Refs (not state) so
  // the interval tick + the unmount cleanup read the latest values
  // without stale-closure trouble.
  const voiceSessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (closingTimerRef.current) { clearTimeout(closingTimerRef.current); closingTimerRef.current = null; }
  }, []);

  // Report the session's elapsed duration to the server. Safe to call
  // once per session — clears the ref so a double-call (e.g. manual
  // end racing the unmount cleanup) doesn't double-report.
  const reportEnd = useCallback(() => {
    const id = voiceSessionIdRef.current;
    if (!id) return;
    voiceSessionIdRef.current = null;
    const duration = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
    api.endVoiceSession(id, duration).catch(() => {});
  }, []);

  // Unmount cleanup — leaving the Map tab mid-session must close the
  // session out (timers + duration report) so it doesn't dangle.
  useEffect(() => () => {
    clearTimers();
    reportEnd();
  }, [clearTimers, reportEnd]);

  // Open the entry modal + fetch the current-period usage so the
  // balance indicator can decide whether to show.
  const openEntry = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setCapMessage(null);
    setUsage(null);
    setPanelState('entry');
    api.getVoiceUsageCurrentPeriod()
      .then((u) => setUsage(u))
      .catch(() => {});
  }, []);

  const closeEntry = useCallback(() => {
    setPanelState('idle');
    setCapMessage(null);
  }, []);

  // End the active session. `auto` true → 10-minute ceiling hit:
  // show the closing line for a beat before returning to idle.
  const endSession = useCallback((auto: boolean) => {
    clearTimers();
    reportEnd();
    if (auto) {
      setClosingMessage(CLOSING_LINE);
      closingTimerRef.current = setTimeout(() => {
        setClosingMessage(null);
        setPanelState('idle');
      }, CLOSING_MESSAGE_MS);
    } else {
      setPanelState('idle');
    }
    setTwoMinWarning(false);
  }, [clearTimers, reportEnd]);

  // START tapped in the entry modal.
  const onStart = useCallback(async () => {
    if (starting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setStarting(true);
    const res = await api.startVoiceSession();
    setStarting(false);
    if (!res) {
      setCapMessage("Couldn't start Map Voice right now. Try again in a moment.");
      return;
    }
    if ('error' in res) {
      // monthly_cap_reached
      setCapMessage(
        "You've used your Map Voice for this month. It resets on " +
        `${formatPeriodEnd(res.periodEnd)}. Premium access coming soon.`,
      );
      return;
    }
    // Success — enter the active session + start the timer.
    voiceSessionIdRef.current = res.sessionId;
    startedAtRef.current = Date.now();
    setElapsedSec(0);
    setTwoMinWarning(false);
    setClosingMessage(null);
    setPanelState('active');
    tickRef.current = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSec(sec);
      if (sec >= TWO_MIN_WARNING_SEC && sec < SESSION_MAX_SEC) {
        setTwoMinWarning(true);
      }
      if (sec >= SESSION_MAX_SEC) {
        endSession(true);
      }
    }, 1000);
  }, [starting, endSession]);

  // ── Balance indicator visibility — only at >= 80% of the cap. ──
  const showBalance =
    !!usage && usage.capUsd > 0 && usage.usedUsd / usage.capUsd >= 0.8;

  return (
    <>
      {/* IDLE — a mic FAB. Single tap (not press-and-hold) opens the
          entry modal. Mirrors the MapVoiceButton FAB geometry so the
          corner looks unchanged until a session is live. */}
      {panelState === 'idle' ? (
        <View pointerEvents="box-none" style={styles.fabWrap}>
          {closingMessage ? (
            <View style={styles.closingCard}>
              <Text style={styles.closingText}>{closingMessage}</Text>
            </View>
          ) : (
            <View style={styles.idleHint}>
              <Text style={styles.idleHintText}>Map Voice</Text>
            </View>
          )}
          <Pressable
            onPress={openEntry}
            hitSlop={10}
            style={styles.fab}
            accessibilityLabel="Open Map Voice"
            accessibilityRole="button"
          >
            <Ionicons name="mic" size={26} color={colors.amber} />
          </Pressable>
        </View>
      ) : null}

      {/* ACTIVE — the real walkie-talkie button + a timer + warnings.
          MapVoiceButton renders its own bottom-right FAB; the timer
          pill + 2-minute banner sit above it. */}
      {panelState === 'active' ? (
        <>
          <MapVoiceButton sessionId={sessionId} onDetectedPart={onDetectedPart} />
          <View pointerEvents="box-none" style={styles.timerWrap}>
            {twoMinWarning ? (
              <View style={styles.warnPill}>
                <Text style={styles.warnText}>2 minutes left</Text>
              </View>
            ) : null}
            <View style={styles.timerRow}>
              <View style={styles.timerPill}>
                <Ionicons name="time-outline" size={12} color={colors.creamDim} />
                <Text style={styles.timerText}>{mmss(elapsedSec)}</Text>
              </View>
              <Pressable
                onPress={() => endSession(false)}
                hitSlop={10}
                style={styles.endBtn}
                accessibilityLabel="End Map Voice session"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={14} color={colors.creamDim} />
              </Pressable>
            </View>
          </View>
        </>
      ) : null}

      {/* ENTRY MODAL — explainer + (conditional) balance + START. */}
      <Modal
        visible={panelState === 'entry'}
        transparent
        animationType="fade"
        onRequestClose={closeEntry}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={closeEntry}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>Map Voice</Text>
            <Text style={styles.body}>{BODY_COPY}</Text>

            {showBalance ? (
              <Text style={styles.balance}>
                ~{usage!.approxMinutesRemaining} minutes left this month.
              </Text>
            ) : null}

            {capMessage ? (
              <Text style={styles.capMessage}>{capMessage}</Text>
            ) : null}

            {capMessage ? (
              <Pressable onPress={closeEntry} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>CLOSE</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={onStart}
                disabled={starting}
                style={[styles.startBtn, starting && styles.startBtnDim]}
                accessibilityLabel="Start Map Voice"
                accessibilityRole="button"
              >
                {starting ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <Text style={styles.startBtnText}>START</Text>
                )}
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Idle FAB — same bottom-right corner + geometry as MapVoiceButton.
  fabWrap: {
    position: 'absolute',
    right: 16,
    bottom: 50,
    alignItems: 'flex-end',
    gap: 8,
  },
  idleHint: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,19,26,0.75)',
    borderRadius: 100,
    borderColor: colors.amberDim,
    borderWidth: 0.5,
  },
  idleHintText: {
    color: colors.creamDim,
    fontSize: 11,
    letterSpacing: 1,
  },
  fab: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(20,19,26,0.9)',
    borderWidth: 2, borderColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.amber, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  closingCard: {
    maxWidth: 240,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(20,19,26,0.95)',
    borderRadius: radii.md,
    borderColor: colors.amberDim,
    borderWidth: 0.5,
  },
  closingText: {
    color: colors.cream,
    fontFamily: fonts.serif,
    fontSize: 14,
    lineHeight: 20,
  },

  // Active-session timer cluster — above the MapVoiceButton FAB.
  timerWrap: {
    position: 'absolute',
    right: 16,
    bottom: 120,
    alignItems: 'flex-end',
    gap: 8,
  },
  warnPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(230,180,122,0.16)',
    borderRadius: 100,
    borderColor: colors.amber,
    borderWidth: 0.5,
  },
  warnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(20,19,26,0.85)',
    borderRadius: 100,
    borderColor: colors.amberDim,
    borderWidth: 0.5,
  },
  timerText: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  endBtn: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(20,19,26,0.85)',
    borderColor: colors.amberDim,
    borderWidth: 0.5,
  },

  // Entry modal.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    backgroundColor: '#0e0e1a',
    borderRadius: 20,
    padding: 24,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.2)',
  },
  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    color: 'rgba(240,237,232,0.82)',
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  balance: {
    color: colors.amber,
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.3,
    textAlign: 'center',
    marginTop: 14,
  },
  capMessage: {
    color: 'rgba(240,237,232,0.82)',
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 14,
  },
  startBtn: {
    backgroundColor: colors.amber,
    paddingVertical: 14,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  startBtnDim: { opacity: 0.6 },
  startBtnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 1.4,
  },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.45)',
    alignItems: 'center',
    marginTop: 20,
  },
  secondaryBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.4,
  },
});
