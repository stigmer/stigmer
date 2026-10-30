"use strict";

/**
 * Refuses a theme fill painted as text. Some --stgm-* tokens are fills: a
 * badge's background, measured by the theme's contrast contract only under
 * its own foreground (`sdk/theme/src/contract/pairs.ts`). Drawn as text
 * straight on a page, card or dialog, such a fill is not a measured pair, and
 * the badge amber reads near 2:1 in light mode (stigmer#2776). Each refused
 * fill names the status text colour the contract measures on those surfaces.
 *
 * Every string in the file is read, not only `className`: a status-to-colour
 * map or a record's `colorClass` holds the class in an object literal, out of
 * a JSX attribute's reach. The utility is matched behind any variant or `!`,
 * with or without an opacity suffix (`no-token-opacity-modifiers` reports
 * that suffix too). A slug that only ends like the class (`my-text-warning`)
 * is left alone, because only the whole utility matches.
 *
 * A theme token in the wrong role, not a colour the theme cannot change:
 * that is `colours-from-tokens`' fence, kept apart so each message says one
 * thing.
 */

const { utilityOf } = require("../src/class-utility");

/** Each fill refused as text, and the measured text colour that replaces it. */
const FILL_TEXT = new Map([["text-warning", "text-status-degraded"]]);

/** The fill a class token paints as text, or undefined; an opacity suffix is ignored. */
function fillTextOf(className) {
  const utility = utilityOf(className);
  const slash = utility.indexOf("/");
  return FILL_TEXT.get(slash < 0 ? utility : utility.slice(0, slash));
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow a theme fill (a badge background token) painted as text",
    },
    messages: {
      fillAsText:
        '"{{ cls }}" paints a badge fill as text, a pair the theme\'s contrast contract does not measure and ' +
        'that reads poorly in light mode. Use "{{ replacement }}", the status text colour measured on the page, ' +
        "cards and dialogs (sdk/theme/src/contract/pairs.ts).",
    },
    schema: [],
  },

  create(context) {
    function checkString(value, node) {
      for (const cls of value.split(/\s+/)) {
        if (cls === "") continue;
        const replacement = fillTextOf(cls);
        if (replacement !== undefined) {
          context.report({ node, messageId: "fillAsText", data: { cls, replacement } });
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
