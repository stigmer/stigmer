"use strict";

const { arbitraryTextSizesIn, isLengthValue } = require("../src/text-size");

/**
 * Refuses a text size picked by hand. Every size comes from the type scale
 * (`text-2xs` to `text-3xl`, the --stgm-text-* tokens), so a preset can
 * retune it and nothing falls under the scale's 11px floor. Every string in
 * the file is read, not only `className`: sizes also live in constants,
 * variant tables and cn() arguments.
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hand-picked text sizes; use a type-scale step (text-2xs to text-3xl)",
    },
    messages: {
      arbitraryClass:
        '"{{ cls }}" picks a text size by hand. Use a type-scale step instead (text-2xs, text-xs, text-sm, ...): ' +
        "each reads a --stgm-text-* token, and text-2xs (11px) is the smallest.",
      lengthFontSize:
        'fontSize "{{ value }}" picks a text size by hand. Read a scale token instead, e.g. "var(--stgm-text-sm)".',
    },
    schema: [],
  },

  create(context) {
    function checkString(value, node) {
      for (const cls of arbitraryTextSizesIn(value)) {
        context.report({ node, messageId: "arbitraryClass", data: { cls } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") checkString(node.value, node);
      },
      TemplateElement(node) {
        checkString(node.value.raw, node);
      },
      Property(node) {
        const key = node.key.type === "Identifier" ? node.key.name : node.key.type === "Literal" ? node.key.value : null;
        if (key !== "fontSize") return;
        const value =
          node.value.type === "Literal"
            ? node.value.value
            : node.value.type === "TemplateLiteral" && node.value.expressions.length === 0
              ? node.value.quasis[0].value.cooked
              : null;
        if (isLengthValue(value)) {
          context.report({ node: node.value, messageId: "lengthFontSize", data: { value } });
        }
      },
    };
  },
};
