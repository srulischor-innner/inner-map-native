// THE GUIDE MAY ONLY DESCRIBE A STEP THE APP ACTUALLY HAS.
//
// WHAT WENT WRONG. The "Using it" cards described mechanics that were never
// built. The Map card said tapping any part shows "the belief it carries" —
// only the Wound folder renders a belief row, and the one in the You folder is
// the belief the PERSON writes, not the part's. The leading-mic card told
// people to tap a part to FOCUS it (there is no focus mechanic — nothing can
// even tell the mic which part you mean), to PRESS the mic (it is
// press-and-hold), and to save their belief "to that part's folder" (there is
// one belief and it is saved on the You row). It never mentioned the lock that
// is the first thing most people actually meet.
//
// Nothing failed when the Guide and the app disagreed. This is the thing that
// fails.
//
// HOW IT IS BUILT, and why it is not the usual vacuous copy check:
//
//   1. It reads the ASSEMBLED Guide — it imports USING_FEATURES and joins each
//      card's body into the prose a person actually reads. A regex over
//      guideContent.ts source would also match the file's own comments, which
//      quote the wording that was removed.
//
//   2. Every forbidden claim is PAIRED WITH A MECHANISM PREDICATE lifted out
//      of the implementation at run time. The rule is not "this sentence is
//      absent". It is "the app has no such step, THEREFORE the Guide may not
//      describe one". Build the step and the rule lifts itself and says so.
//
//   3. The things the Guide MUST say are lifted from the implementation too —
//      the mic's label, the map's label for the diamond, the belief button's
//      text, the section headings — so renaming any of them turns this red
//      instead of leaving the Guide quietly describing a control that is now
//      called something else. (The lesson of 7d01b9b: a check that restates
//      the copy tests one particular wording, not drift.)
//
//   4. THE DETECTOR IS ITSELF UNDER TEST. The honest weakness of any rule that
//      reads prose is that its regexes only know the wording that shipped, and
//      a later "tidy-up" can quietly neuter one. So every rule carries a
//      REGRESSION CORPUS: the sentences that actually shipped broken, plus the
//      re-drift probes an adversarial review found slipping past an earlier
//      draft. A rule that stops matching its own corpus is a FAILURE, not a
//      quiet pass. Loosening a pattern now costs a red.
//
//   5. Every parse is guarded. A regex that silently matched nothing would
//      make the rules below pass loudest exactly when the check stopped
//      reading anything, so a failed lift exits 2 — "cannot run" — never 0.
//
// KNOWN LIMITS, stated honestly:
//   - Negation is handled LOCALLY, not by exempting whole sentences. A match is
//     ignored only when a negation sits inside it or within 45 characters
//     before it, so the corrected Guide can say "you do not pick which part it
//     answers" without putting the entire paragraph in a blind spot. A false
//     instruction phrased as a negation ("don't forget to tap a part first")
//     can still slip; the positive requirements carry the weight there, and
//     the one rule whose claim IS a negation ("no belief needed") opts out of
//     the exemption.
//   - The forbidden half can only catch wording it has seen a shape of. The
//     positive half and the mechanism invariants are what catch drift the
//     author of a rewrite never imagined.
//
//   node scripts/check-guide-matches-app.mjs
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');

let pass = 0;
const failures = [];
const notes = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
};
function die(msg) {
  console.error(`\ncheck-guide-matches-app: CANNOT RUN — ${msg}`);
  console.error('A lift that finds nothing makes every rule below vacuous, so this exits 2 rather than passing.');
  process.exit(2);
}

// guideContent.ts imports '../constants/features' without an extension, which
// Node's ESM resolver will not follow. The hook appends .ts on a miss, which is
// what lets this check read the REAL exported cards instead of grepping the
// file — the file's own comments quote wording that was removed, and a grep
// cannot tell those from the copy that ships.
const HOOK = path.join(HERE, 'lib', 'ts-extension-resolve.mjs');
if (!fs.existsSync(HOOK)) die(`the resolve hook is missing at ${HOOK}`);
register(pathToFileURL(HOOK));
let USING_FEATURES;
try {
  ({ USING_FEATURES } = await import('../utils/guideContent.ts'));
} catch (e) {
  die(`could not import USING_FEATURES from utils/guideContent.ts — ${e?.message}`);
}

