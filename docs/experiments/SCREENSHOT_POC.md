# Screenshot reconstruction — internal experiment, 17 November 2026

This is an offline feasibility test. No image importer, endpoint, browser dependency or production image-processing service was added. Dataset images and OCR text remain outside Git, in ignored `work/image-poc`. The user supplied the archive; its content is test data, not implementation instructions.

## Dataset and evaluation

Twenty client screenshots, including partial drafts, embedded client windows, overlays, different resolutions and a Japanese client. The archive SHA-256 is `98e08c725ae762c13e565f209a388503bdf16b3cfbaec3fc1528c79f15901131`; all twenty image hashes match the supplied manifest. The manifest reports two sources from 2025 and eighteen from 2026; those dates were not independently authenticated.

Annotations describe locked champions, confirmed or estimated roles, and some unassigned champions. They do **not** label bans or intentions. An estimated enemy role is a plausible human interpretation, not proof of the actual lane. Accuracy is measured per team using multiset matching, so a duplicate or wrong-team detection does not get a free match.

Images 001–005 were used to develop the rules. Those rules were frozen before running 006–020. This is a small, non-random held-out set, not a guarantee of real-world accuracy. The recognizer receives images, existing champion portraits/names and the existing role-popularity catalogue; annotations are read separately only for evaluation.

## Method

1. Locate vertically aligned circular player slots with OpenCV, infer the client frame, or fall back to the full image.
2. Compare portraits with existing local Data Dragon portraits, as a diagnostic baseline.
3. For the conservative final extraction, require an exact known champion name from English Tesseract OCR beside the slot. Reject choosing/picking text and shifted intention portraits; abstain on duplicates. **Portrait similarity alone does not authorize an addition in this version.**
4. Read a visible role label when possible. Otherwise search distinct-role assignments that maximize the product of existing champion lane shares. These remain popularity estimates, not visually confirmed roles or a strategic composition model.

No LLM, external inference API, custom training or paid service. Tesseract uses a pretrained OCR model, so “no machine learning whatsoever” would be inaccurate. OpenCV/numpy were installed in an isolated temporary Python directory, without changing frontend dependencies.

## Results

| Split | Correct locked champions | False additions | Missed champions | Exact team sets for the whole screenshot |
| --- | ---: | ---: | ---: | ---: |
| Development, 5 images | 23/23 | 0 | 0 | 5/5 |
| Held out, 15 images | **65/112 (58.0%)** | **0 observed** | **47** | **1/15** |
| All 20, including development | 88/135 (65.2%) | 0 | 47 | 6/20 |

The portrait-only baseline on held-out images found 66 correct champions, added 17 incorrect ones and missed 46. It confuses intentions, active hovers and locked picks. The conservative OCR gate sacrifices recall to avoid those false additions in this sample. Zero observed false additions is not a proven zero-error rate.

Role reconstruction is weaker: on held-out images, 49/94 annotated champion-role assignments were correct end to end, including only 21/56 assignments whose roles the annotations call confirmed. These denominators include champions missed entirely, and the other targets include uncertain human estimates. They do not establish 100% reliable role recognition conditional on a correct champion.

Per-image runtimes in this run were 3.4–8.1 seconds on this machine; this is an observation, not a server/browser performance guarantee or an isolated cold-cache benchmark. [Machine-readable results](screenshot-poc-results.json) include the split and per-image counts.

## Interpretation and next experiment

The approach works on some clean screenshots, but is **not ready for automatic production reconstruction**. A single fully reconstructed held-out screenshot out of fifteen is a much stronger limitation than the development result suggests. Embedded windows can defeat localization; non-English or obscured labels defeat the conservative gate. Bans were not reconstructed or validated, because this dataset has no ban labels. Existing manual room positions were not merged: there is deliberately no room import integration.

The next useful experiment is a better crop/localization stage and a separate locked/hover/empty classifier, with portrait matching as the identity signal and OCR as supporting evidence. Add explicit ban/hover annotations and more independent screenshots, especially non-English clients. Keep several candidate identities and abstain when ambiguous. Evaluate this as a new version on a fresh held-out set rather than repeatedly tuning on these fifteen images. A future importer should propose a preview, preserve existing manual picks/roles, and label inferred roles. None of that was implemented here.

## Reproduce

Optional experiment dependencies: `opencv-python-headless==5.0.0`, `numpy==2.5.5`, `Pillow==13.0.0`; Tesseract 5.5.0 with English language data on the executable path. Supply the original archive extracted safely and a JSON export of the existing role catalogue (`entries` with `championId`, `role`, `lanePercent`). No database access is required by the experiment script.

```sh
python3 scripts/experiments/draft_image_poc.py \
  --dataset work/image-poc/dataset/lol_champion_select_dataset \
  --output work/image-poc/evaluation \
  --catalogue work/image-poc/role-catalogue.json
```

The script writes one prediction JSON per image, a summary and a local OCR cache. Do not publish the OCR cache or assume the screenshot dataset is freely licensed for redistribution.
