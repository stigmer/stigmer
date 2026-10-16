// ChannelsPanel: the Channels tab — every channel of an agent (its chat
// links, Slack workspaces and WhatsApp numbers) in one list, in the order
// listByAgent answers. Pins the count heading and the empty state, the one
// Add affordance per edition (an "Add channel" menu once channels are
// listed, one visible button per type on an empty tab, the unavailable
// types named with what they need), the cloud notice only for a listed
// vendor channel this edition cannot connect, the chat link's create, edit
// and delete flows, and the vendor cards' install and serving axes with
// their connect, pause, disconnect and per-card dialogs. The chat link's
// own card is pinned in ChatLinkCard.test.tsx.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ChannelInput } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ChannelsPanel } from "../ChannelsPanel";
import { toast } from "../../feedback/toast";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";

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
  listByAgent?: (input: unknown) => Promise<unknown>;
  update?: (resource: Channel, paths: string[]) => Promise<unknown>;
  delete?: (id: string) => Promise<unknown>;
  checkMyPermission?: (input: unknown) => Promise<unknown>;
  /** The organization's channel apps, as `channelapp.list` answers them. */
  channelApps?: unknown[];
}

interface MakeChannelOverrides {
  installState?: number;
  enabled?: boolean;
  teamName?: string;
  id?: string;
  name?: string;
  /** BYO channel-app binding (spec.app_ref); absent = platform app. */
  appRefSlug?: string;
  /** A BYO app deleted since: the reference comes back with this id and no slug. */
  appRefDeletedId?: string;
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    // The org's channel apps: the vendor cards name their serving app
    // from this list, and the connect dialog's picker offers it.
    channelapp: {
      list: vi.fn().mockResolvedValue({ entries: overrides.channelApps ?? [], nextPageToken: "" }),
    },
    channel: {
      listByAgent:
        overrides.listByAgent ??
        vi.fn().mockResolvedValue({ entries: overrides.channels ?? [], nextPageToken: "" }),
      apply: vi.fn().mockResolvedValue({}),
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ metadata: { id: "ach_new" } }),
      delete: overrides.delete ?? vi.fn().mockResolvedValue({}),
      initiateInstall: vi.fn().mockResolvedValue({
        authorizationUrl: "https://slack.com/oauth",
        state: "s",
      }),
      completeInstall: vi.fn().mockResolvedValue({}),
      rotateLink: vi.fn().mockResolvedValue({}),
    },
    billing: {
      getOrCreateBillingAccount: vi.fn().mockResolvedValue(null),
    },
    vault: {
      list: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
      getByReference: vi.fn().mockRejectedValue(new Error("not found")),
    },
    grant: {
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
  mode?: "cloud" | "local" | "enterprise";
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
      ? { plugins: [{ org: "acme", slug: "github" }] }
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
    appRefDeletedId,
  } = overrides;
  return {
    metadata: { id, org: "acme", slug: "support-slack", name, labels: {} },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled,
      type: {
        case: "slack",
        value: {
          ...(appRefSlug ? { appRef: { org: "acme", slug: appRefSlug } } : {}),
          ...(appRefDeletedId ? { appRef: { org: "acme", slug: "", id: appRefDeletedId } } : {}),
        },
      },
    },
    status: {
      installState,
      typeStatus: teamName
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
      type: {
        case: "whatsapp",
        value: {
          phoneNumberId: "106540352242922",
          appRef: { org: "acme", slug: "acme-meta-app" },
        },
      },
    },
    status: {
      installState,
      typeStatus:
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

function makeChatLink(overrides: {
  id?: string;
  name?: string;
  enabled?: boolean;
  audience?: ChannelAudience;
} = {}) {
  const { id = "ash_1", name = "Website chat", enabled = true, audience = ChannelAudience.public } =
    overrides;
  return {
    metadata: { id, org: "acme", slug: `chat-${id}`, name, labels: {} },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled,
      type: { case: "web", value: { audience } },
    },
    status: { typeStatus: { case: "web", value: { linkToken: "tok" } } },
  };
}

// A link names the channel by its id alone — never its organization or slug.
const buildChatLinkUrl = (channelId: string) =>
  `https://app.example.com/chat/${channelId}`;

/** The cards in the list, by their frame's accessible name, in DOM order. */
function cardNames(): string[] {
  return screen
    .getAllByRole("group")
    .map((card) => card.getAttribute("aria-label") ?? "");
}

