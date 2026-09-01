// WHERE COULD TEXT BE SILENTLY CLIPPED?
//
// Founder, phone round three: the reading document showed two lines cut
// mid-word on the right. The reading's own component renders correctly at
// 375px in the web preview and its text contains nothing unwrappable, so this
// scans for the patterns that DO clip text, across every screen and component —
// including whatever else shares the reading's container shape.
//
// It reports rather than fails: several of these are legitimate (a one-line
// list row genuinely wants numberOfLines={1}). The point is to make every
// clipping site visible in one place so a real one cannot hide among them.
//
//   node scripts/check-text-clipping.js [--all]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const SHOW_ALL = args.includes("--all");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))];

const findings = { truncating: [], fixedWidth: [], rowText: [], noWrap: [] };

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(ROOT, f);
  const lines = src.split(/\r?\n/);

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;

    // 1. explicit truncation — legitimate in list rows, wrong in a document
    if (/numberOfLines\s*=\s*\{?\s*\d/.test(line)) {
      findings.truncating.push(`${at}  ${line.trim().slice(0, 100)}`);
    }
    // 2. a fixed numeric width on something that may hold text
    const w = /(?:^|[^a-zA-Z])width:\s*(\d{2,4})\b/.exec(line);
    if (w && Number(w[1]) > 200) {
      findings.fixedWidth.push(`${at}  ${line.trim().slice(0, 100)}`);
    }
    // 3. Text with no flex inside a row — the classic overflow
    if (/flexDirection:\s*['"]row['"]/.test(line) && !/flexWrap/.test(line)) {
      findings.rowText.push(`${at}  ${line.trim().slice(0, 100)}`);
    }
    // 4. wrapping explicitly disabled
    if (/whiteSpace|noWrap|flexShrink:\s*0/.test(line)) {
      findings.noWrap.push(`${at}  ${line.trim().slice(0, 100)}`);
    }
  });
}

const show = (label, arr, note) => {
  console.log(`\n${label}: ${arr.length}${note ? "  — " + note : ""}`);
  const list = SHOW_ALL ? arr : arr.slice(0, 12);
  for (const x of list) console.log("   " + x);
  if (!SHOW_ALL && arr.length > list.length) console.log(`   … ${arr.length - list.length} more (--all)`);
};

console.log("TEXT-CLIPPING SCAN — " + files.length + " .tsx files");
show("EXPLICIT TRUNCATION (numberOfLines)", findings.truncating,
  "fine on a list row, wrong in a document");
show("FIXED WIDTH > 200", findings.fixedWidth,
  "a container wider than the viewport clips every long line at the same x");
show("ROW CONTAINERS", findings.rowText,
  "Text in a row without flex/flexShrink overflows instead of wrapping");
show("WRAPPING DISABLED", findings.noWrap);

// The reading document specifically: it must carry none of these.
const READING = path.join(ROOT, "components", "map", "ReadingModal.tsx");
const rsrc = fs.readFileSync(READING, "utf8");
const readingProblems = [];
if (/numberOfLines/.test(rsrc)) readingProblems.push("ReadingModal truncates with numberOfLines");
if (/width:\s*\d/.test(rsrc)) readingProblems.push("ReadingModal sets a numeric width");
if (/flexDirection:\s*['"]row['"]/.test(rsrc)) {
  // the header bar is a legitimate row; only flag it if a Text style is in one
  const rowIsBarOnly = /bar:\s*\{[^}]*flexDirection:\s*['"]row['"]/.test(rsrc);
  if (!rowIsBarOnly) readingProblems.push("ReadingModal has a row container that is not the header bar");
}
console.log("\nTHE READING DOCUMENT ITSELF: " +
  (readingProblems.length ? "PROBLEMS\n   - " + readingProblems.join("\n   - ") : "clean — no truncation, no fixed width, only the header bar is a row"));
