/**
 * The React kit's root keeps ExecutionTargetOption, so a host can type the
 * StigmerProvider `executionTarget` prop from the package it installs
 * (issue #171). The option's mapping is pinned beside it in `sdk/react-core`.
 */
import { describe, it, expect } from "vitest";
import { ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { toProtoExecutionTarget } from "../session/execution-target";
// Public-API contract guard (issue #171): ExecutionTargetOption must stay
// re-exported from the package root so consumers can type the
// StigmerProvider `executionTarget` prop. This guarantee is enforced at
// compile time by `tsc` (npm run typecheck) — vitest runs through esbuild and
// erases type-only imports, so removing the root re-export would NOT fail the
// test run, only the typecheck. A type-only import keeps the test fast (no
// root-barrel evaluation at runtime).
import type { ExecutionTargetOption as RootExecutionTargetOption } from "../index";

describe("package root export", () => {
  it("re-exports ExecutionTargetOption from the package root (issue #171)", () => {
    // Assigning through the root-imported type forces `tsc` to resolve the
    // root re-export; if it is dropped from src/index.ts, typecheck fails
    // (TS2305) in CI. The runtime assertion keeps this a real test too.
    const target: RootExecutionTargetOption = "local";
    expect(toProtoExecutionTarget(target)).toBe(ExecutionTarget.LOCAL);
  });
});
