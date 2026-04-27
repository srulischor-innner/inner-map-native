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
import { GuideSlide } from '../components/guide/GuideSlide';
import { GuideDots } from '../components/guide/GuideDots';
import { WELCOME_SLIDES } from '../utils/guideContent';
import {
  ExperienceLevel, LEVEL_OPTIONS, setExperienceLevel,
} from '../services/experienceLevel';

type Phase = 'welcome' | 'terms' | 'intake' | 'experience' | 'resources' | 'notTherapy';

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
      ) : phase === 'intake' ? (
        <IntakeFlow onDone={() => setPhase('experience')} />
      ) : phase === 'experience' ? (
        <ExperienceLevelStep
          onPick={async (lvl, isHard) => {
            // The 4th option ("I'm in a hard place right now") sets level
            // to 'curious' so the AI uses the most-scaffolded voice, AND
            // routes to the resources screen before the not-therapy moment.
            await setExperienceLevel(isHard ? 'curious' : lvl);
            if (isHard) setPhase('resources');
            else setPhase('notTherapy');
          }}
        />
      ) : phase === 'resources' ? (
        <ResourcesScreen onContinue={() => setPhase('notTherapy')} />
      ) : (
        <NotTherapyScreen onContinue={finishAndEnterApp} />
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// 1. WELCOME SLIDES — same data + visuals as the Guide tab's WELCOME pill,
// pulled from utils/guideContent.ts so the two never drift. The onboarding
// flow adds a "B E G I N" button + disclaimer below the last slide.
// ============================================================================
function WelcomeSlides({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  const atLast = index === WELCOME_SLIDES.length - 1;

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
        renderItem={({ item }) => <GuideSlide data={item} width={width} />}
      />
      <View style={styles.welcomeFoot}>
        <GuideDots
          count={WELCOME_SLIDES.length}
          active={index}
          onTap={(i) => { listRef.current?.scrollToIndex({ index: i, animated: true }); }}
        />
        {atLast ? (
          <>
            <Pressable onPress={onDone} style={[styles.beginBtn, { marginTop: spacing.md }]}>
              <Text style={styles.beginText}>B E G I N</Text>
            </Pressable>
            <Text style={styles.disclaimer}>
              Inner Map is a self-reflection tool, not a substitute for professional
              mental health support.
            </Text>
          </>
        ) : null}
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
// 4. EXPERIENCE LEVEL — single-select question, sits between intake and chat
// ============================================================================
function ExperienceLevelStep({
  onPick,
}: {
  onPick: (lvl: ExperienceLevel, isHard: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ScrollView contentContainerStyle={styles.expStepRoot} showsVerticalScrollIndicator={false}>
      <Text style={styles.expStepTitle}>Where are you in your journey?</Text>
      <Text style={styles.expStepBody}>
        This work meets you where you are. Let us know what feels closest to true
        for you right now — we'll adjust the experience to match. You can change
        this anytime in settings.
      </Text>

      {LEVEL_OPTIONS.map((opt) => {
        const isSelected = selected === opt.level;
        return (
          <Pressable
            key={opt.level}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setSelected(opt.level);
            }}
            style={[styles.expOption, isSelected && styles.expOptionSelected]}
          >
            <Text style={[styles.expOptionTitle, isSelected && styles.expOptionTitleSelected]}>
              {opt.title}
            </Text>
            <Text style={styles.expOptionSubtitle}>{opt.subtitle}</Text>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => {
          if (!selected) return;
          const opt = LEVEL_OPTIONS.find((o) => o.level === selected);
          if (!opt) return;
          const isHard = opt.level === 'hard';
          // The "hard place" option maps to curious AND triggers the resources screen.
          const lvl: ExperienceLevel = isHard ? 'curious' : (opt.level as ExperienceLevel);
          onPick(lvl, isHard);
        }}
        disabled={!selected}
        style={[styles.expContinueBtn, !selected && styles.expContinueBtnDisabled]}
      >
        <Text style={styles.expContinueText}>CONTINUE</Text>
      </Pressable>
    </ScrollView>
  );
}

// ============================================================================
// 5. RESOURCES — shown only when the user picked "I'm in a hard place".
// Real-world support pointers; does NOT block them from using the app.
// ============================================================================
function ResourcesScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.expStepRoot} showsVerticalScrollIndicator={false}>
      <Text style={styles.expStepTitle}>You're not alone</Text>
      <Text style={styles.expStepBody}>
        Inner Map can be a thoughtful companion, but it's not a substitute for a
        real person who knows you. If something is heavy, please also reach out
        to one of these — even briefly:
      </Text>

      <View style={styles.resCard}>
        <Text style={styles.resCardLabel}>IF YOU ARE IN IMMEDIATE CRISIS</Text>
        <Text style={styles.resCardText}>
          988 — Suicide & Crisis Lifeline (call or text, US/Canada).
          Available 24/7. You don't have to be in crisis to call.
        </Text>
        <Text style={styles.resCardText}>
          116 123 — Samaritans (UK & Ireland, free 24/7).
        </Text>
        <Text style={styles.resCardText}>
          For other countries: findahelpline.com lists local options worldwide.
        </Text>
      </View>

      <View style={styles.resCard}>
        <Text style={styles.resCardLabel}>IF YOU CAN GET TO A THERAPIST</Text>
        <Text style={styles.resCardText}>
          A real therapist who knows you over time is the single most useful
          resource for the kind of work this app touches. Inner Map can help
          you go deeper in those sessions — it isn't a replacement.
        </Text>
        <Text style={styles.resCardText}>
          openpathcollective.org and inclusivetherapists.com both list
          sliding-scale therapists if cost is a concern.
        </Text>
      </View>

      <View style={styles.resCard}>
        <Text style={styles.resCardLabel}>RIGHT NOW</Text>
        <Text style={styles.resCardText}>
          One person you trust, even if the relationship is imperfect. A walk
          outside. A few slow breaths. None of that "fixes" anything — but
          they all bring you back to your own body, which is where the work
          actually happens.
        </Text>
      </View>

      <Pressable onPress={onContinue} style={styles.expContinueBtn}>
        <Text style={styles.expContinueText}>I'M READY — ENTER INNER MAP</Text>
      </Pressable>
    </ScrollView>
  );
}

// ============================================================================
// 6. NOT-THERAPY — final moment before entering the app. A single quiet
// screen that names what Inner Map is and is not, in warm prose rather
// than legal disclaimer language. Shown for every experience level so
// the message lands once cleanly instead of being buried in fine print.
// ============================================================================
function NotTherapyScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.notTherapyRoot} showsVerticalScrollIndicator={false}>
      <View style={{ flex: 1 }} />
      <Text style={styles.notTherapyTitle}>One important thing</Text>
      <Text style={styles.notTherapyBody}>
        Inner Map is a companion for your inner journey — not a replacement
        for therapy or professional support. If you're going through
        something difficult, please have a real person in your life who can
        hold it with you. This works best alongside that support, not
        instead of it.
      </Text>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onContinue();
        }}
        style={[styles.beginBtn, { marginTop: spacing.xl, alignSelf: 'center' }]}
        accessibilityLabel="I understand"
      >
        <Text style={styles.beginText}>I  UNDERSTAND</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
    </ScrollView>
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

  // Experience-level step + resources screen — shared style block since
  // they have the same vertical rhythm and option-card visual language.
  expStepRoot: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 600, alignSelf: 'center', width: '100%',
  },
  expStepTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 28, letterSpacing: 0.3, marginBottom: spacing.md,
  },
  expStepBody: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 23, marginBottom: spacing.lg,
  },
  expOption: {
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  expOptionSelected: {
    borderColor: colors.amber,
    backgroundColor: 'rgba(230,180,122,0.08)',
  },
  expOptionTitle: {
    color: colors.cream, fontFamily: fonts.sansBold,
    fontSize: 15, marginBottom: 4,
  },
  expOptionTitleSelected: { color: colors.amber },
  expOptionSubtitle: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 13, lineHeight: 19,
  },
  expContinueBtn: {
    alignSelf: 'center',
    paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5, borderColor: colors.amber,
    marginTop: spacing.lg,
    shadowColor: colors.amber, shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
  },
  expContinueBtnDisabled: { borderColor: colors.border, shadowOpacity: 0 },
  expContinueText: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 12, letterSpacing: 2,
  },
  resCard: {
    backgroundColor: colors.backgroundCard,
    borderLeftColor: colors.amber, borderLeftWidth: 2,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  resCardLabel: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2, marginBottom: spacing.sm,
  },
  resCardText: {
    color: colors.cream, fontFamily: fonts.sans,
    fontSize: 14, lineHeight: 22, marginBottom: 8,
  },

  // Not-therapy moment — vertically centered, generous breathing room,
  // single warm paragraph. Uses the shared beginBtn for the CTA so the
  // button language matches the rest of the onboarding flow.
  notTherapyRoot: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  notTherapyTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  notTherapyBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});
