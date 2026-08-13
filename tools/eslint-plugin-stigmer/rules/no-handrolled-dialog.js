"use strict";

// The SDK has one dialog shell: internal/DialogShell.tsx owns the <dialog>
// element, its showModal()/close() lifecycle, cancel/Escape wiring, the
// --stgm-backdrop token, the open animation, and the base chrome. Before the
// stigmer#653 sweep those were re-transcribed across 24 hand-rolled shells
// and had drifted (two hardcoded backdrops, three background tokens, split
// radius/shadow, animation present-or-absent). This fence keeps the class
// dead: a new <dialog> element belongs inside DialogShell, everywhere else
// renders <DialogShell>.

const SHELL_FILE_SUFFIX = "internal/DialogShell.tsx";

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require the shared DialogShell primitive instead of hand-rolled <dialog> elements",
    },
    messages: {
      handrolledDialog:
        "Hand-rolled <dialog> element. Render the internal DialogShell " +
        "primitive instead (sdk/react/src/internal/DialogShell.tsx) — it owns " +
        "the showModal lifecycle, cancel/Escape wiring, the --stgm-backdrop " +
        "token, the open animation, and the base chrome, so dialogs cannot " +
        "drift apart again (stigmer#653).",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (filename.replaceAll("\\", "/").endsWith(SHELL_FILE_SUFFIX)) {
      return {};
    }

    return {
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "dialog") {
          context.report({ node, messageId: "handrolledDialog" });
        }
      },
    };
  },
};
