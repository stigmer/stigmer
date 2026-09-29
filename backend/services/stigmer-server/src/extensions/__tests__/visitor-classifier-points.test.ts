/**
 * Pins the visitorClassifier driver point in the single-instance shape the
 * registry already enforces for outboundEgress and licenseStatus:
 *
 *   - `drivers.visitorClassifier` — which callers are visitors, read by
 *     ComposeDeclaredPreferences to withhold the organization's standing
 *     context (stigmer/stigmer#1401); single instance; absent = nobody is
 *     a visitor, open source's own posture.
 *
 * What the step does with it is pinned beside the step
 * (domain/agentexecution/__tests__/create-steps.test.ts).
 */
import { describe, expect, it } from "vitest";

import { resolveExtensions } from "../registry.js";
import type { VisitorClassifier } from "../visitor-classifier.js";

const nobody: VisitorClassifier = { isVisitor: () => false };

describe("the visitorClassifier driver point", () => {
  it("is undefined with no extensions — nobody is a visitor", () => {
    expect(resolveExtensions([]).drivers.visitorClassifier).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-sharing", drivers: { visitorClassifier: nobody } },
    ]);
    expect(resolved.drivers.visitorClassifier).toBe(nobody);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "visitors-a", drivers: { visitorClassifier: nobody } },
        { name: "visitors-b", drivers: { visitorClassifier: nobody } },
      ]),
    ).toThrowError(
      /extension 'visitors-b' registers a VisitorClassifier, but 'visitors-a' already did/,
    );
  });
});
