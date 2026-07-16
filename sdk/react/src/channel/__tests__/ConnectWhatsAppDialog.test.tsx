import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError, type AgentChannelInput } from "@stigmer/sdk";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { ConnectWhatsAppDialog } from "../ConnectWhatsAppDialog";

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

interface MockOverrides {
  create?: (input: AgentChannelInput) => Promise<unknown>;
  apply?: (input: AgentChannelInput) => Promise<unknown>;
  initiateInstall?: (input: unknown) => Promise<unknown>;
  get?: (id: string) => Promise<unknown>;
  /** Org channel apps returned by channelapp.listByOrg (serving picker). */
  channelApps?: unknown[];
  /** Org-wide channels returned by agentChannel.list (advisory). */
  orgChannels?: unknown[];
}

/** A registered Meta app as channelapp.listByOrg returns it. */
function makeWhatsAppApp(slug = "acme-meta-app", name = "Acme Meta App") {
  return {
    metadata: { id: `chapp_${slug}`, org: "acme", slug, name },
    spec: { providerConfig: { case: "whatsapp", value: {} } },
  };
}

/** The channel as agentChannel.get returns it after a completed install. */
function installedChannel() {
  return {
    metadata: { id: "ach_new", org: "acme", slug: "support-agent-whatsapp" },
    status: {
      installState: 2,
      providerStatus: {
        case: "whatsapp",
        value: {
          phoneNumberId: "106540352242922",
          displayPhoneNumber: "+1 555 025 3483",
          verifiedName: "Acme Corp",
        },
      },
    },
  };
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    channelapp: {
      listByOrg: vi.fn().mockResolvedValue({
        entries: overrides.channelApps ?? [makeWhatsAppApp()],
      }),
    },
    agentChannel: {
      list: vi.fn().mockResolvedValue({
        items: overrides.orgChannels ?? [],
      }),
      create:
        overrides.create ??
        vi.fn().mockResolvedValue({
          metadata: { id: "ach_new", org: "acme", slug: "support-agent-whatsapp" },
        }),
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
      initiateInstall:
        overrides.initiateInstall ??
        vi.fn().mockResolvedValue({ completed: true }),
      get: overrides.get ?? vi.fn().mockResolvedValue(installedChannel()),
    },
    environment: {
      list: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      getByReference: vi.fn().mockRejectedValue(new Error("not found")),
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

/** A pending channel as the retry mode receives it. */
function pendingChannel(overrides: { phoneNumberId?: string; appSlug?: string } = {}) {
  return {
    metadata: { id: "ach_1", org: "acme", slug: "support-whatsapp", name: "Support WhatsApp" },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      providerConfig: {
        case: "whatsapp",
        value: { phoneNumberId: overrides.phoneNumberId ?? "106540352242922" },
      },
      appRef: { org: "acme", slug: overrides.appSlug ?? "acme-meta-app" },
    },
    status: { installState: 1 },
  } as never;
}

describe("ConnectWhatsAppDialog", () => {
  it("prefills a derived channel name, requires the number, and states who pays", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(screen.getByDisplayValue("Support Agent WhatsApp")).toBeTruthy();
    expect(screen.getByText(/billed to/i)).toBeTruthy();
    expect(screen.getByText(/each number serves one agent/i)).toBeTruthy();

    // The declared number is required client-side: the write path defers
    // it to the install probe, where an empty value can only fail.
    const connect = await screen.findByRole("button", {
      name: /connect to whatsapp/i,
    });
    expect((connect as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "106540352242922" },
    });
    await waitFor(() =>
      expect((connect as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("blocks on registering a Meta app first when the org has none", async () => {
    render(
      <Providers client={createMockStigmer({ channelApps: [] })}>
        <ConnectWhatsAppDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channelAppsHref="/settings/channel-apps"
        />
      </Providers>,
    );

    // BYO-only (DD-WA-2): no platform fallback exists, so the zero-apps
    // state is a blocking register-first path, not a soft default.
    expect(
      await screen.findByText(/there is no shared platform app/i),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /register a channel app/i });
    expect(link.getAttribute("href")).toBe("/settings/channel-apps");

    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "106540352242922" },
    });
    // Even with a number, no app means no connect.
    expect(
      (screen.getByRole("button", { name: /connect to whatsapp/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("offers only WhatsApp-typed channel apps in the picker, with no platform option", async () => {
    const client = createMockStigmer({
      channelApps: [
        makeWhatsAppApp("acme-meta-app", "Acme Meta App"),
        {
          metadata: { id: "chapp_slack", org: "acme", slug: "acme-slack", name: "Acme Slack" },
          spec: { providerConfig: { case: "slack", value: {} } },
        },
      ],
    });

    render(
      <Providers client={client}>
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(
      await screen.findByRole("radio", { name: /acme meta app/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /acme slack/i })).toBeNull();
    // WhatsApp has no platform app — no "Stigmer app" option to fall
    // back to (the Slack picker's default).
    expect(screen.queryByRole("radio", { name: /stigmer app/i })).toBeNull();
  });

  it("preselects a sole registered app — a required picker with one answer never blocks", async () => {
    render(
      <Providers client={createMockStigmer()}>
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    const option = await screen.findByRole("radio", { name: /acme meta app/i });
    expect((option as HTMLInputElement).checked).toBe(true);
  });

  it("creates the channel, installs directly, and reports the verified number", async () => {
    const create = vi.fn().mockResolvedValue({
      metadata: { id: "ach_new", org: "acme" },
    });
    const initiateInstall = vi.fn().mockResolvedValue({ completed: true });
    const onChannelsChanged = vi.fn();
    const client = createMockStigmer({ create, initiateInstall });

    render(
      <Providers client={client}>
        <ConnectWhatsAppDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          onChannelsChanged={onChannelsChanged}
        />
      </Providers>,
    );

    await screen.findByRole("radio", { name: /acme meta app/i });
    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "  106540352242922  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /connect to whatsapp/i }),
    );

    // Create carries the trimmed number, the required app binding, and
    // the agent-derived defaults.
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Support Agent WhatsApp",
        org: "acme",
        agentRef: { org: "acme", slug: "support-agent" },
        enabled: true,
        whatsapp: { phoneNumberId: "106540352242922" },
        appRef: { org: "acme", slug: "acme-meta-app" },
      }),
    );

    await waitFor(() =>
      expect(initiateInstall).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: "ach_new" }),
      ),
    );

    // The success summary reads the observed install facts (fetched —
    // initiateInstall itself answers no channel).
    expect(
      await screen.findByText(/connected to \+1 555 025 3483/i),
    ).toBeTruthy();
    expect(screen.getByText(/answers come from/i)).toBeTruthy();
    expect(screen.getByText("Support Agent")).toBeTruthy();
    // Once for the created row, once for the completed install.
    expect(onChannelsChanged).toHaveBeenCalledTimes(2);
  });

  it("retries a pending channel without re-creating it, saving only when edits were made", async () => {
    const create = vi.fn();
    const apply = vi.fn().mockResolvedValue(pendingChannel());
    const initiateInstall = vi.fn().mockResolvedValue({ completed: true });
    const client = createMockStigmer({ create, apply, initiateInstall });

    render(
      <Providers client={client}>
        <ConnectWhatsAppDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channel={pendingChannel()}
        />
      </Providers>,
    );

    // Retry mode: the declared number is prefilled and editable — a
    // failed direct install usually means it (or the app) is wrong.
    expect(
      await screen.findByRole("heading", { name: "Reconnect to WhatsApp" }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("106540352242922")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /reconnect to whatsapp/i }),
    );

    await waitFor(() =>
      expect(initiateInstall).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: "ach_1" }),
      ),
    );
    // Nothing changed → a plain retry is one call, not a save + install.
    expect(apply).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("persists an edited number before re-installing", async () => {
    const apply = vi.fn().mockResolvedValue(
      pendingChannel({ phoneNumberId: "222" }),
    );
    const initiateInstall = vi.fn().mockResolvedValue({ completed: true });
    const client = createMockStigmer({ apply, initiateInstall });

    render(
      <Providers client={client}>
        <ConnectWhatsAppDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channel={pendingChannel()}
        />
      </Providers>,
    );

    const numberInput = await screen.findByDisplayValue("106540352242922");
    fireEvent.change(numberInput, { target: { value: "222" } });
    fireEvent.click(
      screen.getByRole("button", { name: /reconnect to whatsapp/i }),
    );

    // The edit rides a full-input apply (agentChannelToInput) so the
    // save can never wipe the agent ref, app binding, or credentials.
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({
          whatsapp: { phoneNumberId: "222" },
          appRef: { org: "acme", slug: "acme-meta-app" },
          agentRef: { org: "acme", slug: "support-agent" },
        }),
      ),
    );
    await waitFor(() => expect(initiateInstall).toHaveBeenCalled());
  });

  it("renders a guided refusal for the duplicate-number reason", async () => {
    const connectError = new ConnectError(
      "This WhatsApp number is already connected to a Stigmer agent through this channel app.",
      Code.FailedPrecondition,
      undefined,
      [
        {
          desc: ErrorInfoSchema,
          value: {
            domain: "stigmer.ai",
            reason: "WHATSAPP_NUMBER_ALREADY_CONNECTED",
            metadata: {
              display_phone_number: "+1 555 025 3483",
              channel_app_id: "chapp_1",
            },
          },
        },
      ],
    );
    const initiateInstall = vi.fn().mockRejectedValue(
      new StigmerError(
        "failed-precondition",
        connectError.rawMessage,
        Code.FailedPrecondition,
        { cause: connectError },
      ),
    );

    render(
      <Providers client={createMockStigmer({ initiateInstall })}>
        <ConnectWhatsAppDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          channelAppsHref="/settings/channel-apps"
        />
      </Providers>,
    );

    await screen.findByRole("radio", { name: /acme meta app/i });
    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "106540352242922" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /connect to whatsapp/i }),
    );

    // Guided treatment: names the occupied number from the ErrorInfo
    // metadata and offers the ways out.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("+1 555 025 3483");
    expect(alert.textContent).toContain("each number serves one agent");
    const link = alert.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/settings/channel-apps");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("renders other refusals verbatim — the server owns that vocabulary", async () => {
    const initiateInstall = vi.fn().mockRejectedValue(
      new StigmerError(
        "failed-precondition",
        "WhatsApp rejected the channel app's access token.",
        9,
      ),
    );

    render(
      <Providers client={createMockStigmer({ initiateInstall })}>
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    await screen.findByRole("radio", { name: /acme meta app/i });
    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "106540352242922" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /connect to whatsapp/i }),
    );

    expect(
      await screen.findByText(/rejected the channel app's access token/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("warns before installing when the selected app already serves the number", async () => {
    const orgChannels = [
      {
        metadata: { id: "ach_other" },
        spec: { agentRef: { org: "acme", slug: "other-agent" } },
        status: {
          installState: 2, // installed
          providerStatus: {
            case: "whatsapp",
            // The same key the DB uniqueness index uses:
            // (phone number, channel app).
            value: {
              phoneNumberId: "106540352242922",
              displayPhoneNumber: "+1 555 025 3483",
              channelAppId: "chapp_acme-meta-app",
            },
          },
        },
      },
    ];

    render(
      <Providers client={createMockStigmer({ orgChannels })}>
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    await screen.findByRole("radio", { name: /acme meta app/i });
    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "106540352242922" },
    });

    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("+1 555 025 3483");
    expect(note.textContent).toContain("other-agent");

    // A different number clears the advisory.
    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "999" },
    });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("preempts the flow with the cloud notice in local mode", () => {
    render(
      <Providers client={createMockStigmer()} mode="local">
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(screen.getByText(/require Stigmer Cloud/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /connect to whatsapp/i }),
    ).toBeNull();
  });

  it("resets flow state when reopened (body remounts per session)", async () => {
    const initiateInstall = vi
      .fn()
      .mockRejectedValue(new StigmerError("unavailable", "meta is down", 14));
    const client = createMockStigmer({ initiateInstall });

    const { rerender } = render(
      <Providers client={client}>
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    await screen.findByRole("radio", { name: /acme meta app/i });
    fireEvent.change(screen.getByLabelText(/phone number id/i), {
      target: { value: "106540352242922" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /connect to whatsapp/i }),
    );
    expect(await screen.findByText(/meta is down/i)).toBeTruthy();

    rerender(
      <Providers client={client}>
        <ConnectWhatsAppDialog open={false} onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );
    rerender(
      <Providers client={client}>
        <ConnectWhatsAppDialog open onOpenChange={() => {}} agent={makeAgent()} />
      </Providers>,
    );

    expect(screen.queryByText(/meta is down/i)).toBeNull();
  });
});
