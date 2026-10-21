/**
 * The viewer-owned plan draft: keyed by the plan File's id, so a newer plan
 * (a new File, from a new turn or the same one) orphans the old draft; held,
 * cleared and read through a referentially stable reader.
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { SessionPlan } from "../../library/detect-plan-file";
import { usePlanDraft, planDraftKey } from "../usePlanDraft";

afterEach(cleanup);

function plan(runId: string, fileId: string): SessionPlan {
  return {
    runId,
    file: create(FileSchema, {
      metadata: { id: fileId },
      spec: { filename: "plan.md" },
      status: { runId, outputPath: "plan.md" },
    }),
  };
}

describe("planDraftKey", () => {
  it("keys by the plan File's id", () => {
    expect(planDraftKey(plan("e1", "file_a"))).toBe("file_a");
    expect(planDraftKey(plan("e1", "file_b"))).not.toBe(planDraftKey(plan("e1", "file_a")));
  });
});

describe("usePlanDraft", () => {
  it("starts unedited and holds a draft for the current plan", () => {
    const { result } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "file_a") as SessionPlan | undefined },
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
      initialProps: { p: plan("e1", "file_a") as SessionPlan | undefined },
    });

    act(() => result.current.setDraft("edit"));
    act(() => result.current.setDraft(null));
    expect(result.current.isEdited).toBe(false);
    expect(result.current.readDraft()).toBeNull();
  });

  it("drops the draft when a newer plan supersedes it (new execution)", () => {
    const { result, rerender } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "file_a") as SessionPlan | undefined },
    });

    act(() => result.current.setDraft("draft of plan 1"));
    rerender({ p: plan("e2", "file_b") });

    expect(result.current.isEdited).toBe(false);
    expect(result.current.draftText).toBeNull();
    expect(result.current.readDraft()).toBeNull();
  });

  it("drops the draft when the same plan is republished with new content", () => {
    const { result, rerender } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "file_a") as SessionPlan | undefined },
    });

    act(() => result.current.setDraft("stale draft"));
    rerender({ p: plan("e1", "file_b") });

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

  it("keeps readDraft referentially stable across draft edits", () => {
    const { result, rerender } = renderHook(({ p }) => usePlanDraft(p), {
      initialProps: { p: plan("e1", "file_a") as SessionPlan | undefined },
    });

    const readBefore = result.current.readDraft;
    act(() => result.current.setDraft("edit 1"));
    rerender({ p: plan("e1", "file_a") });
    expect(result.current.readDraft).toBe(readBefore);
    expect(result.current.readDraft()).toBe("edit 1");
  });
});
