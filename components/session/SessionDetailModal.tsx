// Full-screen session transcript modal. Shared between the hamburger menu's
// Recent Sessions list and the Journey tab's Your Path timeline.
//
// - Dark background + amber date/title header + close X top right.
// - Messages rendered with the exact same MessageBubble used in the Chat tab
//   so user turns align right, AI turns align left, and CHAT_META markers on
//   assistant turns surface as PartBadge pills.
// - Lazily fetches /api/sessions/:id so we never hold every transcript in
//   memory.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { MessageBubble, ChatMsg } from '../MessageBubble';

type Props = {
  visible: boolean;
  sessionId: string | null;
  onClose: () => void;
};

export function SessionDetailModal({ visible, sessionId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<any | null>(null);
  // Safe-area inset for the header so the X + title clear the iPhone
  // notch/Dynamic Island on every device. We keep edges=[] on the
  // SafeAreaView so the content area doesn't double-pad.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    if (!visible || !sessionId) { setSession(null); return; }
    setLoading(true);
    (async () => {
      const s = await api.getSession(sessionId);
      if (!cancelled) { setSession(s); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [visible, sessionId]);

  // Convert raw transcript → ChatMsg[] once per session so parsing runs once.
  const messages: ChatMsg[] = useMemo(() => {
    const raw: any[] = session?.messages || [];
    return raw
      .map((m, i): ChatMsg | null => {
        const content = stripMarkers(m.content || '');
        if (!content) return null;
        let detectedPart: string | null = null;
        let partLabel: string | null = null;
        if (m.role === 'assistant') {
          const meta = parseChatMeta(m.content || '');
          if (meta?.detectedPart && meta.detectedPart !== 'unknown') {
            detectedPart = meta.detectedPart;
            partLabel = meta.partLabel ?? null;
          }
        }
        return {
          id: m.id || String(i),
          role: m.role === 'user' ? 'user' : 'assistant',
          text: content,
          detectedPart,
          partLabel,
        };
      })
      .filter(Boolean) as ChatMsg[];
  }, [session]);

  const header = formatHeader(session);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <View style={[styles.topBar, { paddingTop: insets.top + 16 }]}>
          <View style={{ flex: 1 }}>
            {header.date ? <Text style={styles.date}>{header.date}</Text> : null}
            {header.title ? <Text style={styles.title} numberOfLines={2}>{header.title}</Text> : null}
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={10}
            accessibilityLabel="Close session"
          >
            <Ionicons name="close" size={26} color={colors.creamDim} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.amber} />
          </View>
        ) : !session ? (
          <View style={styles.center}>
            <Text style={styles.empty}>Couldn’t load this session.</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.empty}>This session has no messages.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {(() => {
              // session.summary is either legacy prose (string) or a JSON
              // blob persisted by /api/session-summary with shape:
              //   { exploredText, mapShowingText, somethingToTryText, kind: "structured-v1" }
              // Render the structured form as three labeled sections; fall
              // back to the prose form for older sessions.
              const raw = session.summary;
              if (!raw) return null;
              let structured: any = null;
              if (typeof raw === 'string' && raw.trim().startsWith('{')) {
                try { structured = JSON.parse(raw); } catch {}
              }
              if (structured && structured.kind === 'structured-v1') {
                return (
                  <View style={styles.summary}>
                    {structured.exploredText ? (
                      <>
                        <Text style={styles.summaryLabel}>WHAT WE EXPLORED</Text>
                        <Text style={styles.summaryText}>{structured.exploredText}</Text>
                      </>
                    ) : null}
                    {structured.mapShowingText ? (
                      <>
                        <Text style={[styles.summaryLabel, { marginTop: 14 }]}>WHAT THE MAP IS SHOWING</Text>
                        <Text style={styles.summaryText}>{structured.mapShowingText}</Text>
                      </>
                    ) : null}
                    {structured.somethingToTryText ? (
                      <>
                        <Text style={[styles.summaryLabel, { marginTop: 14 }]}>SOMETHING TO TRY</Text>
                        <Text style={styles.summaryText}>{structured.somethingToTryText}</Text>
                      </>
                    ) : null}
                  </View>
                );
              }
              return (
                <View style={styles.summary}>
                  <Text style={styles.summaryLabel}>REFLECTION</Text>
                  <Text style={styles.summaryText}>{String(raw)}</Text>
                </View>
              );
            })()}
            {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ---- helpers ----
function formatHeader(session: any | null): { date: string; title: string } {
  if (!session) return { date: '', title: '' };
  const d = formatDate(session.date) + (session.time ? ' · ' + session.time : '');
  const title = session.title?.trim?.() || session.preview?.trim?.() || '';
  return { date: d, title };
}
function formatDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${months[mi]} ${parseInt(d, 10)}, ${y}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // paddingTop applied inline so the bar clears the iPhone notch on
    // every device. Bottom keeps a normal spacing.sm gap to the body.
    paddingBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  date: { color: colors.amber, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  title: { color: colors.cream, fontSize: 17, fontWeight: '500', marginTop: 2 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.creamFaint, fontStyle: 'italic' },

  body: { padding: spacing.md, paddingBottom: spacing.xxl },

  summary: {
    marginBottom: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.backgroundCard,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderAmber,
    borderRadius: radii.sm,
  },
  summaryLabel: { color: colors.amber, fontSize: 10, letterSpacing: 1.4, marginBottom: 4 },
  summaryText: { color: colors.cream, fontSize: 14, lineHeight: 22 },
});
