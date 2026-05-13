// One Guide slide. Single source of layout so every slide across every section
// has identical rhythm: centered visual, part-colored title, body paragraphs.

import React, { useCallback, useEffect, useState } from 'react';
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
  cinematic = false,
}: {
  data: SlideData;
  width: number;
  /** When true, body paragraphs animate in via TypewriterText the first
   *  time the slide becomes the active page. Used by the onboarding
   *  flow's WelcomeSlides on a brand-new install (gated by the
   *  hasSeenWelcome AsyncStorage flag in the parent). The Guide tab
   *  always passes false — once the user has seen the cinematic
   *  welcome, the same slides render statically as reference material.
   *  Title always renders instantly regardless. */
  animateBody?: boolean;
  /** Whether this slide is currently the foreground page in the
   *  pager. Triggers the one-shot typewriter when both this and
   *  animateBody are true. */
  isActive?: boolean;
  /** When true, render with bumped, bolder typography for a cinematic
   *  first-launch feel (~20% larger title + body, weight 600 body).
   *  False everywhere else (Guide tab, Map / Healing / Using sections)
   *  so post-onboarding renders use the standard reference layout. */
  cinematic?: boolean;
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

  // Sequential paragraph reveal — paragraph N+1 only begins typing
  // AFTER paragraph N has fully finished. Implemented via an
  // index-based gate: `revealedUpTo` tracks the index of the
  // paragraph currently mid-type. TypewriterText fires onDone when
  // its full string lands; that callback bumps revealedUpTo and the
  // next paragraph mounts with its typewriter.
  //
  // Earlier this was a pre-computed startDelayMs per paragraph based
  // on `length * CHAR_INTERVAL_MS`. The estimate could undershoot the
  // actual reveal time (setTimeout slop, JS thread contention), letting
  // paragraph 2 start before paragraph 1 finished — chaotic reading.
  // The callback chain is exact: paragraph N+1 cannot start until
  // paragraph N's last character has rendered.
  //
  // Reset on text change so a re-trigger (different slide instance)
  // starts the chain from the top.
  const [revealedUpTo, setRevealedUpTo] = useState(0);
  useEffect(() => {
    // Reset whenever the slide's body changes (paragraph count or text
    // identity). Without this a remount with new copy would skip the
    // first paragraph because revealedUpTo was already at body.length.
    setRevealedUpTo(0);
  }, [data.body]);
  // Add a small breath (~220ms) between paragraphs by delaying the
  // next paragraph's start — feels like the reader taking a beat
  // before continuing rather than instantly snapping to the next line.
  const PARA_BREATH_MS = 220;
  const advanceParagraph = useCallback((i: number) => {
    setTimeout(() => setRevealedUpTo((cur) => Math.max(cur, i + 1)), PARA_BREATH_MS);
  }, []);

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
        <Text
          style={[
            styles.title,
            cinematic && !isClosing ? styles.titleCinematic : null,
            data.titleColor ? { color: data.titleColor } : null,
          ]}
        >
          {data.title}
        </Text>
      ) : null}
      <View style={[styles.body, isClosing && styles.closingBody]}>
        {data.body.map((para, i) => {
          const paraStyle = isClosing
            ? styles.closingPara
            : cinematic
              ? styles.paraCinematic
              : styles.para;
          if (showTypewriter) {
            // Sequential gate — paragraph i renders ONLY if every
            // paragraph before it has fired its onDone (revealedUpTo
            // strictly greater than i-1). Earlier paragraphs render
            // as completed Text so their finished text stays on
            // screen while later paragraphs are still typing or
            // pending. Later paragraphs render as empty placeholders
            // so they reserve layout height without flashing the
            // finished string.
            if (i < revealedUpTo) {
              // Already finished typing — render as plain Text.
              return <Text key={i} style={paraStyle}>{para}</Text>;
            }
            if (i === revealedUpTo) {
              // Current paragraph — mount the typewriter. onDone
              // advances the gate so paragraph i+1 can start.
              return (
                <TypewriterText
                  key={i}
                  text={para}
                  style={paraStyle}
                  onDone={() => advanceParagraph(i)}
                />
              );
            }
            // Future paragraph — empty placeholder so the slide
            // doesn't reflow when this paragraph eventually mounts.
            return <Text key={i} style={paraStyle}>{''}</Text>;
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
  // Cinematic title — ~22% larger than the reference title, same
  // CormorantGaramond_600SemiBold so the weight stays consistent.
  // Used by the first-launch onboarding WelcomeSlides only.
  titleCinematic: {
    fontSize: 44,
    lineHeight: 52,
    letterSpacing: 0.4,
    marginBottom: spacing.lg,
  },
  body: { width: '100%', maxWidth: 560 },
  para: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  // Cinematic body — ~20% larger and stepped up to weight 600 (DMSans
  // SemiBold) so the words land with more presence on first launch.
  // Used by the onboarding WelcomeSlides only; Guide-tab Welcome
  // section keeps `para` for reference-material rhythm.
  paraCinematic: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 18,
    lineHeight: 28,
    marginBottom: spacing.md,
    letterSpacing: 0.2,
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
