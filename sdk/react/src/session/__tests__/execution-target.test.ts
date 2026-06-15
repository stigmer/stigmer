import { describe, it, expect } from "vitest";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  toProtoExecutionTarget,
  fromProtoExecutionTarget,
  type ExecutionTargetOption,
} from "../execution-target";
// Public-API contract guard (issue #171): ExecutionTargetOption must stay
// re-exported from the package root so consumers can type the
// StigmerProvider `executionTarget` prop. This guarantee is enforced at
// compile time by `tsc` (npm run typecheck) — vitest runs through esbuild and
// erases type-only imports, so removing the root re-export would NOT fail the
// test run, only the typecheck. A type-only import keeps the test fast (no
// root-barrel evaluation at runtime).
import type { ExecutionTargetOption as RootExecutionTargetOption } from "../../index";

describe("toProtoExecutionTarget", () => {
  it("maps local to ExecutionTarget.LOCAL", () => {
    expect(toProtoExecutionTarget("local")).toBe(ExecutionTarget.LOCAL);
  });

  it("maps cloud to ExecutionTarget.CLOUD", () => {
    expect(toProtoExecutionTarget("cloud")).toBe(ExecutionTarget.CLOUD);
  });
});

describe("fromProtoExecutionTarget", () => {
  it("maps ExecutionTarget.LOCAL to local", () => {
    expect(fromProtoExecutionTarget(ExecutionTarget.LOCAL)).toBe("local");
  });

  it("maps ExecutionTarget.CLOUD to cloud", () => {
    expect(fromProtoExecutionTarget(ExecutionTarget.CLOUD)).toBe("cloud");
  });

  it("maps ExecutionTarget.UNSPECIFIED to undefined", () => {
    expect(fromProtoExecutionTarget(ExecutionTarget.UNSPECIFIED)).toBeUndefined();
  });

  it("maps unknown numeric values to undefined (safe default)", () => {
    expect(fromProtoExecutionTarget(999 as ExecutionTarget)).toBeUndefined();
  });
});

describe("round-trip conversion", () => {
  it("local survives toProto -> fromProto", () => {
    expect(fromProtoExecutionTarget(toProtoExecutionTarget("local"))).toBe("local");
  });

  it("cloud survives toProto -> fromProto", () => {
    expect(fromProtoExecutionTarget(toProtoExecutionTarget("cloud"))).toBe("cloud");
  });
});

describe("package root export", () => {
  it("re-exports ExecutionTargetOption from the package root (issue #171)", () => {
    // Assigning through the root-imported type forces `tsc` to resolve the
    // root re-export; if it is dropped from src/index.ts, typecheck fails
    // (TS2305) in CI. The runtime assertion keeps this a real test too.
    const target: RootExecutionTargetOption = "local";
    expect(toProtoExecutionTarget(target)).toBe(ExecutionTarget.LOCAL);
  });
});
