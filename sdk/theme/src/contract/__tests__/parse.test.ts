import { describe, expect, it } from "vitest";
import { parseThemeCss } from "../parse.js";

describe("parseThemeCss", () => {
  it("splits :root and dark-attribute blocks into light and dark maps", () => {
    const css = `
:root {
  --stgm-background: oklch(0.98 0 0);
  --stgm-foreground: oklch(0.145 0 0);
}

[data-stgm-color-mode="dark"] {
  --stgm-background: oklch(0.145 0 0);
}
`;
    const { light, dark } = parseThemeCss(css);
    expect(light.get("--stgm-background")?.value).toBe("oklch(0.98 0 0)");
    expect(light.get("--stgm-foreground")?.value).toBe("oklch(0.145 0 0)");
    expect(dark.get("--stgm-background")?.value).toBe("oklch(0.145 0 0)");
    expect(dark.has("--stgm-foreground")).toBe(false);
  });

  it("classifies the preset dual dark selector spanning multiple lines", () => {
    const css = `
.stgm-theme-x {
  --stgm-primary: oklch(0.5 0.2 250);
}

[data-stgm-color-mode="dark"] .stgm-theme-x,
.stgm-theme-x[data-stgm-color-mode="dark"] {
  --stgm-primary: oklch(0.7 0.2 250);
}
`;
    const { light, dark } = parseThemeCss(css);
    expect(light.get("--stgm-primary")?.value).toBe("oklch(0.5 0.2 250)");
    expect(dark.get("--stgm-primary")?.value).toBe("oklch(0.7 0.2 250)");
  });

  it("keeps values containing semicolons-free complex expressions intact", () => {
    const css = `
:root {
  --stgm-shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --stgm-font-sans: var(--font-geist-sans, system-ui, sans-serif);
  --stgm-backdrop: oklch(0.98 0 0 / 80%);
}
`;
    const { light } = parseThemeCss(css);
    expect(light.get("--stgm-shadow-sm")?.value).toBe(
      "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
    );
    expect(light.get("--stgm-font-sans")?.value).toBe(
      "var(--font-geist-sans, system-ui, sans-serif)",
    );
    expect(light.get("--stgm-backdrop")?.value).toBe("oklch(0.98 0 0 / 80%)");
  });

  it("attaches @group headers and per-token descriptions", () => {
    const css = `
:root {
  /* @group Core colors */
  /* Page background behind all content. */
  --stgm-background: oklch(0.98 0 0);
  --stgm-foreground: oklch(0.145 0 0);

  /* @group Shape */
  --stgm-radius: 0.625rem;
}
`;
    const { light } = parseThemeCss(css);
    expect(light.get("--stgm-background")).toMatchObject({
      group: "Core colors",
      description: "Page background behind all content.",
    });
    // The description belongs only to the token directly beneath it.
    expect(light.get("--stgm-foreground")).toMatchObject({ group: "Core colors" });
    expect(light.get("--stgm-foreground")?.description).toBeUndefined();
    expect(light.get("--stgm-radius")).toMatchObject({ group: "Shape" });
  });

  it("ignores multi-line file header comments", () => {
    const css = `
/* Corporate — Enterprise SaaS design language
   Tight radius, corporate blue */

.stgm-theme-corporate {
  --stgm-radius: 0.375rem;
}
`;
    const { light } = parseThemeCss(css);
    expect(light.get("--stgm-radius")?.value).toBe("0.375rem");
    expect(light.get("--stgm-radius")?.description).toBeUndefined();
  });

  it("ignores non-stgm declarations", () => {
    const css = `
:root {
  --other-token: red;
  color: blue;
  --stgm-primary: oklch(0.5 0.1 190);
}
`;
    const { light } = parseThemeCss(css);
    expect(light.size).toBe(1);
    expect(light.has("--stgm-primary")).toBe(true);
  });
});
