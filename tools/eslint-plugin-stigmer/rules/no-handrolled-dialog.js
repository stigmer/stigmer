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
// An element that only says it is a dialog (`role="dialog"` or
// `role="alertdialog"` on a div) is the same bypass a third way: it has none
// of the shell's focus trap, Escape wiring or top layer, so assistive
// technology is told "dialog" about something that does not behave as one.
// It is refused on a plain HTML element anywhere but the shell's file; a
// component that sets its own role (a Base UI popover's popup) owns its own
// focus and is left alone.
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
const DIALOG_ROLES = new Set(["dialog", "alertdialog"]);

/** The role an element's `role` attribute names, when it is a plain string. */
function staticRole(node) {
  for (const attribute of node.attributes) {
    if (attribute.type !== "JSXAttribute" || attribute.name.name !== "role" || !attribute.value) continue;
    if (attribute.value.type === "Literal" && typeof attribute.value.value === "string") return attribute.value.value;
    const expression = attribute.value.type === "JSXExpressionContainer" ? attribute.value.expression : null;
    if (expression && expression.type === "Literal" && typeof expression.value === "string") return expression.value;
    if (expression && expression.type === "TemplateLiteral" && expression.expressions.length === 0) return expression.quasis[0].value.cooked;
  }
  return null;
}

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
      handrolledRole:
        "An element given role=\"{{ role }}\" acts as a dialog it is not: it has " +
        "none of the shell's focus trap, Escape wiring or top layer. Render the " +
        "internal DialogShell primitive with DialogHeader, DialogBody and " +
        "DialogFooter instead (sdk/react/src/internal/DialogShell.tsx).",
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
          return;
        }
        // Only a plain HTML element: a component (a Base UI popover's popup)
        // sets its own role and owns its own focus.
        if (node.name.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name)) return;
        const role = staticRole(node);
        if (role !== null && DIALOG_ROLES.has(role)) {
          context.report({ node, messageId: "handrolledRole", data: { role } });
        }
      },
    };
  },
};
