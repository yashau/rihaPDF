// AcroForm field extraction.
//
// Walks /Root /AcroForm /Fields recursively to enumerate every terminal
// field; collects each field's widget annotations and resolves the
// host page by scanning every page's /Annots (the /P back-reference is
// optional in the spec and missing in practice for many gov-issued
// forms). Output is consumed by FormFieldLayer to render the per-field
// overlay and by saveFormFields to write /V back at save time.
//
// Pure read — never mutates the doc.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";
import { isRtlScript } from "@/pdf/text/fonts";
import type {
  FormField,
  FormFieldChoiceOption,
  FormFieldRadioOption,
  FormFieldWidget,
} from "@/domain/formFields";
import {
  decodePdfTextString,
  discoverWidgetOnState,
  fullyQualifiedFieldName,
  inheritedObject,
  isFieldKid,
  readPdfNumber,
  readPdfRectArray,
} from "@/pdf/forms/pdfFormTree";

type Common = {
  id: string;
  fullName: string;
  sourceKey: string;
  widgets: FormFieldWidget[];
  /** /Ff bit 1 — UI renders disabled. */
  readOnly: boolean;
  /** /Ff bit 2 — UI renders with a subtle ring. */
  required: boolean;
};

/** /Ff bit positions per PDF 32000-1 §12.7.3.1 (1-indexed in the spec
 *  → 0-indexed shifts here). The bits mean different things per field
 *  kind, but the kind-specific ones never overlap with the generic
 *  ones (1 / 2 / 3) so a flat enum is fine. */
const FF_READONLY = 1 << 0;
const FF_REQUIRED = 1 << 1;
const FF_NO_EXPORT = 1 << 2;
const FF_TX_MULTILINE = 1 << 12;
const FF_TX_PASSWORD = 1 << 13;
const FF_TX_FILE_SELECT = 1 << 20;
const FF_BTN_RADIO = 1 << 15;
const FF_BTN_PUSH = 1 << 16;
const FF_CH_COMBO = 1 << 17;
const FF_CH_MULTI_SELECT = 1 << 21;
void FF_NO_EXPORT; // surfaced via type but currently unused at extract time

/** Parse the size token out of a `/DA` string. Pdf spec: `/Helv 10 Tf …`
 *  — the number right before `Tf`. Returns null when /DA is missing or
 *  doesn't carry an explicit size (some forms use 0 to mean "auto"). */
function parseDaFontSize(da: string | null): number | null {
  if (!da) return null;
  const m = da.match(/(\d+(?:\.\d+)?)\s+Tf/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function readDa(dict: PDFDict): string | null {
  const da = inheritedObject(dict, PDFName.of("DA"));
  if (da instanceof PDFString || da instanceof PDFHexString) return da.decodeText();
  return null;
}

/** Extract `[llx, lly, urx, ury]` from a `/Rect` array. Returns a
 *  zero-rect when the array is missing or malformed — those widgets
 *  render off-page in the overlay layer, which is the right fail-safe
 *  (don't crash, don't paint nonsense). */
function readRect(dict: PDFDict): [number, number, number, number] {
  return readPdfRectArray(dict) ?? [0, 0, 0, 0];
}

/** Build a Map<PDFRef, pageIndex> by walking each page's /Annots. The
 *  map is the only reliable way to resolve a widget → page given that
 *  widgets often omit the optional /P back-reference. */
function buildWidgetPageMap(doc: PDFDocument): Map<PDFRef, number> {
  const map = new Map<PDFRef, number>();
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let j = 0; j < annots.size(); j++) {
      const entry = annots.get(j);
      if (entry instanceof PDFRef) map.set(entry, i);
    }
  }
  return map;
}

/** Decode /V for a text field. Acrobat / Preview write Thaana as
 *  UTF-16BE-with-BOM; pdf-lib's `decodeText` handles that natively. */
function readTextValue(dict: PDFDict): string {
  const v = inheritedObject(dict, PDFName.of("V"));
  return decodePdfTextString(v);
}

