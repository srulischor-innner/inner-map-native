// The belief ground — the one element on the map that is NOT a part.
//
// WHY THIS EXISTS
// The user's self-belief (parts.belief on the canonical `${userId}::self-like`
// row) is the single thing on the map that belongs to the PERSON rather than to
// a part. Until now it was reachable only two ways: buried three taps deep in
// the Self-like folder's BeliefSection, and as the gate on the Self-like mic.
// It never appeared on the canvas at all. This puts it on the canvas.
//
// WHY IT DOESN'T LOOK LIKE A NODE
// Every part on this map is a compact centered SHAPE (circle, dashed ring,
// diamond) with a glow halo and a single UPPERCASE serif word stamped through
// its middle. If the belief were drawn that way it would read as an eighth
// part, which is exactly backwards — the belief is what the person stands on,
// separate from every part. So it is deliberately built from the opposite
// vocabulary on every axis:
//   - full-width horizontal band, not a compact centered shape
//   - a hairline rule, not a stroked ring; no glow, no fill, no breath
//   - the user's own sentence in sentence-case serif ITALIC, not a one-word
//     uppercase label
// The result reads as the FLOOR the triangle rests on, which is both the
// correct metaphor ("what you stand on") and visually unmistakable as a
// different class of thing.
//
// WHY THE RULE IS SKIA
// expo-linear-gradient isn't a dependency here, and RN's borderStyle:'dashed'
// renders inconsistently on Android. The map is already a Skia surface, so a
// 3px-tall Canvas gives us both the centre-weighted fade (filled state) and a
// clean dash (empty state) with no new dependency and no platform caveats.
//
// WHY THE EMPTY STATE IS A QUESTION
// Only ~6% of accounts have a belief, so "absent" is the common case and has to
// look intentional rather than broken. An empty slot reads as missing data; a
// question reads as an invitation, and it is literally the question the
// develop-belief chat flow asks. The dashed rule says "this ground isn't drawn
// yet" without saying "something failed".
//
// HEIGHT IS MEASURED, NOT ASSUMED
// The band reports its own laid-out height via onMeasure so the map tab can
// reserve exactly that much and no more. A 29-char belief costs ~46px; a
// 3-line one costs ~86px. Reserving a fixed worst case would have taxed every
// short belief for nothing. The measurement can't feed back into itself — band
// height depends only on width + text, never on the geometry it shrinks.

import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Canvas, Line, LinearGradient, DashPathEffect, vec } from '@shopify/react-native-skia';
import { colors, fonts } from '../../constants/theme';

// Canvas height for the rule. 3px rather than 1px because very short Skia
// surfaces have been flaky on some Android drivers; the line is stroked down
// the middle so the extra pixels are transparent padding.
const RULE_H = 3;

// colors.self (#C1AAD8) as an rgb triple so we can build rgba() stops. The
// belief is framed in SELF's lavender — not self-like's dimmer #8A7AAA, which
// is a PART color and would re-associate the belief with the part it happens
// to be stored on.
const SELF_RGB = '193,170,216';

type Props = {
  /** parts.belief off the self-like row. null/empty → the invitation state. */
  belief?: string | null;
  /** Canvas width — the rule spans the full band, edge to edge. */
  width: number;
  onPress?: () => void;
  /** Reports laid-out height so the map tab can reserve exactly that much. */
  onMeasure?: (h: number) => void;
};

export function BeliefGround({ belief, width, onPress, onMeasure }: Props) {
  const text = typeof belief === 'string' ? belief.trim() : '';
  const has = !!text;

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      // Round so sub-pixel jitter between frames can't retrigger the geometry
      // recompute in map.tsx on every layout pass.
      if (h > 0) onMeasure?.(Math.round(h));
    },
    [onMeasure],
  );

  return (
    <Pressable
      onPress={onPress}
      onLayout={handleLayout}
      accessibilityRole="button"
      accessibilityLabel={has ? `What you stand on: ${text}` : 'What do you stand on?'}
      accessibilityHint={
        has
          ? 'Opens your Self-like folder, where you can edit what you stand on'
          : 'Opens your Self-like folder, where you can establish what you stand on'
      }
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      {/* The ground line. Centre-weighted fade so it reads as a horizon rather
          than a UI divider; dashed and dimmer when there's nothing standing on
          it yet. Non-interactive — the whole band is one tap target. */}
      {width > 0 ? (
        <Canvas style={{ width, height: RULE_H }} pointerEvents="none">
          <Line
            p1={vec(0, RULE_H / 2)}
            p2={vec(width, RULE_H / 2)}
            style="stroke"
            strokeWidth={1}
          >
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width, 0)}
              colors={
                has
                  ? [`rgba(${SELF_RGB},0)`, `rgba(${SELF_RGB},0.5)`, `rgba(${SELF_RGB},0)`]
                  : [`rgba(${SELF_RGB},0)`, `rgba(${SELF_RGB},0.24)`, `rgba(${SELF_RGB},0)`]
              }
            />
            {has ? null : <DashPathEffect intervals={[5, 6]} />}
          </Line>
        </Canvas>
      ) : null}

      <View style={styles.inner}>
        {has ? (
          <>
            {/* Caption in the app's UI sans, not the map's serif — it names the
                element without borrowing the node-label register. */}
            <Text allowFontScaling={false} style={styles.caption} numberOfLines={1}>
              WHAT YOU STAND ON
            </Text>
            {/* Capped at 3 lines: the longest belief observed in production is
                195 chars, which lands just past 3 lines and tail-truncates. The
                full text is one tap away in the folder, and letting the band
                grow unbounded would eat the map. maxFontSizeMultiplier bounds
                the same risk for users with large accessibility text. */}
            <Text
              style={styles.belief}
              numberOfLines={3}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={1.4}
            >
              {text}
            </Text>
          </>
        ) : (
          <Text style={styles.invite} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            What do you stand on?
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
  rootPressed: { opacity: 0.62 },
  // Horizontal padding lives here, not on root, so the rule can still span the
  // full canvas width while the words stay comfortably inset.
  inner: {
    paddingHorizontal: 32,
    paddingTop: 8,
    paddingBottom: 2,
    alignItems: 'center',
  },
  caption: {
    fontFamily: fonts.sans,
    fontSize: 8.5,
    letterSpacing: 1.6,
    color: `rgba(${SELF_RGB},0.5)`,
    marginBottom: 5,
    textAlign: 'center',
  },
  // The belief itself is in cream, not lavender: these are the user's own
  // words, and cream is this app's voice-of-the-person color everywhere else.
  // The lavender is reserved for the framing (rule + caption). Text shadow
  // matches the node labels so the sentence stays legible where it crosses the
  // atmospheric glow.
  belief: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 20,
    color: colors.cream,
    opacity: 0.94,
    textAlign: 'center',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
  invite: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 19,
    color: `rgba(${SELF_RGB},0.58)`,
    textAlign: 'center',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
});
