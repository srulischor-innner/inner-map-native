#!/usr/bin/env node
// Which glyphs draw OUTSIDE their advance width, and which of our titles is
// shrink-wrapped around one.
//
// WHY THIS EXISTS. The Guide's Map tab rendered "Self" as "Sel" on a real
// device. Nothing was truncating the string: it is a 4-character literal, and
// no numberOfLines, no width, no ellipsizeMode is set anywhere in that path.
//
// The cause is typographic. In Cormorant Garamond the lowercase 'f' has a
// terminal that hooks to the RIGHT of where the glyph's advance width ends —
// a Garamond design feature, which is why fi/fl ligatures exist. Mid-word it
// tucks over the next letter and looks correct. As the LAST glyph, the ink
// sits outside the advance box.
//
// That alone is harmless. It only clips when the text box is shrink-wrapped to
// the sum of advance widths — which is exactly what alignItems:'center' does
// to a Text with no width of its own. React Native measures with
// Layout.getDesiredWidth (Android) / usedRectForTextContainer (iOS), both
// advance-based, so the overhanging ink is outside the view and gets clipped.
//
// This reads the shipped .ttf files directly and reports, per font, which
// characters overhang and by how much. No dependencies.
//
//   node scripts/check-glyph-overhang.js
const fs = require("fs");
const path = require("path");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

function parse(file) {
  const b = fs.readFileSync(file);
  const numTables = b.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[b.toString("ascii", o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) };
  }
  const need = ["head", "maxp", "hhea", "hmtx", "loca", "glyf", "cmap"];
  for (const t of need) if (!tables[t]) throw new Error(`${path.basename(file)}: missing ${t} table`);

  const unitsPerEm = b.readUInt16BE(tables.head.off + 18);
  const indexToLocFormat = b.readInt16BE(tables.head.off + 50);
  const numGlyphs = b.readUInt16BE(tables.maxp.off + 4);
  const numHMetrics = b.readUInt16BE(tables.hhea.off + 34);

  const advance = (gid) => b.readUInt16BE(tables.hmtx.off + Math.min(gid, numHMetrics - 1) * 4);

  const locaAt = (i) => (indexToLocFormat === 0
    ? b.readUInt16BE(tables.loca.off + i * 2) * 2
    : b.readUInt32BE(tables.loca.off + i * 4));

  // xMax lives in the glyph header; an empty glyph (loca[i] === loca[i+1]) has none.
  const xMax = (gid) => {
    const a = locaAt(gid), z = locaAt(gid + 1);
    if (z <= a) return null;
    return b.readInt16BE(tables.glyf.off + a + 6);
  };

  // cmap format 4, the Windows BMP subtable.
  const cm = tables.cmap.off;
  const nSub = b.readUInt16BE(cm + 2);
  let sub = null;
  for (let i = 0; i < nSub; i++) {
    const o = cm + 4 + i * 8;
    const pid = b.readUInt16BE(o), eid = b.readUInt16BE(o + 2);
    const off = cm + b.readUInt32BE(o + 4);
    if (b.readUInt16BE(off) === 4 && (pid === 3 && (eid === 1 || eid === 0))) { sub = off; break; }
  }
  if (sub === null) throw new Error(`${path.basename(file)}: no format-4 cmap`);
  const segX2 = b.readUInt16BE(sub + 6);
  const seg = segX2 / 2;
  const endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  const gidFor = (cp) => {
    for (let i = 0; i < seg; i++) {
      const end = b.readUInt16BE(endO + i * 2);
      if (cp > end) continue;
      const start = b.readUInt16BE(startO + i * 2);
      if (cp < start) return 0;
      const delta = b.readInt16BE(deltaO + i * 2);
      const ro = b.readUInt16BE(rangeO + i * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const gi = rangeO + i * 2 + ro + (cp - start) * 2;
      const g = b.readUInt16BE(gi);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };

  return { unitsPerEm, numGlyphs, advance, xMax, gidFor };
}

const ASCII = [];
for (let c = 0x21; c <= 0x7e; c++) ASCII.push(String.fromCharCode(c));

let worstOverall = 0;
const files = fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f));
console.log(`\nGLYPHS THAT DRAW PAST THEIR ADVANCE WIDTH  (${files.length} font files)`);
console.log("=".repeat(72));

