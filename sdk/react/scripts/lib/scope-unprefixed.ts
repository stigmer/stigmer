/**
 * Stage 2 of the SDK stylesheet build (stigmer/stigmer#454): scope the
 * selectors that Tailwind's `prefix(stg)` cannot make collision-free by name.
 *
 * Two populations get a zero-specificity `:where(.stgm, .stgm *)` guard on
 * their subject compound:
 *
 * - **Unlayered vendor rules** — a vendor stylesheet imported without a
 *   layer. Its classes may be vendor-namespaced, but unlayered CSS beats
 *   ALL layered CSS, so an unscoped copy would override a host's own styling
 *   for the same vendor.
 * - **`@layer properties` rules** — Tailwind and tw-animate-css set universal
 *   (`*, ::before, ::after, ::backdrop`) initial values for UNPREFIXED
 *   internal variables (`--tw-translate-x`, `--tw-enter-opacity`; `prefix()`
 *   deliberately leaves `--tw-*` names alone). Identical names in a host's
 *   own Tailwind build are usually harmless, but initial values can drift
 *   across Tailwind versions — scoping removes the collision entirely.
 *
 * Never touched: `@property` rules (registration is inherently global;
 * duplicate identical registrations are a no-op), `@keyframes` steps (not
 * element selectors), rules already targeting `.stgm`, and the kit's own
 * `stg:`-prefixed utilities, unlayered since #3491: their names already keep
 * them off every host element, and a guard would stop them applying to a kit
 * part rendered outside a `.stgm` container.
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
 * selector, before any pseudo-element — `.vendor__node` becomes
 * `.vendor__node:where(.stgm, .stgm *)`, and `*::before` becomes
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
    if (rule.selectors.every((selector) => selector.includes(".stg\\:"))) return;
    rule.selector = addScopeGuard.processSync(rule.selector);
  });
}

/**
 * The specificity the kit's child utilities are lifted to: (0,0,3). `*`
 * matches every element, and `:is()` counts its most specific argument, so
 * the suffix changes what a rule ranks against, never what it matches.
 */
export const CHILD_UTILITY_SPECIFICITY = ":is(*, stg-x stg-x stg-x)";

/**
 * Lift the kit's zero-specificity child utilities (#3491). Tailwind writes
 * a parent's rules for its children (`stg:space-y-*`, `stg:divide-*`) inside
 * `:where()`, at (0,0,0), so that a child's own utility always beats them.
 * Unlayered, at zero they lose to any host element rule (`p { margin: 0 }`,
 * Tailwind 3's preflight) and tie with a host's `* {}` reset, and a stacked
 * kit surface collapses. At (0,0,3) they beat a host's bare element rules
 * and the kit's control hand-back ((0,0,2), the end of `src/styles.css`),
 * and still lose to a child's own utility ((0,1,0)).
 */
export function raiseChildUtilities(root: Root): void {
  root.walkRules((rule) => {
    if (enclosingLayer(rule) !== null) return;
    if (enclosingAtRuleNames(rule).some((n) => n.endsWith("keyframes"))) return;
    const lifted = rule.selectors.every(
      (selector) => selector.startsWith(":where(") && selector.includes(".stg\\:") && !selector.includes("::"),
    );
    if (!lifted) return;
    rule.selectors = rule.selectors.map((selector) =>
      selector.endsWith(CHILD_UTILITY_SPECIFICITY) ? selector : `${selector}${CHILD_UTILITY_SPECIFICITY}`,
    );
  });
}

