/**
 * Stage 2 of the SDK stylesheet build (stigmer/stigmer#454): scope the
 * selectors that Tailwind's `prefix(stg)` cannot make collision-free by name.
 *
 * Two populations get a zero-specificity `:where(.stgm, .stgm *)` guard on
 * their subject compound:
 *
 * - **Unlayered rules** — the xyflow stylesheet tail. Its `.react-flow*`
 *   classes are vendor-namespaced, but unlayered CSS beats ALL layered CSS,
 *   so an unscoped copy would override a host's own react-flow styling.
 * - **`@layer properties` rules** — Tailwind and tw-animate-css set universal
 *   (`*, ::before, ::after, ::backdrop`) initial values for UNPREFIXED
 *   internal variables (`--tw-translate-x`, `--tw-enter-opacity`; `prefix()`
 *   deliberately leaves `--tw-*` names alone). Identical names in a host's
 *   own Tailwind build are usually harmless, but initial values can drift
 *   across Tailwind versions — scoping removes the collision entirely.
 *
 * Never touched: `@property` rules (registration is inherently global;
 * duplicate identical registrations are a no-op), `@keyframes` steps (not
 * element selectors), and rules already targeting `.stgm`.
 *
 * The guard matches the provider's scope containers — the in-tree
 * `data-stgm-root` element AND the `document.body` portal container, both of
 * which carry the `.stgm` class — plus everything under them. `:where()`
 * carries zero specificity, so intra-stylesheet cascade order is unchanged.
 */

import type { AtRule, Container, Root, Rule } from "postcss";
import selectorParser from "postcss-selector-parser";

const SCOPE_GUARD = ":where(.stgm, .stgm *)";

const guardTemplate = selectorParser().astSync(SCOPE_GUARD).nodes[0].nodes[0];

/**
 * Attach the scope guard to the subject (rightmost) compound of each
 * selector, before any pseudo-element — `.react-flow__node` becomes
 * `.react-flow__node:where(.stgm, .stgm *)`, and `*::before` becomes
 * `*:where(.stgm, .stgm *)::before`.
 */
const addScopeGuard = selectorParser((selectors) => {
  selectors.each((selector) => {
    const nodes = selector.nodes;
    let insertAt = nodes.length;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === "combinator") break;
      const isPseudoElement =
        node.type === "pseudo" &&
        (node.value.startsWith("::") ||
          // Legacy single-colon pseudo-element spellings (minifier output).
          [":before", ":after", ":first-line", ":first-letter", ":backdrop"].includes(
            node.value,
          ));
      if (isPseudoElement) insertAt = i;
    }
    if (insertAt >= nodes.length) {
      selector.append(guardTemplate.clone() as never);
    } else {
      selector.insertBefore(nodes[insertAt], guardTemplate.clone() as never);
    }
  });
});

/** The names of all at-rules enclosing a node, outermost first. */
function enclosingAtRuleNames(node: Rule): string[] {
  const names: string[] = [];
  let parent: Container | undefined = node.parent as Container | undefined;
  while (parent) {
    if (parent.type === "atrule") names.unshift((parent as AtRule).name);
    parent = parent.parent as Container | undefined;
  }
  return names;
}

/** The nearest enclosing `@layer` name of a node, or null when unlayered. */
export function enclosingLayer(node: Rule): string | null {
  let parent: Container | undefined = node.parent as Container | undefined;
  while (parent) {
    if (parent.type === "atrule" && (parent as AtRule).name === "layer") {
      return (parent as AtRule).params.trim();
    }
    parent = parent.parent as Container | undefined;
  }
  return null;
}

/** Apply the #454 scoping pass to a parsed stylesheet, in place. */
export function scopeUnprefixedSelectors(root: Root): void {
  root.walkRules((rule) => {
    const atRules = enclosingAtRuleNames(rule);
    // Keyframe steps are not element selectors — never touch them.
    if (atRules.some((n) => n === "keyframes" || n.endsWith("keyframes"))) {
      return;
    }
    const layer = enclosingLayer(rule);
    if (layer !== "properties" && layer !== null) return;
    if (rule.selector.includes(".stgm")) return;
    rule.selector = addScopeGuard.processSync(rule.selector);
  });
}
