#!/usr/bin/env node
// Runs every check and smoke in the app repo, then tsc, in one pass.
//
// WHY THIS EXISTS. Nothing ran these. See the sibling runner in the server
// repo for the longer version: a suite that only runs when someone remembers
// is a suite that is green at exactly the moments nobody is looking.
//
//   node scripts/ci-run-all.js            # everything
//   node scripts/ci-run-all.js --list     # print what would run
//   node scripts/ci-run-all.js --no-tsc   # skip the type check
//
// Exit code 0 only if every script and tsc exited 0.
//
// ONE CHECK DEGRADES RATHER THAN FAILS. check-production-build.js shells out
// to `eas env:list` / `eas secret:list` to confirm the production secrets
// exist. Without the eas CLI and an authenticated session it prints
// "⚠ EAS secret check skipped" and still exits 0 — deliberately, because a
// partial answer must not read as an absence. In CI that means the SECRET half
// of that check does not run unless EXPO_TOKEN is set on the repo and eas-cli
// is installed. The config half (INTERNET permission, https apiBaseUrl, ATS)
// runs either way, and that half is the one that caused the May 2026 outage.
// The workflow prints a line saying which half ran.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPTS_DIR = __dirname;
const REPO = path.resolve(__dirname, "..");

// Not checks — a generator and a preview server.
const NOT_CHECKS = new Set(["generate-icon.js", "preview-reading-web.js"]);

// 9 checks + 8 smokes. Below this, the run fails: see
// the count-guard note in the server repo's runner. Deleting a check must be
// a decision, not a diff nobody noticed.
const EXPECTED_TOTAL = 17;

const TIMEOUT_MS = 180_000;

function discover() {
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => /^(smoke|check)-.*\.(js|mjs)$/.test(f) && !NOT_CHECKS.has(f))
    .sort();
}

// `shell` is only for npx: on Windows it is the only way to reach the .cmd
// shim, but turning it on for process.execPath breaks the spawn outright,
// because the interpreter path contains a space ("C:\Program Files\nodejs")
// and cmd.exe splits on it.
function run(cmd, args, label, useShell = false) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: REPO,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: { ...process.env, CI: "1" },
    maxBuffer: 32 * 1024 * 1024,
    shell: useShell && process.platform === "win32",
  });
  const ms = Date.now() - started;
  const timedOut = r.error && r.error.code === "ETIMEDOUT";
  return {
    file: label,
    ok: !timedOut && r.status === 0,
    status: timedOut ? "TIMEOUT" : r.status,
    ms,
    out: `${r.stdout || ""}${r.stderr || ""}`,
  };
}

function main() {
  const all = discover();

  if (process.argv.includes("--list")) {
    console.log(all.join("\n"));
    console.log(`\n${all.length} scripts${process.argv.includes("--no-tsc") ? "" : " + tsc --noEmit"}.`);
    return 0;
  }

  console.log(`Running ${all.length} checks${process.argv.includes("--no-tsc") ? "" : " + tsc"}\n`);

  const results = [];
  const skips = [];
  for (const f of all) {
    const r = run(process.execPath, [path.join(SCRIPTS_DIR, f)], f);
    results.push(r);
    console.log(`${r.ok ? "  ok  " : "  RED "} ${f.padEnd(40)} ${String(r.ms).padStart(6)}ms`);
    if (!r.ok) {
      console.log(r.out.split("\n").slice(-40).map((l) => "  | " + l).join("\n"));
    }
    // Make every degraded half visible rather than letting a green line imply
    // more than it proved. Two of these exist today and both are checks that
    // pass while quietly not checking:
    //   - check-production-build.js skips its EAS secret half unauthenticated.
    //   - smoke-crisis-before-budget.js prints "[17] SKIP server coverage" when
    //     ../Inner world is not on disk — which is every CI run in this repo,
    //     because the server repo is private and this one is public. That half
    //     runs in the SERVER repo's workflow, where both are checked out.
    // Case-SENSITIVE on the SKIP marker on purpose: these scripts print
    // "[17] SKIP  server coverage" in caps when a half declines to run, and
    // use the lowercase word freely in ordinary assertion prose ("this skip
    // used to jump straight to terms"). Matching case-insensitively turns a
    // passing assertion into a false skip report, which is the same disease
    // one level up.
    for (const line of r.out.split("\n")) {
      if (/(^|\s)(\[\d+\])?\s*SKIP(PED)?\b/.test(line) || /check skipped/i.test(line)) {
        skips.push(`${f}: ${line.trim().slice(0, 160)}`);
        console.log(`        ^ ${line.trim().slice(0, 140)}`);
      }
    }
  }

  if (!process.argv.includes("--no-tsc")) {
    const t = run("npx", ["tsc", "--noEmit"], "tsc --noEmit", true);
    results.push(t);
    console.log(`${t.ok ? "  ok  " : "  RED "} ${"tsc --noEmit".padEnd(40)} ${String(t.ms).padStart(6)}ms`);
    if (!t.ok) console.log(t.out.split("\n").slice(0, 60).map((l) => "  | " + l).join("\n"));
  }

  const red = results.filter((r) => !r.ok);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  console.log(`\n${results.length - red.length}/${results.length} green in ${(totalMs / 1000).toFixed(1)}s`);
  if (skips.length) {
    console.log(`${skips.length} half-check(s) skipped — this green does not cover them:`);
    for (const s of skips) console.log(`  - ${s}`);
  }

  let shrank = false;
  if (all.length < EXPECTED_TOTAL) {
    shrank = true;
    console.log(
      `\nSUITE SHRANK: found ${all.length} scripts, expected at least ${EXPECTED_TOTAL}. ` +
        `If a check was removed on purpose, lower EXPECTED_TOTAL in scripts/ci-run-all.js in the same commit.`
    );
  } else if (all.length > EXPECTED_TOTAL) {
    console.log(`\nNote: ${all.length} scripts found, ${EXPECTED_TOTAL} recorded — bump EXPECTED_TOTAL.`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [`## App checks — ${results.length - red.length}/${results.length} green`, "", `${(totalMs / 1000).toFixed(1)}s.`, ""];
    if (red.length) {
      lines.push("### Red", "");
      for (const r of red) lines.push(`- \`${r.file}\` — exit ${r.status} after ${r.ms}ms`);
      lines.push("");
    }
    if (shrank) lines.push(`> **Suite shrank**: found ${all.length}, expected ${EXPECTED_TOTAL}.`, "");
    if (skips.length) {
      lines.push(`### ${skips.length} half-checks skipped — green here does not cover these`, "");
      for (const s of skips) lines.push(`- ${s}`);
      lines.push("");
    }
    lines.push("<details><summary>All checks</summary>", "");
    for (const r of results) lines.push(`${r.ok ? "ok" : "**RED**"} \`${r.file}\` ${r.ms}ms  `);
    lines.push("", "</details>");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }

  return red.length || shrank ? 1 : 0;
}

process.exit(main());
