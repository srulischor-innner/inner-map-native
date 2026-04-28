// Plain-text export of a session — used by the share buttons on both the
// end-of-session SummaryModal and the journal/history SessionDetailModal.
//
// The format is deliberately simple so it can be pasted into Notes,
// emailed to a therapist, or saved as plaintext without losing structure.

import { Share } from 'react-native';

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

  const transcript = (args.messages || [])
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
