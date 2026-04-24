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

  // DM Sans
  sans:       'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansBold:   'DMSans_600SemiBold',
};

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
