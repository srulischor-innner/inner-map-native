// Consent document — single-page commitment moment for the Partner
// tab. Used ONLY for the gated "I UNDERSTAND AND ACCEPT" step after
// both partners are bound (route: app/relationships/intro/[id].tsx).
//
// The pre-pairing informational tour and the post-pairing review
// loop both use the 6-slide RelationshipIntroCarousel — those are
// content surfaces, not commitment surfaces, and the carousel's
// paced reading + cinematic visuals serve them better. The
// commitment moment stays a single document because crossing an
// explicit consent threshold reads better as one continuous page
// than six discrete slides.
//
// Renders as a scrollable column of section blocks (header + body)
// with a primary "I UNDERSTAND AND ACCEPT" button anchored at the
// bottom. Tapping it fires api.acceptRelationshipIntro(relationshipId)
// then navigates back to /relationships (state machine refreshes
// into pending-intros if the partner hasn't finished theirs, or
// active if they have).
//
// Visual style intentionally matches the first-launch PrivacyNotice
// screen (in app/onboarding.tsx) — same calm, readable, low-
// decoration aesthetic. Section headers in caps + amber, body in
// cream sans, button anchored at the bottom in the existing pill
// style.

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';

type Section = { header: string; body: string };

// Section content — PR 3 (June 2026) rewrite. The previous text was
// warm but vague about the data model; this version says exactly what
// is shared, what isn't, and what happens when someone leaves. The
// goal is informed consent: by the time a user accepts, they
// understand the actual mechanics, not just the vibe.
//
// Six sections, in order:
//   1. Why this space exists (frame the why)
//   2. YOUR MAP IS SHARED with your partner (the big one)
//   3. WHAT YOU SAY IN PRIVATE STAYS PRIVATE
//   4. YOU CONTROL YOUR SUMMARIES (per-session approval; delete anytime)
//   5. THE AI OFFERS POSSIBILITIES, NOT VERDICTS
//   6. EITHER OF YOU CAN LEAVE ANYTIME (leave = delete shared layer)
//   7. IF SOMETHING DOESN'T FEEL SAFE (crisis line)
//   8. ENTERING TOGETHER (commitment moment)
const SECTIONS: Section[] = [
  {
    header: 'WHY THIS SPACE EXISTS',
    body:
      'Inner Map can hold a private space for you and your partner — one ' +
      'where you each do your own inner work, and the patterns the two of ' +
      'you carry can be seen alongside each other. Pattern-tracking across ' +
      'both of you is what this feature is for. Please read the next few ' +
      'sections carefully — they describe exactly what is shared, what is ' +
      'not, and what happens if either of you leaves.',
  },
  {
    header: 'YOUR MAP IS SHARED WITH YOUR PARTNER',
    body:
      'Your map — your wound, your parts, the patterns Inner Map has identified ' +
      'in you — becomes visible to your partner once you both accept. This ' +
      'is the whole point of Partner mode: finding patterns ACROSS the two ' +
      'of you requires that the two of you can see each other\'s maps. By ' +
      'continuing, you are agreeing to share your map.',
  },
  {
    header: 'WHAT YOU SAY IN PRIVATE STAYS PRIVATE',
    body:
      'Your private chats are never shared with your partner. Your partner ' +
      'cannot read what you write to the AI in your private space, and ' +
      'you cannot read theirs. Only your map (automatically) and session ' +
      'summaries that you explicitly approve are shared — nothing else ' +
      'crosses.',
  },
  {
    header: 'YOU CONTROL YOUR SUMMARIES',
    body:
      'At the end of each private session, the AI offers you a short summary ' +
      'of what came up. You decide whether to share it with your partner, ' +
      'edit it first, or keep it entirely to yourself. Nothing personal ' +
      'crosses without your approval. Anything you have shared into the ' +
      'shared space — summaries, contributions — you can delete at any ' +
      'time.',
  },
  {
    header: 'THE AI OFFERS POSSIBILITIES, NOT VERDICTS',
    body:
      'The shared-space AI suggests patterns it notices and invites you both ' +
      'to consider them. It does not diagnose, judge, or take sides. When it ' +
      'gets something wrong, tell it — your lived experience overrides its ' +
      'read every time. The two of you are the authority on your ' +
      'relationship.',
  },
  {
    header: 'EITHER OF YOU CAN LEAVE ANYTIME',
    body:
      'Either of you can end the connection at any moment — alone, ' +
      'instantly, without the other\'s approval. When you leave, everything ' +
      'the two of you have shared together is deleted for both of you: the ' +
      'shared thread, your shared contributions, the shared patterns. Your ' +
      'own private chats and your own map stay with you — they\'re yours. ' +
      'Leaving cannot be undone.',
  },
  {
    header: "IF SOMETHING DOESN'T FEEL SAFE",
    body:
      'This space is for couples doing mutual inner work in good faith. If ' +
      'you\'re experiencing physical violence, threats, coercion, or fear, ' +
      'please reach out to professional support. Crisis resources are in ' +
      'Settings.',
  },
  {
    header: 'ENTERING TOGETHER',
    body:
      'By continuing, you\'re confirming you understand how this space works — ' +
      'what is shared, what stays private, that you control your own ' +
      'summaries, and that either of you can leave at any time — and that ' +
      'you\'re entering with your partner in good faith.',
  },
];

