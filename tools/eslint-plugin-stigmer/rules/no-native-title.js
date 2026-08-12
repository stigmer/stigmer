"use strict";

// Native `title` attributes are below the product's quality bar as tooltips:
// they are OS-delayed, imprecise hover targets, not keyboard-accessible, and
// invisible on touch. On disabled controls they are unreachable by EVERY
// input method (`disabled` removes the control from the tab order and the
// house button styles add `pointer-events-none`), so the user who most needs
// the explanation can never see it (stigmer/stigmer-cloud#268).
//
// The rule flags `title` on anything that renders it into the DOM:
//   - lowercase JSX elements (`<button title=…>`), and
//   - components known to forward arbitrary props onto their DOM element:
//     the SDK `Button` (spreads `...rest`) and Base UI-style trigger
//     components (`Popover.Trigger`, `TooltipTrigger`, …), matched by a
//     `Trigger` name suffix.
//
// Custom components where `title` is a rendered-text prop (Section,
// EmptyState, DialogHeader, …) are deliberately NOT flagged — those render
// visible headings, not native tooltips.

const FORWARDING_COMPONENT_NAMES = new Set(["Button"]);
const FORWARDING_NAME_SUFFIX = /Trigger$/;

/**
 * Resolves whether the JSX element owning this attribute renders the
 * attribute into the DOM (host element or a known prop-forwarding
 * component). Returns the printable element name when it does.
 */
function domRenderingElementName(openingElement) {
  const nameNode = openingElement.name;

  if (nameNode.type === "JSXIdentifier") {
    const name = nameNode.name;
    if (/^[a-z]/.test(name)) return name;
    if (FORWARDING_COMPONENT_NAMES.has(name)) return name;
    if (FORWARDING_NAME_SUFFIX.test(name)) return name;
    return null;
  }

  // <Popover.Trigger title=…> — Base UI triggers forward props to the DOM.
  if (
    nameNode.type === "JSXMemberExpression" &&
    nameNode.property.type === "JSXIdentifier" &&
    FORWARDING_NAME_SUFFIX.test(nameNode.property.name)
  ) {
    return `${nameNode.object.name ?? ""}.${nameNode.property.name}`;
  }

  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow native `title` attributes — OS-delayed, keyboard- and touch-inaccessible tooltips, fully unreachable on disabled controls",
    },
    messages: {
      nativeTitle:
        "Native `title` on <{{ element }}> is an OS-delayed tooltip that keyboard and touch users never see" +
        " (and on a disabled control, nobody sees). Use the house tooltip (internal/tooltip.tsx)," +
        " TruncatedText (internal/truncated-text.tsx) for truncated values, or visible text for" +
        " a disabled control's explanation.",
    },
    schema: [],
  },

  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "title") {
          return;
        }

        const element = domRenderingElementName(node.parent);
        if (element === null) return;

        context.report({
          node,
          messageId: "nativeTitle",
          data: { element },
        });
      },
    };
  },
};
