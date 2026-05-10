# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

rihaPDF is a browser-only PDF editor for Dhivehi/Thaana documents. It uses Vite, React, TypeScript, HeroUI, Tailwind, pdf.js, pdf-lib, HarfBuzz, and bidi-js.

PDFs are parsed, edited, previewed, and saved entirely in the browser. Saved PDFs should preserve real selectable/searchable text where supported. Redaction is security-sensitive: saved output must remove recoverable content under the redaction area, not only cover it visually.

## Source and Docs Map

- `src/app/`: app composition, top-level state, document I/O hooks, save-payload assembly.
- `src/components/`: UI; page chrome, overlays, gestures, annotations, and edit fields live under `src/components/PdfPage/`.
- `src/domain/`: editor domain models for annotations, forms, geometry, insertions, redactions, selection, signatures, slots, and tool state.
- `src/pdf/`: PDF parsing/rendering, text extraction, source rewriting, save pipeline, forms, fonts, shaping, redaction internals.
- `src/platform/`: browser utilities, theme handling, polyfills, reusable hooks.
- `test/unit/`: focused Vitest coverage for parsers, geometry, text runs, and redaction internals.
- `test/e2e/`: Vitest + Playwright browser workflows; helpers are in `test/helpers/`, fixtures in `test/fixtures/`.
- `scripts/`: diagnostics/probes for investigation, not the main CI suite.

Prefer linking to existing docs instead of repeating deep details:

- `README.md`: product behavior, architecture, commands, limitations, and test inventory.
- `docs/index.md`: docs entry point.
- `docs/browser-privacy-security.md`, `docs/redaction-pipeline.md`, `docs/save-pipeline.md`, `docs/source-text-editing.md`, `docs/thaana-text-pipeline.md`, `docs/forms-pipeline.md`, `docs/testing-strategy.md`.
- `test/unit/README.md` and `test/e2e/README.md`: coverage inventories and test counts.
- `public/fonts/dhivehi/README.md`: bundled font attributions and policy.

## Non-Negotiables

- Keep PDFs client-side. Do not add uploads, telemetry, remote logging, analytics, or external API calls for document data without explicit instruction.
- Redaction must destroy recoverable content where supported: strip text, sanitize supported raster pixels, remove covered/unsupported XObject draws when needed, and conservatively strip vector paint operations. Prefer safe over-stripping or explicit unsupported behavior over silent leakage.
- Treat save, redaction, glyph stripping, form persistence, bidi/Thaana shaping, and source-text rewriting as high-risk. Add/update focused tests when touching them.
- Preserve selectable/searchable text in saved PDFs where the implementation supports it; do not fake correctness with visual covers or screenshots.
- Preserve bundled font metadata and attributions. Font changes may require updates to `src/pdf/text/fonts.ts`, `NOTICE`, and `public/fonts/dhivehi/README.md`.
- Do not commit generated outputs such as `dist/`, `.wrangler/`, `test-logs/`, or fixture outputs unless intentionally tracked. Generated fixtures under `test/fixtures/` should be deterministic.
- Use ASCII in new code/docs unless the file already uses non-ASCII or Dhivehi/Thaana examples are required.

## Commands

Use pnpm; the repo pins the package manager. CI uses Node 24, pnpm 11, and Chromium via Playwright. Approved pnpm build-script packages are listed in `pnpm-workspace.yaml`; review new lifecycle scripts before approving them.

```bash
pnpm install         # install dependencies
pnpm dev             # strict Vite dev server on 127.0.0.1:5173
pnpm build           # TypeScript build + Vite production build
pnpm check           # TypeScript + Oxfmt check + Oxlint
pnpm check:ci        # CI check variant
pnpm lint            # Oxlint
pnpm format          # Oxfmt write
pnpm format:check    # Oxfmt check only
pnpm test            # unit tests only
pnpm test:unit       # unit test alias
pnpm test:e2e        # starts strict Vite server, then Playwright E2E
pnpm test:all        # unit + managed E2E
pnpm test:fixtures   # rebuild generated fixture PDFs
pnpm preview         # preview production build
pnpm cf:dev          # Cloudflare local preview
pnpm cf:deploy       # build + deploy; only when explicitly asked
```

Run the narrowest meaningful verification while working. For commits, the required rihaPDF gate is `pnpm check`; add `pnpm build`, `pnpm test`, or targeted E2E tests when the change warrants it. E2E runs can take file/name fragments after `--`, for example `pnpm test:e2e -- save-redactions`. Set `APP_URL` only when testing against a non-default local URL.

## UI and Implementation Expectations

- Prefer existing patterns and local helpers; this repo has specialized PDF, geometry, and overlay behavior.
- Keep changes scoped. Avoid broad refactors unless necessary for correctness.
- UI should be compact and workflow-oriented, not decorative. Preserve desktop/mobile layouts, drawer/sidebar behavior, dark/light/system theme behavior, and keyboard shortcuts for delete/undo/redo.
- Keep floating controls, popovers, menus, toolbars, and mobile bottom-toolbar content inside the viewport; measure/flip/clamp instead of assuming placement.
- Preserve touch hold dragging, edge-band auto-scroll, drag handles, and stable overlay/page chrome dimensions.
- Resizable text boxes change editing real estate only; they must not scale text. Preserve whitespace/indentation unless the user edits it away, respect text direction anchoring, and make saved output match browser preview through content-stream surgery.
- Visual signatures are local PNG assets and are not cryptographic signatures. Keep signature storage/processing browser-local.

## Testing and Documentation

- Unit tests are self-contained and do not need the Vite dev server.
- E2E tests are the main user-workflow regression net and start/stop their own strict-port Vite server.
- If generated PDF fixture bytes change unexpectedly, inspect metadata, object ordering, compression, or dependency changes before committing.
- Update `README.md` for user-facing features, limitations, commands, architecture notes, or test coverage changes.
- If tests are added/removed/renamed/split, update the root test badge plus `test/unit/README.md` or `test/e2e/README.md` before committing. Count tests with `pnpm exec vitest list`, not regexes.

## Git Handoff Checklist

Before committing:

- Update README test counts first if tests were added/removed/renamed/split; do not leave count fixes as follow-up commits.
- Run `pnpm check` before every commit. This is the repo gate, including docs-only commits, unless Yashau explicitly approves skipping it.
- Add narrower or broader tests as appropriate for the change, and do not commit known gate failures unless Yashau explicitly approves the exception.

Before finishing:

- Check `git status` before and after edits.
- Do not revert user changes or include unrelated formatting churn.
- Do not edit lockfiles unless dependency changes require it.
- Clean untracked generated artifacts/logs unless intentionally part of the task.
- Report files changed, verification run and pass/fail status, skipped verification with reason, and remaining risk.
