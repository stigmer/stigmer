"use strict";

// The SDK has one container for a labelled loading region:
// internal/LoadingRegion.tsx marks the region busy and names it with visually
// hidden text. axe's `aria-prohibited-attr` (WCAG 4.1.2) refuses a name on an
// element whose role takes none, so a labelled skeleton built that way fails
// every page audit it is on screen for (stigmer#1653); role="status" would
// make the label legal but is the role this console's phase badges, empty
// states and notices carry. So a DOM element that is busy (aria-busy fixed
// true: `"true"`, `{true}`, or the bare attribute) and labelled (a non-empty
// aria-label or aria-labelledby) is reported, and renders
// <LoadingRegion label="..."> instead, when:
//   - its role is "status", or one under which axe prohibits a name; or
//   - it has no role axe would use (none, an empty or unknown one, or none or
//     presentation, which axe sets aside when a label is present), it is an
//     element whose own role takes no name, and no widget it sits in within
//     the same JSX (a button, a link, a tab) names it.
//
// Which elements and roles those are is not judged here: it is measured. The
// lists come from sdk/react/src/internal/loading-region-markup.json, which
// sdk/react's loading-region-markup.browser.test.ts proves equal to what
// axe-core decides in a real Chromium, in both directions, so an axe upgrade
// that moves the line fails that suite.
//
// This is a fence for the shapes a skeleton takes, not a second axe; axe's
// audits (the SDK's a11y browser suites, the console's e2e page audits) are
// the complete check. Left to them: elements whose verdict depends on context
// the rule cannot see (the data file's elementsLeftToAxe: an `a`, a table
// cell; also a `header` or `footer` inside `main`), a role axe does not allow
// on its element (a doc-* role on a div), a widget or wrapper passed in from
// another component, and a computed role or aria-busy, which are the author's
// to justify. A wrapper the walk to a widget cannot pass through (one with a
// role of its own) is reported even where axe would accept it; disable the
// rule on that line with the reason.

const MARKUP = require("../../../sdk/react/src/internal/loading-region-markup.json");

const NAMELESS_ELEMENTS = new Set(MARKUP.namelessElements);
const NAMELESS_ROLES = new Set(MARKUP.namelessRoles);
const FALLBACK_ROLES = new Set(MARKUP.fallbackRoles);
const KNOWN_ROLES = new Set(MARKUP.knownRoles);
const WIDGET_ROLES = new Set(MARKUP.widgetRoles);
const RESERVED_ROLES = new Set(MARKUP.consoleReservedRoles);

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

/**
 * The role an element's role attribute gives: "computed" when it is not fixed
 * in the source; otherwise its first token axe knows, lowercased, or
 * undefined when it gives none (no attribute, an empty one, only unknown
 * tokens, or a value that is not a string, such as `role={true}`).
 */
function roleOf(node) {
  const attr = attribute(node, "role");
  if (attr === undefined) return undefined;
  const value = staticValue(attr);
  if (value === undefined) return "computed";
  if (typeof value !== "string") return undefined;
  return value.trim().toLowerCase().split(/\s+/).find((token) => KNOWN_ROLES.has(token));
}

/**
 * Whether a widget names the element: walking up the JSX it sits in within
 * this file, through role-less wrappers whose own role takes no name, the
 * first other ancestor is a button, a link (an `a` with an href) or an
 * element with a widget role. Anything else, a component included, stops the
 * walk without one.
 */
function insideWidget(node) {
  for (let parent = node.parent.parent; parent && parent.type === "JSXElement"; parent = parent.parent) {
    const opening = parent.openingElement;
    if (opening.name.type !== "JSXIdentifier" || !/^[a-z]/.test(opening.name.name)) return false;
    const role = roleOf(opening);
    if (role === "computed") return false;
    if (role !== undefined && !FALLBACK_ROLES.has(role)) return WIDGET_ROLES.has(role);
    const tag = opening.name.name;
    if (tag === "button" || (tag === "a" && attribute(opening, "href") !== undefined)) return true;
    if (!NAMELESS_ELEMENTS.has(tag)) return false;
  }
  return false;
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
        "Busy element named by aria-label or aria-labelledby where axe refuses the name, or with role=\"status\". " +
        "Render the internal LoadingRegion primitive instead (sdk/react/src/internal/LoadingRegion.tsx) with the " +
        "label as its `label` prop: a name on an element whose role takes none fails axe's aria-prohibited-attr, " +
        "and role=\"status\" is taken by the console's badges and notices (stigmer#1653).",
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
        const role = roleOf(node);
        if (role === "computed") return;
        if (role !== undefined && (RESERVED_ROLES.has(role) || NAMELESS_ROLES.has(role))) {
          context.report({ node, messageId: "busyLabelledElement" });
          return;
        }
        // A role that takes a name is a real landmark or widget.
        if (role !== undefined && !FALLBACK_ROLES.has(role)) return;
        // No role axe would use: the element's own role decides.
        if (NAMELESS_ELEMENTS.has(node.name.name) && !insideWidget(node)) {
          context.report({ node, messageId: "busyLabelledElement" });
        }
      },
    };
  },
};
