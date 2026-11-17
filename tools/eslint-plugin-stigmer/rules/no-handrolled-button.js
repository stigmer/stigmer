"use strict";

// The kit has one button: button/Button.tsx draws every action (its
// variants, its two sizes, one height for every variant, its focus ring and
// its disabled look), with IconButton for an icon alone and LinkButton for a
// link that looks like one. Before the 2026-11 sweep, this rule found 105
// buttons and links in 85 files hand-drawn with a primary or destructive
// fill, at their own sizes, so a black
// button beside a white one sat 2px lower and one Library page carried two
// sizes of the same "Create" link. This fence keeps the class dead: an
// element a person presses (a <button>, an <a>, a framework `Link`) that
// carries the primary or destructive fill is a Button, an IconButton or a
// LinkButton, everywhere but the button folder itself.
//
// Only the two filled tiers are fenced: their look is unmistakably a button,
// while the quiet tiers' classes (a border, a hover tint) are shared with
// rows, tabs, menu items and disclosures that are not buttons at all. A
// control that shows a chosen state with the fill (a switch that is on, a
// selected tab or option, a pressed toggle) is not an action, so an element
// with such a role or with `aria-pressed` keeps its fill.
//
// A <button> drawn in the link colour (`text-primary` at rest, whatever its
// hover) is fenced too (stigmer#3236): it is an act a person presses ("Load
// more", "Download", "View"), drawn to look like a link, so it escaped the
// kit's sizes, focus ring and busy look while passing the fill check. Such
// an act is a ghost Button at `xs`. Only `<button>` is checked for it: an
// anchor in the link colour goes somewhere, which is what a link is; and
// only the colour at rest, since a quiet row or disclosure may take the
// link colour on hover. The chosen-state exemption above applies here too.
//
// The fill is found in the className's own strings, through cn() calls,
// conditionals and templates, and through a constant declared in the same
// file (`const PRIMARY = "stg:bg-primary …"; <button className={PRIMARY} />`).
// A class string imported from another module is not followed.

const { extractClassNames } = require("../src/class-extractor");

const BUTTON_FOLDER = "/sdk/react/src/button/";
const PRESSABLE = new Set(["button", "a", "Link"]);
const FILLS = new Set(["bg-primary", "bg-destructive"]);
const LINK_COLOUR = "text-primary";
const CHOICE_ROLES = new Set(["switch", "tab", "radio", "option", "menuitemradio", "menuitemcheckbox", "checkbox"]);

/** Whether the element is a control that shows a chosen state, not an action. */
function showsChoice(node) {
  return node.attributes.some((attribute) => {
    if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") return false;
    if (attribute.name.name === "aria-pressed") return true;
    return attribute.name.name === "role" && attribute.value?.type === "Literal" && CHOICE_ROLES.has(attribute.value.value);
  });
}

/** A class's utility, past every variant, the kit's `stg:` prefix, the important mark and an opacity suffix. */
function utilityOf(cls) {
  const parts = cls.split(":");
  return parts[parts.length - 1].replace(/^!|!$/g, "").replace(/\/[^/]+$/, "");
}

/** Whether a class applies at rest: no variant before it but the kit's `stg:` prefix. */
function atRest(cls) {
  return cls.split(":").filter((part) => part !== "stg").length === 1;
}

/** Whether a class is the link colour at rest. */
function isLinkColour(cls) {
  return atRest(cls) && utilityOf(cls) === LINK_COLOUR;
}

/** The pressed element's name: `button`, `Link`, or the property of `motion.button`. */
function elementName(name) {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return name.property.name;
  return "";
}

/** The string a same-file constant holds, when `identifier` names one. */
function constantString(context, identifier) {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  let scope = sourceCode.getScope ? sourceCode.getScope(identifier) : context.getScope();
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      const def = variable.defs[0];
      if (!def || def.type !== "Variable" || def.parent?.kind !== "const") return null;
      const init = def.node.init;
      if (init?.type === "Literal" && typeof init.value === "string") return init.value;
      if (init?.type === "TemplateLiteral" && init.expressions.length === 0) return init.quasis.map((q) => q.value.cooked).join("");
      return null;
    }
    scope = scope.upper;
  }
  return null;
}

/** Every identifier a className expression reads as a value (not a property name or a callee). */
function valueIdentifiers(node, out = []) {
  if (!node || typeof node !== "object") return out;
  switch (node.type) {
    case "Identifier":
      out.push(node);
      break;
    case "JSXExpressionContainer":
      valueIdentifiers(node.expression, out);
      break;
    case "CallExpression":
      for (const arg of node.arguments) valueIdentifiers(arg, out);
      break;
    case "ConditionalExpression":
      valueIdentifiers(node.consequent, out);
      valueIdentifiers(node.alternate, out);
      break;
    case "LogicalExpression":
      valueIdentifiers(node.right, out);
      break;
    case "TemplateLiteral":
      for (const expression of node.expressions) valueIdentifiers(expression, out);
      break;
    case "ArrayExpression":
      for (const element of node.elements) valueIdentifiers(element, out);
      break;
    case "BinaryExpression":
      valueIdentifiers(node.left, out);
      valueIdentifiers(node.right, out);
      break;
    default:
      break;
  }
  return out;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require the kit's Button, IconButton or LinkButton instead of a <button>, <a> or Link hand-drawn with a primary or destructive fill, or a <button> drawn in the link colour",
    },
    messages: {
      handrolledButton:
        "Hand-drawn {{ fill }} button. Render the kit's Button (an action), " +
        "IconButton (an icon alone) or LinkButton (a link that looks like a " +
        "button) instead (sdk/react/src/button/): they hold one height, one " +
        "size scale and one focus ring for every action in the console.",
      linkStyledButton:
        "A <button> drawn in the link colour is an act dressed as a link. " +
        "Render the kit's Button (variant ghost, size xs) instead " +
        "(sdk/react/src/button/), so it keeps the console's sizes, focus ring " +
        "and busy look; an <a> stays a link when it goes somewhere.",
    },
    schema: [],
  },

  create(context) {
    const filename = (context.filename ?? context.getFilename()).replaceAll("\\", "/");
    if (filename.includes(BUTTON_FOLDER)) return {};

    return {
      JSXOpeningElement(node) {
        const name = elementName(node.name);
        if (!PRESSABLE.has(name)) return;
        if (showsChoice(node)) return;
        const isButton = name === "button";
        const report = (utility, reportNode) =>
          context.report({ node: reportNode, messageId: "handrolledButton", data: { fill: utility === "bg-primary" ? "primary" : "destructive" } });
        const reportLink = (reportNode) => context.report({ node: reportNode, messageId: "linkStyledButton" });
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier" || attribute.name.name !== "className") continue;
          for (const { className: cls, node: reportNode } of extractClassNames(attribute)) {
            const utility = utilityOf(cls);
            if (FILLS.has(utility)) return report(utility, reportNode);
            if (isButton && isLinkColour(cls)) return reportLink(reportNode);
          }
          for (const identifier of valueIdentifiers(attribute.value)) {
            const text = constantString(context, identifier);
            if (text === null) continue;
            const classes = text.split(/\s+/);
            const utility = classes.map(utilityOf).find((u) => FILLS.has(u));
            if (utility) return report(utility, identifier);
            if (isButton && classes.some(isLinkColour)) return reportLink(identifier);
          }
        }
      },
    };
  },
};
