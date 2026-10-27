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

/** The CSS length units, and `%`, a size can be written in. */
const UNITS = new Set(["px", "rem", "em", "pt", "pc", "cm", "mm", "in", "q", "vw", "vh", "vmin", "vmax", "vi", "vb", "dvh", "svh", "lvh", "cqw", "cqh", "ch", "ex", "cap", "ic", "lh", "rlh", "%"]);
/** An arbitrary value that is a colour, never a size. */
const COLOUR = /^(?:#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\(|color:)/i;
/** What may follow `text-[…]`: a line-height modifier, `/5` or `/[14px]`. Anchored both ends. */
const LINE_HEIGHT_MODIFIER = /^\/(?:\[[^\]]*\]|[\w.]+)$/;
/** Where source text splits into candidate class tokens: whitespace and quotes. */
const TOKEN_BREAK = /[\s"'`]+/;
/** An inline style's `fontSize` key followed by a quoted value, in source text. */
const FONT_SIZE_IN_TEXT = /\bfontSize\s*:\s*(["'`])([^"'`]*)\1/g;

/** True when an arbitrary value (the inside of `text-[…]`, or a style string) sets a size by hand. */
function isHandPickedSize(value) {
  const inner = value.replace(/^length:/, "");
  return !COLOUR.test(inner) && !/^var\(/.test(inner) && holdsLength(inner);
}

/**
 * True when a value holds a number followed by a length unit or `%`
 * (`10px`, `clamp(9px,1vw,12px)`), in any case. One pass over the value: each
 * number is read once, then the letters after it, so no input makes it slow.
 */
function holdsLength(value) {
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let sawDigit = false;
      while (i < value.length && ((value[i] >= "0" && value[i] <= "9") || value[i] === ".")) {
        if (value[i] !== ".") sawDigit = true;
        i += 1;
      }
      let unit = "";
      while (i < value.length && (/[a-z%]/i.test(value[i]))) {
        unit += value[i].toLowerCase();
        i += 1;
        if (unit === "%") break;
      }
      if (sawDigit && UNITS.has(unit)) return true;
    } else {
      i += 1;
    }
  }
  return false;
}

/** True when one class token sets an arbitrary length as the text size. */
function isArbitraryTextSize(className) {
  // The utility is what follows the last `:` outside brackets: variants come
  // before it (`stg:md:`, `[&>p]:`), and a value may hold `:` (`length:1em`).
  // A scan, not a pattern, so no input makes it backtrack.
  let depth = 0;
  let start = 0;
  for (let i = 0; i < className.length; i += 1) {
    const ch = className[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  let utility = className.slice(start);
  if (utility.startsWith("!")) utility = utility.slice(1);
  if (utility.endsWith("!")) utility = utility.slice(0, -1);
  if (!utility.startsWith("text-[")) return false;
  const close = utility.indexOf("]");
  if (close < 0) return false;
  const rest = utility.slice(close + 1);
  if (rest !== "" && !LINE_HEIGHT_MODIFIER.test(rest)) return false;
  return isHandPickedSize(utility.slice("text-[".length, close));
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
    for (const token of line.split(TOKEN_BREAK)) {
      if (token.includes("text-[") && isArbitraryTextSize(token)) findings.push({ line: index + 1, text: token });
    }
    for (const match of line.matchAll(FONT_SIZE_IN_TEXT)) {
      if (isLengthValue(match[2])) findings.push({ line: index + 1, text: match[0] });
    }
  });
  return findings;
}

module.exports = { isArbitraryTextSize, arbitraryTextSizesIn, isLengthValue, findHandPickedSizes };
