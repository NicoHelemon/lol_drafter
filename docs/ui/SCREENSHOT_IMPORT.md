# Champion-select screenshot import

The host can drop, choose or paste a PNG/JPEG/WebP screenshot during a live draft. The import pane sits to the right of participants on desktop and below them on narrow screens. Pasting into text inputs or an open dialog keeps the normal editing behavior.

Recognition runs locally in a dedicated worker, using portrait templates, OpenCV and Tesseract. Images, OCR text and player names are not uploaded. The room receives only confirmed champion IDs, roles and ban positions after recognition. Local runtimes are loaded only when an image is opened; the first import downloads roughly 24 MB before compression. Cropping to the client speeds up recognition, especially for stream screenshots.

## Direct import

- Left client column means Ally team, right means Enemy team, independent of blue/red side.
- Compatible existing picks, bans and role placements are preserved. A detected contradiction rejects the entire import without modifying the draft. Unrecognized or obscured slots are not treated as proof of a conflict.
- New roles are assigned jointly across free roles, using client labels and role popularity. Corrections are made directly in the draft.
- Hovers, in-progress picks and ambiguous portraits are omitted. Unreadable images show an inline error. Reimporting an already matching screenshot makes no changes.
- Successful imports automatically enable Open draft, without a preview or confirmation dialog. The panel explains this before import; recognition can be cancelled.
- An import is one atomic host action and one Undo checkpoint. Undo restores previous selections while keeping Open draft; Redo reapplies the additions. Candidate lists and participant roles are preserved.
- Compatibility is checked against the latest room state after recognition. The server rejects stale writes or overwrites atomically.

## Maintenance

`npm ci` then `npm run build` prepares same-origin OCR assets. No CDN or inference account is required. The page keeps its restrictive script policy; only recognition worker responses permit the dynamic code/WASM required by the libraries.

Precomputed portrait assets are committed in `public/image-tools`. To regenerate them after a catalogue update, install Python dependencies used by `scripts/experiments/draft_image_poc_v2.py`, then run `python3 scripts/build_image_templates.py`. Python is not required by the production build. Generated OCR runtimes are ignored; their Apache-2.0 notices are copied alongside them by `scripts/prepare-image-tools.mjs`.

Validation covers append-only merges, permissions and rollback in PostgreSQL-compatible tests; clipboard/drop/direct-import flows; real pixels through production bundles and CSP without external requests. Dataset measurements use the same twenty supplied images used during development, so they do not establish accuracy on unseen screenshots. User images and OCR caches are deliberately excluded from source control.
