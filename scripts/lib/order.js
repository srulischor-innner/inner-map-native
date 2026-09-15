// AN ORDERING ASSERTION NEEDS BOTH ANCHORS TO EXIST.
//
// The idiom this replaces is everywhere in scripts/:
//
//     step("x runs before y", SRC.indexOf(x) < SRC.indexOf(y));
//
// String.indexOf returns -1 when the needle is absent, and -1 is less than every
// real index. So the assertion PASSES when `x` has been deleted from the file --
// it is loudest exactly when the thing it guards is gone. Several of these sit
// on safety gates (crisis before the trial freeze, credit before the replay
// guard), which is the worst possible place for a check that reads a deletion as
// a pass.
//
//     const { orderedIn } = require("./lib/order");
//     const r = orderedIn(SRC, "the guard", "what it guards");
//     step("the guard runs first", r.ok, r.why);
//
// Returns { ok, why } rather than throwing, so each smoke keeps its own
// reporting and its own exit code. `why` is empty when ok.
function orderedIn(haystack, first, second) {
  const src = String(haystack == null ? "" : haystack);
  const i = src.indexOf(first);
  const j = src.indexOf(second);
  if (i < 0 && j < 0) return { ok: false, why: `neither anchor is present: "${first}" and "${second}"` };
  if (i < 0) return { ok: false, why: `the guard is gone: "${first}"` };
  if (j < 0) return { ok: false, why: `the thing it guards is gone: "${second}"` };
  if (i === j) return { ok: false, why: `both anchors matched the same position (${i}) -- one contains the other` };
  return i < j
    ? { ok: true, why: "" }
    : { ok: false, why: `both present, but "${first}" comes AFTER "${second}" (${i} > ${j})` };
}

module.exports = { orderedIn };
