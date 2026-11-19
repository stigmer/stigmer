"use strict";

// The kit has one code block: sdk/react/src/internal/CodeBlock.tsx draws every
// block of code or command text (an agent's YAML, a file's source in a
// session, a routine's curl, an embed snippet, a Slack manifest) in mono on
// the type scale, each size with the line height its step pairs (11 and 12px
// on 16px lines, 14px on 20px). Before 2026-11 the kit drew code six
// different ways, five of them on a loose 1.625 line that sits off the scale,
// and the layout audit listed each one as its own break. This fence keeps the
// class dead: a `<pre>` whose own classes set the mono face is drawn only by
// the code block, and everywhere else renders it.
//
// A `<pre>` that takes its classes from a shared constant (the session's step
// box, `STEP_INSET`) is that constant's to keep on the scale, so only literal
// classes are read. A test builds raw elements as fixtures, so a test file is
// not fenced.

const { extractClassNames } = require("../src/class-extractor");

const CODE_BLOCK_FILE = "/sdk/react/src/internal/CodeBlock.tsx";
const TEST_FILE = /(\/__tests__\/|\.test\.[cm]?[jt]sx?$)/;
const MONO = /^(?:[a-z0-9-]+:)*font-mono$/;

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require the kit's code block (sdk/react/src/internal/CodeBlock.tsx) instead of a hand-drawn mono <pre>",
    },
    messages: {
      handrolledCodeBlock:
        "Hand-drawn code block: a <pre> with font-mono. Render the kit's CodeBlock instead " +
        "(sdk/react/src/internal/CodeBlock.tsx): it draws code in mono on the type scale, " +
        "each size on its paired line, so code cannot drift apart between screens again.",
    },
    schema: [],
  },

  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(/\\/g, "/");
    if (filename.endsWith(CODE_BLOCK_FILE) || TEST_FILE.test(filename)) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "pre") return;
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier" || attribute.name.name !== "className") continue;
          if (extractClassNames(attribute).some(({ className }) => MONO.test(className))) {
            context.report({ node, messageId: "handrolledCodeBlock" });
            return;
          }
        }
      },
    };
  },
};
