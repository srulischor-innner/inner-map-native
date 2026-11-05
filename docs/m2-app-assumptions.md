# M2: the app's side of the server contract

Updated 2026-11-05 on branch `claude/app-next-m2-0823af`.

The server's API doc now exists: `docs/m2-api.md` on branch `claude/m2-chat-stack-b14563` of the server repo, commit `a87d084`. The app follows it, except where the founder's Nov 5 rulings say otherwise. That doc was written against this branch's first commit (`9385557`), before the rulings, so on four points it describes the earlier design. Those points are under "Where the app follows the rulings, not the server doc".

The app's M2 code lives in two places:

- `services/m2.ts` holds the pure shapes, parsers and rules.
- `services/m2Store.ts` holds the live flag, the starter count, and accept and decline.

The founder's sources:

- `first-session (1).md`: the welcome on line 33, and the first-session rules.
- `mapping-m2 (2).md`: the `[CARD:…]` marker, the idle pass, and the payloads.
- `package-test-prompts/other-surfaces-audit.md`: the two invented-memory lines.

## The rule everything rests on

**Off is today.** If the flag isn't read, isn't there, or isn't exactly `"m2"`, the app makes no M2 request and shows nothing new, and every screen shows today's copy. `scripts/smoke-m2-app.mjs` checks three things:

- every M2 path checks the flag first;
- the legacy Guide deck is the same array as before;
- the legacy YOU folder text rebuilds the old string exactly.

## What the app uses from m2-api.md

| Contract | What the app does |
|---|---|
| **Flag.** `GET /api/first-session-status` carries `promptStack: "m2"` and `chatStack: "m2"` for a flagged account. | Read once at chat boot, only on a successful response; either name counts. Published to `m2Store` for the Guide and map folders. `m2Welcome` is ignored (see below). |
| **Cards are inbox rows** of kind `m2_card`, one per session, `items[]`. | Messages renders each row through the shared card (`components/m2/M2Cards.tsx`). |
| **Kinds**: part, detail, voice, middle_ground, second_wound, belief. | All read. `middle` is also read: it's the `[CARD:…]` marker's spelling of `middle_ground`. |
| **`status: "expired"`.** | Treated as resolved: off the chat screen, left out of Messages. |
| **Accept / decline**: `POST /api/messages/:id/act` and `/decline` with `itemIndices`. | Used from both surfaces through `m2Store`, so a tap anywhere updates the starter count. |
| **`act` response**: `mapEntryCount`, and `starterMapComplete: true` when a tap honoured a held marker. | The count updates the starter-map gate. `starterMapComplete` clears the "Building your starter map" banner and puts the button on the newest reply, unless a reply already has it. |
| **`GET /api/m2/pending?sessionId=`** returns `{ cards, passRunning, mapEntryCount, starterPending }`; it's a 404 off M2. | This is the chat screen's own read. The app reads it at M2 boot, on focus, and after each reply. It keeps reading every 3 s while `passRunning` is true, or for up to 10 s after `passScheduled` if the pass hasn't started, and stops at 45 s. A new turn or End Session cancels it. Cards are re-checked with the same rules as the inbox list. |
| **Done frame `m2` block**: `{ stack, passScheduled, mapEntryCount, firstSession, starterPending }`. | Read by the stream as `onM2Done`. It sets the count and starts the read above. It never fires off M2, because the server sends no block. |
| **Seen**: `POST /api/m2/cards/:id/seen` with `{ itemIndices }`; `/read` stamps a whole card. | Called once per item the first time a card shows on the chat screen. Messages still calls `/read` on open, as it always has. |
| **Which cards go on the chat screen**: this session, `confirmedInChat === true`, pending. | The app also accepts `source: "chat"`, for cards made from `[CARD:…]`. |
| **Gather-noticed** returns `{ needed: false, stack: "m2" }`. | No change: `needed: false` already means "end now". |
| **No `savedBeliefs`; CHAT_META never reaches the app.** | Nothing to do. On M2 the part badge and the confidence ring stay dark. |
| **`chatMode` is ignored** for prompt choice. | Still sent, defaulting to `explore` because M2 has no mode control, so the session row records it. |

