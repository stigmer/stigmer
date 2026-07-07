import { describe, expect, it } from "vitest";
import { parseThemeCss } from "../parse.js";
import { presetLightLeaksIntoDark, resolveTokens } from "../resolve.js";

const DEFAULTS = parseThemeCss(`
:root {
  --stgm-background: light-default;
  --stgm-foreground: light-default;
  --stgm-primary: light-default;
}
[data-stgm-color-mode="dark"] {
  --stgm-background: dark-default;
  --stgm-primary: dark-default;
}
`);

const PRESET = parseThemeCss(`
.stgm-theme-x {
  --stgm-background: light-preset;
  --stgm-primary: light-preset;
}
[data-stgm-color-mode="dark"] .stgm-theme-x,
.stgm-theme-x[data-stgm-color-mode="dark"] {
  --stgm-background: dark-preset;
}
`);

describe("resolveTokens", () => {
  it("light mode without preset uses :root values", () => {
    const resolved = resolveTokens(DEFAULTS, undefined, "light");
    expect(resolved.get("--stgm-background")).toMatchObject({
      value: "light-default",
      source: "default-light",
    });
  });

  it("dark mode without preset overlays the dark block, falling back to light", () => {
    const resolved = resolveTokens(DEFAULTS, undefined, "dark");
    expect(resolved.get("--stgm-background")?.value).toBe("dark-default");
    // --stgm-foreground has no dark declaration: inherits the light value.
    expect(resolved.get("--stgm-foreground")).toMatchObject({
      value: "light-default",
      source: "default-light",
    });
  });

  it("light mode with preset prefers preset-light over defaults", () => {
    const resolved = resolveTokens(DEFAULTS, PRESET, "light");
    expect(resolved.get("--stgm-background")?.value).toBe("light-preset");
    expect(resolved.get("--stgm-foreground")?.value).toBe("light-default");
  });

  it("dark mode with preset resolves preset-dark ?? preset-light ?? default-dark ?? default-light", () => {
    const resolved = resolveTokens(DEFAULTS, PRESET, "dark");
    // Defined in the preset dark block: preset-dark wins.
    expect(resolved.get("--stgm-background")).toMatchObject({
      value: "dark-preset",
      source: "preset-dark",
    });
    // Defined in preset light only: the preset-light value leaks into dark
    // (higher cascade priority than the default dark block).
    expect(resolved.get("--stgm-primary")).toMatchObject({
      value: "light-preset",
      source: "preset-light",
    });
    // Untouched by the preset: default dark... which doesn't exist for
    // foreground, so default light.
    expect(resolved.get("--stgm-foreground")?.value).toBe("light-default");
  });
});

describe("presetLightLeaksIntoDark", () => {
  it("flags tokens the preset defines light-only while defaults have a dark value", () => {
    expect(presetLightLeaksIntoDark(DEFAULTS, PRESET)).toEqual(["--stgm-primary"]);
  });

  it("does not flag tokens with no default dark value (nothing to leak over)", () => {
    const preset = parseThemeCss(`
.stgm-theme-y {
  --stgm-foreground: light-preset;
}
`);
    expect(presetLightLeaksIntoDark(DEFAULTS, preset)).toEqual([]);
  });
});
