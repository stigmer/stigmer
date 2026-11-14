/**
 * Proves what the session viewer says around the conversation in the states
 * a reader meets beside the turns themselves:
 *
 *   - a session not made yet draws its header and first message in outline,
 *     announced as "Opening the session", so the page does not jump when
 *     they arrive;
 *   - a turn nothing has been heard from for a while says it is taking
 *     longer than usual, that it keeps going if the reader leaves, and that
 *     the session will be here when it is done; a stream that timed out
 *     says that instead;
 *   - a session that did not open says so and reloads the page on Try
 *     again; a stream that broke under an open conversation offers
 *     Reconnect, which reconnects it;
 *   - every reader without a composer (an observer, and anyone reading a
 *     channel conversation) gets the footer saying they are reading it and
 *     only its members reply; a member gets the composer and no footer.
 *
 * The thread and composer are probes; the conversation is the scenario
 * catalogue's, changed per case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";
import type { UseSessionConversationReturn } from "@stigmer/react-core";
import { CHANNEL_SESSION_LABELS } from "../channelOrigin";
import { conversationOf, samples, scenarios } from "../../test";

vi.mock("../../run/MessageThread", () => ({
  MessageThread: () => <div data-testid="thread-probe" />,
}));

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    SessionComposer: ({ disabled }: { disabled?: boolean }) => <div data-testid="composer-probe" data-disabled={disabled === true ? "true" : "false"} />,
  };
});

const state = vi.hoisted(() => ({ conv: undefined as unknown }));

const workspace = {
  entries: [],
  hasEntries: false,
  toInput: () => [],
  addGitRepo: () => {},
  addLocalPath: () => {},
  removeEntry: () => {},
  clear: () => {},
};

vi.mock("../useSessionPageFlow", () => ({
  useSessionPageFlow: () => ({
    conv: state.conv,
    harness: "stigmer" as const,
    executionTarget: undefined,
    model: [undefined, () => {}] as const,
    interactionMode: ["agent" as const, () => {}] as const,
    agentRef: { org: "demo", slug: "support-bot" },
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
    displayRun: null,
    allRuns: [],
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

vi.mock("../../file/useSessionFiles", () => ({
  useSessionFiles: () => ({ files: [], isLoading: false, error: null, refetch: () => {} }),
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

const SLOW_WORDS = "This is taking longer than usual. It keeps going if you leave; the session will be here when it’s done.";
const READER_WORDS = "You’re reading this conversation. Only its members can reply.";

/** The conversation the viewer reads: a scenario's, with `changes` over it. */
function conversation(changes: Partial<UseSessionConversationReturn> = {}, scenario = scenarios.completed): void {
  state.conv = { ...conversationOf(scenario), ...changes };
}

beforeEach(() => {
  conversation();
});

afterEach(cleanup);

describe("SessionViewer — what a reader is told around the conversation", () => {
  it("outlines a session not made yet, announced as opening, its composer in place and closed", () => {
    conversation({ session: null });
    render(<SessionViewer sessionId="" org="demo" />);
    const opening = screen.getByRole("status", { name: "Opening the session" });
    expect(opening.textContent).toBe("Opening the session…");
    expect(screen.getByText("Opening the session…").className).toContain("stg:text-sm");
    expect(screen.getByTestId("composer-probe").getAttribute("data-disabled")).toBe("true");
    expect(screen.queryByTestId("thread-probe")).toBeNull();
    expect(screen.queryByText(/Starting session/)).toBeNull();
  });

  it("says a slow turn keeps going if the reader leaves", () => {
    conversation({ isSlow: true }, scenarios.busy);
    render(<SessionViewer sessionId="ses_1" org="demo" />);
    expect(screen.getByText(SLOW_WORDS)).toBeTruthy();
    expect(screen.queryByText(/Still working/)).toBeNull();
  });

  it("says nothing of slowness once the stream timed out, nor while the turn is not slow", () => {
    conversation({ isSlow: true, connectTimedOut: true }, scenarios.busy);
    const { unmount } = render(<SessionViewer sessionId="ses_1" org="demo" />);
    expect(screen.queryByText(SLOW_WORDS)).toBeNull();
    unmount();

    conversation({}, scenarios.busy);
    render(<SessionViewer sessionId="ses_1" org="demo" />);
    expect(screen.queryByText(SLOW_WORDS)).toBeNull();
  });

  it("tells an observer they are reading the conversation, where the composer would be", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" audience="observer" />);
    expect(screen.queryByTestId("composer-probe")).toBeNull();
    expect(screen.getByText(READER_WORDS).closest("[role='status']")).toBeTruthy();
  });

  it("tells anyone reading a channel conversation that only its members reply", () => {
    const session = samples.session({ subject: "Refund for order 1182" });
    session.metadata!.labels = { [CHANNEL_SESSION_LABELS.channelId]: "chn_1", [CHANNEL_SESSION_LABELS.conversationKey]: "C1:1.0" };
    conversation({ session });
    render(<SessionViewer sessionId="ses_1" org="demo" />);
    expect(screen.queryByTestId("composer-probe")).toBeNull();
    expect(screen.getByText(READER_WORDS)).toBeTruthy();
  });

  it("gives a member the composer and no reader's footer", () => {
    render(<SessionViewer sessionId="ses_1" org="demo" />);
    expect(screen.getByTestId("composer-probe")).toBeTruthy();
    expect(screen.queryByText(READER_WORDS)).toBeNull();
  });

  it("says a session that did not open, and reloads the page on Try again", () => {
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, "location", {
      value: { ...location, reload },
      configurable: true,
    });
    try {
      conversation({ loadError: new Error("session not found") });
      render(<SessionViewer sessionId="ses_1" org="demo" />);
      expect(screen.getByRole("heading", { name: "This session didn’t open" })).toBeTruthy();
      expect(screen.queryByTestId("thread-probe")).toBeNull();

      // Any other kind keeps the client's own sentence for it.
      expect(screen.getByText("session not found")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { value: location, configurable: true });
    }
  });

  it("says the server didn't answer, and that the session is safe, when it was never reached", () => {
    conversation({ loadError: new ConnectError("upstream connect error", Code.Unavailable) });
    render(<SessionViewer sessionId="ses_1" org="demo" />);
    expect(screen.getByText("Stigmer's server didn't answer. The session itself is safe; nothing in it was lost.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" }).className).toContain("stg:bg-primary");
  });

  it("says a broken stream beside the conversation, and reconnects on Reconnect", () => {
    const reconnectStream = vi.fn();
    conversation({ streamError: new Error("stream closed"), reconnectStream }, scenarios.busy);
    render(<SessionViewer sessionId="ses_1" org="demo" />);
    expect(screen.getByTestId("thread-probe")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(reconnectStream).toHaveBeenCalledTimes(1);
  });
});
