// CrisisResourcesCard — shared, tap-to-call/text/visit crisis resource
// card. Renderable as inline (settings) or as a modal overlay (Map
// Voice surface, where the response is voice-only and the user needs
// the resources on screen as well as in audio).
//
// Created June 2026 as part of the app-wide crisis layer PR. The
// settings.tsx CrisisResourcesSection was the canonical inline form;
// this peer abstracts the same content as a reusable component so any
// surface can render it. The Map Voice flow uses the modal variant —
// inserted in-flow when the server flags `crisis_detected: true` on
// a turn response (see services/api.ts mapVoiceTurn).
//
// THE LINES ARE safety.md's (2026-11-09). The five-screens audit
// (package-test-prompts/five-screens-2026-11-08.md, section 3) found the card
// missing four of them; they are added here word for word from safety.md
// (the server's prompts/m2/safety.md), so every surface that shows this card
// — the Map tab, the chat, Settings, Privacy — says what the chat says aloud:
//   - "988 also serves people worried about someone" (safety.md l.42)
//   - "the National Domestic Violence Hotline, 1-800-799-7233, text START to
//     88788, or thehotline.org" — the hotline's name and 88788 were visible
//     nowhere, only in an accessibility label (l.28)
//   - "the National Alliance for Eating Disorders, 1-866-662-1235 (weekdays
//     9am–7pm ET), and 988 after hours" — the name likewise (l.28)
//   - "For psychosis or mania: a doctor, a psychiatrist or 988." (l.28)
// scripts/check-crisis-card-safety-lines.js compares them with safety.md.
//
// Visual language: amber, warm-not-alarmed (matches the existing
// settings card). Tap-to-call uses expo Linking (tel: / sms: / https:)
// — system apps take over from there.

import React, { useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, Linking, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, spacing } from '../../constants/theme';
import type { MicResource } from '../../utils/micResources';

type Props = {
  /** When true, renders as a full-screen modal with a Close (X) button
   *  in the corner. When false, renders inline as a card (Settings
   *  layout). The two surfaces use the same content; modal is the
   *  Map Voice / Partner / Guide in-flow surfacing variant. */
  asModal?: boolean;
  /** When asModal is true: visible flag. Inline renders ignore this. */
  visible?: boolean;
  /** When asModal is true: close callback fired on the X button or
   *  Android back. */
  onClose?: () => void;
  /** Optional header override. Defaults to "IF YOU'RE IN CRISIS". The
   *  Map Voice flow uses "We're going to pause here" instead so the
   *  card appearing mid-session reads as care, not alarm. */
  header?: string;
  /** Optional lede paragraph override. Defaults to the standard
   *  "You're not alone. These resources are available 24/7." copy. */
  lede?: string;
  /** The resources a spoken mic reply carried (utils/micResources.ts
   *  parseMicResources). When there are any, the card shows THAT list as
   *  links, since the voice no longer reads URLs aloud; otherwise its own. */
  resources?: MicResource[];
};

// Word for word from safety.md (see the header). Capitalised where a line
// starts the sentence on the card; nothing else changed.
export const SAFETY_LINES = {
  worriedAboutSomeone: '988 also serves people worried about someone.',
  domesticViolence: 'The National Domestic Violence Hotline, 1-800-799-7233, text START to 88788, or thehotline.org.',
  eating: 'The National Alliance for Eating Disorders, 1-866-662-1235 (weekdays 9am–7pm ET), and 988 after hours.',
  psychosisOrMania: 'For psychosis or mania: a doctor, a psychiatrist or 988.',
} as const;

