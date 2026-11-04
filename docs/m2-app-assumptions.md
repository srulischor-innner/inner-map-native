# M2: what the app assumes about the server

Written 2026-11-04 on branch `claude/app-next-m2-0823af`. The server's API doc (`docs/m2-api.md` on branch `m2-chat-stack` of the server repo) did not exist when this was built: there was no such branch. Every assumption below is coded in one place, `services/m2.ts`, except A1's parse call in `services/api.ts`. When the real doc lands, compare it to this list and change that file.

The founder's sources: `first-session.md` (the welcome and the first-session rules) and `mapping-m2 (1).md` (the pass, the card kinds and their payloads).

## The rule everything rests on

**Off is today.** Every assumption fails toward the old stack. If the flag isn't read, isn't there, or isn't exactly `"m2"`, the app makes no new requests and shows nothing new. `scripts/smoke-m2-app.mjs` checks that every M2 path checks the flag first.

## A1. The flag

`GET /api/first-session-status` gains a field:

```json
{ "completedAt": null, "promptStack": "m2" }
```

`chatStack: "m2"` is accepted too. Only the exact string `"m2"` turns M2 on, and only when the request succeeded. A missing field, any other value, a non-2xx, a body that won't parse, or a network failure all mean off.

Why this endpoint: it's the one boot call that says who the person is, and the welcome bubble depends on the flag. A second call on the boot path would add its delay to a blank screen. The smoke for the opener (`smoke-constant-opener.js` 8.1) allows exactly two boot fetches.

The flag is read once per launch. If the server moves an account, the app catches up at the next launch. Between the two, the chat may say a card is waiting when the app doesn't show one, and the card is still in Messages.

## A2. Cards are inbox rows of kind `m2_card`

Both surfaces read from one store: the chat screen's pending card and the Messages cards. Each row is one `user_messages` row, listed by the existing `GET /api/messages`:

```json
{
  "id": "…",
  "kind": "m2_card",
  "payload": {
    "sessionId": "<the chat session id the app sent>",
    "sessionDate": "Nov 4",
    "items": [
      {
        "kind": "part | detail | voice | middle_ground | second_wound",
        "payload": { "…": "the pass's payload shape, mapping-m2.md" },
        "anchor": "their exact words",
        "recognised": "confirmed | partial",
        "confirmedInChat": true,
        "status": "pending | accepted | declined",
        "editedValue": "set by the server after an edited accept"
      }
    ]
  },
  "createdAt": "…", "readAt": null, "actedAt": null, "expiresAt": "…"
}
```

`confirmed_in_chat` (snake_case, as the pass emits it) is read as well. Items the app can't read are skipped. Messages renders them as no row, and the chat screen ignores them.

Accepting and declining use the existing endpoints with no change to the request shape:

- `POST /api/messages/:id/act` with `{ itemIndices: [i], edits?: { [i]: "<new wording>" } }` writes item `i` to the map. The response is `{ ok, written, failed, allResolved }`, and `ok: false` means the write didn't land.
- `POST /api/messages/:id/decline` with `{ itemIndices: [i] }` declines item `i` for good.

What the edit replaces, by kind (A2a): `payload.value` for part, detail and voice; `payload.label` for middle_ground; `payload.wound` for second_wound. This matches what the card displays.

## A3. When a chat card appears

The pass runs after each assistant reply, in the background. The app isn't told when it finishes, so after every finished reply on M2 it re-reads `GET /api/messages` at 3, 8 and 16 seconds. A new reply cancels any looks still waiting. The app also re-reads whenever the chat tab comes back into focus. If the server pushes cards on the `done` frame or over a socket instead, change `lookForChatCards` in `app/(tabs)/index.tsx`.

## A4. Which cards go on the chat screen

An item shows on the chat screen when all of these hold:

- its row is `m2_card`,
- its `payload.sessionId` equals the session id the app is sending now,
- the item has `confirmedInChat === true`,
- it's still pending, and
- it has a non-empty value.

Everything else waits in Messages. Messages shows every `m2_card` row, including the chat ones, so leaving the session without tapping loses nothing. A tap in either place resolves the item in both.

When End Session starts a new session id, the old session's cards leave the chat screen and stay in Messages.

## A5. After a tap

The server writes the item through the same paths `MAP_UPDATE`, `MIDDLE_GROUND` and `MAP_SECONDARY` use today. On the next turn it tells the chat "ADDED THIS TURN: <name>", and the reply carries `[ADDED_TO_MAP: <name>]`. The app already renders that marker as the "Added to your map" pill, so the app does nothing new for it. The app doesn't send anything extra on the next turn: the server scopes "ADDED THIS TURN" from the card row's `sessionId`.

## A6. Counting the starter map's entries

In a first session on M2, the "View my starter map" button on the `[STARTER_MAP_COMPLETE]` bubble shows only once the map has two entries.

- If `GET /api/latest-map` carries a server-owned `mapEntryCount` number, the app uses it. The server gates the marker on the same count, so the two should never disagree.
- Otherwise the app counts filled fields on core parts (wound, fixer, skeptic, self-like, manager, firefighter). Every non-empty `markerFields` value counts once, and a part with no field values but a `corePhrase` counts once. This follows first-session.md, where "the feeling or belief", "one way they handle it" and "what tends to set it off" are separate entries even when two sit on one part.

The app recounts at boot, after a chat-card tap, when the marker arrives, and on focus.

The server is also assumed to drop `[STARTER_MAP_COMPLETE]` from the done-frame text when it doesn't honour it (fewer than two entries, per first-session.md's server list, item 1). The app still flips the first session to done whenever the marker reaches it, exactly as today. The button gate is the app's second guard, not the first.

## A7. What the app still sends

`/api/chat` gets the same body as today, including `chatMode` (the working mode's default, `explore`, since there's no control on M2). The app assumes the M2 stack ignores `chatMode` when it picks the prompt, and that "no mode line in a first conversation" is applied on the server. The app sends it because the session row records it. If the server would rather not receive it, delete one line in `runAssistantTurn`.

`onModeSwitch` from the done frame still updates the hidden working mode. On M2 nothing shows it.

## A8. Not assumed, and not built

- **A push or badge per card mid-conversation.** The existing hamburger badge counts unread inbox rows, so a chat card also raises it. Whether M2 sends a push per card is the server's call (switch plan, step 6b).
- **Expiry.** The app shows `expiresAt` nowhere and relies on the server's existing filter.
- **Partial versus confirmed after a tap** (switch plan, question 10). The app shows both the same way.
- **The live confidence ring.** It reads `MAP_UPDATE` during streaming, and M2's chat doesn't emit that, so on M2 it stays dark.
