// Turn device captures into exactly the sizes the App Store uploader accepts.
//
// App Store Connect's 6.5" iPhone slot accepts ONLY 1242x2688, 2688x1242,
// 1284x2778 or 2778x1284 — read off the uploader itself, not from memory.
// A capture that is a few pixels off is refused outright, and the four
// captures here are all different shapes because three of them were cropped
// to drop the status bar and the home indicator.
//
// So: pad to the target ASPECT first, then scale. Padding rather than cropping
// because cropping a screenshot to fit throws away the thing you were trying
// to show; scaling without padding first distorts it.
//
// THE PAD COLOUR IS SAMPLED, NOT ASSUMED. Each edge is filled with the median
// of that image's own outermost row or column, so the pad is the screen's own
// ground rather than a colour that happens to be right today. On a full-bleed
// dark app the seam is invisible; if the app ever ships a light screen, this
// still does the right thing without anyone remembering to change a constant.
//
// Usage: node scripts/make-store-screenshots.js <outDir> <file>...

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TARGET_W = 1284;
const TARGET_H = 2778;
const TARGET_RATIO = TARGET_W / TARGET_H;

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function edgeColour(img, meta, side) {
  // One-pixel strip off the given edge, as raw RGB, reduced to a median per
  // channel. Median not mean: a bright element touching the edge (a glowing
  // circle, a tab underline) drags a mean and does not move a median.
  const strip =
    side === 'top' ? { left: 0, top: 0, width: meta.width, height: 1 }
    : side === 'bottom' ? { left: 0, top: meta.height - 1, width: meta.width, height: 1 }
    : side === 'left' ? { left: 0, top: 0, width: 1, height: meta.height }
    : { left: meta.width - 1, top: 0, width: 1, height: meta.height };
  const { data } = await sharp(await img.clone().toBuffer())
    .extract(strip).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = [], g = [], b = [];
  for (let i = 0; i < data.length; i += 3) { r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]); }
  return { r: median(r), g: median(g), b: median(b) };
}

async function convert(file, outDir) {
  const img = sharp(file);
  const meta = await img.metadata();
  const ratio = meta.width / meta.height;

  let padded;
  let note = "";
  if (Math.abs(ratio - TARGET_RATIO) < 0.0005) {
    padded = img.clone();
    note = 'already the target shape';
  } else if (ratio > TARGET_RATIO) {
    // Too wide for the target: the capture is missing height (cropped chrome).
    const wantH = Math.round(meta.width / TARGET_RATIO);
    const extra = wantH - meta.height;
    const top = Math.floor(extra / 2), bottom = extra - top;
    const [tc, bc] = [await edgeColour(img, meta, 'top'), await edgeColour(img, meta, 'bottom')];
    // One background for the whole extend, so a two-tone seam cannot appear.
    // The two edges are sampled anyway and reported, because a large difference
    // between them means padding is the wrong move for this image.
    const bg = { r: Math.round((tc.r + bc.r) / 2), g: Math.round((tc.g + bc.g) / 2), b: Math.round((tc.b + bc.b) / 2) };
    const spread = Math.max(Math.abs(tc.r - bc.r), Math.abs(tc.g - bc.g), Math.abs(tc.b - bc.b));
    padded = img.clone().extend({ top, bottom, left: 0, right: 0, background: bg });
    note = `padded height +${extra}px (${top}/${bottom}) with rgb(${bg.r},${bg.g},${bg.b}); edge spread ${spread}`;
    if (spread > 24) note += '  <-- EDGES DIFFER, CHECK THIS ONE BY EYE';
  } else {
    const wantW = Math.round(meta.height * TARGET_RATIO);
    const extra = wantW - meta.width;
    const left = Math.floor(extra / 2), right = extra - left;
    const [lc, rc] = [await edgeColour(img, meta, 'left'), await edgeColour(img, meta, 'right')];
    const bg = { r: Math.round((lc.r + rc.r) / 2), g: Math.round((lc.g + rc.g) / 2), b: Math.round((lc.b + rc.b) / 2) };
    const spread = Math.max(Math.abs(lc.r - rc.r), Math.abs(lc.g - rc.g), Math.abs(lc.b - rc.b));
    padded = img.clone().extend({ top: 0, bottom: 0, left, right, background: bg });
    note = `padded width +${extra}px (${left}/${right}) with rgb(${bg.r},${bg.g},${bg.b}); edge spread ${spread}`;
    if (spread > 24) note += '  <-- EDGES DIFFER, CHECK THIS ONE BY EYE';
  }

  const out = path.join(outDir, path.basename(file).replace(/\.[^.]+$/, '') + `-${TARGET_W}x${TARGET_H}.png`);

  // TWO PASSES, DELIBERATELY. sharp runs its pipeline in a fixed order —
  // rotate, extract, resize, EXTEND — regardless of the order you chain the
  // calls in. Chaining .extend().resize() therefore resizes first and then
  // pads the already-scaled image, which produced a 1284x2932 file from a pad
  // computed for the original. Materialising the padded image to a buffer
  // forces the pad to be part of the input the resize sees.
  const paddedBuf = await padded.png().toBuffer();
  const pm = await sharp(paddedBuf).metadata();
  await sharp(paddedBuf)
    .resize(TARGET_W, TARGET_H, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(out);

  // The pad has to have produced the target SHAPE, or the fill resize is
  // silently stretching the picture instead of scaling it.
  const padRatio = pm.width / pm.height;
  if (Math.abs(padRatio - TARGET_RATIO) > 0.002) {
    note += `  <-- PAD LEFT IT AT ${pm.width}x${pm.height} (ratio ${padRatio.toFixed(4)}), THE RESIZE IS STRETCHING`;
  }

  const after = await sharp(out).metadata();
  const ok = after.width === TARGET_W && after.height === TARGET_H;
  const upscale = (TARGET_W / meta.width).toFixed(3);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${path.basename(file).padEnd(16)} ` +
    `${meta.width}x${meta.height} -> ${after.width}x${after.height}  (x${upscale})  ${note}`
  );
  return ok;
}

(async () => {
  const [outDir, ...files] = process.argv.slice(2);
  if (!outDir || !files.length) {
    console.error('usage: node scripts/make-store-screenshots.js <outDir> <file>...');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let allOk = true;
  for (const f of files) allOk = (await convert(f, outDir)) && allOk;
  console.log(allOk ? '\nall at the target size' : '\nSOMETHING IS NOT AT THE TARGET SIZE');
  process.exit(allOk ? 0 : 1);
})();
