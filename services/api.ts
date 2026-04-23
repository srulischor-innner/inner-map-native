// API client — thin wrapper around the Railway backend. Every outbound fetch goes
// through apiFetch() so we get consistent logging (URL, status, elapsed ms, body
// preview on failure). When a call fails the screen caller still gets `null` or
// similar — but the console shows the exact reason, which is what was missing
// before.
//
// Native sends the user id via `X-User-Id` header (web uses a same-named cookie).
//
// streamChat() consumes the server's SSE format:
//   data: {"type":"delta","text":"..."}
//   data: {"type":"done","text":"<full cleaned text>"}
//   data: {"type":"error","error":"..."}

import Constants from 'expo-constants';
import { getUserId } from './user';

const BASE_URL: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ||
  'https://inner-map-production.up.railway.app';

// One-time boot log so we can see the resolved URL in the Metro console. If this
// ever prints something unexpected, that alone explains why every call is failing.
console.log('[api] BASE_URL =', BASE_URL);

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

async function authHeaders(): Promise<Record<string, string>> {
  const userId = await getUserId();
  return {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  };
}

// ============================================================================
// Instrumented fetch wrapper. Everything goes through here so we get a single
// consistent log line per request.
// ============================================================================
type ApiFetchOpts = RequestInit & {
  label: string;                // what the caller calls it, e.g. "chat" or "journey"
  timeoutMs?: number;           // defaults to 25s — chat streams can be long
  expectStream?: boolean;       // if true, don't try to read the body on error
};

async function apiFetch(path: string, opts: ApiFetchOpts): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const t0 = Date.now();
  const ctl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 25000;
  const timer = setTimeout(() => {
    console.warn(`[api] ${opts.label} → ABORTING after ${timeoutMs}ms @ ${url}`);
    ctl.abort();
  }, timeoutMs);
  console.log(`[api] ${opts.label} → ${opts.method || 'GET'} ${url}`);
  try {
    const res = await fetch(url, { ...opts, signal: opts.signal || ctl.signal });
    const ms = Date.now() - t0;
    if (!res.ok) {
      // Don't consume the body if the caller wants to stream — just log status.
      let bodyPreview = '';
      if (!opts.expectStream) {
        try {
          bodyPreview = (await res.clone().text()).slice(0, 200);
        } catch { /* ignore */ }
      }
      console.warn(`[api] ${opts.label} ✗ ${res.status} in ${ms}ms ${bodyPreview ? '— ' + bodyPreview : ''}`);
    } else {
      console.log(`[api] ${opts.label} ✓ ${res.status} in ${ms}ms`);
    }
    return res;
  } catch (e) {
    const ms = Date.now() - t0;
    const err = e as Error;
    console.warn(`[api] ${opts.label} ✗ THREW in ${ms}ms — ${err?.name}: ${err?.message}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export type StreamCallbacks = {
  onDelta: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
};

export const api = {
  baseUrl: BASE_URL,

  /** Quick health ping — useful from dev screens to confirm the tunnel works. */
  async ping(): Promise<{ ok: boolean; ms: number; status?: number; error?: string }> {
    const t0 = Date.now();
    try {
      const res = await apiFetch('/api/health', { label: 'health', method: 'GET', timeoutMs: 8000 });
      return { ok: res.ok, ms: Date.now() - t0, status: res.status };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: (e as Error)?.message || 'unknown' };
    }
  },

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
        const res = await apiFetch('/api/chat', {
          label: 'chat', method: 'POST', headers, body,
          signal: controller.signal, timeoutMs: 60000, expectStream: true,
        });
        if (!res.ok) {
          cb.onError(`chat ${res.status}`);
          return;
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
          // Server fell back to plain JSON — deliver as one delta.
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
            } catch { /* incomplete JSON */ }
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
      const res = await apiFetch('/api/returning-greeting', { label: 'returning-greeting', headers });
      if (!res.ok) return null;
      const j: any = await res.json();
      return (j && (j.greeting || j.text)) || null;
    } catch { return null; }
  },

  async getJourney(): Promise<any | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/journey', { label: 'journey', headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async getSession(id: string): Promise<any | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { label: 'session', headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async listSessions(): Promise<any[]> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/sessions', { label: 'sessions', headers });
      if (!res.ok) return [];
      const j: any = await res.json();
      return Array.isArray(j) ? j : j?.sessions || [];
    } catch { return []; }
  },

  async getLatestMap(): Promise<any | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/latest-map', { label: 'latest-map', headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async saveSession(payload: Record<string, any>): Promise<void> {
    try {
      const headers = await authHeaders();
      await apiFetch('/api/sessions', {
        label: 'save-session', method: 'POST', headers,
        body: JSON.stringify(payload),
      });
    } catch {}
  },

  async postIntake(payload: Record<string, any>): Promise<boolean> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/intake', {
        label: 'intake', method: 'POST', headers,
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch { return false; }
  },

  async acceptTerms(): Promise<boolean> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/terms/accept', { label: 'terms-accept', method: 'POST', headers });
      return res.ok;
    } catch { return false; }
  },

  async speak(text: string): Promise<ArrayBuffer | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/speak', {
        label: 'speak', method: 'POST', headers,
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch { return null; }
  },

  async transcribe(uri: string, mime: string): Promise<string | null> {
    try {
      const userId = await getUserId();
      // Read the local recording file. RN's fetch supports file:// URIs on both
      // iOS and Android; the Blob API is also native. If this ever fails we'll
      // see the apiFetch log entry for /api/transcribe not firing.
      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      const up = await apiFetch('/api/transcribe', {
        label: 'transcribe', method: 'POST',
        headers: { 'Content-Type': mime, 'X-User-Id': userId },
        body: blob as any,
        timeoutMs: 30000,
      });
      if (!up.ok) return null;
      const j: any = await up.json();
      return (j && (j.text || j.transcript)) || null;
    } catch (e) {
      console.warn('[transcribe] failed:', (e as Error)?.message);
      return null;
    }
  },
};
