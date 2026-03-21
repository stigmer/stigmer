"use strict";

const { extractClassNames } = require("../src/class-extractor");

const TOKEN_COLOR_PREFIXES = [
  "bg-background",
  "bg-foreground",
  "bg-card",
  "bg-muted",
  "bg-accent",
  "bg-primary",
  "bg-secondary",
  "bg-destructive",
  "bg-sidebar",
  "bg-sidebar-foreground",
  "bg-sidebar-primary",
  "bg-sidebar-muted",
  "bg-sidebar-accent",
  "text-foreground",
  "text-muted-foreground",
  "text-card-foreground",
  "text-popover-foreground",
  "text-primary",
  "text-primary-foreground",
  "text-secondary-foreground",
  "text-accent-foreground",
  "text-destructive",
  "text-destructive-foreground",
  "text-sidebar-foreground",
  "text-sidebar-primary",
  "text-sidebar-primary-foreground",
  "text-sidebar-muted-foreground",
  "text-sidebar-accent-foreground",
  "border-border",
  "border-input",
  "border-sidebar-border",
  "ring-ring",
  "ring-sidebar-ring",
];

const OPACITY_PATTERN = /\/\d+$/;

function stripModifiers(cls) {
  const parts = cls.split(":");
  return parts[parts.length - 1];
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow Tailwind opacity modifiers (e.g. /60) on design-token color classes",
    },
    messages: {
      opacityOnToken:
        "\"{{ cls }}\" applies an opacity modifier to a design-token color. " +
        "Opacity modifiers bypass the theme system — each preset cannot control this value. " +
        "Use a dedicated --stgm-* token instead (e.g. text-sidebar-muted-foreground instead of text-sidebar-foreground/60).",
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
          const base = stripModifiers(cls);

          if (!OPACITY_PATTERN.test(base)) continue;

          const withoutOpacity = base.replace(OPACITY_PATTERN, "");

          if (TOKEN_COLOR_PREFIXES.some((prefix) => withoutOpacity === prefix)) {
            context.report({
              node: reportNode,
              messageId: "opacityOnToken",
              data: { cls },
            });
          }
        }
      },
    };
  },
};
