"use strict";

// The kit has one field: sdk/react/src/internal/form/ draws every text box,
// multi-line box, select, checkbox, radio, file input and their label, hint
// and error, at the button's sizes (32px at 14/20, 28px at 12/16), so a field
// and the button beside it line up and a field's error sits under its own
// field. Before the 2026-11 sweep, about 200 raw <input>, <textarea> and
// <select> elements in 100 files drew three input sizes and three label
// styles, and their errors were one red line at a form's foot. This fence
// keeps the class dead: a raw <input>, <textarea> or <select> is drawn only
// inside internal/form/, everywhere else renders the parts.
//
// A hidden input (`type="hidden"`) carries a value, not a field, so it stays
// allowed. A test builds raw elements as fixtures, so a test file is not
// fenced. A raw element that must stay (a box whose look a passed design
// owns) says why on an `eslint-disable-next-line` line.

const FORM_FOLDER = "/sdk/react/src/internal/form/";
const FIELDS = new Set(["input", "textarea", "select"]);
const TEST_FILE = /(\/__tests__\/|\.test\.[cm]?[jt]sx?$)/;

/** The literal `type` of an <input>, or null when it is not a plain string. */
function literalType(node) {
  for (const attribute of node.attributes) {
    if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier" || attribute.name.name !== "type") continue;
    if (attribute.value?.type === "Literal" && typeof attribute.value.value === "string") return attribute.value.value;
    if (attribute.value?.type === "JSXExpressionContainer" && attribute.value.expression.type === "Literal") return String(attribute.value.expression.value);
    return null;
  }
  return null;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require the kit's field parts (sdk/react/src/internal/form/) instead of raw <input>, <textarea> and <select> elements",
    },
    messages: {
      handrolledField:
        "Raw <{{ element }}>. Render the kit's field parts instead " +
        "(sdk/react/src/internal/form/: Field, TextInput, TextArea, Select, Checkbox, " +
        "ChoiceGroup, FileDrop, HiddenFileInput): they draw a field at the button's " +
        "size and wire its label, hint and error, so fields cannot drift apart again.",
    },
    schema: [],
  },

  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(/\\/g, "/");
    if (filename.includes(FORM_FOLDER) || TEST_FILE.test(filename)) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !FIELDS.has(node.name.name)) return;
        if (node.name.name === "input" && literalType(node) === "hidden") return;
        context.report({ node, messageId: "handrolledField", data: { element: node.name.name } });
      },
    };
  },
};
