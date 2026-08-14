"use strict";

const { extractClassNames } = require("../src/class-extractor");

// The named reset for UI lists (sdk/react/src/internal/element-resets.ts).
const RESET_IDENTIFIER = "UNSTYLED_LIST";

/**
 * True when any Identifier named UNSTYLED_LIST is reachable from the
 * className attribute's value (covers `className={UNSTYLED_LIST}` and
 * `className={cn(UNSTYLED_LIST, ...)}`/template-literal compositions).
 */
function referencesResetIdentifier(node) {
  if (!node || typeof node !== "object") return false;

  if (node.type === "Identifier" && node.name === RESET_IDENTIFIER) {
    return true;
  }

  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      if (value.some((child) => referencesResetIdentifier(child))) return true;
    } else if (value && typeof value.type === "string") {
      if (referencesResetIdentifier(value)) return true;
    }
  }
  return false;
}

/** Strips Tailwind variant prefixes: `stg:last:list-none` -> `list-none`. */
function stripVariants(cls) {
  const parts = cls.split(":");
  return parts[parts.length - 1];
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every <ul>/<ol> to carry the UNSTYLED_LIST reset or an explicit list-* style (stigmer/stigmer#695)",
    },
    messages: {
      missingListReset:
        "<{{ element }}> declares no list style, so a host without a global CSS reset renders UA bullets " +
        "and ~40px of indent (invisible in the console, broken in third-party embeds — stigmer/stigmer#695). " +
        "UI lists: compose UNSTYLED_LIST from internal/element-resets.js into className. " +
        "Content lists (markdown): declare the style explicitly (stg:list-disc/stg:list-decimal with stg:pl-* and margins). " +
        "This cannot live in styles.css: a .stgm-scoped list reset would strip bullets off host content " +
        "when the host wraps its whole app in StigmerProvider.",
    },
    schema: [],
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          (node.name.name !== "ul" && node.name.name !== "ol")
        ) {
          return;
        }

        const classNameAttr = node.attributes.find(
          (attr) =>
            attr.type === "JSXAttribute" &&
            attr.name.type === "JSXIdentifier" &&
            attr.name.name === "className",
        );

        if (classNameAttr) {
          if (referencesResetIdentifier(classNameAttr.value)) return;

          const declaresListStyle = extractClassNames(classNameAttr).some(
            ({ className }) => stripVariants(className).startsWith("list-"),
          );
          if (declaresListStyle) return;
        }

        context.report({
          node,
          messageId: "missingListReset",
          data: { element: node.name.name },
        });
      },
    };
  },
};