## Where the app follows the rulings, not the server doc

Each of these is a place where the server doc contradicts a founder file or ruling.

1. **The welcome.**
   - Server doc lines 20 and 24 send `m2Welcome` and describe it as "first-session.md's proposed welcome … 536 characters, the same string as the app's `M2_WELCOME`". That is the superseded text.
   - The ruling uses `first-session (1).md` line 33, which is 550 characters and different words.
   - The app keeps its own constant, updated to line 33, and ignores `m2Welcome`.
   - The server's prompt copy `prompts/m2/first-session.md` is also the old file. The founder's line 17, the close, changed too.
2. **Where chat cards come from.**
   - Server doc lines 122–123 say a chat card comes from `SAVE_BELIEF` (beliefs only) and from the pass after each reply.
   - The ruling and `mapping-m2 (2).md` lines 14–16 say the reply's `[CARD:{"kind","part","label","fields","said"}]`, which the server turns into a card immediately: one card per agreed item, fields bundled.
   - The app reads such an item as `{ kind, source: "chat", payload: { part, label, fields: {…} }, said, status }`. It shows the label as the headline and each field under it.
3. **When the pass runs.**
   - Server doc line 191 and table row (a) at line 258 say after each reply, plus once at idle.
   - The ruling and `mapping-m2 (2).md` line 20 say once, at idle, for Messages.
   - The app works either way. It reads `passRunning` and `passScheduled` and stops when the server says nothing is coming.
4. **What an edit sends.**
   - Server doc line 125 says `edits[i]` is a string.
   - A `[CARD:…]` card bundles several fields, so one string can't say which to change.
   - The app sends a string for a pass proposal, as today. For a chat card it sends only what changed, as an object: `{ "label": "…" }` and/or `{ "fields": { "<key>": "…" } }`.
   - An emptied field isn't an edit, because that's what "Doesn't fit" is for.
   - The server needs to accept the object for chat cards.
5. **What the starter count counts.**
   - Server doc line 220 counts filled map fields, "the way A6 does". That was this doc's earlier A6.
   - The ruling says "the server counts tapped cards for the starter-map button."
   - The app counts nothing itself now. It reads the server's number under `starterMapCount`, `tappedCardCount` or `mapEntryCount`, from the `act` response, `/api/m2/pending` and the done frame.
   - No number means "the server said nothing", not zero. Then the marker alone decides, because the server only releases it at two.

## Still assumed (not in either document)

- **First-session status.** The app also reads a starter count here, under the same three names, if the server ever adds one. Today it gets the count at boot from `/api/m2/pending`.
- **Partial versus confirmed after a tap** (switch plan, question 10). The app shows both the same way.

## The invented-memory copy (ruling 2026-11-05)

Both lines are app copy, behind the flag. Off M2 both are the old strings, rebuilt byte for byte.

- **The Guide's "learns who you are"** (`utils/guideContent.ts`; was line 130). On M2 it reads "Over time, Inner Map keeps your map, key moments and some of what you've said, so you don't have to start over each time." The audit gave no replacement, so these words are the app's own, written to Draft 3.5 line 99, and they need the founder's look. They don't say "no transcript", because the app does save conversations to history.
  - The Guide and onboarding read the deck through `welcomeSlidesFor(m2)`, which differs from the old deck by that one paragraph.
  - A first-run onboarding never sees it: the flag comes from the chat's boot, which comes later.
- **The YOU folder's biography** (`components/map/PartFolderModal.tsx`; was line 107). On M2 its first paragraph is the audit's suggested fix. The two paragraphs after it are framework-word findings the ruling didn't cover, and they're unchanged.

Not changed, per the ruling: the rest of the Guide; and the Self voice, the map voices and the Guide's Self description, which are exempt from the "I'm here / with you" rule. Server copy goes to the m2-chat-stack session.
