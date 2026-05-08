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
      /** When true, server swaps in MAP_VOICE_PROMPT and caps max_tokens
       *  at 150 for snappy spoken replies. */
      mapVoice?: boolean;
      /** Chat tab mode toggle — drives which of the prompt templates
       *  the server selects on /api/chat:
       *    'process'      → HOLDING_SPACE_PROMPT (default, gentle)
       *    'explore'      → MAPPING_PROMPT (active curiosity + mapping)
       *    'relationship' → RELATIONSHIPS_PROMPT (couple-mode, requires
       *                     relationshipId; server assembles a partner-
       *                     context preamble before the prompt body)
       *  Defaults to 'process' on the server when unset. */
      chatMode?: 'process' | 'explore' | 'relationship';
      /** Required when chatMode === 'relationship'. Server validates
       *  membership + status='active' + both intro flags before
       *  letting the chat run. */
      relationshipId?: string;
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
    if (params.mapVoice) bodyObj.mapVoice = true;
    if (params.chatMode) bodyObj.chatMode = params.chatMode;
    if (params.relationshipId) bodyObj.relationshipId = params.relationshipId;
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
      // Cache-busting + no-cache headers — iOS URLCache will return a
      // previously-fetched body without hitting the network if the server
      // sent any Cache-Control directive that allows it. /api/latest-map
      // changes after every assistant turn, so we MUST bypass any cache.
      // The query param breaks URL identity for cache lookup; the headers
      // tell the OS-level cache + any intermediaries (Cloudflare, Railway
      // edge) to revalidate.
      const cacheBust = `?t=${Date.now()}`;
      const res = await apiFetch(`/api/latest-map${cacheBust}`, {
        label: 'latest-map',
        headers: {
          ...headers,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
      // TEMP DEBUG — print the full raw body BEFORE parsing so we can see
      // exactly what the server returned. Diagnoses the regression where
      // /api/debug/identity-check confirms data is present and the deploy
      // is current, but getLatestMap still receives empty arrays. If this
      // log shows non-empty layers but the Map tab still renders empty,
      // the bug is downstream of this function. If this log shows empty
      // layers despite curl returning data for the same userId, the bug
      // is either the X-User-Id header (logged below) or a cache layer.
      console.log(`[latest-map] sent X-User-Id=${headers['X-User-Id']?.slice(0, 8)}…`);
      // Read the body as text first (so we can log it raw) then parse as
      // JSON. Avoids the RN-fetch .clone() gotcha — on some RN builds
      // clone()'s body stream isn't independently readable from the
      // original. One read + JSON.parse is universally safe.
      const text = await res.text();
      console.log(`[latest-map] status=${res.status} bodyLen=${text.length} body="${text.slice(0, 600)}${text.length > 600 ? '…' : ''}"`);
      if (!res.ok) return null;
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        console.warn('[latest-map] JSON parse failed:', (parseErr as Error)?.message);
        return null;
      }
    } catch (e) {
      console.warn('[latest-map] threw:', (e as Error)?.message);
      return null;
    }
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
   *  later. `chatMode` selects between PROCESS (vessel-building practice)
   *  and EXPLORE (things-to-notice awareness) closing prompts on the
   *  server. Returns null on transport failure; returns the object with
   *  blank strings (and `fallback: true`) on a soft server fallback. */
  async getSessionSummary(
    messages: ChatMessage[],
    sessionId: string,
    chatMode?: 'process' | 'explore',
  ): Promise<{
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
        body: JSON.stringify({ messages, sessionId, chatMode }),
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

  /** POST /api/guide-chat — educational chat for the Guide tab Ask
   *  modal. Server streams plain text; we want each delta visible to
   *  the user as it arrives.
   *
   *  We use XMLHttpRequest's `progress` event rather than fetch's
   *  ReadableStream getReader() because RN's fetch polyfill on Hermes
   *  has a known quirk: response.body.getReader() may collect the
   *  whole body before allowing reads, defeating the streaming. XHR's
   *  onprogress fires every time new bytes land on the response and
   *  exposes the cumulative responseText — reliably progressive on
   *  every RN version we support. */
  async streamGuide(
    messages: ChatMessage[],
    cb: {
      onChunk: (text: string) => void;
      onDone: () => void;
      onError: (err: string) => void;
    },
  ): Promise<() => void> {
    const headers = await authHeaders();
    const url = `${BASE_URL}/api/guide-chat`;
    const xhr = new XMLHttpRequest();
    let consumed = 0;          // chars of responseText already passed to onChunk
    let done = false;

    xhr.open('POST', url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

    // onprogress fires whenever new bytes arrive. responseText is the
    // cumulative response so far — slice from `consumed` to get the
    // newly-arrived tail and emit just that as a chunk.
    xhr.onprogress = () => {
      try {
        if (xhr.status && xhr.status >= 400) return;          // onerror handles it
        const txt = xhr.responseText || '';
        if (txt.length > consumed) {
          const tail = txt.slice(consumed);
          consumed = txt.length;
          // Diagnostic: shows up in Metro as one log per progress event.
          // If we only see ONE log with the full message length, the
          // server / proxy is buffering. Many small lines = streaming
          // is working end-to-end.
          console.log('[guide-chat] chunk', tail.length, 'chars:', tail.slice(0, 30).replace(/\n/g, '⏎'));
          if (tail) cb.onChunk(tail);
        }
      } catch (e) {
        console.warn('[guide-chat] onprogress threw:', (e as Error)?.message);
      }
    };

    xhr.onload = () => {
      if (done) return;
      done = true;
      if (xhr.status >= 200 && xhr.status < 300) {
        // Final flush in case the last bytes arrived between the last
        // onprogress and onload.
        const txt = xhr.responseText || '';
        if (txt.length > consumed) {
          cb.onChunk(txt.slice(consumed));
          consumed = txt.length;
        }
        cb.onDone();
      } else {
        const preview = (xhr.responseText || '').slice(0, 200);
        cb.onError(`guide-chat ${xhr.status} ${preview}`);
      }
    };
    xhr.onerror = () => {
      if (done) return;
      done = true;
      cb.onError(xhr.statusText || 'network error');
    };
    xhr.ontimeout = () => {
      if (done) return;
      done = true;
      cb.onError('timeout');
    };

    try {
      xhr.send(JSON.stringify({ messages }));
    } catch (e) {
      cb.onError((e as Error)?.message || 'send failed');
    }

    return () => {
      if (done) return;
      done = true;
      try { xhr.abort(); } catch {}
    };
  },


  /** POST /api/realtime-token — mints an ephemeral session token for the
   *  OpenAI Realtime WebSocket. Pre-fetched while the user is still
   *  speaking on the map voice path so the token is ready by the time
   *  recording stops. Returns null on any failure so the caller can
   *  fall back to the legacy pipeline.
   *
   *  `history` is the FULL map-voice conversation so far — never
   *  truncated client-side. The server includes it in the session's
   *  `instructions` field so the AI has continuity from turn 1, with
   *  smart summarization for very long histories. */
  async realtimeToken(history: ChatMessage[] = []): Promise<string | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/realtime-token', {
        label: 'realtime-token', method: 'POST', headers,
        body: JSON.stringify({ history }),
        timeoutMs: 8000,
      });
      if (!res.ok) {
        console.warn('[realtime-token] non-OK', res.status);
        return null;
      }
      const j: any = await res.json().catch(() => null);
      return (j && j.token) || null;
    } catch (e) {
      console.warn('[realtime-token] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** POST /api/self-voice — generate + speak a personalized message FROM
   *  Self TO the named part. Server pulls the part's markerFields from
   *  the DB, generates an 80-120 word script via Claude, pipes through
   *  tts-1-hd voice="echo", returns audio/mpeg bytes. Used by the
   *  "Hear what Self would say to this part" button in the part folder
   *  modal. Long timeout because the server-side pipeline is Claude
   *  (5-10s) → OpenAI TTS (3-8s). */
  async selfVoice(partId: string): Promise<ArrayBuffer | null> {
    if (!partId) {
      console.warn('[self-voice] skipping — no partId');
      return null;
    }
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/self-voice', {
        label: 'self-voice',
        method: 'POST',
        headers,
        body: JSON.stringify({ partId }),
        timeoutMs: 60000,
      });
      if (!res.ok) {
        let bodyPreview = '';
        try { bodyPreview = (await res.text()).slice(0, 300); } catch {}
        console.warn(`[self-voice] non-OK ${res.status} — body: ${bodyPreview}`);
        return null;
      }
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0) {
        console.warn('[self-voice] empty arrayBuffer despite 200 OK');
        return null;
      }
      console.log('[self-voice] received audio', buf.byteLength, 'bytes');
      return buf;
    } catch (e) {
      console.warn('[self-voice] threw:', (e as Error)?.message);
      return null;
    }
  },

  async speak(text: string, opts?: { mapVoice?: boolean }): Promise<ArrayBuffer | null> {
    // Defensive empty guard — caller should already filter, but if a
    // whitespace-only or marker-only string slips through we don't even
    // bother with the network round-trip; the server would return 400
    // with "no text provided" / "Empty text after scrubbing markers"
    // and the user would see a silent failure.
    const cleanText = (text || '').trim();
    if (!cleanText) {
      console.warn('[speak] skipping — empty text after trim');
      return null;
    }
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/speak', {
        label: 'speak', method: 'POST', headers,
        body: JSON.stringify({ text: cleanText, mapVoice: !!opts?.mapVoice }),
      });
      console.log('[speak] status:', res.status,
        '| content-type:', res.headers.get('content-type'));
      if (!res.ok) {
        // Pull a short preview of the error body so 400s with
        // 'Empty text after scrubbing markers' are visible in Metro
        // instead of just 'returned null'. Also logs the full body
        // when small enough so JSON {error: "..."} responses surface
        // as a single readable line.
        let bodyPreview = '';
        try { bodyPreview = (await res.text()).slice(0, 300); } catch {}
        console.warn(`[speak] non-OK ${res.status} — body: ${bodyPreview}`);
        return null;
      }
      const buf = await res.arrayBuffer();
      console.log('[speak] arrayBuffer bytes:', buf.byteLength);
      if (!buf || buf.byteLength === 0) {
        console.warn('[speak] empty arrayBuffer despite 200 OK');
        return null;
      }
      return buf;
    } catch (e) {
      console.warn('[speak] threw:', (e as Error)?.message);
      return null;
    }
  },

  async transcribe(uri: string, mime: string): Promise<string | null> {
    const t0 = Date.now();
    try {
      const userId = await getUserId();
      // Read the local recording file. RN's fetch supports file:// URIs on both
      // iOS and Android; the Blob API is also native. If this ever fails we'll
      // see the apiFetch log entry for /api/transcribe not firing.
      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      // Diagnostic logging — surface the audio size and MIME so the
      // empty-transcript bug can be triaged. A near-zero size means the
      // recorder produced a silent/empty file (mic permission edge,
      // recorder didn't actually start, etc.); a healthy size with an
      // empty transcript points to a server-side Whisper issue or a
      // codec the API can't decode.
      console.log(`[voice-note] transcribe — uri=${uri.slice(-60)} mime=${mime} blobSize=${blob.size}B`);
      const up = await apiFetch('/api/transcribe', {
        label: 'transcribe', method: 'POST',
        headers: { 'Content-Type': mime, 'X-User-Id': userId },
        body: blob as any,
        timeoutMs: 30000,
      });
      console.log(`[voice-note] transcribe response — status=${up.status} ok=${up.ok} elapsedMs=${Date.now() - t0}`);
      if (!up.ok) {
        const errText = await up.text().catch(() => '(no body)');
        console.warn(`[voice-note] transcribe non-OK body: ${errText.slice(0, 300)}`);
        return null;
      }
      const j: any = await up.json();
      // Log the full response shape — text field state matters for the
      // "empty transcript" bug. Truncate raw to 300 chars in case
      // Whisper sometimes returns long text.
      const textField = j?.text;
      const transcriptField = j?.transcript;
      console.log(
        `[voice-note] transcribe body — keys=[${Object.keys(j || {}).join(',')}]` +
        ` text=${textField === undefined ? '(missing)' : textField === '' ? '(empty)' : `"${String(textField).slice(0, 200)}"`}` +
        ` transcript=${transcriptField === undefined ? '(missing)' : transcriptField === '' ? '(empty)' : `"${String(transcriptField).slice(0, 200)}"`}`,
      );
      return (j && (j.text || j.transcript)) || null;
    } catch (e) {
      console.warn(`[voice-note] transcribe threw: ${(e as Error)?.message} (elapsedMs=${Date.now() - t0})`);
      return null;
    }
  },

  // ===========================================================================
  // RELATIONSHIPS — phase 2 wrappers
  // ===========================================================================

  /** POST /api/relationships/invite. Mints (or reuses) a pending invite for
   *  the calling user. Returns the relationshipId, the 8-char code, the
   *  shareable link, and whether the row was reused vs freshly created. */
  async createRelationshipInvite(): Promise<{
    relationshipId: string;
    inviteCode: string;
    link: string;
    reused: boolean;
  } | { error: string; message?: string }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/relationships/invite', {
        label: 'rel-invite', method: 'POST', headers, body: JSON.stringify({}),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      console.warn('[rel-invite] threw:', (e as Error)?.message);
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** POST /api/relationships/accept. Accepts an invite by code. Server
   *  validates the code, the not-self constraint, and the v1 single-active-
   *  relationship limit. Returns relationshipId + partnerName on success;
   *  on failure returns one of:
   *    'missing-invite-code' | 'invite-not-found' | 'invite-already-used'
   *    | 'invite-already-claimed' | 'cannot-accept-own-invite'
   *    | 'already-in-relationship'
   *  All as plain { error } objects so the screen can branch on them. */
  async acceptRelationshipInvite(inviteCode: string): Promise<
    | { relationshipId: string; partnerName: string | null }
    | { error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/relationships/accept', {
        label: 'rel-accept', method: 'POST', headers,
        body: JSON.stringify({ inviteCode: String(inviteCode || '').trim().toUpperCase() }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      console.warn('[rel-accept] threw:', (e as Error)?.message);
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** GET /api/relationships. Lists relationships the user is part of, each
   *  enriched with myRole / partnerId / partnerName / myIntroDone /
   *  partnerIntroDone for native rendering. safetyFlagged is stripped on the
   *  server. Returns [] on transport failure rather than null so the UI can
   *  uniformly check .length. */
  async listRelationships(): Promise<Array<{
    id: string;
    inviterUserId: string;
    inviteeUserId: string | null;
    inviteCode: string | null;
    status: 'pending' | 'active' | 'paused';
    inviterAcceptedIntro: number;
    inviteeAcceptedIntro: number;
    createdAt: string;
    updatedAt: string;
    link: string | null;
    myRole: 'inviter' | 'invitee';
    partnerId: string | null;
    partnerName: string | null;
    myIntroDone: boolean;
    partnerIntroDone: boolean;
  }>> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/relationships', {
        label: 'rel-list', method: 'GET', headers,
      });
      if (!res.ok) return [];
      const j: any = await res.json();
      return Array.isArray(j?.relationships) ? j.relationships : [];
    } catch (e) {
      console.warn('[rel-list] threw:', (e as Error)?.message);
      return [];
    }
  },

  /** POST /api/relationships/:id/accept-intro. Flips the calling user's
   *  intro flag. Server auto-promotes the row to status='active' the moment
   *  both flags + inviteeUserId are set; that's surfaced as `promoted`. */
  async acceptRelationshipIntro(relationshipId: string): Promise<
    | { relationship: any; promoted: boolean }
    | { error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/relationships/${encodeURIComponent(relationshipId)}/accept-intro`, {
        label: 'rel-accept-intro', method: 'POST', headers, body: JSON.stringify({}),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      console.warn('[rel-accept-intro] threw:', (e as Error)?.message);
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  // ===========================================================================
  // RELATIONSHIPS — phase 6 wrappers (chat history + shared feed)
  // ===========================================================================

  /** GET /api/relationships/:id/messages. Returns the calling partner's
   *  PRIVATE chat history — only their own rows. The other partner's
   *  chat is visible to the AI through the server-side preamble but
   *  never to the calling partner directly. */
  async listRelationshipMessages(relationshipId: string): Promise<Array<{
    id: string; role: 'user' | 'assistant'; content: string; createdAt: string;
  }>> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/relationships/${encodeURIComponent(relationshipId)}/messages`, {
        label: 'rel-messages', method: 'GET', headers,
      });
      if (!res.ok) return [];
      const j: any = await res.json();
      return Array.isArray(j?.messages) ? j.messages : [];
    } catch (e) {
      console.warn('[rel-messages] threw:', (e as Error)?.message);
      return [];
    }
  },

  /** GET /api/relationships/:id/shared. Pulls published shared items
   *  (each hydrated with reactions + comments) plus this user's
   *  pending proposals — proposals from THIS user's chat awaiting
   *  their own approval (scope='this-partner'), or proposals from
   *  EITHER chat awaiting their approval (scope='both-partners'). */
  async listRelationshipShared(relationshipId: string): Promise<{
    sharedItems: Array<{
      id: string; type: string; content: string; publishedAt: string;
      reactions: Array<{ id: string; userId: string; reaction: string; createdAt: string; side: 'inviter' | 'invitee' }>;
      comments:  Array<{ id: string; userId: string; content: string; createdAt: string; side: 'inviter' | 'invitee' }>;
    }>;
    myPendingProposals: Array<{
      id: string; type: string; content: string;
      scope: 'this-partner' | 'both-partners';
      sourceSide: 'inviter' | 'invitee';
      youAreSource: boolean;
      createdAt: string;
    }>;
    meta: { mySide: 'inviter' | 'invitee' };
  } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/relationships/${encodeURIComponent(relationshipId)}/shared`, {
        label: 'rel-shared', method: 'GET', headers,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[rel-shared] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** POST /api/relationships/:id/proposals/:pid/approve. Server flips
   *  the caller's column to 'approved' and auto-promotes the proposal
   *  to a shared item if its scope's threshold is met (this-partner
   *  needs only the source's approval; both-partners needs both). */
  async approveRelationshipProposal(relationshipId: string, proposalId: string): Promise<
    | { approved: boolean; promoted: boolean; sharedItemId: string | null; already?: boolean }
    | { error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/proposals/${encodeURIComponent(proposalId)}/approve`,
        { label: 'rel-proposal-approve', method: 'POST', headers, body: JSON.stringify({}) },
      );
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** POST /api/relationships/:id/proposals/:pid/reject. Marks the
   *  caller's column as 'rejected'. Proposal stays in the table for
   *  audit but can never promote. */
  async rejectRelationshipProposal(relationshipId: string, proposalId: string): Promise<
    | { rejected: boolean }
    | { error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/proposals/${encodeURIComponent(proposalId)}/reject`,
        { label: 'rel-proposal-reject', method: 'POST', headers, body: JSON.stringify({}) },
      );
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** POST /api/relationships/:id/shared/:sid/react. Server enforces
   *  toggle semantics — passing the same reaction the user already
   *  has clears it; passing null clears explicitly; passing a
   *  different one replaces. */
  async reactToSharedItem(
    relationshipId: string,
    sharedItemId: string,
    reaction: 'resonates' | 'unsure' | 'doesnt-fit' | null,
  ): Promise<{ reaction: 'resonates' | 'unsure' | 'doesnt-fit' | null } | { error: string; message?: string }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/shared/${encodeURIComponent(sharedItemId)}/react`,
        { label: 'rel-shared-react', method: 'POST', headers, body: JSON.stringify({ reaction }) },
      );
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** GET /api/relationships/:id/map. Returns the two-triangle visual
   *  data: each partner's wound / fixer / skeptic / self-like content
   *  (each { text, confirmed }), plus the shared-wound state (active
   *  flag + content). Returns null on transport failure. */
  async getRelationshipMap(relationshipId: string): Promise<{
    relationshipId: string;
    mySide: 'inviter' | 'invitee';
    partnerName: string | null;
    me: {
      wound:    { text: string | null; confirmed: boolean };
      fixer:    { text: string | null; confirmed: boolean };
      skeptic:  { text: string | null; confirmed: boolean };
      selfLike: { text: string | null; confirmed: boolean };
    };
    partner: {
      wound:    { text: string | null; confirmed: boolean };
      fixer:    { text: string | null; confirmed: boolean };
      skeptic:  { text: string | null; confirmed: boolean };
      selfLike: { text: string | null; confirmed: boolean };
    };
    sharedWound: { active: boolean; content: string | null };
  } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/relationships/${encodeURIComponent(relationshipId)}/map`, {
        label: 'rel-map', method: 'GET', headers,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[rel-map] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** POST /api/relationships/:id/shared/:sid/comment. Server caps at
   *  500 chars and 400's longer payloads — UI should mirror the cap. */
  async commentOnSharedItem(
    relationshipId: string,
    sharedItemId: string,
    content: string,
  ): Promise<
    | { comment: { id: string; content: string; createdAt: string; userId: string; side: 'inviter' | 'invitee' } }
    | { error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/shared/${encodeURIComponent(sharedItemId)}/comment`,
        { label: 'rel-shared-comment', method: 'POST', headers, body: JSON.stringify({ content }) },
      );
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },
};
