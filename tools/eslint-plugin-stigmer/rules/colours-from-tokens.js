"use strict";

/**
 * Refuses a colour the theme cannot change. Every colour comes from a
 * --stgm-* token, so a preset or a host's brand reaches every surface in light
 * and dark mode alike. Every string in the file is read, not only
 * `className`: colours also live in constants, cn() arguments, style objects
 * and the editor's theme tables. Two shapes are refused:
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
 *
 * Not yet refused: Tailwind's built-in palette (`bg-blue-500`, `text-white`).
 * stigmer#2763 moves the SDK's last uses onto tokens and adds that
 * shape here once the sweep reaches zero.
 */

/** A read of a --stgm-* token followed by a fallback. */
const TOKEN_FALLBACK = /var\(\s*--stgm-([\w-]+)\s*,/g;
/** An arbitrary value that is a colour, with or without Tailwind's `color:` type hint. */
const COLOUR_VALUE = /^(?:color:)?(?:#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\()/i;

/**
 * The utility of one class token: what follows the last `:` outside
 * brackets, so variants (`stg:hover:`, `[&>p]:`, `has-[#id]:`) are dropped
 * and a value holding `:` (`color:#fff`) is kept. A scan, not a pattern, so
 * no input makes it backtrack.
 */
function utilityOf(className) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < className.length; i += 1) {
    const ch = className[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return className.slice(start).replace(/^!/, "");
}

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

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow colours the theme cannot change: a fallback on a --stgm-* token, or a Tailwind arbitrary colour",
    },
    messages: {
      fallback:
        '"var(--stgm-{{ name }}, …)" names a fallback that never paints: the SDK\'s stylesheet declares every --stgm-* token. ' +
        'Read the token alone, "var(--stgm-{{ name }})", or its utility class.',
      arbitraryColour:
        '"{{ cls }}" paints a colour no theme can change. Use a semantic utility instead (bg-primary, bg-border, ' +
        "bg-avatar, text-muted-foreground, ...), or add the missing token to the theme.",
    },
    schema: [],
  },

  create(context) {
    function checkString(value, node) {
      for (const match of value.matchAll(TOKEN_FALLBACK)) {
        context.report({ node, messageId: "fallback", data: { name: match[1] } });
      }
      for (const cls of value.split(/\s+/)) {
        if (cls !== "" && isArbitraryColour(cls)) {
          context.report({ node, messageId: "arbitraryColour", data: { cls } });
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
