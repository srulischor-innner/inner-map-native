# M2: the app's side of the server contract

Updated 2026-11-05 on branch `claude/app-next-m2-0823af`. The server contract is `docs/m2-api.md` on branch `claude/m2-chat-stack-b14563` of the server repo, at commit `5a2657e` (its rewrite for the founder's Nov 5 rulings). The app follows it. Where code relies on something that doc doesn't say, the gap is listed at the end.

The app's M2 code is in three places:

- `services/m2.ts` holds the pure shapes, parsers and rules.
- `services/m2Store.ts` holds the live flag, the starter count, and accept and decline.
- `components/m2/M2Cards.tsx` is the one card both surfaces render.

The founder's sources match the server's copies byte for byte, checked on 2026-11-05:

| Founder's file | Server copy |
|---|---|
| `first-session (1).md` | `prompts/m2/first-session.md` |
| `mapping-m2 (2).md` | `prompts/m2/mapping-m2.md`. The founder has since sent `(3)`, which adds the per-part field list (line 16) and the PART_NAMED line (line 12). The server's copy is still `(2)` as of `b1ce6d1`. |
| `draft3 (11).md` | `prompts/m2/draft3.5.md` |

## The rule everything rests on

**Off is today.** If the flag isn't read, isn't there, or isn't exactly `"m2"`, the app makes no M2 request and shows nothing new, and every screen shows today's copy. `scripts/smoke-m2-app.mjs` checks:

- every M2 path checks the flag first;
- the legacy Guide deck is the same array as before;
- the legacy YOU folder text and the legacy summary fallback are the old strings exactly.

## What the app does with each part of the contract

| m2-api.md | The app |
|---|---|
| **Flag.** `/api/first-session-status` carries `promptStack: "m2"` and `chatStack: "m2"`. | Read once at chat boot, only on a successful response. Published to `m2Store` for the Guide, the map folders and the summary screen. |
| **`m2Welcome`** is the 550-character welcome from first-session (1).md. | Not shown. `M2_WELCOME` in `app/(tabs)/index.tsx` is the same 550 characters. It stays a compile-time constant because the opener has to be a constant, so a fetched opener would break that rule. The smoke compares the constant to the founder's file. |
| **Cards are made on the yes** from `[CARD:…]`, and the done frame's `m2.cardsAdded` names them. | No polling. `onM2Done` cancels the fallback read queued at the end of the reply, sets the count, and reads `GET /api/m2/pending` once if `cardsAdded` is non-empty. The fallback read only runs when a done frame carries no `m2` block. |
| **`GET /api/m2/pending?sessionId=`** | Read at M2 boot (that's how a relaunch gets its count), on focus, and after a reply that made a card. An answer for a session that has since ended is dropped. |
| **Chat card payload** `{ part, label?, fields, field, value, enrich }`, where `value` is the card's name. | The headline is `label`, else `value`, else the first field. Each field is shown under it in plain words. When the name is just the first field, it isn't shown twice. |
| **`belief`** `{ belief, value }`; **`middle_ground`** `{ label, note }`. | Both are read. Belief shows as one value. Middle ground shows its label, with the note underneath. `middle` (the marker's spelling) is read too. |
| **Which items go on the chat screen:** this session, `confirmedInChat`, pending. | The same. `source: "chat"` is also accepted. |
| **`status: "expired"`** | Treated as resolved: off the chat screen, left out of Messages. |
| **Accept / decline**: `/act` and `/decline` with `itemIndices`. | Both surfaces go through `m2Store`, so a tap anywhere updates the count. |
| **Object edit** `{ "<field>": "<new value>" }` | Sent for a chat card, carrying only the fields that changed. A pass proposal or a belief still sends a text edit. |
| **Text edit on a several-field card renames it.** | Not offered. Renaming is PART_NAMED's direct write (`mapping-m2 (3).md` line 12), not a card edit. |
| **`mapEntryCount` = tapped cards**, on the done frame, `act`, `/api/m2/pending` and latest-map. | The app counts nothing itself. The starter-map button waits for the server's count to reach two. With no count from the server, the marker alone decides, because the server only releases it at two. |
| **`act` → `starterMapComplete: true`** | The app clears the "Building your starter map" banner and puts the button on the newest reply, unless a reply already has it. |
| **Seen**: `POST /api/m2/cards/:id/seen` with `{ itemIndices }` | Called once per item, the first time a card shows on the chat screen. Messages still calls `/read` on open. |
| **No `savedBeliefs`; `CHAT_META` never reaches the app.** | Nothing to do. On M2 the part badge and the confidence ring stay dark. |
| **`gather-noticed`** → `{ needed: false, stack: "m2" }` | No change: `needed: false` already means "end now". |
| **`chatMode` ignored** | Still sent, defaulting to `explore` because M2 has no mode control. |
| **A first session can end after 4+ user turns** when a new one starts (ruling (d), still open). | Read from `completedAt` at boot, as always. |

## The fields a card can carry (mapping-m2 (3).md, line 16)

The editor shows every bundled field with its own input, labelled in plain words. Every field line 16 names has its own label, and no two fields on one card share a label. The smoke checks both, and when the founder's file is on disk it also checks its list still matches line 16.

| Card | Fields → label |
|---|---|
| wound | belief → the belief underneath; feeling → the feeling underneath; story → the story it carries; body → where you feel it; history → where it comes from; worldview → how it sees things; trigger → what sets it off; voice → what it says |
| fixer, skeptic | pattern → what it does; selectivity → who or where it shows up with; what-it-protects → what it protects; how-it-shows-up → how it shows up; body, history, worldview, voice as above; desire → what it wants; fantasy → what it dreams of |
| manager, firefighter | strategy → what it does; when-it-fires → when it steps in; what-it-gives → what it gives you; what-it-manages → what it keeps in check; situation → when it shows up; example → an example; trigger, body, voice, worldview, story as above |
| self-like | stands-on → what you stand on; body → where you feel it; clenched-or-open → tight or open |
| middle | label → the moment (the headline); note → what you said |
| belief | belief → what you stand on (on this card only; a wound's belief stays "the belief underneath") |

**Renaming isn't a card edit.** `mapping-m2 (3).md` line 12 makes PART_NAMED "the one direct write". A name comes from what the person says in conversation, not from a card. So a chat card's name stays read-only in the editor, and its fields are what EDIT changes.

## Still open

- **The server's field table is behind line 16.** At `lib/m2/rules.js` (`claude/m2-chat-stack-b14563` @ `b1ce6d1`):
  - **self-like (line 14)** allows `pattern, what-it-built, agenda, body, clenched-or-open, lean, voice`. It has no `stands-on`, so a `stands-on` field would fall back to the lead field `pattern` and the card would read "what it does" for what the person stands on.
  - **manager and firefighter (lines 15–16)** lack `trigger`, `situation`, `example`, `worldview` and `story` on a part card, and allow `history`, which line 16 doesn't list.
  - **fixer and skeptic (lines 12–13)** still allow `fear`, which line 16 doesn't list.

  The app labels every one of these keys either way, so nothing reaches the screen as the generic "more about it". Which fields actually arrive is the server's to fix.
- **The button's name.** The server doc calls it "View your map" (lines 238 and 242). The app's button says "View my starter map", as it does off M2. `first-session (1).md` doesn't name it.

## The invented-memory copy (ruling 2026-11-05)

All three lines are app copy behind the flag. Off M2, each one is the old string, rebuilt byte for byte.

- **The Guide's "learns who you are"** (`utils/guideContent.ts`, was line 130). On M2 it reads: "Over time, Inner Map keeps your map, key moments and some of what you've said, so you don't have to start over each time." These are the app's words, written to Draft 3.5 line 99, because the audit named the problem but gave no replacement. **The founder approved them as written on 2026-11-05.** They don't say "no transcript", because the app does save conversations to history. The Guide and onboarding read the deck through `welcomeSlidesFor(m2)`, which differs from the old one by that paragraph alone. A first-run onboarding never sees it, because the flag comes from the chat's boot, which happens later.
- **The YOU folder's biography** (`components/map/PartFolderModal.tsx`, was line 107). On M2 its first paragraph is the audit's suggested fix. The two paragraphs after it are framework-word findings the ruling didn't cover.
- **The session summary's fallback** (`components/session/SessionSummaryModal.tsx`, was lines 203–204). On M2 it keeps "This session has been saved to your journal." and drops "Your map has been updated.", which was shown on every fallback whether or not anything was written. This is the audit's first option. Its other option, showing the line only after a real write, would need the app to know whether any card was tapped in that session.

Not changed, per the ruling:

- the rest of the Guide;
- the Self voice, the map voices and the Guide's Self description, which are exempt from the "I'm here / with you" rule.

The summary prompt's own fix ("name what came close") is server copy, done on the m2-chat-stack branch (`lib/m2/summary.js`).
