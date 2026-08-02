import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ChannelTemplatesDialog } from "../ChannelTemplatesDialog";

function makeChannel(overrides?: {
  installState?: AgentChannelInstallState;
  enabled?: boolean;
  proactiveMessagingEnabled?: boolean;
}): AgentChannel {
  return {
    metadata: { id: "ach_1", org: "acme", slug: "wa-main", name: "WA Main" },
    spec: {
      enabled: overrides?.enabled ?? true,
      proactiveMessagingEnabled: overrides?.proactiveMessagingEnabled ?? true,
      providerConfig: { case: "whatsapp", value: { phoneNumberId: "106" } },
    },
    status: {
      installState:
        overrides?.installState ?? AgentChannelInstallState.installed,
      providerStatus: { case: undefined },
    },
  } as unknown as AgentChannel;
}

function makeTemplate(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "fee_reminder",
    language: "en_US",
    category: "UTILITY",
    status: "APPROVED",
    parameterFormat: "POSITIONAL",
    parameterNames: ["1", "2"],
    bodyText: "Hi {{1}}, your fee of {{2}} is due.",
    headerFormat: "",
    rejectionReason: "",
    unsupportedReason: "",
    ...overrides,
  };
}

function renderDialog(
  listTemplates: (input: unknown) => Promise<unknown>,
  props?: {
    channel?: AgentChannel;
    onEditYaml?: () => void;
    mode?: "cloud" | "local";
  },
) {
  const client = { agentChannel: { listTemplates } } as never;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>
          <DeploymentModeContext.Provider value={props?.mode ?? "cloud"}>
            {children}
          </DeploymentModeContext.Provider>
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(
    <ChannelTemplatesDialog
      open
      onOpenChange={vi.fn()}
      channel={props?.channel ?? makeChannel()}
      onEditYaml={props?.onEditYaml}
      modal={false}
    />,
    { wrapper: Wrapper },
  );
}

