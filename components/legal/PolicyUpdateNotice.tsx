// THE POLICY CHANGED — said in-app, before they continue (policy finding F2,
// 2026-11-09).
//
// The Terms say: "For material changes, we will provide notice in-app before
// the change takes effect." The app had no such notice, and its privacy
// summary still said the policy was last updated July 3, 2026, four weeks
// after counsel's 13 October rewrite.
//
// Shown once per policy version, over everything, to anyone who accepted the
// terms under an earlier version (services/onboarding.ts policyNoticeDue). It
// is a NOTICE, not a new acceptance: Continue records that they saw it
// (markPolicyNoticeSeen) and leaves the accepted version as it was.
//
// COPY: one plain sentence and the link, nothing more, because the founder is
// doing the wording pass. MICROCOPY — the founder's to word.

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';
import { LEGAL_DOCS_LAST_UPDATED, PRIVACY_POLICY_URL, openLegalDoc } from '../../utils/legalDocs';

export const POLICY_NOTICE_SENTENCE =
  `Our Privacy Policy and Terms of Service were updated on ${LEGAL_DOCS_LAST_UPDATED}.`;
export const POLICY_NOTICE_LINK = 'Read the Privacy Policy';

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
