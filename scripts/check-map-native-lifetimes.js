// THE MAP TAB'S NATIVE OBJECTS ARE NEVER USED AFTER THEY ARE GONE (2026-11-09).
//
// Sentry c105e83014144c1685e820fd8e2aaa52, staging 1.3.0+3 (the dev app id),
// iPhone18,3 / iOS 27.2: EXC_BAD_ACCESS "Attempted to dereference null pointer"
// in hermes::vm::JSObject::getNamedWithReceiver_RJS, on an empty map with one
// untapped card. A named property read on an object whose native side was
// freed. The Map tab's native-backed objects are Reanimated shared values
// driving Skia, and Skia objects. With no symbolicated JS frame, the fix is
// defensive, and this file keeps it in place:
//   1. every shared value either canvas animates is cancelAnimation'd on unmount;
//   2. no Skia.Path.Make() runs outside a useMemo (a path per render freed the
//      previous native path while a recorded frame could still hold it);
//   3. both canvases are React.memo, and map.tsx memoises the geometry and the
//      tap handlers, so first-load state changes do not re-record the drawing;
//   4. the hidden view is unmounted once a fade ends (it used to stay mounted at
//      opacity 0 with its loops running);
// with a negative control.
//
//   node scripts/check-map-native-lifetimes.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// Every shared value the file animates, and the list its unmount effect cancels.
function uncancelled(code) {
  const animated = new Set([...code.matchAll(/\b(\w+)\.value = (?:withRepeat|withTiming|withSpring|withSequence|withDelay)\(/g)].map((m) => m[1]));
  // The per-node scales are animated through scaleByKey[k].value = withSpring(…).
  if (/scaleByKey\[k\]\.value = withSpring\(/.test(code)) {
    for (const m of code.matchAll(/const (scale[A-Z]\w*)\s*=\s*useSharedValue\(/g)) animated.add(m[1]);
  }
  // travel(angSV, opSV, …) animates whatever is passed in: angle and opacity values.
  if (/angSV\.value = withTiming\(/.test(code)) {
    for (const m of code.matchAll(/travel\((\w+), (\w+),/g)) { animated.add(m[1]); animated.add(m[2]); }
    animated.delete('angSV'); animated.delete('opSV');
  }
  if (/sv\.value = withSequence\(/.test(code)) {
    for (const m of code.matchAll(/which === '\w+' \? (\w+)/g)) animated.add(m[1]);
    for (const m of code.matchAll(/: (\w+Flash);/g)) animated.add(m[1]);
    animated.delete('sv');
  }
  const cleanup = (code.match(/useEffect\(\(\) => \(\) => \{\s*for \(const sv of \[([\s\S]*?)\]\) cancelAnimation\(sv\);/) || [])[1] || '';
  const cancelled = new Set(cleanup.split(/[\s,]+/).filter(Boolean));
  return { animated: [...animated], missing: [...animated].filter((n) => !cancelled.has(n)), hasCleanup: !!cleanup };
}

for (const f of ['components/map/InnerMapCanvas.tsx', 'components/map/CircleMapCanvas.tsx']) {
  const code = codeOnly(read(f));
  const u = uncancelled(code);
  check(u.hasCleanup, `${f}: no unmount effect cancelling its animations`);
  check(u.animated.length >= 10, `${f}: only ${u.animated.length} animated values seen — has the scan stopped seeing them?`);
  check(u.missing.length === 0, `${f}: animated but never cancelled on unmount: ${u.missing.join(', ')}`);
  check(/export const \w+ = React\.memo\(\w+Impl\);/.test(code), `${f}: the canvas is no longer memoised`);
  // Every Skia.Path.Make() sits inside a useMemo.
  for (const m of code.matchAll(/Skia\.Path\.Make\(\)/g)) {
    const before = code.slice(Math.max(0, m.index - 120), m.index);
    check(/useMemo\(\(\) => \{\s*const \w+ = $/.test(before), `${f}: a Skia path is made outside useMemo`);
  }
}

const map = codeOnly(read('app/(tabs)/map.tsx'));
check(/const geom: MapGeometry \| null = useMemo\(\s*\(\) => \(sizeW && effectiveH \? computeMapGeometry\(sizeW, effectiveH\) : null\),\s*\[sizeW, effectiveH\],\s*\);/.test(map),
  'map.tsx no longer memoises the geometry');
check(/onNodeTap=\{onTriangleTap\}/.test(map) && /onNodeTap=\{onCircleTap\}/.test(map)
  && /const onTriangleTap = useCallback\(/.test(map) && /const onCircleTap = useCallback\(/.test(map),
  'map.tsx hands the canvases a new tap handler every render');
check(/\{geom && triangleMounted \? \(/.test(map) && /\{size && circleMounted \? \(/.test(map),
  'a canvas is mounted while it is hidden');
check(/\]\)\.start\(\(\{ finished \}\) => \{\s*if \(!finished\) return;\s*if \(viewRef\.current === 'circle'\) setTriangleMounted\(false\);\s*else setCircleMounted\(false\);/.test(map),
  'the hidden view no longer unmounts when its fade ends');
check(/setParts\(Array\.isArray\(ps\) \?/.test(map), 'the parts list is not forced to a list');

// NEGATIVE CONTROL — an animation started without a matching cancel is caught.
{
  const planted = 'const extra = useSharedValue(0);\nextra.value = withRepeat(withTiming(1), -1, true);\n' +
    'useEffect(() => () => {\n    for (const sv of [\n      breath,\n    ]) cancelAnimation(sv);\n  }, []);\n';
  if (!uncancelled(planted).missing.includes('extra')) fails.push('NEGATIVE CONTROL: an uncancelled animation is not caught');
}

if (fails.length) {
  console.error('check-map-native-lifetimes: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check-map-native-lifetimes: OK — every animated value cancelled on unmount, Skia paths memoised, canvases and geometry memoised, the hidden view unmounted');
