// Onboarding flow — a single screen with three phases behind one full-screen layout:
//   1. welcome — 6 swipeable intro slides (title, patterns, map, sketch, companion,
//      not-therapy, begin)
//   2. terms   — plain-language disclaimer with a checkbox and "I understand" CTA
//   3. intake  — 4-step form: name / about / goals / free-text. Each step has its
//      own "Continue" button; slide 2+ have a "skip" link to respect the user.
//
// On completion of each phase we mark the corresponding flag in AsyncStorage so a
// restart mid-flow resumes where the user left off. When the final flag lands we
// router.replace('/') to the main tabs.

import React, { useState, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, FlatList, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../constants/theme';
import {
  markIntroSeen, markTermsAccepted, markIntakeComplete,
} from '../services/onboarding';
import { api } from '../services/api';
import { GuideNodeVisual } from '../components/guide/GuideNodeVisual';
import { GuideDots } from '../components/guide/GuideDots';

type Phase = 'welcome' | 'terms' | 'intake';

export default function OnboardingScreen() {
  const [phase, setPhase] = useState<Phase>('welcome');
  const router = useRouter();

  async function finishAndEnterApp() {
    await markIntakeComplete();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {phase === 'welcome' ? (
        <WelcomeSlides onDone={async () => { await markIntroSeen(); setPhase('terms'); }} />
      ) : phase === 'terms' ? (
        <TermsScreen onAccept={async () => { await markTermsAccepted(); await api.acceptTerms(); setPhase('intake'); }} />
      ) : (
        <IntakeFlow onDone={finishAndEnterApp} />
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// 1. WELCOME SLIDES
// ============================================================================
type WelcomeSlide = { visual: Parameters<typeof GuideNodeVisual>[0]['kind']; title?: string; body?: string; showBegin?: boolean };
const WELCOME_SLIDES: WelcomeSlide[] = [
  { visual: 'intro',    title: 'Inner Map',                   body: 'Understand what’s happening inside you.' },
  { visual: 'tension',  title: 'We all have patterns',        body: 'Ways we react. Things that trigger us. Feelings we can’t explain. Most of us don’t fully understand why.' },
  { visual: 'fullmap',  title: 'Inner Map helps you see them',body: 'As you talk, patterns emerge. The same feelings, the same voices, the same pushes and pulls — the AI listens and gradually reflects them back. We call it your map.' },
  { visual: 'self',     title: 'Your map starts as a sketch', body: 'The more we talk, the more detailed and accurate it becomes. Every conversation adds a layer.' },
  { visual: 'seed',     title: 'A companion for the long journey',
    body: 'Come when something is activated. Come when a pattern repeated and you want to understand why. Come when you need to be heard without advice or fixing. The longer you come, the more it knows you.' },
  { visual: 'selfLike', title: 'This is not therapy',         body: 'It’s a mirror. A space to see yourself more clearly. Nothing you share is judged.' },
  { visual: 'newCreation', showBegin: true },
];

function WelcomeSlides({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  return (
    <View style={styles.flex}>
      <FlatList
        ref={listRef}
        data={WELCOME_SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          if (i !== index) setIndex(i);
        }}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <ScrollView style={{ width }} contentContainerStyle={styles.welcomeSlide}>
            <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
              <GuideNodeVisual kind={item.visual} size={Math.min(width * 0.5, 160)} />
            </View>
            {item.title ? <Text style={styles.welcomeTitle}>{item.title}</Text> : null}
            {item.body ? <Text style={styles.welcomeBody}>{item.body}</Text> : null}
            {item.showBegin ? (
              <Pressable onPress={onDone} style={styles.beginBtn}>
                <Text style={styles.beginText}>B E G I N</Text>
              </Pressable>
            ) : null}
            {item.showBegin ? (
              <Text style={styles.disclaimer}>
                Inner Map is a self-reflection tool, not a substitute for professional
                mental health support.
              </Text>
            ) : null}
          </ScrollView>
        )}
      />
      <View style={styles.welcomeFoot}>
        <GuideDots
          count={WELCOME_SLIDES.length}
          active={index}
          onTap={(i) => { listRef.current?.scrollToIndex({ index: i, animated: true }); }}
        />
      </View>
    </View>
  );
}

// ============================================================================
// 2. TERMS
// ============================================================================
function TermsScreen({ onAccept }: { onAccept: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.termsRoot} showsVerticalScrollIndicator={false}>
      <Text style={styles.termsTitle}>Before you begin</Text>
      <Text style={styles.termsLead}>
        Inner Map is a self-reflection tool. It is not therapy, not medical advice, and
        not a crisis service.
      </Text>
      <Text style={styles.termsHeading}>By continuing you understand that:</Text>
      {[
        'Inner Map does not provide professional mental health treatment',
        'The AI is not a licensed therapist or medical professional',
        'Nothing shared here should be treated as clinical advice or diagnosis',
        'If you are in crisis or need immediate support, please contact a mental health professional or crisis service',
        'You use this app at your own discretion',
      ].map((bullet, i) => (
        <View key={i} style={styles.termsBullet}>
          <Text style={styles.termsDot}>•</Text>
          <Text style={styles.termsBulletText}>{bullet}</Text>
        </View>
      ))}
      <Text style={styles.termsPrivacy}>
        Your conversations are private and stored securely. We do not sell your data
        or share it with third parties.
      </Text>

      <Pressable
        onPress={() => { Haptics.selectionAsync().catch(() => {}); setChecked((c) => !c); }}
        style={styles.termsCheck}
      >
        <View style={[styles.checkbox, checked && styles.checkboxOn]}>
          {checked ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.termsCheckLabel}>I have read and agree to the terms above.</Text>
      </Pressable>

      <Pressable
        onPress={() => {
          if (!checked) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onAccept();
        }}
        style={[styles.beginBtn, !checked && styles.beginBtnDisabled]}
        disabled={!checked}
      >
        <Text style={[styles.beginText, !checked && { opacity: 0.4 }]}>I  UNDERSTAND  —  CONTINUE</Text>
      </Pressable>
    </ScrollView>
  );
}

// ============================================================================
// 3. INTAKE — four steps
// ============================================================================
type IntakeState = {
  name: string;
  age: string;
  gender: string;
  relationship: string;
  profession: string;
  goals: string[];
  goalsOther: string;
  freeText: string;
};

function IntakeFlow({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<IntakeState>({
    name: '', age: '', gender: '', relationship: '', profession: '',
    goals: [], goalsOther: '', freeText: '',
  });
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  async function submit() {
    const ageNum = parseInt(state.age, 10);
    await api.postIntake({
      name: state.name,
      age: Number.isFinite(ageNum) ? ageNum : null,
      gender: state.gender,
      relationship: state.relationship,
      profession: state.profession,
      goals: state.goals,
      goalsOther: state.goalsOther,
      freeText: state.freeText,
    });
    onDone();
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.stepDots}>
        {[1, 2, 3, 4].map((n) => (
          <View key={n} style={[styles.stepDot, n === step && styles.stepDotActive, n < step && styles.stepDotDone]} />
        ))}
      </View>

      {step === 1 ? (
        <StepWrap title="What should I call you?" subtitle="First name is fine.">
          <TextInput
            value={state.name}
            onChangeText={(t) => setState((s) => ({ ...s, name: t }))}
            placeholder="Your name"
            placeholderTextColor={colors.creamFaint}
            style={styles.input}
            selectionColor={colors.amber}
            autoFocus
          />
          <CTA
            onPress={() => setStep(2)}
            disabled={!state.name.trim()}
            label="CONTINUE"
          />
        </StepWrap>
      ) : null}

      {step === 2 ? (
        <StepWrap title="A little about you" subtitle="Everything here is optional.">
          <Field label="Age">
            <TextInput
              value={state.age}
              onChangeText={(t) => setState((s) => ({ ...s, age: t.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad"
              placeholder="—"
              placeholderTextColor={colors.creamFaint}
              style={styles.input}
              selectionColor={colors.amber}
            />
          </Field>
          <Field label="Gender">
            <ChipRow
              items={['Woman', 'Man', 'Non-binary', 'Prefer not to say']}
              value={state.gender}
              onChange={(v) => setState((s) => ({ ...s, gender: v }))}
            />
          </Field>
          <Field label="Relationship">
            <ChipRow
              items={['Single', 'Dating', 'Partnered', 'Married', 'Separated', 'Other']}
              value={state.relationship}
              onChange={(v) => setState((s) => ({ ...s, relationship: v }))}
            />
          </Field>
          <Field label="What do you do">
            <TextInput
              value={state.profession}
              onChangeText={(t) => setState((s) => ({ ...s, profession: t }))}
              placeholder="Your work, role, or life focus"
              placeholderTextColor={colors.creamFaint}
              style={styles.input}
              selectionColor={colors.amber}
            />
          </Field>
          <CTA onPress={() => setStep(3)} label="CONTINUE" />
          <SkipLink onPress={() => setStep(3)} />
        </StepWrap>
      ) : null}

      {step === 3 ? (
        <StepWrap title="What brings you here?" subtitle="Pick any that feel true.">
          <MultiChips
            items={[
              'Understand myself better',
              'Work through a pattern',
              'Process something specific',
              'Have a space between therapy sessions',
              'Curious about parts work',
              'Something else',
            ]}
            values={state.goals}
            onToggle={(v) => {
              setState((s) => {
                const has = s.goals.includes(v);
                return { ...s, goals: has ? s.goals.filter((g) => g !== v) : [...s.goals, v] };
              });
            }}
          />
          {state.goals.includes('Something else') ? (
            <TextInput
              value={state.goalsOther}
              onChangeText={(t) => setState((s) => ({ ...s, goalsOther: t }))}
              placeholder="What's alive for you?"
              placeholderTextColor={colors.creamFaint}
              style={[styles.input, { marginTop: spacing.sm }]}
              multiline
              selectionColor={colors.amber}
            />
          ) : null}
          <CTA onPress={() => setStep(4)} label="CONTINUE" />
          <SkipLink onPress={() => setStep(4)} />
        </StepWrap>
      ) : null}

      {step === 4 ? (
        <StepWrap
          title="Is there anything else"
          subtitle="you'd want me to know before we start?"
        >
          <TextInput
            value={state.freeText}
            onChangeText={(t) => setState((s) => ({ ...s, freeText: t }))}
            placeholder="Take your time — say as much or as little as you want."
            placeholderTextColor={colors.creamFaint}
            style={[styles.input, { minHeight: 140, textAlignVertical: 'top' }]}
            multiline
            selectionColor={colors.amber}
          />
          <CTA onPress={submit} label="B E G I N" />
          <SkipLink onPress={submit} label="Skip" />
        </StepWrap>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ---------- intake sub-components ----------
function StepWrap({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.stepWrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>{title}</Text>
      {subtitle ? <Text style={styles.stepSubtitle}>{subtitle}</Text> : null}
      {children}
    </ScrollView>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}
function ChipRow({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {items.map((it) => {
        const on = value === it;
        return (
          <Pressable
            key={it}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(on ? '' : it); }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{it}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function MultiChips({ items, values, onToggle }: { items: string[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {items.map((it) => {
        const on = values.includes(it);
        return (
          <Pressable
            key={it}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onToggle(it); }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{it}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function CTA({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => { if (disabled) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
      style={[styles.beginBtn, { marginTop: spacing.lg }, disabled && styles.beginBtnDisabled]}
      disabled={disabled}
    >
      <Text style={[styles.beginText, disabled && { opacity: 0.4 }]}>{label}</Text>
    </Pressable>
  );
}
function SkipLink({ onPress, label = 'Skip this' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} style={{ alignSelf: 'center', padding: 10, marginTop: 6 }}>
      <Text style={{ color: colors.creamFaint, fontSize: 12, letterSpacing: 0.5 }}>{label}</Text>
    </Pressable>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // welcome slides
  welcomeSlide: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  welcomeTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 36, letterSpacing: 0.5,
    textAlign: 'center', marginBottom: spacing.md,
  },
  welcomeBody: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 24, textAlign: 'center', maxWidth: 400,
  },
  welcomeFoot: { paddingVertical: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },

  // terms
  termsRoot: { padding: spacing.xl, paddingBottom: spacing.xxl },
  termsTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 30, marginBottom: spacing.md,
  },
  termsLead: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 22, marginBottom: spacing.lg,
  },
  termsHeading: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2, marginBottom: spacing.sm,
  },
  termsBullet: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  termsDot: { color: colors.amber, fontSize: 14 },
  termsBulletText: { flex: 1, color: colors.cream, fontSize: 14, lineHeight: 22 },
  termsPrivacy: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic', marginTop: spacing.md, marginBottom: spacing.lg, lineHeight: 18 },
  termsCheck: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.xl },
  checkbox: {
    width: 22, height: 22, borderRadius: 5,
    borderColor: colors.amberDim, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  checkmark: { color: colors.background, fontWeight: '700' },
  termsCheckLabel: { color: colors.cream, fontSize: 14, flex: 1, lineHeight: 20 },

  // intake
  stepDots: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingTop: spacing.sm },
  stepDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(230,180,122,0.2)' },
  stepDotActive: { backgroundColor: colors.amber, transform: [{ scale: 1.2 }] },
  stepDotDone: { backgroundColor: 'rgba(230,180,122,0.5)' },
  stepWrap: { padding: spacing.xl, paddingBottom: spacing.xxl },
  stepTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 28, marginBottom: 8,
  },
  stepSubtitle: {
    color: colors.creamDim, fontFamily: fonts.serifItalic,
    fontSize: 15, marginBottom: spacing.lg,
  },
  field: { marginBottom: spacing.lg },
  fieldLabel: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2, marginBottom: spacing.sm,
  },
  input: {
    color: colors.cream, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: colors.backgroundCard, borderRadius: radii.md,
    borderColor: colors.border, borderWidth: 1,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.amberDim,
    backgroundColor: 'transparent',
  },
  chipOn: { backgroundColor: colors.amberFaint, borderColor: colors.amber },
  chipText: { color: colors.creamDim, fontSize: 13 },
  chipTextOn: { color: colors.amber, fontWeight: '600' },

  // begin button (shared)
  beginBtn: {
    alignSelf: 'center',
    borderWidth: 1.5, borderColor: colors.amber, borderRadius: radii.pill,
    paddingHorizontal: 40, paddingVertical: 14,
    shadowColor: colors.amber,
    shadowOpacity: Platform.OS === 'ios' ? 0.35 : 0,
    shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
    marginTop: spacing.lg,
  },
  beginBtnDisabled: { borderColor: colors.border, shadowOpacity: 0 },
  beginText: { color: colors.amber, fontSize: 12, fontWeight: '600', letterSpacing: 2 },
  disclaimer: {
    color: colors.creamFaint, fontSize: 11, fontStyle: 'italic', textAlign: 'center',
    marginTop: spacing.md, maxWidth: 320,
  },
});
