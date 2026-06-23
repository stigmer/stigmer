import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ToolCallOutputRefSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { UseArtifactContentReturn } from "../useArtifactContent";

// Mock the underlying content fetch so the test asserts the derivation logic
// (execId from storageKey) and the lazy `enabled` gate, not the network.
const responses = new Map<string, Partial<UseArtifactContentReturn>>();
const calls: Array<{
  executionId: string | null;
  storageKey: string | null;
  contentHash?: string;
}> = [];

vi.mock("../useArtifactContent", () => ({
  useArtifactContent: (
    executionId: string | null,
    storageKey: string | null,
    _entryPath?: string | null,
    contentHash?: string,
  ) => {
    calls.push({ executionId, storageKey, contentHash });
    const base: UseArtifactContentReturn = {
      content: null,
      contentType: null,
      isTruncated: false,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    };
    if (!storageKey) return base;
    return { ...base, ...responses.get(storageKey) };
  },
}));

const { useToolOutputContent } = await import("../useToolOutputContent");

beforeEach(() => {
  responses.clear();
  calls.length = 0;
});

function ref(storageKey: string, contentHash = "h") {
  return create(ToolCallOutputRefSchema, { storageKey, contentHash });
}

describe("useToolOutputContent", () => {
  it("stays idle until enabled (lazy expand)", () => {
    const { result } = renderHook(() =>
      useToolOutputContent(ref("artifacts/exec-1/toolcalls/tc.txt"), false),
    );
    expect(result.current.content).toBeNull();
    // The underlying fetch is skipped (null storage key passed through).
    expect(calls.every((c) => c.storageKey === null)).toBe(true);
  });

  it("derives the execId from the storage key and fetches when enabled", () => {
    const key = "artifacts/exec-9/toolcalls/tc.txt";
    responses.set(key, { content: "FULL", isTruncated: false });
    const { result } = renderHook(() => useToolOutputContent(ref(key), true));

    expect(result.current.content).toBe("FULL");
    const call = calls.find((c) => c.storageKey === key);
    expect(call?.executionId).toBe("exec-9");
    expect(call?.contentHash).toBe("h");
  });

  it("passes through truncation", () => {
    const key = "artifacts/exec-9/toolcalls/tc.txt";
    responses.set(key, { content: "head", isTruncated: true });
    const { result } = renderHook(() => useToolOutputContent(ref(key), true));
    expect(result.current.isTruncated).toBe(true);
  });

  it("skips when the ref is null", () => {
    const { result } = renderHook(() => useToolOutputContent(null, true));
    expect(result.current.content).toBeNull();
    expect(calls.every((c) => c.storageKey === null)).toBe(true);
  });
});
