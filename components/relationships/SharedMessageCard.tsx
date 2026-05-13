// One row in the shared-space dialogue. Two main shapes:
//
//   1. partner_contribution — chat-bubble style with an author
//      attribution (first name or fallback). No response affordance.
//
//   2. AI message (ai_acknowledgment, ai_hunch, ai_observation,
//      ai_question, ai_framework_explanation, ai_moderation) —
//      distinct card style with an amber-bordered "AI" header.
//      Below the body:
//      - If the current user hasn't responded: <ResponseAffordance>
//        with the AI's multiple-choice buttons + Other.
//      - If the current user has responded: their selected option
//        (or "Other" + their text) inline, labeled "Your response".
//      - If the partner has also responded: their response below,
//        labeled "[partner_name]'s response".
//      - If only the user has responded: italic "Waiting for
//        [partner_name]" status under their own response.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import {
  SharedMessage, SharedMessageOption, SharedMessageResponse,
} from '../../services/api';
import { ResponseAffordance } from './ResponseAffordance';

// Kind → display metadata. Drives the small label + icon above each
// AI card so the kind is visible at a glance.
const AI_KIND_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  ai_acknowledgment:        { label: 'AI',                   icon: 'sparkles-outline' },
  ai_hunch:                 { label: 'AI · hunch',           icon: 'help-circle-outline' },
  ai_observation:           { label: 'AI · observation',     icon: 'eye-outline' },
  ai_question:              { label: 'AI · question',        icon: 'chatbubble-ellipses-outline' },
  ai_framework_explanation: { label: 'AI · framework',       icon: 'book-outline' },
  ai_moderation:            { label: 'AI · gentle redirect', icon: 'leaf-outline' },
};

export function SharedMessageCard({
  message,
  relationshipId,
  myUserId,
  myAuthor,
  partnerName,
  onResponded,
}: {
  message: SharedMessage;
  relationshipId: string;
  /** The calling user's id. Used to decide whether each response
   *  in the responses array belongs to them or to the partner. */
  myUserId: string;
  /** 'partner_a' or 'partner_b' — used to label partner contributions
   *  visually. */
  myAuthor: 'partner_a' | 'partner_b';
  /** Partner's first name (if available) for response attribution. */
  partnerName: string | null;
  onResponded: () => void;
}) {
  if (message.kind === 'partner_contribution') {
    return <PartnerContributionCard
      message={message}
      isMine={message.author === myAuthor}
      partnerName={partnerName}
    />;
  }
  return <AiMessageCard
    message={message}
    relationshipId={relationshipId}
    myUserId={myUserId}
    partnerName={partnerName}
    onResponded={onResponded}
  />;
}

function PartnerContributionCard({
  message, isMine, partnerName,
}: {
  message: SharedMessage;
  isMine: boolean;
  partnerName: string | null;
}) {
  const author = isMine ? 'You' : (partnerName || 'Your partner');
  return (
    <View style={[styles.contribWrap, isMine ? styles.contribMineWrap : styles.contribTheirsWrap]}>
      <Text style={[styles.contribAuthor, isMine && styles.contribAuthorMine]}>
        {author}
      </Text>
      <Text style={styles.contribBody}>{message.content}</Text>
    </View>
  );
}