/** /V for a Btn checkbox is a name (`/Yes` / `/Off`) or absent. */
function readCheckboxChosenState(dict: PDFDict): string {
  const v = inheritedObject(dict, PDFName.of("V"));
  if (v instanceof PDFName) return v.asString().replace(/^\//, "");
  return "Off";
}

/** /V for a radio group is the chosen widget's appearance state name. */
function readRadioChosen(dict: PDFDict): string | null {
  const v = inheritedObject(dict, PDFName.of("V"));
  if (!(v instanceof PDFName)) return null;
  const name = v.asString().replace(/^\//, "");
  return name === "Off" ? null : name;
}

/** /V for a Ch field is a string or array of strings (multi-select). */
function readChoiceChosen(dict: PDFDict): string[] {
  const v = inheritedObject(dict, PDFName.of("V"));
  if (v instanceof PDFString || v instanceof PDFHexString) return [v.decodeText()];
  if (v instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < v.size(); i++) {
      const entry = v.get(i);
      if (entry instanceof PDFString || entry instanceof PDFHexString) out.push(entry.decodeText());
    }
    return out;
  }
  return [];
}

/** /Opt for a Ch field. Each row is either a string (= value AND label)
 *  or a 2-element array `[exportValue, displayLabel]`. */
function readChoiceOptions(dict: PDFDict): FormFieldChoiceOption[] {
  const opt = dict.lookup(PDFName.of("Opt"));
  if (!(opt instanceof PDFArray)) return [];
  const out: FormFieldChoiceOption[] = [];
  for (let i = 0; i < opt.size(); i++) {
    const row = opt.get(i);
    if (row instanceof PDFString || row instanceof PDFHexString) {
      const text = row.decodeText();
      out.push({ value: text, label: text });
    } else if (row instanceof PDFArray && row.size() >= 2) {
      const valueObj = row.get(0);
      const labelObj = row.get(1);
      const value = decodePdfTextString(valueObj);
      const label = decodePdfTextString(labelObj) || value;
      out.push({ value, label });
    }
  }
  return out;
}

/** Collect a field's widget annotations. A field with a single widget
 *  often inlines the widget into the field dict itself (`/Subtype
 *  /Widget` on the field); otherwise the widgets sit in `/Kids`. We
 *  only treat a kid as a widget when it has no `/T` of its own — kids
 *  WITH /T are sub-fields, not widgets. */
function collectFieldWidgets(
  fieldDict: PDFDict,
  widgetPageMap: Map<PDFRef, number>,
  fieldRef: PDFRef | null,
  fullName: string,
  sourceKey: string,
): { widgets: FormFieldWidget[]; widgetDicts: PDFDict[] } {
  const widgets: FormFieldWidget[] = [];
  const widgetDicts: PDFDict[] = [];
  const subtype = fieldDict.lookup(PDFName.of("Subtype"));
  const isMergedWidget = subtype instanceof PDFName && subtype.asString() === "/Widget";
  if (isMergedWidget) {
    const pageIndex = fieldRef ? (widgetPageMap.get(fieldRef) ?? -1) : -1;
    widgets.push({
      id: `${sourceKey}:${fullName}:0`,
      pageIndex,
      rect: readRect(fieldDict),
    });
    widgetDicts.push(fieldDict);
    return { widgets, widgetDicts };
  }
  const kids = fieldDict.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) return { widgets, widgetDicts };
  let widgetIdx = 0;
  for (let i = 0; i < kids.size(); i++) {
    const kidRef = kids.get(i);
    const kidObj = kids.lookup(i);
    if (!(kidObj instanceof PDFDict)) continue;
    // Sub-field (has its own /T). Widgets-only-kids drop into the
    // widget collection; a kid with /T is a nested field that the
    // outer `walkFields` recursion will pick up separately.
    if (kidObj.lookup(PDFName.of("T")) !== undefined) continue;
    const kidSubtype = kidObj.lookup(PDFName.of("Subtype"));
    if (kidSubtype instanceof PDFName && kidSubtype.asString() !== "/Widget") continue;
    const pageIndex = kidRef instanceof PDFRef ? (widgetPageMap.get(kidRef) ?? -1) : -1;
    widgets.push({
      id: `${sourceKey}:${fullName}:${widgetIdx}`,
      pageIndex,
      rect: readRect(kidObj),
    });
    widgetDicts.push(kidObj);
    widgetIdx += 1;
  }
  return { widgets, widgetDicts };
}

/** Resolve a field's /FT (inheritable). Returns the bare name without
 *  the leading slash: "Tx", "Btn", "Ch", "Sig", or "" when absent. */
