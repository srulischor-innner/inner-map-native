// End-of-session summary screen.
//
// Slides up after the user confirms End Session, replacing the prior
// "Your map has been updated." overlay. Shows the AI-generated 3-part
// summary (WHAT WE EXPLORED / WHAT THE MAP IS SHOWING / SOMETHING TO TRY)
// fetched from /api/session-summary while a breathing-triangle loader
// fills in the wait. Only one button: "Begin New Session" — tapping it
// fires the parent's onContinue which performs the actual reset.
//
// If the fetch returns null OR a soft fallback (empty fields), we show
// a single warm fallback line and still let the user continue. The
// modal NEVER blocks the user from moving on.

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import {
  useSharedValue, withRepeat, withTiming, Easing, useDerivedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';

export type SessionSummary = {
  exploredText: string;
  mapShowingText: string;
  somethingToTryText: string;
};

type Props = {
  visible: boolean;
  /** null while loading, or after fetch completes. The parent passes the
   *  fetched summary in once /api/session-summary resolves. */
  summary: SessionSummary | null;
  /** Set true if the fetch failed entirely (transport / 500). The screen
   *  shows a warm fallback line in place of the three sections. */
  failed?: boolean;
  /** Fires when the user taps "Begin New Session". */
  onContinue: () => void;
};

export function SessionSummaryModal({ visible, summary, failed, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  // Soft success haptic the moment the modal becomes visible — this is
  // the "the session landed" felt-sense the spec calls for. Fires once
  // per visible→true transition.
  useEffect(() => {
    if (!visible) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [visible]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const isLoading = !failed && !summary;
  const hasContent = !!summary && (
    summary.exploredText.trim() || summary.mapShowingText.trim() || summary.somethingToTryText.trim()
  );

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={() => { /* no-op — user must tap continue */ }}
      statusBarTranslucent
    >
      <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Session Complete</Text>
          <Text style={styles.dateText}>{today}</Text>

          {isLoading ? (
            <View style={styles.loaderWrap}>
              <BreathingTriangle />
              <Text style={styles.loaderText}>reflecting on what came up…</Text>
            </View>
          ) : null}

          {summary && hasContent ? (
            <>
              <Section label="WHAT WE EXPLORED" text={summary.exploredText} />
              <Section label="WHAT THE MAP IS SHOWING" text={summary.mapShowingText} />
              <Section label="SOMETHING TO TRY" text={summary.somethingToTryText} />
            </>
          ) : null}

          {(failed || (summary && !hasContent)) ? (
            <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.md }}>
              <Text style={styles.fallbackText}>
                This session has been saved to your journal. Your map has been
                updated.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onContinue}
            style={styles.continueBtn}
            accessibilityLabel="Begin a new session"
            hitSlop={10}
          >
            <Text style={styles.continueText}>BEGIN NEW SESSION</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// One labeled summary section — amber uppercase label + cream body text +
// hairline divider underneath. Matches the existing Journey/Folder section
// grammar so the screen feels native to the app, not bolted-on.
// ============================================================================
function Section({ label, text }: { label: string; text: string }) {
  if (!text || !text.trim()) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionText}>{text.trim()}</Text>
      <View style={styles.divider} />
    </View>
  );
}

// ============================================================================
// Breathing-triangle loader. Same equilateral path the typing indicator and
// AttentionIndicator use; opacity oscillates to read as a quiet inhale/exhale.
// ============================================================================
const TRI_SIZE = 32;
function BreathingTriangle() {
  const breath = useSharedValue(0.4);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.95, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);
  const op = useDerivedValue(() => breath.value, [breath]);

  const triPath = (() => {
    const p = Skia.Path.Make();
    const pad = 4;
    p.moveTo(TRI_SIZE / 2, pad);
    p.lineTo(TRI_SIZE - pad, TRI_SIZE - pad);
    p.lineTo(pad, TRI_SIZE - pad);
    p.close();
    return p;
  })();

  return (
    <Canvas style={{ width: TRI_SIZE, height: TRI_SIZE }}>
      <Group opacity={op}>
        <Path path={triPath} color="#E6B47A" style="stroke" strokeWidth={1.8} />
        <Path path={triPath} color="#E6B47A33" style="fill" />
      </Group>
    </Canvas>
  );
}

// ============================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  body: { padding: spacing.lg, paddingBottom: spacing.xxl },

  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  dateText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: spacing.xl,
    letterSpacing: 0.3,
  },

  loaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  loaderText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    marginTop: 12,
    letterSpacing: 0.3,
  },

  section: { marginTop: spacing.lg },
  sectionLabel: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
  },
  sectionText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
  },

  fallbackText: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
  },

  footer: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  continueBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  continueText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 2,
  },
});
