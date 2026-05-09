# Browser privacy and security model

rihaPDF's product promise is simple: the PDF stays in the user's browser. There is no upload server, no account, and no backend PDF processing path.

## Client-only processing

PDF bytes are read with browser file APIs, parsed/rendered with PDF.js, edited in React state, written with pdf-lib, and downloaded as a new file. The deployed app serves static assets only.

This matters for government/office PDFs: users can test immediately without procurement, server approval, or sending documents to a third party.

## Guardrails

The browser is still a constrained runtime, so rihaPDF enforces practical limits:

- maximum file size: 150 MB,
- maximum page count: 250 pages,
- capped device pixel ratio,
- maximum canvas edge/pixel budget.

These live in `src/pdf/render/guardrails.ts`. They are not PDF-format limits; they are browser memory/safety limits for this build.

## Caches

rihaPDF uses short-lived in-memory caches for previews, thumbnails, blank-page renders, and drag imagery. Caches are bounded or tied to the current document/session so stale sensitive content is not intentionally persisted.

Generated download blobs are expired/cleaned up after use rather than kept indefinitely.

## Redaction security

Redaction is not a visual overlay. Saved PDFs remove supported underlying text/image/vector/annotation/form-widget content and then draw the black rectangle. Object/resource pruning exists because unreferenced PDF streams can still be recoverable from raw bytes if serialized.

See [redaction-pipeline.md](redaction-pipeline.md).

## Security headers

Production hosting uses static asset/security headers to reduce accidental exposure and browser attack surface. Keep these aligned with the no-backend model: if future features introduce external calls, they should be explicit and documented.

## Known non-goals

- No OCR.
- No encrypted-PDF preservation/support yet.
- Visual signatures are not cryptographic signatures.
- The app does not claim forensic-grade sanitization for every malformed/unsupported PDF construct; unsupported redaction cases intentionally over-strip when possible.

## Change rules

- Do not introduce network upload paths without a product/security decision.
- Keep limits documented in README when changing guardrails.
- Treat caches and object URLs as sensitive document material.
- For redaction/security paths, prefer conservative failure modes and regression fixtures.
