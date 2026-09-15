// THE WAYS OFF THE MEMBERSHIP DOOR THAT ARE NOT "PAY".
//
// THIS IS DATA, ON PURPOSE. The previous design's crisis link was one JSX line
// that could be deleted with the whole suite green, pinned only by a
// 200-character distance regex — the exact idiom that design condemned two
// sections earlier. scripts/smoke-membership-door.mjs IMPORTS this file and RUNS
// it: exactly one crisis exit, exactly one export/deletion exit, every href a
// route that exists on disk, and neither of them a TAB route (a tab needs the
// tab layout mounted; these have to render on their own). Delete an entry and
// the smoke goes red on an executed value, not on a string search.
//
// app/paywall.tsx maps over this list in the region between the restore control
// and the legal links — outside the price/member/unavailable branches and
// outside every `status` test — so a store that will not configure, an offering
// that is empty, a purchase the store refused and a restore that found nothing
// all leave these exactly where they are. The smoke slices that region, with
// length CONTROLs on the slice, and asserts the map is in it.
//
// WHAT EACH ONE REACHES WITH NO NETWORK, NO STORE AND NO SERVER:
//   crisis → app/support-resources.tsx → components/safety/SupportResourcesScreen,
//     whose three targets are compiled-in literals (988, 116 123,
//     findahelpline.com) opened through Linking. It makes no API call of any
//     kind. ?from=door changes only what the back control is CALLED: a person
//     who tapped this on a paywall must not hear "Back to settings" read out on
//     a screen they have never been near.
//   data → app/privacy.tsx, a ROOT route (there is no app/(tabs)/privacy.tsx) so
//     it renders with the tabs unmounted. Screen order is a founder ruling: the
//     crisis card FIRST, then the plain-language summary, then Export My Data
//     and Delete My Account. Nothing on that chain reads an entitlement, and
//     GET /api/account/export (server.js:22772) and DELETE /api/account (23028)
//     carry requireUserId and nothing else.
export type DoorExitKind = 'crisis' | 'data';

export type DoorExit = {
  id: string;
  kind: DoorExitKind;
  label: string;
  href: string;
};

export const DOOR_EXITS: readonly DoorExit[] = [
  {
    id: 'crisis',
    kind: 'crisis',
    label: 'If you need support right now',
    href: '/support-resources?from=door',
  },
  {
    id: 'data',
    kind: 'data',
    label: 'Your data — export or delete',
    href: '/privacy',
  },
];
