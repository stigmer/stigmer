import { describe, it, expect } from "vitest";
import { type AtRule, type Rule, type Container, type Document as PostcssDocument } from "postcss";
import { compileSdkStylesheet } from "./helpers/compile-sdk-styles";

/**
 * The border-layer invariant: the `.stgm` preflight-style reset (which zeroes
 * `border-width` on every descendant) must never outrank the `border-*`
 * utilities, or every border inside `.stgm` silently disappears — the defect
 * that shipped twice before this test existed.
 *
 * Since #454 the SDK stylesheet is a self-contained compiled artifact (client
 * apps and hosts consume `dist/styles.css`; nobody recompiles the source), so
 * the cascade under test is the standalone build's own. Since #3491 it is a
 * ladder (the header of `src/styles.css`): the resets live in `base`; the
 * `stg:`-prefixed utilities ship unlayered, so they outrank every layer, the
 * resets included, and meet a host's own unlayered CSS by specificity; and
 * the one unlayered control rule only hands properties back to the layers
 * (`revert-layer`), at a specificity below a utility's.
 */

/** The nearest enclosing `@layer <name>` of a node, or null if unlayered. */
function enclosingLayer(node: Rule | AtRule): string | null {
  let parent: Container | PostcssDocument | undefined = node.parent;
  while (parent) {
    if (parent.type === "atrule") {
      const at = parent as AtRule;
      if (at.name === "layer" && at.params) return at.params.trim();
    }
    parent = parent.parent;
  }
  return null;
}

describe("styles.css border-layer invariant", () => {
  it("emits the .stgm border reset in `base`, below the unlayered utilities", async () => {
    const root = await compileSdkStylesheet();

    // 1) Scanning/generation works: the prominent border-color utility exists,
    //    under the #454 prefix. (If this regresses, the border would silently
    //    fall back to the faint --stgm-border default — the dark-mode half of
    //    the original defect.)
    let prominentRule: Rule | null = null;
    root.walkRules((rule) => {
      if (rule.selector.includes(".stg\\:border-border-prominent")) {
        prominentRule = rule;
      }
    });
    expect(
      prominentRule,
      "`.stg\\:border-border-prominent` was not generated — @source scanning or the stg: prefix broke",
    ).not.toBeNull();
    expect(
      enclosingLayer(prominentRule!),
      "border utilities must ship unlayered: a host's unlayered reset (`* { border-width: 0 }`) beats every layered rule (#3491)",
    ).toBeNull();

    // 2) The reset (the rule that zeroes border-width on every .stgm
    //    descendant) must live in `base`, declared before `stgm`.
    let resetRule: Rule | null = null;
    root.walkRules((rule) => {
      if (!rule.selector.includes(".stgm")) return;
      const zeroesBorder = rule.some(
        (decl) =>
          decl.type === "decl" &&
          decl.prop === "border-width" &&
          decl.value.trim() === "0",
      );
      if (zeroesBorder) resetRule = rule;
    });
    expect(resetRule, "the .stgm border-width:0 reset was not found").not.toBeNull();
    expect(
      enclosingLayer(resetRule!),
      "the .stgm border reset must live in @layer base (a reset in a layer above the utilities silently zeroes every border inside .stgm)",
    ).toBe("base");

    // 3) The normative layer order comes from the bare `@layer a, b, c;`
    //    declaration at the top of the stylesheet: `base` must precede `stgm`.
    let order: string[] | null = null;
    root.walkAtRules("layer", (at) => {
      if (at.nodes) return; // only the bare ordering statement
      const names = at.params.split(",").map((s) => s.trim());
      if (!order && names.includes("base") && names.includes("stgm")) {
        order = names;
      }
    });
    expect(order, "the @layer ordering declaration is missing").not.toBeNull();
    expect(
      order!.indexOf("base"),
      `expected base before stgm in [${order!.join(", ")}]`,
    ).toBeLessThan(order!.indexOf("stgm"));
  });

  // The form-control preflight (#374) has the same one dangerous failure mode
  // as the border reset: land it in any layer above the SDK's utilities and
  // it silently overrides every `stg:bg-*`/`stg:p-*` utility on every button
  // in the SDK. Same harness, same invariant — pinned separately because the
  // rule is found by a different fingerprint (background-color on
  // `.stgm button`).
  it("emits the .stgm form-control preflight in `base`, below the unlayered utilities", async () => {
    const root = await compileSdkStylesheet();

    let controlRule: Rule | null = null;
    root.walkRules((rule) => {
      if (!rule.selector.includes(".stgm button")) return;
      const clearsBackground = rule.some(
        (decl) =>
          decl.type === "decl" &&
          decl.prop === "background-color" &&
          decl.value.trim() === "transparent",
      );
      if (clearsBackground) controlRule = rule;
    });
    expect(
      controlRule,
      "the .stgm form-control preflight (background-color: transparent on .stgm button) was not found",
    ).not.toBeNull();
    expect(
      enclosingLayer(controlRule!),
      "the .stgm form-control preflight must live in @layer base (a layer above the utilities silently overrides every stg:bg-*/stg:p-* utility on every button in the SDK)",
    ).toBe("base");

    // The block must cover all five control elements, not just button —
    // an accidental selector trim would silently re-expose the UA defaults
    // on inputs/textareas in preflight-less hosts.
    for (const control of ["input", "select", "optgroup", "textarea"]) {
      expect(
        controlRule!.selector,
        `the form-control preflight selector must include .stgm ${control}`,
      ).toContain(`.stgm ${control}`);
    }
  });

  // The one unlayered rule on the kit's controls (#3491) takes a host's bare
  // `button {}` off them. It must stay a hand-back, never a value: any value
  // it set, unlayered, would beat every class a Tailwind 4 host passes
  // through `className` and every host control inside the provider; and its
  // specificity must stay below a utility's (0,1,0), or it would beat the
  // kit's own `stg:p-*` and `stg:bg-*` on every button.
  it("hands the form-control properties back with revert-layer, unlayered, below a utility", async () => {
    const root = await compileSdkStylesheet();

    let handBack: Rule | null = null;
    root.walkRules((rule) => {
      if (rule.selector.includes(":where(.stgm)") && rule.selector.includes("button")) handBack = rule;
    });
    expect(handBack, "the unlayered control rule was not found").not.toBeNull();
    expect(enclosingLayer(handBack!), "the control rule must be unlayered to outrank a host's bare element rules").toBeNull();
    const declarations = handBack!.nodes.filter((node) => node.type === "decl");
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration.value.trim(), `${declaration.prop} must be revert-layer`).toBe("revert-layer");
    }
    for (const property of ["padding", "background-color", "border", "border-radius"]) {
      expect(declarations.map((declaration) => declaration.prop)).toContain(property);
    }
    expect(handBack!.selector, "only the kit's own controls (a stg: class)").toMatch(/:where\(\[class\*=("?)stg\\?:\1\]\)/);
    // (0,0,2): two element-type compounds; `:where()` adds nothing.
    const counted = handBack!.selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
    expect(counted, "no class, attribute or id may count toward its specificity").not.toMatch(/[.#[]/);
  });
});

