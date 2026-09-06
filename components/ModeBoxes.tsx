// THE OPENING MODE QUESTION — four tappable boxes (founder ruling 2026-09-06).
//
// WHERE IT SITS. Under the SECOND assistant message. The first message is the
// greeting; the second responds to what the person actually said and then asks
// how they want to be met. That ordering matters: the boxes are never the first
// thing anyone sees, so nobody is asked to categorise how they want to be met
// before they have said anything at all.
//
// SKIPPABLE, BY RULING. They can keep typing and the conversation continues in
// whatever mode the control already shows (Explore, today). A required tap
// would stop the app responding to someone who has just said something real,
// which fights "presence comes first" — and would put a form between a
// distressed person and a reply.
//
// THE QUESTION LIVES HERE, NOT IN THE PROMPT. Same ruling as the fork, and for
// the same measured reason: prompt-patterns.md section 1, "where a contract is
// exact, the model is not the mechanism". Asking the model to produce an exact
// sentence in an exact place is the framing that scored 1/48. The model writes
// the reply above; the question and the four options are rendered.
//
// THE COPY IS NOT WRITTEN HERE. MODE_LABEL and MODE_BLURB are imported from
// WorkingModeControl, which is the sheet the info icon mirrors. The labels have
// drifted twice already — once when the sheet was softened and the orientation
// copy was not — so there is exactly one copy of these eight strings and this
// file is not allowed to be a ninth.
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radii, spacing } from '../constants/theme';
import { MODE_LABEL, MODE_BLURB, type WorkingMode } from './WorkingModeControl';

// Lightest to deepest, the same order as the sheet. The movement between them
// reads as a dial rather than four unrelated buttons, and a person who opens
// the sheet later meets them in the order they already saw.
const ORDER: WorkingMode[] = ['light', 'process', 'explore', 'differentiation'];

type Props = {
  /** Fires with the chosen mode. The caller sets the working mode and hides
   *  the boxes; nothing is sent to the server from here. */
  onPick: (mode: WorkingMode) => void;
  /** The mode currently in force — marked so the boxes never imply the person
   *  has no mode. They always have one; this asks whether to change it. */
  current: WorkingMode;
};

export function ModeBoxes({ onPick, current }: Props) {
  // Which box has its info popover open, if any. One at a time: two open
  // popovers in a four-box grid is unreadable on a phone.
  const [info, setInfo] = useState<WorkingMode | null>(null);

  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      <Text style={styles.question}>How do you want me to be here today?</Text>

      <View style={styles.grid}>
        {ORDER.map((m) => {
          const active = m === current;
          const open = info === m;
          return (
            <View key={m} style={styles.cell}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onPick(m);
                }}
                style={({ pressed }) => [
                  styles.box,
                  active && styles.boxActive,
                  pressed && styles.boxPressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                // The blurb is part of the accessible name so a screen-reader
                // user gets what the info icon shows, without having to find it.
                accessibilityLabel={`${MODE_LABEL[m]}. ${MODE_BLURB[m]}${active ? '. Currently active' : ''}`}
              >
                <Text style={[styles.label, active && styles.labelActive]} numberOfLines={2}>
                  {MODE_LABEL[m]}
                </Text>

                {/* INFO ICON. Its own hit target inside the box, with a
                    generous hitSlop — a 16pt glyph is below the 44pt minimum
                    on its own, and a mis-tap here would silently change how
                    the conversation works rather than just showing a line of
                    text. stopPropagation is what keeps the two apart. */}
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    Haptics.selectionAsync().catch(() => {});
                    setInfo(open ? null : m);
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.infoHit}
                  accessibilityRole="button"
                  accessibilityLabel={`What ${MODE_LABEL[m]} means`}
                  accessibilityState={{ expanded: open }}
                >
                  <Text style={[styles.infoGlyph, open && styles.infoGlyphOpen]}>ⓘ</Text>
                </Pressable>
              </Pressable>

              {open ? (
                <Text style={styles.blurb} accessibilityLiveRegion="polite">
                  {MODE_BLURB[m]}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* SAYS IT IS SKIPPABLE, IN SO MANY WORDS. Without this line four boxes
          read as a form that must be filled in before anything else happens,
          which is exactly what they are not. */}
      <Text style={styles.footnote}>Or just keep talking — we'll carry on as we are.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  question: {
    fontFamily: fonts.serif,
    fontSize: 19,
    lineHeight: 26,
    color: colors.cream,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // gap handles both axes, so no per-child margins to collapse or double.
    gap: spacing.sm,
  },
  cell: {
    // Two per row on a phone. The subtraction is the row gap; flexBasis rather
    // than a fixed width so it survives a rotation and a tablet.
    flexBasis: '48%',
    flexGrow: 1,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundCard,
  },
  boxActive: {
    borderColor: colors.borderAmber,
    backgroundColor: colors.amberFaint,
  },
  boxPressed: { opacity: 0.7 },
  label: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.cream,
  },
  labelActive: { color: colors.amberLight },
  infoHit: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
  },
  infoGlyph: {
    fontSize: 16,
    color: colors.creamFaint,
  },
  infoGlyphOpen: { color: colors.amber },
  blurb: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.creamDim,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  footnote: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.creamFaint,
    marginTop: spacing.md,
  },
});
