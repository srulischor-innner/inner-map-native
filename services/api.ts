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
import { getUserId, peekUserId, setUserId } from './user';
import { emitRateLimitNotice } from '../utils/rateLimitNotice';

const BASE_URL: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ||
  'https://inner-map-production.up.railway.app';

// One-time boot log so we can see the resolved URL in the Metro console. If this
// ever prints something unexpected, that alone explains why every call is failing.
console.log('[api] BASE_URL =', BASE_URL);

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// PR C — shared-space dialogue. One message in the shared thread
// (either a partner contribution or an AI message). The server
// returns these in a stable shape; the native client renders one
// SharedMessageCard per row.
export type SharedMessageKind =
  | 'partner_contribution'
  | 'ai_acknowledgment'
  | 'ai_hunch'
  | 'ai_observation'
  | 'ai_question'
  | 'ai_framework_explanation'
  | 'ai_moderation';

export type SharedMessageOption = {
  id: string;
  messageId: string;
  label: string;
  value: string;
  ordering: number;
};
export type SharedMessageResponse = {
  id: string;
  messageId: string;
  userId: string;
  optionId: string | null;
  otherText: string | null;
  moderationFlag: 0 | 1;
  createdAt: string;
};
export type SharedMessage = {
  id: string;
  relationshipId: string;
  author: 'ai' | 'partner_a' | 'partner_b';
  authorUserId: string | null;
  kind: SharedMessageKind;
  content: string;
  referencesId: string | null;
  createdAt: string;
  options: SharedMessageOption[];
  responses: SharedMessageResponse[];
};

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

/** Payload the server sends when a per-user daily rate limit is
 *  exceeded — same shape across the SSE error event and the JSON
 *  429 body. The chat tab uses this to render the styled limit
 *  card instead of the generic error toast. */
export type RateLimitInfo = {
  /** Which endpoint hit the cap (currently 'chat'). */
  endpoint: string;
  /** Human-readable copy the server prepared for the user. */
  message: string;
  /** Daily cap — useful if the UI wants to show it. */
  limit?: number;
  /** Rolling window in hours. */
  windowHours?: number;
};

/** One record emitted by the server's SAVE_BELIEF marker parser
 *  (Phase 2, polish round 8). The server scans the AI's reply for
 *  `[SAVE_BELIEF:{ part_id, part_name, belief }]` markers, persists
 *  each to the parts table, and returns the records on the chat
 *  response payload alongside the cleaned text. The native client
 *  renders one SaveBeliefCard per record inline in the chat thread. */
export type SavedBelief = {
  part_id: string;
  part_name: string;
  belief: string;
};

