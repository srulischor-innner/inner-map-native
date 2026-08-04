// Budget refusal sheet — the surface the user sees when the server refuses a
// turn because the measured-cost pool for the period is spent.
//
// EVERY STRING IS SERVER-AUTHORED. The refusal object arrives on the 402 JSON
// body (non-streaming chat + guide-chat) or on the single SSE
// `budget_exhausted` frame (streaming chat), normalised by
// api.parseBudgetRefusal(). Nothing here paraphrases, appends to, re-orders,
// or re-punctuates it — the em dashes in the copy are load-bearing and the
// price lives on primaryAction.label by design. There is deliberately no
// count, no allowance figure, and no "remaining" language anywhere in this
// component: the server never sends one, and synthesising one would be a
// volume claim it cannot honour.
//
// House Pattern A bottom sheet (IntegrationPanel / PartFolderModal /
// SpectrumDetailModal), with one deliberate deviation: maxHeight is 45%, not
// 60% (founder ruling — the sheet carries three short lines and two actions,
// and 60% left it looking half-empty).
//
// 45% is a CEILING, not a fixed height. The three server strings live in a
// ScrollView that shrinks (flexShrink) rather than grows, so with today's short
// copy the sheet is exactly as tall as its content, and with long copy or a
// large Dynamic Type setting the text scrolls instead of pushing anything out.
// The two actions are pinned BELOW the scroll area, outside it: they are the
// point of this sheet and must never be clipped or scrolled out of reach.
//
// NO close "X". The secondary action IS the dismissal; an X next to a
// "Not now" that does the same thing is redundant. "Not now" renders as
// full-width tappable plain text at the SAME font size as the primary
// button's label — it is a real option, not a de-emphasised escape hatch.

import React from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radii, spacing } from '../../constants/theme';
import type { BudgetRefusal } from '../../services/api';

type Props = {
  visible: boolean;
  /** Null until a refusal has actually landed — the sheet renders nothing. */
  refusal: BudgetRefusal | null;
  onDismiss: () => void;
  /** primaryAction.action is 'topup' — the caller routes to the store. */
  onTopUp: () => void;
  /**
   * The caller's store round-trip is in flight (product lookup → offerings →
   * getProducts → StoreKit). Dims and disables the PRIMARY button and swaps
   * its label for a spinner. The secondary action is deliberately untouched:
   * "Not now" is a real option and must stay tappable throughout, so the user
   * can always leave — especially while a purchase is spinning.
   */
  busy?: boolean;
};

export function BudgetRefusalSheet({ visible, refusal, onDismiss, onTopUp, busy = false }: Props) {
  const insets = useSafeAreaInsets();
  if (!refusal) return null;

  const handleTopUp = () => {
    if (busy) return;
    Haptics.selectionAsync().catch(() => {});
    onTopUp();
  };
  const handleDismiss = () => {
    Haptics.selectionAsync().catch(() => {});
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.handle} />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={styles.title}>{refusal.title}</Text>
          <Text style={styles.paragraph}>{refusal.body}</Text>
          {refusal.reset ? <Text style={styles.reset}>{refusal.reset}</Text> : null}
        </ScrollView>

        <View style={styles.actions}>
          {/* BUSY: the label is kept mounted but transparent and the spinner
              is laid over it, so the button's height never changes between
              idle and busy — the sheet does not resettle mid-tap. The label
              string is server-authored and is neither replaced nor edited. */}
          <Pressable
            onPress={handleTopUp}
            disabled={busy}
            style={[styles.primaryBtn, busy && styles.primaryBtnBusy]}
            accessibilityRole="button"
            accessibilityLabel={refusal.primaryAction.label}
            accessibilityState={{ disabled: busy, busy }}
          >
            <Text style={[styles.primaryLabel, busy && styles.primaryLabelHidden]}>
              {refusal.primaryAction.label}
            </Text>
            {busy ? (
              <View style={styles.primarySpinner} pointerEvents="none">
                <ActivityIndicator size="small" color={colors.background} />
              </View>
            ) : null}
          </Pressable>

          <Pressable
            onPress={handleDismiss}
            style={styles.secondaryBtn}
            accessibilityRole="button"
            accessibilityLabel={refusal.secondaryAction.label}
          >
            <Text style={styles.secondaryLabel}>{refusal.secondaryAction.label}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '45%',
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 0.5,
    borderTopColor: colors.borderAmber,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: spacing.sm,
  },
  // flexShrink only — never flexGrow. Short copy leaves the scroll area at its
  // natural content height (sheet ends up well under the 45% ceiling, exactly
  // as it looks today); long copy or large Dynamic Type shrinks it against the
  // ceiling and it starts scrolling, while the actions below hold their size.
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  title: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    letterSpacing: 0.3,
  },
  paragraph: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  reset: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  // Pinned below the scroll area. paddingTop reproduces the spacing.lg gap the
  // old in-flow spacer gave between the last line of copy and the primary
  // button, so short-copy layout is pixel-identical to before.
  actions: {
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.amber,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Busy dim is applied to the FILL, not to the whole button via opacity —
  // an opacity on the Pressable would fade the spinner along with it and
  // leave the one live element on the sheet looking half-dead.
  primaryBtnBusy: { backgroundColor: 'rgba(230,180,122,0.55)' },
  primaryLabel: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  // Held in layout, hidden from view — see the comment at the call site.
  primaryLabelHidden: { opacity: 0 },
  primarySpinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-width tap target so "Not now" is as easy to hit as the button
  // above it, and set at the SAME 15px as the primary label.
  secondaryBtn: {
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  secondaryLabel: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
