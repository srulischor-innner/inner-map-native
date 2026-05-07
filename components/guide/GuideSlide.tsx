// One Guide slide. Single source of layout so every slide across every section
// has identical rhythm: centered visual, part-colored title, body paragraphs.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';
import { GuideNodeVisual } from './GuideNodeVisual';
import { TypewriterText } from './TypewriterText';
import type { GuideSlide as SlideData } from '../../utils/guideContent';

export function GuideSlide({
  data,
  width,
  animateBody = false,
  isActive = false,
}: {
  data: SlideData;
  width: number;
  /** When true, body paragraphs animate in via TypewriterText the first
   *  time the slide becomes the active page. Used only by the Welcome
   *  section's first-launch run (gated by hasSeenWelcome in the parent).
   *  Title always renders instantly regardless. */
  animateBody?: boolean;
  /** Whether this slide is currently the foreground page in the
   *  pager. Triggers the one-shot typewriter when both this and
   *  animateBody are true. */
  isActive?: boolean;
}) {
  const { height } = useWindowDimensions();
  const visualSize = Math.min(width * 0.5, height * 0.32);
  // The Guide closing slide is laid out distinctly: no title, the body
  // sits in larger centered Cormorant with generous spacing so the words
  // land as their own moment. Detected by visual kind so the slide data
  // remains a plain GuideSlide.
  const isClosing = data.visual === 'triangleToCircle';

  // One-shot trigger — flips true the first time this slide becomes
  // the active page while animateBody is in effect. Once true it stays
  // true for this mount, so re-entering the slide during the same
  // session doesn't restart the animation.
  //
  // LAZY INITIALIZER: when the slide mounts already-active (slide 0
  // on first paint of the welcome carousel), kick off the typewriter
  // immediately. Without this, render 1 falls into the empty-text
  // path below for one frame, then the post-paint effect flips
  // hasTriggered and the typewriter mounts on render 2. In practice
  // that's a perceptible flash before typing begins.
  const [hasTriggered, setHasTriggered] = useState(
    () => animateBody && isActive,
  );
  useEffect(() => {
    if (animateBody && isActive && !hasTriggered) {
      setHasTriggered(true);
    }
  }, [animateBody, isActive, hasTriggered]);

  // Stagger paragraph reveals — second paragraph waits for the first
  // to roughly finish typing so they land in sequence rather than all
  // at once. We don't have an exact done callback chain because the
  // welcome slides ship single-paragraph copy, but the offset keeps
  // multi-paragraph slides clean if any are added later. Computed once
  // per body for stability.
  const startOffsets = useRef<number[]>([]);
  if (startOffsets.current.length !== data.body.length) {
    let acc = 0;
    startOffsets.current = data.body.map((p, i) => {
      const offset = acc;
      // 35ms per char + a 250ms breath before the next paragraph.
      acc += p.length * 35 + 250;
      return i === 0 ? 0 : offset;
    });
  }

  const showTypewriter = animateBody && hasTriggered && !isClosing;
  // While animateBody is in effect but this slide hasn't been
  // activated yet (off-screen siblings in the FlatList), render an
  // empty <Text> instead of the full paragraph. Otherwise the user
  // would see the full text appear on swipe-in for one frame before
  // the typewriter mounts and resets it to empty — reading as a
  // flash of finished text rather than an animation.
  const showEmptyPlaceholder = animateBody && !hasTriggered && !isClosing;

  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={[styles.container, isClosing && styles.closingContainer]}
      showsVerticalScrollIndicator={false}
    >
      {/* 'noVisual' slides render no canvas — just a slim spacer so the
          title doesn't slam into the top of the page. Used by the
          closing slide of "What Holds You" so the principle breathes
          without illustration. */}
      {data.visual === 'noVisual' ? (
        <View style={{ height: 60 }} />
      ) : (
        <View style={[styles.visualWrap, isClosing && styles.closingVisualWrap]}>
          <GuideNodeVisual
            kind={data.visual}
            size={isClosing ? Math.min(width * 0.7, height * 0.4) : visualSize}
          />
        </View>
      )}
      {data.title ? (
        <Text style={[styles.title, data.titleColor ? { color: data.titleColor } : null]}>
          {data.title}
        </Text>
      ) : null}
      <View style={[styles.body, isClosing && styles.closingBody]}>
        {data.body.map((para, i) => {
          const paraStyle = isClosing ? styles.closingPara : styles.para;
          if (showTypewriter) {
            return (
              <TypewriterText
                key={i}
                text={para}
                style={paraStyle}
                startDelayMs={startOffsets.current[i] || 0}
              />
            );
          }
          if (showEmptyPlaceholder) {
            // Empty Text — preserves layout height so the slide
            // doesn't reflow when the typewriter mounts, but
            // doesn't flash the finished string before typing
            // begins. Identity ('') is stable so React reuses
            // this node across renders.
            return <Text key={i} style={paraStyle}>{''}</Text>;
          }
          return (
            <Text key={i} style={paraStyle}>
              {para}
            </Text>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  visualWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 36,
    letterSpacing: 0.5,
    lineHeight: 42,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: { width: '100%', maxWidth: 560 },
  para: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },

  // Closing slide — generous vertical breathing room so the morphing
  // visual + the words feel like an arrival rather than another slide.
  closingContainer: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    justifyContent: 'center',
    minHeight: '100%',
  },
  closingVisualWrap: {
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  closingBody: { width: '100%', maxWidth: 480, alignItems: 'center' },
  // Cormorant 20px, cream, centered, generous line height per spec.
  closingPara: {
    color: colors.cream,
    fontFamily: fonts.serif,
    fontSize: 20,
    lineHeight: 32,
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
});