export type StreamCallbacks = {
  onDelta: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
  /** Fires INSTEAD of onError when the server returns a 429 /
   *  rate-limit-exceeded SSE error event. Optional — if a caller
   *  omits this, rate limits fall through to onError with the
   *  human-readable message so existing call sites still work. */
  onRateLimit?: (info: RateLimitInfo) => void;
  /** Fires once per chat response with the list of beliefs the
   *  server saved on this turn (parsed from [SAVE_BELIEF:...] markers
   *  in the AI's reply, then stripped from the text). Empty / unset
   *  when the AI didn't emit any belief markers. The chat tab uses
   *  this to inject SaveBeliefCard messages into the thread. */
  onSavedBeliefs?: (records: SavedBelief[]) => void;
  /** Round 9 RAG — server-assigned ids for the user message + AI
   *  reply that were just stored in memory_chunks. The chat tab
   *  stamps these onto the matching bubbles as serverMessageId so
   *  the long-press "Mark as key moment" action has a stable handle
   *  to reference. Absent on legacy paths where the server didn't
   *  surface ids — bubbles without an id hide the menu option. */
  onMessageIds?: (ids: { user: string; ai: string }) => void;
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
        // 429 — per-user daily rate limit. Server returns either:
        //   - HTTP 429 with a JSON body, OR
        //   - HTTP 429 with an SSE error frame (when wantStream was set)
        // Both carry an "error":"rate-limit-exceeded" code + a human
        // "message" the chat tab renders as the styled limit card via
        // cb.onRateLimit. Falls through to cb.onError when the caller
        // didn't opt in to the new callback.
        if (res.status === 429) {
          let info: RateLimitInfo | null = null;
          try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('text/event-stream')) {
              const raw = await res.text();
              for (const line of raw.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const evt = JSON.parse(line.slice(6));
                  if (evt.type === 'error' && evt.error === 'rate-limit-exceeded') {
                    info = {
                      endpoint: String(evt.endpoint || 'chat'),
                      message: String(evt.message || ''),
                      limit: typeof evt.limit === 'number' ? evt.limit : undefined,
                      windowHours: typeof evt.windowHours === 'number' ? evt.windowHours : undefined,
                    };
                  }
                } catch { /* skip */ }
              }
            } else {
              const j: any = await res.json().catch(() => null);
              if (j && j.error === 'rate-limit-exceeded') {
                info = {
                  endpoint: String(j.endpoint || 'chat'),
                  message: String(j.message || ''),
                  limit: typeof j.limit === 'number' ? j.limit : undefined,
                  windowHours: typeof j.windowHours === 'number' ? j.windowHours : undefined,
                };
              }
            }
          } catch { /* fall through */ }
          if (cb.onRateLimit && info) cb.onRateLimit(info);
          else cb.onError(info?.message || `chat ${res.status}`);
          return;
        }
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
          let rateLimitInfo: RateLimitInfo | null = null;
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'delta' && typeof evt.text === 'string') fullText += evt.text;
              else if (evt.type === 'done') fullText = evt.text || fullText;
              else if (evt.type === 'error') {
                // Surface rate-limit specifically — the server can emit a
                // 200-with-SSE-error frame in rare paths, so guard both
                // the 429 branch above AND the in-stream variant here.
                if (evt.error === 'rate-limit-exceeded') {
                  rateLimitInfo = {
                    endpoint: String(evt.endpoint || 'chat'),
                    message: String(evt.message || ''),
                    limit: typeof evt.limit === 'number' ? evt.limit : undefined,
                    windowHours: typeof evt.windowHours === 'number' ? evt.windowHours : undefined,
                  };
                } else {
                  serverError = evt.error || 'unknown error';
                }
              }
            } catch { /* skip */ }
          }
          if (rateLimitInfo) {
            if (cb.onRateLimit) cb.onRateLimit(rateLimitInfo);
            else cb.onError(rateLimitInfo.message);
            return;
          }
          if (serverError) { cb.onError(serverError); return; }
          if (fullText) {
            cb.onDelta(fullText);
            cb.onDone(fullText);
            return;
          }
          cb.onError('empty reply');
          return;
        }
        // Normal JSON path — server returns { reply: "...", savedBeliefs?: [...] }.
        const j: any = await res.json().catch(() => null);
        const reply = (j && (j.reply || j.text)) || '';
        if (!reply) {
          cb.onError(j?.error || 'empty reply');
          return;
        }
        cb.onDelta(reply);
        cb.onDone(reply);
        // Phase 2 — surface savedBeliefs from the response after the
        // reply has landed. The server has already stripped the
        // [SAVE_BELIEF:...] markers from `reply`, so the cards are
        // additive UI (the bubble text is clean by the time they
        // render).
        if (Array.isArray(j?.savedBeliefs) && j.savedBeliefs.length > 0) {
          const records: SavedBelief[] = j.savedBeliefs
            .filter((r: any) => r && typeof r.part_id === 'string' && typeof r.belief === 'string')
            .map((r: any) => ({
              part_id: String(r.part_id),
              part_name: String(r.part_name || ''),
              belief: String(r.belief || ''),
            }));
          if (records.length > 0) cb.onSavedBeliefs?.(records);
        }
        // Round 9 RAG — surface the server-assigned message ids so
        // the chat tab can stamp them onto the user + AI bubbles
        // for later long-press flagging.
        if (j?.messageIds && typeof j.messageIds.user === 'string' && typeof j.messageIds.ai === 'string') {
          cb.onMessageIds?.({ user: j.messageIds.user, ai: j.messageIds.ai });
        }
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


  /** POST /api/map-voice/turn — one turn of the turn-based Map Voice
   *  pipeline (polish round 7 replacement for the OpenAI Realtime
   *  WebSocket). Accepts the local recording's file URI + its MIME
   *  type; reads the file, POSTs the bytes as raw body, and returns
   *  the JSON response shape: transcript, response_text, detected_part,
   *  part_label, audio_base64, audio_mime. Returns null on transport
   *  failure (caller surfaces a "couldn't reach the server" toast).
   *  A 4xx body is returned as-is via the `error` field so the
   *  caller can show the server-prepared message (e.g.
   *  empty-transcript). */
  async mapVoiceTurn(
    uri: string,
    mime: string,
    mode: 'self' | 'self-like' = 'self',
  ): Promise<{
    mode: 'self' | 'self-like';
    transcript: string;
    response_text: string;
    detected_part: string;
    part_label: string | null;
    part_id?: string;
    part_name?: string;
    fallback?: 'missing_belief' | 'no_part_detected';
    audio_base64: string;
    audio_mime: string;
  } | { error: string; message?: string } | null> {
    const t0 = Date.now();
    try {
      const userId = await getUserId();
      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      console.log(`[map-voice] turn POST mode=${mode} uri=${uri.slice(-60)} mime=${mime} blobSize=${blob.size}B`);
      const up = await apiFetch(`/api/map-voice/turn?mode=${encodeURIComponent(mode)}`, {
        label: 'map-voice-turn', method: 'POST',
        headers: { 'Content-Type': mime, 'X-User-Id': userId },
        body: blob as any,
        // The whole STT → LLM → TTS chain runs server-side; give it
        // a generous budget. ElevenLabs alone can take ~1s. Self-like
        // mode runs a second detection LLM call so the budget covers
        // both.
        timeoutMs: 30000,
      });
      console.log(`[map-voice] turn response — status=${up.status} elapsedMs=${Date.now() - t0}`);
      const j: any = await up.json().catch(() => null);
      if (!j) return null;
      if (!up.ok) {
        return { error: String(j.error || 'turn-failed'), message: j.message };
      }
      return j;
    } catch (e) {
      console.warn('[map-voice-turn] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** GET /api/map-voice/explainer-status — has the user already
   *  dismissed the first-time Map Voice explainer modal? Polled on
   *  Map-tab mount. Defaults to `false` (modal shows) on any
   *  transport failure — better to show the explainer twice than
   *  to hide it from a new user. */
  async getMapVoiceExplainerStatus(): Promise<{ seen: boolean }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/map-voice/explainer-status', {
        label: 'map-voice-explainer-status', method: 'GET', headers,
      });
      if (!res.ok) return { seen: false };
      const j: any = await res.json().catch(() => null);
      return { seen: !!(j && j.seen) };
    } catch (e) {
      console.warn('[map-voice-explainer-status] threw:', (e as Error)?.message);
      return { seen: false };
    }
  },

  /** POST /api/map-voice/explainer-seen — set the flag true so the
   *  first-time modal never plays again for this user. Fire-and-
   *  forget; the local UI hides the modal optimistically. */
  async markMapVoiceExplainerSeen(): Promise<boolean> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/map-voice/explainer-seen', {
        label: 'map-voice-explainer-seen', method: 'POST', headers,
        body: JSON.stringify({}),
      });
      return res.ok;
    } catch (e) {
      console.warn('[map-voice-explainer-seen] threw:', (e as Error)?.message);
      return false;
    }
  },

  /** GET /api/parts/with-beliefs — list of the calling user's parts
   *  with their belief status. Drives the Self-like mic enable flag
   *  on the Map tab + the belief section in each part folder.
   *  Returns an empty array on transport failure so the UI degrades
   *  gracefully (Self-like mic stays disabled). */
  async getPartsWithBeliefs(): Promise<{
    parts: Array<{
      id: string;
      name: string;
      type: string;
      corePhrase: string | null;
      belief: string | null;
      beliefUpdatedAt: string | null;
    }>;
  }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/parts/with-beliefs', {
        label: 'parts-with-beliefs', method: 'GET', headers,
      });
      if (!res.ok) return { parts: [] };
      const j: any = await res.json().catch(() => null);
      if (!j || !Array.isArray(j.parts)) return { parts: [] };
      return {
        parts: j.parts.map((p: any) => ({
          id: String(p.id),
          name: String(p.name || p.type || ''),
          type: String(p.type || ''),
          corePhrase: p.corePhrase ?? null,
          belief: p.belief ?? null,
          beliefUpdatedAt: p.beliefUpdatedAt ?? null,
        })),
      };
    } catch (e) {
      console.warn('[parts-with-beliefs] threw:', (e as Error)?.message);
      return { parts: [] };
    }
  },

  /** POST /api/parts/:id/belief — save or update the user's
   *  articulated belief for a specific part. Trim happens server-
   *  side; empty / whitespace-only inputs are rejected with a 400.
   *  Returns the updated row on success, null on transport / 4xx
   *  failure so the caller can show a small error toast without
   *  changing app state. */
  async savePartBelief(partId: string, belief: string): Promise<{
    id: string;
    name: string;
    type: string;
    belief: string;
    beliefUpdatedAt: string;
  } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/parts/${encodeURIComponent(partId)}/belief`, {
        label: 'parts-belief-save', method: 'POST', headers,
        body: JSON.stringify({ belief }),
      });
      if (!res.ok) {
        console.warn('[parts-belief-save] non-OK', res.status);
        return null;
      }
      const j: any = await res.json().catch(() => null);
      if (!j || typeof j.belief !== 'string') return null;
      return {
        id: String(j.id),
        name: String(j.name || j.type || ''),
        type: String(j.type || ''),
        belief: j.belief,
        beliefUpdatedAt: String(j.beliefUpdatedAt || ''),
      };
    } catch (e) {
      console.warn('[parts-belief-save] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** DELETE /api/parts/:id/belief — clear the belief for a specific
   *  part. The Self-like mic for that part becomes unavailable
   *  until a new belief is established. Returns true on success. */
  async deletePartBelief(partId: string): Promise<boolean> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/parts/${encodeURIComponent(partId)}/belief`, {
        label: 'parts-belief-delete', method: 'DELETE', headers,
      });
      return res.ok;
    } catch (e) {
      console.warn('[parts-belief-delete] threw:', (e as Error)?.message);
      return false;
    }
  },

  /** POST /api/memory/flag — promote a chat message into a key moment
   *  (round 9 RAG). The server scopes the lookup by req.userId, so a
   *  user can only flag their own messages. messageId is the
   *  server-assigned id surfaced in /api/chat's done payload under
   *  `messageIds.user` / `messageIds.ai`. Returns true on success
   *  (newly flagged OR already flagged — both treated as success
   *  from the client's perspective) and false on any error.
   *  Idempotent: re-flagging a chunk that's already a key moment
   *  returns ok=true with alreadyFlagged=true server-side, which we
   *  collapse into a true return here. */
  async flagKeyMoment(messageId: string): Promise<boolean> {
    if (!messageId) return false;
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/memory/flag', {
        label: 'memory-flag', method: 'POST', headers,
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) {
        console.warn('[memory-flag] non-OK', res.status);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[memory-flag] threw:', (e as Error)?.message);
      return false;
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
      if (res.status === 429) {
        // Per-user daily TTS cap. Fire a rate-limit notice the chat
        // tab renders as a brief inline notification, then return
        // null so the existing "no audio" fallback path runs (the
        // user still sees the text reply on screen — only audio
        // playback is suppressed).
        try {
          const j: any = await res.json().catch(() => null);
          const message = (j && j.message) ||
            "Voice playback isn't available right now. You can still read replies on screen.";
          emitRateLimitNotice('speak', String(message));
          console.log(`[speak] rate limited — ${message}`);
        } catch {
          emitRateLimitNotice(
            'speak',
            "Voice playback isn't available right now. You can still read replies on screen.",
          );
        }
        return null;
      }
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
   *  the calling user. PR B response shape (code-only):
   *    { relationshipId, code, expiresAt, reused }
   *  `code` is 6 characters from the unambiguous-glyph alphabet
   *  (no O/0/I/1/L). `expiresAt` is ISO-8601, ~7 days in the future.
   *  `reused` is true when the server handed back an existing
   *  unexpired pending invite rather than minting a fresh row. */
  async createRelationshipInvite(): Promise<{
    relationshipId: string;
    code: string;
    expiresAt: string;
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
   *  validates code shape, existence, expiry, used-state, the
   *  not-self constraint, and the v1 single-active-relationship limit.
   *  Returns relationshipId + partnerName on success; on failure
   *  returns one of (PR B):
   *    'missing-invite-code' | 'invalid-code-format'
   *    | 'invite-not-found' | 'invite-expired' | 'invite-already-used'
   *    | 'invite-already-claimed' | 'cannot-accept-own-invite'
   *    | 'already-in-relationship' | 'rate-limit-exceeded'
   *  All as plain { error } objects so the screen can branch on them.
   *
   *  Wire format uses `{ code }` (was `{ inviteCode }` pre-PR-B). The
   *  server accepts both keys for one release of overlap but new
   *  clients should use `code`. */
  async acceptRelationshipInvite(code: string): Promise<
    | { relationshipId: string; partnerName: string | null }
    | { error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/relationships/accept', {
        label: 'rel-accept', method: 'POST', headers,
        body: JSON.stringify({ code: String(code || '').trim().toUpperCase() }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      console.warn('[rel-accept] threw:', (e as Error)?.message);
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** POST /api/relationships/:id/dismiss-departure-notice — flips
   *  partnerNoticeShown=1 so the one-time modal won't re-fire after
   *  the user has seen it. Idempotent. */
  async dismissPartnerDepartureNotice(relationshipId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/relationships/${encodeURIComponent(relationshipId)}/dismiss-departure-notice`, {
        label: 'rel-dismiss-departure', method: 'POST', headers,
      });
      if (!res.ok) {
        let j: any = null; try { j = await res.json(); } catch {}
        return { ok: false, error: j?.error || `http_${res.status}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message || 'transport-failed' };
    }
  },

  /** POST /api/relationships/:id/leave — this user departs the
   *  relationship. If the OTHER partner already departed, the
   *  relationship + all child rows are fully torn down server-side.
   *  Used by the "Close relationship" action on the partner-departure
   *  modal. */
  async leaveRelationship(relationshipId: string): Promise<{ ok: boolean; status?: 'departed' | 'torn-down'; error?: string }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/relationships/${encodeURIComponent(relationshipId)}/leave`, {
        label: 'rel-leave', method: 'POST', headers,
      });
      const j: any = await res.json().catch(() => null);
      if (!res.ok || !j || !j.status) {
        return { ok: false, error: j?.error || `http_${res.status}` };
      }
      return { ok: true, status: j.status };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message || 'transport-failed' };
    }
  },

  /** GET /api/account/export — returns the JSON export body as a raw
   *  string so the caller can write it to a temp file and hand off to
   *  expo-sharing. Server-side validates rate limit (5/24h) and returns
   *  429 with { error: 'rate-limit-exceeded', message } on cap; we
   *  surface that as a structured result for the Settings UI.  */
  async exportAccount(): Promise<
    | { ok: true; body: string; suggestedFilename: string }
    | { ok: false; error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/account/export', {
        label: 'account-export', method: 'GET', headers, timeoutMs: 60000,
      });
      if (res.status === 429) {
        let j: any = null;
        try { j = await res.json(); } catch {}
        return { ok: false, error: 'rate-limit-exceeded', message: j?.message };
      }
      if (!res.ok) {
        let j: any = null;
        try { j = await res.json(); } catch {}
        return { ok: false, error: j?.error || `http_${res.status}`, message: j?.message };
      }
      const body = await res.text();
      // Pull filename from Content-Disposition so the share sheet
      // surfaces the proper name. Falls back to a generic name.
      const cd = res.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(cd);
      const suggestedFilename = match ? match[1] : `innermap-export-${Date.now()}.json`;
      return { ok: true, body, suggestedFilename };
    } catch (e) {
      console.warn('[account-export] threw:', (e as Error)?.message);
      return { ok: false, error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** DELETE /api/account — irreversible. Returns the server's
   *  { status: "deleted", deletedAt, counters } on success. Idempotent
   *  on the server side, so a retry after a network blip still
   *  returns clean. */
  async deleteAccount(): Promise<
    | { ok: true; deletedAt: string; counters: { relationships: number; sessions: number; parts: number; journal: number } }
    | { ok: false; error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/account', {
        label: 'account-delete', method: 'DELETE', headers, timeoutMs: 60000,
      });
      const j: any = await res.json().catch(() => null);
      if (!res.ok || !j || j.status !== 'deleted') {
        return {
          ok: false,
          error: j?.error || `http_${res.status}`,
          message: j?.message,
        };
      }
      return { ok: true, deletedAt: j.deletedAt, counters: j.counters };
    } catch (e) {
      console.warn('[account-delete] threw:', (e as Error)?.message);
      return { ok: false, error: 'transport-failed', message: (e as Error)?.message };
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
    // PR B: invite expiry timestamp (ISO-8601, ~7 days after mint).
    // Set on pending rows where the invite hasn't been consumed yet;
    // null on accepted relationships and on pre-PR-B rows.
    inviteExpiresAt?: string | null;
    inviteUsedAt?: string | null;
    status: 'pending' | 'active' | 'paused';
    inviterAcceptedIntro: number;
    inviteeAcceptedIntro: number;
    createdAt: string;
    updatedAt: string;
    myRole: 'inviter' | 'invitee';
    partnerId: string | null;
    partnerName: string | null;
    myIntroDone: boolean;
    partnerIntroDone: boolean;
    // Partner-departure (PR 2b). Set when the OTHER partner deleted
    // their account. The remaining partner sees a one-time notice;
    // shared insights stay readable; new private chat is suppressed
    // by the UI (relationship is effectively read-only).
    partnerDeparted?: 0 | 1;
    departedAt?: string | null;
    partnerNoticeShown?: 0 | 1;
  }>> {
    // Build 11 — bug fix for "partner connection lost on every app
    // update." The old shape returned [] on BOTH "no partners" AND
    // transport failure, which made the Partner tab unable to tell
    // a real "no partner" state from a cold-start blip. On app
    // updates Railway often takes 5-30s to wake up, the fetch
    // times out, the UI sees [], classifies as 'none', and routes
    // to the connect-screen — asking the user to re-invite a
    // partner who's still paired server-side.
    //
    // Compatibility: the public API stays a plain array — that's
    // what every existing call site consumes. The new
    // listRelationshipsResult() below is the discriminated form
    // for callers that need to tell apart "empty list" from
    // "fetch failed." Native Partner tab uses the new form; older
    // callers (smokes, dev tooling) keep the array contract.
    const r = await this.listRelationshipsResult();
    return r.ok ? r.relationships : [];
  },

  /** Discriminated form of listRelationships() used by the Partner
   *  tab so it can keep showing the existing-partner UI on a cold-
   *  start fetch failure instead of falling into the connect-
   *  screen. Retries the request ONCE on transport failure so a
   *  brief Railway wake-up doesn't surface as an empty list.
   *  Returns:
   *    { ok: true,  relationships: [...] }   on 200
   *    { ok: false, relationships: [] }      on non-OK / throw
   *                                           after the retry.
   */
  async listRelationshipsResult(): Promise<{
    ok: boolean;
    relationships: any[];
  }> {
    const attempt = async () => {
      const headers = await authHeaders();
      const res = await apiFetch('/api/relationships', {
        label: 'rel-list', method: 'GET', headers,
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const j: any = await res.json();
      return Array.isArray(j?.relationships) ? j.relationships : [];
    };
    try {
      const arr = await attempt();
      return { ok: true, relationships: arr };
    } catch (e1) {
      console.warn('[rel-list] first attempt failed, retrying once:', (e1 as Error)?.message);
      // One-shot retry. Most transient failures resolve on the
      // second hit once Railway is warm (the first cold request
      // primes the box). Bound the retry to avoid hiding a real
      // outage behind exponential backoff.
      try {
        const arr = await attempt();
        return { ok: true, relationships: arr };
      } catch (e2) {
        console.warn('[rel-list] retry also failed:', (e2 as Error)?.message);
        return { ok: false, relationships: [] };
      }
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

  // ===========================================================================
  // SHARED-SPACE DIALOGUE (PR C)
  //
  // Replaces the old proposal/voting wrappers. The shared space is now
  // a structured dialogue between both partners and a shared-space AI.
  // Four endpoints:
  //   POST /shared/contribute   — partner posts content into the shared space
  //   POST /shared/respond      — partner responds to an AI message
  //   GET  /shared/messages     — full thread for the relationship
  //   GET  /shared/since/:ts    — incremental delta since timestamp
  // ===========================================================================
  /** POST /api/relationships/:id/shared/contribute. Body: { content }.
   *  Server inserts a shared_messages row of kind='partner_contribution'
   *  authored by the calling user and fires an AI tick. Response
   *  includes both the new contribution row and (if the tick posted
   *  anything) the AI's reply. The AI may also skip — aiMessage is
   *  null in that case. */
  async contributeToSharedSpace(
    relationshipId: string,
    content: string,
  ): Promise<
    | {
        contribution: SharedMessage;
        aiMessage: SharedMessage | null;
      }
    | { error: string; message?: string }
  > {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/shared/contribute`,
        { label: 'shared-contribute', method: 'POST', headers, body: JSON.stringify({ content }) },
      );
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: j?.error || `http_${res.status}`, message: j?.message };
      return j;
    } catch (e) {
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** POST /api/relationships/:id/shared/respond. Body: { messageId, optionId?, otherText? }.
   *  Exactly one of optionId / otherText must be set. otherText runs
   *  through server-side moderation first; toxic text is rejected with
   *  a redirect message (error='moderation-rejected', redirect: '...').
   *  If both partners have now responded to the same AI message, the
   *  server fires an AI tick and aiMessage may be non-null. */
  async respondInSharedSpace(
    relationshipId: string,
    messageId: string,
    payload: { optionId: string } | { otherText: string },
  ): Promise<
    | {
        responseId: string;
        moderationFlag: 0 | 1;
        aiMessage: SharedMessage | null;
      }
    | { error: string; message?: string; redirect?: string }
  > {
    try {
      const headers = await authHeaders();
      const body: any = { messageId };
      if ('optionId' in payload) body.optionId = payload.optionId;
      if ('otherText' in payload) body.otherText = payload.otherText;
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/shared/respond`,
        { label: 'shared-respond', method: 'POST', headers, body: JSON.stringify(body) },
      );
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          error: j?.error || `http_${res.status}`,
          message: j?.message,
          redirect: j?.redirect,
        };
      }
      return j;
    } catch (e) {
      return { error: 'transport-failed', message: (e as Error)?.message };
    }
  },

  /** GET /api/relationships/:id/shared/messages. Full chronological
   *  shared-thread for the relationship, with each AI message's
   *  options + both partners' responses attached. Used by the native
   *  SharedDialogueView on mount + every 15s poll cycle. */
  async getSharedMessages(relationshipId: string): Promise<{
    messages: SharedMessage[];
    meta: { mySide: 'inviter' | 'invitee'; myAuthor: 'partner_a' | 'partner_b' };
  } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/shared/messages`,
        { label: 'shared-messages', method: 'GET', headers },
      );
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[shared-messages] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** GET /api/relationships/:id/shared/since/:timestamp. Incremental —
   *  returns only messages newer than the timestamp. Native polling
   *  uses this to avoid re-fetching the full thread on every cycle. */
  async getSharedMessagesSince(
    relationshipId: string,
    sinceIso: string,
  ): Promise<{ messages: SharedMessage[] } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch(
        `/api/relationships/${encodeURIComponent(relationshipId)}/shared/since/${encodeURIComponent(sinceIso)}`,
        { label: 'shared-since', method: 'GET', headers },
      );
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[shared-since] threw:', (e as Error)?.message);
      return null;
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

  // (PR C — commentOnSharedItem was removed alongside the rest of
  // the proposal/voting/reactions/comments surface. Cross-partner
  // engagement now flows through contributeToSharedSpace +
  // respondInSharedSpace above.)

  // ===========================================================================
  // MAP-SEEN — drives the "you have new map content" dot on the Map tab.
  // ===========================================================================

  /** GET /api/map/seen-status. Returns the user's last-seen timestamp,
   *  the current map-updated timestamp, and a precomputed hasUnseen
   *  boolean. Polled on app foreground + tab focus; the dot service
   *  in services/mapSeen.ts caches the result for 30s. */
  async getMapSeenStatus(): Promise<{
    lastSeenMapAt: string | null;
    mapUpdatedAt: string | null;
    hasUnseen: boolean;
  } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/map/seen-status', {
        label: 'map-seen-status', method: 'GET', headers,
      });
      if (!res.ok) return null;
      const j: any = await res.json().catch(() => null);
      if (!j || typeof j !== 'object') return null;
      return {
        lastSeenMapAt: j.lastSeenMapAt ?? null,
        mapUpdatedAt: j.mapUpdatedAt ?? null,
        hasUnseen: !!j.hasUnseen,
      };
    } catch (e) {
      console.warn('[map-seen-status] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** GET /api/first-session-status. Returns `{ completedAt: string | null }`
   *  where completedAt is the ISO timestamp the server wrote when the
   *  AI emitted [STARTER_MAP_COMPLETE] in the user's first session.
   *  null = first session not done yet — the chat tab shows the
   *  "Building your starter map" banner and the Map tab empty state
   *  shows the "Start building" CTA. Once set, stays set forever
   *  (it never resets). null also returned on transport failure so
   *  the client fails closed — better to briefly show first-session
   *  UI for a returning user than to hide it from a new one. */
  async getFirstSessionStatus(): Promise<{ completedAt: string | null }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/first-session-status', {
        label: 'first-session-status', method: 'GET', headers,
      });
      if (!res.ok) return { completedAt: null };
      const j: any = await res.json().catch(() => null);
      if (!j || typeof j !== 'object') return { completedAt: null };
      return { completedAt: typeof j.completedAt === 'string' ? j.completedAt : null };
    } catch (e) {
      console.warn('[first-session-status] threw:', (e as Error)?.message);
      return { completedAt: null };
    }
  },

  // (Polish round 7) The startVoiceSession / endVoiceSession /
  // getVoiceUsageCurrentPeriod methods that gated the metered
  // Realtime-based Map Voice were removed. Map Voice is now
  // turn-based via api.mapVoiceTurn() above; there's no per-session
  // ledger and no monthly cap anymore.

  /** POST /api/map/mark-seen. Stamps lastSeenMapAt=NOW for the user.
   *  Called on Map-tab entry. Returns the new timestamp on success,
   *  null on transport failure (caller can still optimistically
   *  clear the local dot — server will re-sync on next poll). */
  async markMapSeen(): Promise<{ lastSeenMapAt: string } | null> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/map/mark-seen', {
        label: 'map-mark-seen', method: 'POST', headers, body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const j: any = await res.json().catch(() => null);
      if (!j || typeof j !== 'object' || typeof j.lastSeenMapAt !== 'string') return null;
      return { lastSeenMapAt: j.lastSeenMapAt };
    } catch (e) {
      console.warn('[map-mark-seen] threw:', (e as Error)?.message);
      return null;
    }
  },

  // ==========================================================================
  // Build 11 — Account recovery (Apple / Google / email magic link).
  // ==========================================================================
  // Three providers feed a single /api/auth/sign-in endpoint. The
  // server returns { userId, isNewUser, migrated, identityId } — the
  // caller writes that userId into SecureStore (via setUserId) and
  // continues with the existing X-User-Id flow.
  //
  // X-User-Id flow during sign-in:
  //   - If an existing anonymous user_id is on disk → peekUserId
  //     returns it, we send it as X-User-Id. Server detects new
  //     identity + existing X-User-Id → MIGRATION (preserves the
  //     anonymous user's data under the now-linked identity).
  //   - If no existing user_id → no header, server mints a fresh
  //     user_id (first-time sign-up) OR routes to an existing
  //     identity's user_id (cross-device restore).
  //
  // Helper that builds headers WITHOUT minting an anonymous user_id
  // if none exists yet. Used only by the sign-in path so we don't
  // burn a UUID on first launch just to throw it away seconds later.
  async _authSignInHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const existing = await peekUserId();
    if (existing) headers['X-User-Id'] = existing;
    return headers;
  },

  /** POST /api/auth/sign-in. Verify a provider credential and resolve
   *  to a user_id. Returns the resolved id + flags telling the caller
   *  whether this is a brand-new account, a migration of the calling
   *  anonymous user, or simply a re-sign-in from a known identity.
   *
   *  The caller is responsible for writing the returned userId into
   *  SecureStore via setUserId() so subsequent requests carry the
   *  right X-User-Id. Failed verification surfaces as null + a
   *  server-side log. */
  async authSignIn(
    provider: 'apple' | 'google' | 'email',
    credential: string,
  ): Promise<{
    userId: string;
    isNewUser: boolean;
    migrated: boolean;
    identityId: string;
  } | null> {
    try {
      const headers = await this._authSignInHeaders();
      const res = await apiFetch('/api/auth/sign-in', {
        label: 'auth-sign-in', method: 'POST', headers,
        body: JSON.stringify({ provider, credential }),
      });
      if (!res.ok) {
        console.warn(`[auth-sign-in] non-OK ${res.status}`);
        return null;
      }
      const j: any = await res.json().catch(() => null);
      if (!j || typeof j.userId !== 'string') return null;
      // Stamp the resolved userId into SecureStore so the rest of
      // the app picks it up via getUserId(). For the migration path
      // this is a no-op (server returns the same id we already had);
      // for first-time sign-up + cross-device restore this is the
      // actual identity-store of the resolved id.
      try { await setUserId(j.userId); } catch (e) {
        console.warn('[auth-sign-in] setUserId threw:', (e as Error)?.message);
      }
      return {
        userId: j.userId,
        isNewUser: !!j.isNewUser,
        migrated: !!j.migrated,
        identityId: String(j.identityId || ''),
      };
    } catch (e) {
      console.warn('[auth-sign-in] threw:', (e as Error)?.message);
      return null;
    }
  },

  /** POST /api/auth/email/request. Generates + sends a magic-link
   *  email. Returns true on success (server ALWAYS returns ok:true
   *  unless the email is malformed — anti-enumeration). Caller
   *  surfaces "check your inbox" copy regardless of outcome. */
  async authRequestEmailMagicLink(email: string): Promise<boolean> {
    try {
      const headers = await this._authSignInHeaders();
      const res = await apiFetch('/api/auth/email/request', {
        label: 'auth-email-request', method: 'POST', headers,
        body: JSON.stringify({ email }),
      });
      return res.ok;
    } catch (e) {
      console.warn('[auth-email-request] threw:', (e as Error)?.message);
      return false;
    }
  },

  /** GET /api/auth/identities. Returns the identities currently
   *  linked to the user. Empty array means the user is anonymous —
   *  the chat tab boot uses this to decide whether to show the
   *  migration modal. */
  async authListIdentities(): Promise<{
    identities: Array<{
      id: string;
      provider: 'apple' | 'google' | 'email';
      email: string | null;
      created_at: string;
      last_used_at: string;
    }>;
  }> {
    try {
      const headers = await authHeaders();
      const res = await apiFetch('/api/auth/identities', {
        label: 'auth-list-identities', method: 'GET', headers,
      });
      if (!res.ok) return { identities: [] };
      const j: any = await res.json().catch(() => null);
      if (!j || !Array.isArray(j.identities)) return { identities: [] };
      return {
        identities: j.identities.map((r: any) => ({
          id: String(r.id),
          provider: r.provider,
          email: r.email ?? null,
          created_at: String(r.created_at || ''),
          last_used_at: String(r.last_used_at || ''),
        })),
      };
    } catch (e) {
      console.warn('[auth-list-identities] threw:', (e as Error)?.message);
      return { identities: [] };
    }
  },

  /** DELETE /api/auth/identities/:id. Unlink one identity from the
   *  calling user. Returns true on success. The caller is responsible
   *  for warning the user if this is their LAST identity (going back
   *  to anonymous mode means cross-device restore is no longer
   *  available). */
  async authRemoveIdentity(identityId: string): Promise<boolean> {
    if (!identityId) return false;
    try {
      const headers = await authHeaders();
      const res = await apiFetch(`/api/auth/identities/${encodeURIComponent(identityId)}`, {
        label: 'auth-remove-identity', method: 'DELETE', headers,
      });
      return res.ok;
    } catch (e) {
      console.warn('[auth-remove-identity] threw:', (e as Error)?.message);
      return false;
    }
  },
};
