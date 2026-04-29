// Map-tab voice conversation history. Held at module scope so it
// survives MapVoiceButton's mount/unmount lifecycle (the user can
// switch away from the Map tab and come back without losing the
// thread). Cleared explicitly on:
//   - end-session (handleEndSession in app/(tabs)/index.tsx)
//   - sessionId change in the chat tab (a fresh chat session means
//     the map voice should also start clean)
//
// NOT cleared on:
//   - tab switches
//   - MapVoiceButton remounts
//   - app backgrounding
// Therapeutic conversations are continuous; truncating mid-session
// or losing context across tab nav makes the AI clinically useless.

import type { ChatMessage } from './api';

let history: ChatMessage[] = [];
type Listener = (h: ChatMessage[]) => void;
const listeners = new Set<Listener>();

export function getMapVoiceHistory(): ChatMessage[] {
  return history;
}

export function appendMapVoiceTurn(role: 'user' | 'assistant', content: string): void {
  const trimmed = (content || '').trim();
  if (!trimmed) return;
  history.push({ role, content: trimmed });
  console.log('[map-voice-history] append', role, '— length now:', history.length, 'turns');
  for (const l of listeners) l(history);
}

export function clearMapVoiceHistory(): void {
  if (history.length === 0) return;
  history = [];
  console.log('[map-voice-history] cleared');
  for (const l of listeners) l(history);
}

export function subscribeMapVoiceHistory(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
