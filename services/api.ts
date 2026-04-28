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

  /** POST /api/chat — non-streaming on native. We used to ask the server for SSE
   *  (`stream:true`) but React Native Hermes doesn't reliably expose
   *  `response.body.getReader()` for POST responses, which made every chat turn
   *  fail with "streaming not supported". Native now requests a plain JSON reply
   *  and delivers it as a single delta; the screen's word-by-word reveal runs
   *  client-side so the UX is identical. Keep the StreamCallbacks shape so callers
   *  don't have to change. */
  async streamChat(
    params: {
      messages: ChatMessage[];
      mode?: 'onboarding' | 'ongoing';
      sessionId: string;
      wasInterrupted?: boolean;
      selfMode?: boolean;
      experienceLevel?: 'curious' | 'familiar' | 'experienced';
    },
    cb: StreamCallbacks,
  ): Promise<() => void> {
    const controller = new AbortController();
    const headers = await authHeaders();
    const bodyObj: any = {
      messages: params.messages,
      mode: params.mode || 'onboarding',
      sessionId: params.sessionId,
      stream: false,
      wasInterrupted: !!params.wasInterrupted,
    };
    if (params.selfMode) bodyObj.selfMode = true;
    if (params.experienceLevel) bodyObj.experienceLevel = params.experienceLevel;
    console.log(
      `[chat] sending mode=${bodyObj.mode} msgCount=${params.messages.length} lastRole=${params.messages[params.messages.length - 1]?.role}`,
    );

    (async () => {
      try {
        const res = await apiFetch('/api/chat', {
          label: 'chat', method: 'POST', headers, body: JSON.stringify(bodyObj),
          signal: controller.signal, timeoutMs: 60000,
        });
        if (!res.ok) {
          // apiFetch already logged the body preview on non-OK; still surface the
          // status here so the error reaching the screen is specific.
          cb.onError(`chat ${res.status}`);
          return;
        }
        // Some server errors still come back as 200 with a text/event-stream body
        // containing a data:{"type":"error",...} frame — handle that defensively.
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
          const raw = await res.text();
          // Parse all SSE frames; find the done/error events and the final text.
          let fullText = '';
          let serverError: string | null = null;
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'delta' && typeof evt.text === 'string') fullText += evt.text;
              else if (evt.type === 'done') fullText = evt.text || fullText;
              else if (evt.type === 'error') serverError = evt.error || 'unknown error';
            } catch { /* skip */ }
          }
          if (serverError) { cb.onError(serverError); return; }
          if (fullText) { cb.onDelta(fullText); cb.onDone(fullText); return; }
          cb.onError('empty reply');
          return;
        }
        // Normal JSON path — server returns { reply: "..." }.
        const j: any = await res.json().catch(() => null);
        const reply = (j && (j.reply || j.text)) || '';
        if (!reply) {
          cb.onError(j?.error || 'empty reply');
          return;
        }
        cb.onDelta(reply);
        cb.onDone(reply);
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return;
        cb.onError((e as Error)?.message || 'network error');
      }
    })();

    return () => controller.abort();
  },

  /** GET /api/intake — returns the user's stored intake JSON (name, age, etc).
   *  Returns null if the user hasn't completed intake or the field is missing. */
  async getIntake(): Promise<{
    name?: string; age?: number; gender?: string;
    relationship?: string; profession?: string;
    goals?: string[]; goalsOther?: string; freeText?: string;
  } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/intake', { label: 'intake-get', headers });
      if (!res.ok) return null;
      const j: any = await res.json();
      return (j && (j.intake || j)) || null;
    } catch { return null; }
  },

  async getReturningGreeting(): Promise<{ greeting: string | null; suggestions: string[] }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/returning-greeting', { label: 'returning-greeting', headers });
      if (!res.ok) return { greeting: null, suggestions: [] };
      const j: any = await res.json();
      const greeting = (j && (j.greeting || j.text)) || null;
      const suggestions = Array.isArray(j?.suggestions)
        ? j.suggestions.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 3)
        : [];
      return { greeting, suggestions };
    } catch { return { greeting: null, suggestions: [] }; }
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

  /** /api/parts — list of all parts (category + per-part fields like
   *  corePhrase, howItShowsUp, whatItWants, originStory, bodyLocation, etc).
   *  Powers the map folder's per-part section content. */
  async getParts(): Promise<any[]> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/parts', { label: 'parts', headers });
      if (!res.ok) return [];
      const j: any = await res.json();
      return Array.isArray(j) ? j : j?.parts || [];
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

  /** Persist a session's messages + map data to the server. Returns true on
   *  success so the caller can log / retry. Was silently swallowing errors;
   *  now surfaces them via apiFetch's standard logs AND adds an explicit
   *  pass/fail line with the session id + message count so save-or-not is
   *  unambiguous in Metro. */
  async saveSession(payload: Record<string, any>): Promise<boolean> {
    try {
      const headers = await authHeaders();
      const msgCount = Array.isArray(payload?.messages) ? payload.messages.length : 0;
      console.log(`[session-save] → id=${String(payload?.id).slice(0, 8)} msgs=${msgCount}`);
      const res = await apiFetch('/api/sessions', {
        label: 'save-session', method: 'POST', headers,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        console.log(`[session-save] ✓ server accepted id=${String(payload?.id).slice(0, 8)}`);
        return true;
      }
      console.warn(`[session-save] ✗ server returned ${res.status}`);
      return false;
    } catch (e) {
      console.warn('[session-save] ✗ threw:', (e as Error)?.message);
      return false;
    }
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

  /** POST /api/session-summary — returns the structured 3-part summary
   *  used by the native end-of-session screen. The server also persists
   *  it onto the session row so the Journal tab can render the preview
   *  later. Returns null on transport failure; returns the object with
   *  blank strings (and `fallback: true`) on a soft server fallback. */
  async getSessionSummary(messages: ChatMessage[], sessionId: string): Promise<{
    exploredText: string;
    mapShowingText: string;
    somethingToTryText: string;
    fallback?: boolean;
  } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/session-summary', {
        label: 'session-summary',
        method: 'POST',
        headers,
        body: JSON.stringify({ messages, sessionId }),
        timeoutMs: 60000,
      });
      if (!res.ok) return null;
      const j: any = await res.json();
      if (!j || typeof j !== 'object') return null;
      return {
        exploredText: String(j.exploredText || ''),
        mapShowingText: String(j.mapShowingText || ''),
        somethingToTryText: String(j.somethingToTryText || ''),
        fallback: !!j.fallback,
      };
    } catch (e) {
      console.warn('[session-summary] fetch failed:', (e as Error)?.message);
      return null;
    }
  },

  /** POST /api/guide-chat — educational chat (the Guide tab's Ask pill).
   *  Independent of /api/chat: no markers, no DB writes, no session memory,
   *  no spectrum updates. Returns the reply text or null on failure. */
  async askGuide(messages: ChatMessage[]): Promise<string | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/guide-chat', {
        label: 'guide-chat', method: 'POST', headers,
        body: JSON.stringify({ messages }),
        timeoutMs: 60000,
      });
      if (!res.ok) return null;
      const j: any = await res.json().catch(() => null);
      const reply = (j && (j.reply || j.text)) || '';
      return reply || null;
    } catch (e) {
      console.warn('[guide-chat] failed:', (e as Error)?.message);
      return null;
    }
  },

  async speak(text: string, opts?: { mapVoice?: boolean }): Promise<ArrayBuffer | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/speak', {
        label: 'speak', method: 'POST', headers,
        body: JSON.stringify({ text, mapVoice: !!opts?.mapVoice }),
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
