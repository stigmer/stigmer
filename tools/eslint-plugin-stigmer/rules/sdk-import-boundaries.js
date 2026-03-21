"use strict";

const path = require("path");

const CONSOLE_IMPORT_PATTERNS = [
  /^next\//,
  /^next$/,
  /^next-themes/,
  /^@\/contexts\//,
  /^@\/components\//,
  /^@\/auth/,
  /^@\/app\//,
];

const SDK_DIR_MARKERS = ["sdk/react", "sdk/theme", "sdk/typescript"];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent SDK packages from importing Console-specific modules (Next.js, app auth, routing)",
    },
    messages: {
      consoleImportInSdk:
        "SDK packages must not import \"{{ source }}\". " +
        "This is a Console-specific module. SDK packages must have zero dependencies " +
        "on Next.js routing, Console auth, or app shell components.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename || context.getFilename();
    const normalized = filename.replace(/\\/g, "/");

    const isInSdk = SDK_DIR_MARKERS.some((marker) =>
      normalized.includes(`/${marker}/`)
    );

    if (!isInSdk) return {};

    function checkSource(node) {
      const source = node.source?.value;
      if (!source) return;

      for (const pattern of CONSOLE_IMPORT_PATTERNS) {
        if (pattern.test(source)) {
          context.report({
            node: node.source,
            messageId: "consoleImportInSdk",
            data: { source },
          });
          return;
        }
      }
    }

    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
    };
  },
};
