import { describe, expect, it } from "vitest";
import postcss, { type AtRule, type Container, type Rule, type Root } from "postcss";
import selectorParser from "postcss-selector-parser";
import { compileSdkStylesheet } from "./helpers/compile-sdk-styles";

/**
 * The #454 isolation invariant: NOTHING in the shipped SDK stylesheet may
 * match a host application's DOM outside the `.stgm` scope containers.
 *
 * Before this invariant, the stylesheet emitted bare Tailwind utilities
 * (`.relative`, `.grid-cols-1`, `.container`) inside `@layer stgm` — which
 * the SDK's own layer-order declaration pins ABOVE a host's `utilities`
 * layer. Loading the stylesheet silently broke any host element pairing a
 * base utility with a variant override of the same property
 * (`grid-cols-1 @xl:grid-cols-[...]`, `relative max-lg:fixed`) — permanently,
 * regardless of load order. Observed in production (Stigmer Law).
 *
 * Every rule must therefore fall in exactly one of these categories:
 *
 *  1. `stg:`-prefixed — Tailwind utilities under the #454 prefix
 *     (`.stg\:flex`). Collision-free by NAME: a host's Tailwind never emits
 *     these class names.
 *  2. `.stgm`-anchored — the scope container itself, hand-written
 *     `.stgm .hljs-*` rules, and everything carrying the
 *     `:where(.stgm, .stgm *)` guard added by the build's scoping pass
 *     (xyflow, the `@layer properties` block).
 *  3. `stgm-`-prefixed classes — hand-written component classes
 *     (`.stgm-thread-item-enter`) and theme presets (`.stgm-theme-*`).
 *  4. `:root`/`:host` rules whose declarations are ALL namespaced custom
 *     properties: `--stgm-*` (the public token contract — deliberately on
 *     `:root`, because custom properties resolve by inheritance PROXIMITY:
 *     moving the defaults onto `.stgm` would shadow the documented
 *     `:root { --stgm-primary: ... }` host override channel) or `--stg-*`
 *     (Tailwind theme variables under the prefix).
 *
 * Allowed globals, by name rather than selector:
 *  - `@property --tw-*` / `--stg-*` registrations (inherently global;
 *    duplicate identical registrations are a no-op).
 *  - `@keyframes` (cannot be selector-scoped; Tailwind names like `spin`
 *    collide only with identical definitions from the same Tailwind version,
 *    and our own animations use `stgm-*` names).
 *
 * This makes the entire leak CLASS a test failure — not just the two
 * symptoms the issue reported.
 */

/** The names of all at-rules enclosing a node, outermost first. */
function enclosingAtRuleNames(node: Rule | AtRule): string[] {
  const names: string[] = [];
  let parent: Container | undefined = node.parent as Container | undefined;
  while (parent) {
    if (parent.type === "atrule") names.unshift((parent as AtRule).name);
    parent = parent.parent as Container | undefined;
  }
  return names;
}

/**
 * Category check for a single selector (one comma-separated alternative).
 * Implemented independently of the build's scoping pass on purpose: the test
 * must not share the code it verifies.
 */
function selectorIsIsolated(selector: string): boolean {
  let isolated = false;
  try {
    selectorParser((sel) => {
      sel.walkClasses((cls) => {
        if (
          cls.value.startsWith("stg:") ||
          cls.value === "stgm" ||
          cls.value.startsWith("stgm-")
        ) {
          isolated = true;
        }
      });
      // `data-stgm-*` attributes are the SDK's public selector namespace
      // (data-stgm-root, data-stgm-portal, data-stgm-color-mode) — a host
      // element matches only by explicitly opting into it.
      sel.walkAttributes((attr) => {
        if (attr.attribute.startsWith("data-stgm-")) isolated = true;
      });
    }).processSync(selector);
  } catch {
    return false;
  }
  return isolated;
}

/**
 * A rule is isolated when its own selectors are, OR when it is nested inside
 * an isolated rule (`&`-relative selectors cannot match anything the parent
 * does not already scope — e.g. the unminified compile keeps
 * `.stg\:[&>button:hover]:...` utilities as nested `&>button:hover` rules;
 * the shipped minifier flattens these).
 */
function ruleIsIsolated(rule: Rule): boolean {
  if (rule.selectors.every(selectorIsIsolated)) return true;
  let parent: Container | undefined = rule.parent as Container | undefined;
  while (parent) {
    if (parent.type === "rule" && (parent as Rule).selectors.every(selectorIsIsolated)) {
      return true;
    }
    parent = parent.parent as Container | undefined;
  }
  return false;
}

/** `:root` / `:host`-only selector? (Tolerates `:where()`-wrapped forms.) */
function isRootSelector(selector: string): boolean {
  return selector
    .split(",")
    .every((part) => /^\s*:(root|host|where\(\s*:(root|host)\s*\))\s*$/.test(part.trim()));
}

function ruleViolations(root: Root): string[] {
  const violations: string[] = [];
  root.walkRules((rule) => {
    const atRules = enclosingAtRuleNames(rule);
    if (atRules.some((n) => n === "keyframes" || n.endsWith("keyframes"))) {
      return; // allowed global (see header)
    }
    if (isRootSelector(rule.selector)) {
      // Category 4: every declaration must be a namespaced custom property.
      rule.walkDecls((decl) => {
        if (!/^--stgm?-/.test(decl.prop)) {
          violations.push(
            `:root rule declares non-namespaced property \`${decl.prop}\` — ` +
              `it would apply to the host's document root`,
          );
        }
      });
      return;
    }
    if (!ruleIsIsolated(rule)) {
      violations.push(
        `unisolated selector \`${rule.selector}\`` +
          (atRules.length > 0 ? ` (inside @${atRules.join(" @")})` : ""),
      );
    }
  });
  return violations;
}

describe("styles.css dist isolation invariant (#454)", () => {
  it("emits no selector that can match host DOM outside the .stgm scope", async () => {
    const root = await compileSdkStylesheet();

    // Sanity: this is a real build, not an empty compile.
    let ruleCount = 0;
    root.walkRules(() => {
      ruleCount++;
    });
    expect(ruleCount).toBeGreaterThan(500);

    const violations = ruleViolations(root);
    expect(
      violations,
      `the shipped stylesheet leaks into host pages:\n  ${violations.slice(0, 20).join("\n  ")}` +
        (violations.length > 20 ? `\n  ... and ${violations.length - 20} more` : ""),
    ).toEqual([]);
  });

  it("@property registrations stay in the internal variable namespaces", async () => {
    const root = await compileSdkStylesheet();
    const offenders: string[] = [];
    let count = 0;
    root.walkAtRules("property", (at) => {
      count++;
      if (!/^--(tw|stg)-/.test(at.params.trim())) offenders.push(at.params.trim());
    });
    expect(count).toBeGreaterThan(0);
    expect(
      offenders,
      "a global @property registration outside --tw-*/--stg-* could clobber a host-registered property",
    ).toEqual([]);
  });

  it("negative control: a bare utility selector is detected as a leak", async () => {
    // Prove the walker actually catches the defect class this test exists
    // for: inject the exact shape the pre-#454 stylesheet shipped.
    const root = postcss.parse(
      "@layer stgm{.relative{position:relative}.stg\\:flex{display:flex}}",
    );
    const violations = ruleViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(".relative");
  });

  it("negative control: non-custom-property declarations on :root are detected", async () => {
    const root = postcss.parse(":root{--stgm-x:1;color:red}");
    const violations = ruleViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("color");
  });
});
