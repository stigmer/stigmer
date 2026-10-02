"use strict";

// The SDK has one container for a labelled loading region:
// internal/LoadingRegion.tsx marks the region busy and names it with visually
// hidden text. axe's `aria-prohibited-attr` (WCAG 4.1.2) refuses a name on an
// element whose role takes none, so a labelled skeleton built as a bare `div`
// fails every page audit it is on screen for (stigmer#1653); role="status"
// would make the label legal but is the role this console's phase badges,
// empty states and notices carry.
//
// So a DOM element that is busy (aria-busy fixed true: `"true"`, `{true}`, or
// the bare attribute) and labelled (a non-empty aria-label or
// aria-labelledby) is reported, and renders <LoadingRegion label="...">
// instead, in exactly two cases:
//   - it has no role written (no attribute, or a fixed empty one), and its tag
//     is one axe refuses a name on: the list in
//     sdk/react/src/internal/loading-region-markup.json, which sdk/react's
//     loading-region-markup.browser.test.ts proves equal to axe-core in a real
//     Chromium, so an axe upgrade that moves the line fails that suite;
//   - its role is written exactly "status".
//
// That is all it reads; axe's audits (the SDK's a11y browser suites, the
// console's e2e page audits) are the complete check. Left to them: any other
// written role, fixed or computed (axe resolves roles in ways a static read
// cannot follow: unknown and ignored tokens, an element's own role behind a
// presentational one); an element whose verdict depends on context (the data
// file's elementsLeftToAxe); and a computed aria-busy (a button mid-request).
// One shape is reported although axe accepts it: a role-less element inside a
// widget (a spinner `span` in a `button`), which the widget names. Disable the
// rule on that line, with the reason.

const MARKUP = require("../../../sdk/react/src/internal/loading-region-markup.json");

const NAMELESS_ELEMENTS = new Set(MARKUP.namelessElements);

/** The JSX attribute named `name` on `node`, or undefined. */
function attribute(node, name) {
  return node.attributes.find(
    (attr) => attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === name,
  );
}

/**
 * A JSX attribute's value when it is fixed in the source: `true` for a
 * valueless attribute (`<div aria-busy>` renders aria-busy="true"), the
 * string or boolean of a literal, written bare or in braces (`"x"`, `{"x"}`,
 * `{true}`), or of a template literal with no expressions; undefined for
 * anything computed.
 */
function staticValue(attr) {
  const value = attr.value;
  if (value === null) return true;
  if (value.type === "Literal") return value.value;
  if (value.type !== "JSXExpressionContainer") return undefined;
  const expression = value.expression;
  if (expression.type === "Literal") return expression.value;
  if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
    return expression.quasis[0].value.cooked;
  }
  return undefined;
}

/** Whether the attribute is present and not a fixed empty or blank string, which axe ignores. */
function names(attr) {
  if (attr === undefined) return false;
  const value = staticValue(attr);
  return typeof value !== "string" || value.trim() !== "";
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the shared LoadingRegion primitive for a busy, labelled loading container",
    },
    messages: {
      busyLabelledElement:
        "Busy, labelled element with no role on a tag axe refuses a name on, or with role=\"status\". " +
        "Render the internal LoadingRegion primitive instead (sdk/react/src/internal/LoadingRegion.tsx) with the " +
        "label as its `label` prop: the name fails axe's aria-prohibited-attr, and role=\"status\" is taken by " +
        "the console's badges and notices (stigmer#1653).",
    },
    schema: [],
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        // DOM elements only: a component's props are its own business.
        if (node.name.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name)) return;
        const busy = attribute(node, "aria-busy");
        if (busy === undefined) return;
        const busyValue = staticValue(busy);
        if (busyValue !== true && busyValue !== "true") return;
        if (!names(attribute(node, "aria-label")) && !names(attribute(node, "aria-labelledby"))) return;
        const roleAttribute = attribute(node, "role");
        if (roleAttribute === undefined) {
          if (NAMELESS_ELEMENTS.has(node.name.name)) context.report({ node, messageId: "busyLabelledElement" });
          return;
        }
        const role = staticValue(roleAttribute);
        if (role === "status") {
          context.report({ node, messageId: "busyLabelledElement" });
        } else if (typeof role === "string" && role.trim() === "" && NAMELESS_ELEMENTS.has(node.name.name)) {
          context.report({ node, messageId: "busyLabelledElement" });
        }
      },
    };
  },
};