function CrisisResourcesContent({ header, lede, resources }: { header?: string; lede?: string; resources?: MicResource[] }) {
  const open = useCallback((url: string) => {
    Haptics.selectionAsync().catch(() => {});
    Linking.openURL(url).catch((e) =>
      console.warn('[crisis-card] Linking.openURL threw:', (e as Error)?.message),
    );
  }, []);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{header || "IF YOU'RE IN CRISIS"}</Text>
      <Text style={styles.lede}>
        {lede || "You're not alone. These resources are available 24/7."}
      </Text>

      {resources && resources.length > 0 ? (
        <>
          {/* THE LIST THE SPOKEN REPLY CARRIED (M2 mics). Each entry's links
              were checked in utils/micResources.ts: only a dialable number
              calls or texts, only an https URL opens. */}
          {resources.map((r, i) => (
            <View key={`${r.name}-${i}`}>
              <Text style={[styles.localeLabel, i > 0 && styles.localeLabelTop]}>{r.name.toUpperCase()}</Text>
              {r.context ? <Text style={styles.sub}>{r.context}</Text> : null}
              {r.links.length > 0 ? (
                <View style={styles.row}>
                  {r.links.map((l) => (
                    <Pressable
                      key={l.href}
                      onPress={() => open(l.href)}
                      style={styles.btn}
                      accessibilityRole={l.kind === 'web' ? 'link' : 'button'}
                      accessibilityLabel={`${l.label}, ${r.name}`}
                    >
                      <Text style={styles.btnText}>{l.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {r.details.map((d) => <Text key={d} style={styles.sub}>{d}</Text>)}
              {r.hours ? <Text style={styles.sub}>{r.hours}</Text> : null}
            </View>
          ))}
          <Text style={[styles.body, styles.bodyTop]}>{SAFETY_LINES.worriedAboutSomeone}</Text>
          <Text style={[styles.body, styles.bodyTop]}>{SAFETY_LINES.psychosisOrMania}</Text>
        </>
      ) : (
      <>
      <Text style={styles.localeLabel}>UNITED STATES</Text>
      <View style={styles.row}>
        <Pressable onPress={() => open('tel:988')} style={styles.btn} accessibilityLabel="Call 988">
          <Text style={styles.btnText}>Call 988</Text>
        </Pressable>
        <Pressable onPress={() => open('sms:988')} style={styles.btn} accessibilityLabel="Text 988">
          <Text style={styles.btnText}>Text 988</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>Suicide &amp; Crisis Lifeline</Text>
      <Text style={styles.sub}>{SAFETY_LINES.worriedAboutSomeone}</Text>

      <Text style={[styles.localeLabel, styles.localeLabelTop]}>UNITED KINGDOM &amp; IRELAND</Text>
      <View style={styles.row}>
        <Pressable onPress={() => open('tel:116123')} style={styles.btn} accessibilityLabel="Call Samaritans">
          <Text style={styles.btnText}>Call Samaritans</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>116 123</Text>

      <Text style={[styles.localeLabel, styles.localeLabelTop]}>INTERNATIONAL</Text>
      <View style={styles.row}>
        <Pressable onPress={() => open('https://findahelpline.com')} style={styles.btn} accessibilityLabel="Find a helpline">
          <Text style={styles.btnText}>Find a helpline</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>findahelpline.com</Text>

      <Text style={[styles.localeLabel, styles.localeLabelTop]}>DOMESTIC VIOLENCE (US)</Text>
      <View style={styles.row}>
        <Pressable onPress={() => open('tel:18007997233')} style={styles.btn} accessibilityLabel="Call DV Hotline">
          <Text style={styles.btnText}>Call hotline</Text>
        </Pressable>
        <Pressable onPress={() => open('sms:88788?body=START')} style={styles.btn} accessibilityLabel="Text START to 88788">
          <Text style={styles.btnText}>Text START</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>{SAFETY_LINES.domesticViolence}</Text>

      <Text style={[styles.localeLabel, styles.localeLabelTop]}>EATING DISORDERS (US)</Text>
      <View style={styles.row}>
        <Pressable onPress={() => open('tel:18666621235')} style={styles.btn} accessibilityLabel="Call National Alliance for Eating Disorders">
          <Text style={styles.btnText}>Call helpline</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>{SAFETY_LINES.eating}</Text>

      <Text style={[styles.body, styles.bodyTop]}>{SAFETY_LINES.psychosisOrMania}</Text>

      <Text style={[styles.localeLabel, styles.localeLabelTop]}>EMERGENCY</Text>
      <Text style={styles.body}>
        For immediate danger, call your local emergency number (911 in the US,
        999 in the UK, 112 in much of Europe).
      </Text>
      </>
      )}

      <Text style={[styles.localeLabel, styles.localeLabelTop]}>A NOTE</Text>
      <Text style={styles.body}>
        Inner Map is a reflection tool, not a crisis service. If you need
        real-time help, please use the resources above. The AI here can't
        replace a human in a moment like that.
      </Text>
    </View>
  );
}

export function CrisisResourcesCard({
  asModal = false, visible, onClose, header, lede, resources,
}: Props) {
  if (!asModal) {
    return <CrisisResourcesContent header={header} lede={lede} resources={resources} />;
  }
  return (
    <Modal
      visible={!!visible}
      animationType="fade"
      transparent={false}
      onRequestClose={() => onClose?.()}
    >
      <SafeAreaView style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Pressable
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onClose?.(); }}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityLabel="Close crisis resources"
          >
            <Ionicons name="close" size={24} color={colors.cream} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.modalScroll}
          showsVerticalScrollIndicator={false}
        >
          <CrisisResourcesContent header={header} lede={lede} resources={resources} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.4)',
    backgroundColor: 'rgba(230,180,122,0.06)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  title: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 1.8,
    marginBottom: spacing.xs,
  },
  lede: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  localeLabel: {
    color: colors.creamFaint,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: spacing.xs,
  },
  localeLabelTop: {
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: 4,
  },
  btn: {
    flex: 1,
    backgroundColor: colors.amber,
    paddingVertical: 12,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.8,
  },
  sub: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  // The psychosis/mania line sits apart from the eating section above it.
  bodyTop: { marginTop: spacing.md },
  body: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  closeBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  modalScroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
});
