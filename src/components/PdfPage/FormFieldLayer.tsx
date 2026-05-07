// Per-page overlay for AcroForm fields.
//
// Renders one absolutely-positioned input over each widget's /Rect,
// converted PDF y-up → viewport y-down via `vpY`. The overlays sit
// inside the same natural-pixel page wrapper as every other PdfPage
// child, so they inherit the wrapper's CSS scale on mobile.
//
// Coordinate convention: every FormField field is in PDF user space
// (y-up). We convert to natural viewport pixels (y-down) for layout,
// matching AnnotationLayer's sub-layers.

import { useRef, useState } from "react";
import type {
  ChoiceFormField,
  FormField,
  FormValue,
  RadioFormField,
  TextFormField,
} from "../../lib/formFields";
import { isRtlScript } from "../../lib/fonts";
import { useThaanaTransliteration } from "../../lib/thaanaKeyboard";
import { useIsMobile } from "../../lib/useMediaQuery";
import { useCenterInVisibleViewport } from "../../lib/useVisualViewport";
import { pdfRectArrayToViewportRect } from "./geometry";
import { isFocusMovingToToolbar } from "./helpers";
import { MobileThaanaToggleBar } from "./MobileThaanaToggleBar";

export type { FormValue };

/** Default CSS font-family for a form text field given its current
 *  value. Thaana → Faruma (the Maldivian de-facto), Latin → Arial.
 *  Mirrors the comment layer's auto-detect — the browser's `dir="auto"`
 *  handles mixed strings visually; the font-family swap happens
 *  whenever the live value flips primary script. */
function fontFamilyFor(text: string): string {
  return isRtlScript(text) ? '"Faruma"' : '"Arial"';
}

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

/** Text / multiline / password field. Defaults `dir="auto"` so a
 *  Thaana value right-aligns and a Latin value left-aligns without
 *  explicit user input; the rtl flag flipping is handled implicitly
 *  by the browser. /MaxLen enforces client-side via maxLength. */
