// Pins SessionView's terminal composition over a session conversation: the
// loading and load-failure states, the subject line, the mid-run live
// capture strip ("N files changing…") whose per-file list rides the same
// Ctrl+O toggle that expands tool calls, and the Ctrl+T switch between agent
// and plan mode that the follow-up line announces. The conversation hook is
// replaced by a fixture so each state renders exactly as the hook would
// report it, and the usage widget's pricing hook reports no usage; every
// component below the hooks is the real Ink tree.
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { UseSessionConversationReturn } from "@stigmer/react";
import { SessionView } from "../app/SessionView.js";

let conversation: UseSessionConversationReturn;

vi.mock("@stigmer/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react")>();
  return {
    ...actual,
    useSessionConversation: () => conversation,
    // The usage widget prices executions through the client; with no
    // executions in these fixtures it has nothing to show.
    useSessionUsage: () => ({ hasUsage: false }) as unknown as ReturnType<typeof actual.useSessionUsage>,
  };
});

function makeConversation(overrides: Partial<UseSessionConversationReturn> = {}): UseSessionConversationReturn {
  const base: Partial<UseSessionConversationReturn> = {
    session: create(SessionSchema, { spec: { subject: "Refactor the billing module" } }),
    isLoading: false,
    loadError: null,
    completedExecutions: [],
    activeStreamExecution: null,
    activePhase: undefined,
    isStreaming: false,
    isConnecting: false,
    isReconnecting: false,
    streamError: null,
    sendFollowUp: async () => {},
    canSendFollowUp: true,
    isSending: false,
    sendError: null,
    pendingUserMessage: null,
    pendingApprovals: [],
    submitApproval: async () => {},
    submittingApprovalIds: new Set<string>(),
    approvalError: null,
    fileChangeSets: [],
    fileChangeProgress: undefined,
    submitFileDecision: async () => {},
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

  it("switches to plan mode on Ctrl+T", async () => {
    conversation = makeConversation();
    const { lastFrame, stdin } = render(<SessionView sessionId="ses-1" org="acme" />);
    stdin.write("\u0014"); // Ctrl+T
    await settle();
    expect(lastFrame()).toContain("Plan mode — read-only analysis, no file mutations");
  });
});
