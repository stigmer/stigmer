"use strict";

/**
 * Text sizes picked by hand: the one matcher behind the
 * `text-size-from-scale` rule and the repository sweep that holds the faces
 * to the type scale. A size comes from a scale step (`text-2xs` to
 * `text-3xl`, each a --stgm-text-* token); an arbitrary length is a size
 * nobody can retune and the floor cannot see.
 *
 * Matched: a Tailwind class `text-[…]` whose value holds a length in any CSS
 * unit or a percentage (`text-[10px]`, `text-[8pt]`, `text-[60%]`,
 * `text-[clamp(9px,1vw,12px)]`, also written `text-[length:…]`), behind any
 * prefix or variant (`stg:md:text-[10px]`) and with or without a line-height
 * modifier (`text-[13px]/5`); and an inline style's string `fontSize` holding
 * such a value. Not matched: a size read from a variable (`text-[var(--x)]`,
 * `fontSize: "var(--x)"`), a colour (`text-[#333]`, `text-[rgb(…)]`), a
 * number (`fontSize: 14`, which pages rendered without the stylesheet use),
 * and colour classes (`text-muted-foreground`).
 */

/** A number with a CSS length unit or a percent sign, in any case. */
const LENGTH = String.raw`(?:\d+\.?\d*|\.\d+)(?:px|rem|em|pt|pc|cm|mm|in|q|vw|vh|vmin|vmax|vi|vb|dvh|svh|lvh|cqw|cqh|ch|ex|cap|ic|lh|rlh|%)(?![a-z])`;
/** An arbitrary value that is a colour, never a size. */
const COLOUR = /^(?:#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\(|color:)/i;
/** The value inside `text-[…]`, behind any prefix, variant or `!`, before an optional `/…` line height. */
const ARBITRARY_TEXT = /(?:^|:)!?text-\[([^\]\s]+)\](?:\/(?:\[[^\]\s]+\]|[\w.]+))?!?$/;
/** Every `text-[…]` class token in a stretch of source text, with its variants. */
const ARBITRARY_TEXT_IN_TEXT = /(?<![\w-])(?:[\w\[\]&>@=.-]*:)?!?text-\[[^\]\s]+\](?:\/(?:\[[^\]\s]+\]|[\w.]+))?!?/g;
/** A value that holds a length or a percentage somewhere (`10px`, `clamp(9px,1vw,12px)`). */
const HOLDS_LENGTH = new RegExp(LENGTH, "i");
/** An inline style's `fontSize` key followed by a quoted value, in source text. */
const FONT_SIZE_IN_TEXT = /\bfontSize\s*:\s*(["'`])([^"'`]*)\1/g;

/** True when an arbitrary value (the inside of `text-[…]`, or a style string) sets a size by hand. */
function isHandPickedSize(value) {
  const inner = value.replace(/^length:/, "");
  return !COLOUR.test(inner) && !/^var\(/.test(inner) && HOLDS_LENGTH.test(inner);
}

/** True when one class token sets an arbitrary length as the text size. */
function isArbitraryTextSize(className) {
  const match = ARBITRARY_TEXT.exec(className);
  return match !== null && isHandPickedSize(match[1]);
}

/** The class tokens in a string (a className, a cn() argument, a constant) that set an arbitrary text size. */
function arbitraryTextSizesIn(value) {
  return value.split(/\s+/).filter((token) => token !== "" && isArbitraryTextSize(token));
}

/** True when a style value (as written) sets a size by hand, the shape `fontSize` must not take. */
function isLengthValue(value) {
  return typeof value === "string" && isHandPickedSize(value.trim());
}

/**
 * Every hand-picked size in a file's source text, with its 1-based line:
 * the sweep's reading, which needs no parser and so reads every face alike.
 */
function findHandPickedSizes(source) {
  const findings = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(ARBITRARY_TEXT_IN_TEXT)) {
      if (isArbitraryTextSize(match[0])) findings.push({ line: index + 1, text: match[0] });
    }
    for (const match of line.matchAll(FONT_SIZE_IN_TEXT)) {
      if (isLengthValue(match[2])) findings.push({ line: index + 1, text: match[0] });
    }
  });
  return findings;
}

module.exports = { isArbitraryTextSize, arbitraryTextSizesIn, isLengthValue, findHandPickedSizes };