const perFont = {};
for (const f of files) {
  let font;
  try { font = parse(path.join(FONT_DIR, f)); }
  catch (e) { console.log(`  ${f.padEnd(38)} skipped — ${e.message}`); continue; }
  const over = [];
  for (const ch of ASCII) {
    const gid = font.gidFor(ch.codePointAt(0));
    if (!gid) continue;
    const adv = font.advance(gid);
    const xm = font.xMax(gid);
    if (xm === null) continue;
    const rsbEm = (adv - xm) / font.unitsPerEm;
    if (rsbEm < -0.002) over.push({ ch, em: rsbEm });
  }
  over.sort((a, b) => a.em - b.em);
  perFont[f] = over;
  const worst = over[0];
  if (worst && -worst.em > worstOverall) worstOverall = -worst.em;
  console.log(`  ${f.padEnd(38)} ${over.length ? over.slice(0, 6).map((o) => `${o.ch} ${(o.em * 100).toFixed(1)}%`).join("  ") : "none"}`);
}

// ---------------------------------------------------------------- the cost
console.log("\nWHAT THAT COSTS AT OUR TITLE SIZES");
console.log("=".repeat(72));
const SITES = [
  ["GuideSlide title (Map tab)", "CormorantGaramond-SemiBold.ttf", 36, 0.5],
  ["GuideSlide titleCinematic", "CormorantGaramond-SemiBold.ttf", 44, 0.5],
  ["IntegrationPanel title", "CormorantGaramond-SemiBold.ttf", 26, 0.3],
  ["PartFolderModal title", "CormorantGaramond-SemiBold.ttf", 26, 0.3],
];
for (const [name, file, size, ls] of SITES) {
  const over = perFont[file];
  if (!over || !over.length) { console.log(`  ${name.padEnd(30)} font not parsed`); continue; }
  const f = over.find((o) => o.ch === "f");
  if (!f) { console.log(`  ${name.padEnd(30)} 'f' does not overhang in this face`); continue; }
  const px = -f.em * size;
  console.log(`  ${name.padEnd(30)} 'f' overhangs ${px.toFixed(1)}px at ${size}px; letterSpacing gives back only ${ls}px`);
}

console.log("\nA word ending in one of those characters, in a shrink-wrapped box,");
console.log("loses the overhanging ink. Give the box width and the ink has room.");
console.log("\nNOTE: letterSpacing is a MITIGATOR here, not the cause. Removing it");
console.log("makes the clip WORSE. If removing it ever FIXES a clip, the cause is");
console.log("the trailing-letterSpacing measurement bug, not glyph overhang.");

// ==========================================================================
// THE INVENTORY — every static string that can hit this, reviewed once.
// ==========================================================================
// A blanket rule ("every serif Text must have slack") is the wrong guard: 115
// of 126 serif styles in this app have no slack of their own and almost all of
// them are fine, because their parent stretches them. Gating on that would be
// 115 changes nobody asked for and a check that gets muted.
//
// The NECESSARY condition is much narrower: a string that ENDS in an
// overhanging glyph. There are six in the whole app. That set is small enough
// to review by hand and to keep reviewed — so this fails when it GROWS, which
// is the only moment a person needs to look.
const REVIEWED = {
  "utils/guideContent.ts|Self": "FIXED — GuideSlide.tsx title now alignSelf:'stretch' (this is the reported bug)",
  "components/map/IntegrationPanel.tsx|Self": "FIXED — row header, paddingRight: serifInkSlack(26, 0.3)",
  "components/map/PartFolderModal.tsx|Self": "FIXED — row header, paddingRight: serifInkSlack(26, 0.3)",
  "components/map/MapVoiceBar.tsx|Self": "SAFE — parent .card has width:'100%', so the Text stretches and has room",
  "components/map/PartFolderModal.tsx|The Belief": "SAFE — renders via sectionLabel, which is fonts.sansBold; DM Sans has no overhang",
  "components/journey/MapDepth.tsx|Core belief": "SAFE — declared in a sections array that is never rendered",
};

