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
 * the cascade under test is the standalone build's own layer order: the reset
 * lives in `base`, the `stg:`-prefixed utilities live in `stgm`, and the
 * `@layer theme, base, components, utilities, stgm` declaration pins
 * `base` below `stgm`. (Pre-#454 this test compiled a simulated host context,
 * because hosts inlined the SDK source into their own Tailwind build and the
 * utilities landed in the HOST's `utilities` layer — that pipeline no longer
 * exists.)
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
  it("emits the .stgm border reset in `base`, below the utilities in `stgm`", async () => {
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
      "border utilities must live in @layer stgm (the standalone build's utility layer)",
    ).toBe("stgm");

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
  it("emits the .stgm form-control preflight in `base`, below the utilities in `stgm`", async () => {
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
});
