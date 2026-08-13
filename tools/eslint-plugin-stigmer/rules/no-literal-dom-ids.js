"use strict";

// Hardcoded DOM ids are systematically wrong in an embeddable component
// library: a host may legitimately mount ANY SDK component more than once
// per page (the console's zone-cached detail pages already do), and every
// literal `id=` is a latent collision — duplicate ids silently break
// label→input and ARIA associations for every copy after the first
// (stigmer/stigmer#619, #593, #571). Literal radio `name=` is the worse
// class: two mounts merge into ONE keyboard group, so arrow keys and
// checked-state bleed across unrelated forms.
//
// The house pattern: mint ids per mount with React's useId() — one
// `const baseId = useId()` per component, derived per-field ids
// (`` `${baseId}-name` ``), threaded to body components as props when the
// id-bearing markup lives elsewhere. IDREF reference attributes (htmlFor,
// aria-labelledby, …) must use the same minted value, so their literal
// forms are banned alongside `id` — a literal IDREF can only dangle or
// point at another component's DOM.
//
// Detection mirrors no-native-title's discipline: only host (lowercase)
// JSX elements and known prop-forwarders are flagged, so component props
// that happen to be called `id` (React's <Profiler id=…>, semantic keys
// like <CollapsibleSection id=…>) never false-positive.
//
// Honest limitation: expression-derived ids (`id={`${prefix}-${i}`}`) are
// not traceable by lint. The audited call sites all derive from useId();
// the literal class fenced here is the only regrowth pattern observed.

const ID_ATTRIBUTES = new Set([
  "id",
  "htmlFor",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
]);

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

  if (
    nameNode.type === "JSXMemberExpression" &&
    nameNode.property.type === "JSXIdentifier" &&
    FORWARDING_NAME_SUFFIX.test(nameNode.property.name)
  ) {
    return `${nameNode.object.name ?? ""}.${nameNode.property.name}`;
  }

  return null;
}

/** True when the owning element is `<input type="radio">` with a literal type. */
function isRadioInput(openingElement) {
  const nameNode = openingElement.name;
  if (nameNode.type !== "JSXIdentifier" || nameNode.name !== "input") {
    return false;
  }
  return openingElement.attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === "type" &&
      attr.value &&
      attr.value.type === "Literal" &&
      attr.value.value === "radio",
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow literal DOM ids, IDREF references, and radio-group names — the SDK is an embeddable library, so every hardcoded id is a latent duplicate-id collision; mint them per mount with useId()",
    },
    messages: {
      literalId:
        "Literal `{{ attribute }}` on <{{ element }}> is a latent duplicate-id collision — a host may mount this" +
        " component more than once per page. Mint the id per mount: `const baseId = useId()` plus derived" +
        " per-field ids (see CreateWorkflowInstanceDialog), threading it to body components as a prop if needed.",
      literalRadioName:
        "Literal radio `name` on <input type=\"radio\"> merges every mounted copy of this component into ONE" +
        " keyboard group (arrow keys and checked state bleed across forms). Mint the group name per mount from" +
        " `useId()` and thread it to each option in the group.",
    },
    schema: [],
  },

  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (!node.value || node.value.type !== "Literal") return;
        if (typeof node.value.value !== "string") return;

        const attrName = node.name.name;

        if (attrName === "name" && isRadioInput(node.parent)) {
          context.report({ node, messageId: "literalRadioName" });
          return;
        }

        if (!ID_ATTRIBUTES.has(attrName)) return;

        const element = domRenderingElementName(node.parent);
        if (element === null) return;

        context.report({
          node,
          messageId: "literalId",
          data: { attribute: attrName, element },
        });
      },
    };
  },
};
