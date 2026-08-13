"use strict";

const { extractClassNames } = require("../src/class-extractor");

// The theme ships a designed backdrop token (--stgm-backdrop, mapped to
// bg-backdrop) with distinct light/dark values in every preset. Before the
// oss#373 sweep, dialogs hardcoded `backdrop:bg-black/50` instead — and the
// class GREW from ~12 to 21 files between the issue's filing and the sweep,
// which is why this fence exists: a hardcoded scrim silently exempts itself
// from preset theming (a light-mode host gets a black scrim where the theme
// specifies a translucent near-white one).

// Both spellings of the ::backdrop variant: the named Tailwind variant and
// the arbitrary-selector form. The #652 sweep fenced only the named variant,
// and two hardcoded scrims survived unseen as `[&::backdrop]:bg-black/50`
// and `/60` until the #653 dialog-shell sweep found them.
const BACKDROP_VARIANTS = new Set(["backdrop", "[&::backdrop]"]);
const ALLOWED_UTILITY = "bg-backdrop";

/**
 * Split a class into its variant segments + utility, treating `:` inside
 * square brackets as content, not a separator — `stg:[&::backdrop]:bg-x`
 * yields ["stg", "[&::backdrop]", "bg-x"], where a naive split would shred
 * the arbitrary selector on its own `::`.
 */
function splitSegments(cls) {
  const segments = [];
  let current = "";
  let depth = 0;
  for (const ch of cls) {
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    if (ch === ":" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);
  return segments;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require the --stgm-backdrop token (backdrop:bg-backdrop) for dialog ::backdrop colors",
    },
    messages: {
      hardcodedBackdrop:
        '"{{ cls }}" hardcodes the dialog backdrop color. ' +
        "The theme ships a designed backdrop token with per-preset light/dark values — " +
        'use "backdrop:bg-backdrop" (--stgm-backdrop) so presets keep control of the scrim.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "className"
        ) {
          return;
        }

        const entries = extractClassNames(node);

        for (const { className: cls, node: reportNode } of entries) {
          const parts = splitSegments(cls);
          if (parts.length < 2) continue;

          const utility = parts[parts.length - 1];
          const variants = parts.slice(0, -1);

          if (!variants.some((v) => BACKDROP_VARIANTS.has(v))) continue;
          if (!utility.startsWith("bg-")) continue;
          // Opacity modifiers on the token itself (bg-backdrop/50) are the
          // no-token-opacity-modifiers rule's report, not a hardcoded color.
          if (utility === ALLOWED_UTILITY || utility.startsWith(`${ALLOWED_UTILITY}/`)) {
            continue;
          }

          context.report({
            node: reportNode,
            messageId: "hardcodedBackdrop",
            data: { cls },
          });
        }
      },
    };
  },
};