function TextFieldOverlay({
  field,
  widgetIndex,
  left,
  top,
  width,
  height,
  pageScale,
  formValues,
  isMobile,
  thaanaInput,
  isFocused,
  onFocus,
  onBlur,
  onChange,
}: {
  field: TextFormField;
  widgetIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  pageScale: number;
  formValues: Map<string, FormValue>;
  isMobile: boolean;
  thaanaInput: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (fullName: string, value: FormValue) => void;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // Layer-level transliteration gate: mobile + DV mode + this field
  // has focus (= the active textarea on mobile is one of ours). The
  // hook reattaches when any of those flip, so switching from one
  // text field to another rewires the listener onto the new element.
  useThaanaTransliteration(inputRef, isMobile && thaanaInput && isFocused);
  // Mobile: scroll so the focused field sits in the centre of the
  // *visible* viewport (above the soft keyboard, above the bottom-
  // pinned DV/EN toolbar). Re-fires on visualViewport changes so it
  // tracks keyboard show/hide. Same hook EditField / InsertedTextOverlay
  // use for the same reason.
  useCenterInVisibleViewport(inputRef, isMobile && isFocused);

  const stored = formValues.get(field.fullName);
  const value = stored?.kind === "text" ? stored.value : field.value;
  const fontSizePt = field.fontSize ?? Math.max(8, ((height / pageScale) * 0.7) | 0);
  const fontSizePx = fontSizePt * pageScale;
  // Default per-script: Faruma for Thaana, Arial for Latin. Auto-
  // detect from the live value rather than the field's initial-rtl
  // flag so a user typing Thaana into a freshly-empty field gets the
  // right glyphs immediately. (Empty value falls back to the field's
  // pre-parsed rtl hint so the placeholder/font for an empty Thaana
  // field still reads as Faruma.)
  const fontFamily = value === "" && field.rtl ? '"Faruma"' : fontFamilyFor(value);

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left,
    top,
    width,
    height,
    fontFamily,
    fontSize: `${fontSizePx}px`,
    lineHeight: `${height}px`,
    padding: "0 4px",
    border: "1px solid rgba(80, 130, 220, 0.55)",
    background: field.readOnly
      ? "rgba(220, 220, 220, 0.5)"
      : field.required && value === ""
        ? "rgba(254, 226, 226, 0.6)"
        : "rgba(225, 240, 255, 0.65)",
    color: "black",
    colorScheme: "light",
    pointerEvents: "auto",
    boxSizing: "border-box",
    outline: "none",
    resize: "none",
  };

  const commonProps = {
    ref: inputRef as React.Ref<HTMLInputElement | HTMLTextAreaElement>,
    "data-form-field": field.fullName,
    "data-form-widget-index": widgetIndex,
    dir: "auto" as const,
    disabled: field.readOnly || field.fileSelect,
    maxLength: field.maxLen ?? undefined,
    autoComplete: isMobile && thaanaInput ? ("off" as const) : undefined,
    autoCorrect: isMobile && thaanaInput ? "off" : undefined,
    autoCapitalize: isMobile && thaanaInput ? "none" : undefined,
    spellCheck: !(isMobile && thaanaInput),
    value,
    onFocus,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Tapping the floating DV/EN toggle moves focus to its button on
      // touch (mousedown preventDefault doesn't always stop touch
      // focus shifts). The toolbar is tagged `data-edit-toolbar` so
      // this check keeps the layer's `focusedTextId` set — the
      // transliterator listener stays attached and the toolbar stays
      // mounted while the user flips DV/EN.
      if (isFocusMovingToToolbar(e.relatedTarget)) return;
      onBlur();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(field.fullName, { kind: "text", value: e.target.value }),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  if (field.multiline) {
    return (
      <textarea
        {...commonProps}
        ref={inputRef as React.Ref<HTMLTextAreaElement>}
        style={{ ...baseStyle, lineHeight: 1.2, paddingTop: 2 }}
      />
    );
  }
  return (
    <input
      {...commonProps}
      ref={inputRef as React.Ref<HTMLInputElement>}
      type={field.password ? "password" : "text"}
      style={baseStyle}
    />
  );
}

function CheckboxOverlay({
  field,
  left,
  top,
  width,
  height,
  formValues,
  onChange,
}: {
  field: Extract<FormField, { kind: "checkbox" }>;
  left: number;
  top: number;
  width: number;
  height: number;
  formValues: Map<string, FormValue>;
  onChange: (fullName: string, value: FormValue) => void;
}) {
  const stored = formValues.get(field.fullName);
  const checked = stored?.kind === "checkbox" ? stored.checked : field.checked;
  // Center the native checkbox in the widget rect; size it to the
  // smaller dimension so a square reading frame stays inside the box.
  const size = Math.max(10, Math.min(width, height) - 2);
  return (
    <div
      className="absolute"
      style={{
        left,
        top,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
        background: "rgba(225, 240, 255, 0.35)",
        border: "1px solid rgba(80, 130, 220, 0.45)",
        boxSizing: "border-box",
      }}
    >
      <input
        type="checkbox"
        data-form-field={field.fullName}
        disabled={field.readOnly}
        checked={checked}
        onChange={(e) => onChange(field.fullName, { kind: "checkbox", checked: e.target.checked })}
        onClick={(e) => e.stopPropagation()}
        style={{ width: size, height: size, cursor: field.readOnly ? "not-allowed" : "pointer" }}
      />
    </div>
  );
}

function RadioField({
  field,
  widgetsOnPage,
  formValues,
  pageScale,
  viewHeight,
  onChange,
}: {
  field: RadioFormField;
  widgetsOnPage: RadioFormField["widgets"];
  formValues: Map<string, FormValue>;
  pageScale: number;
  viewHeight: number;
  onChange: (fullName: string, value: FormValue) => void;
}) {
  const stored = formValues.get(field.fullName);
  const chosen = stored?.kind === "radio" ? stored.chosen : field.chosen;
  return (
    <>
      {widgetsOnPage.map((widget) => {
        // Look up the option by widget id so we know its onState. If
        // the field's onState list is missing this widget (malformed
        // doc), drop the overlay.
        const opt = field.options.find((o) => o.id === widget.id);
        if (!opt) return null;
        const { left, top, width, height } = pdfRectArrayToViewportRect(
          widget.rect,
          pageScale,
          viewHeight,
        );
        const size = Math.max(10, Math.min(width, height) - 2);
        const isChecked = chosen === opt.onState;
        return (
          <div
            key={widget.id}
            className="absolute"
            style={{
              left,
              top,
              width,
              height,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "auto",
              background: "rgba(225, 240, 255, 0.35)",
              border: "1px solid rgba(80, 130, 220, 0.45)",
              boxSizing: "border-box",
            }}
          >
            <input
              type="radio"
              name={field.fullName}
              data-form-field={field.fullName}
              data-form-on-state={opt.onState}
              disabled={field.readOnly}
              checked={isChecked}
              onChange={(e) => {
                if (!e.target.checked) return;
                onChange(field.fullName, { kind: "radio", chosen: opt.onState });
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: size,
                height: size,
                cursor: field.readOnly ? "not-allowed" : "pointer",
              }}
            />
          </div>
        );
      })}
    </>
  );
}

function ChoiceOverlay({
  field,
  left,
  top,
  width,
  height,
  pageScale,
  formValues,
  onChange,
}: {
  field: ChoiceFormField;
  left: number;
  top: number;
  width: number;
  height: number;
  pageScale: number;
  formValues: Map<string, FormValue>;
  onChange: (fullName: string, value: FormValue) => void;
}) {
  const stored = formValues.get(field.fullName);
  const chosen = stored?.kind === "choice" ? stored.chosen : field.chosen;
  const fontSizePx = Math.max(10, (height * 0.6) | 0);
  // Default font: Faruma for Thaana, Arial for Latin. Detect from the
  // option labels + chosen values so a Thaana-labelled dropdown
  // renders in Faruma even before the user picks anything.
  const allText = [...chosen, ...field.options.map((o) => o.label)].join("");
  const fontFamily = fontFamilyFor(allText);

  const handleSingle = (e: React.ChangeEvent<HTMLSelectElement>) =>
    onChange(field.fullName, { kind: "choice", chosen: [e.target.value] });
  const handleMulti = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const values: string[] = [];
    for (const opt of e.target.selectedOptions) values.push(opt.value);
    onChange(field.fullName, { kind: "choice", chosen: values });
  };

  void pageScale; // pageScale-driven font sizing already folded into fontSizePx

  return (
    <select
      multiple={field.multiSelect}
      data-form-field={field.fullName}
      disabled={field.readOnly}
      value={field.multiSelect ? chosen : (chosen[0] ?? "")}
      onChange={field.multiSelect ? handleMulti : handleSingle}
      onClick={(e) => e.stopPropagation()}
      dir="auto"
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        fontFamily,
        fontSize: `${fontSizePx}px`,
        padding: field.multiSelect ? 2 : "0 4px",
        border: "1px solid rgba(80, 130, 220, 0.55)",
        background: field.readOnly ? "rgba(220, 220, 220, 0.5)" : "rgba(225, 240, 255, 0.65)",
        color: "black",
        colorScheme: "light",
        pointerEvents: "auto",
        boxSizing: "border-box",
      }}
    >
      {/* Combo: empty option lets the user clear the selection. List
        boxes don't need this affordance since the user can ctrl-click
        to deselect. */}
      {!field.multiSelect && field.combo ? <option value="" /> : null}
      {field.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
