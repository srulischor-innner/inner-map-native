// Smoke for the APP SIDE OF M2 — which, since 1.4.0, is the app.
//
// M2 is the founder's locked chat design (mapping-m2 (2).md, first-session
// (1).md, rulings of 2026-11-05): one prompt, no mode boxes, the chat never
// writes the map — a yes in chat becomes a card the person taps — an idle pass
// proposes cards to Messages, a new first-session welcome, and two lines of
// app copy that claimed memory the app does not have are replaced. It shipped
// first behind an account-level flag; on 2026-11-09 the founder made it the
// only path (no staging, no flag). This file holds two claims:
//
//   1. THERE IS NO OFF. The flag, its parser, its store and every screen's
//      read of it are gone, and so is the old stack's copy they chose between.
//   2. M2 DOES WHAT THE FOUNDER'S FILES SAY. The pure rules in services/m2.ts
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
// 1. THERE IS NO FLAG (1.4.0, founder 2026-11-09)
// ===========================================================================
console.log('\n1. no flag: M2 is the app');
function appSources(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) appSources(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const FLAG_READ = /\b(?:useM2Flag|setM2Flag|getM2Flag|parseM2Flag|isM2|m2Ref|m2On)\b/;
{
  const readers = ['app', 'components', 'services', 'utils'].flatMap((d) => appSources(d))
    .filter((p) => FLAG_READ.test(codeOnly(read(p))));
  ok('no app source reads, sets or parses an M2 flag', readers.length === 0, readers.join(', '));
  ok('...and the scan can see one (negative control)', FLAG_READ.test('const m2 = useM2Flag();'));
  ok('the pure module no longer exports a flag parser', typeof m2.parseM2Flag === 'undefined');
}

const api = read('services/api.ts');
{
  const a = api.indexOf('async getFirstSessionStatus()');
  const b = a === -1 ? -1 : api.indexOf('\n  },', a);
  const body = a === -1 || b === -1 ? '' : api.slice(a, b);
  const failed = (body.match(/const failed = \{[^}]*\};/) || [''])[0];
  ok('every failure shape of the status call answers no count, no welcome, no overlay — and no m2 field',
    /starterCount: null/.test(failed) && /m2Welcome: null/.test(failed) && /starterOverlay: null/.test(failed)
      && !/\bm2:/.test(failed) && (body.match(/return failed;/g) || []).length >= 3, failed || 'getFirstSessionStatus not found');
  ok('the success shape reads the count and the starter map through the pure parsers',
    /starterCount: readStarterCount\(j\),/.test(body) && /const starter = parseM2Starter\(j\);/.test(body)
      && /m2Welcome: starter\.welcome,/.test(body) && /starterOverlay: starter\.overlay,/.test(body));
}

const chatSrc = read('app/(tabs)/index.tsx');
const chat = codeOnly(chatSrc);

// ===========================================================================
// 2. THE CARD PATHS RUN UNCONDITIONALLY, AND STILL NEVER POLL
// ===========================================================================
console.log('\n2. the card paths');
ok('the inbox subscription runs from mount, with no guard',
  /useEffect\(\(\) => subscribeInbox\(\(s\) => mergePendingCards\(chatPendingCards\(s\.messages, sessionIdRef\.current\), false\)\), \[mergePendingCards\]\);/.test(chat));
