#!/usr/bin/env node
// A part folder must never render the same field twice, or two different
// fields under the same heading.
//
// It did, in five places, for months: a wound folder showed "Where It Lives"
// and "When It Started" twice; fixer and skeptic showed the same "desire"
// field as "What It Needs" and again as "What It Desires". Nobody had done
// anything wrong — the body <Section>s and the *_DEEPER lists were two
// hand-written lists with nothing comparing them (founder ruling 2026-08-25:
// fix by construction).
//
// PartFolderModal.tsx now derives Go deeper by SUBTRACTING the declared body
// rows from the DEEPER list, so the two halves cannot overlap.
//
// WHAT THIS CHECKS, AND WHY NOT THE OBVIOUS THING. Re-running that same
// subtraction here and asserting the result is disjoint proves nothing — it
// is the code's own arithmetic marked by itself, and it passes no matter what
// the folder actually renders. (Same circularity trap as one classifier
// scoring both halves of a measurement; see
// Inner world/scripts/measure-offer-landing.js.)
//
// The one thing subtraction cannot guarantee is that the BODY declaration
// still describes the body JSX. A <Section> written with a literal label or a
// literal field key is invisible to the subtraction, and duplication comes
// straight back. So this reads the JSX: every body <Section> in every folder
// must take its label and its field key FROM the declaration record. That is
// the assertion that can fail, and the one worth running.
//
//   node scripts/check-folder-field-duplication.js

const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "components", "map", "PartFolderModal.tsx");
const src = fs.readFileSync(SRC, "utf8");

// The five folder bodies, and the declaration record each one must read from.
const FOLDERS = [
  { name: "wound",         start: "function WoundSections",    record: "WOUND_BODY" },
  { name: "fixer",         start: "function FixerSections",    record: "FIXER_BODY" },
  { name: "skeptic",       start: "function SkepticSections",  record: "SKEPTIC_BODY" },
  { name: "self-like",     start: "function SelfLikeSections", record: "SELF_LIKE_BODY" },
  { name: "protector row", start: "function ProtectorList",    record: "PROTECTOR_ROW_BODY" },
];

let failures = 0;
function fail(msg) { failures++; console.log("  ✗ " + msg); }

for (const f of FOLDERS) {
  const from = src.indexOf(f.start);
  if (from < 0) { fail(`${f.name}: component ${f.start} not found — did it get renamed?`); continue; }
  // The body ends at Go deeper. Everything after it is the deeper list, which
  // is derived and therefore not this check's business.
  const to = src.indexOf("<GoDeeperSection", from);
  if (to < 0) { fail(`${f.name}: no <GoDeeperSection> after ${f.start}`); continue; }
  const body = src.slice(from, to);

  console.log(`\n${f.name} (${f.record})`);

  // Every <Section> label must come from the record.
  const literalLabels = [...body.matchAll(/<Section[\s\S]{0,400}?label="([^"]+)"/g)].map((m) => m[1]);
  const recordLabels = [...body.matchAll(new RegExp(`label=\\{${f.record}\\.(\\w+)\\.label\\}`, "g"))].map((m) => m[1]);
  for (const l of literalLabels) {
    fail(`${f.name}: <Section label="${l}"> is a literal — declare it in ${f.record} or the subtraction cannot see it`);
  }

  // Every readField inside the body must come from the record too.
  const literalKeys = [...body.matchAll(/readField\((?:part|row),\s*'([^']+)'\)/g)].map((m) => m[1]);
  for (const k of literalKeys) {
    fail(`${f.name}: readField(..., '${k}') is a literal — use ${f.record}.<slot>.key`);
  }

  console.log(`    ${recordLabels.length} section(s) reading from ${f.record}: ${recordLabels.join(", ") || "none"}`);
  if (recordLabels.length === 0) fail(`${f.name}: no body section reads ${f.record} at all`);
}

console.log(
  failures
    ? `\nFAIL — ${failures} problem(s). A body section that bypasses its declaration can duplicate a Go deeper row again.`
    : "\nPASS — every body section reads its label and field key from its declaration, so Go deeper's subtraction sees all of them.",
);
process.exit(failures ? 1 : 0);