const read = (rel) => {
  const p = path.join(APP, rel);
  if (!fs.existsSync(p)) die(`${rel} is missing`);
  return fs.readFileSync(p, 'utf8');
};
const FOLDER = read('components/map/PartFolderModal.tsx');
const BAR = read('components/map/MapVoiceBar.tsx');
const CANVAS = read('components/map/InnerMapCanvas.tsx');

const lift = (re, src, what) => {
  const m = re.exec(src);
  if (!m) die(`could not lift ${what}`);
  return m[1].trim();
};
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ===========================================================================
// WHAT THE APP HAS. Lifted at run time, never restated here.
// ===========================================================================

// Top-level declaration boundaries, so a function body can be sliced without
// swallowing the next one — or, for the LAST function in the file, the whole
// StyleSheet, which is full of the word "belief" (styles.beliefLabel) and
// would have made every folder look like it renders a belief row.
function topLevelSlices(src, file) {
  const starts = [...src.matchAll(/^(?:export\s+)?(?:function|const|type|class|interface)\s+([A-Za-z0-9_]+)/gm)]
    .map((m) => ({ name: m[1], at: m.index }));
  if (starts.length < 5) die(`only ${starts.length} top-level declarations parsed out of ${file}`);
  const out = new Map();
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    out.set(starts[i].name, src.slice(starts[i].at, end));
  }
  return out;
}
const FOLDER_DECLS = topLevelSlices(FOLDER, 'PartFolderModal.tsx');

// Every node a person can tap on the map.
const tapTargets = [...CANVAS.matchAll(/<(?:Diamond)?TapTarget\b[^>]*?\bkind="([a-z-]+)"/g)].map((m) => m[1]);
if (tapTargets.length < 5) die(`only ${tapTargets.length} tap targets parsed out of InnerMapCanvas.tsx`);

// Which component each tapped node opens. THIS is the render, so every
// question below ("does that folder show a belief? a Detected pill?") is asked
// of the component the tap actually reaches — including Self, which has no
// *_BODY record at all and was invisible to an earlier draft that counted
// records instead.
const renderByKind = new Map(
  [...FOLDER.matchAll(/partKey === '([a-z-]+)'\s*\?\s*<([A-Za-z0-9_]+)/g)].map((m) => [m[1], m[2]]),
);
for (const k of tapTargets) {
  if (!renderByKind.has(k)) die(`tap target "${k}" has no folder branch in PartFolderModal.tsx — the per-node reasoning below would skip it`);
}
const bodyFor = (kind) => {
  const comp = renderByKind.get(kind);
  const body = FOLDER_DECLS.get(comp);
  if (!body) die(`could not slice the body of ${comp}() (the folder for "${kind}")`);
  return body;
};

// Folders that render a belief ROW the AI files (a <Section> whose label is a
// belief label), and folders where the PERSON writes one (BeliefSection).
const hasBeliefRow = (body) =>
  /label=\{[A-Za-z0-9_]+\.belief\.label\}/.test(body) || /label="[^"]*belief[^"]*"/i.test(body);
const beliefRowKinds = tapTargets.filter((k) => hasBeliefRow(bodyFor(k)));
const beliefWriteKinds = (() => {
  const m = /const BELIEF_PART_TYPES = new Set\(\[([^\]]*)\]\)/.exec(FOLDER);
  if (!m) die('could not find BELIEF_PART_TYPES in PartFolderModal.tsx');
  const list = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (!list.length) die('BELIEF_PART_TYPES parsed empty');
  return list;
})();
// ONE denominator, not two. An earlier draft added a "folders that write one"
// count to a "records with a belief row" count and reported "8 of 7 folders"
// under mutation. Both lists are node kinds, so the honest question is a set
// question: is there a node you can tap that shows you no belief at all?
const beliefKinds = [...new Set([...beliefRowKinds, ...beliefWriteKinds])];
const everyPartShowsABelief = tapTargets.every((k) => beliefKinds.includes(k));

