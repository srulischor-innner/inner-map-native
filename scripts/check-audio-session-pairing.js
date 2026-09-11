#!/usr/bin/env node
// THE RULE: NOTHING ACTIVATES THE AUDIO SESSION WITHOUT TAKING A LEASE THAT
// GIVES IT BACK.
//
// The bug this protects (2026-09): all three players in this app were created
// with `{ keepAudioSessionActive: true }`, which switches off the only two
// places expo-audio 1.1.1 deactivates the iOS session by itself
// (ios/AudioModule.swift: onPlaybackComplete, and Function("pause")). Nothing
// called setIsAudioActiveAsync(false), so one map-voice reply or one read-aloud
// line stopped the user's music for the life of the process and never told it
// it could resume. utils/audioSession.ts fixes it -- but only for players that
// go through it, and the next player somebody adds will not unless something
// says so.
//
// So this asserts the RULE, not today's file list, in two halves:
//
//   SOURCE half   -- createAudioPlayer / useAudioPlayer / setIsAudioActiveAsync
//                    and bare `.play()` exist ONLY inside the owner. A future
//                    player physically cannot reach setActive(true) without a
//                    lease, because it cannot reach a player without the owner.
//   BEHAVIOUR half -- the owner is transpiled with the repo's own TypeScript and
//                    RUN against stubs, and the pairing is asserted as
//                    behaviour. A source-shaped assertion ("the file contains
//                    setIsAudioActiveAsync(false)") is satisfied by code that
//                    never reaches the line; a lease that is taken and never
//                    honoured looks identical in source to one that is.
//
// WHAT THIS CANNOT DO, said plainly. There is no device, no AVAudioSession and
// no expo-audio native module here. It proves the JS bookkeeping is right and
// that the deactivate call is reached. It cannot prove iOS actually resumed the
// other app's audio, and it cannot prove DEACTIVATE_DEBOUNCE_MS is the right
// number -- that value is a founder-tunable guess and the owner logs it on
// every fire so it can be replaced with a measured one.
//
//   node scripts/check-audio-session-pairing.js
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const OWNER_REL = 'utils/audioSession.ts';
const OWNER = path.join(ROOT, 'utils', 'audioSession.ts');
const DIRS = ['app', 'components', 'utils', 'services', 'hooks'];

// ---------------------------------------------------------------------------
// SOURCE HALF
// ---------------------------------------------------------------------------

