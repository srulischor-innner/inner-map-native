// Relationship Map sub-view.
//
// Top: the two-triangle visual (RelationshipMapVisual). Bottom:
// per-partner content cards listing wound / fixer / skeptic /
// self-like text — empty rows render as "not yet identified" so
// the user can see at a glance which parts the AI has confirmed
// for each partner.
//
// Data fetched from GET /api/relationships/:id/map. Refreshes on
// pull-to-refresh (manual) and on every mount. The shared-wound
// state surfaces in the visual (both wounds glow amber + connector
// line) and as a band of copy at the bottom when active.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import {
  RelationshipMapVisual,
  PartnerParts,
} from './RelationshipMapVisual';

type MapData = {
  relationshipId: string;
  mySide: 'inviter' | 'invitee';
  partnerName: string | null;
  me: PartnerParts;
  partner: PartnerParts;
  sharedWound: { active: boolean; content: string | null };
};

const NODE_LABELS = {
  wound: 'Wound',
  fixer: 'Fixer',
  skeptic: 'Skeptic',
  selfLike: 'Self-Like',
} as const;

// Reusable mini-version for embedding inside other views (Shared
// feed pins a compact variant at the top so the visual landscape
// is visible from there too).
export function RelationshipMapPinned({
  relationshipId, partnerName,
}: { relationshipId: string; partnerName: string | null }) {
  const [data, setData] = useState<MapData | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await api.getRelationshipMap(relationshipId);
      if (!cancelled && next) setData(next);
    })();
    return () => { cancelled = true; };
  }, [relationshipId]);
  if (!data) {
    // Hold a fixed-height placeholder so the pinned slot doesn't
    // collapse + cause the feed below to jump on first paint.
    return <View style={styles.pinnedPlaceholder} />;
  }
  return (
    <View style={styles.pinnedWrap}>
      <RelationshipMapVisual
        myParts={data.me}
        partnerParts={data.partner}
        myLabel="You"
        partnerLabel={partnerName || data.partnerName || 'Partner'}
        sharedWoundActive={data.sharedWound.active}
        variant="compact"
      />
      {data.sharedWound.active ? (
        <Text style={styles.pinnedSharedHint}>
          {/* Single-line companion to the connector arc on the canvas. */}
          shared wound {data.sharedWound.content ? `— "${data.sharedWound.content.slice(0, 80)}"` : ''}
        </Text>
      ) : null}
    </View>
  );
}

// Full-tab Map sub-view.
export function RelationshipMap({
  relationshipId, partnerName,
}: { relationshipId: string; partnerName: string | null }) {
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const next = await api.getRelationshipMap(relationshipId);
    if (next) setData(next);
    setRefreshing(false);
    setLoading(false);
  }, [relationshipId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn't load the map. Pull to refresh.</Text>
      </View>
    );
  }

  const myDisplay      = 'You';
  const partnerDisplay = partnerName || data.partnerName || 'Partner';
  // Labels rendered ABOVE each triangle. "Your map" on the left is
  // generic-by-design — Inner Map doesn't carry a first-name surface
  // client-side (user IDs are anonymous), so substituting a name
  // there would require a server round-trip we don't need. The right
  // label is the partner's display name when present; otherwise a
  // generic "Partner's map" fallback. Both labels stay visible
  // whenever the view is open — they are not dismissible.
  const myMapLabel      = 'Your map';
  const partnerMapLabel = partnerName
    ? `${partnerName}'s map`
    : (data.partnerName ? `${data.partnerName}'s map` : "Partner's map");

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.amber} />}
      showsVerticalScrollIndicator={false}
    >
      {/* One-line framing hint at the very top — explains what the user
          is looking at without taking real estate. Persistent (not
          dismissible) so the meaning of the two triangles is always
          available on every open. */}
      <Text style={styles.viewHint}>
        This view shows both maps so you can see how your dynamics interact.
      </Text>

      {/* Labels above each triangle. Mirrors the canvas's horizontal
          layout (two triangles side-by-side with a small gutter), so
          each label sits visually over its own triangle. */}
      <View style={styles.aboveLabelRow}>
        <Text style={styles.aboveLabel} numberOfLines={1}>{myMapLabel}</Text>
        <Text style={styles.aboveLabel} numberOfLines={1}>{partnerMapLabel}</Text>
      </View>

      {/* Two-triangle visual. hideLabels=true because labels live
          above (see aboveLabelRow) — the under-triangle labels would
          be redundant in this layout. */}
      <View style={styles.visualWrap}>
        <RelationshipMapVisual
          myParts={data.me}
          partnerParts={data.partner}
          myLabel={myDisplay}
          partnerLabel={partnerDisplay}
          sharedWoundActive={data.sharedWound.active}
          variant="full"
          hideLabels
        />
      </View>

      {/* Shared-wound band — only renders when active. */}
      {data.sharedWound.active ? (
        <View style={styles.sharedBand}>
          <View style={styles.sharedBandHeader}>
            <Ionicons name="link" size={14} color={colors.amber} style={{ marginRight: 6 }} />
            <Text style={styles.sharedBandTitle}>Shared wound</Text>
          </View>
          <Text style={styles.sharedBandBody}>
            {data.sharedWound.content
              ? `"${data.sharedWound.content}"`
              : "You both share the same wound underneath."}
          </Text>
        </View>
      ) : null}

      {/* Per-partner content panels — same node-row in both, side by
          side on a wide screen, stacked on narrow. */}
      <View style={styles.partnersRow}>
        <PartnerPanel
          title={myDisplay}
          parts={data.me}
          isMe
        />
        <PartnerPanel
          title={partnerDisplay}
          parts={data.partner}
        />
      </View>
    </ScrollView>
  );
}

