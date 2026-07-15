import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerError, type AgentChannelInput } from "@stigmer/sdk";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
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
  /** Org channel apps returned by channelapp.listByOrg (BYO picker). */
  channelApps?: unknown[];
}

/** A registered BYO Slack app as channelapp.listByOrg returns it. */
function makeChannelApp(slug = "acme-support-app", name = "Acme Support App") {
  return {
    metadata: { id: `chapp_${slug}`, org: "acme", slug, name },
    spec: { providerConfig: { case: "slack", value: {} } },
  };
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    channelapp: {
      listByOrg: vi.fn().mockResolvedValue({
        entries: overrides.channelApps ?? [],
      }),
    },
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
    environment: {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            metadata: {
              slug: "github-credentials",
              name: "GitHub Credentials",
              org: "acme",
              visibility: ApiResourceVisibility.visibility_org,
            },
            spec: {},
          },
        ],
        totalCount: 1,
      }),
      getByReference: vi.fn().mockResolvedValue({
        metadata: { visibility: ApiResourceVisibility.visibility_org },
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

function makeAgent(overrides: { withTools?: boolean } = {}) {
  return {
    metadata: {
      id: "agt_1",
      org: "acme",
      slug: "support-agent",
      name: "Support Agent",
    },
    spec: overrides.withTools
      ? { mcpServerUsages: [{ mcpServerRef: { org: "acme", slug: "github" } }] }
      : {},
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
    expect(screen.getByText(/one agent per Slack app/i)).toBeTruthy();
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

  it("keeps the tool-credentials section collapsed for agents without tools", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    const toggle = await screen.findByRole("button", { name: "Tool credentials" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Add environment")).toBeNull();
  });

  it("binds credentials at connect time — create carries the chosen environment refs", async () => {
    const create = vi.fn().mockResolvedValue({
      metadata: { id: "ach_new", org: "acme" },
    });
    const client = createMockStigmer({ create });

    render(
      <Providers client={client}>
        <ConnectSlackDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent({ withTools: true })}
        />
      </Providers>,
    );

    // Tool-using agent: the section is expanded by default (essential
    // configuration, not an advanced option) and warns while unbound.
    const toggle = await screen.findByRole("button", { name: "Tool credentials" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      await screen.findByText(/no credentials are bound to this channel/i),
    ).toBeTruthy();

    const select = await screen.findByLabelText("Add environment");
    fireEvent.change(select, { target: { value: "github-credentials" } });

    fireEvent.click(
      screen.getByRole("button", { name: /connect to slack/i }),
    );

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentRefs: [{ org: "acme", slug: "github-credentials" }],
        }),
      ),
    );
  });

  it("hides the serving-app choice when the org has no channel apps", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    // With no registered apps the platform app is the only answer — a
    // one-option radio group would be noise, so the section is absent.
    await screen.findByRole("button", { name: /connect to slack/i });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Connect as")).toBeNull();
  });

  it("defaults to the platform app and create carries no appRef", async () => {
    const create = vi.fn().mockResolvedValue({
      metadata: { id: "ach_new", org: "acme" },
    });
    const client = createMockStigmer({
      create,
      channelApps: [makeChannelApp()],
    });

    render(
      <Providers client={client}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    // Both options render; the platform app is pre-selected.
    const platform = await screen.findByRole("radio", { name: /stigmer app/i });
    expect((platform as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /connect to slack/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({ appRef: expect.anything() }),
    );
  });

  it("connecting as your own app carries its appRef on create", async () => {
    const create = vi.fn().mockResolvedValue({
      metadata: { id: "ach_new", org: "acme" },
    });
    const client = createMockStigmer({
      create,
      channelApps: [makeChannelApp("acme-support-app", "Acme Support App")],
    });

    render(
      <Providers client={client}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    fireEvent.click(
      await screen.findByRole("radio", { name: /acme support app/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /connect to slack/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          appRef: { org: "acme", slug: "acme-support-app" },
        }),
      ),
    );
  });

  it("offers only Slack-typed channel apps in the picker", async () => {
    const client = createMockStigmer({
      channelApps: [
        makeChannelApp("acme-support-app", "Acme Support App"),
        {
          metadata: { id: "chapp_wa", org: "acme", slug: "acme-whatsapp", name: "Acme WhatsApp" },
          spec: { providerConfig: { case: "whatsapp", value: {} } },
        },
      ],
    });

    render(
      <Providers client={client}>
        <ConnectSlackDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(
      await screen.findByRole("radio", { name: /acme support app/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /acme whatsapp/i })).toBeNull();
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
