// Plain-text export of a session — used by the share buttons on both the
// end-of-session SummaryModal and the journal/history SessionDetailModal.
//
// The format is deliberately simple so it can be pasted into Notes,
// emailed to a therapist, or saved as plaintext without losing structure.

import { Alert, Share } from 'react-native';

export type ExportMessage = {
  role: 'user' | 'assistant';
  text: string;          // already marker-stripped
};

export type ExportSummary = {
  exploredText?: string | null;
  mapShowingText?: string | null;
  somethingToTryText?: string | null;
};

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━';

function fmtSection(label: string, text?: string | null): string {
  const t = (text || '').trim();
  if (!t) return '';
  return `${label}\n${t}`;
}

export function buildSessionExport(args: {
  date?: Date;
  summary?: ExportSummary | null;
  messages?: ExportMessage[];
  /** Founder ruling 2026-08-21k: the transcript is now OPT-IN at the
   *  share sheet, because one tap used to send the whole conversation
   *  from a screen that had just said "Session reflection". Defaults to
   *  true so existing callers keep their behaviour until they ask. */
  includeTranscript?: boolean;
}): string {
  const date = args.date || new Date();
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const summarySections = [
    fmtSection('WHAT WE EXPLORED', args.summary?.exploredText),
    fmtSection('WHAT THE MAP IS SHOWING', args.summary?.mapShowingText),
    fmtSection('SOMETHING TO TRY', args.summary?.somethingToTryText),
  ].filter(Boolean).join('\n\n');

  const wantsTranscript = args.includeTranscript !== false;
  const transcript = (wantsTranscript ? (args.messages || []) : [])
    .filter((m) => m.text && m.text.trim())
    .map((m) => `${m.role === 'user' ? 'You' : 'Inner Map'}: ${m.text.trim()}`)
    .join('\n\n');

  const parts: string[] = [
    'INNER MAP — SESSION SUMMARY',
    dateStr,
    RULE,
  ];
  if (summarySections) parts.push(summarySections, RULE);
  if (transcript) parts.push('CONVERSATION', '', transcript, RULE);
  parts.push('Shared from Inner Map');
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function shareSessionText(text: string): Promise<void> {
  try {
    await Share.share({ message: text, title: 'Inner Map Session' });
  } catch (e) {
    console.warn('[share] failed:', (e as Error)?.message);
  }
}

// ============================================================================
// THE SHARE CONFIRM (founder ruling 2026-08-21k). Sharing used to be one tap
// from a small glyph, and what left the device was the summary AND every turn
// of the conversation. The mechanism is unchanged — the OS sheet, no server,
// no URL — but the person now learns what they are sending BEFORE they send
// it, and can send the reflection alone.
// ============================================================================
export type ShareChoice = 'everything' | 'summary-only' | 'cancel';

export function confirmSessionShare(hasTranscript: boolean): Promise<ShareChoice> {
  if (!hasTranscript) return Promise.resolve('summary-only');
  return new Promise((resolve) => {
    Alert.alert(
      'Share this session?',
      "This includes your full conversation, not just the reflection above. It'll go wherever you choose next — Messages, Notes, email.",
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
        { text: 'Just the reflection', onPress: () => resolve('summary-only') },
        { text: 'Share everything', onPress: () => resolve('everything') },
      ],
      { cancelable: true, onDismiss: () => resolve('cancel') },
    );
  });
}

// The reading has no separable part — it is one document or nothing — so its
// confirm carries a single affirmative.
export function confirmReadingShare(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Forward your reading?',
      "It's the whole document — everything on your map, read as one thing. It'll go wherever you choose next.",
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Forward', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export async function shareReadingText(text: string): Promise<void> {
  try {
    await Share.share({ message: text, title: 'Inner Map — Your reading' });
  } catch (e) {
    console.warn('[share] reading share failed:', (e as Error)?.message);
  }
}
