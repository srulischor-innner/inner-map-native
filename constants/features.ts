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

// Chat read-aloud (AI-message text-to-speech) hidden for v1 launch — flip
// to true to restore. The session audio toggle (<AudioToggle> in the main
// chat AND partner-chat headers) is the ONLY entry point; with it hidden,
// `audioEnabled` stays false forever, so the streaming-TTS chain
// (utils/ttsStream) never starts. The /api/speak server endpoint and all
// of utils/ttsStream stay in the codebase, compiling, untouched.
//
// WHY OFF FOR v1: read-aloud playback parks the device audio session in
// playback mode (allowsRecording:false); the handoff back to recording was
// racy and caused intermittent silent voice-note capture ("every other
// message"). Collapsing the audio surface to ONE playback system (Map
// Voice / ElevenLabs, separate tab) + recording removes that contention.
// Map Voice is a separate system and is unaffected by this flag.
//
// BEFORE RE-ENABLING (post-launch), the audio-session handoff needs a
// proper fix, not just the current best-effort safety net
// (ttsStream.resetAudioSessionForRecording on playback end +
// ChatInput's awaited ensureRecordingMode before capture): add a
// SETTLE/VERIFY step that confirms the mic route is actually capturing
// (e.g. check input levels / re-arm if the first frames are silent) after
// the playback→record category switch, since the switch resolving does not
// guarantee the route flipped on every OEM device. Also note: the
// pre-existing "last line not read aloud" bug is moot while this is off;
// re-test it when read-aloud returns.
export const CHAT_READ_ALOUD_ENABLED: boolean = false;

// Push notifications hidden for v1 launch — flip to true to restore. The
// ONLY entry point is the boot-time registerForPushNotifications() call in
// app/_layout.tsx; with it gated off, the app never requests OS notification
// permission and never POSTs a push token at boot. All push infrastructure
// stays in the codebase, compiling, untouched: services/push.ts, the
// /api/push-token server endpoint, and the push_tokens table.
//
// WHY OFF FOR v1: nothing actually sends a notification yet (no
// scheduleNotificationAsync client-side, no server send path), so registering
// at boot only produced an OS permission prompt for a feature that delivers
// nothing. When notifications ship, re-enable here AND move the permission
// request to a contextual opt-in (the moment the user turns on reminders),
// not cold boot.
export const NOTIFICATIONS_ENABLED: boolean = false;

// Conversation continuation — reopen ANY past session (incl. old, ended,
// summarized ones) and keep talking in it, instead of starting fresh.
// Off by default for staged rollout; flip to true to expose the
// "Continue this conversation" entry point on the shared
// SessionDetailModal. ALL resume plumbing stays compiled regardless of
// the flag — utils/pendingSessionResume, the chat-tab hydrate-on-resume,
// the mode-lock, and the server-side updatedAt ordering + re-summary
// idempotency. Only the entry-point button is gated.
export const SESSION_RESUME_ENABLED: boolean = false;
