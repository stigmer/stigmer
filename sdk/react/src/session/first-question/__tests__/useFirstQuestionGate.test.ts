/**
 * The first question's gate on its own: it asks only on both answers (an
 * admin of the organization, `can_edit` on it, never merely a person who may
 * make agents; nothing has run), skips on either no or on a failed read, is
 * pending until both are in, holds its first settled answer for an
 * organization while the reads change under it, asks another organization
 * afresh, and skips at once when the launcher stops asking. The two reads are
 * stubbed; their own suites pin them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const reads = vi.hoisted(() => ({
  permission: { allowed: true, isLoading: false } as { allowed: boolean; isLoading: boolean },
  ever: { ran: false, error: null } as { ran: boolean | undefined; error: Error | null },
  asked: [] as string[],
}));

vi.mock("../../../grant/useCheckPermission.js", () => ({
  useCheckPermission: (_resource: unknown, relation: string) => {
    reads.asked.push(relation);
    return { ...reads.permission, error: null, refetch: () => {} };
  },
}));
vi.mock("../../../dashboard/useEverRan.js", () => ({
  useEverRan: () => reads.ever,
}));

import { useFirstQuestionGate } from "../useFirstQuestionGate";

beforeEach(() => {
  reads.permission = { allowed: true, isLoading: false };
  reads.ever = { ran: false, error: null };
});

describe("useFirstQuestionGate", () => {
  it("asks when the person is an admin of the organization and nothing has run", () => {
    expect(renderHook(() => useFirstQuestionGate("org_a", true)).result.current).toBe("ask");
    // A member may make agents, and a teammate who joined by invitation sees
    // none of the owner's runs: the question is an admin's, never theirs.
    expect(new Set(reads.asked)).toEqual(new Set(["can_edit"]));
  });

  it("skips when asked not to, or for an organization it cannot name", () => {
    expect(renderHook(() => useFirstQuestionGate("org_a", false)).result.current).toBe("skip");
    expect(renderHook(() => useFirstQuestionGate("", true)).result.current).toBe("skip");
  });

  it("skips on a no, on a run, and on a failed read", () => {
    reads.permission = { allowed: false, isLoading: false };
    expect(renderHook(() => useFirstQuestionGate("org_a", true)).result.current).toBe("skip");
    reads.permission = { allowed: true, isLoading: false };
    reads.ever = { ran: true, error: null };
    expect(renderHook(() => useFirstQuestionGate("org_b", true)).result.current).toBe("skip");
    reads.ever = { ran: undefined, error: new Error("unavailable") };
    expect(renderHook(() => useFirstQuestionGate("org_c", true)).result.current).toBe("skip");
  });

  it("is pending until both answers are in", () => {
    reads.permission = { allowed: false, isLoading: true };
    expect(renderHook(() => useFirstQuestionGate("org_a", true)).result.current).toBe("pending");
    reads.permission = { allowed: true, isLoading: false };
    reads.ever = { ran: undefined, error: null };
    expect(renderHook(() => useFirstQuestionGate("org_b", true)).result.current).toBe("pending");
  });

  it("holds its first answer for an organization, asks another afresh, and skips at once when told to stop", () => {
    const { result, rerender } = renderHook(({ org, enabled }) => useFirstQuestionGate(org, enabled), {
      initialProps: { org: "org_a", enabled: true },
    });
    expect(result.current).toBe("ask");
    reads.ever = { ran: true, error: null };
    rerender({ org: "org_a", enabled: true });
    expect(result.current).toBe("ask");
    rerender({ org: "org_b", enabled: true });
    expect(result.current).toBe("skip");
    reads.ever = { ran: false, error: null };
    rerender({ org: "org_a", enabled: false });
    expect(result.current).toBe("skip");
  });
});
