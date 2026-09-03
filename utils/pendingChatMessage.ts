// Small handoff module for cross-tab "send this message in chat as me"
// flows (polish round 8 Phase 2). A one-shot flag pattern:
// arm from one tab → consume on the next chat-tab mount → one-shot.
//
// Today's caller: the part folder's "Establish your belief" button arms a
// pre-filled message asking for belief work, plus the mode the conversation
// should be in when it arrives.
//
// That mode is 'differentiation' as of 2026-09-03 (founder ruling: creating a
// belief is Leading it's work; working with one that already exists is
// Explore's). It pointed at 'explore' for months — the mode that READS a belief
// — to do the work of building one.
//
// The handoff is held at module scope (in-memory) — no AsyncStorage —
// because we always navigate immediately after arming. If the user
// kills the app between arm + consume the prefill is dropped, which
// is the safer failure mode than a stale message firing on a future
// launch.

// WIDENED 2026-09-03. This was `'process' | 'explore'` — the legacy WIRE
// vocabulary — which could not even express 'light' or 'differentiation'. The
// app's real axis is WorkingMode, so the handoff now speaks it and the consumer
// converts for the wire, rather than the handoff being unable to say what it
// means.
export type { WorkingMode } from '../components/WorkingModeControl';
import type { WorkingMode as WM } from '../components/WorkingModeControl';
export type ChatMode = WM;

type Pending = {
  text: string;
  mode: ChatMode;
} | null;

let pending: Pending = null;

/** Arm a pre-filled chat message + target mode. The next chat-tab
 *  mount that calls consumePendingChatMessage() reads + clears this. */
export function armPendingChatMessage(text: string, mode: ChatMode = 'explore'): void {
  if (!text || !text.trim()) return;
  pending = { text: text.trim(), mode };
}

/** Read-and-consume — returns the armed prefill or null. The next
 *  read returns null until armPendingChatMessage() is called again. */
export function consumePendingChatMessage(): Pending {
  const v = pending;
  pending = null;
  return v;
}

/** Non-destructive peek for debugging / dev tooling. */
export function peekPendingChatMessage(): Pending {
  return pending;
}
