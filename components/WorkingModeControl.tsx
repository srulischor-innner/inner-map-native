// MODE — the always-available control, at the top of the screen.
//
// This is the load-bearing piece of the four-mode design, and the reason is
// measurement rather than taste. Across 5,489 real user turns, requests to work
// a different way ran at roughly 0.04%. The founder's read — and the evidence
// agrees — is that this measures ignorance, not absence: one person did ask
// ("can you keep these shorter, it's a lot to read") without ever being told
// they could. Nobody asks for what they don't know is available.
//
// So the control is LABELLED WITH THE CURRENT STATE, never a bare icon:
//
//     Mode:  Sitting with it  ▾
//
// A hidden icon teaches nothing. A row that says what is happening right now
// teaches that modes exist, that this one is chosen, and that it can be
// changed — to someone who never reads a word of onboarding. The label doing
// double duty as the affordance is the whole design.
//
// WHERE IT LIVES. At the top, above the transcript, where the two-pill toggle
// used to be. It spent exactly one build above the input, on the theory that a
// control is reached for mid-conversation; using it settled the question the
// other way. Mode is a STATE — it says what is happening right now — and a
// state belongs where you look to find out, not where your thumb rests to act.
//
// It carries no timing risk at all, which is what makes it worth building
// first: the fork has to choose a moment and can get it wrong; this one waits.
// Its existence is also what lets the fork be rare — the fork only has to serve
// people who would not think to ask.

import React, { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

export type WorkingMode = 'light' | 'process' | 'explore' | 'differentiation';

// THE USER NEVER SEES A MODE NAME. "Light", "Process", "Explore" and
// "Differentiation" are our words for our prompts; these are theirs, and they
// are the same words the opening question uses ("put it down · sit with it ·
// understand it") so the label and the question cannot drift apart. Gerunds
// here because the row describes what IS happening; the opening question uses
// the imperative because it asks what they WANT.
export const MODE_LABEL: Record<WorkingMode, string> = {
  light: 'Saying it',
  process: 'Sitting with it',
  explore: 'Understanding it',
  differentiation: 'Leading it',
};

// WHAT HAPPENS, NOT WHERE YOU ARE. The first version read as four rooms —
// "Staying with what is already here", "The pattern" — which is the same mistake
// that let a reply tell someone to go to a place that does not exist from their
// side. There are no rooms. There is one conversation, and these are the things
// it would do differently. Hence the verbs, and hence "we".
const MODE_BLURB: Record<WorkingMode, string> = {
  light: 'I listen. Nothing gets pulled apart and nothing gets mapped at you.',
  process: 'We stay with how it feels, in the body, without going anywhere.',
  explore: 'We look at the pattern — what the parts are and what they protect.',
  // "Leading it" is the YOU framework's word, not a description of technique:
  // the belief stops driving and you do. The blurb has to carry that, or the
  // label reads as "leading the conversation", which is not what it means.
  differentiation: 'We take a belief apart: where it came from, whether it holds.',
};

// Order matters: lightest to deepest, left as a vertical list so the movement
// between them reads as a dial rather than four unrelated buttons.
const ORDER: WorkingMode[] = ['light', 'process', 'explore', 'differentiation'];

type Props = {
  mode: WorkingMode;
  onChange: (next: WorkingMode) => void;
  disabled?: boolean;
};

export function WorkingModeControl({ mode, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);

  function pick(next: WorkingMode) {
    setOpen(false);
    if (next === mode) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(next);
  }

  return (
    <>
      <Pressable
        onPress={() => {
          if (disabled) return;
          Haptics.selectionAsync().catch(() => {});
          setOpen(true);
        }}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        // The label is the whole point, so it is also the accessible name —
        // a screen-reader user gets the same teaching a sighted one does.
        accessibilityLabel={`Mode: ${MODE_LABEL[mode]}. Tap to change.`}
        accessibilityHint="Opens the four ways we can work"
      >
        <Text style={styles.rowLead}>Mode: </Text>
        <Text style={styles.rowValue}>{MODE_LABEL[mode]}</Text>
        <Text style={styles.caret}> ▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Inner pressable swallows taps so the sheet doesn't close when
              someone touches the sheet itself. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>How do you want to work?</Text>

            {ORDER.map((m) => {
              const active = m === mode;
              return (
                <Pressable
                  key={m}
                  onPress={() => pick(m)}
                  style={({ pressed }) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.optionPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${MODE_LABEL[m]}. ${MODE_BLURB[m]}`}
                >
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                    {MODE_LABEL[m]}
                    {active ? '  ·  now' : ''}
                  </Text>
                  <Text style={styles.optionBlurb}>{MODE_BLURB[m]}</Text>
                </Pressable>
              );
            })}

            {/* The invitation, at the moment it is most useful — someone who
                opened this sheet is already thinking about how we work. This is
                the third of the four placements; the other three are the
                opening bubble, the end of the first reply, and orientation. */}
            <Text style={styles.footnote}>
              You never have to come back here. Saying it works too — "can we slow down",
              "I just want to talk", "why does this keep happening". I'll follow.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const GOLD = '#E6B47A';
const styles = StyleSheet.create({
  // Deliberately quiet: this sits above the input all session, so it has to
  // survive being looked at a thousand times. Dim until touched.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  rowPressed: { opacity: 0.6 },
  rowLead: { color: 'rgba(240,237,232,0.35)', fontSize: 12 },
  rowValue: { color: 'rgba(230,180,122,0.75)', fontSize: 12, fontWeight: '600' },
  caret: { color: 'rgba(230,180,122,0.5)', fontSize: 12 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0e0e1a',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.18)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
  },
  sheetTitle: {
    color: 'rgba(240,237,232,0.85)',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 14,
  },
  option: {
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.18)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
  },
  optionActive: {
    borderColor: 'rgba(230,180,122,0.65)',
    backgroundColor: 'rgba(230,180,122,0.12)',
  },
  optionPressed: { opacity: 0.7 },
  optionLabel: { color: 'rgba(240,237,232,0.7)', fontSize: 14, fontWeight: '600' },
  optionLabelActive: { color: GOLD },
  optionBlurb: {
    color: 'rgba(240,237,232,0.4)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  footnote: {
    color: 'rgba(240,237,232,0.35)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    fontStyle: 'italic',
  },
});
