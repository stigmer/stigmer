/**
 * Pins the runLanes driver point in the single-instance shape the registry
 * enforces for the visitor classifier:
 *
 *   - `drivers.runLanes` — the lanes an edition's visitors' turns come
 *     through, read by ResolveRunConfig; single instance; absent = only the
 *     core lanes, open source's own posture.
 *
 * What the step does with it is pinned beside the step
 * (domain/run/__tests__/resolve-run-config.test.ts).
 */
import { describe, expect, it } from "vitest";

import { resolveExtensions } from "../registry.js";
import type { RunLanes } from "../run-lanes.js";

const none: RunLanes = { laneOf: () => Promise.resolve(undefined) };

describe("the runLanes driver point", () => {
  it("is undefined with no extensions — every turn is a core lane's", () => {
    expect(resolveExtensions([]).drivers.runLanes).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-lanes", drivers: { runLanes: none } },
    ]);
    expect(resolved.drivers.runLanes).toBe(none);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "lanes-a", drivers: { runLanes: none } },
        { name: "lanes-b", drivers: { runLanes: none } },
      ]),
    ).toThrowError(/extension 'lanes-b' registers RunLanes, but 'lanes-a' already did/);
  });
});
