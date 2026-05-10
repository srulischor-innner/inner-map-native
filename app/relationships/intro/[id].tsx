// Relationship intro carousel — Phase 5 (commitment route).
//
// Thin wrapper around RelationshipIntroCarousel. The same six-slide
// component is used in two places:
//
//   - app/(tabs)/relationships.tsx  (mode='informational', first-time
//     tab visit, no API call)
//   - this screen                    (mode='commitment', after pairing,
//     hits api.acceptRelationshipIntro)
//
// On accept the screen pops back to /relationships, where the tab's
// state machine re-fetches and either shows the still-pending state
// (if the partner hasn't read theirs yet) or transitions to active.

import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors } from '../../../constants/theme';
import { RelationshipIntroCarousel } from '../../../components/relationships/RelationshipIntroCarousel';
import { api } from '../../../services/api';

export default function RelationshipIntroScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationshipId = String(id || '').trim();
  const router = useRouter();

  const [accepting, setAccepting] = useState(false);

  const onAccept = useCallback(async () => {
    if (!relationshipId || accepting) return;
    setAccepting(true);
    const result = await api.acceptRelationshipIntro(relationshipId);
    setAccepting(false);
    if ('error' in result) {
      Alert.alert(
        'Could not save your acceptance',
        result.message || 'Please try again in a moment.',
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/relationships');
  }, [relationshipId, accepting, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <RelationshipIntroCarousel
        mode="commitment"
        onComplete={onAccept}
        accepting={accepting}
        showBackButton
        onBack={() => router.back()}
      />
    </SafeAreaView>
  );
}
