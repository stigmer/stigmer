// Pins SessionView's terminal composition over a session conversation: the
// loading and load-failure states, the subject line, the live turn's phase,
// to-dos and answer error, the mid-run live capture strip ("N files
// changing…") whose per-file list rides the same Ctrl+O toggle that expands
// tool calls, the docked file-review prompt that yields to a waiting tool
// use, and the Ctrl+T switch between agent and plan mode that the follow-up
// line announces. The conversation hook is
// replaced by a fixture so each state renders exactly as the hook would
// report it, and the usage widget's hook reports no usage; every
// component below the hooks is the real Ink tree.
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { UseSessionConversationReturn } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import { SessionView } from "../app/SessionView.js";
import { reviewSet, waitingToolUse } from "./session-events.js";

let conversation: UseSessionConversationReturn;

vi.mock("@stigmer/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react")>();
  return {
    ...actual,
    useSessionConversation: () => conversation,
    // The usage widget reads the session usage report through the
    // client; with no runs in these fixtures it has nothing to show.
    useSessionUsage: () => ({ hasUsage: false }) as unknown as ReturnType<typeof actual.useSessionUsage>,
  };
});

function makeConversation(overrides: Partial<UseSessionConversationReturn> = {}): UseSessionConversationReturn {
  const base: Partial<UseSessionConversationReturn> = {
    session: create(SessionSchema, { spec: { subject: "Refactor the billing module" } }),
    isLoading: false,
    loadError: null,
    turns: [],
    runs: [],
    activeTurn: null,
    activeRun: null,
    activePhase: null,
    isStreaming: false,
    isConnecting: false,
    isReconnecting: false,
    streamError: null,
    sendFollowUp: async () => {},
    canSendFollowUp: true,
    isSending: false,
    sendError: null,
    pendingUserMessage: null,
    asks: [],
    answerToolUse: async () => {},
    answeringToolUseIds: new Set<string>(),
    answerError: null,
    fileReviewSets: [],
    fileChangeCaptures: new Map(),
    fileChangeProgress: undefined,
    reviewFileChanges: async () => {},
    submittingFileDecisionKeys: new Set<string>(),
    fileDecisionErrors: new Map<string, Error>(),
    fileReviewError: null,
  };
  return { ...base, ...overrides } as UseSessionConversationReturn;
}

const PROGRESS = create(FileChangeProgressSchema, {
  changeSetId: "cs-1",
  filesChanged: 2,
  linesAdded: 12,
  linesRemoved: 3,
  entries: [
    create(FileChangeProgressEntrySchema, { pathAfter: "src/billing/ledger.ts", kind: FileChangeKind.MODIFY, linesAdded: 10 }),
    create(FileChangeProgressEntrySchema, { pathAfter: "src/billing/rates.ts", kind: FileChangeKind.ADD, linesAdded: 2 }),
  ],
  capturedAt: "2026-07-05T00:00:00Z",
});

/** Lets Ink flush a re-render after stdin input. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  cleanup();
});

describe("SessionView — load states", () => {
  it("shows a spinner line while the session loads", () => {
    conversation = makeConversation({ isLoading: true });
    const { lastFrame } = render(<SessionView sessionId="ses-1" org="acme" />);
    expect(lastFrame()).toContain("Loading session...");
  });

  it("names the failure when the session cannot load", () => {
    conversation = makeConversation({ loadError: new Error("session not found") });
    const { lastFrame } = render(<SessionView sessionId="ses-1" org="acme" />);
    expect(lastFrame()).toContain("Failed to load session");
    expect(lastFrame()).toContain("session not found");
  });
});

describe("SessionView — a loaded conversation", () => {
  it("shows the subject and the agent-mode follow-up line", () => {
    conversation = makeConversation();
    const { lastFrame } = render(<SessionView sessionId="ses-1" org="acme" />);
    expect(lastFrame()).toContain("Refactor the billing module");
    expect(lastFrame()).toContain("Agent mode — full tool access");
  });

  it("shows the mid-run capture strip, and Ctrl+O reveals its per-file list", async () => {
    conversation = makeConversation({ fileChangeProgress: PROGRESS });
    const { lastFrame, stdin } = render(<SessionView sessionId="ses-1" org="acme" />);
    expect(lastFrame()).toContain("2 files changing…");
    expect(lastFrame()).not.toContain("src/billing/ledger.ts");

    stdin.write("\u000f"); // Ctrl+O
    await settle();
    expect(lastFrame()).toContain("src/billing/ledger.ts");
    expect(lastFrame()).toContain("src/billing/rates.ts");
  });

  it("hides the capture strip when no file has changed yet", () => {
    conversation = makeConversation({
      fileChangeProgress: create(FileChangeProgressSchema, { changeSetId: "cs-1", filesChanged: 0 }),
    });
    const { lastFrame } = render(<SessionView sessionId="ses-1" org="acme" />);
    expect(lastFrame()).not.toContain("changing…");
  });

  it("shows the live turn's phase, its to-dos and an answer error", () => {
    const activeTurn = samples.turn({ phase: "running" });
    conversation = makeConversation({
      activePhase: "running",
      activeTurn: {
        ...activeTurn,
        todos: [{ id: "t1", content: "Read the ledger", status: "in_progress", createdAt: "", updatedAt: "" }],
      },
      answerError: new Error("gate already answered"),
    });
    const frame = render(<SessionView sessionId="ses-1" org="acme" />).lastFrame() ?? "";
    expect(frame).toContain("Running");
    expect(frame).toContain("Read the ledger");
    expect(frame).toContain("Approval error: gate already answered");
  });

  it("docks the file-review prompt, counts the rest, and hides the phase while it waits", () => {
    const set = reviewSet([{ id: "a", path: "src/billing/ledger.ts" }]);
    conversation = makeConversation({
      activePhase: "completed",
      fileReviewSets: [set, set],
      fileReviewError: new Error("digest mismatch"),
    });
    const frame = render(<SessionView sessionId="ses-1" org="acme" />).lastFrame() ?? "";
    expect(frame).toContain("1 file awaiting review");
    expect(frame).toContain("1 more awaiting review");
    expect(frame).toContain("File review error: digest mismatch");
    expect(frame).not.toContain("Completed");
  });

  it("makes the review prompt yield to a waiting tool use", () => {
    conversation = makeConversation({
      asks: [waitingToolUse("write_file")],
      fileReviewSets: [reviewSet([{ id: "a", path: "one.ts" }])],
    });
    const frame = render(<SessionView sessionId="ses-1" org="acme" />).lastFrame() ?? "";
    expect(frame).toContain("Resolve the pending approval first");
  });

  it("switches to plan mode on Ctrl+T", async () => {
    conversation = makeConversation();
    const { lastFrame, stdin } = render(<SessionView sessionId="ses-1" org="acme" />);
    stdin.write("\u0014"); // Ctrl+T
    await settle();
    expect(lastFrame()).toContain("Plan mode — read-only analysis, no file mutations");
  });
});
