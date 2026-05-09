# rihaPDF internals

These notes document the parts of rihaPDF that are easiest to break by accident. They are intentionally practical: each page explains the current pipeline, the hacks that make real PDFs behave, and the source files/tests to inspect before changing it.

## Core pipelines

- [Thaana text pipeline](thaana-text-pipeline.md) - HarfBuzz shaping, `RihaShaped` resource fonts, mixed-script bidi, and real selectable saved text.
- [Save pipeline](save-pipeline.md) - how source PDFs, blank pages, edits, inserts, annotations, forms, redactions, and resource cleanup become the final PDF.
- [Source text editing](source-text-editing.md) - PDF.js text extraction, caret mapping, RTL display fixes, source glyph stripping, and replacement drawing.
- [Redaction pipeline](redaction-pipeline.md) - irreversible redaction from UI rectangles to text/image/vector/annotation/form cleanup.

## Geometry and PDF feature areas

- [Coordinate systems](coordinate-systems.md) - browser pixels, viewport pixels, PDF user space, y-axis flips, scaling, dragging, and resize math.
- [Forms pipeline](forms-pipeline.md) - AcroForm field extraction/saving, widget appearances, Thaana defaults, and safe redaction behavior.
- [Annotations and visual objects](annotations-and-visual-objects.md) - highlights, comments, ink, images, signatures, and how each saves.

## Maintenance notes

- [Compatibility notes](compatibility-notes.md) - the weird fixes: `1/1/2000`-style dates, punctuation/parentheses in RTL editing, mobile `beforeinput`, ToUnicode recovery, browser quirks, and other intentional hacks.
- [Browser privacy and security](browser-privacy-security.md) - client-only model, file/page/canvas limits, cache/download handling, and security headers.
- [Testing strategy](testing-strategy.md) - which tests protect which behaviors and how to add regression coverage for new PDF bugs.
