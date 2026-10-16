/**
 * Pins resolvePresetClass, the lookup StigmerProvider's `preset` prop goes
 * through: a built-in id answers its preset's root class, `default` answers
 * no class, and an id that names no preset (a JavaScript caller the type
 * cannot guard) answers no class too, with a warning outside production
 * that names the package, the id and every id it could have been, and in
 * production in silence.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePresetClass, THEME_PRESETS, type ThemePresetId } from "../index";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolvePresetClass", () => {
  it("answers each built-in preset's root class", () => {
    expect(resolvePresetClass("corporate")).toBe("stgm-theme-corporate");
    for (const preset of THEME_PRESETS) {
      expect(resolvePresetClass(preset.id)).toBe(preset.className);
    }
  });

  it("answers no class for the default preset, without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolvePresetClass("default")).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns outside production about an unknown id, naming every available one", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(resolvePresetClass("neon" as ThemePresetId)).toBe("");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[@stigmer/design-tokens] Unknown preset "neon". ' +
        "Available: default, corporate, startup, friendly, fintech, monochrome",
    );
  });

  it("answers no class for an unknown id in production, in silence", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(resolvePresetClass("neon" as ThemePresetId)).toBe("");

    expect(warn).not.toHaveBeenCalled();
  });
});