function readFieldType(dict: PDFDict): string {
  const ft = inheritedObject(dict, PDFName.of("FT"));
  if (ft instanceof PDFName) return ft.asString().replace(/^\//, "");
  return "";
}

function buildField(
  fieldDict: PDFDict,
  fieldRef: PDFRef | null,
  widgetPageMap: Map<PDFRef, number>,
  sourceKey: string,
): FormField | null {
  const fullName = fullyQualifiedFieldName(fieldDict);
  if (!fullName) return null;
  const ft = readFieldType(fieldDict);
  const ff = readPdfNumber(inheritedObject(fieldDict, PDFName.of("Ff"))) ?? 0;
  const readOnly = (ff & FF_READONLY) !== 0;
  const required = (ff & FF_REQUIRED) !== 0;
  const id = `${sourceKey}:${fullName}`;
  const { widgets, widgetDicts } = collectFieldWidgets(
    fieldDict,
    widgetPageMap,
    fieldRef,
    fullName,
    sourceKey,
  );
  const common: Common = { id, fullName, sourceKey, widgets, readOnly, required };

  if (ft === "Tx") {
    const da = readDa(fieldDict);
    return {
      ...common,
      kind: "text",
      value: readTextValue(fieldDict),
      multiline: (ff & FF_TX_MULTILINE) !== 0,
      password: (ff & FF_TX_PASSWORD) !== 0,
      fileSelect: (ff & FF_TX_FILE_SELECT) !== 0,
      maxLen: readPdfNumber(fieldDict.lookup(PDFName.of("MaxLen"))),
      fontSize: parseDaFontSize(da),
      rtl: isRtlScript(readTextValue(fieldDict)),
    };
  }

  if (ft === "Btn") {
    if ((ff & FF_BTN_PUSH) !== 0) return null; // pushbuttons aren't fillable
    if ((ff & FF_BTN_RADIO) !== 0) {
      const options: FormFieldRadioOption[] = [];
      for (let i = 0; i < widgets.length; i++) {
        const onState = discoverWidgetOnState(widgetDicts[i]) ?? "";
        if (!onState) continue;
        options.push({ ...widgets[i], onState });
      }
      return {
        ...common,
        kind: "radio",
        chosen: readRadioChosen(fieldDict),
        options,
      };
    }
    // Plain checkbox — single widget; multi-widget checkboxes are
    // legal per spec but rare and behave as a synced group, which we
    // approximate by treating the FIRST widget's on-state as canonical.
    const onState =
      widgetDicts.length > 0 ? (discoverWidgetOnState(widgetDicts[0]) ?? "Yes") : "Yes";
    const stored = readCheckboxChosenState(fieldDict);
    return {
      ...common,
      kind: "checkbox",
      checked: stored !== "Off",
      onState,
    };
  }

  if (ft === "Ch") {
    return {
      ...common,
      kind: "choice",
      combo: (ff & FF_CH_COMBO) !== 0,
      multiSelect: (ff & FF_CH_MULTI_SELECT) !== 0,
      options: readChoiceOptions(fieldDict),
      chosen: readChoiceChosen(fieldDict),
    };
  }

  if (ft === "Sig") {
    return { ...common, kind: "signature" };
  }

  return null;
}

/** Recurse into /Kids until each terminal field is found. A node with
 *  field-kids is an intermediate; a node whose kids are all widgets
 *  (no /T on any kid) is a terminal field. The recursion enumerates
 *  every terminal field exactly once. */
function walkFields(
  ref: PDFRef | null,
  dict: PDFDict,
  widgetPageMap: Map<PDFRef, number>,
  sourceKey: string,
  out: FormField[],
): void {
  const kids = dict.lookup(PDFName.of("Kids"));
  // A node is "intermediate" iff at least one kid is itself a field
  // (i.e. has /T or has field-kids). That distinction is what lets
  // shared inheritable attributes (e.g. /FT on the parent group) sit
  // on a non-terminal node without us trying to render it as a
  // terminal field. Mixed broadcasts are rare; we honor the spec's
  // canonical "field is terminal iff all kids are widgets" rule.
  if (kids instanceof PDFArray) {
    let allKidsAreWidgets = true;
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict && isFieldKid(kid)) {
        allKidsAreWidgets = false;
        break;
      }
    }
    if (!allKidsAreWidgets) {
      for (let i = 0; i < kids.size(); i++) {
        const kidRef = kids.get(i);
        const kidDict = kids.lookup(i);
        if (kidDict instanceof PDFDict && isFieldKid(kidDict)) {
          walkFields(
            kidRef instanceof PDFRef ? kidRef : null,
            kidDict,
            widgetPageMap,
            sourceKey,
            out,
          );
        }
      }
      return;
    }
  }
  const built = buildField(dict, ref, widgetPageMap, sourceKey);
  if (built) out.push(built);
}

/** Top-level extractor. Walks /Root /AcroForm /Fields and returns one
 *  FormField per terminal field. Returns an empty array for docs
 *  without an AcroForm dict. */
export function extractFormFields(doc: PDFDocument, sourceKey: string): FormField[] {
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return [];
  const fields = acroForm.lookup(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) return [];
  const widgetPageMap = buildWidgetPageMap(doc);
  const out: FormField[] = [];
  for (let i = 0; i < fields.size(); i++) {
    const fieldRef = fields.get(i);
    const fieldDict = fields.lookup(i);
    if (!(fieldDict instanceof PDFDict)) continue;
    walkFields(
      fieldRef instanceof PDFRef ? fieldRef : null,
      fieldDict,
      widgetPageMap,
      sourceKey,
      out,
    );
  }
  return out;
}