type Props = {
  /** Relationship id passed through to api.acceptRelationshipIntro on
   *  primary-button tap. After a successful accept the component
   *  navigates back to /relationships, where the state machine
   *  refreshes into pending-intros or active. */
  relationshipId: string;
  /** Renders a back chevron in the header. The commitment route file
   *  (app/relationships/intro/[id].tsx) passes this so the user can
   *  back out to the Partner tab without committing. */
  showBackButton?: boolean;
  onBack?: () => void;
};

export function ConsentDocument(props: Props) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);

  const handlePrimary = useCallback(async () => {
    if (accepting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setAccepting(true);
    const result = await api.acceptRelationshipIntro(props.relationshipId);
    setAccepting(false);
    if ('error' in result) {
      Alert.alert(
        'Could not save your acceptance',
        result.message || 'Please try again in a moment.',
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/relationships');
  }, [props.relationshipId, router, accepting]);

  return (
    <View style={styles.root}>
      {props.showBackButton ? (
        <View style={styles.header}>
          <Pressable
            onPress={() => props.onBack?.()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
          </Pressable>
          <View style={styles.backBtn} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map((s, i) => (
          <View
            key={s.header}
            style={[styles.section, i === 0 && styles.sectionFirst]}
          >
            <Text style={styles.sectionHeader}>{s.header}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Anchored bottom button. Sits in its own padded container so
          the scroll content above can't overlap it. */}
      <View style={styles.footer}>
        <Pressable
          onPress={handlePrimary}
          disabled={accepting}
          style={[styles.btn, accepting && styles.btnDim]}
          accessibilityLabel="I understand and accept"
        >
          {accepting ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.btnText}>I UNDERSTAND AND ACCEPT</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // Optional back-chevron header. Same shape as the carousel's
  // header so the back button lands in the same place users were
  // used to (the commitment route was a screen of its own).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },

  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },

  // First section sits a bit higher than the rest so the opening
  // beat lands as the first thing on the page.
  section: {
    marginBottom: spacing.lg,
  },
  sectionFirst: {
    marginTop: spacing.md,
  },
  // Caps + amber + tight letter-spacing — matches the existing
  // Settings/Privacy section-label style. Smaller than a heading
  // so the body copy carries the visual weight.
  sectionHeader: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.8,
    marginBottom: spacing.sm,
  },
  sectionBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    letterSpacing: 0.15,
  },

  // Footer pill button. Matches the onboarding `beginBtn` pattern
  // so the visual language is continuous with the rest of the
  // onboarding flow (Privacy Notice / Terms / Begin button).
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 0.5,
    alignItems: 'center',
  },
  btn: {
    backgroundColor: colors.amber,
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    borderRadius: 32,
    minWidth: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDim: { opacity: 0.6 },
  btnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 1,
  },
});
