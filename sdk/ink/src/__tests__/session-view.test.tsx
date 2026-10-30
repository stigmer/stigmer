// Pins SessionView's terminal composition over a session conversation: the
// loading and load-failure states, the subject line, the live turn's phase,
// to-dos and answer error, the mid-run live capture strip ("N files
// changing…") whose per-file list rides the same Ctrl+O toggle that expands
// tool calls, the docked file-review prompt that yields to a waiting tool
// use, and the Ctrl+T switch between agent and plan mode that the follow-up
// line announces. Off a terminal (INK-04) the view reads no keys, settles
// each ask by `approveDefault` and says so, and leaves a file review pending;
// a load failure (INK-05) says what failed, the address and the next step;
// `onTurnEnd` hears each turn end once. The conversation hook is
// replaced by a fixture so each state renders exactly as the hook would
// report it, and the usage widget's hook reports no usage; every
// component below the hooks is the real Ink tree.
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { renderToString } from "ink";
import { stripVTControlCharacters } from "node:util";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeProgressSchema,
  FileChangeProgressEntrySchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { UseSessionConversationReturn } from "@stigmer/react-core";
import { samples } from "@stigmer/react-sdk/test";
import { SessionView } from "../app/SessionView.js";
import { reviewSet, waitingToolUse } from "./session-events.js";

let conversation: UseSessionConversationReturn;

vi.mock("@stigmer/react-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react-core")>();
  return {
    ...actual,
    useSessionConversation: () => conversation,
    // The view words a failure with the address the client was built with.
    useStigmer: () => ({ baseUrl: "http://localhost:7234" }) as ReturnType<typeof actual.useStigmer>,
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
    const { lastFrame } = render(<SessionView sessionId="ses_1" org="acme" />);
    expect(lastFrame()).toContain("Loading session...");
  });

  it("INK-05 says what failed, the address tried and what to do, keeping the raw message as details", () => {
    conversation = makeConversation({ loadError: new Error("connect ECONNREFUSED 127.0.0.1:7234") });
    const frame = render(<SessionView sessionId="ses_1" org="acme" />).lastFrame() ?? "";
    expect(frame).toContain("Could not load the session from http://localhost:7234.");
    expect(frame).toContain("Unable to connect to the server.");
    expect(frame).toContain("Is the server running? Start one with `stigmer up`, or pass --base-url.");
    expect(frame).toContain("Details: connect ECONNREFUSED 127.0.0.1:7234");
  });

  it("INK-05 says a dropped stream as a warning, while the conversation stays", () => {
    conversation = makeConversation({ streamError: new Error("fetch failed") });
    const frame = render(<SessionView sessionId="ses_1" org="acme" />).lastFrame() ?? "";
    expect(frame).toContain("Lost the session's stream from http://localhost:7234.");
    expect(frame).toContain("Refactor the billing module");
  });
});

describe("SessionView — a loaded conversation", () => {
  it("shows the subject and the agent-mode follow-up line", () => {
    conversation = makeConversation();
    const { lastFrame } = render(<SessionView sessionId="ses_1" org="acme" />);
    expect(lastFrame()).toContain("Refactor the billing module");
    expect(lastFrame()).toContain("Agent mode — full tool access");
  });

  it("shows the mid-run capture strip, and Ctrl+O reveals its per-file list", async () => {
    conversation = makeConversation({ fileChangeProgress: PROGRESS });
    const { lastFrame, stdin } = render(<SessionView sessionId="ses_1" org="acme" />);
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
    const { lastFrame } = render(<SessionView sessionId="ses_1" org="acme" />);
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
    const frame = render(<SessionView sessionId="ses_1" org="acme" />).lastFrame() ?? "";
    // The working line, just above the composer.
    expect(frame).toMatch(/⠋ Working · [\dhms ]+\n Agent mode/);
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
    const frame = render(<SessionView sessionId="ses_1" org="acme" />).lastFrame() ?? "";
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
    const frame = render(<SessionView sessionId="ses_1" org="acme" />).lastFrame() ?? "";
    expect(frame).toContain("Resolve the pending approval first");
  });

  it("sends a typed follow-up in the active mode", async () => {
    const sent: unknown[][] = [];
    conversation = makeConversation({ sendFollowUp: async (...args: unknown[]) => void sent.push(args) });
    const { stdin } = render(<SessionView sessionId="ses_1" org="acme" />);
    await settle();
    stdin.write("Go on");
    await settle();
    stdin.write("\r");
    await settle();
    expect(sent).toEqual([["Go on", { interactionMode: "agent" }]]);
  });

  it("switches to plan mode on Ctrl+T", async () => {
    conversation = makeConversation();
    const { lastFrame, stdin } = render(<SessionView sessionId="ses_1" org="acme" />);
    stdin.write("\u0014"); // Ctrl+T
    await settle();
    expect(lastFrame()).toContain("Plan mode — read-only analysis, no file mutations");
  });
});

