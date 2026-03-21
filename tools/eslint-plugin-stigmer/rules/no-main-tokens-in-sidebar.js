"use strict";

const { extractClassNames } = require("../src/class-extractor");

const SIDEBAR_MARKERS = [
  "bg-sidebar",
  "text-sidebar-foreground",
  "text-sidebar-muted-foreground",
  "bg-sidebar-accent",
  "bg-sidebar-muted",
  "text-sidebar-accent-foreground",
  "border-sidebar-border",
  "hover:bg-sidebar-accent",
];

const MAIN_AREA_TOKENS = new Set([
  "bg-muted",
  "text-muted-foreground",
  "text-foreground",
  "bg-foreground",
  "bg-background",
  "bg-card",
  "text-card-foreground",
  "bg-popover",
  "text-popover-foreground",
  "border-border",
  "border-input",
  "bg-accent",
  "text-accent-foreground",
  "bg-secondary",
  "text-secondary-foreground",
]);

function stripModifiers(cls) {
  const parts = cls.split(":");
  return parts[parts.length - 1];
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow main content-area tokens in files that render within sidebar context",
    },
    messages: {
      mainTokenInSidebar:
        "\"{{ token }}\" uses a main content-area token inside a sidebar-context file. " +
        "Use sidebar-* equivalents (e.g. text-sidebar-muted-foreground, bg-sidebar-muted). " +
        "If this element is portaled outside the sidebar (dropdown content, dialog), " +
        "add an eslint-disable comment with justification.",
    },
    schema: [],
  },

  create(context) {
    let hasSidebarClasses = false;
    const pendingReports = [];

    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "className"
        ) {
          return;
        }

        const entries = extractClassNames(node);

        for (const { className: cls } of entries) {
          const base = stripModifiers(cls);
          if (SIDEBAR_MARKERS.some((m) => base === m || base.startsWith(m + "/"))) {
            hasSidebarClasses = true;
          }
        }

        for (const { className: cls, node: reportNode } of entries) {
          const base = stripModifiers(cls);
          if (MAIN_AREA_TOKENS.has(base)) {
            pendingReports.push({ node: reportNode, token: cls });
          }
        }
      },

      "Program:exit"() {
        if (!hasSidebarClasses) return;

        for (const { node: reportNode, token } of pendingReports) {
          context.report({
            node: reportNode,
            messageId: "mainTokenInSidebar",
            data: { token },
          });
        }
      },
    };
  },
};
