"use strict";

const { extractClassNames } = require("../src/class-extractor");

// The elements a browser gives a block margin of its own: a paragraph 1em
// above and below, a heading from 0.67em (h1) to 2.33em (h6).
const TEXT_ELEMENTS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** What a JSX child can sit in between itself and the element it renders in. */
const WRAPPERS = new Set([
  "JSXFragment",
  "JSXExpressionContainer",
  "ConditionalExpression",
  "LogicalExpression",
  // A list drawn by a callback inside the element: `{items.map((item) => <p />)}`.
  "ArrowFunctionExpression",
  "FunctionExpression",
  "BlockStatement",
  "ReturnStatement",
  "CallExpression",
]);

/** True for one of the kit's own classes, which carry the `stg:` prefix. */
function isKitClass(cls) {
  return cls.startsWith("stg:");
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every <p> and <h1>-<h6> the kit draws to carry a kit class, or sit directly in an element that does, so the kit's base reset gives it no margin in a host without a CSS reset",
    },
    messages: {
      missingTextMargin:
        "<{{ element }}> carries no kit class and sits in no kit-classed element, so the kit's base reset (styles.css) " +
        "does not reach it, and in a host without a global CSS reset (a customer's site, the gallery) the browser gives it " +
        "{{ default }} above and below. Give it the stg: classes it is styled with, or put it directly in the kit element " +
        "it belongs to. The reset is held to the kit's own elements so a host's own paragraphs keep their margins.",
    },
    schema: [],
  },

  create(context) {
    /** The className attribute of a JSX opening element, if it has one. */
    const classNameOf = (opening) =>
      opening.attributes.find((attr) => attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === "className");
    /** True when the className can be read here and names no kit class: a host's classes, or none. */
    const namesNoKitClass = (attr) => {
      const value = attr.value;
      const staticString =
        (value && value.type === "Literal") ||
        (value && value.type === "JSXExpressionContainer" && value.expression.type === "Literal") ||
        (value && value.type === "JSXExpressionContainer" && value.expression.type === "TemplateLiteral" && value.expression.expressions.length === 0);
      if (!staticString) return false;
      return !extractClassNames(attr).some(({ className }) => isKitClass(className));
    };
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !TEXT_ELEMENTS.has(node.name.name)) return;
        const own = classNameOf(node);
        if (own !== undefined) {
          if (!namesNoKitClass(own)) return;
        } else {
          // No class of its own: the reset reaches it when the element it
          // renders in carries a kit class. That is the nearest JSX element
          // around it, through fragments and conditionals: a DOM element
          // with a kit class, or one of the kit's own components, whose
          // wrapper carries them.
          let parent = node.parent.parent;
          while (parent && parent.type !== "JSXElement" && WRAPPERS.has(parent.type)) parent = parent.parent;
          if (parent && parent.type === "JSXElement") {
            const name = parent.openingElement.name;
            if (name.type !== "JSXIdentifier" || /^[A-Z]/.test(name.name)) return;
            const parentClass = classNameOf(parent.openingElement);
            if (parentClass !== undefined && extractClassNames(parentClass).some(({ className }) => isKitClass(className))) return;
          }
        }
        context.report({
          node,
          messageId: "missingTextMargin",
          data: { element: node.name.name, default: node.name.name === "p" ? "one line's height" : "most of a line" },
        });
      },
    };
  },
};
