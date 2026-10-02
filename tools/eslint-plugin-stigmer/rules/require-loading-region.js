"use strict";

// The SDK has one container for a labelled loading region:
// internal/LoadingRegion.tsx marks the region busy and names it with visually
// hidden text. An `aria-label` on a role-less element is refused by axe
// (`aria-prohibited-attr`, WCAG 4.1.2), so a labelled skeleton built that way
// fails every page audit it is on screen for (stigmer#1653); role="status"
// would make the label legal but is the role this console's phase badges,
// empty states and notices carry. So a DOM element that is busy and labelled
// is reported, and renders <LoadingRegion label="..."> instead, when:
//   - its fixed role is "status", or one under which an element takes no name
//     (NAMELESS_ROLES); or
//   - it has no role (an empty attribute included) and is one of the elements
//     whose own role takes no name (NAMELESS_ELEMENTS).
//
// "Busy" is aria-busy fixed true: `"true"`, `{true}`, or the bare attribute,
// which JSX renders as "true". A fixed role is read however it is written
// (`"status"`, `{"status"}`, `{`status`}`), by its first token, in any case.
//
// This is a fence for the shapes a skeleton takes, not a second axe. The
// complete check is axe's own `aria-prohibited-attr`, which the SDK's a11y
// browser suites and the console's e2e page audits run. Left to axe: a first
// role token this rule does not know (a browser skips it for the next), and an
// element whose role depends on what surrounds it or on attributes this rule
// does not read (an `a` with no href, a `header` or `footer` inside `main`).
//
// Left legal: a busy element whose role, fixed or its own, permits a name and
// is not "status", such as a streaming plan's labelled region or article, a
// busy labelled button, section or list, which are no skeleton's markup; a
// computed role, the author's to justify; and a computed
// `aria-busy={isSubmitting}` (a button mid-request).

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

/**
 * Roles under which an element takes no name, so a label on it is refused as
 * on no role at all: generic, and the roles axe-core 4.11 lists with
 * aria-label and aria-labelledby prohibited.
 */
const NAMELESS_ROLES = new Set([
  "generic", "presentation", "none",
  "caption", "code", "deletion", "emphasis", "insertion", "mark", "paragraph",
  "strong", "subscript", "superscript", "suggestion",
]);

/**
 * Elements whose own role takes no name whatever surrounds them, so with no
 * explicit role a label on them is refused: those with a generic role or none
 * (div, span, b, i, u, s, small, pre, bdi, bdo, data, samp, kbd, var, abbr,
 * cite, q, figcaption, legend, blockquote, address, hgroup), and those whose
 * role is one of the nameless text roles (p, strong, em, code, sub, sup, del,
 * ins, mark). An element whose own role permits a name (a button, a labelled
 * section, a list, a time) is left alone.
 */
const NAMELESS_ELEMENTS = new Set([
  "div", "span", "b", "i", "u", "s", "small", "pre", "bdi", "bdo", "data", "samp", "kbd", "var",
  "abbr", "cite", "q", "figcaption", "legend", "blockquote", "address", "hgroup",
  "p", "strong", "em", "code", "sub", "sup", "del", "ins", "mark",
]);

/**
 * The role a fixed role attribute names: its first token, lowercased, or
 * undefined when it names none (an empty string, or a value that is not a
 * string, such as `role={true}`), so the element's own role decides.
 */
function fixedRole(value) {
  if (typeof value !== "string") return undefined;
  const first = value.trim().toLowerCase().split(/\s+/)[0];
  return first === "" ? undefined : first;
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
        "Busy element with an aria-label or aria-labelledby and no role, or role=\"status\". Render the internal LoadingRegion " +
        "primitive instead (sdk/react/src/internal/LoadingRegion.tsx) with the " +
        "label as its `label` prop: aria-label on a role-less element fails " +
        "axe's aria-prohibited-attr, and role=\"status\" is taken by the " +
        "console's badges and notices (stigmer#1653).",
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
        // aria-labelledby names a generic element no more legally than aria-label.
        if (attribute(node, "aria-label") === undefined && attribute(node, "aria-labelledby") === undefined) return;
        const roleAttribute = attribute(node, "role");
        if (roleAttribute !== undefined) {
          const value = staticValue(roleAttribute);
          // A computed role is the author's to justify.
          if (value === undefined) return;
          const role = fixedRole(value);
          // A fixed role that can take a name, other than status, is a real
          // landmark or widget; an empty one is no role, so the element's own
          // role decides, as below.
          if (role !== undefined) {
            if (role === "status" || NAMELESS_ROLES.has(role)) context.report({ node, messageId: "busyLabelledElement" });
            return;
          }
        }
        if (NAMELESS_ELEMENTS.has(node.name.name)) context.report({ node, messageId: "busyLabelledElement" });
      },
    };
  },
};
