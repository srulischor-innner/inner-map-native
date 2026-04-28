// One Guide slide. Single source of layout so every slide across every section
// has identical rhythm: centered visual, part-colored title, body paragraphs.

import React from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';
import { GuideNodeVisual } from './GuideNodeVisual';
import type { GuideSlide as SlideData } from '../../utils/guideContent';

export function GuideSlide({ data, width }: { data: SlideData; width: number }) {
  const { height } = useWindowDimensions();
  const visualSize = Math.min(width * 0.5, height * 0.32);
  // The Guide closing slide is laid out distinctly: no title, the body
  // sits in larger centered Cormorant with generous spacing so the words
  // land as their own moment. Detected by visual kind so the slide data
  // remains a plain GuideSlide.
  const isClosing = data.visual === 'triangleToCircle';
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
        {data.body.map((para, i) => (
          <Text key={i} style={isClosing ? styles.closingPara : styles.para}>
            {para}
          </Text>
        ))}
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
