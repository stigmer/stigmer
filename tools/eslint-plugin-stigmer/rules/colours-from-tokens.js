"use strict";

/**
 * Refuses a colour the theme cannot change. Every colour comes from a
 * --stgm-* token, so a preset or a host's brand reaches every surface in light
 * and dark mode alike. Every string in the file is read, not only
 * `className`: colours also live in constants, cn() arguments, style objects
 * and the editor's theme tables. Three shapes are refused:
 *
 * - a fallback on a token, `var(--stgm-border, #e5e5e5)`. The SDK's own
 *   stylesheet imports every --stgm-* token onto `:root`, so the fallback can
 *   never paint; it reads as if the theme might be missing and gets copied. A
 *   fallback on another variable (`var(--font-geist-sans, system-ui)`, a host
 *   hook) is left alone.
 * - a Tailwind arbitrary colour, `bg-[#6366f1]`, `text-[oklch(…)]`,
 *   `[color:#fff]`, behind any prefix or variant. A value read from a token
 *   (`bg-[var(--stgm-x)]`) and a non-colour value (`ml-[18px]`) are left
 *   alone.
 * - a colour from Tailwind's built-in palette, `bg-blue-500`, `text-white`,
 *   `stg:dark:hover:border-x-amber-200/30`, behind any prefix or variant. The
 *   palette is fixed hues: a preset cannot restyle it and dark mode does not
 *   adapt it. Only a colour utility's prefix starts a match, so a slug or an
 *   id that ends the same way (`team-red-500`) is left alone.
 */

const { utilityOf } = require("../src/class-utility");

/** A read of a --stgm-* token followed by a fallback. */
const TOKEN_FALLBACK = /var\(\s*--stgm-([\w-]+)\s*,/g;
/** An arbitrary value that is a colour, with or without Tailwind's `color:` type hint. */
const COLOUR_VALUE = /^(?:color:)?(?:#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\()/i;
/**
 * A utility painting a Tailwind palette colour: a colour prefix, then a
 * `<hue>-<shade>` or `white`/`black`, then an optional opacity. The prefixes,
 * hues and shades are Tailwind 4.2.1's, measured by loading its design system
 * and listing every class that ends in `-red-500` or `-white`; a Tailwind
 * upgrade that adds a colour utility adds its prefix here. Alternations of
 * fixed words with no nested quantifier, so the match is linear.
 */
const PALETTE_COLOUR = new RegExp(
  "^(?:" +
    [
      "accent", "bg", "border", "border-(?:x|y|t|r|b|l|s|e|bs|be)", "caret", "decoration", "divide",
      "drop-shadow", "fill", "from", "via", "to", "inset-ring", "inset-shadow", "outline", "placeholder",
      "ring", "ring-offset", "shadow", "stroke", "text", "text-shadow",
      "mask-(?:t|r|b|l|x|y|linear|radial|conic)-(?:from|to)",
    ].join("|") +
    ")-(?:(?:" +
    [
      "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo",
      "violet", "purple", "fuchsia", "pink", "rose", "slate", "gray", "zinc", "neutral", "stone", "mauve",
      "olive", "mist", "taupe",
    ].join("|") +
    ")-(?:50|[1-9]00|950)|white|black)(?:/(?:\\d+|\\[[^\\]]*\\]|\\([^)]*\\)))?$",
);

/**
 * True when one class token paints an arbitrary colour: an arbitrary value
 * (`bg-[#fff]`) or an arbitrary property (`[color:#fff]`).
 */
function isArbitraryColour(className) {
  const utility = utilityOf(className);
  if (utility.startsWith("[")) {
    const colon = utility.indexOf(":");
    return colon > 0 && COLOUR_VALUE.test(utility.slice(colon + 1));
  }
  const open = utility.indexOf("-[");
  return open >= 0 && COLOUR_VALUE.test(utility.slice(open + 2));
}

/** True when one class token paints a colour from Tailwind's built-in palette. */
function isPaletteColour(className) {
  return PALETTE_COLOUR.test(utilityOf(className));
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow colours the theme cannot change: a fallback on a --stgm-* token, a Tailwind arbitrary colour, or a Tailwind palette colour",
    },
    messages: {
      fallback:
        '"var(--stgm-{{ name }}, …)" names a fallback that never paints: the SDK\'s stylesheet declares every --stgm-* token. ' +
        'Read the token alone, "var(--stgm-{{ name }})", or its utility class.',
      arbitraryColour:
        '"{{ cls }}" paints a colour no theme can change. Use a semantic utility instead (bg-primary, bg-border, ' +
        "bg-avatar, text-muted-foreground, ...), or add the missing token to the theme.",
      paletteColour:
        '"{{ cls }}" paints a fixed Tailwind palette colour that no theme or dark mode can change. Use a semantic ' +
        "utility instead (bg-primary, text-primary-foreground, bg-muted, bg-avatar, text-muted-foreground, ...), " +
        "or for a status the status family (bg-status-degraded-subtle, text-status-degraded, ...).",
    },
    schema: [],
  },

  create(context) {
    function checkString(value, node) {
      for (const match of value.matchAll(TOKEN_FALLBACK)) {
        context.report({ node, messageId: "fallback", data: { name: match[1] } });
      }
      for (const cls of value.split(/\s+/)) {
        if (cls === "") continue;
        if (isArbitraryColour(cls)) {
          context.report({ node, messageId: "arbitraryColour", data: { cls } });
        } else if (isPaletteColour(cls)) {
          context.report({ node, messageId: "paletteColour", data: { cls } });
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") checkString(node.value, node);
      },
      TemplateElement(node) {
        checkString(node.value.cooked ?? node.value.raw, node);
      },
    };
  },
};
