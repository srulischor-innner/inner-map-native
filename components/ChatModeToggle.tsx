// Chat tab mode toggle — Explore vs Process.
//
// Two separate pill-shaped buttons, one on each side of the bar.
// Explore on the left (the active default since the map-visibility
// PR), Process on the right. Each pill carries a small circular
// i button on the right side of its label that opens a per-mode
// info modal. Tapping the pill body switches modes (no-op when
// already active). Active pill: gold border, gold text, subtle dark
// gold background. Inactive pill: dim border + dim text.
//
// The pills drive which conversation thread is rendered and which
// system prompt the server uses on /api/chat — the parent (ChatScreen)
// owns the conversation-thread split.

import React, { useState } from 'react';
import {
  View, Text, Pressable, Modal, StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';

export type ChatMode = 'process' | 'explore';

const PROCESS_INFO_TEXT =
  "I'll follow your lead and be with what you bring. You talk, I hold. Mapping happens quietly in the background.";
const EXPLORE_INFO_TEXT =
  "I'll ask questions, notice patterns, and help you understand what's happening inside. Active and curious.";

type Props = {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  /** Optional center slot — rendered between the two pills, vertically
   *  centered. Used by the chat tab to host the active mode's ambient
   *  indicator (Process triangle / Explore confidence ring) so the
   *  active-mode glyph sits at the visual midpoint of the toggle bar
   *  instead of in the top-right header. */
  centerSlot?: React.ReactNode;
};

export function ChatModeToggle({ mode, onChange, centerSlot }: Props) {
  // Per-pill info modal target. Null = closed.
  const [infoFor, setInfoFor] = useState<ChatMode | null>(null);

  function pick(next: ChatMode) {
    if (next === mode) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(next);
  }

  function openInfo(target: ChatMode) {
    Haptics.selectionAsync().catch(() => {});
    setInfoFor(target);
  }

  return (
    <>
      <View style={styles.bar}>
        <ModePill
          label="Explore"
          active={mode === 'explore'}
          onPress={() => pick('explore')}
          onInfoPress={() => openInfo('explore')}
        />
        {/* Center slot — flex:1 wrapper centers whatever the parent
            passes in, so the indicator floats midway between the
            two pills. Empty wrapper takes the same flex share when
            centerSlot is null so the pills stay anchored to their
            edges either way. */}
        <View style={styles.centerSlot} pointerEvents="box-none">
          {centerSlot}
        </View>
        <ModePill
          label="Process"
          active={mode === 'process'}
          onPress={() => pick('process')}
          onInfoPress={() => openInfo('process')}
        />
      </View>

      <Modal
        visible={infoFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoFor(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setInfoFor(null)}>
          {/* Inner Pressable swallows the backdrop press so taps inside
              the card don't dismiss the modal accidentally. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.modalLabel}>
              {infoFor === 'process' ? 'PROCESS' : 'EXPLORE'}
            </Text>
            <Text style={styles.modalBody}>
              {infoFor === 'process' ? PROCESS_INFO_TEXT : EXPLORE_INFO_TEXT}
            </Text>
            <Pressable onPress={() => setInfoFor(null)} style={styles.gotIt}>
              <Text style={styles.gotItText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ModePill({
  label,
  active,
  onPress,
  onInfoPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onInfoPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
      accessibilityLabel={`Switch to ${label} mode`}
    >
      <Text
        style={[
          styles.pillText,
          active ? styles.pillTextActive : styles.pillTextInactive,
        ]}
      >
        {label}
      </Text>
      {/* Inline i button — its own Pressable so the parent pill press
          doesn't fire when the user taps the icon specifically.
          accessibilityRole=button keeps it discoverable as its own
          control. */}
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          onInfoPress();
        }}
        hitSlop={8}
        style={styles.infoBtn}
        accessibilityRole="button"
        accessibilityLabel={`What does ${label} mode do`}
      >
        <View
          style={[
            styles.infoCircle,
            active ? styles.infoCircleActive : styles.infoCircleInactive,
          ]}
        >
          <Text
            style={[
              styles.infoChar,
              active ? styles.infoCharActive : styles.infoCharInactive,
            ]}
          >
            i
          </Text>
        </View>
      </Pressable>
    </Pressable>
  );
}

// Subtle one-line indicator shown above the message list when the
// user is in Explore mode. Never shown for Process — that's the
// default state and adding a label would just be visual noise.
export function ChatModeIndicator({ mode }: { mode: ChatMode }) {
  if (mode !== 'explore') return null;
  return (
    <Text style={styles.indicator}>Explore mode — building your map</Text>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    // Vertically center every child of the bar — pills and the
    // center slot — so an icon placed in the middle aligns with the
    // pill text baselines instead of drifting toward the bar's top.
    alignItems: 'center',
    justifyContent: 'space-between',
    // Symmetric vertical padding so the pills sit on the optical
    // center of the bar. Previously paddingTop:0 / paddingBottom:4
    // pushed everything slightly upward.
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(230,180,122,0.1)',
  },
  centerSlot: {
    // Takes the empty space between the two pills and centers its
    // single child both axes. flex:1 ensures the pills hug the bar's
    // outer edges regardless of the icon's intrinsic width.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Pill — wraps label + inline info icon. flexDirection row so the
  // i sits to the right of the label inside the same gold border.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 0.5,
  },
  pillActive: {
    borderColor: 'rgba(230,180,122,0.65)',
    backgroundColor: 'rgba(230,180,122,0.12)',
  },
  pillInactive: {
    borderColor: 'rgba(230,180,122,0.18)',
    backgroundColor: 'transparent',
  },
  pillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    letterSpacing: 0.3,
    marginRight: 8,
  },
  pillTextActive: {
    color: '#E6B47A',
  },
  pillTextInactive: {
    color: 'rgba(240,237,232,0.35)',
  },

  // Inline info button — circular ring + lowercase i, subtle so it
  // doesn't compete with the pill label.
  infoBtn: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  infoCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCircleActive: {
    borderColor: 'rgba(230,180,122,0.65)',
  },
  infoCircleInactive: {
    borderColor: 'rgba(230,180,122,0.3)',
  },
  infoChar: {
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 11,
    lineHeight: 13,
    // Optical-center the lowercase i in the circle. Tweaked manually
    // because RN Text has no baseline-center, and the natural glyph
    // sits a hair high in this circle size.
    marginTop: -1,
  },
  infoCharActive: { color: '#E6B47A' },
  infoCharInactive: { color: 'rgba(230,180,122,0.5)' },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#0e0e1a',
    borderRadius: 20,
    padding: 24,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.2)',
    width: '100%',
  },
  modalLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#E6B47A',
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: 12,
  },
  modalBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: 'rgba(240,237,232,0.78)',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  gotIt: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  gotItText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: 'rgba(230,180,122,0.5)',
  },

  indicator: {
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 11,
    color: 'rgba(230,180,122,0.3)',
    textAlign: 'center',
    paddingVertical: 6,
    letterSpacing: 0.5,
  },
});
