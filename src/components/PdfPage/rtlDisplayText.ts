const RTL_TEXT_RE = /[\u0590-\u05ff\u0600-\u06ff\u0780-\u07bf]/u;
const RTL_STRONG_OR_DIGIT = "[\\d\\u0590-\\u05ff\\u0600-\\u06ff\\u0780-\\u07bf]";
const RTL_NUMBER_GROUP_RE = /\d+(?:[/:]\d+)+/gu;
const RTL_SEPARATOR_NUMBER_GAP_RE = /([/:])\s+(?=\d)/gu;
const RTL_OPEN_PUNCTUATION_INNER_GAP_RE = new RegExp(
  `(\\p{P})\\s+(?=${RTL_STRONG_OR_DIGIT})`,
  "gu",
);
const RTL_PRE_PUNCTUATION_GAP_RE = new RegExp(`(${RTL_STRONG_OR_DIGIT})\\s+(\\p{P})`, "gu");
const RTL_OPEN_PUNCTUATION_RE = /^[\p{Ps}\p{Pi}]$/u;
const RTL_TRAILING_LIST_DOT_RE = /^(\s*)(\d+)(\s+)([\s\S]*?)(\s*)\.$/u;
const RTL_LEADING_SECTION_MARKER_RE = /^(\s*)\.(\d)(\d)(\s+)/u;

function reverseSingleSeparatorNumberGroup(value: string): string {
  const separators = [...value.matchAll(/[/:]/gu)].map((match) => match[0]);
  if (new Set(separators).size !== 1) return value;
  const separator = separators[0];
  return value.split(separator).reverse().join(separator);
}

function tightenRtlPunctuationSpacing(line: string): string {
  return line
    .replace(RTL_OPEN_PUNCTUATION_INNER_GAP_RE, (match, punct: string) =>
      RTL_OPEN_PUNCTUATION_RE.test(punct) ? punct : match,
    )
    .replace(RTL_PRE_PUNCTUATION_GAP_RE, (match, lead: string, punct: string) =>
      RTL_OPEN_PUNCTUATION_RE.test(punct) ? match : `${lead}${punct}`,
    );
}

export function displayTextForEditor(text: string, rtl: boolean): string {
  if (!rtl) return text;
  return text
    .split("\n")
    .map((line) => {
      const withTightSeparatorNumbers = line.replace(RTL_SEPARATOR_NUMBER_GAP_RE, "$1");
      const withNumberGroups = withTightSeparatorNumbers.replace(RTL_NUMBER_GROUP_RE, (value) =>
        reverseSingleSeparatorNumberGroup(value),
      );
      const withTightPunctuation = tightenRtlPunctuationSpacing(withNumberGroups);
      const withSectionMarker = withTightPunctuation.replace(
        RTL_LEADING_SECTION_MARKER_RE,
        (_match, lead: string, major: string, minor: string, gap: string) =>
          `${lead}${minor}-${major}${gap}`,
      );
      const match = RTL_TRAILING_LIST_DOT_RE.exec(withSectionMarker);
      if (!match || !RTL_TEXT_RE.test(match[4])) return withSectionMarker;
      const [, lead, marker, gap, body, tailSpace] = match;
      return `${lead}.${marker}${gap}${body}${tailSpace}`;
    })
    .join("\n");
}
