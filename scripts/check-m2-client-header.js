// EVERY REQUEST SAYS "M2 CLIENT" (1.4.0, server ddb01a3).
//
// The server tells app versions apart by X-Inner-Map-M2: 1 alone
// (lib/m2/index.js isM2Client). Without it, the M2 cards this build renders come
// back as the old pending_parts. One request site that forgets it is a screen
// that quietly gets the old shape. This holds:
//   1. the shared builder (services/user.ts buildIdentityHeaders) adds it;
//   2. the fetch wrapper adds it whatever the caller built (withM2Header);
//   3. every other fetch / XMLHttpRequest in app code either builds its headers
//      through one of those, or adds the header itself — except reads of a
//      local file (fetch(uri)), which never reach the server;
// with a negative control.
//
//   node scripts/check-m2-client-header.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, (m) => ' '.repeat(m.length))).join('\n');
function sources(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out;
}
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const user = codeOnly(read('services/user.ts'));
check(/export const M2_CLIENT_HEADER = 'X-Inner-Map-M2';/.test(user) && /export const M2_CLIENT_HEADER_VALUE = '1';/.test(user),
  'the header is not X-Inner-Map-M2: 1 (the server compares the exact string "1")');
const builder = user.slice(user.indexOf('export async function buildIdentityHeaders('));
check(/\[M2_CLIENT_HEADER\]: M2_CLIENT_HEADER_VALUE,/.test(builder.slice(0, 600)),
  'buildIdentityHeaders no longer adds the M2 client header');
const api = codeOnly(read('services/api.ts'));
check(/headers: withM2Header\(opts\.headers\)/.test(api) && /out\[M2_CLIENT_HEADER\] = M2_CLIENT_HEADER_VALUE;/.test(api),
  'the fetch wrapper no longer adds the M2 client header');

// Every raw request site in app code.
const COVERED = /M2_CLIENT_HEADER|withM2Header|buildIdentityHeaders\(|authHeaders\(\)/;
const LOCAL_FILE = /^fetch\((?:uri|fileUri|localUri)\)/;
function offenders(files) {
  const out = [];
  for (const [f, code] of files) {
    for (const m of code.matchAll(/(^|[^\w.])(fetch\(|new XMLHttpRequest\()/g)) {
      const at = m.index + m[1].length;
      const call = code.slice(at, at + 40);
      if (LOCAL_FILE.test(call)) continue;
      const line = code.slice(0, at).split('\n').length;
      if (m[2].startsWith('new XMLHttpRequest')) {
        // A stream: its headers are fetched at the top of its method, well
        // above, and must actually be applied to this request below.
        // The nearest `const headers =` above, inside the same method (no
        // method header of the api object between them).
        const h = code.lastIndexOf('const headers = ', at);
        const between = h < 0 ? '' : code.slice(h, at);
        const fromBuilder = h >= 0
          && /^const headers = await (?:authHeaders|buildIdentityHeaders)\(/.test(code.slice(h, h + 60))
          && !/\n  async [A-Za-z]+\(/.test(between);
        const after = code.slice(at, at + 7000);
        const applied = /Object\.entries\(headers\)\.forEach\(\(\[k, v\]\) => xhr\.setRequestHeader\(k, /.test(after);
        if (!(fromBuilder && applied)) out.push(`${f}:${line}`);
        continue;
      }
      // Its headers: built in the statement itself, or in the few lines above.
      const around = code.slice(Math.max(0, at - 2500), at + 400);
      if (!COVERED.test(around)) out.push(`${f}:${line}`);
    }
  }
  return out;
}
const FILES = ['app', 'components', 'services', 'utils'].flatMap((d) => sources(d)).map((f) => [f, codeOnly(read(f))]);
const sites = FILES.reduce((n, [, c]) => n + [...c.matchAll(/(^|[^\w.])(fetch\(|new XMLHttpRequest\()/g)].length, 0);
const bad = offenders(FILES);
check(bad.length === 0, 'a request without the M2 client header: ' + bad.join(', '));
check(sites >= 8, `only ${sites} request sites seen — has the scan stopped seeing them?`);

// NEGATIVE CONTROL — a bare request to the server is caught.
{
  const planted = [['services/new.ts', "\n\n\nexport async function x() {\n  return fetch(`${BASE_URL}/api/new`, { method: 'GET' });\n}\n"]];
  if (offenders(planted).length !== 1) fails.push('NEGATIVE CONTROL: a bare request is not caught');
}

if (fails.length) {
  console.error('check-m2-client-header: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-m2-client-header: OK — X-Inner-Map-M2: 1 from the builder and the wrapper; ${sites} request sites, none bare`);
