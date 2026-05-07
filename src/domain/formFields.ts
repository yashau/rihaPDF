export type FormFieldWidget = {
  /** Stable id: `<sourceKey>:<fullName>:<widgetIndex>`. */
  id: string;
  pageIndex: number;
  /** PDF user-space [llx, lly, urx, ury]. */
  rect: [number, number, number, number];
};

export type FormFieldRadioOption = FormFieldWidget & {
  /** Non-Off appearance state for this widget — the value /V should
   *  carry when this kid is the chosen one. */
  onState: string;
};

export type FormFieldChoiceOption = {
  /** Export value written into /V on selection. */
  value: string;
  /** Human-facing label shown in the dropdown — equals `value` when
   *  /Opt's row is a single string rather than [value, label]. */
  label: string;
};

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

export type TextFormField = Common & {
  kind: "text";
  value: string;
  /** /Ff bit 13 — render as <textarea>. */
  multiline: boolean;
  /** /Ff bit 14 — render as <input type="password">. */
  password: boolean;
  /** /Ff bit 21 — disabled in v1 (no file picker hookup). */
  fileSelect: boolean;
  maxLen: number | null;
  /** Parsed from /DA's `Tf` token when present. */
  fontSize: number | null;
  /** Auto-detected from /V's strong codepoints. The user can flip via
   *  the EditField-style dir toggle on focus. */
  rtl: boolean;
};

export type CheckboxFormField = Common & {
  kind: "checkbox";
  checked: boolean;
  /** Non-Off appearance state used as /V when the box is on. */
  onState: string;
};

export type RadioFormField = Common & {
  kind: "radio";
  /** Currently-selected option's onState, or null when unset. */
  chosen: string | null;
  options: FormFieldRadioOption[];
};

export type ChoiceFormField = Common & {
  kind: "choice";
  /** /Ff bit 18 — combo box vs list box. */
  combo: boolean;
  /** /Ff bit 22 — multiple selections. */
  multiSelect: boolean;
  options: FormFieldChoiceOption[];
  chosen: string[];
};

export type SignatureFormField = Common & {
  kind: "signature";
};

export type FormField =
  | TextFormField
  | CheckboxFormField
  | RadioFormField
  | ChoiceFormField
  | SignatureFormField;

/** User fill for a single field. Discriminated by `kind` so the save
 *  pipeline can route each fill to the right /V encoding: a text
 *  field's `value` is the user-visible string (encoded UTF-16BE on
 *  save), a checkbox's `checked` toggles between the field's pre-
 *  discovered onState and `Off`, a radio's `chosen` is the on-state
 *  name written into both the field's /V and the chosen kid's /AS,
 *  and a choice's `chosen` carries export values matching /Opt rows. */
export type FormValue =
  | { kind: "text"; value: string }
  | { kind: "checkbox"; checked: boolean }
  | { kind: "radio"; chosen: string | null }
  | { kind: "choice"; chosen: string[] };
