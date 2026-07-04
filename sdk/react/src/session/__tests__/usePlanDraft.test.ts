import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SessionPlan } from "../../library/detect-plan-artifact";
import { usePlanDraft, planDraftKey } from "../usePlanDraft";

afterEach(cleanup);

function plan(executionId: string, contentHash: string): SessionPlan {
  return {
    executionId,
    artifact: create(ExecutionArtifactSchema, {
      name: "plan.md",
      kind: ExecutionArtifactKind.FILE,
      storageKey: `artifacts/${executionId}/plan.md`,
      contentHash,
    }),
  };
}

describe("planDraftKey", () => {
  it("keys by execution AND content hash", () => {
    expect(planDraftKey(plan("e1", "aaa"))).toBe("e1:aaa");
    expect(planDraftKey(plan("e1", "bbb"))).not.toBe(planDraftKey(plan("e1", "aaa")));
    expect(planDraftKey(plan("e2", "aaa"))).not.toBe(planDraftKey(plan("e1", "aaa")));
  });
});

describe("usePlanDraft", () => {
  it("starts unedited and holds a draft for the current plan", () => {
    const { result } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "aaa") as SessionPlan | undefined },
    });

    expect(result.current.isEdited).toBe(false);
    expect(result.current.draftText).toBeNull();

    act(() => result.current.setDraft("# Edited plan"));
    expect(result.current.isEdited).toBe(true);
    expect(result.current.draftText).toBe("# Edited plan");
    expect(result.current.readDraft()).toBe("# Edited plan");
  });

  it("reverts to the published plan when the draft is cleared", () => {
    const { result } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "aaa") as SessionPlan | undefined },
    });

    act(() => result.current.setDraft("edit"));
    act(() => result.current.setDraft(null));
    expect(result.current.isEdited).toBe(false);
    expect(result.current.readDraft()).toBeNull();
  });

  it("drops the draft when a newer plan supersedes it (new execution)", () => {
    const { result, rerender } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "aaa") as SessionPlan | undefined },
    });

    act(() => result.current.setDraft("draft of plan 1"));
    rerender({ p: plan("e2", "bbb") });

    expect(result.current.isEdited).toBe(false);
    expect(result.current.draftText).toBeNull();
    expect(result.current.readDraft()).toBeNull();
  });

  it("drops the draft when the same plan is republished with new content", () => {
    const { result, rerender } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "aaa") as SessionPlan | undefined },
    });

    act(() => result.current.setDraft("stale draft"));
    rerender({ p: plan("e1", "bbb") });

    expect(result.current.readDraft()).toBeNull();
  });

  it("no-ops setDraft when the session has no plan", () => {
    const { result } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: undefined as SessionPlan | undefined },
    });

    act(() => result.current.setDraft("nowhere to go"));
    expect(result.current.isEdited).toBe(false);
    expect(result.current.readDraft()).toBeNull();
  });

  it("keeps readDraft referentially stable across draft edits (DD-010)", () => {
    const { result, rerender } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "aaa") as SessionPlan | undefined },
    });

    const readBefore = result.current.readDraft;
    act(() => result.current.setDraft("edit 1"));
    rerender({ p: plan("e1", "aaa") });
    expect(result.current.readDraft).toBe(readBefore);
    expect(result.current.readDraft()).toBe("edit 1");
  });
});
