/**
 * Stop survives a hostile host. With every part a host can hand the viewer
 * throwing (each thread slot, a tool card, message actions, a tool
 * presenter's overrides, the app's own tools' callback), an owner's working turn still draws its thread and
 * still offers Stop, and Stop sends the session's interrupt. The thread and
 * the composer are real; the session's data is the scenario catalogue's
 * working turn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ToolKind } from "@stigmer/client";
import { conversationOf, scenarios } from "../../test";
import type { MessageThreadSlots } from "../../run/MessageThread";
import { ToolCardsContext } from "../../run/tool-cards-context";
import { registerToolPresenter, type ToolPresenter } from "../../run/tool-presenter";

const busy = scenarios.busy;
const stop = vi.fn(async () => {});
const conv = { ...conversationOf(busy), isStoppable: true, stop };

const workspace = {
  entries: [],
  hasEntries: false,
  toInput: () => [],
  addGitRepo: () => {},
  addLocalPath: () => {},
  remove: () => {},
  clear: () => {},
};

vi.mock("../../file/useSessionFiles", () => ({
  useSessionFiles: () => ({ files: [], isLoading: false, error: null, refetch: () => {} }),
}));

vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => ({
    conv,
    harness: "stigmer" as const,
    executionTarget: "cloud" as const,
    model: [undefined, () => {}] as const,
    interactionMode: ["agent" as const, () => {}] as const,
    agentRef: null,
    setAgentRef: () => {},
    resolution: null,
    setResolution: () => {},
    agentVersion: {
      pinnedHash: "",
      currentHash: "",
      agentName: "",
      isOutdated: false,
      labelOf: (hash: string) => hash,
      update: () => {},
      isUpdating: false,
      updateError: null,
    },
    pluginRefs: [],
    setPluginRefs: () => {},
    skillRefs: [],
    setSkillRefs: () => {},
    workspace,
    autoApproveAll: false,
    setAutoApproveAll: () => {},
    answerToolUse: () => {},
    handleSubmit: () => {},
    submitError: null,
    displayRun: conv.activeRun,
    allRuns: conv.runs,
    sandboxWorkspaceRoot: undefined,
  }),
}));

// The ending notice's wiring asks the server (permissions, recover): its own tests prove it.
vi.mock("../useTurnEndingWiring", () => ({
  useTurnEndingWiring: () => ({
    wiring: { viewer: { canManageProviders: false, canOpenAgent: false, canAct: true, stoppedIt: false } },
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => ({ canSend: true, canDecide: true }),
}));

vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useStigmer: () => ({
    platform: { getServerInfo: async () => ({}) },
    routine: { get: async () => Promise.reject(new Error("not found")) },
    score: { listBySession: async () => ({ entries: [], nextPageToken: "" }) },
    run: { getArtifactContent: vi.fn() },
  }),
  useWhoAmI: () => ({ account: null, isLoading: false, error: new Error("no account") }),
}));

import { SessionViewer } from "../SessionViewer";

function broke(part: string): never {
  throw new Error(`host part broke: ${part}`);
}

/** Every slot throws; typed so a new slot joins here too. */
const THROWING_SLOTS: Required<MessageThreadSlots> = {
  MessageEntry: () => broke("MessageEntry"),
  ApprovalCard: () => broke("ApprovalCard"),
  TodoCard: () => broke("TodoCard"),
  TodoRow: () => broke("TodoRow"),
  PlanFileCard: () => broke("PlanFileCard"),
  PlanCompletionCard: () => broke("PlanCompletionCard"),
  PlanStreamingCard: () => broke("PlanStreamingCard"),
  SetupProgress: () => broke("SetupProgress"),
  RecalledMemoriesCard: () => broke("RecalledMemoriesCard"),
  RunErrorNotice: () => broke("RunErrorNotice"),
  LivenessStatusLine: () => broke("LivenessStatusLine"),
};

const THROWING_PRESENTER: ToolPresenter = {
  label: () => broke("presenter label"),
  summary: () => broke("presenter summary"),
  disclosure: () => broke("presenter disclosure"),
  chrome: () => broke("presenter chrome"),
  runGroupable: () => broke("presenter runGroupable"),
};

const PRESENTED_KINDS: readonly ToolKind[] = ["shell", "file_read", "file_edit", "file_write", "search", "list", "mcp", "todo"];

let disposers: Array<() => void> = [];
let uncaught: unknown[];
const onWindowError = (event: ErrorEvent) => {
  uncaught.push(event.error);
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  disposers = PRESENTED_KINDS.map((kind) => registerToolPresenter(kind, THROWING_PRESENTER));
  uncaught = [];
  window.addEventListener("error", onWindowError);
  stop.mockClear();
});

afterEach(() => {
  cleanup();
  for (const dispose of disposers) dispose();
  window.removeEventListener("error", onWindowError);
  vi.restoreAllMocks();
});

describe("SessionViewer under a host whose every part throws", () => {
  it("still draws the working turn and offers Stop, which sends the interrupt", () => {
    render(
      <ToolCardsContext.Provider value={{ mcp__billing__create_invoice: () => broke("tool card") }}>
        <SessionViewer sessionId="ses_1" org="demo" threadSlots={THROWING_SLOTS} messageActions={() => broke("messageActions")} onCustomToolUse={() => broke("onCustomToolUse")} />
      </ToolCardsContext.Provider>,
    );

    // The person's message, in the kit's bubble.
    expect(screen.getByRole("article", { name: "User message" })).toBeTruthy();
    const stopButton = screen.getByRole("button", { name: "Stop generating" });
    fireEvent.click(stopButton);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(uncaught).toEqual([]);
  });
});
