// useExportTranscript (stigmer/stigmer#814): the lazy export actions run the
// REAL canonical assembly (fetchSessionTranscript from @stigmer/sdk) against
// a fake client, so these tests pin the hook's end-to-end content, filenames,
// clipboard strategy, and failure honesty — not a mock of the SDK.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("../../feedback/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const fakeSession = create(SessionSchema, {
  metadata: { id: "ses_01" },
  spec: { subject: "Fix the flaky test" },
});

const fakeExecution = create(AgentExecutionSchema, {
  metadata: { id: "aex_01" },
  spec: { sessionId: "ses_01", message: "Why is CI red?" },
  status: {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    messages: [
      { type: MessageType.MESSAGE_THINKING, content: "Checking the loop." },
      { type: MessageType.MESSAGE_AI, content: "Found it." },
    ],
  },
});

let listBySession: (input: unknown) => Promise<unknown>;
vi.mock("../../hooks", () => ({
  useStigmer: () => ({
    session: { get: () => Promise.resolve(fakeSession) },
    agentExecution: {
      listBySession: (input: unknown) => listBySession(input),
      getArtifactContent: vi.fn(),
    },
  }),
}));

import { useExportTranscript } from "../useExportTranscript";

// ---------------------------------------------------------------------------
// DOM stubs: clipboard and blob downloads
// ---------------------------------------------------------------------------

let writeText: ReturnType<typeof vi.fn>;
let clipboardWrite: ReturnType<typeof vi.fn>;
let createdBlobs: Blob[];
let downloadedFilenames: string[];

beforeEach(() => {
  vi.clearAllMocks();
  listBySession = vi.fn(() =>
    Promise.resolve(
      create(AgentExecutionListSchema, {
        totalPages: 1,
        entries: [fakeExecution],
      }),
    ),
  );

  writeText = vi.fn(() => Promise.resolve());
  clipboardWrite = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  vi.stubGlobal("ClipboardItem", undefined);

  createdBlobs = [];
  downloadedFilenames = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob);
    return "blob:mock";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadedFilenames.push(this.download);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useExportTranscript", () => {
  it("is lazy — nothing is fetched until an action runs", () => {
    renderHook(() => useExportTranscript("ses_01"));
    expect(listBySession).not.toHaveBeenCalled();
  });

  it("copies the canonical Markdown via writeText when ClipboardItem is unavailable", async () => {
    const { result } = renderHook(() => useExportTranscript("ses_01"));
    await act(() => result.current.copyMarkdown());

    expect(writeText).toHaveBeenCalledTimes(1);
    const markdown = writeText.mock.calls[0][0] as string;
    expect(markdown).toContain("# Fix the flaky test");
    expect(markdown).toContain("Why is CI red?");
    // The fidelity headline: thinking is in the export.
    expect(markdown).toContain("**Thinking**");
    expect(markdown).toContain("> Checking the loop.");
    expect(toastSuccess).toHaveBeenCalledWith("Transcript copied to clipboard");
    expect(result.current.error).toBeNull();
  });

  it("copies via a promise-carrying ClipboardItem when available (the WebKit gesture path)", async () => {
    class FakeClipboardItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, write: clipboardWrite },
      configurable: true,
    });

    const { result } = renderHook(() => useExportTranscript("ses_01"));
    await act(() => result.current.copyMarkdown());

    // The write is handed the item synchronously; the content arrives via
    // the promise — writeText (which would lose the gesture) is never used.
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const item = clipboardWrite.mock.calls[0][0][0] as InstanceType<
      typeof FakeClipboardItem
    >;
    const blob = await item.items["text/plain"];
    expect(await blob.text()).toContain("# Fix the flaky test");
  });

  it("downloads Markdown under the subject-slug filename", async () => {
    const { result } = renderHook(() => useExportTranscript("ses_01"));
    await act(() => result.current.downloadMarkdown());

    expect(downloadedFilenames).toEqual(["fix-the-flaky-test-transcript.md"]);
    expect(await createdBlobs[0].text()).toContain("# Fix the flaky test");
  });

  it("downloads JSON in the protojson-parity format", async () => {
    const { result } = renderHook(() => useExportTranscript("ses_01"));
    await act(() => result.current.downloadJson());

    expect(downloadedFilenames).toEqual(["fix-the-flaky-test-transcript.json"]);
    const parsed = JSON.parse(await createdBlobs[0].text());
    expect(parsed.format).toBe("stigmer.ai/session-transcript/v1");
    expect(parsed.turns[0].execution.status.messages[0].content).toBe(
      "Checking the loop.",
    );
  });

  it("surfaces fetch failures as a typed error and a toast — never a silent no-op", async () => {
    listBySession = vi.fn(() => Promise.reject(new Error("network down")));
    const { result } = renderHook(() => useExportTranscript("ses_01"));
    await act(() => result.current.downloadMarkdown());

    expect(result.current.error?.message).toBe("network down");
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't export the transcript: network down",
    );
    expect(downloadedFilenames).toEqual([]);
  });

  it("explains itself when invoked without a session id", async () => {
    const { result } = renderHook(() => useExportTranscript(null));
    await act(() => result.current.downloadMarkdown());
    expect(result.current.error?.message).toMatch(/without a session id/);
  });
});
