// Pins the name a new plugin eval gets: the plugin's name and the start
// time to the second in UTC, so two evals of one plugin get two slugs.

import { describe, expect, it } from "vitest";
import { pluginEvalName } from "../eval-name.js";

describe("pluginEvalName", () => {
  it("names an eval after its plugin and its start, to the second, in UTC", () => {
    expect(pluginEvalName("thermos", new Date(Date.UTC(2026, 9, 10, 5, 40, 12, 345)))).toBe(
      "thermos evals 2026-10-10 05:40:12 UTC",
    );
  });

  it("names a plugin with no name 'plugin'", () => {
    expect(pluginEvalName("  ", new Date(0))).toBe("plugin evals 1970-01-01 00:00:00 UTC");
  });
});
