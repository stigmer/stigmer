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
// Left legal: a busy element whose role permits a name and is not "status",
// such as a streaming plan's labelled region or article, which holds real
// content and is no skeleton; and a computed `aria-busy={isSubmitting}` (a
// button mid-request). Only a literal `"true"` or `{true}` is a loading
// region's mark.

const REGION_FILE_SUFFIX = "internal/LoadingRegion.tsx";

/** The JSX attribute named `name` on `node`, or undefined. */
function attribute(node, name) {
  return node.attributes.find(
    (attr) => attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === name,
  );
}

/** Whether a JSX attribute's value is the literal true: `"true"` or `{true}`. */
function isLiteralTrue(attr) {
  const value = attr.value;
  if (value === null) return false;
  if (value.type === "Literal") return value.value === "true";
  return (
    value.type === "JSXExpressionContainer" &&
    value.expression.type === "Literal" &&
    value.expression.value === true
  );
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
        "Busy element with an aria-label and no role, or role=\"status\". Render the internal LoadingRegion " +
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
        if (busy === undefined || !isLiteralTrue(busy)) return;
        if (attribute(node, "aria-label") === undefined) return;
        const role = attribute(node, "role");
        const roleValue = role?.value?.type === "Literal" ? role.value.value : undefined;
        if (role !== undefined && roleValue !== "status") return;
        context.report({ node, messageId: "busyLabelledElement" });
      },
    };
  },
};
