// Full-screen modal showing a single session's transcript. Opened by tapping a
// SessionCard on the Journal tab. Fetches /api/sessions/:id lazily so we don't
// hold every message in memory for the whole list.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { stripMarkers } from '../../utils/markers';

type Props = {
  visible: boolean;
  sessionId: string | null;
  onClose: () => void;
};

export function SessionDetailModal({ visible, sessionId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<any | null>(null);

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

  const messages: any[] = session?.messages || [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityLabel="Close session" hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.creamDim} />
          </Pressable>
          <Text style={styles.headerTitle}>Session</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.amber} />
          </View>
        ) : !session ? (
          <View style={styles.center}>
            <Text style={styles.empty}>Couldn’t load this session.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.meta}>
              <Text style={styles.metaLine}>{session.date}{session.time ? ' · ' + session.time : ''}</Text>
              {session.title ? <Text style={styles.title}>{session.title}</Text> : null}
              {session.summary ? (
                <View style={styles.summary}>
                  <Text style={styles.summaryLabel}>REFLECTION</Text>
                  <Text style={styles.summaryText}>{session.summary}</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.sectionTitle}>TRANSCRIPT</Text>
            {messages.map((m, i) => {
              const text = stripMarkers(m.content || '');
              if (!text) return null;
              const isUser = m.role === 'user';
              return (
                <View
                  key={i}
                  style={[styles.msg, isUser ? styles.msgUser : styles.msgAI]}
                >
                  <Text style={[styles.role, isUser ? { color: colors.cream } : { color: colors.amber }]}>
                    {isUser ? 'You' : 'Inner Map'}
                  </Text>
                  <Text style={styles.msgText}>{text}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerTitle: { color: colors.amber, fontSize: 16, fontWeight: '500', letterSpacing: 0.3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.creamFaint, fontStyle: 'italic' },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },

  meta: { marginBottom: spacing.lg },
  metaLine: { color: colors.creamFaint, fontSize: 12, letterSpacing: 0.3 },
  title: { color: colors.cream, fontSize: 20, fontWeight: '500', marginTop: 4 },
  summary: {
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.backgroundCard,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderAmber,
    borderRadius: radii.sm,
  },
  summaryLabel: { color: colors.amber, fontSize: 10, letterSpacing: 1.4, marginBottom: 4 },
  summaryText: { color: colors.cream, fontSize: 14, lineHeight: 22 },

  sectionTitle: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: spacing.sm,
  },
  msg: {
    padding: spacing.sm,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  msgAI: { backgroundColor: 'rgba(255,255,255,0.04)', borderLeftWidth: 2, borderLeftColor: colors.borderAmber },
  msgUser: { backgroundColor: 'rgba(230,180,122,0.1)', borderColor: colors.borderAmber, borderWidth: 0.5 },
  role: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 4 },
  msgText: { color: colors.cream, fontSize: 14, lineHeight: 21 },
});
