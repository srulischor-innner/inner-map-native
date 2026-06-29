// Cross-tab handoff for "reopen this past session and continue it" —
// mirrors utils/pendingChatMessage. A one-shot, module-scope flag: the
// SessionDetailModal "Continue this conversation" button arms it, and the
// chat tab consumes it on the next focus, hydrating the matching
// Process/Explore thread and pointing sessionIdRef at the reopened row.
//
// Held in memory (no AsyncStorage) because we navigate to the chat tab
// immediately after arming. If the app is killed between arm + consume the
// resume is dropped — the safer failure (a stale resume firing on a future
// launch would silently reopen the wrong conversation).

import type { ChatMode } from './pendingChatMessage';

export type ResumeMessage = { role: 'user' | 'assistant'; content: string };

export type PendingResume = {
  /** The id of the past session to continue writing into (append-in-place). */
  sessionId: string;
  /** Prior transcript in wire format. Already marker-stripped (sessions
   *  store the cleaned text), so it hydrates both the bubble list and the
   *  history ref without further processing. Empty turns are pre-filtered. */
  messages: ResumeMessage[];
  /** The mode the session was last saved in. The resumed session is LOCKED
   *  to this mode — switching modes mints a fresh conversation so the other
   *  thread can never clobber the reopened row. Callers pass a concrete
   *  mode ('process' for legacy/NULL rows). */
  mode: ChatMode;
} | null;

let pending: PendingResume = null;

/** Arm a session resume. The next chat-tab focus consumes + clears it. */
export function armPendingSessionResume(r: NonNullable<PendingResume>): void {
  if (!r || !r.sessionId || !Array.isArray(r.messages)) return;
  pending = r;
}

/** Read-and-consume — returns the armed resume or null, then clears it. */
export function consumePendingSessionResume(): PendingResume {
  const v = pending;
  pending = null;
  return v;
}

/** Non-destructive peek for debugging / dev tooling. */
export function peekPendingSessionResume(): PendingResume {
  return pending;
}
