# preview-app — a local look at real components

Not part of the app. `expo-router` only reads this directory when
`INNERMAP_PREVIEW_ROOT` is set, which only `scripts/preview-reading-web.js`
does, so nothing here ships and nothing here runs on a device.

    npm run preview:reading      # then open http://localhost:8081

## Why it exists

The reading element shipped without anyone having seen it run — there is no
iOS simulator on the build machine, so the only way to look at a React Native
component here is to render it for the web. This produced the visual review of
all five states (locked ×2, unlocked, waiting, the document, failed).

## What is real and what is not

REAL: `components/map/ReadingElement.tsx` and `ReadingModal.tsx` exactly as they
ship, their copy, their animations, their phase machine, at 375pt width.

STUBBED: the transport, and only the transport. `preview-app/index.tsx` swaps
`api.getReading` / `api.generateReading` for functions returning the exact JSON
shapes `server.js` returns. The element cannot tell the difference.

The reading text in the preview is INVENTED. No real user's document appears in
this directory, and none should ever be pasted here.

## How it avoids touching the app

`app.config.js` is a shipped file, so the launcher writes an env-guarded hook
into it, runs, and removes the hook again on exit — including on Ctrl-C. If you
ever find that hook committed, something went wrong: it is not meant to persist.

States are also selectable by URL, which is how the screenshots were taken:

    ?case=locked-ineligible | locked-gate | ready | generating
    ?case=has-reading | error | stale | hidden
    ?case=has-reading&open=1     # the reading screen itself
