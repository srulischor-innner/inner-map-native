// Relationship intro / commitment route.
//
// Mounts the ConsentDocument for the relationshipId in the URL
// segment. ConsentDocument owns the accept API call — tapping
// "I UNDERSTAND AND ACCEPT" inside it fires
// api.acceptRelationshipIntro(id) and routes back to /relationships,
// where the state machine refreshes into pending-intros (waiting on
// the other partner) or active.
//
// History note: this used to mount RelationshipIntroCarousel in
// mode='commitment' — a 6-slide pager that duplicated the same body
// text the user had already swiped through in informational mode
// before pairing. PR B replaced that with a single scrollable
// consent document. The v1.1.0 TestFlight polish kept the
// commitment surface here as a document and brought the carousel
// back ONLY for informational + review surfaces on the Partner
// tab. See ConsentDocument for the shared body text.

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
        relationshipId={relationshipId}
        showBackButton
        onBack={onBack}
      />
    </SafeAreaView>
  );
}