function PartnerPanel({
  title, parts, isMe,
}: {
  title: string;
  parts: PartnerParts;
  isMe?: boolean;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {(['wound', 'fixer', 'skeptic', 'selfLike'] as const).map((cat) => {
        const node = parts[cat];
        return (
          <NodeRow
            key={cat}
            label={NODE_LABELS[cat]}
            text={node.text}
            confirmed={node.confirmed}
          />
        );
      })}
    </View>
  );
}

function NodeRow({
  label, text, confirmed,
}: {
  label: string;
  text: string | null;
  confirmed: boolean;
}) {
  return (
    <View style={styles.nodeRow}>
      <View style={styles.nodeLabelRow}>
        <Text style={styles.nodeLabel}>{label.toUpperCase()}</Text>
        {text ? (
          <Text style={[styles.nodeStatus, confirmed && styles.nodeStatusConfirmed]}>
            {confirmed ? 'confirmed' : 'partial'}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.nodeText, !text && styles.nodeTextEmpty]}>
        {text ? text : 'not yet identified'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.creamDim, fontFamily: fonts.serifItalic, fontSize: 14 },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // One-line framing copy at the top of the view. Italic + dim so it
  // reads as ambient guidance, not a heading. Persistent — appears
  // every time the user opens the Map sub-view.
  viewHint: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  // Row of labels above the triangles. Mirrors the canvas's two-
  // triangle horizontal layout so each label sits over its own
  // triangle. Stays visible on every open of the Map sub-view —
  // these are not a dismissible one-time hint.
  aboveLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.lg,
    marginBottom: 6,
  },
  aboveLabel: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    textAlign: 'center',
    flex: 1,
  },

  visualWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },

  // Pinned variant for the Shared feed top — fixed-height placeholder
  // before data + gentle wrap once it arrives.
  pinnedPlaceholder: { height: 174 },
  pinnedWrap: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(230,180,122,0.1)',
    marginBottom: spacing.md,
  },
  pinnedSharedHint: {
    color: colors.amber,
    fontFamily: fonts.serifItalic,
    fontSize: 11,
    letterSpacing: 0.3,
    marginTop: 6,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
  },

  // Shared-wound band (full sub-view).
  sharedBand: {
    backgroundColor: 'rgba(230,180,122,0.08)',
    borderColor: 'rgba(230,180,122,0.3)',
    borderWidth: 0.5,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sharedBandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sharedBandTitle: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  sharedBandBody: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 21,
  },

  partnersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  panel: {
    flex: 1,
    minWidth: 240,
    backgroundColor: 'rgba(28,25,21,0.5)',
    borderColor: 'rgba(230,180,122,0.18)',
    borderWidth: 0.5,
    borderRadius: 14,
    padding: spacing.lg,
  },
  panelTitle: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  nodeRow: { marginBottom: spacing.md },
  nodeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  nodeLabel: {
    color: colors.creamDim,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  nodeStatus: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 10,
  },
  nodeStatusConfirmed: { color: colors.amber },
  nodeText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
  nodeTextEmpty: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
  },
});
