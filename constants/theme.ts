// Inner Map design system — single source of truth for colors, typography, spacing.
// Mirrors the web-app CSS vars so the two apps feel identical visually.
// Kept minimal on purpose: add tokens only when they're used in more than one place.

export const colors = {
  // Surfaces
  background: '#0a0a0f',
  backgroundSecondary: '#0e0e1a',
  backgroundCard: '#14131a',

  // Brand
  amber: '#E6B47A',
  amberLight: '#F0C890',
  amberDim: 'rgba(230,180,122,0.3)',
  amberFaint: 'rgba(230,180,122,0.08)',

  // Text
  cream: '#F0EDE8',
  creamDim: '#BFB8AB',
  creamFaint: '#888070',

  // Parts (colors for nodes + folders — must match web app)
  wound: '#E05050',
  fixer: '#E6B47A',
  skeptic: '#86BDDC',
  self: '#C1AAD8',
  selfLike: '#8A7AAA',
  managers: '#9DCCB3',
  firefighters: '#EF8C30',

  // Structure
  border: 'rgba(255,255,255,0.08)',
  borderAmber: 'rgba(230,180,122,0.3)',
  overlay: 'rgba(0,0,0,0.5)',
  shadow: 'rgba(0,0,0,0.4)',
} as const;

// Font families — loaded at app boot via useFonts() in the root layout
// (app/_layout.tsx). Values are the exact key strings expo-font registers
// for each Google Font package, so `fontFamily: fonts.serif` lines up with
// what's available to the render layer after fonts finish loading.
//
// Serif  → Cormorant Garamond (display / greetings / logo)
// Sans   → DM Sans (body / tabs / UI chrome)
export const fonts = {
  // Weight constants (still useful for components that don't opt into the
  // custom families).
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,

  // Cormorant Garamond
  serif:        'CormorantGaramond_400Regular',
  serifItalic:  'CormorantGaramond_400Regular_Italic',
  serifBold:    'CormorantGaramond_600SemiBold',
  // ^ SEE serifInkSlack BELOW BEFORE PUTTING ONE OF THESE IN A CENTERED
  //   OR ROW-LAID-OUT TITLE. Cormorant's 'f' draws outside its own advance
  //   width, and a shrink-wrapped box cuts it off.

  // DM Sans
  sans:       'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansBold:   'DMSans_600SemiBold',
};

/**
 * Horizontal room a Cormorant title needs beyond its measured width.
 *
 * WHY THIS NUMBER EXISTS. The Guide's Map tab rendered "Self" as "Sel" on a
 * real device. Nothing truncated the string — it is a 4-character literal with
 * no numberOfLines, no width and no ellipsizeMode anywhere in that path.
 *
 * Cormorant Garamond's lowercase 'f' draws 0.131 em of ink to the RIGHT of
 * where its advance width ends. That is a Garamond design feature — the reason
 * fi/fl ligatures exist — and mid-word the hook simply tucks over the next
 * letter. As the LAST glyph it lands outside the advance box. React Native
 * measures text by summing advance widths on both platforms, so the box stops
 * short of the ink and the terminal is clipped. Verified against the shipped
 * .ttf files: 'f' is -0.131 em, the next-worst ASCII letter is 'R' at -0.012,
 * and DM Sans has none at all. Run scripts/check-glyph-overhang.js.
 *
 * This is NOT an Android bug. The measurement is advance-based on iOS too — if
 * anything iOS is slightly tighter, since Android rounds the box up to a whole
 * pixel. Android is simply where it was noticed.
 *
 * WHEN YOU NEED IT: a serif title whose box is shrink-wrapped to its content —
 * inside `alignItems: 'center'`, or as a flex child in a row. A title in a
 * container that stretches it (`width: '100%'`, or default cross-axis stretch)
 * already has room and needs nothing.
 *
 * Prefer `alignSelf: 'stretch'` in a COLUMN — it costs no visual shift when
 * textAlign is already centered. Use this padding in a ROW, where the cross
 * axis is vertical and stretch would change the height instead.
 *
 * letterSpacing is a MITIGATOR here, not a cause: it widens the measured box.
 * If removing letterSpacing ever FIXES a clip, that is the separate
 * trailing-letterSpacing measurement bug, not this.
 */
export const CORMORANT_MAX_INK_OVERHANG_EM = 0.131;
export function serifInkSlack(fontSize: number, letterSpacing = 0): number {
  return Math.max(0, Math.ceil(fontSize * CORMORANT_MAX_INK_OVERHANG_EM - letterSpacing));
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 100,
} as const;

export const timing = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;
