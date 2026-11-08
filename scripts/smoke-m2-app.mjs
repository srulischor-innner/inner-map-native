// Smoke for the APP SIDE OF M2 — and above all for "off is today".
//
// M2 is the founder's locked chat design (mapping-m2 (2).md, first-session
// (1).md, rulings of 2026-11-05): one prompt, no mode boxes, the chat never
// writes the map — a yes in chat becomes a card the person taps — an idle pass
// proposes cards to Messages, a new first-session welcome, and two lines of
// app copy that claimed memory the app does not have are replaced. It ships
// behind an account-level flag the server reports. This file holds two claims:
//
//   1. OFF IS TODAY. Every M2 path checks the flag before it does anything,
//      the flag fails closed, and the legacy copy is the same string it was.
//   2. ON DOES WHAT THE FOUNDER'S FILES SAY. The pure rules in services/m2.ts
//      are imported and RUN, not read: which cards reach the chat screen, what
//      an edit sends, when the starter-map button may show.
//
// The server's API doc did not exist when this was built; what the app assumes
// is in docs/m2-app-assumptions.md, and the A-numbers below refer to it.
//
// Boots nothing, contacts no server, requires no server file. Node strips the
// types from services/m2.ts and utils/guideContent.ts on import.
//
//   node scripts/smoke-m2-app.mjs

import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
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

// guideContent.ts imports '../constants/features' without an extension; the
// same hook check-guide-matches-app.mjs uses lets Node follow it.
register(pathToFileURL(path.join(HERE, 'lib', 'ts-extension-resolve.mjs')));
const m2 = await import(pathToFileURL(path.join(ROOT, 'services', 'm2.ts')).href);
const guide = await import(pathToFileURL(path.join(ROOT, 'utils', 'guideContent.ts')).href);

// ===========================================================================
// 1. THE FLAG FAILS CLOSED
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
  ok('every failure shape of the status call answers m2: false and no count',
    failures.length >= 3 && failures.every((r) => /m2: false/.test(r) && /starterCount: null/.test(r)),
    failures.join(' | ') || 'getFirstSessionStatus not found');
  ok('the success shape reads the flag and the count through the pure parsers',
    /m2: parseM2Flag\(j\), starterCount: readStarterCount\(j\)/.test(body));
}

const chatSrc = read('app/(tabs)/index.tsx');
const chat = codeOnly(chatSrc);
ok('boot believes the flag only when the status ANSWERED',
  /const isM2 = firstStatus\?\.ok === true && firstStatus\.m2 === true;/.test(chat));
ok('...and publishes it for the screens outside the chat',
  /setM2\(isM2\);\s*setM2Flag\(isM2\);/.test(chat));
ok('m2 state starts FALSE, so nothing M2 renders before boot answers',
  /const \[m2, setM2\] = useState\(false\);/.test(chat) && /const m2Ref = useRef\(false\);/.test(chat));
{
  const store = codeOnly(read('services/m2Store.ts'));
  ok('the shared flag starts FALSE and only a strict true turns it on',
    /let m2On = false;/.test(store) && /const next = on === true;/.test(store));
}

