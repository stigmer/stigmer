"use strict";

const { extractClassNames } = require("../src/class-extractor");

// The theme ships a designed backdrop token (--stgm-backdrop, mapped to
// bg-backdrop) with distinct light/dark values in every preset. Before the
// oss#373 sweep, dialogs hardcoded `backdrop:bg-black/50` instead — and the
// class GREW from ~12 to 21 files between the issue's filing and the sweep,
// which is why this fence exists: a hardcoded scrim silently exempts itself
// from preset theming (a light-mode host gets a black scrim where the theme
// specifies a translucent near-white one).

const BACKDROP_VARIANT = "backdrop";
const ALLOWED_UTILITY = "bg-backdrop";

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
          const parts = cls.split(":");
          if (parts.length < 2) continue;

          const utility = parts[parts.length - 1];
          const variants = parts.slice(0, -1);

          if (!variants.includes(BACKDROP_VARIANT)) continue;
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
