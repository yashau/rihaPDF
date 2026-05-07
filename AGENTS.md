# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

rihaPDF is a browser-only PDF editor for Dhivehi / Thaana documents. It is built with Vite, React, TypeScript, HeroUI, Tailwind, pdf.js, pdf-lib, HarfBuzz, and bidi-js.

The app parses and edits PDFs entirely in the browser. Saved PDFs must preserve real selectable/searchable text where supported. Redactions are security-sensitive: they must remove recoverable content under the redaction area, not only cover it visually.

Primary source areas:

- `src/App.tsx`: composition root and top-level app state wiring.
- `src/components/`: UI components.
- `src/components/PdfPage/`: page rendering, overlays, gestures, edit fields, annotation layers.
- `src/lib/`: PDF parsing, content-stream rewriting, save pipeline, fonts, shaping, redaction, selection, undo/redo, preview, form fields.
- `test/unit/`: focused Vitest tests for pure parser, geometry, text-run, and redaction internals.
- `test/e2e/`: Vitest tests that drive the app through Playwright.
- `test/fixtures/`: pinned and generated PDFs used by tests.
- `scripts/`: one-off diagnostics and probes. These are useful for investigation but are not the main CI test suite.

Reference docs already in the repo:

- `README.md`: product behavior, architecture, commands, limitations, and test inventory.
- `test/unit/README.md`: focused unit coverage inventory and current unit test count.
- `test/e2e/README.md`: Playwright E2E coverage inventory and current E2E test count.
- `form-filling-plan.md`: form field design notes.
- `harfbuzz-plan.md`: shaping notes.
- `pnpm-workspace.yaml`: pnpm build-script approval policy.
- `public/fonts/dhivehi/README.md`: bundled font attributions and policy.

## Working Principles

- Prefer existing patterns over introducing new abstractions. This codebase has specialized PDF, geometry, and overlay behavior; local helpers usually exist for a reason.
- Keep changes scoped. Avoid broad refactors while fixing user-facing behavior unless the refactor is necessary to make the change correct.
- Treat save, redaction, glyph stripping, form-field persistence, and bidi/Thaana shaping as high-risk code. Add or update focused tests when touching them.
- Do not weaken privacy guarantees. PDFs should remain client-side; do not add uploads, analytics, remote processing, or third-party calls without explicit product direction.
- Do not commit generated outputs such as `dist/`, `.wrangler/`, `test-logs/`, or fixture outputs unless the user explicitly asks and the file is intended to be tracked.
- Generated PDF fixtures under `test/fixtures/` are tracked when intentionally regenerated. The fixture generator freezes PDF metadata dates so repeated runs should be byte-stable.
- Preserve the bundled font metadata and attributions. If adding or changing fonts, update `src/lib/fonts.ts`, `NOTICE`, and `public/fonts/dhivehi/README.md` as appropriate.
- Use ASCII in new code and docs unless a file already uses non-ASCII or the content specifically requires Dhivehi/Thaana examples.

## Environment

Use pnpm. The CI workflow uses:

- Node 24
- pnpm 11
- Chromium via Playwright

The repo pins pnpm in `package.json` via `packageManager`. With pnpm 11, dependency build scripts must be explicitly reviewed. Approved build-script packages live in `pnpm-workspace.yaml`:

- `esbuild`
- `sharp`
- `workerd`

If a future dependency adds a lifecycle build script, do not bypass the approval prompt casually. Review why the package needs the script, then update `pnpm-workspace.yaml` deliberately.

Install dependencies:

```bash
pnpm install
```

Start the app:

```bash
pnpm dev
```

The dev server is expected at `http://localhost:5173` for tests.

## Core Commands

```bash
pnpm dev            # Vite dev server
pnpm build          # TypeScript build + Vite production build
pnpm check          # TypeScript + Oxfmt check + Oxlint
pnpm lint           # Oxlint over src/test/config entry points
pnpm format         # Oxfmt write
pnpm format:check   # Oxfmt check only
pnpm test           # Vitest unit + E2E suite; E2E requires pnpm dev already running
pnpm test:fixtures  # Rebuild generated fixture PDFs
pnpm preview        # Preview production build
pnpm cf:dev         # Cloudflare Workers local preview
pnpm cf:deploy      # Build + deploy to Cloudflare Workers
```

Before handing off a meaningful code change, run the narrowest useful verification. For shared or high-risk changes, prefer:

```bash
pnpm check
pnpm build
```

