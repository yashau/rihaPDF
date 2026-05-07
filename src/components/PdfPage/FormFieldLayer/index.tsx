// Per-page overlay for AcroForm fields.
//
// Renders one absolutely-positioned input over each widget's /Rect,
// converted PDF y-up -> viewport y-down via `vpY`. The overlays sit
// inside the same natural-pixel page wrapper as every other PdfPage
// child, so they inherit the wrapper's CSS scale on mobile.
//
// Coordinate convention: every FormField field is in PDF user space
// (y-up). We convert to natural viewport pixels (y-down) for layout,
// matching AnnotationLayer's sub-layers.

import { useState } from "react";
import type { FormField, FormValue } from "@/domain/formFields";
import { useIsMobile } from "@/platform/hooks/useMediaQuery";
import { pdfRectArrayToViewportRect } from "../geometry";
import { MobileThaanaToggleBar } from "../MobileThaanaToggleBar";
import { CheckboxOverlay, ChoiceOverlay, RadioField, TextFieldOverlay } from "./overlays";

export type { FormValue };

type Props = {
  /** All form fields for this page's source. The layer filters to
   *  widgets whose `pageIndex` matches the current `pageIndex` prop.
   *  Done here (rather than in PageList) so a field with widgets on
   *  multiple pages — rare but legal — gets its overlays rendered on
   *  every page it touches. */
  formFields: FormField[];
  /** Per-source map of fullName → user-set value. The layer falls
   *  back to the FormField's pre-parsed initial value when a name has
   *  no entry. */
  formValues: Map<string, FormValue>;
  /** Source-page index this overlay layer is rendering on top of. */
  pageIndex: number;
  pageScale: number;
  viewHeight: number;
  onChange: (fullName: string, value: FormValue) => void;
};

export function FormFieldLayer({
  formFields,
  formValues,
  pageIndex,
  pageScale,
  viewHeight,
  onChange,
}: Props) {
  const isMobile = useIsMobile();
  /** Mobile-only DV/EN toggle for Thaana phonetic input. Same default
   *  as EditField / InsertedTextOverlay — DV (Thaana) is on so a
   *  Latin-soft-keyboard user can type Thaana straight into form
   *  fields. The user can flip via the floating toggle below; the
   *  state lives at the layer level so all fields on the page share
   *  it (typing into one field, switching to another, then back, keeps
   *  the same mode). */
  const [thaanaInput, setThaanaInput] = useState(true);
  /** Currently-focused text field id — the transliterator listener is
   *  re-attached per id so switching directly between two text fields
   *  rewires onto the new element. Drives the DV/EN toggle's mounted
   *  state (only shown while a text field is focused, matching the
   *  CommentLayer pattern). */
  const [focusedTextId, setFocusedTextId] = useState<string | null>(null);
  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {formFields.flatMap((field) => {
        // A field can have widgets on multiple pages; render only the
        // widgets that live on this page.
        const widgetsOnPage = field.widgets.filter((w) => w.pageIndex === pageIndex);
        if (widgetsOnPage.length === 0) return [];
        if (field.kind === "radio") {
          return [
            <RadioField
              key={field.id}
              field={field}
              widgetsOnPage={widgetsOnPage}
              formValues={formValues}
              pageScale={pageScale}
              viewHeight={viewHeight}
              onChange={onChange}
            />,
          ];
        }
        return widgetsOnPage.map((widget, i) => {
          const { left, top, width, height } = pdfRectArrayToViewportRect(
            widget.rect,
            pageScale,
            viewHeight,
          );
          if (field.kind === "text") {
            return (
              <TextFieldOverlay
                key={widget.id}
                field={field}
                widgetIndex={i}
                left={left}
                top={top}
                width={width}
                height={height}
                pageScale={pageScale}
                formValues={formValues}
                isMobile={isMobile}
                thaanaInput={thaanaInput}
                isFocused={focusedTextId === widget.id}
                onFocus={() => setFocusedTextId(widget.id)}
                onBlur={() => setFocusedTextId((prev) => (prev === widget.id ? null : prev))}
                onChange={onChange}
              />
            );
          }
          if (field.kind === "checkbox") {
            return (
              <CheckboxOverlay
                key={widget.id}
                field={field}
                left={left}
                top={top}
                width={width}
                height={height}
                formValues={formValues}
                onChange={onChange}
              />
            );
          }
          if (field.kind === "choice") {
            return (
              <ChoiceOverlay
                key={widget.id}
                field={field}
                left={left}
                top={top}
                width={width}
                height={height}
                pageScale={pageScale}
                formValues={formValues}
                onChange={onChange}
              />
            );
          }
          if (field.kind === "signature") {
            return (
              <div
                key={widget.id}
                className="absolute flex items-center justify-center text-[10px] uppercase tracking-wider text-zinc-400"
                style={{
                  left,
                  top,
                  width,
                  height,
                  border: "1px dashed rgba(120, 120, 120, 0.6)",
                  background: "rgba(240, 240, 240, 0.4)",
                  pointerEvents: "auto",
                  cursor: "not-allowed",
                }}
                aria-label="Signature field (read-only)"
              >
                signature
              </div>
            );
          }
          return null;
        });
      })}
      <MobileThaanaToggleBar
        enabled={isMobile && focusedTextId !== null}
        value={thaanaInput}
        onChange={setThaanaInput}
      />
    </div>
  );
}