describe("ChannelTemplatesDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Readiness teaching states — no network call fires for any of them
  // -------------------------------------------------------------------------

  it("renders the cloud notice on a local deployment without fetching", () => {
    const listTemplates = vi.fn();
    renderDialog(listTemplates, { mode: "local" });

    expect(
      screen.getByText(/template registry can only be read on a cloud/),
    ).toBeDefined();
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("teaches connecting first for a pending install, with the provider's own sentence", () => {
    const listTemplates = vi.fn();
    renderDialog(listTemplates, {
      channel: makeChannel({
        installState: AgentChannelInstallState.pending_install,
      }),
    });

    expect(screen.getByText("Connect this channel first")).toBeDefined();
    // The card's describeChannel copy, reused verbatim.
    expect(
      screen.getByText(/WhatsApp connection hasn't been completed/),
    ).toBeDefined();
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("teaches the serving switch when the channel is off", () => {
    const listTemplates = vi.fn();
    renderDialog(listTemplates, {
      channel: makeChannel({ enabled: false }),
    });

    expect(screen.getByText("This channel is turned off")).toBeDefined();
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("teaches the proactive grant by its field name and routes to the YAML editor", () => {
    const listTemplates = vi.fn();
    const onEditYaml = vi.fn();
    renderDialog(listTemplates, {
      channel: makeChannel({ proactiveMessagingEnabled: false }),
      onEditYaml,
    });

    expect(
      screen.getByText("Business-initiated messaging is not enabled"),
    ).toBeDefined();
    // The description names the exact spec field — the only fix today.
    expect(
      screen.getByText(/proactive_messaging_enabled/),
    ).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit channel YAML" }),
    );
    expect(onEditYaml).toHaveBeenCalledTimes(1);
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("omits the YAML affordance when the host wires none", () => {
    renderDialog(vi.fn(), {
      channel: makeChannel({ proactiveMessagingEnabled: false }),
    });

    expect(
      screen.queryByRole("button", { name: "Edit channel YAML" }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // The fetched states
  // -------------------------------------------------------------------------

  it("fetches by the channel's own slug and org", async () => {
    const listTemplates = vi.fn().mockResolvedValue({ entries: [] });
    renderDialog(listTemplates);

    await waitFor(() =>
      expect(listTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "wa-main", org: "acme" }),
      ),
    );
  });

  it("relays a server refusal verbatim", async () => {
    const listTemplates = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "the channel provider's template registry is temporarily unreachable — try again shortly",
        ),
      );
    renderDialog(listTemplates);

    await waitFor(() =>
      expect(
        screen.getByText(/template registry is temporarily unreachable/),
      ).toBeDefined(),
    );
  });

  it('says "found" (never "you have none") when the registry answers empty, and links WhatsApp Manager', async () => {
    const listTemplates = vi.fn().mockResolvedValue({ entries: [] });
    renderDialog(listTemplates);

    await waitFor(() =>
      expect(
        screen.getByText("No templates found for this channel"),
      ).toBeDefined(),
    );

    const link = screen.getByRole("link", { name: /Open WhatsApp Manager/ });
    expect(link.getAttribute("href")).toBe(
      "https://business.facebook.com/wa/manage/message-templates/",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders the count header, identity, facts, and the verbatim status badge", async () => {
    const listTemplates = vi.fn().mockResolvedValue({
      entries: [
        makeTemplate(),
        makeTemplate({
          name: "appeal_pending",
          status: "IN_APPEAL",
          category: "MARKETING",
          headerFormat: "IMAGE",
          bodyText: "Season offer!",
        }),
      ],
    });
    renderDialog(listTemplates);

    await waitFor(() =>
      expect(screen.getByText(/2 templates/)).toBeDefined(),
    );
    // Only the APPROVED one counts as sendable.
    expect(screen.getByText(/1 ready to send/)).toBeDefined();

    expect(screen.getByText("fee_reminder")).toBeDefined();
    expect(screen.getAllByText("en_US")).toHaveLength(2);
    expect(screen.getByText("UTILITY")).toBeDefined();
    expect(screen.getByText("IMAGE header")).toBeDefined();
    // Provider vocabulary verbatim — even statuses this build predates
    // render as the provider's own word, never re-encoded.
    expect(screen.getByText("APPROVED")).toBeDefined();
    expect(screen.getByText("IN_APPEAL")).toBeDefined();
  });

  it("sets placeholders off from the literal body text", async () => {
    const listTemplates = vi
      .fn()
      .mockResolvedValue({ entries: [makeTemplate()] });
    const { container } = renderDialog(listTemplates);

    await waitFor(() => expect(screen.getByText("fee_reminder")).toBeDefined());

    const placeholders = [...container.querySelectorAll("code")].map(
      (el) => el.textContent,
    );
    expect(placeholders).toEqual(["{{1}}", "{{2}}"]);
  });

  it("shows Stigmer's unsupported verdict on an approved-but-unsendable template", async () => {
    const listTemplates = vi.fn().mockResolvedValue({
      entries: [
        makeTemplate({
          name: "flow_template",
          unsupportedReason:
            "this template has a FLOW button, which this platform version cannot supply parameters for",
        }),
      ],
    });
    renderDialog(listTemplates);

    await waitFor(() =>
      expect(
        screen.getByText(/Not sendable: this template has a FLOW button/),
      ).toBeDefined(),
    );
    // Approved yet unsendable — the count must not claim it is ready.
    expect(screen.getByText(/0 ready to send/)).toBeDefined();
  });

  it("shows the provider's rejection verdict verbatim", async () => {
    const listTemplates = vi.fn().mockResolvedValue({
      entries: [
        makeTemplate({
          name: "promo_blast",
          status: "REJECTED",
          rejectionReason: "PROMOTIONAL",
        }),
      ],
    });
    renderDialog(listTemplates);

    await waitFor(() =>
      expect(screen.getByText("Rejected: PROMOTIONAL")).toBeDefined(),
    );
  });
});