describe("INK-04 SessionView off a terminal", () => {
  it("renders read-only with no TTY stdin, without throwing", () => {
    conversation = makeConversation();
    const frame = stripVTControlCharacters(renderToString(<SessionView sessionId="ses_1" org="acme" />, { columns: 100 }));
    expect(frame).toContain("Refactor the billing module");
    expect(frame).not.toContain("Agent mode — full tool access");
  });

  it("denies an ask by default and says why, once", async () => {
    const answers: unknown[][] = [];
    const ask = waitingToolUse("write_file");
    conversation = makeConversation({
      asks: [ask],
      answerToolUse: async (...args: unknown[]) => {
        answers.push(args);
      },
    });
    const { lastFrame, rerender } = render(<SessionView sessionId="ses_1" org="acme" canAnswer={false} />);
    await settle();
    rerender(<SessionView sessionId="ses_1" org="acme" canAnswer={false} />);
    await settle();
    expect(answers).toEqual([[ask.id, "deny", "No one could answer: the session ran without a terminal."]]);
    expect(lastFrame()).toContain('Denied write_file — nobody at a terminal to approve it. Use approveDefault: "approve" to allow.');
    // The same ask in a new list (the conversation re-read) is not settled again.
    conversation = makeConversation({ ...conversation, asks: [ask] });
    rerender(<SessionView sessionId="ses_1" org="acme" canAnswer={false} />);
    await settle();
    expect(answers).toHaveLength(1);
    await expect(stripVTControlCharacters(lastFrame() ?? "")).toMatchFileSnapshot("__goldens__/session-off-terminal-denied.txt");
  });

  it("approves an ask when approveDefault says so, and ignores the default on a terminal", async () => {
    const answers: unknown[][] = [];
    const ask = waitingToolUse("write_file");
    conversation = makeConversation({ asks: [ask], answerToolUse: async (...args: unknown[]) => void answers.push(args) });
    const off = render(<SessionView sessionId="ses_1" org="acme" canAnswer={false} approveDefault="approve" />);
    await settle();
    expect(answers).toEqual([[ask.id, "allow", undefined]]);
    expect(off.lastFrame()).toContain('Approved write_file without asking (approveDefault: "approve").');
    off.unmount();

    answers.length = 0;
    render(<SessionView sessionId="ses_1" org="acme" canAnswer approveDefault="approve" />);
    await settle();
    expect(answers).toEqual([]);
  });

  it("settles nothing with approveDefault leave, for a view that only watches", async () => {
    const answers: unknown[][] = [];
    conversation = makeConversation({ asks: [waitingToolUse("write_file")], answerToolUse: async (...args: unknown[]) => void answers.push(args) });
    const { lastFrame } = render(<SessionView sessionId="ses_1" org="acme" canAnswer={false} approveDefault="leave" />);
    await settle();
    expect(answers).toEqual([]);
    expect(lastFrame()).not.toContain("nobody at a terminal");
  });

  it("leaves a file review pending and says it waits for a terminal", () => {
    conversation = makeConversation({ fileReviewSets: [reviewSet([{ id: "a", path: "one.ts" }])] });
    const frame = render(<SessionView sessionId="ses_1" org="acme" canAnswer={false} />).lastFrame() ?? "";
    expect(frame).toContain("This review waits for a terminal");
  });

  it("reads no keys: Ctrl+T does not switch the mode", async () => {
    conversation = makeConversation();
    const { lastFrame, stdin } = render(<SessionView sessionId="ses_1" org="acme" canAnswer={false} />);
    stdin.write("\u0014");
    await settle();
    expect(lastFrame()).not.toContain("Plan mode");
  });
});

describe("SessionView — onTurnEnd", () => {
  it("hears each turn end once, and a turn still working not at all", async () => {
    const heard: string[] = [];
    const onTurnEnd = (turn: { runId: string }) => void heard.push(turn.runId);
    const done = samples.turn({ runId: "run_a", phase: "completed" });
    const working = samples.turn({ runId: "run_b", phase: "running" });
    conversation = makeConversation({ turns: [done, working] });
    const { rerender } = render(<SessionView sessionId="ses_1" org="acme" onTurnEnd={onTurnEnd} />);
    await settle();
    expect(heard).toEqual(["run_a"]);

    conversation = makeConversation({ turns: [done, samples.turn({ runId: "run_b", phase: "failed" })] });
    rerender(<SessionView sessionId="ses_1" org="acme" onTurnEnd={onTurnEnd} />);
    await settle();
    rerender(<SessionView sessionId="ses_1" org="acme" onTurnEnd={onTurnEnd} />);
    await settle();
    expect(heard).toEqual(["run_a", "run_b"]);
  });
});
