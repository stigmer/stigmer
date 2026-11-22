/**
 * Proves SessionViewer's `onCustomToolUse`: the host hears each call of its
 * own tools that waits for its answer once per mounted viewer, with the
 * call's view and an answer that reaches the conversation's
 * `answerCustomToolUse`; a new handler function each render tells it no
 * more; a viewer opened again tells it again; a conversation with nothing
 * waiting tells it nothing; a viewer who may not answer (someone watching,
 * a teammate who sends but does not decide) is never told, and its card
 * gets no answer while the owner's does; a handler that throws or rejects
 * is reported once, never called again for the call, and the thread goes on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { conversationOf, scenarios } from "../../test";
import { ToolCardsContext, type CustomToolAnswer, type ToolCallInfo, type ToolCardProps } from "../../run/tool-cards-context";

const answerCustomToolUse = vi.fn(async (_id: string, _text: string, _options?: { readonly isError?: boolean }) => {});
let conv = { ...conversationOf(scenarios["waiting-on-app"]), answerCustomToolUse };
let access = { canSend: true, canDecide: true };

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

// One flow per conversation, as the real hook keeps its values stable: a
// fresh object each render would loop the viewer's effects on a re-render.
const flows = new WeakMap<object, unknown>();
vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => {
    const held = flows.get(conv);
    if (held !== undefined) return held;
    const flow = flowOf();
    flows.set(conv, flow);
    return flow;
  },
}));

function flowOf() {
  return {
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
  };
}

// The ending notice's wiring asks the server (permissions, recover): its own tests prove it.
vi.mock("../useTurnEndingWiring", () => ({
  useTurnEndingWiring: () => ({
    wiring: { viewer: { canManageProviders: false, canOpenAgent: false, canAct: true, stoppedIt: false } },
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("../useSessionAccess", () => ({
  useSessionAccess: () => access,
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

const waiting = scenarios["waiting-on-app"];

beforeEach(() => {
  conv = { ...conversationOf(waiting), answerCustomToolUse };
  access = { canSend: true, canDecide: true };
  answerCustomToolUse.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionViewer's onCustomToolUse", () => {
  it("tells the host once about each waiting call, with the card's view and an answer", async () => {
    const heard = vi.fn<(call: ToolCallInfo, answer: CustomToolAnswer) => void>();
    const { rerender } = render(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={(c, a) => heard(c, a)} />);
    expect(heard).toHaveBeenCalledTimes(1);
    const [call, answer] = heard.mock.calls[0]!;
    expect(call).toMatchObject({ tool: "register_cloud_account", server: "", state: "waiting-on-host", sessionId: "ses_1" });
    expect(call.input).toMatchObject({ account_name: "payments-prod" });

    // A new handler function each render tells it no more.
    rerender(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={(c, a) => heard(c, a)} />);
    expect(heard).toHaveBeenCalledTimes(1);

    await answer("Registered as acct_7Q2F", { isError: false });
    expect(answerCustomToolUse).toHaveBeenCalledWith(call.id, "Registered as acct_7Q2F", { isError: false });
  });

  it("tells the host again when the conversation is opened again, the call still waiting", () => {
    const heard = vi.fn();
    const first = render(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={heard} />);
    first.unmount();
    render(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={heard} />);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard.mock.calls[1]![0].id).toBe(heard.mock.calls[0]![0].id);
  });

  it("tells it nothing when no call waits (an answered call is history)", () => {
    conv = { ...conversationOf(scenarios.completed), answerCustomToolUse };
    const heard = vi.fn();
    render(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={heard} />);
    expect(heard).not.toHaveBeenCalled();
  });

  it("never tells someone only watching, nor a teammate who does not decide", () => {
    const heard = vi.fn();
    render(<SessionViewer sessionId="ses_1" org="demo" audience="observer" onCustomToolUse={heard} />);
    cleanup();
    access = { canSend: true, canDecide: false };
    render(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={heard} />);
    expect(heard).not.toHaveBeenCalled();
  });

  it("gives the owner's card an answer and a watcher's card none", () => {
    const answers: Array<CustomToolAnswer | undefined> = [];
    function Card({ answer }: ToolCardProps) {
      answers.push(answer);
      return <div data-testid="account-card" />;
    }
    const cards = { register_cloud_account: Card };
    render(
      <ToolCardsContext.Provider value={cards}>
        <SessionViewer sessionId="ses_1" org="demo" />
      </ToolCardsContext.Provider>,
    );
    expect(screen.getByTestId("account-card")).toBeTruthy();
    expect(answers.at(-1)).toBeTypeOf("function");
    cleanup();
    answers.length = 0;
    render(
      <ToolCardsContext.Provider value={cards}>
        <SessionViewer sessionId="ses_1" org="demo" audience="observer" />
      </ToolCardsContext.Provider>,
    );
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((a) => a === undefined)).toBe(true);
  });

  it("reports a handler that throws once, never calls it again for the call, and keeps the thread", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const heard = vi.fn(() => {
      throw new Error("panel broke");
    });
    const { rerender } = render(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={heard} />);
    rerender(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={heard} />);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.filter((args) => String(args[0]).includes("onCustomToolUse threw"))).toHaveLength(1);
    expect(screen.getByRole("article", { name: "User message" })).toBeTruthy();
    expect(screen.getByText(/Waiting for the app/)).toBeTruthy();
  });

  it("reports a handler whose promise rejects, never as an unhandled rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SessionViewer sessionId="ses_1" org="demo" onCustomToolUse={async () => Promise.reject(new Error("save failed"))} />);
    await vi.waitFor(() => expect(error.mock.calls.some((args) => String(args[0]).includes("onCustomToolUse threw"))).toBe(true));
  });
});
