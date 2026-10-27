"use strict";

/**
 * Text sizes picked by hand: the one matcher behind the
 * `text-size-from-scale` rule and the repository sweep that holds the faces
 * to the type scale. A size comes from a scale step (`text-2xs` to
 * `text-3xl`, each a --stgm-text-* token); an arbitrary length is a size
 * nobody can retune and the floor cannot see.
 *
 * Matched: a Tailwind class `text-[<number><px|rem|em>]` (also written
 * `text-[length:…]`) behind any prefix or variant (`stg:md:text-[10px]`),
 * and an inline style's string `fontSize` holding a length. Not matched: a
 * size read from a variable (`text-[var(--x)]`, `fontSize: "var(--x)"`), a
 * number (`fontSize: 14`, which pages rendered without the stylesheet use),
 * and colour classes (`text-muted-foreground`).
 */

const LENGTH = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)`;

/** One class token, variants included, that sets an arbitrary length as the text size. */
const ARBITRARY_TEXT_SIZE = new RegExp(String.raw`(?:^|:)!?text-\[(?:length:)?${LENGTH}\]!?$`);

/** Every such class inside a stretch of source text, wherever it sits. */
const ARBITRARY_TEXT_SIZE_IN_TEXT = new RegExp(String.raw`(?<![\w-])(?:[\w\[\]&>@=.-]*:)?!?text-\[(?:length:)?${LENGTH}\]!?`, "g");

/** A style value that is a bare length. */
const LENGTH_VALUE = new RegExp(String.raw`^\s*${LENGTH}\s*$`);

/** An inline style's `fontSize` key followed by a quoted length, in source text. */
const FONT_SIZE_IN_TEXT = new RegExp(String.raw`\bfontSize\s*:\s*["'\`]\s*${LENGTH}\s*["'\`]`, "g");

/** True when one class token sets an arbitrary length as the text size. */
function isArbitraryTextSize(className) {
  return ARBITRARY_TEXT_SIZE.test(className);
}

/** The class tokens in a string (a className, a cn() argument, a constant) that set an arbitrary text size. */
function arbitraryTextSizesIn(value) {
  return value.split(/\s+/).filter((token) => token !== "" && isArbitraryTextSize(token));
}

/** True when a style value (as written) is a bare length, the shape `fontSize` must not take. */
function isLengthValue(value) {
  return typeof value === "string" && LENGTH_VALUE.test(value);
}

/**
 * Every hand-picked size in a file's source text, with its 1-based line:
 * the sweep's reading, which needs no parser and so reads every face alike.
 */
function findHandPickedSizes(source) {
  const findings = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(ARBITRARY_TEXT_SIZE_IN_TEXT)) {
      findings.push({ line: index + 1, text: match[0] });
    }
    for (const match of line.matchAll(FONT_SIZE_IN_TEXT)) {
      findings.push({ line: index + 1, text: match[0] });
    }
  });
  return findings;
}

module.exports = { isArbitraryTextSize, arbitraryTextSizesIn, isLengthValue, findHandPickedSizes };
