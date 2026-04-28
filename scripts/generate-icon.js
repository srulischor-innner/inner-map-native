// Renders assets/icon.svg into the three PNG raster targets the app
// references (icon, Android adaptive icon, splash icon). Run via:
//   node scripts/generate-icon.js
// Re-run any time assets/icon.svg changes.

const sharp = require('sharp');
const path = require('path');

async function generateIcons() {
  const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');

  // Main app icon — 1024x1024.
  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(__dirname, '..', 'assets', 'icon.png'));
  console.log('OK icon.png generated');

  // Android adaptive icon — 1024x1024. The Android system masks this
  // into circles/squircles depending on launcher; the dark background
  // we set in app.json (adaptiveIcon.backgroundColor) shows where the
  // mask trims the foreground.
  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(__dirname, '..', 'assets', 'adaptive-icon.png'));
  console.log('OK adaptive-icon.png generated');

  // Splash icon — same render, used by Expo splash screen.
  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(__dirname, '..', 'assets', 'splash-icon.png'));
  console.log('OK splash-icon.png generated');

  console.log('All icons generated successfully.');
}

generateIcons().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