// ===========================================================================
// 2. OFF IS TODAY — every M2 path is behind the flag
// ===========================================================================
console.log('\n2. off is today');
{
  const sub = chat.indexOf('subscribeInbox((s) =>');
  const head = chat.lastIndexOf('useEffect(() => {', sub);
  ok('the card subscription returns before subscribing when M2 is off',
    sub > -1 && head > -1 && /if \(!m2\) return;/.test(chat.slice(head, sub)));
  const st = chat.indexOf('subscribeStarterComplete(');
  const stHead = chat.lastIndexOf('useEffect(() => {', st);
  ok('the starter-complete subscription returns before subscribing when M2 is off',
    st > -1 && stHead > -1 && /if \(!m2\) return;/.test(chat.slice(stHead, st)));
}
{
  const fn = (name) => { const at = chat.indexOf(`const ${name} = useCallback(`); return at === -1 ? '' : chat.slice(at, at + 300); };
  ok('reading the chat cards is a no-op when M2 is off',
    /^const readChatCards = useCallback\(async \(\): Promise<void> => \{\s*if \(!m2Ref\.current\) return;/.test(fn('readChatCards')));
  ok('the fallback look after a reply is a no-op when M2 is off',
    /^const lookForChatCards = useCallback\(\(\) => \{\s*if \(!m2Ref\.current\) return;/.test(fn('lookForChatCards')));
  ok('the first read on M2 waits for the flag',
    /useEffect\(\(\) => \{\s*if \(!m2\) return;\s*readChatCards\(\)/.test(chat));
  ok('the focus refresh is a no-op when M2 is off',
    /useFocusEffect\(\s*React\.useCallback\(\(\) => \{\s*if \(!m2Ref\.current\) return;\s*readChatCards\(\)/.test(chat));
  // m2-api.md: "Chat cards no longer wait on a pass: the done frame's
  // cardsAdded names them." No loop, no interval, no re-arming timer.
  ok('no polling: nothing re-arms a look, and nothing runs on an interval',
    !/setInterval\(/.test(chat) && !/M2_PENDING_(POLL|MAX)_MS|M2_PASS_START_GRACE_MS/.test(chat + read('services/m2.ts'))
      && (fn('lookForChatCards').match(/setTimeout\(/g) || []).length === 1);
  ok('after a reply the app reads only when the done frame says a card was made',
    /onM2Done: \(info\) => \{[\s\S]{0,400}if \(info\.cardsAdded\.length > 0\) readChatCards\(\)/.test(chat));
  ok('...and the done block cancels the fallback look queued in the same tick',
    /onM2Done: \(info\) => \{\s*if \(cardLookTimerRef\.current\) clearTimeout\(cardLookTimerRef\.current\);/.test(chat));
}
{
  // The done frame's m2 block reaches the chat only when the server sent one,
  // which it never does for an account off M2 (m2-api.md).
  ok('the stream hands on an m2 block only when the frame carries one',
    /if \(evt\.m2\) \{\s*const m2Info = parseM2Done\(evt\.m2\);\s*if \(m2Info\) cb\.onM2Done\?\.\(m2Info\);/.test(codeOnly(api)));
}
ok('the app no longer counts map entries itself — the server counts tapped cards',
  !/countMapEntries|getLatestMap\(\)\s*\.then/.test(chat) && !/countMapEntries/.test(read('services/m2.ts')));
ok('boot takes the server\'s count only on M2',
  /if \(isM2\) setStarterCount\(firstStatus\.starterCount\);/.test(chat));
ok('the pending card renders only on M2 and never over a crisis',
  /\{m2 && !crisisGated \? \(\s*<PendingMapCards cards=\{chatCards\} \/>/.test(chat));
ok('the mode control is hidden on M2 and ONLY on M2',
  /\{m2 \? null : \(\s*<WorkingModeControl/.test(chat));
ok('the mode boxes are suppressed on M2, first line of the rule',
  /const showModeBoxes = useMemo\(\(\) => \{\s*if \(m2\) return false;/.test(chat));
ok('the starter-map button is gated through starterMapButtonAllowed on the server count',
  /const starterMapHandler = starterMapButtonAllowed\(m2, starterCount\) \? handleViewStarterMap : undefined;/.test(chat)
    && /onViewStarterMap=\{starterMapHandler\}/.test(chat));
ok('...and the bubble list re-renders when that gate opens',
  /\[messages, starterMapHandler\]/.test(chat));
{
  const offRows = [null, 0, 1, 2, 5].filter((n) => m2.starterMapButtonAllowed(false, n) !== true);
  ok('OFF: the starter-map button is allowed at every count, as today',
    offRows.length === 0, `blocked at ${JSON.stringify(offRows)}`);
  ok('ON: it waits for the server\'s count to reach two',
    m2.starterMapButtonAllowed(true, 0) === false && m2.starterMapButtonAllowed(true, 1) === false
      && m2.starterMapButtonAllowed(true, 2) === true && m2.starterMapButtonAllowed(true, 3) === true);
  ok('ON with no count from the server: the marker decides, as off M2 (the server gates the marker)',
    m2.starterMapButtonAllowed(true, null) === true);
}

// ===========================================================================
// 3. WHICH CARDS REACH THE CHAT SCREEN
// ===========================================================================
console.log('\n3. chat cards');
const S = 'session-now';
// A chat card: the reply's [CARD:{kind,part,label,fields,said}], fields bundled.
const chatItem = (over = {}) => ({
  kind: 'part',
  source: 'chat',
  payload: { part: 'manager', label: 'the drafter', fields: { strategy: 'rewrites until it asks for nothing', 'when-it-fires': 'before asking' } },
  said: 'yes, that is what I do',
  status: 'pending',
  ...over,
});
// An idle-pass proposal: one value.
const passItem = (over = {}) => ({
  kind: 'detail',
  payload: { part: 'wound', field: 'trigger', value: 'the moment before asking' },
  anchor: 'right before I ask',
  recognised: 'partial',
  status: 'pending',
  ...over,
});
const row = (items, over = {}) => ({
  id: over.id || 'msg-1', kind: 'm2_card', payload: { sessionId: S, sessionDate: 'Nov 5', items },
  createdAt: '2026-11-05T00:00:00Z', readAt: null, actedAt: null, expiresAt: null, ...over,
});
{
  const got = m2.chatPendingCards([row([chatItem()])], S);
  ok('a chat card from this session reaches the chat screen',
    got.length === 1 && got[0].messageId === 'msg-1' && got[0].itemIndex === 0);
  ok('...marked by the pass\'s field instead of a source',
    m2.chatPendingCards([row([chatItem({ source: undefined, confirmedInChat: true })])], S).length === 1
      && m2.chatPendingCards([row([chatItem({ source: undefined, confirmed_in_chat: true })])], S).length === 1);
  ok('a belief card and a middle-ground card (both spellings) reach it too',
    m2.chatPendingCards([row([
      chatItem({ kind: 'belief', payload: { label: 'my worth', fields: { belief: 'my worth isn\'t earned' } } }),
      chatItem({ kind: 'middle', payload: { label: 'at the sink', fields: { note: 'washing up, not bracing' } } }),
      chatItem({ kind: 'middle_ground', payload: { label: 'on the walk', fields: { note: 'the walk home' } } }),
    ])], S).length === 3);
}
{
  const cases = [
    ['another session\'s card', [row([chatItem()], { payload: { sessionId: 'older', items: [chatItem()] } })]],
    ['an idle-pass proposal (Messages only)', [row([passItem()])]],
    ['an accepted item', [row([chatItem({ status: 'accepted' })])]],
    ['a declined item', [row([chatItem({ status: 'declined' })])]],
    ['an expired item', [row([chatItem({ status: 'expired' })])]],
    ['an item with nothing to show', [row([chatItem({ payload: { part: 'wound', label: ' ', fields: { belief: '  ' } } })])]],
    ['an item of an unknown kind', [row([chatItem({ kind: 'key_moment' })])]],
    ['an old-stack pending_parts row', [{ ...row([chatItem()]), kind: 'pending_parts' }]],
  ];
  for (const [label, rows] of cases) {
    ok(`stays off the chat screen: ${label}`, m2.chatPendingCards(rows, S).length === 0);
  }
  ok('an empty session id matches nothing', m2.chatPendingCards([row([chatItem()])], '').length === 0);
}
{
  const mixed = row([chatItem({ status: 'accepted' }), chatItem(), passItem(), chatItem()]);
  const got = m2.chatPendingCards([mixed], S).map((c) => c.itemIndex);
  ok('item indices are the row\'s own, so a tap acts on the right item',
    JSON.stringify(got) === '[1,3]', JSON.stringify(got));
}

console.log('\n3a. the server\'s pending read and done block (m2-api.md)');
{
  const body = {
    sessionId: S, passRunning: true, mapEntryCount: 1, starterPending: true,
    cards: [
      { messageId: 'msg-1', itemIndex: 0, item: chatItem() },
      { messageId: 'msg-1', itemIndex: 1, item: passItem({ confirmedInChat: true }) },   // a pass item said yes to
      { messageId: 'msg-1', itemIndex: 2, item: chatItem({ status: 'expired' }) },
      { messageId: 'msg-1', itemIndex: 3, item: { kind: 'key_moment', payload: {} } },
      { messageId: 7, itemIndex: 4, item: chatItem() },
      { messageId: 'msg-1', itemIndex: -1, item: chatItem() },
    ],
  };
  const ans = m2.parseM2Pending(body, S);
  ok('the pending read keeps exactly the cards the chat screen can show',
    ans && JSON.stringify(ans.cards.map((c) => c.itemIndex)) === '[0,1]', JSON.stringify(ans && ans.cards.map((c) => c.itemIndex)));
  ok('...and carries the server\'s count',
    ans && ans.starterCount === 1 && ans.starterPending === true);
  ok('an answer for another session is dropped', m2.parseM2Pending({ ...body, sessionId: 'other' }, S) === null);
  ok('a non-object body is dropped', m2.parseM2Pending(null, S) === null && m2.parseM2Pending('x', S) === null);
  // The block as m2-api.md shows it (Nov 5 rewrite).
  const d = m2.parseM2Done({
    stack: 'm2', passScheduled: false,
    cardsAdded: [{ messageId: 'msg-1', itemIndex: 0 }, { messageId: 'x', itemIndex: -1 }, { itemIndex: 2 }, 'junk'],
    mapEntryCount: 1, firstSession: true, starterPending: false,
  });
  ok('the done block reads the cards this reply made, dropping malformed entries',
    d && JSON.stringify(d.cardsAdded) === JSON.stringify([{ messageId: 'msg-1', itemIndex: 0 }]), JSON.stringify(d && d.cardsAdded));
  ok('...and the server\'s count of tapped cards',
    d && d.starterCount === 1 && d.starterPending === false);
  ok('a reply that made no card says so with an empty list',
    JSON.stringify(m2.parseM2Done({ stack: 'm2', mapEntryCount: 0 }).cardsAdded) === '[]');
  ok('a done block naming another stack, or no block, is ignored',
    m2.parseM2Done({ stack: 'legacy', cardsAdded: [] }) === null && m2.parseM2Done(undefined) === null);
  ok('chat-screen cards start their clock through the M2 seen route, item by item',
    /api\.markM2CardsSeen\(messageId, \[itemIndex\]\)/.test(codeOnly(read('services/m2Store.ts')))
      && /\/api\/m2\/cards\/\$\{encodeURIComponent\(messageId\)\}\/seen/.test(api));
}

console.log('\n3b. what a card says, and what an edit sends');
{
  const it = chatItem();
  ok('a chat card leads with its label, with its fields in order underneath',
    m2.m2ItemTitle(it) === 'the drafter'
      && JSON.stringify(m2.m2ItemFieldEntries(it).map((f) => f.key)) === '["strategy","when-it-fires"]');
  const noLabel = chatItem({ payload: { part: 'wound', fields: { belief: 'I am too much' } } });
  ok('a chat card with no label leads with its first field', m2.m2ItemTitle(noLabel) === 'I am too much');
  // m2-api.md: a chat card's payload.value is its name — the label, or the
  // first field's value.
  const asServed = chatItem({ payload: { part: 'fixer', fields: { pattern: 'I take on extra', fear: 'being seen failing' }, field: 'pattern', value: 'taking on extra' } });
  ok('with no label, the server\'s value is the name',
    m2.m2ItemTitle(asServed) === 'taking on extra' && m2.m2ItemHasOwnName(asServed) === true);
  const valueIsFirst = chatItem({ payload: { part: 'wound', fields: { belief: 'I am too much' }, field: 'belief', value: 'I am too much' } });
  ok('a value that is just the first field is not a name of its own (no repeated row)',
    m2.m2ItemHasOwnName(valueIsFirst) === false && m2.m2ItemHasOwnName(noLabel) === false && m2.m2ItemHasOwnName(it) === true);
  ok('a pass proposal leads with its value', m2.m2ItemTitle(passItem()) === 'the moment before asking');
  ok('the card\'s source line is the yes it came from, or the pass\'s anchor',
    m2.m2ItemSource(it) === 'yes, that is what I do' && m2.m2ItemSource(passItem()) === 'right before I ask');
  ok('a middle-ground card shows the line it came from',
    m2.m2ItemNote({ kind: 'middle_ground', payload: { label: 'at the sink', note: 'washing up, not bracing' } }) === 'washing up, not bracing'
      && m2.m2ItemNote(passItem()) === '');

  // Edits: m2-api.md's object edit is { "<field>": "<new value>" }.
  const draft = m2.m2EditDraft(it);
  ok('an untouched chat card sends no edit', m2.m2BuildEdit(it, draft) === undefined);
  const e1 = m2.m2BuildEdit(it, { ...draft, fields: { ...draft.fields, strategy: 'rewrites it ten times' } });
  ok('editing one bundled field sends only that field, flat',
    JSON.stringify(e1) === JSON.stringify({ strategy: 'rewrites it ten times' }), JSON.stringify(e1));
  const e3 = m2.m2BuildEdit(it, { ...draft, fields: { strategy: 'a', 'when-it-fires': 'b' } });
  ok('editing two fields sends both', JSON.stringify(e3) === JSON.stringify({ strategy: 'a', 'when-it-fires': 'b' }), JSON.stringify(e3));
  ok('the name is not editable: a changed headline alone sends nothing',
    m2.m2BuildEdit(it, { ...draft, title: 'the editor' }) === undefined);
  ok('emptying a field is not an edit — that is what "Doesn\'t fit" is for',
    m2.m2BuildEdit(it, { ...draft, fields: { ...draft.fields, strategy: '   ' } }) === undefined);
  ok('a card with no label edits its fields like any other',
    JSON.stringify(m2.m2BuildEdit(noLabel, { title: 'x', fields: { belief: 'I am a lot' } })) === JSON.stringify({ belief: 'I am a lot' }));
  const p = passItem();
  ok('a pass proposal\'s edit is a string, the shape every card path takes',
    m2.m2BuildEdit(p, { title: 'just before I ask', fields: {} }) === 'just before I ask'
      && m2.m2BuildEdit(p, m2.m2EditDraft(p)) === undefined);
}
{
  // first-session.md: never the map's words before they have met the thing.
  const PARTS = ['wound', 'fixer', 'skeptic', 'self-like', 'manager', 'firefighter', '', 'unknown-part'];
  const FIELDS = ['belief', 'feeling', 'story', 'body', 'history', 'worldview', 'trigger', 'voice', 'pattern',
    'selectivity', 'fear', 'what-it-protects', 'how-it-shows-up', 'desire', 'fantasy', 'what-it-built', 'agenda',
    'clenched-or-open', 'lean', 'strategy', 'what-it-manages', 'when-it-fires', 'what-it-gives', 'situation',
    'example', 'manner', 'memory', 'note', '', 'not-a-field'];
  const JARGON = /\b(wound|fixer|skeptic|firefighter|manager|self-like|unknown-part)\b/i;
  const RAWKEY = /\b[a-z]+-[a-z]+(?:-[a-z]+)*\b/;
  const leaks = [];
  for (const k of ['part', 'detail', 'voice', 'middle_ground', 'middle', 'second_wound', 'belief']) {
    for (const part of PARTS) for (const field of FIELDS) for (const label of ['', 'the planner']) {
      const single = m2.m2ItemCategory({ kind: k, payload: { part, field, label, value: 'x' } }) || '';
      const bundled = m2.m2ItemCategory({ kind: k, payload: { part, label, fields: { [field || 'x']: 'y' } } }) || '';
      for (const c of [single, bundled]) if (JARGON.test(c) || RAWKEY.test(c)) leaks.push(`${k}/${part}/${field} → "${c}"`);
    }
  }
  // Keys the server's own field table can still send (lib/m2/rules.js),
  // whether or not line 16 lists them, must never fall back to the generic.
  const SERVER_KEYS = ['fear', 'what-it-built', 'agenda', 'lean', 'history', 'manner', 'memory'];
  const generic = m2.m2FieldWords('not-a-field');
  const unlabelled = SERVER_KEYS.filter((k) => m2.m2FieldWords(k) === generic);
  ok('every key the server may still send has a label of its own', unlabelled.length === 0, unlabelled.join(', '));
  for (const f of [...FIELDS, ...SERVER_KEYS, 'stands-on', 'label']) {
    for (const kind of [undefined, 'part', 'belief', 'middle']) {
      const w = m2.m2FieldWords(f, kind);
      if (JARGON.test(w) || RAWKEY.test(w)) leaks.push(`field ${f} (${kind}) → "${w}"`);
    }
  }
  ok('no framework term or raw field key reaches a card\'s category or field labels',
    leaks.length === 0, leaks.slice(0, 5).join(' | '));
}
{
  // THE FIELDS A CARD MAY CARRY — mapping-m2 (3).md, line 16. The editor is
  // generic over a card's fields, so what can go wrong is a field reaching the
  // screen as "more about it", or two fields on one card reading the same.
  const BY_PART = {
    wound: ['belief', 'feeling', 'story', 'body', 'history', 'worldview', 'trigger', 'voice'],
    fixer: ['pattern', 'selectivity', 'what-it-protects', 'how-it-shows-up', 'body', 'history', 'worldview', 'desire', 'fantasy', 'voice'],
    skeptic: ['pattern', 'selectivity', 'what-it-protects', 'how-it-shows-up', 'body', 'history', 'worldview', 'desire', 'fantasy', 'voice'],
    manager: ['strategy', 'when-it-fires', 'what-it-gives', 'what-it-manages', 'trigger', 'situation', 'example', 'body', 'voice', 'worldview', 'story'],
    firefighter: ['strategy', 'when-it-fires', 'what-it-gives', 'what-it-manages', 'trigger', 'situation', 'example', 'body', 'voice', 'worldview', 'story'],
    'self-like': ['stands-on', 'body', 'clenched-or-open'],
  };
  const BY_KIND = { middle: ['label', 'note'], belief: ['belief'] };
  const generic = m2.m2FieldWords('not-a-field');
  const problems = [];
  const check = (who, keys, kind) => {
    const words = keys.map((k) => m2.m2FieldWords(k, kind));
    keys.forEach((k, i) => { if (words[i] === generic) problems.push(`${who}.${k} has no label of its own`); });
    const dupes = words.filter((w, i) => words.indexOf(w) !== i);
    if (dupes.length) problems.push(`${who}: two fields read "${dupes[0]}"`);
  };
  for (const [part, keys] of Object.entries(BY_PART)) check(part, keys, 'part');
  for (const [kind, keys] of Object.entries(BY_KIND)) check(kind, keys, kind);
  ok('every field mapping-m2 (3).md line 16 names has a readable label, distinct within its card',
    problems.length === 0, problems.join(' | '));
  ok('a belief card\'s belief is what they stand on, a wound\'s is the belief underneath',
    m2.m2FieldWords('belief', 'belief') === m2.m2FieldWords('stands-on')
      && m2.m2FieldWords('belief', 'part') !== m2.m2FieldWords('belief', 'belief'));

  // When the founder's file is on disk, the list above must still be its
  // line 16; when it is not, say so rather than pass quietly.
  const SPEC = process.env.M2_MAPPING_MD
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'mapping-m2 (3).md');
  if (fs.existsSync(SPEC)) {
    const line = fs.readFileSync(SPEC, 'utf8').split(/\r?\n/).find((l) => l.startsWith('Fields by part')) || '';
    const grab = (re) => ((line.match(re) || [])[1] || '').split(',').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean);
    const spec = {
      wound: grab(/wound: ([^.]+)\./),
      fixer: grab(/Fixer and skeptic: ([^.]+)\./),
      manager: grab(/Manager and firefighter: ([^.]+)\./),
      'self-like': grab(/Self-like: ([^.]+)\./),
    };
    const drift = Object.entries(spec)
      .filter(([p, keys]) => JSON.stringify(keys) !== JSON.stringify(BY_PART[p]))
      .map(([p, keys]) => `${p}: file says ${JSON.stringify(keys)}`);
    ok('the field list above is still the founder\'s line 16', line && drift.length === 0, drift.join(' | ') || 'line not found');
  } else {
    console.log(`  [3c] SKIP  field-list comparison — ${SPEC} not on disk; compared on the machine that built this`);
  }
}

// ===========================================================================
// 4. THE SERVER'S COUNT
// ===========================================================================
console.log('\n4. starter map count');
ok('the count is read under each name the server may use',
  m2.readStarterCount({ starterMapCount: 2 }) === 2 && m2.readStarterCount({ tappedCardCount: 1 }) === 1
    && m2.readStarterCount({ mapEntryCount: 3 }) === 3);
ok('no number, a negative, a string or a missing body is "said nothing" (null), never zero',
  [undefined, null, {}, { starterMapCount: -1 }, { starterMapCount: '2' }, { mapEntryCount: NaN }]
    .every((b) => m2.readStarterCount(b) === null));
{
  const store = codeOnly(read('services/m2Store.ts'));
  ok('every accept updates the count from the server\'s answer, from either surface',
    /if \(res\.starterCount !== null\) setStarterCount\(res\.starterCount\);/.test(store));
  ok('"the tap completed the starter map" reaches the chat screen only on a write that landed',
    /if \(res\.ok && res\.starterMapComplete\)/.test(store));
}
ok('the chat screen puts the button on the newest reply when the tap completed it',
  /subscribeStarterComplete\(\(\) => \{\s*setFirstSessionPending\(false\);[\s\S]{0,400}starterMapComplete: true/.test(chat));

// ===========================================================================
// 5. ONE CARD, BOTH SURFACES
// ===========================================================================
console.log('\n5. Messages and the chat screen');
const msgs = codeOnly(read('app/messages.tsx'));
ok('an m2_card row renders through the shared M2 card',
  /m\.kind === M2_CARD_KIND \? \(\s*<M2InboxCard key=\{m\.id\} message=\{m\} onEditFocus=\{ensureEditVisible\} \/>/.test(msgs));
ok('the legacy cards carry nothing M2', !/M2_VARIANT|showItem/.test(msgs));
const cardSrc = read('components/m2/M2Cards.tsx');
const card = codeOnly(cardSrc);
ok('both surfaces accept and decline through the store, so a tap updates the count wherever it happens',
  /acceptM2Item\(messageId, itemIndex, m2BuildEdit\(item, draft\)\)/.test(card)
    && /declineM2Item\(messageId, itemIndex\)/.test(card)
    && !/api\.actOnMessage|api\.declineMessageItems/.test(card));
ok('every card says it is not on the map until they add it',
  /It isn’t on your map until you add it\./.test(cardSrc));
ok('a failed write is said back, not shown as added',
  /if \(res\.ok\) \{[\s\S]*?onSettled\('accepted'\)[\s\S]*?\} else \{[\s\S]*?setFailed\(true\)/.test(card));
ok('Messages leaves out items it cannot read, has nothing to show for, or that expired',
  /isM2Item\(it\) && !!m2ItemTitle\(it\) && it\.status !== 'expired'/.test(card));

// ===========================================================================
// 6. THE WELCOME (founder, 2026-11-08; server API agreed with the chat stack)
// ===========================================================================
console.log('\n6. the welcome');
{
  // The fallback is the founder's first-conversation text, exactly. It came in
  // the founder's Nov 8 fixes, not in a file, so its record is here: change it
  // only with the founder's words.
  const FOUNDER_FIRST_CONVERSATION = "Welcome. I'm glad you're here. Before anything else, we'll build the start of your map together, so the first conversation is a little different: I'll ask a bit more than I usually will, and when something sounds like it belongs on your map, I'll offer it, and you decide. What we build today is a rough sketch; it gets sharper as we go, and if something I say doesn't fit, say so. After that, it's your space. Start wherever you like.";
  const m = chatSrc.match(/const M2_WELCOME =([\s\S]*?);\r?\n/);
  const val = m ? new Function(`return (${m[1]});`)() : null;
  ok('M2_WELCOME is the founder\'s first-conversation text, byte for byte',
    val === FOUNDER_FIRST_CONVERSATION, typeof val === 'string' ? `${val.length}ch` : 'not found');
  ok('...and passes its own guard, so the fallback can never be refused',
    m2.sanitizeM2Welcome(val) === val);

  // The guard on the server's text: what reaches the screen is plain words.
  const W = m2.sanitizeM2Welcome;
  ok('a plain server welcome passes, trimmed and with line endings normalised',
    W('  Welcome back.\r\nWe\'re still building the start of your map.  ') === 'Welcome back.\nWe\'re still building the start of your map.');
  const refused = [
    ['not a string', 42], ['null', null], ['empty', '   '],
    ['too long', 'x'.repeat(m2.M2_WELCOME_MAX_CHARS + 1)],
    ['an unfilled placeholder', 'Welcome back. Last time, [filled by the server from their map or last session].'],
    ['a marker', 'Welcome back. [CHAT_META:{"detectedPart":"wound"}]'],
    ['JSON', '{"welcome":"Welcome back."}'],
    ['a tag', 'Welcome <b>back</b>'],
    ['a control character', 'Welcome\u0007 back'],
  ];
  const leaked = refused.filter(([, v]) => W(v) !== null).map(([label]) => label);
  ok('anything that is not plain words is refused, and the fallback shows instead',
    leaked.length === 0, leaked.join(', '));

  // The server's fields, as m2-api.md (Nov 8) names them.
  const st = m2.parseM2Starter({ m2Welcome: 'Welcome back. We can pick that up.', m2WelcomeKind: 'returning', starterOverlay: true, starterMapFinished: false });
  ok('the status / build answer reads as welcome, overlay and finished',
    st.welcome === 'Welcome back. We can pick that up.' && st.overlay === true && st.finished === false);
  const none = m2.parseM2Starter({ m2Welcome: null, starterOverlay: 'yes' });
  ok('...and anything missing or mistyped is "the server did not say", never a guess',
    none.welcome === null && none.overlay === null && none.finished === null
      && JSON.stringify(m2.parseM2Starter(undefined)) === JSON.stringify({ welcome: null, overlay: null, finished: null }));
  const d = m2.parseM2Done({ stack: 'm2', cardsAdded: [], starterOverlay: false, starterMapFinished: true });
  ok('each reply\'s done block carries the turn\'s overlay and whether the starter map is finished',
    d.starterOverlay === false && d.starterMapFinished === true);

  // Where the server's text comes from, and that it is read only on M2.
  const apiCode = codeOnly(api);
  // The routes the server runs (staging deployment a35748e4, 2026-11-08). The
  // two that were proposed in passing and never built must not be called.
  ok('skip and build are the deployed routes, /api/m2/starter/skip and /build',
    /apiFetch\('\/api\/m2\/starter\/skip'/.test(apiCode) && /apiFetch\('\/api\/m2\/starter\/build'/.test(apiCode)
      && !/\/api\/m2\/starter-map|\/api\/m2\/welcome/.test(apiCode));
  ok('the boot welcome and overlay are read only for a flagged account, through the guard',
    /m2Welcome: parseM2Flag\(j\) \? parseM2Starter\(j\)\.welcome : null,/.test(apiCode)
      && /starterOverlay: parseM2Flag\(j\) \? parseM2Starter\(j\)\.overlay : null,/.test(apiCode));
  {
    const a = api.indexOf('async getFirstSessionStatus()');
    const b = a === -1 ? -1 : api.indexOf('\n  },', a);
    const body = a === -1 || b === -1 ? '' : api.slice(a, b);
    const failures = body.match(/return \{[^}]*ok: false[^}]*\}/g) || [];
    ok('every failure shape of the status call answers m2Welcome: null and starterOverlay: null',
      failures.length >= 3 && failures.every((r) => /m2Welcome: null/.test(r) && /starterOverlay: null/.test(r)));
  }
  ok('the next conversation\'s read ignores an answer for an account off M2',
    /if \(!j \|\| typeof j !== 'object' \|\| !parseM2Flag\(j\)\) return null;\s*return parseM2Starter\(j\);/.test(apiCode));
  ok('boot hands the server\'s text to the selector only on M2',
    /m2WelcomeRef\.current = isM2 \? firstStatus\.m2Welcome : null;/.test(chat)
      && /const finalGreeting = openerFor\(isFirstSession, isM2, m2WelcomeRef\.current\);/.test(chat));
  ok('End Session clears the old welcome and reads the next one only on M2, before Continue',
    /m2WelcomeRef\.current = null;\s*nextOverlayRef\.current = null;\s*if \(m2Ref\.current\) \{\s*api\.getM2NextConversation\(\)/.test(chat));
}

// ===========================================================================
// 6a. SKIP THE STARTER MAP, AND BUILD IT LATER (founder, 2026-11-08)
// ===========================================================================
console.log('\n6a. skip and build');
{
  ok('the skip chip is the founder\'s words, on M2 only, while the overlay is on, never over a crisis',
    /\{m2 && starterOverlay && !crisisGated \? \(\s*<Pressable\s*onPress=\{handleSkipStarterMap\}/.test(chat)
      && />Skip the starter map for now<\/Text>/.test(chatSrc));
  ok('OFF M2 the banner is exactly what it was: firstSessionPending alone',
    /\{\(m2 \? starterOverlay : firstSessionPending === true\) \? \(/.test(chat));
  ok('the overlay follows the server: the status at the start, each reply after',
    /setStarterOverlay\(isM2 && \(firstStatus\.starterOverlay \?\? isFirstSession\)\);/.test(chat)
      && /if \(info\.starterOverlay !== null\) setStarterOverlay\(info\.starterOverlay\);/.test(chat));
  ok('the next conversation\'s overlay is the server\'s word, read with its welcome',
    /setStarterOverlay\(m2Ref\.current && \(nextOverlayRef\.current \?\? firstSessionPending === true\)\);/.test(chat));
  {
    const at = chat.indexOf('const handleSkipStarterMap = useCallback(');
    const body = at === -1 ? '' : chat.slice(at, chat.indexOf('}, [starterSkipBusy]);', at));
    ok('skip tells the server, and the chip goes only on its yes, for the conversation it was asked about',
      /api\.m2StarterSkip\(sid\)/.test(body)
        && /if \(!res\.ok \|\| sid !== sessionIdRef\.current\) \{[\s\S]*?return;\s*\}\s*setStarterOverlay\(false\);/.test(body));
    ok('skip flips nothing else: no first-session flag, no welcome, no count',
      !/setFirstSessionPending|m2WelcomeRef|setStarterCount/.test(body));
  }
  {
    const at = chat.indexOf('const startStarterMapConversation = () => {');
    const body = at === -1 ? '' : chat.slice(at, chat.indexOf('useFocusEffect(', at));
    const ask = body.indexOf('api.m2StarterBuild(sid)');
    const finished = body.indexOf('if (res.finished) return;');
    const refusal = body.indexOf('if (!res.ok) {');
    const firstChange = body.search(/setMessages\(|sessionIdRef\.current = sid|setStarterOverlay\(true\)/);
    ok('"Build my starter map" asks the server first, for a NEW conversation id',
      /const sid = uuidv4\(\);\s*const res = await api\.m2StarterBuild\(sid\);/.test(body));
    ok('...and a finished starter map (409) or a refusal changes nothing on screen',
      ask > -1 && finished > ask && refusal > finished && firstChange > refusal);
    ok('...opens with the starter-map welcome through the one selector, overlay on',
      /const greeting = openerFor\(true, m2Ref\.current, m2WelcomeRef\.current\);/.test(body)
        && /setStarterOverlay\(true\);/.test(body));
    ok('...and asks before replacing a conversation that already has their words in it',
      /if \(!hasTurns\) \{ begin\(\); return; \}\s*Alert\.alert\(/.test(body));
  }
  const mapSrc = codeOnly(read('app/(tabs)/map.tsx'));
  ok('the empty map offers "Build my starter map" on M2 while the starter map is unfinished',
    /\{m2\s*&& view === 'triangle'\s*&& loadStatus === 'loaded'\s*&& layers\.length === 0\s*&& firstSessionDoneAt === null \? \(/.test(mapSrc)
      && /requestStarterMap\(\);\s*router\.push\('\/'\);/.test(mapSrc)
      && />Build my starter map<\/Text>/.test(mapSrc));
  ok('OFF M2 the empty map keeps its old button, exactly as it was',
    /\{!m2\s*&& view === 'triangle'\s*&& loadStatus === 'loaded'\s*&& layers\.length === 0\s*&& firstSessionDoneAt === null \? \(/.test(mapSrc));
}

// ===========================================================================
// 7. INVENTED MEMORY, REPLACED BEHIND THE FLAG (ruling 2026-11-05)
// ===========================================================================
console.log('\n7. invented memory');
{
  ok('OFF: the Guide and onboarding get WELCOME_SLIDES itself',
    guide.welcomeSlidesFor(false) === guide.WELCOME_SLIDES);
  const off = guide.WELCOME_SLIDES.flatMap((s) => s.body);
  const on = guide.welcomeSlidesFor(true).flatMap((s) => s.body);
  const changed = off.map((p, i) => [p, on[i]]).filter(([a, b]) => a !== b);
  ok('ON: exactly one paragraph differs, and the decks are otherwise the same',
    on.length === off.length && changed.length === 1
      && guide.welcomeSlidesFor(true).every((s, i) => s.title === guide.WELCOME_SLIDES[i].title),
    `${changed.length} paragraphs differ`);
  const [was, now] = changed[0] || ['', ''];
  ok('the paragraph that goes is the "learns who you are" one', /learns who you are/.test(was) && /knows you/.test(was));
  ok('its replacement claims only what the app keeps',
    !/learns|knows you|who you are|remember|transcript/i.test(now) && /map/.test(now) && /key moments/.test(now), now);
  for (const f of ['app/(tabs)/guide.tsx', 'app/onboarding.tsx']) {
    const src = codeOnly(read(f));
    ok(`${f} reads the deck through the flag`,
      /welcomeSlidesFor\(useM2Flag\(\)\)/.test(src) && !/\bWELCOME_SLIDES\b/.test(src));
  }
}
{
  const src = read('components/map/PartFolderModal.tsx');
  const code = codeOnly(src);
  const grab = (name) => {
    const m = src.match(new RegExp(`const ${name} =\\s*([\\s\\S]*?);\\r?\\n`));
    return m ? new Function(`return (${m[1]});`)() : null;
  };
  const was = grab('YOU_BIOGRAPHY');
  const now = grab('YOU_BIOGRAPHY_M2');
  ok('the YOU folder\'s legacy text is still built from the old biography', /description: YOU_BIOGRAPHY \+ '\\n\\n' \+ YOU_REST,/.test(code));
  ok('the old biography is the one the audit names', typeof was === 'string' && /career/.test(was) && /brilliantly/.test(was));
  ok('the M2 biography assumes no career, no relationships, and praises nothing',
    typeof now === 'string' && !/career|relationship|brilliant|whole life/i.test(now), now || 'not found');
  ok('only the biography changes on M2 — the rest of the folder is the same text',
    /return m2 && partKey === 'self-like' \? YOU_BIOGRAPHY_M2 \+ '\\n\\n' \+ YOU_REST : meta\.description;/.test(code));
  ok('the folder reads the flag before its early return, so the hook runs every render',
    /const m2 = useM2Flag\(\);\s*if \(!partKey\) return null;/.test(code)
      && /\{descriptionFor\(partKey, meta, m2\)\}/.test(code));
}
{
  // The end-session fallback (other-surfaces-audit.md, SessionSummaryModal.tsx
  // :203-204): "Your map has been updated" on every fallback, written or not.
  const src = read('components/session/SessionSummaryModal.tsx');
  const code = codeOnly(src);
  const grab = (name) => {
    const m = src.match(new RegExp(`const ${name} = ('[^']*');`));
    return m ? new Function(`return (${m[1]});`)() : null;
  };
  const was = grab('FALLBACK');
  const now = grab('FALLBACK_M2');
  ok('OFF: the summary fallback is the same sentence pair as before',
    was === 'This session has been saved to your journal. Your map has been updated.', String(was));
  ok('ON: it keeps the journal sentence and drops the map claim',
    now === 'This session has been saved to your journal.' && !/map/i.test(now), String(now));
  ok('the modal picks between them on the flag, read on every render',
    /const m2 = useM2Flag\(\);/.test(code) && /\{m2 \? FALLBACK_M2 : FALLBACK\}/.test(code));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
