import { describe, expect, it } from "vitest";

import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { ENTERPRISE_CLOUD_PLAN, FEATURE_COPY, type NamedFeature, type SessionRunConfig } from "../index.js";

// Root-surface pin (oss#802): the package's exports map exposes only the root
// barrel, so a type an embedder must name has to be re-exported from
// src/index.ts. The type-only import above is enforced by the typecheck gate
// (`tsc --noEmit`), which fails this file if the root export regresses —
// vitest alone would not catch it (esbuild strips types unchecked).
describe("public API surface", () => {
  it("SessionRunConfig is importable from the package root", () => {
    // Compile-time is the real assertion; construct a value against the type
    // so the import cannot be flagged unused.
    const pinned: SessionRunConfig = {
      modelName: "claude-opus-5",
      serviceTier: "fast",
      thinkingMode: "enabled",
    };
    expect(pinned.modelName).toBe("claude-opus-5");
  });

  // stigmer.ai's pricing page renders plan features through these, so the
  // site and the console name a feature alike.
  it("the plan vocabulary is importable from the package root", () => {
    const named: NamedFeature = Feature.access_history;
    expect(FEATURE_COPY[named].label).toBe("Access history");
    expect(ENTERPRISE_CLOUD_PLAN.features).toContain(named);
  });
});
