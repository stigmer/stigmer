/**
 * useApplyResource's skill path: pushSkillPackage asks the server to push the
 * run's directory artifact (run id, storage key, tag defaulting to empty) and
 * returns the skill's metadata as an apply result; a refused push sets the
 * hook's error, rethrows it, and clears isApplying.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { useApplyResource } from "../useApplyResource";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  };
}

describe("useApplyResource.pushSkillPackage", () => {
  it("pushes the run's artifact as a skill and returns its metadata", async () => {
    const pushFromRunArtifact = vi
      .fn()
      .mockResolvedValue({ metadata: { name: "Code Review", org: "acme", slug: "code-review" } });
    const { result } = renderHook(() => useApplyResource(), {
      wrapper: wrapper({ skill: { pushFromRunArtifact } }),
    });

    let applied: unknown;
    await act(async () => {
      applied = await result.current.pushSkillPackage({
        org: "acme",
        runId: "aex_1",
        storageKey: "artifacts/aex_1/skill",
      });
    });

    expect(pushFromRunArtifact.mock.calls[0]![0]).toMatchObject({
      org: "acme",
      runId: "aex_1",
      storageKey: "artifacts/aex_1/skill",
      tag: "",
    });
    expect(applied).toEqual({ kind: "Skill", name: "Code Review", org: "acme", slug: "code-review" });
    expect(result.current.isApplying).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("falls back to the requested org and empty names when the skill has no metadata", async () => {
    const pushFromRunArtifact = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useApplyResource(), {
      wrapper: wrapper({ skill: { pushFromRunArtifact } }),
    });

    let applied: unknown;
    await act(async () => {
      applied = await result.current.pushSkillPackage({
        org: "acme",
        runId: "aex_1",
        storageKey: "artifacts/aex_1/skill",
        tag: "stable",
      });
    });

    expect(pushFromRunArtifact.mock.calls[0]![0]).toMatchObject({ tag: "stable" });
    expect(applied).toEqual({ kind: "Skill", name: "", org: "acme", slug: "" });
  });

  it("sets and rethrows the error when the push is refused", async () => {
    const refusal = new Error("artifact is not a skill package");
    const pushFromRunArtifact = vi.fn().mockRejectedValue(refusal);
    const { result } = renderHook(() => useApplyResource(), {
      wrapper: wrapper({ skill: { pushFromRunArtifact } }),
    });

    await act(async () => {
      await expect(
        result.current.pushSkillPackage({ org: "acme", runId: "aex_1", storageKey: "artifacts/aex_1/x" }),
      ).rejects.toBe(refusal);
    });

    expect(result.current.error?.message).toBe("artifact is not a skill package");
    expect(result.current.isApplying).toBe(false);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