ok('the starter-complete subscription runs from mount, with no guard',
  /useEffect\(\(\) => \{\s*return subscribeStarterComplete\(/.test(chat));
{
  const fn = (name) => { const at = chat.indexOf(`const ${name} = useCallback(`); return at === -1 ? '' : chat.slice(at, at + 300); };
  ok('reading the chat cards starts straight away, for the current session',
    /^const readChatCards = useCallback\(async \(\): Promise<void> => \{\s*const sid = sessionIdRef\.current;/.test(fn('readChatCards')));
  ok('the cards are read at mount and on every return to the chat',
    /useEffect\(\(\) => \{\s*readChatCards\(\)\.catch\(\(\) => \{\}\);\s*\}, \[readChatCards\]\);/.test(chat)
      && /useFocusEffect\(\s*React\.useCallback\(\(\) => \{\s*readChatCards\(\)/.test(chat));
  // m2-api.md: "Chat cards no longer wait on a pass: the done frame's
  // cardsAdded names them." No loop, no interval, no re-arming timer.
  ok('no polling: nothing re-arms a look, and nothing runs on an interval',
    !/setInterval\(/.test(chat) && !/M2_PENDING_(POLL|MAX)_MS|M2_PASS_START_GRACE_MS/.test(chat + read('services/m2.ts'))
      && (fn('lookForChatCards').match(/setTimeout\(/g) || []).length === 1);
  ok('after a reply the app reads only when the done frame says a card was made',
    /onM2Done: \(info\) => \{[\s\S]{0,700}if \(info\.cardsAdded\.length > 0\) \{[\s\S]{0,500}readChatCards\(\)\.catch/.test(chat));
  ok('...and the done block cancels the fallback look queued in the same tick',
    /onM2Done: \(info\) => \{\s*if \(cardLookTimerRef\.current\) clearTimeout\(cardLookTimerRef\.current\);/.test(chat));
}
ok('the stream hands on an m2 block only when the frame carries one',
  /if \(evt\.m2\) \{\s*const m2Info = parseM2Done\(evt\.m2\);\s*if \(m2Info\) cb\.onM2Done\?\.\(m2Info\);/.test(codeOnly(api)));
ok('the app no longer counts map entries itself — the server counts tapped cards',
  !/countMapEntries|getLatestMap\(\)\s*\.then/.test(chat) && !/countMapEntries/.test(read('services/m2.ts')));
ok('boot takes the server\'s count',
  /setStarterCount\(firstStatus\.starterCount\);/.test(chat));
ok('cards never render over a crisis — under their reply, and the unclaimed fallback',
  /\{!crisisGated && m\.m2CardKeys && m\.m2CardKeys\.length > 0 \? \(\s*<M2InlineCards/.test(chat)
    && /\{!crisisGated \? \(\s*<PendingMapCards cards=\{unattachedCards\} \/>/.test(chat));
ok('the starter-map button is gated through starterMapButtonAllowed on the server count',
  /const starterMapHandler = starterMapButtonAllowed\(starterCount\) \? handleViewStarterMap : undefined;/.test(chat)
    && /onViewStarterMap=\{starterMapHandler\}/.test(chat));
ok('...and the bubble list re-renders when that gate opens, or a card under a reply moves on',
  /\[messages, starterMapHandler, crisisGated, cardRegistry, settleTappedCard\]/.test(chat));
ok('it waits for the server\'s count to reach two',
  m2.starterMapButtonAllowed(0) === false && m2.starterMapButtonAllowed(1) === false
    && m2.starterMapButtonAllowed(2) === true && m2.starterMapButtonAllowed(3) === true);
ok('with no count from the server the marker decides (the server gates the marker)',
  m2.starterMapButtonAllowed(null) === true);

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
    'example', 'manner', 'memory', 'note', 'underneath', '', 'not-a-field'];
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
  // Added after line 16, each from its own founder file.
  const ADDED_AFTER_LINE_16 = {
    // home-layer-for-code.md section 3 (Nov 8): the wound row's `underneath`.
    wound: ['underneath'],
  };
  const BY_PART = {
    wound: ['belief', 'feeling', 'story', 'body', 'history', 'worldview', 'trigger', 'voice', 'underneath'],
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
  // Who the part is without what it carries — not another "… underneath",
  // which on a wound card already names the burden (the belief, the feeling).
  const under = m2.m2FieldWords('underneath');
  ok('the wound\'s underneath reads as who the part is without what it carries',
    under === 'who it is without what it carries'
      && !['belief', 'feeling'].some((k) => m2.m2FieldWords(k) === under), under);
  ok('a pass proposal of it says the same words, never the raw key',
    m2.m2ItemCategory({ kind: 'part', payload: { part: 'wound', field: 'underneath', value: 'x' } }) === under
      && m2.m2ItemCategory({ kind: 'detail', payload: { part: 'wound', field: 'underneath', label: 'the lonely one', value: 'x' } })
        === `the lonely one · ${under}`);

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
      .filter(([p, keys]) => JSON.stringify([...keys, ...(ADDED_AFTER_LINE_16[p] || [])]) !== JSON.stringify(BY_PART[p]))
      .map(([p, keys]) => `${p}: file says ${JSON.stringify(keys)}`);
    ok('the field list above is still the founder\'s line 16', line && drift.length === 0, drift.join(' | ') || 'line not found');
  } else {
    console.log(`  [3c] SKIP  field-list comparison — ${SPEC} not on disk; compared on the machine that built this`);
  }
  const HOME = process.env.M2_HOME_LAYER_MD
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'home-layer-for-code.md');
  if (fs.existsSync(HOME)) {
    ok('the Home layer still adds `underneath` to the wound row',
      /Wound row: add field `underneath`/.test(fs.readFileSync(HOME, 'utf8')));
  } else {
    console.log(`  [3c] SKIP  Home layer check — ${HOME} not on disk`);
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
ok('in Messages a card still says it is not on the map until they add it',
  /\{surface === 'inbox' \? <Text style=\{styles\.note\}>It isn’t on your map until you add it\.<\/Text> : null\}/.test(cardSrc));

// CARD TIMING (founder): the card comes with the offer, the tap is the yes.
console.log('\n5a. card timing');
{
  ok('under the offer the card reads as a choice: "ADD TO YOUR MAP" / "Not now"',
    />\{busy \? 'ADDING…' : 'ADD TO YOUR MAP'\}</.test(cardSrc) && />Not now<\/Text>/.test(cardSrc)
      && /<Text style=\{styles\.kicker\}>FOR YOUR MAP<\/Text>/.test(cardSrc));
  ok('...and nothing on it reads as something already agreed',
    !/WAITING FOR YOU TO ADD|ADD TO MY MAP|Doesn’t fit/.test(cardSrc));
  {
    // The resolved branch: everything from `if (outcome) {` to its return's end.
    const at = card.indexOf('  if (outcome) {');
    const branch = at === -1 ? '' : card.slice(at, card.indexOf('\n  }\n', at) + 4);
    ok('a resolved card — tapped, declined, replaced, expired or settled — has no buttons',
      branch.length > 100 && !/<Pressable/.test(branch) && /styles\.titleDim/.test(branch));
  }
  ok('each resolution has its own words, and "settled" claims nothing',
    /declined: 'Left off your map\.',/.test(card) && /superseded: 'Replaced by the newer offer below\.',/.test(card)
      && /settled: null,/.test(card));

  // The done frame's resolutions, in the shape the chat stack set (2026-11-08):
  // cardsResolved [{ messageId, itemIndex, status, reason, replacedBy? }].
  const d = m2.parseM2Done({
    stack: 'm2', cardsAdded: [{ messageId: 'msg-1', itemIndex: 2 }],
    cardsResolved: [
      { messageId: 'msg-1', itemIndex: 0, status: 'declined', reason: 'no' },
      { messageId: 'msg-1', itemIndex: 1, status: 'superseded', reason: 'corrected', replacedBy: { messageId: 'msg-1', itemIndex: 2 } },
      { messageId: 'msg-1', itemIndex: 5, status: 'declined', reason: 'left-off', replacedBy: { messageId: 'msg-1', itemIndex: 9 } },
      { messageId: 'msg-1', itemIndex: 6, status: 'declined', reason: 'something new' },
      { messageId: 'msg-1', itemIndex: 3, status: 'accepted' },
      { messageId: 7, itemIndex: 4, status: 'declined' },
    ],
  });
  ok('a reply\'s declined and superseded cards are read, with reason and replacement; anything else is dropped',
    JSON.stringify(d.cardsResolved) === JSON.stringify([
      { messageId: 'msg-1', itemIndex: 0, status: 'declined', reason: 'no', replacedBy: null },
      { messageId: 'msg-1', itemIndex: 1, status: 'superseded', reason: 'corrected', replacedBy: { messageId: 'msg-1', itemIndex: 2 } },
      { messageId: 'msg-1', itemIndex: 5, status: 'declined', reason: 'left-off', replacedBy: null },
      { messageId: 'msg-1', itemIndex: 6, status: 'declined', reason: null, replacedBy: null },
    ]), JSON.stringify(d.cardsResolved));
  ok('a done frame with no resolutions has an empty list', JSON.stringify(m2.parseM2Done({ stack: 'm2' }).cardsResolved) === '[]');

  // The chat screen's registry.
  ok('the cards a reply offered attach to that reply\'s bubble',
    /m\.id === streamId\s*\? \{ \.\.\.m, m2CardKeys:/.test(chat));
  ok('the reply\'s resolutions grey cards out where they are, through the shown-status rule',
    /for \(const r of info\.cardsResolved\) settleCard\(m2CardKey\(r\.messageId, r\.itemIndex\), m2ResolvedShownStatus\(r\)\);/.test(chat));

  // ROUND 4 (founder): "Untapped is not declined. Only 'Not now' or a no
  // declines a card." "Left off your map." is for those two alone.
  const S = (status, declinedReason, extra = {}) => m2.m2ItemShownStatus({ kind: 'part', payload: { value: 'x' }, status, declinedReason, ...extra });
  ok('"Left off your map." only for a typed no or "Not now"',
    S('declined', 'no') === 'declined' && S('declined', 'user') === 'declined');
  ok('...a decline for any other reason (the withdrawn "untapped", "left-off", or none) claims nothing',
    S('declined', 'untapped') === 'settled' && S('declined', 'left-off') === 'settled' && S('declined', undefined) === 'settled');
  ok('a carried-over card is still pending, still tappable',
    S('pending', undefined, { carriedOver: true, carriedOverAt: '2026-11-08T12:00:00Z' }) === 'pending' && S(undefined, undefined) === 'pending');
  ok('accepted, superseded and expired show as the server says',
    S('accepted') === 'accepted' && S('superseded') === 'superseded' && S('expired') === 'expired');
  const R = (status, reason) => m2.m2ResolvedShownStatus({ messageId: 'm', itemIndex: 0, status, reason, replacedBy: null });
  ok('a reply\'s decline says "Left off" only for their no; a supersede is "Replaced" in every conversation',
    R('declined', 'no') === 'declined' && R('declined', 'left-off') === 'settled' && R('declined', null) === 'settled'
      && R('superseded', 'corrected') === 'superseded');
  ok('Messages shows each item through the same rule',
    /outcome=\{outcomes\[i\] \?\? \(m2ItemShownStatus\(it\) === 'pending' \? null : \(m2ItemShownStatus\(it\) as Resolved\)\)\}/.test(card));
  {
    const carried = { kind: 'part', source: 'chat', confirmedInChat: true, carriedOver: true, carriedOverAt: '2026-11-08T12:00:00Z',
      payload: { part: 'wound', fields: { belief: 'I am too much' }, field: 'belief', value: 'I am too much' }, status: 'pending' };
    const viaPending = m2.parseM2Pending({ sessionId: 's1', cards: [{ messageId: 'r1', itemIndex: 0, item: carried }] }, 's1');
    const viaInbox = m2.chatPendingCards([{ id: 'r1', kind: 'm2_card', payload: { sessionId: 's1', items: [carried] } }], 's1');
    ok('a carried-over card stays on the chat screen, from either read, so the chat never greys it',
      viaPending && viaPending.cards.length === 1 && viaInbox.length === 1);
  }
  ok('only a pending card moves on: nothing un-resolves',
    /prev\[key\] && prev\[key\]\.status === 'pending'/.test(chat));
  ok('a server read keeps resolved cards resolved, and greys a card the whole pending list no longer has',
    /if \(!next\[k\] \|\| next\[k\]\.status === 'pending'\) next\[k\] = \{ card: c, status: 'pending' \};/.test(chat)
      && /if \(e\.status === 'pending' && !listed\.has\(k\)\) next\[k\] = \{ \.\.\.e, status: 'settled' \};/.test(chat)
      && /mergePendingCards\(ans\.cards, true\);/.test(chat));
  ok('a typed yes writes nothing: no path but a tap accepts a card',
    (read('app/(tabs)/index.tsx').match(/acceptM2Item\(/g) || []).length === 0
      && /acceptM2Item\(messageId, itemIndex, m2BuildEdit\(item, draft\)\)/.test(card));
}
ok('a failed write is said back, not shown as added',
  /if \(res\.ok && res\.written > 0\) \{[\s\S]*?onSettled\('accepted'\)[\s\S]*?\} else \{[\s\S]*?setFailed\(true\)/.test(card));
// m2-api.md: act on a card that isn't pending answers ok with written: 0.
ok('an accept that wrote nothing greys the card and claims nothing — never "added"',
  /\} else if \(res\.ok\) \{[\s\S]{0,400}onSettled\('settled'\);/.test(card)
    && /return \{ ok: res\.ok, written: res\.written \};/.test(codeOnly(read('services/m2Store.ts'))));
ok('Messages leaves out a superseded item: its replacement is the one to decide on',
  /it\.status !== 'expired' && it\.status !== 'superseded'/.test(card));
ok('Messages leaves out items it cannot read, has nothing to show for, or that expired',
  /isM2Item\(it\) && !!m2ItemTitle\(it\) && it\.status !== 'expired'/.test(card));

// ===========================================================================
// 6. THE WELCOME (founder, 2026-11-08; server API agreed with the chat stack)
// ===========================================================================
console.log('\n6. the welcome');
{
  // The fallback is the founder's first-conversation text, exactly. It came as
  // the founder's replacement of the Nov 8 text, relayed in words, not in a
  // file, so its record is here: change it only with the founder's words.
  const FOUNDER_FIRST_CONVERSATION = "Welcome. We'll start by building the beginning of your map, so that when you open it there's something real there, in your own words, to come back to. That makes this first conversation a little different from how it will usually be: I'll take more of the lead, ask more than I normally would, and when something sounds like it belongs on your map, I'll offer it and you decide. What we build today is a rough sketch; it gets sharper as we go, and if something I say doesn't fit, say so. After that, it's your space: you lead, we go at your pace, and I follow what you bring.";
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
  ok('the boot welcome and overlay come off the status through the pure parser',
    /const starter = parseM2Starter\(j\);/.test(apiCode) && /m2Welcome: starter\.welcome,/.test(apiCode)
      && /starterOverlay: starter\.overlay,/.test(apiCode));
  ok('the next conversation\'s read takes any answer with a body, through the same parser',
    /if \(!j \|\| typeof j !== 'object'\) return null;\s*return parseM2Starter\(j\);/.test(apiCode));
  ok('boot hands the server\'s text to the selector',
    /m2WelcomeRef\.current = firstStatus\.m2Welcome;/.test(chat)
      && /const finalGreeting = openerFor\(isFirstSession, m2WelcomeRef\.current\);/.test(chat));
  ok('End Session clears the old welcome and reads the next one before Continue',
    /m2WelcomeRef\.current = null;\s*nextOverlayRef\.current = null;\s*api\.getM2NextConversation\(\)/.test(chat));
}

// ===========================================================================
// 6a. SKIP THE STARTER MAP, AND BUILD IT LATER (founder, 2026-11-08)
// ===========================================================================
console.log('\n6a. skip and build');
{
  ok('the skip chip is the founder\'s words, while the overlay is on, never over a crisis',
    /\{starterOverlay && !crisisGated \? \(\s*<Pressable\s*onPress=\{handleSkipStarterMap\}/.test(chat)
      && />Skip the starter map for now<\/Text>/.test(chatSrc));
  ok('the banner follows the starter-map overlay, and only that',
    /\{starterOverlay \? \(\s*<View style=\{styles\.firstSessionBanner\}/.test(chat));
  ok('the overlay follows the server: the status at the start, each reply after',
    /setStarterOverlay\(firstStatus\.starterOverlay \?\? isFirstSession\);/.test(chat)
      && /if \(info\.starterOverlay !== null\) setStarterOverlay\(info\.starterOverlay\);/.test(chat));
  ok('the next conversation\'s overlay is the server\'s word, read with its welcome',
    /setStarterOverlay\(nextOverlayRef\.current \?\? firstSessionPending === true\);/.test(chat));
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
      /const greeting = openerFor\(true, m2WelcomeRef\.current\);/.test(body)
        && /setStarterOverlay\(true\);/.test(body));
    ok('...and asks before replacing a conversation that already has their words in it',
      /if \(!hasTurns\) \{ begin\(\); return; \}\s*Alert\.alert\(/.test(body));
  }
  const mapSrc = codeOnly(read('app/(tabs)/map.tsx'));
  ok('the empty map offers "Build my starter map" while the starter map is unfinished',
    /\{view === 'triangle'\s*&& loadStatus === 'loaded'\s*&& layers\.length === 0\s*&& firstSessionDoneAt === null \? \(/.test(mapSrc)
      && /requestStarterMap\(\);\s*router\.push\('\/'\);/.test(mapSrc)
      && />Build my starter map<\/Text>/.test(mapSrc));
  ok('...and it is the empty map\'s only button: the old stack\'s START BUILDING is gone',
    !/>START BUILDING</.test(mapSrc) && (mapSrc.match(/style=\{styles\.mapEmptyCta\}/g) || []).length === 1);
}

// ===========================================================================
// 7. INVENTED MEMORY, REPLACED (ruling 2026-11-05; the only copy since 1.4.0)
// ===========================================================================
console.log('\n7. invented memory');
{
  const paras = guide.WELCOME_SLIDES.flatMap((s) => s.body);
  ok('there is one welcome deck: the selector between two is gone',
    typeof guide.welcomeSlidesFor === 'undefined' && typeof guide.M2_WELCOME_SLIDES === 'undefined');
  ok('no paragraph says it learns who you are or knows you',
    !paras.some((p) => /learns who you are|knows you/i.test(p)));
  const keeps = paras.filter((p) => /keeps your map/.test(p));
  ok('the paragraph in its place claims only what the app keeps',
    keeps.length === 1 && !/learns|knows you|who you are|remember|transcript/i.test(keeps[0]) && /key moments/.test(keeps[0]), keeps[0]);
  for (const f of ['app/(tabs)/guide.tsx', 'app/onboarding.tsx']) {
    const src = codeOnly(read(f));
    ok(`${f} reads WELCOME_SLIDES directly`, /\bWELCOME_SLIDES\b/.test(src) && !/welcomeSlidesFor/.test(src));
  }
}
{
  const src = read('components/map/PartFolderModal.tsx');
  const code = codeOnly(src);
  const grab = (name) => {
    const m = src.match(new RegExp(`const ${name} =\\s*([\\s\\S]*?);\\r?\\n`));
    return m ? new Function(`return (${m[1]});`)() : null;
  };
  const bio = grab('YOU_BIOGRAPHY');
  ok('the YOU folder\'s biography assumes no career, no relationships, and praises nothing',
    typeof bio === 'string' && /arrives at/.test(bio) && !/career|relationship|brilliant|whole life/i.test(bio), bio || 'not found');
  ok('the folder text is built from it, the same way as before',
    /description: YOU_BIOGRAPHY \+ '\\n\\n' \+ YOU_REST,/.test(code) && /\{meta\.description\}/.test(code)
      && !/YOU_BIOGRAPHY_M2|descriptionFor/.test(code));

  // The Wound folder's `underneath` row (home-layer-for-code.md section 3):
  // the person's words, and no row at all while it's empty.
  const bodySrc = (code.match(/const WOUND_BODY = (\{[\s\S]*?\}) as const;/) || [])[1];
  const body = bodySrc ? new Function(`return (${bodySrc});`)() : null;
  ok('the Wound folder declares the underneath row with the card\'s own words',
    body && body.underneath && body.underneath.key === 'underneath'
      && body.underneath.label.toLowerCase() === m2.m2FieldWords('underneath'),
    body && body.underneath ? body.underneath.label : 'not declared');
  const wound = code.slice(code.indexOf('function WoundSections'), code.indexOf('<GoDeeperSection', code.indexOf('function WoundSections')));
  ok('it reads the field for everyone',
    /const underneath = readField\(part, WOUND_BODY\.underneath\.key\);/.test(wound)
      && /<WoundSections\s+mapData=\{mapData\} part=\{part\} \/>/.test(code));
  ok('the row renders only when the field has their words, with no placeholder of its own',
    /\{underneath \? \(\s*<Section label=\{WOUND_BODY\.underneath\.label\} value=\{underneath\} placeholder="" \/>\s*\) : null\}/.test(wound));
  ok('the four rows that were there keep their placeholders, unchanged',
    ['The core belief is still taking shape...', 'The feeling beneath the story...', 'Where this lives in the body...', 'Still emerging...']
      .every((p) => wound.includes(`placeholder="${p}"`)));
}
{
  // The end-session fallback (other-surfaces-audit.md, SessionSummaryModal.tsx
  // :203-204): "Your map has been updated" on every fallback, written or not.
  const src = read('components/session/SessionSummaryModal.tsx');
  const code = codeOnly(src);
  const m = src.match(/const FALLBACK = ('[^']*');/);
  const now = m ? new Function(`return (${m[1]});`)() : null;
  ok('the summary fallback keeps the journal sentence and claims no map write',
    now === 'This session has been saved to your journal.' && !/map/i.test(now), String(now));
  ok('...and it is the only fallback the modal shows', /\{FALLBACK\}/.test(code) && !/FALLBACK_M2/.test(code));
}

// ===========================================================================
// THE AXIS RENAME — CHANGE-LIST-2026-11-08.md ruling 5: "blended → you
// leading", not "self-led". Only the label words.
// ===========================================================================
console.log('\n8. the axis rename');
{
  ok('the bars\' right pole is "You Leading", and the two-way chooser is gone',
    m2.AXIS_RIGHT_M2 === 'You Leading' && typeof m2.blendedAxisRight === 'undefined');

  const src = read('components/map/SpectrumDetailModal.tsx');
  const code = codeOnly(src);
  const lift = (name) => {
    const m = code.match(new RegExp(`const ${name}: SpectrumCopy = (\\{[\\s\\S]*?\\n\\});`));
    return m ? new Function(`return (${m[1]});`)() : null;
  };
  const legacy = lift('BLENDED_SELF_LED');
  const now = legacy ? m2.youLeadingAxisCopy(legacy) : null;
  ok('the source copy the rename reads from is the old "Blended → Self-Led" panel',
    legacy && legacy.title === 'Blended → Self-Led' && legacy.rightLabel === 'Self-Led');
  ok('the panel\'s title, pole and indicator heading say "You Leading"',
    now && now.title === 'Blended → You Leading' && now.rightLabel === 'You Leading'
      && now.rightIndicatorsHeading === 'You Leading indicators' && now.leftLabel === 'Blended',
    now ? `${now.title} | ${now.rightLabel} | ${now.rightIndicatorsHeading}` : 'not lifted');
  ok('no heading on the panel still says "Self-Led"',
    now && ![now.title, now.rightLabel, now.rightIndicatorsHeading, ...now.sections.map((s) => s.label)]
      .some((l) => /self-led/i.test(l)),
    now ? now.sections.map((s) => s.label).join(' | ') : '');
  ok('every sentence on the panel is unchanged: paragraphs, examples, how it moves',
    now && JSON.stringify(now.sections.map((s) => s.paragraphs)) === JSON.stringify(legacy.sections.map((s) => s.paragraphs))
      && now.howItMoves === legacy.howItMoves
      && JSON.stringify(now.leftPlaceholders) === JSON.stringify(legacy.leftPlaceholders)
      && JSON.stringify(now.rightPlaceholders) === JSON.stringify(legacy.rightPlaceholders)
      && now.leftIndicatorsHeading === legacy.leftIndicatorsHeading
      && now.leftKeysField === legacy.leftKeysField && now.rightKeysField === legacy.rightKeysField);
  ok('the panel always takes the renamed copy, and the other two axes not at all',
    /spectrum === 'blendedSelfLed' \? BLENDED_YOU_LEADING :/.test(code)
      && /const BLENDED_YOU_LEADING: SpectrumCopy = youLeadingAxisCopy\(BLENDED_SELF_LED\);/.test(code));
  const others = lift('OUTSIDE_IN');
  const frag = lift('FRAGMENTED');
  ok('Outside-In → Inside-Out and Fragmented → Flowing keep their names',
    others && others.title === 'Outside-In → Inside-Out' && frag && frag.title === 'Fragmented → Flowing');

  for (const [f, caption] of [
    ['components/map/ProgressStrip.tsx', 'When parts activate, are you it — or with it?'],
    ['app/(tabs)/journey.tsx', 'When parts activate, are you it — or with it? A relational shift.'],
  ]) {
    const c = codeOnly(read(f));
    ok(`${f}: the blended bar's right pole is AXIS_RIGHT_M2, its caption is the same sentence`,
      /leftLabel="Blended"\s*rightLabel=\{AXIS_RIGHT_M2\}/.test(c)
        && !/"Self-Led"/.test(c)
        && c.includes(`caption="${caption}"`)
        && /leftLabel="Outside-In"\s*rightLabel="Inside-Out"/.test(c)
        && /leftLabel="Fragmented"\s*rightLabel="Flowing"/.test(c));
  }
}

// ===========================================================================
// 9. END SESSION ON THE M2 IDLE SUMMARY (server, chat stack 8af8385, Nov 9)
// ===========================================================================
// The server answers /api/session-summary with the M2 idle summary, keeping the
// three fields the app reads (exploredText, mapShowingText, somethingToTryText)
// and `fallback`. The idle summary can leave "something to try" empty, and an
// empty field must leave nothing behind: no heading, no pause in the reveal, no
// line in the share export.
console.log('\n9. the End Session summary');
{
  const modal = codeOnly(read('components/session/SessionSummaryModal.tsx'));
  ok('an empty section renders nothing — not even its heading',
    /function Section\(\{ label, text \}: \{ label: string; text: string \}\) \{\s*if \(!text \|\| !text\.trim\(\)\) return null;/.test(modal));
  ok('all three, "something to try" included, go through that section',
    /<Section label="SOMETHING TO TRY" text=\{revealed\.somethingToTryText\} \/>/.test(modal)
      && /<Section label="WHAT WE EXPLORED" text=\{revealed\.exploredText\} \/>/.test(modal));
  ok('the word-by-word reveal skips an empty field instead of waiting on it',
    /while \(fieldIdx < fields\.length && !\(summary!\[fields\[fieldIdx\]\] \|\| ''\)\.trim\(\)\)/.test(modal));
  ok('one field with words is enough to show the summary; none shows the journal line',
    /const hasContent = !!summary && \(\s*summary\.exploredText\.trim\(\) \|\| summary\.mapShowingText\.trim\(\) \|\| summary\.somethingToTryText\.trim\(\)/.test(modal)
      && /\{\(failed \|\| \(summary && !hasContent\)\) \? \(/.test(modal));
  const exp = codeOnly(read('utils/sessionExport.ts'));
  ok('the share export drops an empty section', /function fmtSection\(label: string, text\?: string \| null\): string \{\s*const t = \(text \|\| ''\)\.trim\(\);\s*if \(!t\) return '';/.test(exp));
  const a = api.indexOf('async getSessionSummary(');
  const body = a === -1 ? '' : api.slice(a, api.indexOf('\n  },', a));
  ok('the response is read field by field, a missing one as empty, and fallback kept',
    /somethingToTryText: String\(j\.somethingToTryText \|\| ''\),/.test(body) && /fallback: !!j\.fallback,/.test(body));
  ok('the server\'s fallback shows the journal line',
    /if \(sum\.fallback\) setSummaryFailed\(true\);/.test(chat));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
