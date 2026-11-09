// A DELETED JOURNAL ENTRY LEAVES THE SERVER TOO, EVENTUALLY (founder,
// 2026-11-08).
//
// journal.remove() used to fire DELETE /api/journal/:id once. A shared entry
// deleted offline stayed on the server, read by the AI as context and included
// in an export, against the policy's "deleted". services/journalDeletes.ts now
// keeps a persisted list of ids the server hasn't confirmed and retries them on
// the next launch and after the next successful sync, until each returns OK; a
// 404 counts as done. The local delete is never blocked.
//
// THE SHIPPED QUEUE, NOT A COPY. journalDeletes.ts keeps its React Native
// imports below the pure queue, so the region above them transpiles and loads
// here in plain Node, against an in-memory store and a fake server. The wiring
// (who calls it, and the 404 rule in services/api.ts) is read from source.
//
//   node scripts/smoke-journal-delete-retry.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const src = read('services/journalDeletes.ts');
const cut = src.indexOf('import AsyncStorage from');
if (cut < 0) throw new Error('journalDeletes.ts: RN import boundary not found — cannot lift the pure queue');
const mod = { exports: {} };
new Function('module', 'exports', 'require',
  ts.transpileModule(src.slice(0, cut) + '\nmodule.exports = { createJournalDeleteQueue, parsePendingDeletes };\n',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
)(mod, mod.exports, require);
const { createJournalDeleteQueue, parsePendingDeletes } = mod.exports;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

// An in-memory AsyncStorage key and a server that answers what we tell it.
function world({ online = true, initial = null } = {}) {
  const w = {
    raw: initial,
    online,
    calls: [],
    seenOnListDuringCall: [],
    loadThrows: false,
    saveThrows: false,
    answer: (id) => w.online,
  };
  w.queue = createJournalDeleteQueue({
    load: async () => { if (w.loadThrows) throw new Error('storage'); return w.raw; },
    save: async (raw) => { if (w.saveThrows) throw new Error('storage'); w.raw = raw; },
    deleteOnServer: async (id) => {
      w.calls.push(id);
      w.seenOnListDuringCall.push(parsePendingDeletes(w.raw).includes(id));
      await new Promise((r) => setTimeout(r, 1));
      return w.answer(id);
    },
  });
  w.list = () => parsePendingDeletes(w.raw);
  return w;
}

(async () => {
  console.log('journal deletes — retried until the server confirms');

  {
    const w = world({ online: true });
    await w.queue.remove('a');
    ok('online: the server is asked once, and nothing is left waiting',
      w.calls.join() === 'a' && w.list().length === 0 && w.raw === null, JSON.stringify({ calls: w.calls, raw: w.raw }));
    ok('the id is on the list BEFORE the request goes, so a killed app keeps it',
      w.seenOnListDuringCall[0] === true);
  }
  {
    const w = world({ online: false });
    await w.queue.remove('a');
    await w.queue.remove('b');
    ok('offline: both ids stay on the persisted list, in order', JSON.stringify(w.list()) === '["a","b"]', w.raw);
    w.online = true;
    await w.queue.retry();
    ok('the retry clears them once the server answers', w.list().length === 0 && w.raw === null, w.raw);
    ok('...asking for each again', w.calls.slice(2).join() === 'a,b', w.calls.join());
  }
  {
    // 404 is "already gone". The queue takes the boolean from the API layer;
    // services/api.ts is where 404 becomes true (checked from source below).
    const w = world({ initial: JSON.stringify(['gone']) });
    w.answer = (id) => id === 'gone';
    await w.queue.retry();
    ok('an id the server confirms (OK or 404) comes off the list', w.list().length === 0);
  }
  {
    const w = world({ initial: JSON.stringify(['a', 'b', 'c']) });
    w.answer = (id) => id !== 'b';
    await w.queue.retry();
    ok('a retry stops at the first failure and keeps it and everything after it',
      JSON.stringify(w.list()) === '["b","c"]' && w.calls.join() === 'a,b', `${w.raw} / ${w.calls}`);
    w.answer = () => true;
    await w.queue.retry();
    ok('...and the next retry finishes them', w.list().length === 0);
  }
  {
    const w = world({ online: false });
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => w.queue.remove(id)));
    ok('deletes at the same moment never lose each other\'s ids', JSON.stringify(w.list().slice().sort()) === '["a","b","c","d"]', w.raw);
  }
  {
    const w = world({ initial: JSON.stringify(['a', 'b']) });
    await Promise.all([w.queue.retry(), w.queue.retry(), w.queue.retry()]);
    ok('three retries at once ask the server once per id', w.calls.join() === 'a,b', w.calls.join());
  }
  {
    const w = world({ online: false, initial: JSON.stringify(['old']) });
    w.loadThrows = true;
    await w.queue.remove('new');
    w.loadThrows = false;
    ok('a list that can\'t be read is never written over', JSON.stringify(w.list()) === '["old"]', w.raw);
  }
  {
    const w = world({ online: false });
    w.saveThrows = true;
    let threw = false;
    try { await w.queue.remove('a'); await w.queue.retry(); } catch { threw = true; }
    ok('storage failing never throws out of a delete or a retry', !threw);
  }
  {
    const w = world();
    w.queue = createJournalDeleteQueue({
      load: async () => w.raw, save: async (r) => { w.raw = r; },
      deleteOnServer: async () => { throw new Error('network'); },
    });
    let threw = false;
    try { await w.queue.remove('a'); } catch { threw = true; }
    ok('a request that throws counts as not confirmed, and the id waits', !threw && JSON.stringify(w.list()) === '["a"]');
  }
  ok('an unreadable stored list reads as empty, never as a crash',
    parsePendingDeletes('{') .length === 0 && parsePendingDeletes('"x"').length === 0
      && JSON.stringify(parsePendingDeletes('["a",3,"","a","b"]')) === '["a","b"]');

  // ---- the wiring, from source ----------------------------------------------
  const codeOnly = (s) => s.split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  const journal = codeOnly(read('services/journal.ts'));
  const api = codeOnly(read('services/api.ts'));
  const layout = codeOnly(read('app/_layout.tsx'));
  const remove = journal.slice(journal.indexOf('async remove('), journal.indexOf('randomDeepDivePrompt'));
  ok('remove() deletes the device copy first and awaits it',
    /await encryptedStorage\.deleteEntry\(id\);[\s\S]*void deleteJournalOnServer\(id\);/.test(remove));
  ok('...and hands the server copy to the queue without awaiting it, never calling the API once directly',
    /void deleteJournalOnServer\(id\);/.test(remove) && !/api\.deleteJournalEntry/.test(journal));
  ok('a successful sync retries what the server hasn\'t confirmed',
    /if \(r && r\.ok\) void retryPendingJournalDeletes\(\);/.test(journal));
  ok('the next launch retries it, after boot, without awaiting',
    /void retryPendingJournalDeletes\(\);/.test(layout)
      && layout.indexOf('void retryPendingJournalDeletes();') > layout.indexOf("console.log('[boot] boot sequence complete')"));
  const del = api.slice(api.indexOf('async deleteJournalEntry('), api.indexOf('async deleteJournalEntry(') + 600);
  ok('services/api.ts counts a 404 as done', /return res\.ok \|\| res\.status === 404;/.test(del));

  console.log(`\nsmoke-journal-delete-retry: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
