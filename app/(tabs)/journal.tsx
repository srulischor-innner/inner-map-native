// Journal tab — session history. List fetched from /api/sessions; tap opens a
// full-screen modal with the session transcript (lazily loaded from
// /api/sessions/:id). Pull-to-refresh re-fetches the list.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { SessionCard, SessionSummary } from '../../components/journal/SessionCard';
import { SessionDetailModal } from '../../components/journal/SessionDetailModal';

export default function JournalScreen() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api.listSessions();
    setSessions(list as SessionSummary[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Journal</Text>
        <Text style={styles.sub}>A quiet space just for you</Text>
      </View>

      <FlatList
        contentContainerStyle={styles.list}
        data={sessions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <SessionCard session={item} onPress={() => setSelectedId(item.id)} />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.amber} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.emptyText}>
              Your conversations will appear here.
              Each one is a marker on the path — tap any to re-read.
            </Text>
          </View>
        }
      />

      <SessionDetailModal
        visible={!!selectedId}
        sessionId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  title: { color: colors.amber, fontSize: 22, fontWeight: '500', letterSpacing: 0.3 },
  sub: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic', marginTop: 2 },

  list: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  empty: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.creamDim, fontSize: 16, fontWeight: '500', marginBottom: 6 },
  emptyText: {
    color: colors.creamFaint, fontSize: 13, lineHeight: 20, fontStyle: 'italic', textAlign: 'center',
  },
});