Run `pnpm test test/unit` for focused pure-internal coverage. Run `pnpm test` when behavior is covered by E2E tests or when touching PDF interaction/save paths. Remember that E2E tests require a running dev server:

```bash
pnpm dev
pnpm test
```

CI starts Vite in the background, waits for `http://localhost:5173/`, then runs `pnpm test`.

## Architecture Notes

### Load/Edit/Save Flow

The broad pipeline is:

```text
load PDF
  -> pdf.js renders pages and extracts text content
  -> editable runs, images, shapes, annotations, and form fields become overlays
edit
  -> React state records replacements, movement, insertions, formatting, annotations, forms, and redactions
save
  -> pdf-lib copies pages and resources
  -> custom content-stream logic strips or rewrites original operations
  -> replacement text is shaped and emitted
  -> annotations/forms/redactions are persisted
```

Important modules:

- `src/lib/contentStream.ts`: custom tokenizer/parser for PDF content streams.
- `src/lib/pageContent.ts`: raw content stream access and rewrites.
- `src/lib/save.ts`: save orchestration.
- `src/lib/buildSavePayload.ts`: pure translation from page slots to save payloads.
- `src/lib/shapedDraw.ts`: HarFuzz-shaped text emission.
- `src/lib/shapedBidi.ts`: mixed-script bidi segmentation before shaping.
- `src/lib/redactions.ts` and `src/lib/redactGlyphs.ts`: redaction behavior.
- `src/lib/pdfAcroForm.ts`, `src/lib/formFields.ts`, and `src/lib/saveFormFields.ts`: AcroForm support.
- `src/lib/saveAnnotations.ts` and `src/lib/annotations.ts`: native PDF annotation support.

### UI and Interaction

- Page-specific UI is under `src/components/PdfPage/`.
- `src/components/PdfPage/index.tsx` owns page chrome and gesture wiring.
- Overlays live in `src/components/PdfPage/overlays/`.
- Annotation layers live in `src/components/PdfPage/annotations/`.
- Drag helpers include `useRunDrag.ts`, `useImageDrag.ts`, and `useCrossPageDragPreview.tsx`.
- Shared app state hooks live in `src/lib/`, including `useUndoRedo`, `useSelection`, `usePreviewCanvases`, `useMobileChrome`, and `useDragGesture`.

When adjusting UI, preserve:

- Desktop and mobile layouts.
- Touch hold behavior for mobile dragging.
- Edge-band auto-scroll.
- Drawer/sidebar behavior.
- Keyboard shortcuts for delete, undo, and redo.
- Existing dark/light/system theme behavior.

### Text, Fonts, and Shaping

- Thaana replacement text must use the font pipeline in `src/lib/fonts.ts`.
- Saved Thaana text is shaped with HarfBuzz and emitted as raw PDF text operators.
- Mixed Latin/Thaana runs are segmented by bidi-js before shaping.
- Font embedding intentionally uses `subset: false` for the bundled Thaana font pipeline.
- Underline and strikethrough are paired to source runs at load time and need to strip correctly when toggled off.

Be careful with:

- Text extraction order for mixed-script runs.
- Base + mark ordering for Thaana clusters.
- `ToUnicode` recovery behavior for Maldivian fixtures.
- Bold/italic simulation for fonts that lack variants.

### Redaction

Redaction is not a visual-only feature. A correct save must:

- Paint an opaque redaction rectangle.
- Strip text under the redaction.
- Sanitize supported raster image pixels under the redaction.
- Remove fully covered or unsupported image/Form XObject draws when needed.
- Strip vector paint operations under the redaction conservatively.

For unsupported cases, over-stripping is preferable to leaving recoverable content.

Relevant tests include:

- `test/e2e/redact-maldivian2.test.ts`
- `test/e2e/save-redactions.test.ts`

### Forms and Annotations

AcroForm widgets should remain interactive after save/reopen when supported. Existing values are written to `/V`, and the document `/Root /AcroForm /Fields` is rebuilt after `copyPages`.

Current scope excludes XFA, JavaScript actions, additional actions, and digital-signature creation.

Annotation saves should create native `/Annot` objects where applicable, not only visual overlays.

Relevant tests include:

- `test/e2e/form-fill.test.ts`
- `test/e2e/annotations.test.ts`

### Visual Signatures

Visual signatures are not cryptographic PDF signatures. They are local PNG assets that reuse the inserted-image placement/save pipeline.