/** The Add channel menu's item for a type, by the label it starts with. */
function addItem(label: string): HTMLElement {
  return screen.getByRole("menuitem", { name: new RegExp(`^${label}`) });
}

describe("ChannelsPanel", () => {
  it("renders the empty state with a connect call to action", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.getByText(/Acme HQ/)).toBeTruthy();
    // Installed channels expose the serving switch, not a connect button.
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("lists every channel of the agent in one list — chat links beside Slack and WhatsApp, in listByAgent order", async () => {
    const client = createMockStigmer({
      channels: [
        makeChannel({ teamName: "Acme HQ" }),
        makeChatLink(),
        makeWhatsAppChannel(),
      ],
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} buildChatLinkUrl={buildChatLinkUrl} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("3 channels")).toBeTruthy());
    // One frame per channel, every type, in the order the server answered.
    expect(cardNames()).toEqual([
      "Slack: Support Slack",
      "Chat link: Website chat",
      "WhatsApp: Support WhatsApp",
    ]);
    // The chat link's card shows its link and audience; the vendor cards
    // their install state, beside it.
    const chatCard = screen.getByRole("group", { name: "Chat link: Website chat" });
    expect(within(chatCard).getByText("/chat/ash_1")).toBeTruthy();
    expect(within(chatCard).getByText("Anyone with the link")).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Slack: Support Slack" })).getByText("Installed"),
    ).toBeTruthy();
  });

  it("counts a single channel in the singular", async () => {
    const client = createMockStigmer({ channels: [makeChatLink()] });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    expect(await screen.findByText("1 channel")).toBeTruthy();
  });

  it("scopes the list to the agent's own organization — a channel lives where its agent lives", async () => {
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [makeChatLink()], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await screen.findByText("1 channel");
    expect(listByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "acme" }),
    );
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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Pending")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByText(/removed from Old WS/)).toBeTruthy();
  });

  it("toggles serving by naming spec.enabled alone (config-preserving pause)", async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
      update,
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByRole("switch")).toBeTruthy());
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(update).toHaveBeenCalled());
    // The toggle names `spec.enabled` alone: the agent reference and the
    // provider marker keep their stored values without being sent back.
    const sent = sentUpdate<Channel>(update);
    expect(sent.paths).toEqual(["spec.enabled"]);
    expect(sent.resource.spec?.enabled).toBe(false);
  });

  it("says the channel changed since it was opened when the toggle's save meets a newer channel", async () => {
    const update = vi.fn().mockRejectedValue(
      new ConnectError("changed", Code.Aborted, undefined, [
        { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason: "ETAG_MISMATCH", metadata: {} } },
      ]),
    );
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
      update,
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByRole("switch")).toBeTruthy());
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This channel changed since you opened it. Reload it to see the change, then make your edit again.",
      ),
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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    await openMenu(screen.getByRole("button", { name: /actions for/i }));
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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    // Two channels of one workspace are only tellable apart by their
    // serving app — the whole point of BYO. The line also
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

  it("names the serving app by the name members @mention when the organization's app list holds it", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ id: "ach_2", name: "Branded Channel", appRefSlug: "acme-support-app" })],
      channelApps: [
        { metadata: { id: "cha_other", slug: "acme-other-app", name: "Acme Other" } },
        { metadata: { id: "cha_1", slug: "acme-support-app", name: "Acme Support" } },
      ],
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText(/Serving app: Acme Support \(your app\) — members @mention Acme Support/)).toBeTruthy(),
    );
  });

  it("names a serving app deleted since as a deleted channel app, never the platform app", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ id: "ach_3", name: "Orphaned Channel", appRefDeletedId: "cha_gone" })],
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByText(/Serving app: deleted channel app/)).toBeTruthy());
    expect(screen.queryByText(/members @mention Stigmer/)).toBeNull();
  });

  it("opens the connect dialog from the empty state", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
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
        <ChannelsPanel
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
    const client = createMockStigmer({
      channels: [makeChannel({ installState: 1, name: "Pending Slack" })],
    });
    render(
      <Providers client={client} mode="local">
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    // A listed vendor channel this edition cannot connect is what the
    // notice explains.
    await waitFor(() =>
      expect(screen.getByText(/require Stigmer Cloud/i)).toBeTruthy(),
    );
    // No doomed Connect on the card (no external delegate).
    expect(screen.getByText("Pending Slack")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("offers only the chat link on an empty tab in local mode, and names what Slack and WhatsApp need", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client} mode="local">
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    const create = await screen.findByRole("button", { name: /create a chat link/i });
    expect(create.getAttribute("data-cursor-target")).toBe("add-chat-link");
    expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /connect to whatsapp/i })).toBeNull();
    expect(screen.getByText("Slack and WhatsApp need Stigmer Cloud.")).toBeTruthy();
    // An empty tab lists no vendor channel, so no banner explains one.
    expect(screen.queryByText(/require Stigmer Cloud/i)).toBeNull();
  });

  it("treats enterprise like local: the chat link only, Slack and WhatsApp named as needing Stigmer Cloud", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client} mode="enterprise">
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    expect(await screen.findByRole("button", { name: /create a chat link/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /connect to whatsapp/i })).toBeNull();
    expect(screen.getByText("Slack and WhatsApp need Stigmer Cloud.")).toBeTruthy();
  });

  it("shows no cloud notice on a tab of chat links in local mode", async () => {
    const client = createMockStigmer({ channels: [makeChatLink()] });
    render(
      <Providers client={client} mode="local">
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await screen.findByText("1 channel");
    expect(screen.queryByText(/require Stigmer Cloud/i)).toBeNull();
  });

  it("keeps CRUD available in local mode: the serving switch still renders", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client} mode="local">
        <ChannelsPanel agent={makeAgent()} />
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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());

    // The panel renders mutation affordances optimistic-visible and hides
    // them when the denial lands. "Mock was called" precedes "denial
    // rendered", so wait for the state this test is actually about instead
    // of racing the re-render (flaked under CPU contention, ~1/20).
    await waitFor(() => expect(screen.queryByRole("switch")).toBeNull());
    expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull();

    // The card menu still renders: Sessions is a viewer-level action
    // (everyone who sees the card holds can_view on the channel — the same
    // bar as viewing its sessions). Mutation items stay
    // permission-gated and absent.
    await openMenu(screen.getByRole("button", { name: /actions for/i }));
    // The awaited query anchors on the portaled menu's mount (#323) — only
    // then are the absence assertions below meaningful rather than vacuous.
    expect(await screen.findByRole("menuitem", { name: /sessions/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /tool credentials/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /disconnect/i })).toBeNull();
  });

  it("offers Manage access from the card menu — the channel's canonical access home", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    // The dialog's People section lists existing grants on open.
    (
      client as { grant: Record<string, unknown> }
    ).grant.listResourceAccessByPrincipal = vi
      .fn()
      .mockResolvedValue({ entries: [], nextPageToken: "" });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());

    await openMenu(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /manage access/i }));

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
        <ChannelsPanel agent={makeAgent({ withTools: true })} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    // The card is where an owner discovers the gap — including one who
    // connected before credential binding existed.
    expect(
      await screen.findByText(/this channel names no vault/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /bind credentials/i })).toBeTruthy();
  });

  it("stays silent on cards for agents without tools", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    expect(
      screen.queryByText(/this channel names no vault/i),
    ).toBeNull();
  });

  it("opens the credentials dialog from the card's action menu", async () => {
    const client = createMockStigmer({
      channels: [makeChannel({ teamName: "Acme HQ" })],
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    await openMenu(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Tool credentials" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Tool credentials" }),
    ).toBeTruthy();
  });

  it("offers connect to the agent's owner on open source, where the self-check answers can_grant_access false everywhere but organizations (stigmer#1495)", async () => {
    const checkMyPermission = vi.fn((input: unknown) => {
      const { relation } = input as { relation: string };
      return Promise.resolve({ isAuthorized: relation !== "can_grant_access" });
    });
    const client = createMockStigmer({ checkMyPermission });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(checkMyPermission).toHaveBeenCalledWith(
        expect.objectContaining({ relation: "can_manage_audience" }),
      ),
    );
    expect(await screen.findByRole("button", { name: /connect to slack/i })).toBeTruthy();
  });

  it("offers no connect affordance to a member who owns the agent: connecting also asks can_create_channel on the organization", async () => {
    // A member owns the agents they create (can_manage_audience), but a
    // channel spends the organization's own provider keys, an admin's act.
    const checkMyPermission = vi.fn((input: unknown) => {
      const { relation } = input as { relation: string };
      return Promise.resolve({ isAuthorized: relation !== "can_create_channel" });
    });
    const client = createMockStigmer({ checkMyPermission });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("No channels yet")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(checkMyPermission).toHaveBeenCalledWith(
        expect.objectContaining({ relation: "can_create_channel" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /connect to whatsapp/i })).toBeNull();
  });

  it("offers no connect affordance to an editor of the agent — connecting asks can_manage_audience, the owner's", async () => {
    // An editor holds can_edit on the agent but not can_manage_audience: a
    // channel puts the agent in front of a wider audience, which is the
    // owner's decision, and the server's create bar says the same.
    const checkMyPermission = vi.fn((input: unknown) => {
      const { relation } = input as { relation: string };
      return Promise.resolve({ isAuthorized: relation !== "can_manage_audience" });
    });
    const client = createMockStigmer({ checkMyPermission });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("No channels yet")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(checkMyPermission).toHaveBeenCalledWith(
        expect.objectContaining({ relation: "can_manage_audience" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /connect to whatsapp/i })).toBeNull();
  });

  it("offers one visible connect button per provider, each with its cursor target", async () => {
    const client = createMockStigmer();
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
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
        <ChannelsPanel agent={makeAgent()} />
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
        <ChannelsPanel agent={makeAgent()} />
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
        <ChannelsPanel
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
        <ChannelsPanel agent={makeAgent()} onConnectExternal={vi.fn()} />
      </Providers>,
    );

    // Slack can still hand off to the host's browser; WhatsApp installs
    // are in-app-only and doomed on a local backend, so its button yields
    // to a note naming what it needs.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /connect to slack/i }),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /create a chat link/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /connect to whatsapp/i }),
    ).toBeNull();
    expect(screen.getByText("WhatsApp needs Stigmer Cloud.")).toBeTruthy();
  });

  it("scopes the disconnect prompt to the channel's provider", async () => {
    const client = createMockStigmer({
      channels: [makeWhatsAppChannel()],
    });
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Support WhatsApp")).toBeTruthy(),
    );
    await openMenu(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));

    // WhatsApp credentials live on the shared ChannelApp and survive the
    // channel — the prompt must not claim they are removed.
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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Support WhatsApp")).toBeTruthy(),
    );
    await openMenu(screen.getByRole("button", { name: /actions for/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Templates" }));

    expect(
      await screen.findByRole("heading", { name: "Templates" }),
    ).toBeTruthy();
    // This channel has no proactive grant — the dialog teaches instead
    // of firing a doomed listTemplates call.
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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByText("Support Slack")).toBeTruthy());
    await openMenu(screen.getByRole("button", { name: /actions for/i }));

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
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Support WhatsApp")).toBeTruthy(),
    );
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());
    await openMenu(screen.getByRole("button", { name: /actions for/i }));

    expect(
      await screen.findByRole("menuitem", { name: /sessions/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Templates" })).toBeNull();
  });

  it("renders an error state when the list fails to load", async () => {
    const client = {
      channel: {
        listByAgent: vi.fn().mockRejectedValue(new Error("boom")),
      },
      channelapp: {
        list: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
      },
      grant: {
        checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: true }),
      },
    } as never;
    render(
      <Providers client={client}>
        <ChannelsPanel agent={makeAgent()} />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText(/failed to load channels/i)).toBeTruthy(),
    );
  });

  describe("adding a channel", () => {
    it("offers one visible button per type on an empty tab in cloud, with no unavailable note", async () => {
      const client = createMockStigmer();
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      const create = await screen.findByRole("button", { name: /create a chat link/i });
      expect(create.getAttribute("data-cursor-target")).toBe("add-chat-link");
      expect(
        screen.getByRole("button", { name: /connect to slack/i }).getAttribute("data-cursor-target"),
      ).toBe("connect-slack");
      expect(
        screen
          .getByRole("button", { name: /connect to whatsapp/i })
          .getAttribute("data-cursor-target"),
      ).toBe("connect-whatsapp");
      expect(screen.queryByText(/need(s)? Stigmer Cloud/)).toBeNull();
      // The empty tab chooses with buttons, never the menu.
      expect(screen.queryByRole("button", { name: /add channel/i })).toBeNull();
    });

    it("offers every type from one Add channel menu once channels are listed (cloud)", async () => {
      const client = createMockStigmer({ channels: [makeChatLink()] });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      const trigger = await screen.findByRole("button", { name: /add channel/i });
      expect(trigger.getAttribute("data-cursor-target")).toBe("add-channel");
      // The listed tab offers no per-type buttons beside the menu.
      expect(screen.queryByRole("button", { name: /create a chat link/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /connect to slack/i })).toBeNull();

      await openMenu(trigger);
      const items = screen.getAllByRole("menuitem");
      expect(items.map((i) => i.getAttribute("data-cursor-target"))).toEqual([
        "add-chat-link",
        "connect-slack",
        "connect-whatsapp",
      ]);
      for (const item of items) {
        expect(item.getAttribute("aria-disabled")).not.toBe("true");
      }
      expect(screen.queryByText("Needs Stigmer Cloud")).toBeNull();
    });

    it("disables Slack and WhatsApp in the Add menu in local mode, each saying it needs Stigmer Cloud", async () => {
      const client = createMockStigmer({ channels: [makeChatLink()] });
      render(
        <Providers client={client} mode="local">
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await openMenu(await screen.findByRole("button", { name: /add channel/i }));
      expect(addItem("Chat link").getAttribute("aria-disabled")).not.toBe("true");
      for (const label of ["Slack", "WhatsApp"]) {
        const item = addItem(label);
        expect(item.getAttribute("aria-disabled")).toBe("true");
        expect(within(item).getByText("Needs Stigmer Cloud")).toBeTruthy();
      }
    });

    it("keeps Slack in the Add menu in local mode when the host hands it off, and WhatsApp disabled", async () => {
      const client = createMockStigmer({ channels: [makeChatLink()] });
      render(
        <Providers client={client} mode="local">
          <ChannelsPanel agent={makeAgent()} onConnectExternal={vi.fn()} />
        </Providers>,
      );

      await openMenu(await screen.findByRole("button", { name: /add channel/i }));
      expect(addItem("Chat link").getAttribute("aria-disabled")).not.toBe("true");
      expect(addItem("Slack").getAttribute("aria-disabled")).not.toBe("true");
      const whatsapp = addItem("WhatsApp");
      expect(whatsapp.getAttribute("aria-disabled")).toBe("true");
      expect(within(whatsapp).getByText("Needs Stigmer Cloud")).toBeTruthy();
    });

    it("treats enterprise like local in the Add menu", async () => {
      const client = createMockStigmer({ channels: [makeChatLink()] });
      render(
        <Providers client={client} mode="enterprise">
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await openMenu(await screen.findByRole("button", { name: /add channel/i }));
      expect(addItem("Chat link").getAttribute("aria-disabled")).not.toBe("true");
      expect(addItem("Slack").getAttribute("aria-disabled")).toBe("true");
      expect(addItem("WhatsApp").getAttribute("aria-disabled")).toBe("true");
    });

    it("offers no add affordance at all to a viewer who fails the create bar", async () => {
      const checkMyPermission = vi.fn((input: unknown) => {
        const { relation } = input as { relation: string };
        return Promise.resolve({ isAuthorized: relation !== "can_create_channel" });
      });
      const client = createMockStigmer({ channels: [makeChatLink()], checkMyPermission });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await screen.findByText("1 channel");
      await waitFor(() =>
        expect(checkMyPermission).toHaveBeenCalledWith(
          expect.objectContaining({ relation: "can_create_channel" }),
        ),
      );
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /add channel/i })).toBeNull(),
      );
    });

    it("names no unavailable type on an empty tab the viewer cannot add to", async () => {
      const checkMyPermission = vi.fn((input: unknown) => {
        const { relation } = input as { relation: string };
        return Promise.resolve({ isAuthorized: relation !== "can_create_channel" });
      });
      const client = createMockStigmer({ checkMyPermission });
      render(
        <Providers client={client} mode="local">
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await screen.findByText("No channels yet");
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /create a chat link/i })).toBeNull(),
      );
      // A viewer with nothing to add reads no reasons about what they cannot.
      expect(screen.queryByText(/need(s)? Stigmer Cloud/)).toBeNull();
      expect(screen.queryByText(/organization admin/)).toBeNull();
    });

    it("opens the chat-link dialog in create mode from the Add menu's Chat link", async () => {
      const client = createMockStigmer({ channels: [makeChannel({ teamName: "Acme HQ" })] });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await openMenu(await screen.findByRole("button", { name: /add channel/i }));
      fireEvent.click(addItem("Chat link"));

      expect(await screen.findByRole("heading", { name: "Create a chat link" })).toBeTruthy();
      expect(screen.getByLabelText("Name", { selector: "input" })).toBeTruthy();
    });

    it("opens the chat-link dialog in create mode from the empty state", async () => {
      const client = createMockStigmer();
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /create a chat link/i }));

      expect(await screen.findByRole("heading", { name: "Create a chat link" })).toBeTruthy();
    });

    it("closes the chat-link dialog without creating anything", async () => {
      const client = createMockStigmer();
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /create a chat link/i }));
      await screen.findByRole("heading", { name: "Create a chat link" });
      fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));

      await waitFor(() => expect(screen.queryByRole("heading", { name: "Create a chat link", hidden: true })).toBeNull());
      expect(screen.getByText("No channels yet")).toBeTruthy();
    });

    it("opens the WhatsApp connect dialog from the Add menu", async () => {
      const client = createMockStigmer({ channels: [makeChatLink()] });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await openMenu(await screen.findByRole("button", { name: /add channel/i }));
      fireEvent.click(addItem("WhatsApp"));
      expect(await screen.findByRole("heading", { name: "Connect to WhatsApp" })).toBeTruthy();
    });

    it("opens the Slack connect dialog from the Add menu when the host gives no delegate", async () => {
      const client = createMockStigmer({ channels: [makeChatLink()] });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await openMenu(await screen.findByRole("button", { name: /add channel/i }));
      fireEvent.click(addItem("Slack"));
      expect(await screen.findByRole("heading", { name: "Connect to Slack" })).toBeTruthy();
    });

    it("hands a new Slack connection from the Add menu to the host's delegate, with no channel yet", async () => {
      const onConnectExternal = vi.fn();
      const client = createMockStigmer({ channels: [makeChatLink()] });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} onConnectExternal={onConnectExternal} />
        </Providers>,
      );

      await openMenu(await screen.findByRole("button", { name: /add channel/i }));
      fireEvent.click(addItem("Slack"));

      expect(onConnectExternal).toHaveBeenCalledWith(null);
      expect(screen.queryByRole("heading", { name: "Connect to Slack" })).toBeNull();
    });
  });

  describe("a chat link in the list", () => {
    it("opens the chat-link dialog on the EXACT chat link whose card's Edit was chosen", async () => {
      const client = createMockStigmer({
        channels: [
          makeChatLink(),
          makeChatLink({ id: "ash_2", name: "Help Desk" }),
        ],
      });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} buildChatLinkUrl={buildChatLinkUrl} />
        </Providers>,
      );

      const card = await screen.findByRole("group", { name: "Chat link: Help Desk" });
      await openMenu(within(card).getByRole("button", { name: /^Actions for/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      // The editor shows the chosen link's URL — not the first card's.
      expect(
        (await screen.findAllByText(/https:\/\/app\.example\.com\/chat\/ash_2/)).length,
      ).toBeGreaterThan(0);
      expect(screen.queryAllByText(/https:\/\/app\.example\.com\/chat\/ash_1/)).toEqual([]);
    });

    it("confirms Delete chat link? before deleting, then deletes and refetches", async () => {
      const del = vi.fn().mockResolvedValue({});
      const listByAgent = vi
        .fn()
        .mockResolvedValue({ entries: [makeChatLink()], nextPageToken: "" });
      const client = createMockStigmer({ listByAgent, delete: del });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await screen.findByText("1 channel");
      await openMenu(screen.getByRole("button", { name: /^Actions for/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

      // The confirmation names the link that stops working (by the
      // channel's id, the one identity a link carries) and the
      // config-preserving alternative (turning it off).
      expect(del).not.toHaveBeenCalled();
      const title = await screen.findByText("Delete chat link?");
      expect(screen.getByText(/The link \/chat\/ash_1 stops working/)).toBeTruthy();
      expect(screen.getByText(/turn it off instead/i)).toBeTruthy();
      expect(screen.queryByText("Disconnect channel?")).toBeNull();

      const confirmDialog = title.closest("dialog") as HTMLElement;
      fireEvent.click(
        within(confirmDialog).getByRole("button", { name: "Delete", hidden: true }),
      );

      await waitFor(() => expect(del).toHaveBeenCalledWith("ash_1"));
      await waitFor(() => expect(listByAgent).toHaveBeenCalledTimes(2));
      expect(toast.success).toHaveBeenCalledWith("Chat link deleted");
    });

    it("does nothing when the chat link's delete is cancelled", async () => {
      const del = vi.fn();
      const client = createMockStigmer({ channels: [makeChatLink()], delete: del });
      render(
        <Providers client={client}>
          <ChannelsPanel agent={makeAgent()} />
        </Providers>,
      );

      await screen.findByText("1 channel");
      await openMenu(screen.getByRole("button", { name: /^Actions for/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(await screen.findByText("Delete chat link?")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Cancel", hidden: true }));
      expect(del).not.toHaveBeenCalled();
    });
  });
});
