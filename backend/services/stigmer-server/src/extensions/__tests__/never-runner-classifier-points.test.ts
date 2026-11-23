/**
 * Pins the neverRunnerClassifier driver point in the single-instance shape
 * the registry enforces for the visitor classifier beside it:
 *
 *   - `drivers.neverRunnerClassifier`: which callers are never runners,
 *     whatever they are permitted on, read by the runner artifact lane to
 *     refuse them before the authorizer is asked (stigmer/stigmer#3444);
 *     single instance; absent = no caller is ruled out, open source's own
 *     posture;
 *   - it is its own point: registering it leaves the visitor classifier
 *     undefined, and the reverse.
 *
 * What the lane does with it is pinned beside the lane
 * (artifactstorage/runner-lane/__tests__/authorize.test.ts).
 */
import { describe, expect, it } from "vitest";

import type { NeverRunnerClassifier } from "../never-runner-classifier.js";
import { resolveExtensions } from "../registry.js";
import type { VisitorClassifier } from "../visitor-classifier.js";

const nobody: NeverRunnerClassifier = { isNeverRunner: () => false };
const noVisitors: VisitorClassifier = { isVisitor: () => false };

describe("the neverRunnerClassifier driver point", () => {
  it("is undefined with no extensions: no caller is ruled out", () => {
    expect(resolveExtensions([]).drivers.neverRunnerClassifier).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { neverRunnerClassifier: nobody } },
    ]);
    expect(resolved.drivers.neverRunnerClassifier).toBe(nobody);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "lanes-a", drivers: { neverRunnerClassifier: nobody } },
        { name: "lanes-b", drivers: { neverRunnerClassifier: nobody } },
      ]),
    ).toThrowError(
      /extension 'lanes-b' registers a NeverRunnerClassifier, but 'lanes-a' already did/,
    );
  });

  it("is a point of its own, apart from the visitor classifier", () => {
    const onlyRunners = resolveExtensions([
      { name: "lanes", drivers: { neverRunnerClassifier: nobody } },
    ]);
    expect(onlyRunners.drivers.visitorClassifier).toBeUndefined();
    const onlyVisitors = resolveExtensions([
      { name: "visitors", drivers: { visitorClassifier: noVisitors } },
    ]);
    expect(onlyVisitors.drivers.neverRunnerClassifier).toBeUndefined();
    const both = resolveExtensions([
      { name: "visitors", drivers: { visitorClassifier: noVisitors } },
      { name: "lanes", drivers: { neverRunnerClassifier: nobody } },
    ]);
    expect(both.drivers.visitorClassifier).toBe(noVisitors);
    expect(both.drivers.neverRunnerClassifier).toBe(nobody);
  });
});
