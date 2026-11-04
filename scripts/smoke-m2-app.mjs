// Smoke for the APP SIDE OF M2 — and above all for "off is today".
//
// M2 is the founder's locked chat design: one prompt, no mode boxes, the chat
// never writes the map, a yes in chat becomes a card the person taps, a pass
// proposes cards to Messages, and a new first-session welcome. It ships behind
// an account-level flag the server reports. This file holds two claims:
//
//   1. OFF IS TODAY. Every M2 path in the chat screen checks the flag before it
//      does anything, the flag fails closed, and nothing M2 adds is reachable
//      for an account the server has not moved.
//   2. ON DOES WHAT THE FOUNDER'S FILES SAY. The pure rules in services/m2.ts
//      are imported and RUN, not read: which cards reach the chat screen, how
//      the starter map's entries are counted, when the button may show.
//
// The server's API doc did not exist when this was built; what the app assumes
// is in docs/m2-app-assumptions.md, and the A-numbers below refer to it.
//
// Boots nothing, contacts no server, requires no server file. Node strips the
// types from services/m2.ts on import (its one import is type-only).
//
//   node scripts/smoke-m2-app.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};
// Whole-line comments out, so prose that NAMES a guard cannot stand in for it.
const codeOnly = (src) => src.split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const m2 = await import(pathToFileURL(path.join(ROOT, 'services', 'm2.ts')).href);

// ===========================================================================
// 1. THE FLAG FAILS CLOSED (A1)
// ===========================================================================
console.log('\n1. the flag');
ok('"m2" under promptStack turns it on', m2.parseM2Flag({ promptStack: 'm2' }) === true);
ok('"m2" under chatStack turns it on', m2.parseM2Flag({ chatStack: 'm2' }) === true);
{
  const offs = [null, undefined, 0, '', 'm2', [], {}, { promptStack: 'M2' }, { promptStack: true },
    { promptStack: 'legacy' }, { chatStack: 'm1' }, { m2: true }, { completedAt: null }];
  const leaked = offs.filter((b) => m2.parseM2Flag(b) !== false);
  ok('everything else is OFF — case, booleans, other stacks, a bare m2:true',
    leaked.length === 0, `turned on by ${JSON.stringify(leaked)}`);
}

const api = read('services/api.ts');
{
  const a = api.indexOf('async getFirstSessionStatus()');
  const b = a === -1 ? -1 : api.indexOf('\n  },', a);
  const body = a === -1 || b === -1 ? '' : api.slice(a, b);
  const failures = body.match(/return \{[^}]*ok: false[^}]*\}/g) || [];
  ok('every failure shape of the status call answers m2: false',
    failures.length >= 3 && failures.every((r) => /m2: false/.test(r)),
    failures.join(' | ') || 'getFirstSessionStatus not found');
  ok('the success shape reads the flag through parseM2Flag and nothing else',
    /ok: true, m2: parseM2Flag\(j\)/.test(body));
}

const chatSrc = read('app/(tabs)/index.tsx');
const chat = codeOnly(chatSrc);
ok('boot believes the flag only when the status ANSWERED',
  /const isM2 = firstStatus\?\.ok === true && firstStatus\.m2 === true;/.test(chat));
ok('m2 state starts FALSE, so nothing M2 renders before boot answers',
  /const \[m2, setM2\] = useState\(false\);/.test(chat) && /const m2Ref = useRef\(false\);/.test(chat));