// Built from the UPRIGHT Cormorant faces only, and only for overhangs big
// enough to remove visible ink. That comes to exactly one character: 'f'.
//
// Cormorant ITALIC is deliberately excluded, and the first version of this
// check was useless because it was not. Italic's capitals overhang too — Y
// -7.5%, V/W -7.0%, T -5.5% — so including it flagged 29 strings, nearly all
// of them uppercase BUTTON LABELS that render in DM Sans, which has no
// overhang at all. A check that fires on twenty-nine things nobody needs to
// look at gets muted, and then it is not a check.
//
// If a shrink-wrapped title ever uses fonts.serifItalic, it needs the same
// slack for those capitals. Nothing does today (the one italic title,
// guide.tsx askLabel, reads "Ask" and ends in 'k'). Widen this set then, not
// before.
const UPRIGHT_SERIF = Object.entries(perFont)
  .filter(([f]) => /Cormorant/i.test(f) && !/Italic/i.test(f))
  .flatMap(([, v]) => v);
const OVERHANGING_CHARS = new Set(
  UPRIGHT_SERIF.filter((o) => o.em < -0.05).map((o) => o.ch),
);

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git|\.expo|scripts/.test(p)) walk(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const APP = path.join(__dirname, "..");
const srcFiles = ["components", "app", "utils"]
  .map((d) => path.join(APP, d)).filter(fs.existsSync).flatMap((d) => walk(d));

const found = new Map();
for (const f of srcFiles) {
  const rel = path.relative(APP, f).replace(/\\/g, "/");
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((ln, i) => {
    const push = (v) => {
      const t = v.trim();
      if (!t || !OVERHANGING_CHARS.has(t[t.length - 1])) return;
      const key = `${rel}|${t}`;
      if (!found.has(key)) found.set(key, i + 1);
    };
    let m;
    const re1 = /\b(?:title|label|heading|name|header)\s*:\s*'([^']{1,60})'/g;
    while ((m = re1.exec(ln))) push(m[1]);
    const re2 = /<Text[^>]*>\s*([A-Za-z][A-Za-z '-]{0,40})\s*<\/Text>/g;
    while ((m = re2.exec(ln))) push(m[1]);
  });
}

console.log("\n\nSTRINGS THAT END IN AN OVERHANGING GLYPH");
console.log("=".repeat(72));
let unreviewed = 0, missing = 0;
for (const [key, line] of [...found].sort()) {
  const verdict = REVIEWED[key];
  const [file, str] = key.split("|");
  if (verdict) {
    console.log(`  ok    ${file}:${line}  "${str}"`);
    console.log(`        ${verdict}`);
  } else {
    unreviewed++;
    console.log(`\n  NEW   ${file}:${line}  "${str}"`);
    console.log(`        This string ends in a glyph that draws outside its advance width.`);
    console.log(`        If it renders in a Cormorant style whose box is shrink-wrapped —`);
    console.log(`        inside alignItems:'center', or as a flex child in a row — the last`);
    console.log(`        character WILL be clipped. Give the box slack (alignSelf:'stretch'`);
    console.log(`        in a column, serifInkSlack() padding in a row), then add it to`);
    console.log(`        REVIEWED in this file with the verdict.`);
  }
}
for (const key of Object.keys(REVIEWED)) {
  if (!found.has(key)) {
    missing++;
    console.log(`\n  STALE ${key.replace("|", " -> ")}`);
    console.log(`        Reviewed here but no longer found. Remove it from REVIEWED.`);
  }
}

console.log(
  unreviewed || missing
    ? `\nFAIL — ${unreviewed} unreviewed, ${missing} stale.`
    : `\nPASS — all ${found.size} at-risk strings are reviewed and accounted for.`,
);
process.exit(unreviewed || missing ? 1 : 0);
