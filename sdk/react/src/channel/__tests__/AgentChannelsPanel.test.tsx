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

interface MakeChannelOverrides {
  installState?: number;
  enabled?: boolean;
  teamName?: string;
  id?: string;
  name?: string;
  /** BYO channel-app binding (spec.app_ref); absent = platform app. */
  appRefSlug?: string;
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    // The connect dialog's serving-app picker lists the org's channel
    // apps; the panel itself never fetches them.
    channelapp: {
      listByOrg: vi.fn().mockResolvedValue({ entries: [] }),
    },
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
    environment: {
      list: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      getByReference: vi.fn().mockRejectedValue(new Error("not found")),
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

function makeChannel(overrides: MakeChannelOverrides = {}) {
  const {
    installState = 2, // installed
    enabled = true,
    teamName,
    id = "ach_1",
    name = "Support Slack",
    appRefSlug,
  } = overrides;
  return {
    metadata: { id, org: "acme", slug: "support-slack", name, labels: {} },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled,
      providerConfig: { case: "slack", value: {} },
      ...(appRefSlug ? { appRef: { org: "acme", slug: appRefSlug } } : {}),
    },
    status: {
      installState,
      providerStatus: teamName
        ? { case: "slack", value: { teamName, grantedScopes: [] } }
        : { case: undefined },
    },
  };
}

function makeWhatsAppChannel(overrides: {
  installState?: number;
  id?: string;
  name?: string;
} = {}) {
  const { installState = 2, id = "ach_wa", name = "Support WhatsApp" } = overrides;
  return {
    metadata: { id, org: "acme", slug: "support-whatsapp", name, labels: {} },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      providerConfig: {
        case: "whatsapp",
        value: { phoneNumberId: "106540352242922" },
      },
      appRef: { org: "acme", slug: "acme-meta-app" },
    },
    status: {
      installState,
      providerStatus:
        installState === 2
          ? {
              case: "whatsapp",
              value: {
                phoneNumberId: "106540352242922",
                displayPhoneNumber: "+1 555 025 3483",
                verifiedName: "Acme Corp",
                channelAppId: "chapp_acme-meta-app",
              },
            }
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

  it("names the serving app on each card — platform vs your own app", async () => {
    const client = createMockStigmer({
      channels: [
        makeChannel({ id: "ach_1", name: "Platform Channel" }),
        makeChannel({
          id: "ach_2",
          name: "Branded Channel",
          appRefSlug: "acme-support-app",
        }),
      ],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    // Two channels of one workspace are only tellable apart by their
    // serving app — the whole point of BYO (T04 item 2). The line also
    // names the bot members @mention (falls back to the ref slug when
    // the app isn't in the fetched list).
    await waitFor(() =>
      expect(
        screen.getByText(/Serving app: Stigmer — members @mention Stigmer/),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(/Serving app: acme-support-app \(your app\)/),
    ).toBeTruthy();
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

    expect(
      await screen.findByRole("heading", { name: "Connect to Slack" }),
    ).toBeTruthy();
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

    // The card menu still renders: Sessions is a viewer-level action
    // (everyone who sees the card holds can_view on the channel — the same
    // bar as viewing its sessions, DD-012). Mutation items stay
    // permission-gated and absent.
    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));
    expect(screen.getByRole("menuitem", { name: /sessions/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /tool credentials/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /disconnect/i })).toBeNull();
  });

  it("offers Manage access from the card menu — the channel's canonical access home (F-11)", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    // The dialog's People section lists existing grants on open.
    (
      client as { iamPolicy: Record<string, unknown> }
    ).iamPolicy.listResourceAccessByPrincipal = vi
      .fn()
      .mockResolvedValue({ entries: [] });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /manage access/i }));

    // The one canonical dialog opens, and its subtitle names the channel
    // — the scope every grant covers (a participant grant is per
    // channel, never per conversation).
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Manage access" })).toBeTruthy(),
    );
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(within(dialog as HTMLElement).getByText("Support Slack")).toBeTruthy();
  });

  it("warns on an installed card when a tool-using agent has no credentials bound", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent({ withTools: true })} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    // The card is where an owner discovers the gap — including one who
    // connected before credential binding existed.
    expect(
      await screen.findByText(/no credentials are bound to this channel/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /bind credentials/i })).toBeTruthy();
  });

  it("stays silent on cards for agents without tools", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    expect(
      screen.queryByText(/no credentials are bound to this channel/i),
    ).toBeNull();
  });

  it("opens the credentials dialog from the card's action menu", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Tool credentials" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Tool credentials" }),
    ).toBeTruthy();
  });

  it("offers one visible connect button per provider, each with its cursor target", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    // Two providers = two buttons side by side, not a dropdown — each
    // keeps its stable docs-demo cursor target (see providers.ts).
    const slackBtn = await screen.findByRole("button", { name: /connect to slack/i });
    const whatsappBtn = screen.getByRole("button", { name: /connect to whatsapp/i });
    expect(slackBtn.getAttribute("data-cursor-target")).toBe("connect-slack");
    expect(whatsappBtn.getAttribute("data-cursor-target")).toBe("connect-whatsapp");
  });

  it("opens the WhatsApp connect dialog from the empty state", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /connect to whatsapp/i }),
    );

    expect(
      await screen.findByRole("heading", { name: "Connect to WhatsApp" }),
    ).toBeTruthy();
  });

  it("renders WhatsApp cards with the number facts and serving line", async () => {
    const client = createMockStigmer({
      channels: [makeWhatsAppChannel()],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Support WhatsApp")).toBeTruthy(),
    );
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.getByText(/\+1 555 025 3483/)).toBeTruthy();
    expect(screen.getByText(/Acme Corp/)).toBeTruthy();
    // The serving line names the Meta app (falls back to the ref slug
    // when the app isn't in the fetched list) — never "@mention".
    expect(
      screen.getByText(/Serving app: acme-meta-app \(your Meta app\)/),
    ).toBeTruthy();
  });

  it("connects WhatsApp in-app even when the host provides onConnectExternal", async () => {
    // The desktop hand-off exists for OAuth popups the webview cannot
    // open; a direct install is a plain API call and needs no hand-off.
    const onConnectExternal = vi.fn();
    const client = createMockStigmer({
      channels: [makeWhatsAppChannel({ installState: 1 })],
    });
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

    expect(onConnectExternal).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("heading", { name: "Reconnect to WhatsApp" }),
    ).toBeTruthy();
  });

  it("hides only the WhatsApp connect affordance in local mode with an external delegate", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client} mode="local">
        <AgentChannelsPanel agent={makeAgent()} onConnectExternal={vi.fn()} />
      </Providers>,
    );

    // Slack can still hand off to the host's browser; WhatsApp installs
    // are in-app-only and doomed on a local backend, so its button
    // yields to the cloud notice.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /connect to slack/i }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole("button", { name: /connect to whatsapp/i }),
    ).toBeNull();
    expect(screen.getByText(/require Stigmer Cloud/i)).toBeTruthy();
  });

  it("scopes the disconnect prompt to the channel's provider", async () => {
    const client = createMockStigmer({
      channels: [makeWhatsAppChannel()],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Support WhatsApp")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));

    // WhatsApp credentials live on the shared ChannelApp and survive the
    // channel (DD-WA-3) — the prompt must not claim they are removed.
    await screen.findByText("Disconnect channel?");
    expect(screen.getByText(/number binding is removed/i)).toBeTruthy();
    expect(screen.queryByText(/including credentials/i)).toBeNull();
  });

  it("offers Templates on WhatsApp cards and opens the dialog from the menu", async () => {
    const client = createMockStigmer({
      channels: [makeWhatsAppChannel()],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Support WhatsApp")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Templates" }));

    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeTruthy();
    // This channel has no proactive grant — the dialog teaches instead
    // of firing a doomed listTemplates call (project DD-007 D4).
    expect(
      screen.getByText("Business-initiated messaging is not enabled"),
    ).toBeTruthy();
  });

  it("offers no Templates item on providers without a template registry", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));

    // Slack has no template concept: hidden, not disabled — a disabled
    // item would imply the capability might one day exist there.
    expect(
      await screen.findByRole("menuitem", { name: /sessions/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Templates" })).toBeNull();
  });

  it("hides Templates from viewers — the server's listTemplates bar is can_edit", async () => {
    const checkMyPermission = vi
      .fn()
      .mockResolvedValue({ isAuthorized: false });
    const client = createMockStigmer({
      channels: [makeWhatsAppChannel()],
      checkMyPermission,
    });
    render(
      <Providers client={client}>
        <AgentChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Support WhatsApp")).toBeTruthy(),
    );
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /actions for/i }));

    expect(
      await screen.findByRole("menuitem", { name: /sessions/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Templates" })).toBeNull();
  });

  it("renders an error state when the list fails to load", async () => {
    const client = {
      agentChannel: {
        getByAgent: vi.fn().mockRejectedValue(new Error("boom")),
      },
      channelapp: {
        listByOrg: vi.fn().mockResolvedValue({ entries: [] }),
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
