import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerError, type AgentChannelInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { OAUTH_CALLBACK_MESSAGE_TYPE } from "../../internal/oauthPopup";
import { ConnectSlackDialog } from "../ConnectSlackDialog";

vi.mock("../../feedback/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

function fakePopup() {
  const popup = {
    closed: false,
    close() {
      popup.closed = true;
    },
    location: { href: "about:blank" },
  };
  return popup as unknown as Window & { location: { href: string } };
}

interface MockOverrides {
  create?: (input: AgentChannelInput) => Promise<unknown>;
  initiateInstall?: (input: unknown) => Promise<unknown>;
  completeInstall?: (input: unknown) => Promise<unknown>;
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    agentChannel: {
      create:
        overrides.create ??
        vi.fn().mockResolvedValue({
          metadata: { id: "ach_new", org: "acme", slug: "support-agent-slack" },
        }),
      initiateInstall:
        overrides.initiateInstall ??
        vi.fn().mockResolvedValue({
          authorizationUrl: "https://slack.com/oauth/v2/authorize?x=1",
          state: "state-1",
        }),
      completeInstall:
        overrides.completeInstall ??
        vi.fn().mockResolvedValue({
          metadata: { id: "ach_new" },
          status: {
            installState: 2,
            providerStatus: { case: "slack", value: { teamName: "Acme HQ" } },
          },
        }),
    },
  } as never;
}

function Providers({
  client,
  mode = "cloud",
  children,
}: {
  client: unknown;
  mode?: "cloud" | "local";
  children: ReactNode;
}) {
  return (
    <FetchCacheContext.Provider value={null}>
      <DeploymentModeContext.Provider value={mode}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </DeploymentModeContext.Provider>
    </FetchCacheContext.Provider>
  );
}

function makeAgent() {
  return {
    metadata: {
      id: "agt_1",
      org: "acme",
      slug: "support-agent",
      name: "Support Agent",
    },
    spec: {},
  } as never;
}

function deliverCallback(state: string, code = "auth-code-123") {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: OAUTH_CALLBACK_MESSAGE_TYPE, code, state },
      origin: window.location.origin,
    }),
  );
}

describe("ConnectSlackDialog", () => {
  beforeEach(() => {
    vi.spyOn(window, "open").mockReturnValue(fakePopup());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills a derived channel name and states who pays", () => {
    render(
      <Providers client={createMockStigmer()}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(screen.getByDisplayValue("Support Agent Slack")).toBeTruthy();
    expect(screen.getByText(/billed to/i)).toBeTruthy();
    expect(screen.getByText(/one agent at a time/i)).toBeTruthy();
  });

  it("creates the channel, runs the install, and reports the workspace", async () => {
    const create = vi.fn().mockResolvedValue({
      metadata: { id: "ach_new", org: "acme" },
    });
    const onChannelsChanged = vi.fn();
    const client = createMockStigmer({ create });

    render(
      <Providers client={client}>
        <ConnectSlackDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          onChannelsChanged={onChannelsChanged}
        />
      </Providers>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /connect to slack/i }),
    );

    // Create carries the full input derived from the agent.
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Support Agent Slack",
        org: "acme",
        agentRef: { org: "acme", slug: "support-agent" },
        enabled: true,
        slack: {},
      }),
    );

    // Progress is phase-visible while the popup is open.
    expect(
      await screen.findByText(/waiting for your approval/i),
    ).toBeTruthy();

    deliverCallback("state-1");

    expect(await screen.findByText(/connected to Acme HQ/i)).toBeTruthy();
    // Once for the created row, once for the completed install.
    expect(onChannelsChanged).toHaveBeenCalledTimes(2);
  });

  it("skips the create step when reconnecting an existing channel", async () => {
    const create = vi.fn();
    const initiateInstall = vi.fn().mockResolvedValue({
      authorizationUrl: "https://slack.com/oauth",
      state: "state-1",
    });
    const client = createMockStigmer({ create, initiateInstall });
    const channel = {
      metadata: { id: "ach_1", org: "acme", slug: "support-slack", name: "Support Slack" },
      spec: { enabled: true },
      status: { installState: 3 },
    } as never;

    render(
      <Providers client={client}>
        <ConnectSlackDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channel={channel}
        />
      </Providers>,
    );

    // Reconnect mode: no name field, header says Reconnect.
    expect(screen.queryByDisplayValue(/slack/i)).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "Reconnect to Slack" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /reconnect to slack/i }));

    await waitFor(() =>
      expect(initiateInstall).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: "ach_1" }),
      ),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("renders the server's refusal copy verbatim and offers retry", async () => {
    const initiateInstall = vi
      .fn()
      .mockRejectedValue(
        new StigmerError(
          "failed-precondition",
          "Slack integration is not configured on this deployment.",
          9,
        ),
      );
    const client = createMockStigmer({ initiateInstall });

    render(
      <Providers client={client}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /connect to slack/i }),
    );

    expect(
      await screen.findByText(/not configured on this deployment/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("preempts the flow with the cloud notice in local mode", () => {
    render(
      <Providers client={createMockStigmer()} mode="local">
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(screen.getByText(/require Stigmer Cloud/i)).toBeTruthy();
    // No connect button at all — the flow is preempted, not just failing.
    expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull();
  });

  it("resets flow state when reopened (body remounts per session)", async () => {
    const initiateInstall = vi
      .fn()
      .mockRejectedValue(new StigmerError("unavailable", "slack is down", 14));
    const client = createMockStigmer({ initiateInstall });

    const { rerender } = render(
      <Providers client={client}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /connect to slack/i }),
    );
    expect(await screen.findByText(/slack is down/i)).toBeTruthy();

    rerender(
      <Providers client={client}>
        <ConnectSlackDialog open={false} onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );
    rerender(
      <Providers client={client}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(screen.queryByText(/slack is down/i)).toBeNull();
  });
});
