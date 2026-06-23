import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSchema,
  FileContentSchema,
  ToolCallOutputRefSchema,
  type FileContent,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UseArtifactContentReturn } from "../useArtifactContent";

// ---------------------------------------------------------------------------
// Mock the offload fetch — keyed by storageKey so each side resolves independently.
// ---------------------------------------------------------------------------

const responses = new Map<string, Partial<UseArtifactContentReturn>>();
const calls: Array<{ executionId: string | null; storageKey: string | null }> = [];

vi.mock("../useArtifactContent", () => ({
  useArtifactContent: (executionId: string | null, storageKey: string | null) => {
    calls.push({ executionId, storageKey });
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

// The download fallback is resolved on demand from the storage key (gated on
// truncation), so the test drives it through the URL hook rather than a baked ref.
const downloadUrls = new Map<string, string>();
const urlCalls: Array<{
  executionId: string | null;
  storageKey: string | null;
  enabled: boolean;
}> = [];

vi.mock("../useArtifactDownloadUrl", () => ({
  useArtifactDownloadUrl: (
    executionId: string | null,
    storageKey: string | null,
    options?: { enabled?: boolean },
  ) => {
    const enabled = options?.enabled ?? true;
    urlCalls.push({ executionId, storageKey, enabled });
    const url = enabled && storageKey ? downloadUrls.get(storageKey) ?? null : null;
    return { url, isLoading: false, isRefetching: false, error: null, refetch: () => {} };
  },
}));

const { useFileChangeContent, execIdFromStorageKey } = await import(
  "../useFileChangeContent"
);

beforeEach(() => {
  responses.clear();
  calls.length = 0;
  downloadUrls.clear();
  urlCalls.length = 0;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function inlineSide(value: string): FileContent {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function refSide(storageKey: string): FileContent {
  return create(FileContentSchema, {
    body: {
      case: "ref",
      value: create(ToolCallOutputRefSchema, { storageKey }),
    },
  });
}

function binarySide(): FileContent {
  return create(FileContentSchema, { isBinary: true });
}

function wholeFile(before: FileContent | undefined, after: FileContent | undefined) {
  return create(FileChangeSchema, {
    path: "src/a.ts",
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before,
    after,
  });
}

// ---------------------------------------------------------------------------
// execIdFromStorageKey
// ---------------------------------------------------------------------------

describe("execIdFromStorageKey", () => {
  it("parses the execution id from an artifacts key", () => {
    expect(
      execIdFromStorageKey("artifacts/exec-123/toolcalls/tc.0.before.txt"),
    ).toBe("exec-123");
  });

  it("returns null for an unexpected shape", () => {
    expect(execIdFromStorageKey("nope")).toBeNull();
    expect(execIdFromStorageKey("artifacts//x")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useFileChangeContent
// ---------------------------------------------------------------------------

describe("useFileChangeContent", () => {
  it("resolves inline sides directly without fetching", () => {
    const change = wholeFile(inlineSide("old"), inlineSide("new"));
    const { result } = renderHook(() => useFileChangeContent(change));

    expect(result.current.beforeText).toBe("old");
    expect(result.current.afterText).toBe("new");
    expect(result.current.isLoading).toBe(false);
    // Both sides issue a (skipped) call with null storageKey.
    expect(calls.every((c) => c.storageKey === null)).toBe(true);
  });

  it("treats an absent side as an empty file", () => {
    const change = wholeFile(undefined, inlineSide("created"));
    change.changeType = FileChangeType.CREATE;
    const { result } = renderHook(() => useFileChangeContent(change));
    expect(result.current.beforeText).toBe("");
    expect(result.current.afterText).toBe("created");
  });

  it("fetches an offloaded side and parses the execId from its storageKey", () => {
    const key = "artifacts/exec-9/toolcalls/tc.0.after.txt";
    responses.set(key, { content: "fetched-after" });
    const change = wholeFile(inlineSide("old"), refSide(key));

    const { result } = renderHook(() => useFileChangeContent(change));

    expect(result.current.afterText).toBe("fetched-after");
    const afterCall = calls.find((c) => c.storageKey === key);
    expect(afterCall?.executionId).toBe("exec-9");
  });

  it("resolves both sides independently when each is offloaded under a different execId", () => {
    const beforeKey = "artifacts/exec-before/toolcalls/tc.0.before.txt";
    const afterKey = "artifacts/exec-after/toolcalls/tc.0.after.txt";
    responses.set(beforeKey, { content: "fetched-before" });
    responses.set(afterKey, { content: "fetched-after" });
    const change = wholeFile(refSide(beforeKey), refSide(afterKey));

    const { result } = renderHook(() => useFileChangeContent(change));

    expect(result.current.beforeText).toBe("fetched-before");
    expect(result.current.afterText).toBe("fetched-after");
    expect(result.current.isLoading).toBe(false);
    // Each side derives its own execId from its own key.
    expect(calls.find((c) => c.storageKey === beforeKey)?.executionId).toBe("exec-before");
    expect(calls.find((c) => c.storageKey === afterKey)?.executionId).toBe("exec-after");
  });

  it("resolves a mix of an offloaded before and an inline after", () => {
    const beforeKey = "artifacts/exec-9/toolcalls/tc.0.before.txt";
    responses.set(beforeKey, { content: "fetched-before" });
    const change = wholeFile(refSide(beforeKey), inlineSide("new"));

    const { result } = renderHook(() => useFileChangeContent(change));

    expect(result.current.beforeText).toBe("fetched-before");
    expect(result.current.afterText).toBe("new");
    expect(result.current.isLoading).toBe(false);
  });

  it("stays in loading while either side is still in flight, even if the other is ready", () => {
    const beforeKey = "artifacts/exec-9/toolcalls/tc.0.before.txt";
    const afterKey = "artifacts/exec-9/toolcalls/tc.0.after.txt";
    responses.set(beforeKey, { content: "ready" });
    responses.set(afterKey, { content: null, isLoading: true });
    const change = wholeFile(refSide(beforeKey), refSide(afterKey));

    const { result } = renderHook(() => useFileChangeContent(change));

    // A diff needs both sides; one side still loading keeps the whole view loading.
    expect(result.current.isLoading).toBe(true);
  });

  it("reports loading while an offloaded side is in flight", () => {
    const key = "artifacts/exec-9/toolcalls/tc.0.after.txt";
    responses.set(key, { content: null, isLoading: true });
    const change = wholeFile(inlineSide("old"), refSide(key));

    const { result } = renderHook(() => useFileChangeContent(change));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.afterText).toBeNull();
  });

  it("surfaces truncation and resolves the download url on demand for an oversized offloaded side", () => {
    const key = "artifacts/exec-9/toolcalls/tc.0.after.txt";
    responses.set(key, { content: "head", isTruncated: true });
    downloadUrls.set(key, "https://dl/full");
    const change = wholeFile(inlineSide("old"), refSide(key));

    const { result } = renderHook(() => useFileChangeContent(change));

    expect(result.current.isTruncated).toBe(true);
    expect(result.current.downloadUrl).toBe("https://dl/full");
    // The URL is resolved from the stable key, gated on truncation.
    expect(urlCalls.some((c) => c.storageKey === key && c.enabled)).toBe(true);
  });

  it("flags binary changes and yields empty text", () => {
    const change = wholeFile(binarySide(), binarySide());
    const { result } = renderHook(() => useFileChangeContent(change));
    expect(result.current.isBinary).toBe(true);
    expect(result.current.beforeText).toBe("");
    expect(result.current.afterText).toBe("");
  });

  it("propagates a fetch error", () => {
    const key = "artifacts/exec-9/toolcalls/tc.0.after.txt";
    responses.set(key, { error: new Error("boom") });
    const change = wholeFile(inlineSide("old"), refSide(key));

    const { result } = renderHook(() => useFileChangeContent(change));
    expect(result.current.error?.message).toBe("boom");
  });
});
