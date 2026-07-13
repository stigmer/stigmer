import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { AgentShareInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { ShareAgentDialog } from "../ShareAgentDialog";

// Toasts are visual feedback owned by the feedback module; keep them inert.
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
  getByAgent?: (input: unknown) => Promise<unknown>;
  apply?: (input: AgentShareInput) => Promise<unknown>;
  rotateShareLink?: (input: unknown) => Promise<unknown>;
  getOrCreateBillingAccount?: (orgId: string) => Promise<unknown>;
  environments?: unknown[];
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    agentShare: {
      getByAgent:
        overrides.getByAgent ??
        vi.fn().mockResolvedValue({ totalCount: 0, items: [] }),
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
      rotateShareLink:
        overrides.rotateShareLink ?? vi.fn().mockResolvedValue({}),
    },
    environment: {
      list: vi.fn().mockResolvedValue({
        items: overrides.environments ?? [],
        totalCount: overrides.environments?.length ?? 0,
      }),
      // The readiness hook checks bound refs' visibility; the picker's
      // list above is the source of the fixtures, so resolve from it.
      getByReference: vi
        .fn()
        .mockImplementation(({ slug }: { org: string; slug: string }) => {
          const env = (overrides.environments ?? []).find(
            (e) => (e as { metadata?: { slug?: string } }).metadata?.slug === slug,
          );
          return env
            ? Promise.resolve(env)
            : Promise.reject(new Error("not found"));
        }),
    },
    billing: {
      getOrCreateBillingAccount:
        overrides.getOrCreateBillingAccount ??
        vi.fn().mockResolvedValue(null),
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

function makeAgent(overrides?: { mcpUsages?: boolean }) {
  return {
    metadata: {
      id: "agt_1",
      org: "acme",
      slug: "support-agent",
      name: "Support Agent",
    },
    spec: {
      mcpServerUsages: overrides?.mcpUsages
        ? [{ mcpServerRef: { org: "acme", slug: "github" } }]
        : [],
    },
  } as never;
}

function makeShare(
  spec?: {
    enabled?: boolean;
    audience?: AgentShareAudience;
    allowedOrigins?: string[];
    messages?: {
      rateLimited?: string;
      unavailable?: string;
      conversationEnded?: string;
    };
    environmentRefs?: { org: string; slug: string }[];
  },
  shareLinkToken?: string,
) {
  return {
    metadata: {
      id: "ash_1",
      org: "acme",
      slug: "support-agent",
      name: "Support Agent",
    },
    spec: { agentRef: { org: "acme", slug: "support-agent" }, ...spec },
    ...(shareLinkToken !== undefined ? { status: { shareLinkToken } } : {}),
  };
}

function withShare(share: unknown) {
  return vi.fn().mockResolvedValue({ totalCount: 1, items: [share] });
}

function orgSharedEnv(slug: string, name?: string) {
  return {
    metadata: {
      slug,
      name: name ?? slug,
      visibility: ApiResourceVisibility.visibility_org,
    },
    spec: { description: "" },
  };
}

const buildShareUrl = (org: string, slug: string) =>
  `https://app.example.com/chat/${org}/${slug}`;

/** Render the open dialog and wait for the share load to settle. */
async function renderOpenDialog(
  client: unknown,
  props?: Partial<Parameters<typeof ShareAgentDialog>[0]> & { mode?: "cloud" | "local" },
) {
  const { mode, ...dialogProps } = props ?? {};
  render(
    <Providers client={client} mode={mode}>
      <ShareAgentDialog
        open
        onOpenChange={() => {}}
        agent={makeAgent()}
        buildShareUrl={buildShareUrl}
        {...dialogProps}
      />
    </Providers>,
  );
  await waitFor(() =>
    expect(screen.queryByLabelText("Loading sharing settings")).toBeNull(),
  );
}

describe("ShareAgentDialog", () => {
  it("mounts no body while closed (share and billing fetches stay lazy)", () => {
    const getByAgent = vi.fn();
    const getOrCreateBillingAccount = vi.fn();
    render(
      <Providers
        client={createMockStigmer({ getByAgent, getOrCreateBillingAccount })}
      >
        <ShareAgentDialog
          open={false}
          onOpenChange={() => {}}
          agent={makeAgent()}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    expect(screen.queryByText("Share")).toBeNull();
    expect(getByAgent).not.toHaveBeenCalled();
    expect(getOrCreateBillingAccount).not.toHaveBeenCalled();
  });

  it("shows a loading state while the share resolves, then the form", async () => {
    let resolveLoad: (v: unknown) => void = () => {};
    const getByAgent = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    render(
      <Providers client={createMockStigmer({ getByAgent })}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    expect(screen.getByLabelText("Loading sharing settings")).toBeTruthy();
    resolveLoad({ totalCount: 1, items: [makeShare({ enabled: true })] });
    await waitFor(() =>
      expect(
        screen.getByText("https://app.example.com/chat/acme/support-agent"),
      ).toBeTruthy(),
    );
  });

  it("offers retry when the share load fails", async () => {
    const share = makeShare({ enabled: true });
    const getByAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce({ totalCount: 1, items: [share] });
    render(
      <Providers client={createMockStigmer({ getByAgent })}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent()}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    // A failed load must never render a form that would create a share
    // over an existing one the dialog couldn't see.
    expect(
      await screen.findByText(/couldn't load this agent's sharing settings/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again", hidden: true }));
    await waitFor(() =>
      expect(
        screen.getByText("https://app.example.com/chat/acme/support-agent"),
      ).toBeTruthy(),
    );
  });

  it("renders header, toggle, and the share link from buildShareUrl", async () => {
    const client = createMockStigmer({
      getByAgent: withShare(makeShare({ enabled: true })),
    });
    await renderOpenDialog(client);

    expect(screen.getByText("Share")).toBeTruthy();
    expect(screen.getByText("Support Agent")).toBeTruthy();
    expect(screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText("https://app.example.com/chat/acme/support-agent"),
    ).toBeTruthy();
  });

  it("builds the link from the SHARE's slug when it differs from the agent's", async () => {
    // A manifest-renamed share: the hosted URL lives at the share's slug.
    const renamed = {
      ...makeShare({ enabled: true }),
      metadata: { id: "ash_1", org: "acme", slug: "help-desk", name: "Help Desk" },
    };
    const client = createMockStigmer({ getByAgent: withShare(renamed) });
    await renderOpenDialog(client);

    expect(
      screen.getByText("https://app.example.com/chat/acme/help-desk"),
    ).toBeTruthy();
  });

  it("falls back to the relative /chat path when buildShareUrl is omitted", async () => {
    const client = createMockStigmer({
      getByAgent: withShare(makeShare({ enabled: true })),
    });
    await renderOpenDialog(client, { buildShareUrl: undefined });

    expect(screen.getByText("/chat/acme/support-agent")).toBeTruthy();
  });

  describe("never-shared agent (no share yet)", () => {
    it("renders the off state with disabled copy affordances", async () => {
      const client = createMockStigmer();
      await renderOpenDialog(client);

      expect(
        screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked"),
      ).toBe("false");
      const copy = screen.getByRole("button", {
        name: "Copy",
        hidden: true,
      }) as HTMLButtonElement;
      expect(copy.disabled).toBe(true);
      expect(
        screen.getByText(/sharing is off, so this link doesn't work yet/i),
      ).toBeTruthy();
    });

    it("first enable creates the canonical share via apply", async () => {
      const apply = vi.fn().mockResolvedValue(makeShare({ enabled: true }));
      const client = createMockStigmer({ apply });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("switch", { hidden: true }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      // Create identity: the agent's own org/slug/name (the server's D2
      // default made explicit) plus the agent reference.
      expect(input.org).toBe("acme");
      expect(input.slug).toBe("support-agent");
      expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
      expect(input.enabled).toBe(true);

      await waitFor(() =>
        expect(
          screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked"),
        ).toBe("true"),
      );
    });
  });

  describe("Sharing-off state", () => {
    it("shows the reason on the Embed tab too", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: false })),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      expect(
        screen.getByText(/sharing is off, so this embed doesn't work yet/i),
      ).toBeTruthy();
    });

    it("drops the hint and enables copy once sharing is on", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client);

      const copy = screen.getByRole("button", {
        name: "Copy",
        hidden: true,
      }) as HTMLButtonElement;
      expect(copy.disabled).toBe(false);
      expect(screen.queryByText(/sharing is off/i)).toBeNull();
    });
  });

  it("shows the indexability warning", async () => {
    const client = createMockStigmer({
      getByAgent: withShare(makeShare({ enabled: true })),
    });
    await renderOpenDialog(client);

    expect(
      screen.getByText(/forwarded and indexed by search engines/),
    ).toBeTruthy();
  });

  describe("Audience", () => {
    it("defaults to Public link and switching to Org members applies the full spec", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(
          makeShare({
            enabled: true,
            allowedOrigins: ["https://example.com"],
            messages: { rateLimited: "Easy there." },
          }),
        ),
      });
      await renderOpenDialog(client);

      const publicOption = screen.getByRole("radio", {
        name: "Public link",
        hidden: true,
      });
      expect(publicOption.getAttribute("aria-checked")).toBe("true");

      fireEvent.click(
        screen.getByRole("radio", { name: "Org members", hidden: true }),
      );

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.audience).toBe(AgentShareAudience.org);
      // Whole-spec replace: the audience switch must not clobber the rest.
      expect(input.enabled).toBe(true);
      expect(input.allowedOrigins).toEqual(["https://example.com"]);
      expect(input.messages?.rateLimited).toBe("Easy there.");
    });

    it("switching to Org members drops credential bindings (public-audience only)", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(
          makeShare({
            enabled: true,
            environmentRefs: [{ org: "acme", slug: "github-creds" }],
          }),
        ),
        environments: [orgSharedEnv("github-creds")],
      });
      await renderOpenDialog(client);

      fireEvent.click(
        screen.getByRole("radio", { name: "Org members", hidden: true }),
      );

      // The proto CEL rule rejects environment_refs on org-audience
      // shares — carrying them would fail the whole apply.
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.audience).toBe(AgentShareAudience.org);
      expect(input.environmentRefs).toEqual([]);
    });

    it("renders org-audience copy: member link, revocation note, no indexability warning", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(
          makeShare({ enabled: true, audience: AgentShareAudience.org }),
        ),
      });
      await renderOpenDialog(client);

      expect(screen.getByText("Organization members can chat")).toBeTruthy();
      expect(screen.getByText("Member chat link")).toBeTruthy();
      expect(
        screen.getByText(/access is checked on every message/i),
      ).toBeTruthy();
      expect(
        screen.queryByText(/forwarded and indexed by search engines/),
      ).toBeNull();
    });

    it("replaces the Embed tab with a public-only explanation for the org audience", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(
          makeShare({ enabled: true, audience: AgentShareAudience.org }),
        ),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      expect(
        screen.getByText(/Embedding isn't available for org-members-only sharing/),
      ).toBeTruthy();
      expect(screen.queryByText(/<stigmer-agent/)).toBeNull();
    });
  });

  describe("cross-org mode (shareOrg — decision 013)", () => {
    it("qualifies the agent in the header and hides the audience selector", async () => {
      // No share yet in the consumer org: the owner's share exists but
      // belongs to acme, so the consumer's dialog starts never-shared.
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client, { shareOrg: "consumer-org" });

      // The header names whose blueprint this channel serves.
      expect(screen.getByText("acme/support-agent")).toBeTruthy();
      // Cross-org shares are public-audience only — no choice to offer.
      expect(screen.queryByRole("radiogroup", { hidden: true })).toBeNull();
    });

    it("builds the link, billing line, and create identity from the sharing org", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({ apply });
      await renderOpenDialog(client, { shareOrg: "consumer-org" });

      // The hosted URL lives in the sharing org's namespace even before
      // the first save.
      expect(
        screen.getByText("https://app.example.com/chat/consumer-org/support-agent"),
      ).toBeTruthy();
      // Who-pays names the sharing org, not the agent's.
      expect(screen.getByText("consumer-org")).toBeTruthy();

      fireEvent.click(screen.getByRole("switch", { hidden: true }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.org).toBe("consumer-org");
      expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
      expect(input.audience).toBe(AgentShareAudience.public);
    });

    it("same-org dialogs are unchanged when shareOrg equals the agent's org", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client, { shareOrg: "acme" });

      expect(screen.getByText("Support Agent")).toBeTruthy();
      expect(screen.getByRole("radiogroup", { hidden: true })).toBeTruthy();
    });
  });

  it("enabling applies the complete spec and notifies the host", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const onSharingChanged = vi.fn();
    const client = createMockStigmer({
      apply,
      getByAgent: withShare(
        makeShare({
          enabled: false,
          allowedOrigins: ["https://example.com"],
          messages: { rateLimited: "Easy there." },
        }),
      ),
    });
    await renderOpenDialog(client, { onSharingChanged });

    fireEvent.click(screen.getByRole("switch", { hidden: true }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const input = apply.mock.calls[0][0] as AgentShareInput;
    expect(input.enabled).toBe(true);
    // Apply replaces the spec wholesale — the toggle must carry the
    // existing origins and messages or it would silently erase them.
    expect(input.allowedOrigins).toEqual(["https://example.com"]);
    expect(input.messages?.rateLimited).toBe("Easy there.");
    await waitFor(() => expect(onSharingChanged).toHaveBeenCalled());
  });

  it("adopts the server's returned share state after a commit", async () => {
    // Server echoes the apply but with a normalized origin list.
    const apply = vi.fn().mockResolvedValue(
      makeShare({
        enabled: true,
        allowedOrigins: ["https://normalized.example.com"],
      }),
    );
    const client = createMockStigmer({
      apply,
      getByAgent: withShare(makeShare({ enabled: false })),
    });
    await renderOpenDialog(client);

    fireEvent.click(screen.getByRole("switch", { hidden: true }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
    expect(screen.getByText("https://normalized.example.com")).toBeTruthy();
  });

  describe("Tool credentials", () => {
    it("warns needs-credentials for a tool-using share without bindings", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client, { agent: makeAgent({ mcpUsages: true }) });

      expect(
        screen.getByText(/no credentials are bound to this share/i),
      ).toBeTruthy();
    });

    it("binds an org-shared environment by applying the appended refs", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(makeShare({ enabled: true })),
        environments: [orgSharedEnv("github-creds", "GitHub Creds")],
      });
      await renderOpenDialog(client, { agent: makeAgent({ mcpUsages: true }) });

      // The section is expanded by default for tool-using agents.
      const picker = await screen.findByLabelText("Add environment", {
        // The select is visually present inside the collapsible.
        selector: "select",
      });
      fireEvent.change(picker, { target: { value: "github-creds" } });

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.environmentRefs).toEqual([
        { org: "acme", slug: "github-creds" },
      ]);
      // The binding rides the full spec — nothing else changes.
      expect(input.enabled).toBe(true);
    });

    it("offers only org-shared environments in the picker", async () => {
      const privateEnv = {
        metadata: {
          slug: "personal-creds",
          name: "Personal Creds",
          visibility: ApiResourceVisibility.visibility_private,
        },
        spec: { description: "" },
      };
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
        environments: [orgSharedEnv("github-creds", "GitHub Creds"), privateEnv],
      });
      await renderOpenDialog(client, { agent: makeAgent({ mcpUsages: true }) });

      await screen.findByLabelText("Add environment", { selector: "select" });
      // Private environments are guest-unusable (the runtime merge skips
      // them) — offering them would bind credentials that never apply.
      expect(screen.getByText("GitHub Creds")).toBeTruthy();
      expect(screen.queryByText("Personal Creds")).toBeNull();
    });

    it("hides the section entirely for org-audience shares", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(
          makeShare({ enabled: true, audience: AgentShareAudience.org }),
        ),
      });
      await renderOpenDialog(client, { agent: makeAgent({ mcpUsages: true }) });

      expect(screen.queryByText("Tool credentials")).toBeNull();
    });
  });

  describe("Embed tab", () => {
    it("shows the one-line script snippet: loader from the app origin + <stigmer-agent>", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      // The loader must be served from the SAME origin as the share URL —
      // embed.js derives the chat-page origin from its own script URL.
      expect(
        screen.getByText(
          /<script src="https:\/\/app\.example\.com\/embed\.js" async><\/script>/,
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          /<stigmer-agent org="acme" agent="support-agent"><\/stigmer-agent>/,
        ),
      ).toBeTruthy();
    });

    it("keeps the iframe snippet available as the collapsed no-JavaScript alternative", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      // Collapsed by default — the script snippet is the primary path.
      expect(screen.queryByText(/<iframe/)).toBeNull();

      fireEvent.click(
        screen.getByRole("button", {
          name: /No-JavaScript alternative/,
          hidden: true,
        }),
      );
      expect(
        screen.getByText(
          /src="https:\/\/app\.example\.com\/chat\/acme\/support-agent"/,
        ),
      ).toBeTruthy();
    });

    it("rejects an invalid origin without calling the RPC", async () => {
      const apply = vi.fn();
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      const input = screen.getByLabelText("Add allowed origin");
      fireEvent.change(input, {
        target: { value: "https://example.com/path" },
      });
      fireEvent.click(screen.getByText("Add"));

      expect(await screen.findByRole("alert", { hidden: true })).toBeTruthy();
      expect(apply).not.toHaveBeenCalled();
    });

    it("adds a valid origin by applying the appended list", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(
          makeShare({
            enabled: true,
            allowedOrigins: ["https://existing.example.com"],
          }),
        ),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      fireEvent.change(screen.getByLabelText("Add allowed origin"), {
        target: { value: "https://new.example.com" },
      });
      fireEvent.click(screen.getByText("Add"));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.allowedOrigins).toEqual([
        "https://existing.example.com",
        "https://new.example.com",
      ]);
      // Enabled state rides along untouched.
      expect(input.enabled).toBe(true);
    });

    it("rejects a duplicate origin", async () => {
      const apply = vi.fn();
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(
          makeShare({
            enabled: true,
            allowedOrigins: ["https://example.com"],
          }),
        ),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      fireEvent.change(screen.getByLabelText("Add allowed origin"), {
        target: { value: "https://example.com" },
      });
      fireEvent.click(screen.getByText("Add"));

      expect(await screen.findByRole("alert", { hidden: true })).toBeTruthy();
      expect(apply).not.toHaveBeenCalled();
    });

    it("removes an origin by applying the filtered list", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(
          makeShare({
            enabled: true,
            allowedOrigins: ["https://a.example.com", "https://b.example.com"],
          }),
        ),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      fireEvent.click(screen.getByLabelText("Remove https://a.example.com"));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.allowedOrigins).toEqual(["https://b.example.com"]);
    });
  });

  describe("visitor messages", () => {
    it("saves edited messages as part of the complete spec", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShare(
          makeShare({
            enabled: true,
            allowedOrigins: ["https://example.com"],
          }),
        ),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByText("Customize visitor messages"));
      fireEvent.change(screen.getByLabelText(/Rate limited/), {
        target: { value: "Please slow down." },
      });
      fireEvent.click(screen.getByText("Save messages"));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.messages?.rateLimited).toBe("Please slow down.");
      expect(input.enabled).toBe(true);
      expect(input.allowedOrigins).toEqual(["https://example.com"]);
    });

    it("caps each message at 300 characters", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByText("Customize visitor messages"));
      const field = screen.getByLabelText(/Rate limited/) as HTMLTextAreaElement;
      fireEvent.change(field, { target: { value: "x".repeat(400) } });
      expect(field.value.length).toBe(300);
    });
  });

  describe("who pays", () => {
    it("shows the who-pays line with the balance on cloud", async () => {
      const getOrCreateBillingAccount = vi.fn().mockResolvedValue({
        balance: { availableMicros: BigInt(12_500_000) },
      });
      const client = createMockStigmer({
        getOrCreateBillingAccount,
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client, { mode: "cloud" });

      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByText(/\$12\.50 available/)).toBeTruthy(),
      );
      expect(getOrCreateBillingAccount).toHaveBeenCalledWith("acme");
    });

    it("degrades to the who-pays line alone in local mode (no billing fetch)", async () => {
      const getOrCreateBillingAccount = vi.fn();
      const client = createMockStigmer({
        getOrCreateBillingAccount,
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client, { mode: "local" });

      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      expect(screen.queryByText(/available/)).toBeNull();
      expect(getOrCreateBillingAccount).not.toHaveBeenCalled();
    });

    it("degrades silently when the billing fetch fails", async () => {
      const getOrCreateBillingAccount = vi
        .fn()
        .mockRejectedValue(new Error("billing unavailable"));
      const client = createMockStigmer({
        getOrCreateBillingAccount,
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client, { mode: "cloud" });

      await waitFor(() => expect(getOrCreateBillingAccount).toHaveBeenCalled());
      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      expect(screen.queryByText(/available/)).toBeNull();
      expect(screen.queryByText(/billing unavailable/)).toBeNull();
    });
  });

  describe("Developer tab", () => {
    it("shows the platform client snippet and docs link", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client);

      fireEvent.click(screen.getByRole("tab", { name: /Developer/, hidden: true }));
      expect(screen.getByText(/createPlatformClientAuth/)).toBeTruthy();
      const link = screen.getByText(/platform client guide/);
      expect(link.getAttribute("href")).toContain("platform-client");
    });
  });

  it("renders in-flow without showModal when modal is false", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const client = createMockStigmer({
      getByAgent: withShare(makeShare({ enabled: true })),
    });
    await renderOpenDialog(client, { modal: false });

    expect(screen.getByText("Share")).toBeTruthy();
    expect(showModal).not.toHaveBeenCalled();
    showModal.mockRestore();
  });

  it("requests close via Done and the close affordance", async () => {
    const onOpenChange = vi.fn();
    const client = createMockStigmer({
      getByAgent: withShare(makeShare({ enabled: true })),
    });
    await renderOpenDialog(client, { onOpenChange });

    screen.getByText("Done").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    screen.getByLabelText("Close").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe("Reset link (rotatable share token)", () => {
    it("appends the status token to the shown link and embed snippet", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(makeShare({ enabled: true }, "tok123")),
      });
      await renderOpenDialog(client);

      expect(
        screen.getByText("https://app.example.com/chat/acme/support-agent?k=tok123"),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      expect(screen.getByText(/token="tok123"/)).toBeTruthy();
    });

    it("rotates on Reset link, adopts the fresh token, and notifies the host", async () => {
      const rotateShareLink = vi
        .fn()
        .mockResolvedValue(makeShare({ enabled: true }, "fresh-token"));
      const onSharingChanged = vi.fn();
      const client = createMockStigmer({
        rotateShareLink,
        getByAgent: withShare(makeShare({ enabled: true })),
      });
      await renderOpenDialog(client, { onSharingChanged });

      // A plain link shows no token before the reset.
      expect(
        screen.getByText("https://app.example.com/chat/acme/support-agent"),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Reset link", hidden: true }));

      await waitFor(() =>
        expect(
          screen.getByText(
            "https://app.example.com/chat/acme/support-agent?k=fresh-token",
          ),
        ).toBeTruthy(),
      );
      expect(rotateShareLink).toHaveBeenCalledTimes(1);
      // The rotation targets the loaded share by its own id.
      expect(
        (rotateShareLink.mock.calls[0][0] as { resourceId: string }).resourceId,
      ).toBe("ash_1");
      expect(onSharingChanged).toHaveBeenCalled();
    });

    it("hides the Reset control and the token for org-members-only shares", async () => {
      const client = createMockStigmer({
        getByAgent: withShare(
          makeShare(
            { enabled: true, audience: AgentShareAudience.org },
            "tok123",
          ),
        ),
      });
      await renderOpenDialog(client);

      // Org access is gated by membership, not the link token: the member
      // link stays clean and the Reset lever is not offered.
      expect(
        screen.getByText("https://app.example.com/chat/acme/support-agent"),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Reset link", hidden: true }),
      ).toBeNull();
    });
  });
});
