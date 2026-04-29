// Chat tab mode toggle — Process vs Explore. Sits below the tab bar,
// above the messages. Decides which system prompt the server uses on
// /api/chat:
//   process  → HOLDING_SPACE_PROMPT (presence-first, gentle holding)
//   explore  → MAPPING_PROMPT       (active curiosity + map-building)
//
// Process is the default because it's the gentler entry point. The
// user can switch to Explore whenever they want; new sessions reset
// to Process.

import React, { useState } from 'react';
import {
  View, Text, Pressable, Modal, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export type ChatMode = 'process' | 'explore';

type Props = {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
};

export function ChatModeToggle({ mode, onChange }: Props) {
  const [showInfo, setShowInfo] = useState(false);

  function pick(next: ChatMode) {
    if (next === mode) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(next);
  }

  return (
    <>
      <View style={styles.bar}>
        <View style={styles.pill}>
          <Pressable
            onPress={() => pick('process')}
            style={[styles.segment, mode === 'process' && styles.segmentActive]}
            accessibilityLabel="Switch to Process mode"
          >
            <Text style={[styles.segmentText, mode === 'process' && styles.segmentTextActive]}>
              Process
            </Text>
          </Pressable>
          <Pressable
            onPress={() => pick('explore')}
            style={[styles.segment, mode === 'explore' && styles.segmentActive]}
            accessibilityLabel="Switch to Explore mode"
          >
            <Text style={[styles.segmentText, mode === 'explore' && styles.segmentTextActive]}>
              Explore
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => setShowInfo(true)}
          style={styles.infoBtn}
          hitSlop={10}
          accessibilityLabel="What do these modes mean"
        >
          <Ionicons name="information-circle-outline" size={16} color="rgba(230,180,122,0.4)" />
        </Pressable>
      </View>

      <Modal
        visible={showInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setShowInfo(false)}>
          {/* Inner Pressable swallows the backdrop press so taps inside
              the card don't dismiss the modal accidentally. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>Two ways to talk</Text>

            <View style={{ marginBottom: 16 }}>
              <Text style={styles.label}>PROCESS</Text>
              <Text style={styles.body}>
                I'll follow your lead and be with what you bring. You talk, I hold. Mapping happens quietly in the background.
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={{ marginBottom: 20 }}>
              <Text style={styles.label}>EXPLORE</Text>
              <Text style={styles.body}>
                I'll ask questions, notice patterns, and help you understand what's happening inside. Active and curious.
              </Text>
            </View>

            <Pressable onPress={() => setShowInfo(false)} style={styles.gotIt}>
              <Text style={styles.gotItText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
    alignItems: 'center',
    justifyContent: 'center',
    // User asked to remove all top padding so the toggle sits flush
    // against the headerStrip above it. paddingTop: 0; bottom 4 keeps
    // the message list close underneath. Any gap above the pill is
    // now just whatever the headerStrip's natural baseline produces
    // (~hairline).
    paddingTop: 0,
    paddingBottom: 4,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(230,180,122,0.1)',
  },
  pill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.2)',
    padding: 3,
  },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  segmentActive: {
    backgroundColor: 'rgba(230,180,122,0.15)',
  },
  segmentText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: 'rgba(240,237,232,0.35)',
    letterSpacing: 0.3,
  },
  segmentTextActive: {
    color: '#E6B47A',
  },
  infoBtn: {
    marginLeft: 8,
    padding: 4,
  },

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
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#F0EDE8',
    textAlign: 'center',
    marginBottom: 20,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#E6B47A',
    letterSpacing: 1,
    marginBottom: 6,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: 'rgba(240,237,232,0.7)',
    lineHeight: 21,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(230,180,122,0.1)',
    marginBottom: 16,
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
