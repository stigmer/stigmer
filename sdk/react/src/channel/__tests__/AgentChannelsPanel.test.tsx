import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentChannelInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { AgentChannelsPanel } from "../AgentChannelsPanel";

// Toasts are visual feedback owned by the feedback module; keep them inert.
vi.mock("../../feedback/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The card actions live in a Base UI menu, whose content is portaled to the
// SDK portal container. Without a StigmerProvider that container is null and
// the menu renders nothing — pin it to document.body so the menu mounts.
vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

beforeAll(() => {
  // happy-dom does not implement the native dialog show/close methods.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
  // Base UI's menu positioner observes its anchor; happy-dom lacks
  // ResizeObserver, so provide a no-op shim.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

interface MockOverrides {
  channels?: unknown[];
  apply?: (input: AgentChannelInput) => Promise<unknown>;
  delete?: (id: string) => Promise<unknown>;
  checkMyPermission?: (input: unknown) => Promise<unknown>;
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    agentChannel: {
      getByAgent: vi.fn().mockResolvedValue({
        totalCount: overrides.channels?.length ?? 0,
        items: overrides.channels ?? [],
      }),
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ metadata: { id: "ach_new" } }),
      delete: overrides.delete ?? vi.fn().mockResolvedValue({}),
      initiateInstall: vi.fn().mockResolvedValue({
        authorizationUrl: "https://slack.com/oauth",
        state: "s",
      }),
      completeInstall: vi.fn().mockResolvedValue({}),
    },
    iamPolicy: {
      checkMyPermission:
        overrides.checkMyPermission ??
        vi.fn().mockResolvedValue({ isAuthorized: true }),
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

function makeChannel(overrides: {
  installState?: number;
  enabled?: boolean;
  teamName?: string;
  id?: string;
  name?: string;
} = {}) {
  const {
    installState = 2, // installed
    enabled = true,
    teamName,
    id = "ach_1",
    name = "Support Slack",
  } = overrides;
  return {
    metadata: { id, org: "acme", slug: "support-slack", name, labels: {} },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled,
      providerConfig: { case: "slack", value: {} },
    },
    status: {
      installState,
      providerStatus: teamName
        ? { case: "slack", value: { teamName, grantedScopes: [] } }
        : { case: undefined },
    },
  };
}

describe("AgentChannelsPanel", () => {
  it("renders the empty state with a connect call to action", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("No channels yet")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /connect to slack/i })).toBeTruthy();
  });

  it("lists channels with install state and workspace facts", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.getByText(/Acme HQ/)).toBeTruthy();
    // Installed channels expose the serving switch, not a connect button.
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("shows Connect for pending installs and Reconnect for revoked ones", async () => {
    const client = createMockStigmer({
      channels: [
        makeChannel({ id: "ach_p", name: "Pending", installState: 1 }),
        makeChannel({ id: "ach_r", name: "Revoked", installState: 3, teamName: "Old WS" }),
      ],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Pending")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByText(/removed from Old WS/)).toBeTruthy();
  });

  it("toggles serving with a full-spec save (config-preserving pause)", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
      apply,
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByRole("switch")).toBeTruthy());
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(apply).toHaveBeenCalled());
    // The toggle must carry the full input — dropping agentRef or the
    // provider marker would wipe them on the server.
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Support Slack",
        org: "acme",
        agentRef: { org: "acme", slug: "support-agent" },
        slack: {},
        enabled: false,
      }),
    );
  });

  it("confirms before disconnecting and deletes on confirm", async () => {
    const del = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
      delete: del,
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));

    // The confirmation explains teardown vs pause before anything happens.
    expect(del).not.toHaveBeenCalled();
    const title = await screen.findByText("Disconnect channel?");
    expect(screen.getByText(/stops serving immediately/i)).toBeTruthy();

    const confirmDialog = title.closest("dialog") as HTMLElement;
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Disconnect", hidden: true }),
    );
    await waitFor(() => expect(del).toHaveBeenCalledWith("ach_1"));
  });

  it("opens the connect dialog from the empty state", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /connect to slack/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /connect to slack/i }));

    expect(await screen.findByText(/pick a Slack workspace/i)).toBeTruthy();
  });

  it("delegates connect to the host when onConnectExternal is provided", async () => {
    const onConnectExternal = vi.fn();
    const channel = makeChannel({ installState: 1 });
    const client = createMockStigmer({ channels: [channel] });
    render(
      <Providers client={client}>
        <AgentChannelsPanel
          agent={makeAgent()}
          onConnectExternal={onConnectExternal}
        />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(onConnectExternal).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ id: "ach_1" }) }),
    );
    // No in-app dialog — the host owns the journey.
    expect(screen.queryByText(/pick a Slack workspace/i)).toBeNull();
  });

  it("replaces connect affordances with the cloud notice in local mode", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client} mode="local">
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText(/require Stigmer Cloud/i)).toBeTruthy(),
    );
    // No doomed connect button in local mode (no external delegate).
    expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull();
  });

  it("keeps CRUD available in local mode: the serving switch still renders", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client} mode="local">
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    expect(screen.getByRole("switch")).toBeTruthy();
    // A fully-installed list needs no notice — nothing to connect.
    expect(screen.queryByText(/require Stigmer Cloud/i)).toBeNull();
  });

  it("hides mutation affordances when the viewer lacks permission", async () => {
    const checkMyPermission = vi
      .fn()
      .mockResolvedValue({ isAuthorized: false });
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
      checkMyPermission,
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /actions for/i })).toBeNull();
  });

  it("renders an error state when the list fails to load", async () => {
    const client = {
      agentChannel: {
        getByAgent: vi.fn().mockRejectedValue(new Error("boom")),
      },
      iamPolicy: {
        checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: true }),
      },
    } as never;
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText(/failed to load channels/i)).toBeTruthy(),
    );
  });
});