/** Blank out line/block comments and string bodies before scanning, so a call
 *  named inside a log line or a doc comment is not read as a call. utils/
 *  ttsStream.ts logs the literal text "p.play()" three times; without this the
 *  `.play()` rule below would fire on its own explanation. Crude on purpose --
 *  it only has to be right about which SPANS are code. */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += src[i] === '\r' ? '\r' : ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2; out += '  ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      i += 2; out += '  ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' '; i++;
      while (i < n) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === quote) { out += ' '; i++; break; }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const RULES = [
  {
    id: 'createAudioPlayer',
    re: /\b(?:createAudioPlayer|useAudioPlayer)\s*\(/,
    why: 'creates an expo-audio player directly. Players are created by createManagedPlayer() in ' +
      OWNER_REL + ' so the session lease is taken with the player, not remembered separately',
  },
  {
    id: 'setIsAudioActiveAsync',
    re: /\bsetIsAudioActiveAsync\s*\(/,
    why: 'calls setIsAudioActiveAsync directly. On iOS that pauses EVERY player in the process, ' +
      'not just this surface’s — only ' + OWNER_REL + ', which holds the count, may call it',
  },
  {
    // Deliberately "<anything>.play(" rather than a hand-listed set of
    // receivers: `p.play()`, `playerRef.current.play()`, `a.b.c.play()` and
    // `queue[0].play()` are all the same defect, and naming today's three
    // spellings is how a check ends up only catching a copy of the old
    // wording. `.playManaged(`, `.playbackRate(` etc. do not match — `play`
    // must be the whole member name.
    id: 'bare-play',
    re: /[\w$\])]\s*\.\s*play\s*\(/,
    why: 'calls player.play() directly. play() is Function("play") { try activateSession() } — ' +
      'the exact line that stops the user’s music. Route it through playManaged() so the ' +
      'activation takes a lease that gives the session back',
  },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The source rule, applied to {rel, src} pairs. Pure, so the negative control
 *  can run it over mutated sources without touching disk. */
function auditSources(files) {
  const failures = [];
  let scanned = 0;
  for (const { rel, src } of files) {
    if (rel === OWNER_REL) continue;
    scanned++;
    const code = stripCommentsAndStrings(src);
    for (const rule of RULES) {
      if (rule.re.test(code)) failures.push(`${rel} ${rule.why}`);
    }
  }
  return { failures, scanned };
}

// ---------------------------------------------------------------------------
// BEHAVIOUR HALF
// ---------------------------------------------------------------------------

// Five methods, deliberately. A console stub narrower than the thing it stands
// in for hides the bug it was built to catch: the owner logs on every branch,
// and a missing .debug/.info would throw inside a guard and read as "the
// handback did not fire" for the wrong reason.
const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

/** Transpile the owner and run it against stubs, with a hand-driven clock so
 *  the debounce is deterministic and the run is instant. */
function loadOwner(src, { os = 'ios' } = {}) {
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const calls = [];
  const timers = new Map();
  let nextTimer = 1;
  const fakeSetTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
  const fakeClearTimeout = (id) => { timers.delete(id); };
  const flush = () => {
    const due = [...timers.values()];
    timers.clear();
    for (const t of due) t.fn();
  };

  const audio = {
    createAudioPlayer: (source, options) => ({
      source, options, playing: false, removed: false,
      play() { this.playing = true; },
      pause() { this.playing = false; },
      remove() { this.removed = true; },
    }),
    setIsAudioActiveAsync: async (active) => { calls.push(active); },
  };
  const fakeRequire = (id) => {
    if (id === 'expo-audio') return audio;
    if (id === 'react-native') return { Platform: { OS: os } };
    throw new Error('the audio-session owner required something unexpected: ' + id);
  };

  const exportsObj = {};
  // eslint-disable-next-line no-new-func
  new Function('require', 'exports', 'module', 'console', 'setTimeout', 'clearTimeout', js)(
    fakeRequire, exportsObj, { exports: exportsObj }, quietConsole, fakeSetTimeout, fakeClearTimeout,
  );
  return { api: exportsObj, calls, flush, pending: () => timers.size };
}

const settle = () => Promise.resolve().then(() => {}).then(() => {});

/** The behaviour rule. Returns a list of failure strings; empty is green. Pure
 *  in the same sense as auditSources — it takes the source text, so the
 *  negative control can feed it a mutation. */
async function auditBehaviour(src) {
  const bad = [];
  const claim = (label, ok, extra) => { if (!ok) bad.push(`${label}${extra ? ` — ${extra}` : ''}`); };

  { // one lease, released, debounce elapsed
    const m = loadOwner(src);
    m.api.acquireAudioSession('t')();
    m.flush(); await settle();
    claim('a released lease hands the session back exactly once',
      m.calls.length === 1 && m.calls[0] === false, JSON.stringify(m.calls));
  }
  { // a second holder keeps it
    const m = loadOwner(src);
    const a = m.api.acquireAudioSession('a');
    const b = m.api.acquireAudioSession('b');
    a(); m.flush(); await settle();
    claim('one of two holders releasing does NOT hand the session back',
      m.calls.length === 0, JSON.stringify(m.calls));
    b(); m.flush(); await settle();
    claim('the last holder releasing does', m.calls.length === 1 && m.calls[0] === false, JSON.stringify(m.calls));
  }
  { // re-claim inside the window
    const m = loadOwner(src);
    m.api.acquireAudioSession('a')();
    m.api.acquireAudioSession('b');
    m.flush(); await settle();
    claim('a re-claim inside the debounce window cancels the handback',
      m.calls.length === 0, JSON.stringify(m.calls));
  }
  { // a capture is armed, and the next playback clears it
    const m = loadOwner(src);
    m.api.noteRecordingArmed();
    m.api.acquireAudioSession('a')();
    m.flush(); await settle();
    claim('an armed capture refuses the handback (setActive(false) under a live recorder)',
      m.calls.length === 0, JSON.stringify(m.calls));
    const p = m.api.createManagedPlayer({ uri: 'x' }, 'tts');
    m.api.playManaged(p, 'tts');
    m.api.releaseManagedPlayer(p);
    m.flush(); await settle();
    claim('the next managed playback clears a stale arm and its release hands back',
      m.calls.length === 1 && m.calls[0] === false, JSON.stringify(m.calls));
  }
  { // a tracked player still playing is never muted
    const m = loadOwner(src);
    const p = m.api.createManagedPlayer({ uri: 'x' }, 'note');
    m.api.playManaged(p, 'note');
    p.pause = function () {};              // native pause silently no-ops
    m.api.pauseManaged(p);
    m.flush(); await settle();
    claim('a tracked player still reporting playing refuses the handback rather than being muted by it',
      m.calls.length === 0, JSON.stringify(m.calls));
  }
  { // android
    const m = loadOwner(src, { os: 'android' });
    m.api.acquireAudioSession('a')();
    m.flush(); await settle();
    claim('android never deactivates (audioEnabled is a latch that silences every later play())',
      m.calls.length === 0, JSON.stringify(m.calls));
  }
  { // the record handoff can always get in front of a pending handback
    const m = loadOwner(src);
    m.api.acquireAudioSession('a')();
    claim('a handback is scheduled when the last lease drops', m.pending() === 1, `pending=${m.pending()}`);
    await m.api.whenAudioSessionSettled();
    claim('whenAudioSessionSettled() cancels a scheduled handback', m.pending() === 0, `pending=${m.pending()}`);
    m.flush(); await settle();
    claim('...and none fires afterwards', m.calls.length === 0, JSON.stringify(m.calls));
  }
  { // the read-aloud shape: a span lease bridges the gap between two players
    const m = loadOwner(src);
    const span = m.api.acquireAudioSession('tts-worker');
    for (const uri of ['1', '2']) {
      const p = m.api.createManagedPlayer({ uri }, 'tts');
      m.api.playManaged(p, 'tts');
      m.api.releaseManagedPlayer(p);
      m.flush(); await settle();
    }
    claim('the chain worker’s span lease holds the session across the gap between sentences',
      m.calls.length === 0, JSON.stringify(m.calls));
    span(); m.flush(); await settle();
    claim('and the session goes back once when the worker drains',
      m.calls.length === 1 && m.calls[0] === false, JSON.stringify(m.calls));
  }
  { // TWO PLAYERS AT ONCE — the scenario the whole single-owner argument rests
    // on, and the one a per-player handback gets wrong. Read-aloud and a user
    // voice note can be playing in the same scroll view; because
    // setIsAudioActiveAsync(false) pauses EVERY player in the process, one of
    // them finishing must NOT be able to hand the session back under the other.
    // Asserted here rather than only argued in the header.
    const m = loadOwner(src);
    const tts = m.api.createManagedPlayer({ uri: 'a' }, 'read-aloud');
    const note = m.api.createManagedPlayer({ uri: 'b' }, 'voice-note');
    m.api.playManaged(tts, 'read-aloud');
    m.api.playManaged(note, 'voice-note');
    m.api.pauseManaged(tts);
    m.flush(); await settle();
    claim('one of two overlapping players finishing does NOT mute the other',
      m.calls.length === 0, JSON.stringify(m.calls));
    m.api.pauseManaged(note);
    m.flush(); await settle();
    claim('the session goes back only once BOTH overlapping players are done',
      m.calls.length === 1 && m.calls[0] === false, JSON.stringify(m.calls));
  }
  { // ABUSE — the two shapes a real UI produces: a double tap on play, and a
    // teardown path that runs twice (unmount after an explicit release). Either
    // one mis-counting the refcount breaks the guarantee above in a way no
    // source-shaped rule could see.
    const m = loadOwner(src);
    const p = m.api.createManagedPlayer({ uri: 'x' }, 'voice-note');
    m.api.playManaged(p, 'voice-note');
    m.api.playManaged(p, 'voice-note');   // double tap: must not take two leases
    m.api.pauseManaged(p);
    m.flush(); await settle();
    claim('a double play() takes ONE lease, so a single pause still hands back',
      m.calls.length === 1 && m.calls[0] === false, JSON.stringify(m.calls));

    const m2 = loadOwner(src);
    const q = m2.api.createManagedPlayer({ uri: 'y' }, 'map-voice');
    m2.api.playManaged(q, 'map-voice');
    m2.api.releaseManagedPlayer(q);
    m2.api.releaseManagedPlayer(q);       // finish + unmount both tear down
    m2.flush(); await settle();
    claim('releasing the same player twice hands back once, not twice',
      m2.calls.length === 1 && m2.calls[0] === false, JSON.stringify(m2.calls));
  }
  return bad;
}

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

(async () => {
  if (!fs.existsSync(OWNER)) {
    console.error(`[audio-session-check] ✗ ${OWNER_REL} is missing — the session has no owner.`);
    process.exit(1);
  }
  const ownerSrc = fs.readFileSync(OWNER, 'utf8');

  const files = DIRS
    .map((d) => path.join(ROOT, d))
    .filter(fs.existsSync)
    .flatMap((d) => walk(d))
    .map((file) => ({ rel: path.relative(ROOT, file).replace(/\\/g, '/'), src: fs.readFileSync(file, 'utf8') }));

  const { failures: srcFailures, scanned } = auditSources(files);
  const behFailures = await auditBehaviour(ownerSrc);

  console.log(`[audio-session-check] files scanned: ${scanned} (owner: ${OWNER_REL})`);

  // ---- NEGATIVE CONTROLS ----
  // A check that cannot fail is not a check. Both halves get one.
  const victim = files.find((f) => f.rel !== OWNER_REL && /\bcreateManagedPlayer\s*\(/.test(f.src));
  let srcControlOk = false;
  if (victim) {
    const mutated = files.map((f) =>
      f === victim ? { ...f, src: f.src.replace(/\bcreateManagedPlayer\s*\(/, 'createAudioPlayer(') } : f);
    srcControlOk = auditSources(mutated).failures.length > srcFailures.length;
  }

  const mutatedOwner = ownerSrc.replace('await setIsAudioActiveAsync(false);', 'await Promise.resolve();');
  const ownerMutationApplied = mutatedOwner !== ownerSrc;
  const behControlOk = ownerMutationApplied && (await auditBehaviour(mutatedOwner)).length > behFailures.length;

  if (!victim) {
    console.error('  ✗ SOURCE negative control could not run — no surface uses createManagedPlayer(), so nothing goes through the owner');
    process.exit(1);
  }
  if (!srcControlOk) {
    console.error('  ✗ SOURCE NEGATIVE CONTROL FAILED — swapping a createManagedPlayer() back to a raw createAudioPlayer() did not trip this check.');
    console.error('    The source half is decoration. Fix the check before trusting it.');
    process.exit(1);
  }
  console.log('  ✓ source negative control: a raw createAudioPlayer() trips the check');

  if (!ownerMutationApplied) {
    console.error('  ✗ BEHAVIOUR negative control could not run — the literal `await setIsAudioActiveAsync(false);` is no longer in the owner, so the mutation had nothing to cut.');
    process.exit(1);
  }
  if (!behControlOk) {
    console.error('  ✗ BEHAVIOUR NEGATIVE CONTROL FAILED — removing the deactivate call did not trip this check.');
    console.error('    The behaviour half is decoration. Fix the check before trusting it.');
    process.exit(1);
  }
  console.log('  ✓ behaviour negative control: cutting the deactivate call trips the check');

  const failures = [...srcFailures, ...behFailures];
  if (failures.length) {
    console.error(`\n[audio-session-check] ${failures.length} FAILURE(S):`);
    for (const f of srcFailures) console.error('  ✗ SOURCE: ' + f);
    for (const f of behFailures) console.error('  ✗ BEHAVIOUR: ' + f);
    process.exit(1);
  }
  console.log(`  ✓ no surface outside ${OWNER_REL} creates a player, calls setIsAudioActiveAsync, or calls play()`);
  console.log('  ✓ every lease the owner hands out is honoured: released → session handed back, held → not');
})();
