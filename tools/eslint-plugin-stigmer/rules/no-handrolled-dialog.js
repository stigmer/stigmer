"use strict";

// The SDK has one dialog shell: internal/DialogShell.tsx owns the <dialog>
// element, its showModal()/close() lifecycle, cancel/Escape wiring, the
// --stgm-backdrop token, the open animation, and the base chrome. Before the
// stigmer#653 sweep those were re-transcribed across 24 hand-rolled shells
// and had drifted (two hardcoded backdrops, three background tokens, split
// radius/shadow, animation present-or-absent). This fence keeps the class
// dead: a new <dialog> element belongs inside DialogShell, everywhere else
// renders <DialogShell>.
//
// Base UI's Dialog and AlertDialog are the same bypass by another road: a
// modal with its own lifecycle, backdrop and chrome beside the shell's
// (stigmer#2772). They are refused by subpath and by name from the package
// root, which re-exports both; the shell's own file gets no exemption here,
// since the shell is a native <dialog>.

const SHELL_FILE_SUFFIX = "internal/DialogShell.tsx";

const BASE_UI_ROOT = "@base-ui/react";
const BASE_UI_DIALOG_SUBPATHS = new Set([
  "@base-ui/react/dialog",
  "@base-ui/react/alert-dialog",
]);
const BASE_UI_DIALOG_NAMES = new Set(["Dialog", "AlertDialog"]);

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require the shared DialogShell primitive instead of hand-rolled <dialog> elements or Base UI dialogs",
    },
    messages: {
      handrolledDialog:
        "Hand-rolled <dialog> element. Render the internal DialogShell " +
        "primitive instead (sdk/react/src/internal/DialogShell.tsx) — it owns " +
        "the showModal lifecycle, cancel/Escape wiring, the --stgm-backdrop " +
        "token, the open animation, and the base chrome, so dialogs cannot " +
        "drift apart again (stigmer#653).",
      baseUiDialog:
        "Base UI dialog import (\"{{ source }}\"). Render the internal " +
        "DialogShell primitive instead (sdk/react/src/internal/DialogShell.tsx): " +
        "the kit has one dialog shell, so a modal's lifecycle, backdrop and " +
        "chrome cannot drift apart (stigmer#653, stigmer#2772).",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    const isShellFile = filename.replaceAll("\\", "/").endsWith(SHELL_FILE_SUFFIX);

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (BASE_UI_DIALOG_SUBPATHS.has(source)) {
          context.report({ node, messageId: "baseUiDialog", data: { source } });
          return;
        }
        if (source !== BASE_UI_ROOT) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            BASE_UI_DIALOG_NAMES.has(specifier.imported.name)
          ) {
            context.report({
              node: specifier,
              messageId: "baseUiDialog",
              data: { source },
            });
          }
        }
      },
      JSXOpeningElement(node) {
        if (isShellFile) return;
        if (node.name.type === "JSXIdentifier" && node.name.name === "dialog") {
          context.report({ node, messageId: "handrolledDialog" });
        }
      },
    };
  },
};
