// THE POLICY CHANGED — said in-app, before they continue (policy finding F2,
// 2026-11-09).
//
// The Terms say: "For material changes, we will provide notice in-app before
// the change takes effect." The app had no such notice, and its privacy
// summary still said the policy was last updated July 3, 2026, four weeks
// after counsel's 13 October rewrite.
//
// Shown to anyone who accepted the terms under an earlier version
// (services/onboarding.ts policyNoticeDue), over everything, once the app is
// unlocked.
//
// CONTINUE IS ACCEPTANCE (founder ruling 2026-11-09: "The policy "Continue" is
// stored as acceptance."). The tap closes the notice at once and never blocks
// the app; acceptPolicyFromNotice then POSTs /api/terms/accept with the
// current version and retries. Only when the server answers that it STORED
// that version is the acceptance kept on the device (markPolicyAccepted),
// which is the one thing that stops the notice. If every try fails, nothing
// is kept and the notice comes back on the next launch.
//
// The date it names is LEGAL_POLICY_CHANGED_ON, the last MATERIAL change, not
// the documents' Last Updated date: a re-dating for corrections (9 November
// 2026) re-prompts nobody.

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';
import { LEGAL_POLICY_CHANGED_ON, LEGAL_POLICY_VERSION, PRIVACY_POLICY_URL, openLegalDoc } from '../../utils/legalDocs';
import { api } from '../../services/api';
import { markPolicyAccepted } from '../../services/onboarding';

export const POLICY_NOTICE_SENTENCE =
  `Our Privacy Policy and Terms of Service were updated on ${LEGAL_POLICY_CHANGED_ON}.`;
export const POLICY_NOTICE_LINK = 'Read the Privacy Policy';

// Three tries in the background: at once, then after 3 s, then after 15 s.
// Past that the launch's chance is spent; the next launch shows the notice
// again, because nothing was kept.
export const POLICY_ACCEPT_RETRY_MS = [0, 3_000, 15_000];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Continue on the notice: store it as acceptance of the current policy
 *  version on the server, and only then on the device. Resolves true once
 *  the server has stored it; false when every try failed (nothing stored on
 *  the device, so the notice is due again next launch). Never throws. */
export async function acceptPolicyFromNotice(
  version: string = LEGAL_POLICY_VERSION,
  delays: number[] = POLICY_ACCEPT_RETRY_MS,
): Promise<boolean> {
  for (const ms of delays) {
    if (ms > 0) await wait(ms);
    let stored = false;
    try { stored = await api.acceptPolicyVersion(version); } catch { stored = false; }
    if (stored) {
      await markPolicyAccepted(version);
      return true;
    }
  }
  console.warn('[policy] the notice\'s acceptance was not stored; it will show again next launch');
  return false;
}

export function PolicyUpdateNotice({ visible, onContinue }: { visible: boolean; onContinue: () => void }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android back does not dismiss it: the notice comes before continuing.
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.sentence}>{POLICY_NOTICE_SENTENCE}</Text>
          <Pressable
            onPress={() => openLegalDoc(PRIVACY_POLICY_URL)}
            accessibilityRole="link"
            hitSlop={8}
            style={styles.linkWrap}
          >
            <Text style={styles.link}>{POLICY_NOTICE_LINK}</Text>
          </Pressable>
          <Pressable
            onPress={onContinue}
            accessibilityRole="button"
            style={styles.continueBtn}
          >
            <Text style={styles.continueText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.25)',
    padding: spacing.lg,
  },
  sentence: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 24,
  },
  linkWrap: { marginTop: spacing.md, alignSelf: 'flex-start' },
  link: {
    color: colors.amber,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  continueBtn: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.55)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  continueText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 1.4,
  },
});