function AiMessageCard({
  message, relationshipId, myUserId, partnerName, onResponded,
}: {
  message: SharedMessage;
  relationshipId: string;
  myUserId: string;
  partnerName: string | null;
  onResponded: () => void;
}) {
  const meta = AI_KIND_META[message.kind] || { label: 'AI', icon: 'sparkles-outline' };
  const isFramework = message.kind === 'ai_framework_explanation';
  const isModeration = message.kind === 'ai_moderation';

  // Find this user's response + the partner's response, if any.
  const myResponse = message.responses.find((r) => r.userId === myUserId) || null;
  const partnerResponse = message.responses.find((r) => r.userId !== myUserId) || null;

  // Display rule: a partner's response is only visible AFTER the
  // current user has submitted their own — prevents performative
  // answering ("waiting to see what they say before I respond").
  const showPartnerResponse = !!myResponse && !!partnerResponse;
  const waitingOnPartner = !!myResponse && !partnerResponse;

  return (
    <View style={[
      styles.aiWrap,
      isFramework && styles.aiWrapFramework,
      isModeration && styles.aiWrapModeration,
    ]}>
      <View style={styles.aiHeader}>
        <Ionicons name={meta.icon} size={14} color={colors.amber} style={styles.aiIcon} />
        <Text style={styles.aiLabel}>{meta.label}</Text>
      </View>
      <Text style={styles.aiBody}>{message.content}</Text>

      {/* Either the affordance (user hasn't responded) or the
          response display (user has responded). Server always
          returns at least the server-appended Other option, so
          message.options.length should be >= 1 on every AI message. */}
      {!myResponse && message.options.length > 0 ? (
        <ResponseAffordance
          relationshipId={relationshipId}
          messageId={message.id}
          options={message.options}
          onResponded={onResponded}
        />
      ) : null}

      {myResponse ? (
        <ResponseDisplay
          response={myResponse}
          options={message.options}
          label="Your response"
          isMine
        />
      ) : null}

      {showPartnerResponse ? (
        <ResponseDisplay
          response={partnerResponse!}
          options={message.options}
          label={`${partnerName || 'Your partner'}'s response`}
          isMine={false}
        />
      ) : null}

      {waitingOnPartner ? (
        <Text style={styles.waitingText}>
          Waiting for {partnerName || 'your partner'}…
        </Text>
      ) : null}
    </View>
  );
}

function ResponseDisplay({
  response, options, label, isMine,
}: {
  response: SharedMessageResponse;
  options: SharedMessageOption[];
  label: string;
  isMine: boolean;
}) {
  const opt = response.optionId
    ? options.find((o) => o.id === response.optionId) || null
    : null;
  const isOther = !!response.otherText;
  return (
    <View style={[styles.respWrap, !isMine && styles.respPartner]}>
      <Text style={[styles.respLabel, !isMine && styles.respLabelPartner]}>{label}</Text>
      {isOther ? (
        <Text style={styles.respOther}>“{response.otherText}”</Text>
      ) : (
        <Text style={styles.respOption}>
          {opt ? opt.label : '(option no longer available)'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Partner-contribution chat bubbles. Same visual language as
  // the regular chat MessageBubble — own messages right-aligned
  // and amber-tinted, partner's messages left-aligned in a
  // dimmer treatment.
  contribWrap: {
    maxWidth: '90%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    marginVertical: 6,
  },
  contribMineWrap: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(230, 180, 122, 0.12)',
    borderColor: 'rgba(230, 180, 122, 0.4)',
    borderWidth: 0.5,
  },
  contribTheirsWrap: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 0.5,
  },
  contribAuthor: {
    color: colors.creamDim,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  contribAuthorMine: { color: colors.amberDim },
  contribBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },

  // AI message card — distinct from chat bubbles by an amber left
  // accent and a small kind-label header.
  aiWrap: {
    alignSelf: 'stretch',
    marginVertical: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(28, 25, 21, 0.7)',
    borderLeftWidth: 2,
    borderLeftColor: colors.amber,
    borderRadius: radii.md,
  },
  // Framework explanations get a subtly different background to
  // signal "this is teaching".
  aiWrapFramework: {
    backgroundColor: 'rgba(230, 180, 122, 0.04)',
  },
  // Moderation messages get a calmer/dimmer treatment.
  aiWrapModeration: {
    borderLeftColor: 'rgba(230, 180, 122, 0.4)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  aiIcon: { marginRight: 6 },
  aiLabel: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  aiBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 23,
  },

  // Response display — mine vs partner's.
  respWrap: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(230, 180, 122, 0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(230, 180, 122, 0.2)',
  },
  respPartner: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  respLabel: {
    color: colors.amberDim,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  respLabelPartner: { color: colors.creamFaint },
  respOption: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 13,
  },
  respOther: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 21,
  },

  waitingText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
  },
});
