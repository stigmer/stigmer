import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code } from "@connectrpc/connect";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerError, type AgentShareInput } from "@stigmer/sdk";
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
  apply?: (input: AgentShareInput) => Promise<unknown>;
  rotateShareLink?: (input: unknown) => Promise<unknown>;
  getOrCreateBillingAccount?: (orgId: string) => Promise<unknown>;
  environments?: unknown[];
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    agentShare: {
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
  } as never;
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

/** Render the dialog open. Pass `share` for edit mode; omit for create mode. */
function renderOpenDialog(
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
}

describe("ShareAgentDialog", () => {
  it("mounts no body while closed (billing fetch stays lazy)", () => {
    const getOrCreateBillingAccount = vi.fn();
    render(
      <Providers client={createMockStigmer({ getOrCreateBillingAccount })}>
        <ShareAgentDialog
          open={false}
          onOpenChange={() => {}}
          agent={makeAgent()}
          share={makeShare({ enabled: true })}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    expect(screen.queryByText("Share")).toBeNull();
    expect(getOrCreateBillingAccount).not.toHaveBeenCalled();
  });

  it("renders header, toggle, and the share link from buildShareUrl", () => {
    renderOpenDialog(createMockStigmer(), {
      share: makeShare({ enabled: true }),
    });

    expect(screen.getByText("Share")).toBeTruthy();
    expect(screen.getByText("Support Agent")).toBeTruthy();
    expect(screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText("https://app.example.com/chat/acme/support-agent"),
    ).toBeTruthy();
  });

  it("builds the link from the SHARE's slug when it differs from the agent's", () => {
    // A renamed share: the hosted URL lives at the share's slug.
    const renamed = {
      ...(makeShare({ enabled: true }) as Record<string, unknown>),
      metadata: { id: "ash_1", org: "acme", slug: "help-desk", name: "Help Desk" },
    } as never;
    renderOpenDialog(createMockStigmer(), { share: renamed });

    expect(
      screen.getByText("https://app.example.com/chat/acme/help-desk"),
    ).toBeTruthy();
  });

  it("falls back to the relative /chat path when buildShareUrl is omitted", () => {
    renderOpenDialog(createMockStigmer(), {
      share: makeShare({ enabled: true }),
      buildShareUrl: undefined,
    });

    expect(screen.getByText("/chat/acme/support-agent")).toBeTruthy();
  });

  describe("create mode (no share prop)", () => {
    it("renders the create step with identity prefilled from the agent", () => {
      renderOpenDialog(createMockStigmer());

      expect(
        screen.getByRole("heading", { name: "Create share", hidden: true }),
      ).toBeTruthy();
      expect(
        (screen.getByLabelText("Name", { selector: "input" }) as HTMLInputElement).value,
      ).toBe("Support Agent");
      expect(
        (screen.getByLabelText("Slug", { selector: "input" }) as HTMLInputElement).value,
      ).toBe("support-agent");
      // No channel exists yet — no switch, no link, and the footer offers
      // Cancel rather than Done.
      expect(screen.queryByRole("switch", { hidden: true })).toBeNull();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("auto-derives the slug from the name until the slug is edited", () => {
      renderOpenDialog(createMockStigmer());

      const name = screen.getByLabelText("Name", { selector: "input" });
      const slug = screen.getByLabelText("Slug", { selector: "input" }) as HTMLInputElement;

      fireEvent.change(name, { target: { value: "Docs Site Widget" } });
      expect(slug.value).toBe("docs-site-widget");

      fireEvent.change(slug, { target: { value: "docs-widget" } });
      fireEvent.change(name, { target: { value: "Renamed Again" } });
      // Touched slug stays put.
      expect(slug.value).toBe("docs-widget");
    });

    it("creates the share live with the chosen identity, then becomes its editor", async () => {
      const apply = vi.fn().mockResolvedValue(makeShare({ enabled: true }));
      renderOpenDialog(createMockStigmer({ apply }));

      fireEvent.click(screen.getByRole("button", { name: "Create share", hidden: true }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.org).toBe("acme");
      expect(input.slug).toBe("support-agent");
      expect(input.name).toBe("Support Agent");
      expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
      // One intent-click yields a live link: created enabled, public.
      expect(input.enabled).toBe(true);
      expect(input.audience).toBe(AgentShareAudience.public);

      // The dialog transitions to the editor on the created share.
      await waitFor(() =>
        expect(
          screen.getByText("https://app.example.com/chat/acme/support-agent"),
        ).toBeTruthy(),
      );
      expect(screen.getByText("Done")).toBeTruthy();
    });

    it("pins an (org, slug) collision to the slug field with a pick-another-slug remedy", async () => {
      const apply = vi
        .fn()
        .mockRejectedValue(
          new StigmerError("already-exists", "duplicate slug", Code.AlreadyExists),
        );
      renderOpenDialog(createMockStigmer({ apply }));

      fireEvent.click(screen.getByRole("button", { name: "Create share", hidden: true }));

      expect(
        await screen.findByText(/pick a different slug/i),
      ).toBeTruthy();
      // Still on the create step — nothing was created.
      expect(screen.queryByRole("switch", { hidden: true })).toBeNull();

      // Editing the slug clears the collision so the user can retry.
      fireEvent.change(screen.getByLabelText("Slug", { selector: "input" }), {
        target: { value: "support-agent-2" },
      });
      expect(screen.queryByText(/pick a different slug/i)).toBeNull();
    });

    it("surfaces other server refusals verbatim (e.g. non-public dependencies)", async () => {
      const apply = vi
        .fn()
        .mockRejectedValue(
          new StigmerError(
            "failed-precondition",
            "cannot share acme/support-agent across organizations: it references resources that are not public: skill acme/internal-kb",
            Code.FailedPrecondition,
          ),
        );
      renderOpenDialog(createMockStigmer({ apply }), { shareOrg: "consumer-org" });

      fireEvent.click(screen.getByRole("button", { name: "Create share", hidden: true }));

      expect(
        await screen.findByText(/resources that are not public/i),
      ).toBeTruthy();
    });

    it("cross-org create: qualifies the agent, names the paying org, creates in the viewer's org", async () => {
      const apply = vi.fn().mockResolvedValue({
        metadata: {
          id: "ash_ext",
          org: "consumer-org",
          slug: "support-agent",
          name: "Support Agent",
        },
        spec: {
          agentRef: { org: "acme", slug: "support-agent" },
          enabled: true,
        },
      });
      renderOpenDialog(createMockStigmer({ apply }), { shareOrg: "consumer-org" });

      // The header names whose blueprint this channel serves.
      expect(screen.getByText("acme/support-agent")).toBeTruthy();
      // The create copy names the org that owns and pays for the channel.
      expect(screen.getByText(/credits/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Create share", hidden: true }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.org).toBe("consumer-org");
      expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });

      // The editor shows the sharing org's URL; cross-org shares are
      // public-audience only, so no audience selector is offered.
      await waitFor(() =>
        expect(
          screen.getByText("https://app.example.com/chat/consumer-org/support-agent"),
        ).toBeTruthy(),
      );
      expect(screen.queryByRole("radiogroup", { hidden: true })).toBeNull();
    });
  });

  describe("paused share (enabled: false)", () => {
    it("renders the off state with disabled copy affordances", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: false }),
      });

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

    it("shows the reason on the Embed tab too", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: false }),
      });

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      expect(
        screen.getByText(/sharing is off, so this embed doesn't work yet/i),
      ).toBeTruthy();
    });

    it("drops the hint and enables copy once sharing is on", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }),
      });

      const copy = screen.getByRole("button", {
        name: "Copy",
        hidden: true,
      }) as HTMLButtonElement;
      expect(copy.disabled).toBe(false);
      expect(screen.queryByText(/sharing is off/i)).toBeNull();
    });
  });

  it("shows the indexability warning", () => {
    renderOpenDialog(createMockStigmer(), {
      share: makeShare({ enabled: true }),
    });

    expect(
      screen.getByText(/forwarded and indexed by search engines/),
    ).toBeTruthy();
  });

  describe("Audience", () => {
    it("defaults to Public link and switching to Org members applies the full spec", async () => {
      const apply = vi.fn().mockResolvedValue({});
      renderOpenDialog(createMockStigmer({ apply }), {
        share: makeShare({
          enabled: true,
          allowedOrigins: ["https://example.com"],
          messages: { rateLimited: "Easy there." },
        }),
      });

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
      // Edit keys on the existing share's identity — never a new row.
      expect(input.org).toBe("acme");
      expect(input.slug).toBe("support-agent");
    });

    it("switching to Org members drops credential bindings (public-audience only)", async () => {
      const apply = vi.fn().mockResolvedValue({});
      renderOpenDialog(
        createMockStigmer({
          apply,
          environments: [orgSharedEnv("github-creds")],
        }),
        {
          share: makeShare({
            enabled: true,
            environmentRefs: [{ org: "acme", slug: "github-creds" }],
          }),
        },
      );

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

    it("renders org-audience copy: member link, revocation note, no indexability warning", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true, audience: AgentShareAudience.org }),
      });

      expect(screen.getByText("Organization members can chat")).toBeTruthy();
      expect(screen.getByText("Member chat link")).toBeTruthy();
      expect(
        screen.getByText(/access is checked on every message/i),
      ).toBeTruthy();
      expect(
        screen.queryByText(/forwarded and indexed by search engines/),
      ).toBeNull();
    });

    it("replaces the Embed tab with a public-only explanation for the org audience", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true, audience: AgentShareAudience.org }),
      });

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      expect(
        screen.getByText(/Embedding isn't available for org-members-only sharing/),
      ).toBeTruthy();
      expect(screen.queryByText(/<stigmer-agent/)).toBeNull();
    });
  });

  describe("cross-org edit mode (share org differs from the agent's — decision 013)", () => {
    const externalShare = {
      metadata: {
        id: "ash_ext",
        org: "consumer-org",
        slug: "support-agent",
        name: "Support Agent",
      },
      spec: {
        agentRef: { org: "acme", slug: "support-agent" },
        enabled: true,
      },
    } as never;

    it("qualifies the agent in the header and hides the audience selector", () => {
      renderOpenDialog(createMockStigmer(), { share: externalShare });

      // The header names whose blueprint this channel serves.
      expect(screen.getByText("acme/support-agent")).toBeTruthy();
      // Cross-org shares are public-audience only — no choice to offer.
      expect(screen.queryByRole("radiogroup", { hidden: true })).toBeNull();
    });

    it("builds the link and billing line from the sharing org", () => {
      renderOpenDialog(createMockStigmer(), { share: externalShare });

      expect(
        screen.getByText("https://app.example.com/chat/consumer-org/support-agent"),
      ).toBeTruthy();
      // Who-pays names the sharing org, not the agent's.
      expect(screen.getByText("consumer-org")).toBeTruthy();
    });

    it("same-org dialogs are unchanged when the share org equals the agent's", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }),
      });

      expect(screen.getByText("Support Agent")).toBeTruthy();
      expect(screen.getByRole("radiogroup", { hidden: true })).toBeTruthy();
    });
  });

  it("enabling applies the complete spec and notifies the host", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const onSharingChanged = vi.fn();
    renderOpenDialog(createMockStigmer({ apply }), {
      onSharingChanged,
      share: makeShare({
        enabled: false,
        allowedOrigins: ["https://example.com"],
        messages: { rateLimited: "Easy there." },
      }),
    });

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
    renderOpenDialog(createMockStigmer({ apply }), {
      share: makeShare({ enabled: false }),
    });

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
    it("warns needs-credentials for a tool-using share without bindings", () => {
      renderOpenDialog(createMockStigmer(), {
        agent: makeAgent({ mcpUsages: true }),
        share: makeShare({ enabled: true }),
      });

      expect(
        screen.getByText(/no credentials are bound to this share/i),
      ).toBeTruthy();
    });

    it("binds an org-shared environment by applying the appended refs", async () => {
      const apply = vi.fn().mockResolvedValue({});
      renderOpenDialog(
        createMockStigmer({
          apply,
          environments: [orgSharedEnv("github-creds", "GitHub Creds")],
        }),
        {
          agent: makeAgent({ mcpUsages: true }),
          share: makeShare({ enabled: true }),
        },
      );

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
      renderOpenDialog(
        createMockStigmer({
          environments: [orgSharedEnv("github-creds", "GitHub Creds"), privateEnv],
        }),
        {
          agent: makeAgent({ mcpUsages: true }),
          share: makeShare({ enabled: true }),
        },
      );

      await screen.findByLabelText("Add environment", { selector: "select" });
      // Private environments are guest-unusable (the runtime merge skips
      // them) — offering them would bind credentials that never apply.
      expect(screen.getByText("GitHub Creds")).toBeTruthy();
      expect(screen.queryByText("Personal Creds")).toBeNull();
    });

    it("hides the section entirely for org-audience shares", () => {
      renderOpenDialog(createMockStigmer(), {
        agent: makeAgent({ mcpUsages: true }),
        share: makeShare({ enabled: true, audience: AgentShareAudience.org }),
      });

      expect(screen.queryByText("Tool credentials")).toBeNull();
    });
  });

  describe("Embed tab", () => {
    it("shows the one-line script snippet: loader from the app origin + <stigmer-agent>", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }),
      });

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

    it("keeps the iframe snippet available as the collapsed no-JavaScript alternative", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }),
      });

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
      renderOpenDialog(createMockStigmer({ apply }), {
        share: makeShare({ enabled: true }),
      });

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
      renderOpenDialog(createMockStigmer({ apply }), {
        share: makeShare({
          enabled: true,
          allowedOrigins: ["https://existing.example.com"],
        }),
      });

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
      renderOpenDialog(createMockStigmer({ apply }), {
        share: makeShare({
          enabled: true,
          allowedOrigins: ["https://example.com"],
        }),
      });

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
      renderOpenDialog(createMockStigmer({ apply }), {
        share: makeShare({
          enabled: true,
          allowedOrigins: ["https://a.example.com", "https://b.example.com"],
        }),
      });

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
      renderOpenDialog(createMockStigmer({ apply }), {
        share: makeShare({
          enabled: true,
          allowedOrigins: ["https://example.com"],
        }),
      });

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

    it("caps each message at 300 characters", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }),
      });

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
      renderOpenDialog(createMockStigmer({ getOrCreateBillingAccount }), {
        mode: "cloud",
        share: makeShare({ enabled: true }),
      });

      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByText(/\$12\.50 available/)).toBeTruthy(),
      );
      expect(getOrCreateBillingAccount).toHaveBeenCalledWith("acme");
    });

    it("degrades to the who-pays line alone in local mode (no billing fetch)", () => {
      const getOrCreateBillingAccount = vi.fn();
      renderOpenDialog(createMockStigmer({ getOrCreateBillingAccount }), {
        mode: "local",
        share: makeShare({ enabled: true }),
      });

      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      expect(screen.queryByText(/available/)).toBeNull();
      expect(getOrCreateBillingAccount).not.toHaveBeenCalled();
    });

    it("degrades silently when the billing fetch fails", async () => {
      const getOrCreateBillingAccount = vi
        .fn()
        .mockRejectedValue(new Error("billing unavailable"));
      renderOpenDialog(createMockStigmer({ getOrCreateBillingAccount }), {
        mode: "cloud",
        share: makeShare({ enabled: true }),
      });

      await waitFor(() => expect(getOrCreateBillingAccount).toHaveBeenCalled());
      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      expect(screen.queryByText(/available/)).toBeNull();
      expect(screen.queryByText(/billing unavailable/)).toBeNull();
    });
  });

  describe("Developer tab", () => {
    it("shows the platform client snippet and docs link", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }),
      });

      fireEvent.click(screen.getByRole("tab", { name: /Developer/, hidden: true }));
      expect(screen.getByText(/createPlatformClientAuth/)).toBeTruthy();
      const link = screen.getByText(/platform client guide/);
      expect(link.getAttribute("href")).toContain("platform-client");
    });
  });

  it("renders in-flow without showModal when modal is false", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    renderOpenDialog(createMockStigmer(), {
      modal: false,
      share: makeShare({ enabled: true }),
    });

    expect(screen.getByText("Share")).toBeTruthy();
    expect(showModal).not.toHaveBeenCalled();
    showModal.mockRestore();
  });

  it("requests close via Done and the close affordance", () => {
    const onOpenChange = vi.fn();
    renderOpenDialog(createMockStigmer(), {
      onOpenChange,
      share: makeShare({ enabled: true }),
    });

    screen.getByText("Done").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    screen.getByLabelText("Close").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe("Reset link (rotatable share token)", () => {
    it("appends the status token to the shown link and embed snippet", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }, "tok123"),
      });

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
      renderOpenDialog(createMockStigmer({ rotateShareLink }), {
        onSharingChanged,
        share: makeShare({ enabled: true }),
      });

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
      // The rotation targets the given share by its own id.
      expect(
        (rotateShareLink.mock.calls[0][0] as { resourceId: string }).resourceId,
      ).toBe("ash_1");
      expect(onSharingChanged).toHaveBeenCalled();
    });

    it("hides the Reset control and the token for org-members-only shares", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare(
          { enabled: true, audience: AgentShareAudience.org },
          "tok123",
        ),
      });

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
