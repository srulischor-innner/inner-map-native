// SupportResourcesScreen — the "You're not alone" resources screen shown
// when someone picks "I'm in a hard place right now" from the
// experience-level question.
//
// EXTRACTED, NOT REWRITTEN (2026-08-04). This markup lived as a local
// `ResourcesScreen` function inside app/onboarding.tsx and was reachable
// ONLY as an internal onboarding phase (setPhase('resources')) — there was
// no route to it. Picking the same option from Settings therefore promised
// "real-person resources" and delivered nothing.
//
// Rather than restate the copy on a second surface, the component moved
// here unchanged (every word, the styles and the CTA behaviour all
// byte-for-byte the onboarding original) and both surfaces render THIS:
//   - app/onboarding.tsx        — the 'resources' phase, continues to notTherapy
//   - app/support-resources.tsx — the standalone route Settings pushes
// One copy, so the two can never drift the way four parallel marker lists
// once did.
//
// NOTE on hotline copy: the wording of the "IF YOU ARE IN IMMEDIATE CRISIS"
// block below is still the onboarding original — no number or URL has ever
// been retyped here. Founder ruling 2026-08-04 made the three targets in it
// tappable (call / call / open), which changes nothing a user READS on either
// surface: same characters, now functional. The link targets are matched to
// components/safety/CrisisResourcesCard, which is where this app's tel:/https:
// mapping for these same resources is defined.
//
// That card remains a separate, richer surface used by /privacy and the Map
// Voice flow — it also carries DV and eating-disorder lines this block does
// not. Replacing this block with it would change what onboarding renders, so
// it is still deliberately left for a founder call rather than done in
// passing. (Held, as of this change.)

import React, { useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Linking } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radii, spacing } from '../../constants/theme';

// ONE literal per resource, rendered as the visible text AND used to build the
// link target — so the number on screen and the number dialled cannot drift
// apart. These are the existing strings moved up out of the JSX, not retyped.
//
// The targets this produces are exactly CrisisResourcesCard's:
//   tel:988 · tel:116123 · https://findahelpline.com
// Samaritans' tel: form has no space, so the space in the DISPLAYED "116 123"
// is stripped here rather than a second copy of the digits being written down.
const LIFELINE_NUMBER = '988';
const SAMARITANS_NUMBER = '116 123';
const HELPLINE_HOST = 'findahelpline.com';

const LIFELINE_TEL = `tel:${LIFELINE_NUMBER}`;
const SAMARITANS_TEL = `tel:${SAMARITANS_NUMBER.replace(/\s+/g, '')}`;
const HELPLINE_URL = `https://${HELPLINE_HOST}`;

type Props = {
  /** Primary CTA press. Onboarding advances to the not-therapy moment;
   *  the standalone route goes back to Settings. */
  onContinue: () => void;
  /** Primary CTA label. Defaults to the onboarding wording so that
   *  surface renders exactly as it did before the extraction. */
  continueLabel?: string;
};

export function SupportResourcesScreen({ onContinue, continueLabel }: Props) {
  // Failure-tolerant by construction. A device with no dialer (a tablet, the
  // simulator) rejects openURL, and this path is walked by people in a hard
  // place — a crash or an unhandled rejection here is the worst possible
  // outcome. The rejection is swallowed to a warn, the synchronous throw is
  // caught too, and the number stays on screen as plain selectable text
  // either way, so a tap that cannot work costs the user nothing: they can
  // still read it, select it, and dial it by hand.
  const openLink = useCallback((url: string) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      Linking.openURL(url).catch((e) =>
        console.warn('[support-resources] Linking.openURL threw:', (e as Error)?.message),
      );
    } catch (e) {
      console.warn('[support-resources] Linking.openURL threw:', (e as Error)?.message);
    }
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>You're not alone</Text>
      <Text style={styles.body}>
        Inner Map can be a thoughtful companion, but it's not a substitute for a
        real person who knows you. If something is heavy, please also reach out
        to one of these — even briefly:
      </Text>

      <View style={styles.resCard}>
        <Text style={styles.resCardLabel}>IF YOU ARE IN IMMEDIATE CRISIS</Text>
        <Text style={styles.resCardText} selectable>
          <Text
            style={styles.resCardLink}
            onPress={() => openLink(LIFELINE_TEL)}
            accessibilityRole="link"
            accessibilityLabel={`Call ${LIFELINE_NUMBER}`}
          >
            {LIFELINE_NUMBER}
          </Text> — Suicide & Crisis Lifeline (call or text, US/Canada).
          Available 24/7. You don't have to be in crisis to call.
        </Text>
        <Text style={styles.resCardText} selectable>
          <Text
            style={styles.resCardLink}
            onPress={() => openLink(SAMARITANS_TEL)}
            accessibilityRole="link"
            accessibilityLabel="Call Samaritans"
          >
            {SAMARITANS_NUMBER}
          </Text> — Samaritans (UK & Ireland, free 24/7).
        </Text>
        <Text style={styles.resCardText} selectable>
          For other countries:{' '}
          <Text
            style={styles.resCardLink}
            onPress={() => openLink(HELPLINE_URL)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${HELPLINE_HOST}`}
          >
            {HELPLINE_HOST}
          </Text>{' '}
          lists local options worldwide.
        </Text>
      </View>

      <View style={styles.resCard}>
        <Text style={styles.resCardLabel}>IF YOU CAN GET TO A THERAPIST</Text>
        <Text style={styles.resCardText}>
          A real therapist who knows you over time is the single most useful
          resource for the kind of work this app touches. Inner Map can help
          you go deeper in those sessions — it isn't a replacement.
        </Text>
        <Text style={styles.resCardText}>
          openpathcollective.org and inclusivetherapists.com both list
          sliding-scale therapists if cost is a concern.
        </Text>
      </View>

      <View style={styles.resCard}>
        <Text style={styles.resCardLabel}>RIGHT NOW</Text>
        <Text style={styles.resCardText}>
          One person you trust, even if the relationship is imperfect. A walk
          outside. A few slow breaths. None of that "fixes" anything — but
          they all bring you back to your own body, which is where the work
          actually happens.
        </Text>
      </View>

      <Pressable onPress={onContinue} style={styles.continueBtn}>
        <Text style={styles.continueText}>
          {continueLabel || "I'M READY — ENTER INNER MAP"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// Values carried over from app/onboarding.tsx's shared experience-step /
// resources style block so the screen renders identically on both surfaces.
const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 600, alignSelf: 'center', width: '100%',
  },
  title: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 28, letterSpacing: 0.3, marginBottom: spacing.md,
  },
  body: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 23, marginBottom: spacing.lg,
  },
  continueBtn: {
    alignSelf: 'center',
    paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5, borderColor: colors.amber,
    marginTop: spacing.lg,
    shadowColor: colors.amber, shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
  },
  continueText: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 12, letterSpacing: 2,
  },
  resCard: {
    backgroundColor: colors.backgroundCard,
    borderLeftColor: colors.amber, borderLeftWidth: 2,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  resCardLabel: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2, marginBottom: spacing.sm,
  },
  resCardText: {
    color: colors.cream, fontFamily: fonts.sans,
    fontSize: 14, lineHeight: 22, marginBottom: 8,
  },
  // The only visual change on this screen: the three tappable spans are marked
  // as links in the app's existing idiom (amber + underline, same as the
  // contact link on /privacy). Size, weight and line height are inherited from
  // resCardText, so nothing reflows — a tappable target the user cannot see is
  // not actually functional, least of all for someone scanning this screen in
  // a hurry.
  resCardLink: {
    color: colors.amber,
    textDecorationLine: 'underline',
  },
});
