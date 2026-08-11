import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss, {
  type AtRule,
  type Rule,
  type Container,
  type Document as PostcssDocument,
} from "postcss";
import tailwindcss from "@tailwindcss/postcss";

// The directory of `styles.css` — `@source` globs and relative `@import`s inside
// it resolve from here, exactly as they do when a host app compiles it.
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Compile the SDK stylesheet the way the client apps actually do: the host's
 * Tailwind first (`@import "tailwindcss"`, which puts preflight in `base` and
 * utilities in `utilities`), then the SDK's `styles.css` layered on top. This is
 * the pipeline that broke every prior border fix — the standalone
 * `tailwindcss -i styles.css` build (which the apps never consume) hid the bug
 * because it lacks the competing host `utilities` layer.
 */
async function compileHostContext(): Promise<string> {
  const input = `@import "tailwindcss";\n@import "./styles.css";`;
  const result = await postcss([tailwindcss({ base: srcDir })]).process(input, {
    // A virtual entry inside src/ so `@import "./styles.css"` resolves to the
    // real SDK stylesheet under test.
    from: resolve(srcDir, "__border-layer-probe__.css"),
  });
  return result.css;
}

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

describe("styles.css border-layer invariant (host-compiled)", () => {
  // The class-name assertions in ToolCallItem/ApprovalCard tests prove the
  // markup *requests* a border; they run in happy-dom, which cannot resolve
  // `@layer` and so cannot prove the border actually *renders*. This compiles
  // the real host-context cascade and asserts the architecture that makes it
  // render: the scoped preflight reset must never outrank the border utilities.
  it("emits the .stgm border reset in `base`, below the `utilities` layer", async () => {
    const css = await compileHostContext();
    const root = postcss.parse(css);

    // 1) Scanning/generation works: the prominent border-color utility exists.
    //    (If this regresses, the border would silently fall back to the faint
    //    --stgm-border default — the dark-mode half of the original defect.)
    let prominentRule: Rule | null = null;
    root.walkRules((rule) => {
      if (rule.selector.includes(".border-border-prominent")) prominentRule = rule;
    });
    expect(
      prominentRule,
      "`.border-border-prominent` was not generated — host did not scan the SDK source",
    ).not.toBeNull();

    // 2) The reset (the rule that zeroes border-width on every .stgm descendant)
    //    must live in `base`, not in a layer declared after `utilities`.
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
      "the .stgm border reset must live in @layer base (it was placed in a layer above `utilities`, which silently zeroes every border inside .stgm)",
    ).toBe("base");

    // 3) Belt and suspenders: `base` is declared before `utilities`, so a later
    //    `border`/`border-*` utility wins the cascade.
    const layerOrder: string[] = [];
    root.walkAtRules("layer", (at) => {
      if (!at.nodes) return; // skip the bare `@layer a, b, c;` ordering statement
      const name = at.params.trim();
      if (name && !layerOrder.includes(name)) layerOrder.push(name);
    });
    const baseIdx = layerOrder.indexOf("base");
    const utilitiesIdx = layerOrder.indexOf("utilities");
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(utilitiesIdx).toBeGreaterThanOrEqual(0);
    expect(
      baseIdx,
      `expected @layer base (#${baseIdx}) to precede @layer utilities (#${utilitiesIdx}); order was [${layerOrder.join(", ")}]`,
    ).toBeLessThan(utilitiesIdx);
  });

  // The form-control preflight (#374) has the same one dangerous failure mode
  // as the border reset: land it in any layer above `utilities` and it
  // silently overrides every `bg-*`/`p-*` utility on every button in the SDK.
  // Same harness, same invariant — pinned separately because the rule is
  // found by a different fingerprint (background-color on `.stgm button`).
  it("emits the .stgm form-control preflight in `base`, below the `utilities` layer", async () => {
    const css = await compileHostContext();
    const root = postcss.parse(css);

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
      "the .stgm form-control preflight must live in @layer base (a layer above `utilities` silently overrides every bg-*/p-* utility on every button in the SDK)",
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
