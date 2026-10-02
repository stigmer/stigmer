"use strict";

// The SDK has one loading container: internal/LoadingRegion.tsx marks the
// region a skeleton fills busy and names it with visually hidden text. Before
// the stigmer#1653 sweep, 36 skeletons put `aria-busy="true"` and an
// `aria-label` on a role-less <div>, which axe refuses (`aria-prohibited-attr`,
// WCAG 4.1.2), so a page audit failed whenever one was on screen; two more had
// taken role="status" to make the label legal, which is the role this
// console's phase badges, empty states and notices carry. This fence keeps the
// class dead: a DOM element that is busy and labelled, with no role or with
// role="status", belongs inside LoadingRegion; everywhere else renders
// <LoadingRegion label="...">.
//
// "Busy" is aria-busy fixed true: `"true"`, `{true}`, or the bare attribute,
// which JSX renders as "true". A role that takes no name (generic,
// presentation, none) counts as no role, and a fixed role is read however it
// is written (`"status"`, `{"status"}`, `{`status`}`).
//
// Left legal: a busy element whose fixed role permits a name and is not
// "status", such as a streaming plan's labelled region or article, which
// holds real content and is no skeleton; a computed role, the author's to
// justify; and a computed `aria-busy={isSubmitting}` (a button mid-request).

const REGION_FILE_SUFFIX = "internal/LoadingRegion.tsx";

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

/** Roles under which an element takes no name, so a label on it is as prohibited as on no role at all. */
const NAMELESS_ROLES = new Set(["generic", "presentation", "none"]);

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
    const filename = context.filename ?? context.getFilename();
    if (filename.replaceAll("\\", "/").endsWith(REGION_FILE_SUFFIX)) {
      return {};
    }

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
        const role = attribute(node, "role");
        if (role !== undefined) {
          const roleValue = staticValue(role);
          // A computed role is the author's to justify; a fixed one that can
          // take a name, other than status, is a real landmark or widget.
          if (roleValue === undefined) return;
          if (roleValue !== "status" && !NAMELESS_ROLES.has(roleValue)) return;
        }
        context.report({ node, messageId: "busyLabelledElement" });
      },
    };
  },
};
