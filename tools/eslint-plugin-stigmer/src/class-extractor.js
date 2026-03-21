"use strict";

/**
 * Recursively collect every string literal reachable from a given AST node.
 * Handles plain strings, template literal quasis, cn() / clsx() arguments
 * (positional strings, logical-&& chains, and object-syntax keys).
 */
function collectStringLiterals(node, results) {
  if (!node) return;

  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") {
        results.push({ value: node.value, node });
      }
      break;

    case "TemplateLiteral":
      for (const quasi of node.quasis) {
        if (quasi.value.raw) {
          results.push({ value: quasi.value.raw, node: quasi });
        }
      }
      break;

    case "CallExpression":
      for (const arg of node.arguments) {
        collectStringLiterals(arg, results);
      }
      break;

    case "LogicalExpression":
      collectStringLiterals(node.left, results);
      collectStringLiterals(node.right, results);
      break;

    case "ConditionalExpression":
      collectStringLiterals(node.consequent, results);
      collectStringLiterals(node.alternate, results);
      break;

    case "ObjectExpression":
      for (const prop of node.properties) {
        if (prop.type === "Property" && prop.key) {
          if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
            results.push({ value: prop.key.value, node: prop.key });
          } else if (prop.key.type === "Identifier") {
            results.push({ value: prop.key.name, node: prop.key });
          }
        }
      }
      break;

    case "ArrayExpression":
      for (const el of node.elements) {
        if (el) collectStringLiterals(el, results);
      }
      break;

    case "JSXExpressionContainer":
      collectStringLiterals(node.expression, results);
      break;
  }
}

/**
 * Given a JSXAttribute node for `className`, return every individual Tailwind
 * class name found in its value (across string literals, cn() calls, etc.).
 *
 * Each result is { className: string, node: ASTNode } so the rule can report
 * on the correct source location.
 */
function extractClassNames(attrNode) {
  const results = [];
  const strings = [];

  if (!attrNode.value) return results;

  collectStringLiterals(attrNode.value, strings);

  for (const { value, node } of strings) {
    const classes = value.split(/\s+/).filter(Boolean);
    for (const cls of classes) {
      results.push({ className: cls, node });
    }
  }

  return results;
}

module.exports = { extractClassNames, collectStringLiterals };
