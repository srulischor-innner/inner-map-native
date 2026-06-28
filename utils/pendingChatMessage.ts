// Small handoff module for cross-tab "send this message in chat as me"
// flows (polish round 8 Phase 2). A one-shot flag pattern:
// arm from one tab → consume on the next chat-tab mount → one-shot.
//
// Today's caller: the part folder's "Establish belief for this part"
// button arms a pre-filled message asking the AI to do belief work
// for the specific part, plus sets mode='explore' so the chat tab
// switches modes before sending.
//
// The handoff is held at module scope (in-memory) — no AsyncStorage —
// because we always navigate immediately after arming. If the user
// kills the app between arm + consume the prefill is dropped, which
// is the safer failure mode than a stale message firing on a future
// launch.

export type ChatMode = 'process' | 'explore';

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
