import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, isColorValue, lightnessDelta, parseColor } from "../color.js";

describe("contrastRatio", () => {
  it("computes the canonical black-on-white ratio", () => {
    expect(contrastRatio("black", "white")).toBeCloseTo(21, 5);
    expect(contrastRatio("white", "white")).toBeCloseTo(1, 5);
  });

  it("parses OKLCH token values", () => {
    // Dark-mode foreground on background from tokens.css — a high-contrast pair.
    const ratio = contrastRatio("oklch(0.985 0 0)", "oklch(0.145 0 0)");
    expect(ratio).toBeGreaterThan(15);
  });

  it("composites a translucent foreground over the background first", () => {
    // 50% white over black is a grey; contrast must be far below solid white's.
    const solid = contrastRatio("white", "black");
    const translucent = contrastRatio("rgb(255 255 255 / 50%)", "black");
    expect(translucent).toBeLessThan(solid);
    expect(translucent).toBeGreaterThan(1);
  });

  it("requires a backdrop for a translucent background", () => {
    expect(() => contrastRatio("white", "oklch(1 0 0 / 14%)")).toThrow(/backdropValue/);
    const ratio = contrastRatio("white", "oklch(1 0 0 / 14%)", "oklch(0.145 0 0)");
    expect(ratio).toBeGreaterThan(1);
  });
});

describe("compositeOver", () => {
  it("returns the foreground unchanged when opaque", () => {
    const fg = parseColor("rgb(10 20 30)");
    expect(compositeOver(fg, parseColor("white"))).toBe(fg);
  });

  it("blends channels linearly by alpha in sRGB", () => {
    const result = compositeOver(parseColor("rgb(255 255 255 / 50%)"), parseColor("black"));
    expect(result.r).toBeCloseTo(0.5, 5);
    expect(result.g).toBeCloseTo(0.5, 5);
    expect(result.b).toBeCloseTo(0.5, 5);
    expect(result.alpha).toBe(1);
  });
});

describe("lightnessDelta", () => {
  it("measures OKLCH lightness separation", () => {
    expect(lightnessDelta("oklch(0.21 0 0)", "oklch(0.145 0 0)")).toBeCloseTo(0.065, 3);
    expect(lightnessDelta("white", "white")).toBeCloseTo(0, 5);
  });

  it("composites a translucent fill over the surface first", () => {
    // The default dark --stgm-input (20% white) over the popover surface:
    // raw white would report a delta near 0.73; the painted fill is far
    // dimmer but still clearly separated.
    const delta = lightnessDelta("oklch(1 0 0 / 20%)", "oklch(0.269 0 0)");
    expect(delta).toBeGreaterThan(0.045);
    expect(delta).toBeLessThan(0.5);
  });

  it("rejects a translucent surface (nothing to composite onto)", () => {
    expect(() => lightnessDelta("white", "oklch(1 0 0 / 14%)")).toThrow(/opaque surface/);
  });
});

describe("isColorValue", () => {
  it("distinguishes colors from other token values", () => {
    expect(isColorValue("oklch(0.5 0.1 190)")).toBe(true);
    expect(isColorValue("0.625rem")).toBe(false);
    expect(isColorValue("var(--font-geist-sans, system-ui, sans-serif)")).toBe(false);
  });
});
