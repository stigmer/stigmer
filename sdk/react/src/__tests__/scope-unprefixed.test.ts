import { describe, expect, it } from "vitest";
import postcss from "postcss";
import { scopeUnprefixedSelectors } from "../../scripts/lib/scope-unprefixed";

/**
 * Fixture-level pins for the build's scoping pass (stage 2 of
 * `scripts/build-styles.ts`). The dist isolation invariant proves the OUTPUT
 * is fully scoped; these pins prove the transform handles each selector shape
 * the way the cascade requires — especially pseudo-element placement, where a
 * guard in the wrong position is invalid CSS that a browser silently drops.
 */

function transform(css: string): string {
  const root = postcss.parse(css);
  scopeUnprefixedSelectors(root);
  return root.toString();
}

describe("scopeUnprefixedSelectors", () => {
  it("scopes unlayered rules (a vendor stylesheet tail) on the subject compound", () => {
    expect(transform(".vendor__node{position:absolute}")).toBe(
      ".vendor__node:where(.stgm, .stgm *){position:absolute}",
    );
  });

  it("scopes only the subject of a complex selector", () => {
    expect(transform(".vendor .vendor__edge>path{stroke:red}")).toBe(
      ".vendor .vendor__edge>path:where(.stgm, .stgm *){stroke:red}",
    );
  });

  it("places the guard BEFORE pseudo-elements (double- and single-colon)", () => {
    expect(transform("*::before{content:''}")).toBe(
      "*:where(.stgm, .stgm *)::before{content:''}",
    );
    // Minifier output uses legacy single-colon spellings.
    expect(transform(".x:before{content:''}")).toBe(
      ".x:where(.stgm, .stgm *):before{content:''}",
    );
    expect(transform("::backdrop{--tw-x:0}")).toBe(
      ":where(.stgm, .stgm *)::backdrop{--tw-x:0}",
    );
  });

  it("keeps pseudo-CLASSES inside the guarded compound", () => {
    expect(transform(".vendor__pane:hover{cursor:grab}")).toBe(
      ".vendor__pane:hover:where(.stgm, .stgm *){cursor:grab}",
    );
  });

  it("scopes every alternative of a selector list", () => {
    expect(transform("a,.b{color:red}")).toBe(
      "a:where(.stgm, .stgm *),.b:where(.stgm, .stgm *){color:red}",
    );
  });

  it("scopes @layer properties rules (universal --tw-* initial values)", () => {
    expect(
      transform("@layer properties{*,::before{--tw-translate-x:0}}"),
    ).toBe(
      "@layer properties{*:where(.stgm, .stgm *),:where(.stgm, .stgm *)::before{--tw-translate-x:0}}",
    );
  });

  it("leaves named layers other than `properties` untouched (prefix covers them)", () => {
    const stgm = "@layer stgm{.stg\\:flex{display:flex}}";
    expect(transform(stgm)).toBe(stgm);
    const base = "@layer base{.stgm *{border-width:0}}";
    expect(transform(base)).toBe(base);
  });

  it("leaves the kit's own unlayered stg: utilities untouched (#3491)", () => {
    // Their names already keep them off host elements; a guard would stop
    // them applying to a kit part rendered outside a `.stgm` container.
    const utility = ".stg\\:flex{display:flex}";
    expect(transform(utility)).toBe(utility);
    const variant = ".stg\\:peer-checked\\:opacity-100:is(:where(.stg\\:peer):checked~*){opacity:1}";
    expect(transform(variant)).toBe(variant);
    // A list that mixes in an unprefixed alternative is still scoped whole.
    expect(transform(".stg\\:flex,.vendor{display:flex}")).toBe(
      ".stg\\:flex:where(.stgm, .stgm *),.vendor:where(.stgm, .stgm *){display:flex}",
    );
  });

  it("leaves keyframe steps untouched", () => {
    const kf = "@keyframes spin{to{transform:rotate(360deg)}}";
    expect(transform(kf)).toBe(kf);
  });

  it("leaves already-.stgm-scoped unlayered rules untouched", () => {
    const scoped = ".stgm .hljs{color:red}";
    expect(transform(scoped)).toBe(scoped);
  });

  it("is idempotent", () => {
    const once = transform(".vendor{direction:ltr}");
    expect(transform(once)).toBe(once);
  });
});