// The furniture a folder grows as it fills in. Asked per node, because Self
// deliberately has none of it ("Self isn't a part to be mapped or spoken to")
// and a Guide sentence that promises all four for "any part" is false there —
// which is the exact defect this file exists to catch, one node over.
const FURNITURE = ['<DetectedPill', '<PartRecencyRows', '<SelfVoiceButton', '<GoDeeperSection'];
const furnitureFor = (kind) => FURNITURE.filter((f) => bodyFor(kind).includes(f));
const barrenKinds = tapTargets.filter((k) => furnitureFor(k).length === 0);
const partialKinds = tapTargets.filter((k) => {
  const n = furnitureFor(k).length;
  return n > 0 && n < FURNITURE.length;
});

// Nodes whose tap opens a LIST of parts rather than one part's folder. The
// evidence is inside the component the tap reaches: it maps over rows and
// renders a card per protector, so "its folder" is the wrong singular for two
// of the seven nodes.
const listKinds = tapTargets.filter((k) => /\.map\(\((?:row|p|item)\b/.test(bodyFor(k)));

// The labels and button texts the Guide has to agree with.
// Deliberately permissive on the label's characters: a RELABEL must produce a
// clean failure ("the card sends people to a node that is now called X"), not
// a lift that finds nothing and reports CANNOT RUN.
const youLabel = lift(/<DiamondTapTarget[^>]*\blabel="([A-Z][A-Z \-]*)"/, CANVAS, 'the map label for the You diamond');
const micLabel = lift(/const SELF_LIKE_LABEL = '([^']+)';/, BAR, 'the leading mic label');
const establishText = lift(/styles\.beliefEstablishText[\s\S]{0,60}?>\s*([^<]+?)\s*<\/Text>/, FOLDER, 'the establish-belief button text');
const youBeliefLabel = lift(/<Text style=\{styles\.beliefLabel\}>([^<]+)<\/Text>/, FOLDER, "the You folder's belief heading");
const standOnClause = lift(/<Text style=\{styles\.beliefSubtitle\}>\s*([^<]+?)\s*<\/Text>/, FOLDER, "the You folder's belief subtitle")
  .split('—')[0].trim();
const goDeeper = lift(/<Text style=\{styles\.deeperToggleText\}>\{expanded \? '([^']+)'/, FOLDER, 'the Go Deeper toggle text');
// Lifted THROUGH the render: find the folder that shows a belief row, read
// which *_BODY record it takes that label from, then read the label off the
// record. Rename either and this follows.
const woundBeliefLabel = (() => {
  const kind = beliefRowKinds[0];
  if (!kind) die('no folder renders a belief row — the belief-surface reasoning below would be wrong');
  const m = /label=\{([A-Za-z0-9_]+)\.belief\.label\}/.exec(bodyFor(kind));
  if (!m) die(`the "${kind}" folder's belief row does not read its label from a *_BODY record`);
  const rec = new RegExp(`const ${m[1]} = \\{[\\s\\S]*?belief:\\s*\\{\\s*label:\\s*'([^']+)'`).exec(FOLDER);
  if (!rec) die(`could not read the belief label off ${m[1]}`);
  return rec[1].trim();
})();

// Mechanism facts. Each one is the reason a rule below exists.
const micProps = (() => {
  const i = BAR.indexOf('\ntype Props = {');
  if (i < 0) die('could not find the MapVoiceBar Props type');
  const end = BAR.indexOf('\n};', i);
  if (end < 0) die('could not find the end of the MapVoiceBar Props type');
  return [...BAR.slice(i, end).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
})();
if (micProps.length < 2) die(`only ${micProps.length} MapVoiceBar props parsed`);
// Callbacks (on*) are what the bar REPORTS. Everything else is what it can be
// TOLD. If nothing it can be told names a part, no screen can hand it one.
const micInputProps = micProps.filter((p) => !/^on[A-Z]/.test(p));
const micCanBeToldAPart = micInputProps.some((p) => /part|node|focus|select|target/i.test(p));
const partComesFromTheTurn = /onDetectedPart\?\.\(result\.detected_part/.test(BAR);
const holdGesture = /const MIN_HOLD_MS = \d+;/.test(BAR) && /if \(heldMs < MIN_HOLD_MS\) \{/.test(BAR);
const micLocked = /setSelfLikeEnabled\(hasBelief\);/.test(BAR)
  && /selfLike\.belief/.test(BAR)
  && /setModal\('selfLikeDisabled'\);/.test(BAR);
const beliefSectionGated = /BELIEF_PART_TYPES\.has\(String\(partKey\)\) \? \([\s\S]{0,120}?<BeliefSection/.test(FOLDER)
  && (FOLDER.match(/<BeliefSection/g) || []).length === 1;
// The first press of EITHER mic opens the explainer and returns before
// startRecording. 100% of readers meet this; the card that introduces the mics
// has to say so.
const explainerIntercepts = (() => {
  const BAR_DECLS = topLevelSlices(BAR, 'MapVoiceBar.tsx');
  const comp = [...BAR_DECLS.keys()].find((n) => n === 'MapVoiceBar');
  const scope = comp ? BAR_DECLS.get(comp) : BAR;
  const hits = [...scope.matchAll(/const (onSelf\w*PressIn) = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/g)];
  if (hits.length < 2) die(`only ${hits.length} mic press-in handlers parsed out of MapVoiceBar.tsx`);
  return hits.every(([, , body]) => {
    const gate = body.indexOf("if (explainerSeen === false) {");
    const rec = body.indexOf('startRecording(');
    return gate >= 0 && body.includes("setModal('explainer')") && rec >= 0 && gate < rec;
  });
})();

if (!Array.isArray(USING_FEATURES) || USING_FEATURES.length < 5) {
  die(`only ${USING_FEATURES?.length} Guide cards imported`);
}

console.log('[guide-vs-app] what the app has, read just now:');
console.log(`  tappable nodes ............ ${tapTargets.length}  (${tapTargets.join(', ')})`);
console.log(`  a belief is shown on ...... ${beliefKinds.length} of ${tapTargets.length}: row=${beliefRowKinds.join(',') || 'none'} written=${beliefWriteKinds.join(',') || 'none'}`);
console.log(`  folders with NO furniture .. ${barrenKinds.join(', ') || 'none'}   (partial: ${partialKinds.join(', ') || 'none'})`);
console.log(`  taps that open a LIST ...... ${listKinds.join(', ') || 'none'}`);
console.log(`  mic can be told a part ..... ${micCanBeToldAPart}  (inputs: ${micInputProps.join(', ')})`);
console.log(`  part comes from the turn ... ${partComesFromTheTurn}`);
console.log(`  press-and-hold gesture ..... ${holdGesture}`);
console.log(`  leading mic is gated ....... ${micLocked}`);
console.log(`  belief section is gated .... ${beliefSectionGated}`);
console.log(`  first press opens explainer  ${explainerIntercepts}`);
console.log(`  labels ..................... ${micLabel} / ${youLabel} / "${establishText}" / ${youBeliefLabel} / ${woundBeliefLabel} / ${goDeeper}`);
console.log('');

// ===========================================================================
// THE GUIDE, ASSEMBLED. Not the source file — the prose a person reads.
// ===========================================================================
const CARDS = USING_FEATURES.map((f) => ({ icon: f.icon, title: f.title, text: (f.body || []).join(' ') }));
const cardByIcon = (icon) => {
  const c = CARDS.find((f) => f.icon === icon);
  if (!c) die(`no Guide card with icon "${icon}" — the card was renamed or removed, and every rule about it would silently stop running`);
  if (c.text.length < 120) die(`the "${c.title}" card assembled to ${c.text.length} chars — too short to be the real copy`);
  return c;
};
const MAP_CARD = cardByIcon('map');
const LEADING_CARD = cardByIcon('self-like');

// APOSTROPHES COME IN TWO SHAPES and the copy uses both — guideContent writes
// straight ones, PartFolderModal writes curly ones ("Couldn't save"), and an
// editor will happily substitute either. A pattern that only knows ' silently
// stops matching the moment someone types '.
const AP = "['’]";
const NEG = new RegExp(
  `\\b(?:not|never|don${AP}?t|cannot|can${AP}?t|isn${AP}?t|aren${AP}?t|doesn${AP}?t|no longer|nothing|none|neither|rather than|instead of|without)\\b`,
  'i',
);
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
// LOCAL negation, not a sentence-wide exemption. An earlier draft dropped every
// sentence containing a negation before any pattern ran, which put the lock
// paragraph and the detection paragraph — the two things this check exists to
// establish — entirely in the blind spot (measured: 5 of 10 sentences).
const negatedAt = (sentence, m) => NEG.test(sentence.slice(Math.max(0, m.index - 45), m.index + m[0].length));

const MIC_RE = new RegExp(`\\bmics?\\b|\\b${rx(micLabel)}\\b`, 'i');

// ===========================================================================
// FORBIDDEN CLAIMS — each one gated on the mechanism it would need.
// Run over EVERY card, so a claim cannot survive by moving to another one.
//
// `corpus` is the detector's own test: the sentences that really shipped
// broken, and the re-drift probes that slipped past an earlier draft. Each
// must still match, or the rule has been quietly neutered.
// ===========================================================================
const RULES = [
  {
    id: 'belief-on-every-part',
    // Gate: the claim is only allowed once every node you can tap really does
    // show you a belief — filed by the AI, or written by you.
    allowed: everyPartShowsABelief,
    // NEUTRAL OBSERVATION, not the locked reason: this string is printed both
    // when the rule bites and when it lifts, and a sentence that only reads
    // true in one of those states is a lie in the other.
    why: `a belief is shown on ${beliefKinds.length} of ${tapTargets.length} tappable nodes (${beliefKinds.join(', ') || 'none'})`,
    says: 'that tapping any/every part shows the belief it carries',
    patterns: [
      /\b(?:any|every|each|all)\s+(?:parts?|folders?)\b[^.!?]{0,140}\bbeliefs?\b/i,
      /\bbeliefs?\b[^.!?]{0,140}\b(?:any|every|each|all)\s+(?:parts?|folders?)\b/i,
      new RegExp(`\\b(?:each|every)\\s+part${AP}?s?\\s+belief\\b`, 'i'),
      /\bthe\s+belief\s+(?:it|they)\s+carr/i,
      new RegExp(`\\bpart${AP}?s?\\s+own\\s+belief\\b`, 'i'),
    ],
    corpus: [
      // Shipped in the Map card until this commit.
      "Tap any part to see what's been said about it and the belief it carries.",
      // Re-drift probes: an adversarial review slipped both past an earlier
      // draft whose patterns only knew the word "part".
      'Every folder shows the belief its part holds.',
      "Each part's belief is shown at the top of its folder.",
    ],
  },
  {
    id: 'protector-carries-a-belief',
    // Gate: same mechanism, narrower phrasing — naming a protector category
    // and then a belief, which the "any/every part" patterns do not cover.
    allowed: everyPartShowsABelief,
    why: `a belief is shown on ${beliefKinds.length} of ${tapTargets.length} tappable nodes (${beliefKinds.join(', ') || 'none'})`,
    says: 'that a protector folder shows you a belief',
    patterns: [
      /\b(?:protectors?|fixers?|skeptics?|managers?|firefighters?)\b[^.!?]{0,80}\bbeliefs?\b/i,
    ],
    corpus: [
      'Open a protector and you will find the belief underneath it.',
      'The Fixer folder shows the belief that drives it.',
    ],
  },
  {
    id: 'furniture-on-every-part',
    // Gate: Self's folder deliberately renders no Detected pill, no dates, no
    // GO DEEPER and no Self-voice button. Until every folder has them, the
    // Guide may not promise them for "any part" — the defect this file exists
    // to catch, repeated one node over.
    allowed: barrenKinds.length === 0 && partialKinds.length === 0,
    why: `folders with none of [${FURNITURE.join(' ')}]: ${barrenKinds.join(', ') || 'none'}; partial: ${partialKinds.join(', ') || 'none'}`,
    says: 'that any/every part folder carries the detection count, the dates, GO DEEPER and the Self-voice button',
    patterns: [
      new RegExp(`\\b(?:any|every|each|all)\\s+(?:parts?|folders?)\\b[^.!?]{0,170}(?:\\b${rx(goDeeper)}\\b|\\bdetected\\b|Self would say)`, 'i'),
      new RegExp(`(?:\\b${rx(goDeeper)}\\b|\\bdetected\\b|Self would say)[^.!?]{0,170}\\b(?:any|every|each|all)\\s+(?:parts?|folders?)\\b`, 'i'),
    ],
    corpus: [
      // The rewrite that an adversarial review caught reintroducing the defect.
      'Tap any part to open its folder: how many times it has been detected, what has been filed about it so far, when it was first noticed and when you last opened it, and a GO DEEPER section holding the rest.',
      'Every folder has a GO DEEPER section.',
    ],
  },
  {
    id: 'select-a-part-first',
    // Gate: nothing can hand the mic a part, so nobody can be told to pick one.
    allowed: micCanBeToldAPart,
    why: `MapVoiceBar's inputs are: ${micInputProps.join(', ') || 'none'}`,
    says: 'that you tap/select/focus a part before speaking to it',
    patterns: [
      // The VOCABULARY of a mechanic that does not exist, not one phrasing of
      // it. An earlier draft matched "focus on a part" and "part ... to focus"
      // and was walked straight past by "bring the part into focus first".
      /\bfocus(?:es|ed|ing|sed)?\b[^.!?]{0,60}\b(?:parts?|mics?)\b/i,
      /\b(?:parts?|mics?)\b[^.!?]{0,60}\bfocus(?:es|ed|ing|sed)?\b/i,
      // Picking a part as a step BEFORE another one, connective and all.
      /\b(?:tap|taps|tapping|select|selects|selecting|choose|choosing|pick|picking)\s+(?:a|the|any|one|that|which|your)\s+parts?\b[^.!?]{0,80}\b(?:then|first|before|next)\b/i,
      /\b(?:before|first)\b[^.!?]{0,40}\b(?:tap|select|choose|pick)\s+(?:a|the|any|one|that|which|your)\s+parts?\b/i,
    ],
    // Picking a part is a TRUE instruction about folders and a false one about
    // the mic, so the bare form is only tested in a sentence that names a mic.
    // Scoped to ONE sentence, not a sliding window: a window turned an accurate
    // sentence red merely for being reflowed next to the mic sentence.
    micSentencePatterns: [
      /\b(?:tap|taps|tapping|select|selects|selecting|choose|choosing|pick|picking)\s+(?:a|the|any|one|that|which|your)\s+parts?\b/i,
    ],
    corpus: [
      // Shipped in the leading-mic card until this commit.
      'Tap a part on the map to focus on it, then press the mic marked LEADING.',
      // Re-drift probe that walked past the earlier draft.
      'Bring the part you want to lead into focus first.',
      'Short, focused voice conversations with one part.',
    ],
  },
  {
    id: 'save-belief-to-a-part',
    // Gate: one belief, saved on one row. A second belief folder lifts it.
    allowed: beliefWriteKinds.length > 1,
    why: `the belief is written in ${beliefWriteKinds.length} folder(s): ${beliefWriteKinds.join(', ')}`,
    says: "that a belief is saved to a part's own folder, or that there is one per part",
    patterns: [
      new RegExp(`\\bsav\\w*\\b[^.!?]{0,80}\\b(?:that|the|a|each|its|this)\\s+parts?${AP}?s?\\s+folder\\b`, 'i'),
      new RegExp(`\\bbeliefs?\\b[^.!?]{0,80}\\bto\\s+(?:that|the|a|its|this)\\s+parts?${AP}?s?\\s+folder\\b`, 'i'),
      /\bbeliefs?\b[^.!?]{0,60}\bfor\s+(?:each|every|that)\s+part\b/i,
      /\bone\s+belief\s+per\s+part\b/i,
    ],
    corpus: [
      // Shipped, in both apostrophe shapes. The curly form passed an earlier
      // draft whose pattern only knew the straight one.
      "Once your belief is articulated, you can save it to that part's folder.",
      'Once your belief is articulated, you can save it to that part’s folder.',
      'You get one belief per part.',
    ],
  },
  {
    id: 'bare-press',
    // Gate: a release under MIN_HOLD_MS is discarded, so "press" is not a step.
    allowed: !holdGesture,
    why: `the MIN_HOLD_MS discard gate is present: ${holdGesture}`,
    says: 'that you press or tap the mic rather than press and hold it',
    patterns: [
      /\bpress\s+the\s+mic\b(?![^.!?]{0,80}hold)/i,
      /\b(?:tap|press)\s+the\s+(?:\w+\s+)?mic\s+to\s+(?:speak|record|start|begin)\b/i,
    ],
    corpus: [
      'Tap a part on the map to focus on it, then press the mic marked LEADING.',
      'Tap the leading mic to speak.',
    ],
  },
  {
    id: 'mic-without-belief',
    // Gate: the leading mic is locked until the You row carries a belief.
    // THE CLAIM IS ITSELF A NEGATION, so this rule opts out of the local
    // negation exemption — the probe below is exactly the shape that an
    // earlier draft's sentence-wide exemption waved through.
    allowed: !micLocked,
    negationIsTheClaim: true,
    why: `the leading mic's belief gate is present: ${micLocked}`,
    says: 'that the leading mic can be used without establishing a belief first',
    patterns: [
      new RegExp(`\\b(?:no|not|never|without|don${AP}?t|doesn${AP}?t)\\b[^.!?]{0,40}\\b(?:need|require|have to)\\w*\\b[^.!?]{0,40}\\bbelief\\b`, 'i'),
      /\bwithout\s+(?:a|your|any)\s+belief\b/i,
      /\bno\s+belief\s+(?:is\s+)?(?:needed|required)\b/i,
    ],
    corpus: [
      'You do not need a belief of your own to use it.',
      'It works without a belief.',
      'No belief is required.',
    ],
  },
];

// ---- the detector is under test -------------------------------------------
// Every live rule must still catch the sentences it was built to catch. This
// is what stops a later tidy-up from loosening a pattern into a no-op.
for (const rule of RULES) {
  if (rule.allowed) continue;
  if (!rule.corpus || !rule.corpus.length) {
    failures.push(`rule "${rule.id}" has no regression corpus — nothing proves its patterns still match anything`);
    continue;
  }
  for (const sentence of rule.corpus) {
    const hit = matchRule(rule, sentence, true);
    ok(`[${rule.id}] still catches its own recorded drift`, !!hit,
      `no pattern matched: "${sentence.slice(0, 90)}${sentence.length > 90 ? '…' : ''}"`);
  }
}

function matchRule(rule, sentence, isCorpus) {
  const all = [...rule.patterns, ...(isCorpus ? (rule.micSentencePatterns || []) : [])];
  for (const p of all) {
    const m = p.exec(sentence);
    if (!m) continue;
    if (!rule.negationIsTheClaim && negatedAt(sentence, m)) continue;
    return m;
  }
  if (!isCorpus && MIC_RE.test(sentence)) {
    for (const p of rule.micSentencePatterns || []) {
      const m = p.exec(sentence);
      if (!m) continue;
      if (!rule.negationIsTheClaim && negatedAt(sentence, m)) continue;
      return m;
    }
  }
  return null;
}

// ---- the Guide, checked against them --------------------------------------
for (const rule of RULES) {
  if (rule.allowed) {
    notes.push(`rule "${rule.id}" has LIFTED — the app now has that step. ${rule.why}. The Guide may describe it; this rule is now dead and should be deleted.`);
    pass++;
    continue;
  }
  for (const c of CARDS) {
    const hits = [];
    for (const s of sentencesOf(c.text)) {
      const m = matchRule(rule, s, false);
      if (m) hits.push(`"${m[0]}" in: ${s}`);
    }
    ok(`[${rule.id}] the "${c.title}" card does not say ${rule.says}`, hits.length === 0,
      hits.length ? `${rule.why}. ${hits[0]}` : '');
  }
}

// ===========================================================================
// WHAT THE GUIDE MUST SAY — every string lifted from the implementation, so a
// rename over there turns this red instead of leaving the Guide stale.
// ===========================================================================
const has = (card, needle) => card.text.toLowerCase().includes(String(needle).toLowerCase());
const hasExact = (card, needle) => new RegExp(`\\b${rx(String(needle))}\\b`).test(card.text);
const near = (card, a, b, span = 140) => {
  const t = card.text;
  const re = new RegExp(rx(a), 'gi');
  let m;
  while ((m = re.exec(t))) {
    const w = t.slice(Math.max(0, m.index - span), m.index + m[0].length + span);
    if (new RegExp(rx(b), 'i').test(w)) return true;
  }
  return false;
};

// Case-SENSITIVE on the headings, on purpose: "the belief it carries" and "go
// deeper into a part" are ordinary English that would satisfy a lowercase
// match while telling a person nothing about which row they are looking at.
// Quoting the heading as the app prints it is the whole point. (Measured: with
// a case-insensitive match, "names the wound's belief row (The Belief)" passed
// on the SHIPPED BROKEN copy.)
ok(`the Map card names the wound's belief row (${woundBeliefLabel})`, hasExact(MAP_CARD, woundBeliefLabel),
  'a person who taps the Fixer has to be told where the belief actually is');
ok(`the Map card names the You folder's belief heading (${youBeliefLabel})`, hasExact(MAP_CARD, youBeliefLabel),
  'the two beliefs are different things and the card has to separate them');
ok(`the Map card names the ${goDeeper} section`, hasExact(MAP_CARD, goDeeper));

// Gated positives: each one is required only while the app is shaped that way,
// and lifts with a note if the app changes.
if (barrenKinds.length) {
  for (const k of barrenKinds) {
    const label = k === 'self-like' ? youLabel : k;
    ok(`the Map card marks "${label}" as the folder that carries none of that furniture`,
      has(MAP_CARD, label) && near(MAP_CARD, label, 'except'),
      `${k} renders none of [${FURNITURE.join(' ')}] — an unqualified account of a folder is false there`);
  }
} else {
  notes.push('every folder now carries the full furniture set — the Self carve-out assertion has lifted.');
  pass++;
}
if (listKinds.length) {
  ok('the Map card says the protector nodes open more than one part',
    listKinds.every((k) => has(MAP_CARD, k)) && /\bgroups?\b|every protector|more than one|each with its own/i.test(MAP_CARD.text),
    `${listKinds.join(' and ')} open a list of protector rows, not one folder`);
} else {
  notes.push('no tap opens a list any more — the protector-group assertion has lifted.');
  pass++;
}
ok('the Map card says the first press of a mic opens the explainer',
  explainerIntercepts && /first time you press|explainer/i.test(MAP_CARD.text),
  'every reader meets this on their literal first press, and the card described a press that records');

ok(`the leading-mic card uses the mic's own label (${micLabel})`, hasExact(LEADING_CARD, micLabel));
ok(`the leading-mic card sends people to the node the map labels ${youLabel}`, hasExact(LEADING_CARD, youLabel),
  'the diamond is the only route to the belief that unlocks this mic');
ok(`the leading-mic card names the button that starts it ("${establishText}")`, has(LEADING_CARD, establishText));
ok(`the leading-mic card uses the app's own words for the belief ("${standOnClause}")`, has(LEADING_CARD, standOnClause));
ok('the leading-mic card says the mic is locked until then', micLocked
  && /\bopens?\b|\bunlocks?\b/i.test(LEADING_CARD.text)
  && /\bdim|\bgrey|\bgray|\block|\bwait/i.test(LEADING_CARD.text),
  'the lock is the first thing most people meet and the card never mentioned it');
ok('the leading-mic card says the part is detected, not chosen', partComesFromTheTurn
  && /listens for|speaking through you|which part is (?:speaking|active)|it detects|the app (?:picks|hears|listens)/i.test(LEADING_CARD.text));
ok('the leading-mic card describes the press-and-hold gesture', holdGesture
  && /press and hold|hold (?:it|the mic|down|either)/i.test(LEADING_CARD.text));

// ===========================================================================
// The mechanism facts the rules above stand on. If one of these flips, the
// rules are reasoning about an app that no longer exists — that must be a
// FAILURE with a name, never a silent pass.
// ===========================================================================
ok('the leading mic still takes its part from the turn result', partComesFromTheTurn,
  'if the part now comes from a prop, rule "select-a-part-first" is reasoning about the wrong app');
ok('the belief section still renders only inside the gated folders', beliefSectionGated,
  'if BeliefSection renders elsewhere, rules "belief-on-every-part" and "save-belief-to-a-part" need re-deriving');
ok('the leading mic is still gated on the belief', micLocked,
  'if the gate is gone, the card must stop describing a lock');
ok('the first press of either mic still opens the explainer before recording', explainerIntercepts,
  'if the modal is gone, the Map card must stop describing it');

// ---- report --------------------------------------------------------------
for (const n of notes) console.log(`  note  ${n}`);
if (notes.length) console.log('');
if (failures.length) {
  console.log(`check-guide-matches-app: FAILURES — ${pass} passed, ${failures.length} failed\n`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log(`check-guide-matches-app: OK — ${pass} checks passed`);
