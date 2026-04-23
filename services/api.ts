// API client — thin wrapper around the Railway backend. The web app and this native
// client hit the exact same endpoints; only difference is native sends the user id via
// `X-User-Id` header (web uses a same-named cookie).
//
// streamChat() consumes the server's SSE format:
//   data: {"type":"delta","text":"..."}
//   data: {"type":"done","text":"<full cleaned text>"}
//   data: {"type":"error","error":"..."}
// RN 0.76+ supports response.body.getReader() on Hermes, so we drive the stream
// directly rather than pulling in a library.

import Constants from 'expo-constants';
import { getUserId } from './user';

const BASE_URL: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ||
  'https://inner-map-production.up.railway.app';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

async function authHeaders(): Promise<Record<string, string>> {
  const userId = await getUserId();
  return {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  };
}

export type StreamCallbacks = {
  onDelta: (text: string) => void;                   // fired on every text chunk
  onDone: (fullText: string) => void;                // fired once with the complete cleaned reply
  onError: (message: string) => void;
};

export const api = {
  baseUrl: BASE_URL,

  /**
   * POST /api/chat with SSE streaming. Returns a cancel function.
   */
  async streamChat(
    params: {
      messages: ChatMessage[];
      mode?: 'onboarding' | 'ongoing';
      sessionId: string;
      wasInterrupted?: boolean;
    },
    cb: StreamCallbacks,
  ): Promise<() => void> {
    const controller = new AbortController();
    const headers = await authHeaders();
    const body = JSON.stringify({
      messages: params.messages,
      mode: params.mode || 'onboarding',
      sessionId: params.sessionId,
      stream: true,
      wasInterrupted: !!params.wasInterrupted,
    });

    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/chat`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          cb.onError(`chat ${res.status}`);
          return;
        }
        // If the server fell back to a plain JSON response, handle that path too.
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
          const j = (await res.json().catch(() => null)) as any;
          const reply = (j && (j.reply || j.text)) || '';
          if (reply) { cb.onDelta(reply); cb.onDone(reply); }
          else cb.onError('empty reply');
          return;
        }

        const reader = (res.body as any)?.getReader?.();
        if (!reader) { cb.onError('streaming not supported'); return; }
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'delta' && typeof evt.text === 'string') {
                fullText += evt.text;
                cb.onDelta(evt.text);
              } else if (evt.type === 'done') {
                cb.onDone(evt.text || fullText);
                return;
              } else if (evt.type === 'error') {
                cb.onError(evt.error || 'unknown error');
                return;
              }
            } catch { /* incomplete JSON — wait for more */ }
          }
        }
        cb.onDone(fullText);
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return;
        cb.onError((e as Error)?.message || 'network error');
      }
    })();

    return () => controller.abort();
  },

  async getReturningGreeting(): Promise<string | null> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/returning-greeting`, { headers });
      if (!res.ok) return null;
      const j: any = await res.json();
      return (j && (j.greeting || j.text)) || null;
    } catch { return null; }
  },

  /** Journey data — active parts, clinical patterns, session list. Server does all the
   *  aggregation; we just render. */
  async getJourney(): Promise<any | null> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/journey`, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  /** Full session payload including transcript, partDetections, etc. */
  async getSession(id: string): Promise<any | null> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/sessions/${encodeURIComponent(id)}`, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  /** Session list — id, date, time, preview, hasMap, messageCount. */
  async listSessions(): Promise<any[]> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/sessions`, { headers });
      if (!res.ok) return [];
      const j: any = await res.json();
      return Array.isArray(j) ? j : j?.sessions || [];
    } catch { return []; }
  },

  async getLatestMap(): Promise<any | null> {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/latest-map`, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async saveSession(payload: Record<string, any>): Promise<void> {
    try {
      const headers = await authHeaders();
      await fetch(`${BASE_URL}/api/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch {}
  },

  async transcribe(uri: string, mime: string): Promise<string | null> {
    try {
      const userId = await getUserId();
      // Read the recorded file as a binary blob and POST it raw. Server's
      // /api/transcribe accepts any audio/* content-type and forwards to Whisper.
      const res = await fetch(uri);
      const blob = await res.blob();
      const up = await fetch(`${BASE_URL}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': mime, 'X-User-Id': userId },
        body: blob,
      });
      if (!up.ok) return null;
      const j: any = await up.json();
      return (j && (j.text || j.transcript)) || null;
    } catch (e) {
      console.warn('[transcribe] failed:', (e as Error).message);
      return null;
    }
  },
};
