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
