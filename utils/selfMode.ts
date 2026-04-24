// Small flag module — set when the user taps "Enter Self mode" on the
// Self folder, read by the Chat screen on its next focus so the next
// conversation is sent with selfMode:true. One-shot: reading the flag
// also consumes it, so backing out of chat and returning doesn't
// re-trigger Self mode.

let pending = false;

/** Arm Self mode for the next chat conversation. Called from
 *  PartFolderModal → onEnterSelfMode → map.tsx router navigation. */
export function armSelfMode() { pending = true; }

/** Read-and-consume. Chat calls this during boot after navigating in;
 *  subsequent reads return false until armSelfMode() is called again. */
export function consumeSelfMode(): boolean {
  const v = pending;
  pending = false;
  return v;
}

/** Non-destructive peek for debugging/logging. */
export function peekSelfMode(): boolean { return pending; }
