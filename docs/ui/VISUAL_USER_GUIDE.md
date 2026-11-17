# Visual user guide

`/guide` is a standalone public page. The header link opens it in a new tab from home, room preparation and the draft. The account dialog also exposes the link. The guide does not mount the room application or initialize its authentication client, so opening it cannot resume a room or modify a draft.

Five chapters cover entry, preparation, guided drafting and corrections, score interpretation, and screenshot import. Secondary explanations are collapsible; reading the main path requires no interaction. Images are actual browser captures of the current app, with neutral disposable local example rooms and illustrative demo scores. Numbered spotlight overlays are HTML/SVG, with equivalent explanations in adjacent text. Full-size images can be opened separately. The layout adapts to mobile and has print styling.

## Update only what changes

Keep the guide aligned with changes to user behavior, permissions, score meanings or action labels. Small layout differences do not require replacing the entire guide.

To refresh captures:

1. Start a local development server: `npm run dev -- --port 5173`.
2. Run `node scripts/capture-guide.mjs` (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when needed).
3. Inspect `public/guide/*.png` and their spotlight coordinates in `src/pages/guide-screens.json`.
4. Check desktop and mobile `/guide`, and update its visible date if content changed.

The capture script uses localStorage for local example rooms only. Its one public-site visit is read-only, capturing the real home page wording without creating a shared room or signing in. No user dataset image, room invitation, account information or private screenshot is included in the guide.