- Signature UI lives in `src/components/SignatureModal.tsx`; do not couple it to About modal internals.
- Signature storage and image processing live in `src/lib/signatures.ts` and use IndexedDB so saved signatures remain browser-local.
- Drawn signatures support the signing colour presets in `src/lib/color.ts`.
- Imported signatures should be processed client-side only: remove a simple background where possible, trim transparent pixels, and avoid uploads or remote model/API calls unless explicitly approved.

Relevant tests include:

- `test/e2e/signature.test.ts`

## Testing Guidance

The unit suite under `test/unit/` covers pure parser, geometry, text-run, and redaction internals with synthetic inputs. It does not need the Vite dev server:

```bash
pnpm test test/unit
```

The E2E suite is the main user-workflow regression net. It launches browsers through Playwright but does not spawn the dev server. `vitest.config.ts` disables file parallelism because tests share the same dev-server port and browser-driving setup.

Common targeted test runs use `pnpm test run <name-fragment>`. The repo's `test` script already runs `vitest run`; the extra `run` and name fragment are passed through as Vitest filters.

```bash
pnpm test run move-edit
pnpm test run form-fill
pnpm test run save-redactions
pnpm test run signature
```

If a synthetic PDF fixture changes, regenerate it with:

```bash
pnpm test:fixtures
```

The generated PDFs should be deterministic. If rerunning `pnpm test:fixtures` changes tracked fixture bytes unexpectedly, inspect PDF metadata, object ordering, compression, or dependency changes before committing.

Use diagnostic scripts in `scripts/` for investigation. Do not treat them as a replacement for updating E2E tests when behavior changes.

## Code Style

- TypeScript is strict enough that `pnpm check` should remain clean.
- Formatting is Oxfmt-controlled. Do not hand-format against Oxfmt.
- Oxlint uses migrated type-aware rules for `src`, tests, and config entry points.
- Use React function components and hooks consistent with the existing code.
- Prefer lucide-react icons for UI actions when adding buttons.
- Keep comments short and useful. Add comments for non-obvious PDF/content-stream logic, not for ordinary React or TypeScript mechanics.
- Prefer explicit geometry conversions and named helpers over ad hoc coordinate math.
- Avoid mutation-heavy changes unless the surrounding module already uses that style.

## Frontend Expectations

rihaPDF is a document-editing tool, not a marketing site. UI changes should feel compact, direct, and workflow-oriented.

- Keep controls discoverable and dense enough for repeated editing.
- Maintain stable dimensions for toolbars, overlays, buttons, handles, and page chrome to avoid layout shift.
- Ensure text fits in buttons and panels at mobile widths.
- Do not add decorative UI that competes with the document canvas.
- Verify changes that affect layout in both desktop and mobile viewports.

## Security and Privacy

- Do not introduce network uploads for PDF content.
- Do not add telemetry, tracking, remote logging, or external API calls for document data without explicit instruction.
- Keep `?debug=1` diagnostics local to the browser session.
- Redaction must destroy recoverable content in saved PDFs wherever the implementation claims support.
- Be conservative when handling unsupported PDF features: prefer safe over-stripping or explicit unsupported behavior over silent data leakage.

## Cloudflare Deployment

Deployment is through Cloudflare Workers Static Assets with SPA fallback.

- `wrangler.jsonc` is per-developer and may contain account-specific values.
- `wrangler.jsonc.template` is the tracked starting point.
- Use `pnpm cf:deploy` for production deployment only when explicitly asked.

Do not commit private Cloudflare account IDs or local Wrangler state.

## Git Hygiene

- Check `git status` before and after edits.
- Do not revert user changes unless explicitly asked.
- Keep unrelated formatting churn out of patches.
- Do not edit lockfiles unless dependency changes require it.
- If tests generate artifacts or logs, clean up untracked output unless the artifact is intentionally part of the task.

## PR / Handoff Checklist

Before finishing, report:

- What changed.
- Which files were edited.
- Which verification commands ran and whether they passed.
- Any verification that was skipped and why.
- Any remaining risk, especially for save/redaction/form/text-shaping changes.
- Before committing, update `README.md` when user-facing features, limitations, commands, architecture notes, or test coverage changes. Keep the feature list, root test badge, and linked test inventories accurate; counts should use actual `test(...)` / `it(...)` declarations, not helper `.test(...)` calls.
- When unit coverage changes, also update `test/unit/README.md` so its coverage table and test count stay in sync with the root README.
- When E2E coverage changes, also update `test/e2e/README.md` so its coverage table and test count stay in sync with the root README.

For code changes, prefer ending with a concise status rather than a long explanation. For documentation-only changes, `pnpm check` is usually optional unless formatting or lint rules include the touched files.
