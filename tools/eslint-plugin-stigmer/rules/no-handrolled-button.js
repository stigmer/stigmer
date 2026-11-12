"use strict";

// The kit has one button: button/Button.tsx draws every action (its
// variants, its two sizes, one height for every variant, its focus ring and
// its disabled look), with IconButton for an icon alone and LinkButton for a
// link that looks like one. Before the 2026-11 sweep, 75 files hand-drew a
// primary fill on their own <button> or link, at their own sizes, so a black
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

const { extractClassNames } = require("../src/class-extractor");

const BUTTON_FOLDER = "/button/";
const PRESSABLE = new Set(["button", "a", "Link"]);
const FILLS = new Set(["bg-primary", "bg-destructive"]);
const CHOICE_ROLES = new Set(["switch", "tab", "radio", "option", "menuitemradio", "menuitemcheckbox", "checkbox"]);

/** Whether the element is a control that shows a chosen state, not an action. */
function showsChoice(node) {
  return node.attributes.some((attribute) => {
    if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") return false;
    if (attribute.name.name === "aria-pressed") return true;
    return attribute.name.name === "role" && attribute.value?.type === "Literal" && CHOICE_ROLES.has(attribute.value.value);
  });
}

/** A class's utility, past every variant and the kit's `stg:` prefix. */
function utilityOf(cls) {
  const parts = cls.split(":");
  return parts[parts.length - 1];
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require the kit's Button, IconButton or LinkButton instead of a <button>, <a> or Link hand-drawn with a primary or destructive fill",
    },
    messages: {
      handrolledButton:
        "Hand-drawn {{ fill }} button. Render the kit's Button (an action), " +
        "IconButton (an icon alone) or LinkButton (a link that looks like a " +
        "button) instead (sdk/react/src/button/): they hold one height, one " +
        "size scale and one focus ring for every action in the console.",
    },
    schema: [],
  },

  create(context) {
    const filename = (context.filename ?? context.getFilename()).replaceAll("\\", "/");
    if (filename.includes(BUTTON_FOLDER)) return {};

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !PRESSABLE.has(node.name.name)) return;
        if (showsChoice(node)) return;
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier" || attribute.name.name !== "className") continue;
          for (const { className: cls, node: reportNode } of extractClassNames(attribute)) {
            const utility = utilityOf(cls);
            if (FILLS.has(utility)) {
              context.report({ node: reportNode, messageId: "handrolledButton", data: { fill: utility === "bg-primary" ? "primary" : "destructive" } });
              return;
            }
          }
        }
      },
    };
  },
};
