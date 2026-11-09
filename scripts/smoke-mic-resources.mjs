// THE RESOURCES A SPOKEN MIC REPLY CARRIES, SHOWN AS LINKS (2026-11-09).
//
// The M2 server stops speaking URLs on a crisis turn and sends the list for the
// screen (lib/m2/mics.js CRISIS_RESOURCES, `crisis_resources` on the map-voice
// turn). utils/micResources.ts turns it into the card's links. This runs the
// real parser (Node strips its types) on the server's list as it stands, and
// on hostile shapes, then checks the wiring from source.
//
//   node scripts/smoke-mic-resources.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { parseMicResources } = await import(pathToFileURL(path.join(ROOT, 'utils', 'micResources.ts')).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

// The server's list (chat stack 8af8385, lib/m2/mics.js), pinned.
const SERVER = [
  { name: '988 Suicide & Crisis Lifeline', where: 'US', call: '988', text: '988' },
  { name: 'Samaritans', where: 'UK and Ireland', call: '116 123' },
  { name: 'Find A Helpline', where: 'anywhere else', url: 'https://findahelpline.com' },
  { name: 'Emergency services', where: 'immediate danger', call: 'your local emergency number (911 in the US)' },
  { name: 'National Domestic Violence Hotline', for: 'abuse or control', call: '1-800-799-7233', text: 'START to 88788', url: 'https://www.thehotline.org' },
  { name: 'National Alliance for Eating Disorders', for: 'eating', call: '1-866-662-1235', hours: 'weekdays 9am–7pm ET; 988 after hours' },
];
console.log('\nthe server\'s list');
const r = parseMicResources(SERVER);
const by = Object.fromEntries(r.map((x) => [x.name, x]));
const hrefs = (n) => (by[n] ? by[n].links.map((l) => l.href) : []);
ok('every entry survives, in order', r.length === 6 && r.map((x) => x.name).join('|') === SERVER.map((x) => x.name).join('|'));
ok('988: call and text', JSON.stringify(hrefs('988 Suicide & Crisis Lifeline')) === JSON.stringify(['tel:988', 'sms:988']));
ok('Samaritans: a spaced number still dials', JSON.stringify(hrefs('Samaritans')) === JSON.stringify(['tel:116123']));
ok('Find A Helpline: the https link opens', JSON.stringify(hrefs('Find A Helpline')) === JSON.stringify(['https://findahelpline.com']));
ok('emergency: words are shown, never dialled', hrefs('Emergency services').length === 0
  && by['Emergency services'].details[0] === 'your local emergency number (911 in the US)');
ok('the hotline: call, "START to 88788" texts 88788 with START, and its site',
  JSON.stringify(hrefs('National Domestic Violence Hotline')) === JSON.stringify(['tel:18007997233', 'sms:88788?body=START', 'https://www.thehotline.org']));
ok('...its button says where to text', by['National Domestic Violence Hotline'].links[1].label === 'Text START to 88788');
ok('the eating line: call, and its hours shown', JSON.stringify(hrefs('National Alliance for Eating Disorders')) === JSON.stringify(['tel:18666621235'])
  && by['National Alliance for Eating Disorders'].hours === 'weekdays 9am–7pm ET; 988 after hours');
ok('context is "where" or "for", whichever came', by['Samaritans'].context === 'UK and Ireland' && by['National Domestic Violence Hotline'].context === 'abuse or control');

console.log('\nwhat the wire cannot make tappable');
const hostile = parseMicResources([
  { name: 'A', call: 'javascript:alert(1)', text: 'sms:evil', url: 'http://plain.example' },
  { name: 'B', url: 'https://x.example/ ok' },
  { name: 'C', text: 'STOP to abc' },
  { name: '', call: '988' },
  null, 'string', 42,
  { name: 'D', call: '12' },
]);
ok('nothing that is not a number or an https URL becomes a link',
  hostile.every((x) => x.links.length === 0), JSON.stringify(hostile.map((x) => x.links)));
ok('an entry with no name is dropped; non-objects are dropped', hostile.map((x) => x.name).join('') === 'ABCD');
ok('not a list: nothing', parseMicResources(undefined).length === 0 && parseMicResources({}).length === 0 && parseMicResources('988').length === 0);

console.log('\nthe wiring');
const bar = read('components/map/MapVoiceBar.tsx');
ok('a crisis turn hands its resources to the card',
  /setCrisisResources\(parseMicResources\(result\.crisis_resources\)\);\s*setCrisisVisible\(true\);/.test(bar)
    && /resources=\{crisisResources\}/.test(bar));
const card = read('components/safety/CrisisResourcesCard.tsx');
ok('the card shows the carried list when there is one, its own otherwise',
  /\{resources && resources\.length > 0 \? \(/.test(card) && /onPress=\{\(\) => open\(l\.href\)\}/.test(card));
ok('...and the safety.md lines that are not on the server\'s list still show with it',
  /\{SAFETY_LINES\.worriedAboutSomeone\}[\s\S]{0,200}\{SAFETY_LINES\.psychosisOrMania\}[\s\S]{0,40}<\/>\s*\) : \(/.test(card));

console.log(`\nsmoke-mic-resources: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