// ===========================================================================
// 2. OFF IS TODAY — every M2 path in the chat screen is behind the flag
// ===========================================================================
console.log('\n2. off is today');
{
  const sub = chat.indexOf('subscribeInbox((s) =>');
  const effectHead = chat.lastIndexOf('useEffect(() => {', sub);
  const window = sub > -1 && effectHead > -1 ? chat.slice(effectHead, sub) : '';
  ok('the card subscription returns before subscribing when M2 is off',
    /if \(!m2\) return;/.test(window), 'the inbox subscription is not guarded');
}
const fnBody = (name) => {
  const at = chat.indexOf(`const ${name} = useCallback(`);
  return at === -1 ? '' : chat.slice(at, chat.indexOf('}, [', at));
};
ok('looking for chat cards is a no-op when M2 is off',
  /^[\s\S]{0,80}if \(!m2Ref\.current\) return;/.test(fnBody('lookForChatCards').replace(/^const lookForChatCards = useCallback\(\(\) => \{/, '')));
ok('recounting the map is a no-op when M2 is off',
  /^[\s\S]{0,80}if \(!m2Ref\.current\) return;/.test(fnBody('recountMapEntries').replace(/^const recountMapEntries = useCallback\(\(\) => \{/, '')));
{
  // Located by its comment in the raw source, then read as code only.
  const at = chatSrc.indexOf('// Coming back to the chat');
  const focus = at === -1 ? '' : codeOnly(chatSrc.slice(at, at + 600));
  ok('the focus refresh is a no-op when M2 is off',
    /useFocusEffect\(\s*React\.useCallback\(\(\) => \{\s*if \(!m2Ref\.current\) return;\s*refreshInboxStatus/.test(focus),
    at === -1 ? 'the focus effect was not found' : 'its first statement is not the flag check');
}
ok('the pending card renders only on M2 and never over a crisis',
  /\{m2 && !crisisGated \? \(\s*<PendingMapCards /.test(chat));
ok('the mode control is hidden on M2 and ONLY on M2',
  /\{m2 \? null : \(\s*<WorkingModeControl/.test(chat));
ok('the mode boxes are suppressed on M2, first line of the rule',
  /const showModeBoxes = useMemo\(\(\) => \{\s*if \(m2\) return false;/.test(chat));
ok('the starter-map button is gated through starterMapButtonAllowed',
  /const starterMapHandler = starterMapButtonAllowed\(m2, mapEntries\) \? handleViewStarterMap : undefined;/.test(chat)
    && /onViewStarterMap=\{starterMapHandler\}/.test(chat));
ok('...and the bubble list re-renders when that gate opens',
  /\[messages, starterMapHandler\]/.test(chat));

// The rule itself: off M2 the button is ALWAYS allowed, whatever the count.
{
  const offRows = [0, 1, 2, 5].filter((n) => m2.starterMapButtonAllowed(false, n) !== true);
  ok('OFF: the starter-map button is allowed at every count, as today',
    offRows.length === 0, `blocked at ${JSON.stringify(offRows)}`);
  ok('ON: it waits for two entries',
    m2.starterMapButtonAllowed(true, 0) === false && m2.starterMapButtonAllowed(true, 1) === false
      && m2.starterMapButtonAllowed(true, 2) === true && m2.starterMapButtonAllowed(true, 3) === true);
}

// ===========================================================================
// 3. WHICH CARDS REACH THE CHAT SCREEN (A2, A4)
// ===========================================================================
console.log('\n3. chat cards');
const S = 'session-now';
const item = (over = {}) => ({
  kind: 'part',
  payload: { part: 'manager', label: 'the planner', field: 'strategy', value: 'I make a list so nothing can surprise me' },
  anchor: 'I make a list so nothing can surprise me',
  recognised: 'confirmed',
  confirmedInChat: true,
  ...over,
});
const row = (items, over = {}) => ({
  id: over.id || 'msg-1', kind: 'm2_card', payload: { sessionId: S, sessionDate: 'Nov 4', items },
  createdAt: '2026-11-04T00:00:00Z', readAt: null, actedAt: null, expiresAt: null, ...over,
});
{
  const got = m2.chatPendingCards([row([item()])], S);
  ok('a yes-in-chat item from this session reaches the chat screen',
    got.length === 1 && got[0].messageId === 'msg-1' && got[0].itemIndex === 0);
  ok('...under the pass\'s snake_case spelling too',
    m2.chatPendingCards([row([item({ confirmedInChat: undefined, confirmed_in_chat: true })])], S).length === 1);
}
{
  const cases = [
    ['another session\'s card', [row([item()], { payload: { sessionId: 'older', items: [item()] } })]],
    ['an item they did not say yes to in chat', [row([item({ confirmedInChat: false })])]],
    ['an accepted item', [row([item({ status: 'accepted' })])]],
    ['a declined item', [row([item({ status: 'declined' })])]],
    ['an item with an empty value', [row([item({ payload: { part: 'wound', field: 'belief', value: '  ' } })])]],
    ['an item of an unknown kind', [row([item({ kind: 'key_moment' })])]],
    ['an old-stack pending_parts row', [{ ...row([item()]), kind: 'pending_parts' }]],
    ['an enrichment row', [{ ...row([item()]), kind: 'enrichment' }]],
  ];
  for (const [label, rows] of cases) {
    ok(`stays off the chat screen: ${label}`, m2.chatPendingCards(rows, S).length === 0);
  }
  ok('an empty session id matches nothing', m2.chatPendingCards([row([item()])], '').length === 0);
}
{
  const mixed = row([item({ status: 'accepted' }), item(), item({ confirmedInChat: false }), item()]);
  const got = m2.chatPendingCards([mixed], S).map((c) => c.itemIndex);
  ok('item indices are the row\'s own, so a tap acts on the right item',
    JSON.stringify(got) === '[1,3]', JSON.stringify(got));
}

// What the card displays — and therefore what an edit replaces (A2a).
console.log('\n3a. what a card says');
{
  const v = (kind, payload) => m2.m2ItemValue({ kind, payload });
  ok('part / detail / voice show payload.value',
    v('part', { value: 'a' }) === 'a' && v('detail', { value: 'b' }) === 'b' && v('voice', { value: 'c' }) === 'c');
  ok('middle_ground shows its label', v('middle_ground', { label: 'standing at the sink' }) === 'standing at the sink');
  ok('second_wound shows the wound', v('second_wound', { wound: 'I am too much' }) === 'I am too much');
  const cat = (kind, payload) => m2.m2ItemCategory({ kind, payload });
  // first-session.md: never the map's words before they have met the thing.
  // Every kind × every part × every field the pass may send (mapping-m2.md's
  // field lists), with and without their own label.
  const PARTS = ['wound', 'fixer', 'skeptic', 'self-like', 'manager', 'firefighter', '', 'unknown-part'];
  const FIELDS = ['belief', 'feeling', 'story', 'body', 'history', 'worldview', 'trigger', 'voice', 'pattern',
    'selectivity', 'fear', 'what-it-protects', 'how-it-shows-up', 'desire', 'fantasy', 'what-it-built', 'agenda',
    'clenched-or-open', 'lean', 'strategy', 'what-it-manages', 'when-it-fires', 'what-it-gives', 'situation',
    'example', 'manner', 'memory', '', 'not-a-field'];
  const leaks = [];
  for (const k of ['part', 'detail', 'voice', 'middle_ground', 'second_wound']) {
    for (const p of PARTS) for (const fld of FIELDS) for (const label of ['', 'the planner']) {
      const c = cat(k, { part: p, field: fld, label, value: 'x' }) || '';
      if (/\b(wound|fixer|skeptic|firefighter|manager|self-like|unknown-part)\b/i.test(c) || /\b[a-z]+-[a-z]+(?:-[a-z]+)*\b/.test(c.replace('self-like', ''))) {
        leaks.push(`${k}/${p}/${fld}/${label || '-'} → "${c}"`);
      }
    }
  }
  ok('no framework term or raw field key reaches a card\'s category line',
    leaks.length === 0, leaks.slice(0, 5).join(' | '));
  ok('their own name for a part is used when they gave one',
    /^the planner · /.test(cat('detail', { part: 'manager', label: 'the planner', field: 'trigger', value: 'x' }) || ''));
}

// ===========================================================================
// 4. COUNTING THE STARTER MAP (A6)
// ===========================================================================
console.log('\n4. starter map entries');
{
  const f = (value) => ({ value, confidence: 'confirmed' });
  ok('an empty or missing map is zero', m2.countMapEntries(null) === 0 && m2.countMapEntries({ parts: [] }) === 0);
  ok('belief and trigger on one wound are TWO entries (first-session.md counts things, not parts)',
    m2.countMapEntries({ parts: [{ category: 'wound', markerFields: { belief: f('not enough'), trigger: f('being ignored') } }] }) === 2);
  ok('a coping behaviour is an entry of its own',
    m2.countMapEntries({ parts: [
      { category: 'wound', markerFields: { belief: f('alone') } },
      { category: 'manager', markerFields: { strategy: f('makes lists') } },
    ] }) === 2);
  ok('blank values do not count',
    m2.countMapEntries({ parts: [{ category: 'wound', markerFields: { belief: f(''), trigger: f('   '), story: { value: 3 } } }] }) === 0);
  ok('an older row with only a corePhrase counts once',
    m2.countMapEntries({ parts: [{ category: 'fixer', corePhrase: 'try harder', markerFields: {} }] }) === 1);
  ok('a corePhrase does not double-count a part that has field values',
    m2.countMapEntries({ parts: [{ category: 'wound', corePhrase: 'alone', markerFields: { belief: f('alone') } }] }) === 1);
  ok('a node the map draws by default (unknown or self category) never counts',
    m2.countMapEntries({ parts: [{ category: 'self', corePhrase: 'calm' }, { category: '', markerFields: { x: f('y') } }] }) === 0);
  ok('a server-owned mapEntryCount wins over the app\'s own count',
    m2.countMapEntries({ mapEntryCount: 1, parts: [{ category: 'wound', markerFields: { belief: f('a'), trigger: f('b') } }] }) === 1);
  ok('...unless it is not a usable number',
    m2.countMapEntries({ mapEntryCount: -1, parts: [{ category: 'fixer', corePhrase: 'x' }] }) === 1
      && m2.countMapEntries({ mapEntryCount: '5', parts: [] }) === 0);
}

// ===========================================================================
// 5. MESSAGES (A2)
// ===========================================================================
console.log('\n5. Messages');
const msgs = codeOnly(read('app/messages.tsx'));
ok('an m2_card row renders through the shared accept / edit / decline card',
  /m\.kind === M2_CARD_KIND \? \(\s*<PendingPartsCard key=\{m\.id\} message=\{m\} onEditFocus=\{ensureEditVisible\} variant=\{M2_VARIANT\} \/>/.test(msgs));
ok('the M2 variant skips items it cannot read rather than showing live buttons on an empty row',
  /showItem: \(it\) => isM2Item\(it\) && !!m2ItemValue\(it\)/.test(msgs)
    && /if \(variant\.showItem && !variant\.showItem\(it\)\) return null;/.test(msgs));
ok('the two original variants carry no showItem, so they render every item as before',
  !/const PENDING_PARTS_VARIANT: CardVariant = \{[^}]*showItem/.test(msgs)
    && !/const MIDDLE_GROUND_VARIANT: CardVariant = \{[^}]*showItem/.test(msgs));

const card = codeOnly(read('components/chat/PendingMapCards.tsx'));
ok('the chat card accepts and declines through the same two inbox endpoints',
  /api\.actOnMessage\(card\.messageId, \[card\.itemIndex\], edits\)/.test(card)
    && /api\.declineMessageItems\(card\.messageId, \[card\.itemIndex\]\)/.test(card));
ok('the chat card says it is not on the map until they add it',
  /It isn’t on your map until you add it\./.test(read('components/chat/PendingMapCards.tsx')));
ok('a failed write is said back, not shown as added',
  /if \(res\.ok\) \{[\s\S]*?onSettled\('accepted'\)[\s\S]*?\} else \{[\s\S]*?setFailed\(true\)/.test(card));

// ===========================================================================
// 6. THE WELCOME IS THE FOUNDER'S TEXT
// ===========================================================================
console.log('\n6. the welcome');
{
  const m = chatSrc.match(/const M2_WELCOME =([\s\S]*?);\r?\n/);
  const val = m ? new Function(`return (${m[1]});`)() : null;
  ok('M2_WELCOME is a plain string in the chat screen', typeof val === 'string' && val.length > 200);
  // The founder's file lives outside the repo, so CI cannot see it. When it is
  // on disk, compare byte for byte; when it is not, SAY SO, so the runner lists
  // the skip instead of letting a green line imply this half ran.
  const FOUNDER = process.env.M2_FIRST_SESSION_MD
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'first-session.md');
  if (fs.existsSync(FOUNDER) && typeof val === 'string') {
    const lines = fs.readFileSync(FOUNDER, 'utf8').split(/\r?\n/);
    const at = lines.findIndex((l) => /^## Proposed welcome message/.test(l));
    const para = at === -1 ? null : lines.slice(at + 1).filter((l) => l.trim() && !/^\*/.test(l))[0];
    ok('M2_WELCOME is byte-identical to first-session.md\'s proposed welcome', para === val,
      para == null ? 'heading not found in the founder file' : `founder ${para.length}ch, app ${val.length}ch`);
  } else {
    console.log(`  [6.2] SKIP  founder comparison — ${FOUNDER} not on disk; compared on the machine that built this`);
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
