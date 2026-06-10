// App-level feature flags.
//
// Each flag gates a feature's ENTRY POINTS only — the feature's screens,
// components, and services stay in the codebase, compiling, untouched.
// Flipping a flag back to true restores the feature with no other changes.

// Partner tab hidden for v1 launch — flip to true to restore. All partner
// code intact: app/(tabs)/relationships.tsx, app/relationships/intro/[id].tsx,
// components/relationships/*, services/partnerSharedSeen.ts, and the
// relationship endpoints in services/api.ts are unreachable but unmodified.
export const PARTNER_ENABLED: boolean = false;
