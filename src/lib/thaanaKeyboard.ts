// Phonetic Latin → Thaana transliteration for edit inputs.
//
// On mobile devices the soft keyboard is almost always in Latin layout —
// few users have a system Dhivehi keyboard installed. Without help, a
// user opens the editor, taps an existing Thaana run, and types `s`,
// `a`, `l`, … into a Faruma-styled input. Faruma has no glyphs for
// those Latin letters, so the field shows tofu / fallback fonts and
// looks broken.
//
// This module mirrors the well-known "Mahaa" QWERTY → Thaana keymap
// used by mihaaru.com, vaguthu.mv, and most Dhivehi sites: each Latin
// keystroke is rewritten to the corresponding Thaana codepoint before
// it lands in the field. The keymap is copied verbatim from Mihaaru's
// public bundle for muscle-memory parity.

import { useEffect, type RefObject } from "react";

/** QWERTY → Thaana keymap. Single-character entries; multi-byte values
 *  (e.g. ﷲ) are kept as strings. Latin chars not in the table pass
 *  through untouched (digits, space, etc). Bracket/paren entries are
 *  flipped on purpose so visually-mirrored RTL pairs come out right. */
export const THAANA_KEYMAP: Readonly<Record<string, string>> = {
  q: "ް",
  w: "އ",
  e: "ެ",
  r: "ރ",
  t: "ތ",
  y: "ޔ",
  u: "ު",
  i: "ި",
  o: "ޮ",
  p: "ޕ",
  a: "ަ",
  s: "ސ",
  d: "ދ",
  f: "ފ",
  g: "ގ",
  h: "ހ",
  j: "ޖ",
  k: "ކ",
  l: "ލ",
  z: "ޒ",
  x: "×",
  c: "ޗ",
  v: "ވ",
  b: "ބ",
  n: "ނ",
  m: "މ",
  Q: "ޤ",
  W: "ޢ",
  E: "ޭ",
  R: "ޜ",
  T: "ޓ",
  Y: "ޠ",
  U: "ޫ",
  I: "ީ",
  O: "ޯ",
  P: "÷",
  A: "ާ",
  S: "ށ",
  D: "ޑ",
  F: "ﷲ",
  G: "ޣ",
  H: "ޙ",
  J: "ޛ",
  K: "ޚ",
  L: "ޅ",
  Z: "ޡ",
  X: "ޘ",
  C: "ޝ",
  V: "ޥ",
  B: "ޞ",
  N: "ޏ",
  M: "ޟ",
  ",": "،",
  ";": "؛",
  "?": "؟",
  "<": ">",
  ">": "<",
  "[": "]",
  "]": "[",
  "(": ")",
  ")": "(",
  "{": "}",
  "}": "{",
};

export function thaanaForLatin(ch: string): string {
  return THAANA_KEYMAP[ch] ?? ch;
}

/** Cached lookup of the native HTMLInputElement value setter. We bypass
 *  React's synthetic value tracking by writing through this descriptor;
 *  dispatching a real `input` event afterwards lets the React-bound
 *  `onChange` / `onInput` pick the new value up via its event
 *  delegation. Standard pattern for "set a controlled input from
 *  outside React". */
function nativeInputValueSetter(el: HTMLInputElement, value: string): boolean {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked via .call below
  const setter = desc?.set;
  if (!setter) return false;
  setter.call(el, value);
  return true;
}

/** Attach a `beforeinput` listener to the referenced input that
 *  intercepts single-character Latin insertions and replaces them with
 *  their Thaana equivalent. Composition events (Android Gboard
 *  predictive input) are intentionally ignored — callers should also
 *  set `autoCorrect="off" autoComplete="off" autoCapitalize="none"
 *  spellCheck={false}` on the input so the soft keyboard stays in raw
 *  per-keystroke mode.
 *
 *  Gated by `enabled` so callers can scope it to mobile only. On
 *  desktop the user usually has a Dhivehi system keyboard or wants the
 *  flexibility to type mixed Latin/Thaana freely; transliteration there
 *  would get in the way. */
export function useThaanaTransliteration(
  inputRef: RefObject<HTMLInputElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const ev = e as InputEvent;
      // Only single-char keystrokes. IME composition, paste, autocorrect
      // replacements, and delete events all pass through untouched.
      if (ev.inputType !== "insertText") return;
      const data = ev.data;
      if (!data || data.length !== 1) return;
      const mapped = THAANA_KEYMAP[data];
      if (!mapped || mapped === data) return;
      ev.preventDefault();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const next = el.value.slice(0, start) + mapped + el.value.slice(end);
      const caret = start + mapped.length;
      if (!nativeInputValueSetter(el, next)) el.value = next;
      el.setSelectionRange(caret, caret);
      // Bubbles up so the React-bound onInput / onChange fires and
      // parent state stays in sync with the input's DOM value.
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    el.addEventListener("beforeinput", handler);
    return () => el.removeEventListener("beforeinput", handler);
  }, [inputRef, enabled]);
}
