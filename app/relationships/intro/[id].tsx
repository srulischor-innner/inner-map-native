// Relationship intro / commitment route.
//
// Mounts the ConsentDocument in commitment mode for the relationshipId
// in the URL segment. ConsentDocument owns the accept API call —
// tapping "I UNDERSTAND AND ACCEPT" inside it fires
// api.acceptRelationshipIntro(id) and routes back to /relationships,
// where the state machine refreshes into pending-intros (waiting on
// the other partner) or active.
//
// PR B history: this used to mount RelationshipIntroCarousel in
// mode='commitment' — a 6-slide pager that duplicated the same body
// text the user had already swiped through in informational mode
// before pairing. The duplication was removed in PR B; the
// commitment screen is now a single scrollable consent document.
// See ConsentDocument for the shared body text.

import React, { useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors } from '../../../constants/theme';
import { ConsentDocument } from '../../../components/relationships/ConsentDocument';

export default function RelationshipIntroScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationshipId = String(id || '').trim();
  const router = useRouter();

  const onBack = useCallback(() => router.back(), [router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ConsentDocument
        mode="commitment"
        relationshipId={relationshipId}
        showBackButton
        onBack={onBack}
      />
    </SafeAreaView>
  );
}
