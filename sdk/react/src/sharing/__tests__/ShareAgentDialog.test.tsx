import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { StigmerError, type AgentShareInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { PublicBaseUrlContext } from "../../public-base-url-context";
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
  credentials?: unknown[];
  baseUrl?: string;
}

const CLOUD_API_BASE_URL = "https://api.stigmer.ai";

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    baseUrl: overrides.baseUrl ?? CLOUD_API_BASE_URL,
    agentShare: {
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
      rotateShareLink:
        overrides.rotateShareLink ?? vi.fn().mockResolvedValue({}),
    },
    credential: {
      list: vi.fn().mockResolvedValue({
        items: overrides.credentials ?? [],
        totalCount: overrides.credentials?.length ?? 0,
      }),
    },
    // The agent's one MCP server, read for what visitors' runs need.
    mcpServer: {
      getByReference: vi.fn().mockResolvedValue(
        create(McpServerSchema, {
          metadata: { id: "mcp_github", org: "acme", slug: "github", name: "GitHub" },
          spec: { env: { GITHUB_TOKEN: { isSecret: true } } },
        }),
      ),
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
  publicBaseUrl,
  children,
}: {
  client: unknown;
  mode?: "cloud" | "local";
  publicBaseUrl?: string;
  children: ReactNode;
}) {
  return (
    <FetchCacheContext.Provider value={null}>
      <DeploymentModeContext.Provider value={mode}>
        <StigmerContext.Provider value={client as never}>
          <PublicBaseUrlContext.Provider value={publicBaseUrl}>
            {children}
          </PublicBaseUrlContext.Provider>
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
    credentials?: unknown[];
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

function orgCredential(slug: string, name?: string) {
  return create(CredentialSchema, {
    metadata: { id: `cred_${slug}`, org: "acme", slug, name: name ?? slug },
    spec: { owner: { case: "org", value: "acme" }, fields: { GITHUB_TOKEN: { value: "***REDACTED***" } } },
  });
}

/** A stored assignment of GITHUB_TOKEN for the GitHub MCP server from `slug`. */
function githubAssignment(slug: string) {
  return {
    requirement: { declarer: { target: { case: "mcpServer", value: { org: "acme", slug: "github" } } }, key: "GITHUB_TOKEN" },
    source: { case: "credential", value: { credential: { org: "acme", slug }, field: "" } },
    writer: "ida_owner",
  };
}

// A link names the share by its id alone — never its organization or slug.
const buildShareUrl = (shareId: string) =>
  `https://app.example.com/chat/${shareId}`;

/** Render the dialog open. Pass `share` for edit mode; omit for create mode. */
function renderOpenDialog(
  client: unknown,
  props?: Partial<Parameters<typeof ShareAgentDialog>[0]> & {
    mode?: "cloud" | "local";
    publicBaseUrl?: string;
  },
) {
  const { mode, publicBaseUrl, ...dialogProps } = props ?? {};
  render(
    <Providers client={client} mode={mode} publicBaseUrl={publicBaseUrl}>
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
      screen.getByText("https://app.example.com/chat/ash_1"),
    ).toBeTruthy();
  });

  it("builds the link from the SHARE's id, never its slug or organization", () => {
    // A share whose slug differs from the agent's: the hosted URL still
    // names only the share's id, so neither name reaches the link.
    const buildShareUrlSpy = vi.fn(buildShareUrl);
    const renamed = {
      ...(makeShare({ enabled: true }) as Record<string, unknown>),
      metadata: { id: "ash_9", org: "acme", slug: "help-desk", name: "Help Desk" },
    } as never;
    renderOpenDialog(createMockStigmer(), {
      share: renamed,
      buildShareUrl: buildShareUrlSpy,
    });

    expect(screen.getByText("https://app.example.com/chat/ash_9")).toBeTruthy();
    expect(buildShareUrlSpy).toHaveBeenCalledWith("ash_9");
    expect(screen.queryByText(/chat\/acme|help-desk/)).toBeNull();
  });

  it("falls back to the relative /chat path when buildShareUrl is omitted", () => {
    renderOpenDialog(createMockStigmer(), {
      share: makeShare({ enabled: true }),
      buildShareUrl: undefined,
    });

    expect(screen.getByText("/chat/ash_1")).toBeTruthy();
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
      // The slug names the share, not its link: the link names the share's
      // id, which exists only once the share does, so none is previewed.
      expect(
        screen.getByText(
          "Names this share in the CLI and API. The link is made when you create the share. Can't be changed later.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/\/chat\//)).toBeNull();
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
          screen.getByText("https://app.example.com/chat/ash_1"),
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

    it("surfaces other server refusals verbatim (e.g. a permission the caller lacks)", async () => {
      const apply = vi
        .fn()
        .mockRejectedValue(
          new StigmerError(
            "permission-denied",
            "creating a share needs can_create_agent_share on organization acme",
            Code.PermissionDenied,
          ),
        );
      renderOpenDialog(createMockStigmer({ apply }));

      fireEvent.click(screen.getByRole("button", { name: "Create share", hidden: true }));

      expect(
        await screen.findByText(/needs can_create_agent_share/i),
      ).toBeTruthy();
    });

    it("creates the share in the agent's own organization and names it as the paying org", async () => {
      const apply = vi.fn().mockResolvedValue({
        metadata: {
          id: "ash_new",
          org: "acme",
          slug: "support-agent",
          name: "Support Agent",
        },
        spec: {
          agentRef: { org: "acme", slug: "support-agent" },
          enabled: true,
        },
      });
      renderOpenDialog(createMockStigmer({ apply }));

      // The create copy names the org that owns and pays for the channel.
      expect(screen.getByText(/credits/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Create share", hidden: true }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.org).toBe("acme");
      expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });

      // The editor shows the created share's link, by the id the server
      // minted, and offers the audience choice.
      await waitFor(() =>
        expect(
          screen.getByText("https://app.example.com/chat/ash_new"),
        ).toBeTruthy(),
      );
      expect(screen.getByRole("radiogroup", { hidden: true })).toBeTruthy();
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
          credentials: [orgCredential("github-creds")],
        }),
        {
          share: makeShare({
            enabled: true,
            credentials: [githubAssignment("github-creds")],
          }),
        },
      );

      fireEvent.click(
        screen.getByRole("radio", { name: "Org members", hidden: true }),
      );

      // The proto CEL rule rejects credentials on org-audience shares —
      // carrying them would fail the whole apply.
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.audience).toBe(AgentShareAudience.org);
      expect(input.credentials).toEqual([]);
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

  describe("edit mode identity", () => {
    it("names the agent in the header, offers the audience choice, and builds the link from the share's own id", () => {
      renderOpenDialog(createMockStigmer(), {
        share: makeShare({ enabled: true }),
      });

      expect(screen.getByText("Support Agent")).toBeTruthy();
      expect(screen.getByRole("radiogroup", { hidden: true })).toBeTruthy();
      expect(
        screen.getByText("https://app.example.com/chat/ash_1"),
      ).toBeTruthy();
    });

    it("edits a share written in another organization before the retirement by its own identity", () => {
      // Such a row no longer serves, but an edit must still address the
      // row that exists rather than re-home it under the agent's org: its
      // link names that row's own id.
      const legacyShare = {
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
      renderOpenDialog(createMockStigmer(), { share: legacyShare });

      expect(
        screen.getByText("https://app.example.com/chat/ash_ext"),
      ).toBeTruthy();
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

  describe("Credentials", () => {
    it("names the values visitors' chats need when nothing assigns them", async () => {
      renderOpenDialog(createMockStigmer(), {
        agent: makeAgent({ mcpUsages: true }),
        share: makeShare({ enabled: true }),
      });

      expect(await screen.findByText(/Visitors.*chats won.t start yet/i)).toBeTruthy();
    });

    it("assigns an organization key's field and saves it with one button, never sending a writer", async () => {
      const apply = vi.fn().mockResolvedValue({});
      renderOpenDialog(
        createMockStigmer({
          apply,
          credentials: [orgCredential("github-creds", "GitHub Creds")],
        }),
        {
          agent: makeAgent({ mcpUsages: true }),
          share: makeShare({ enabled: true }),
        },
      );

      // The section is expanded by default for tool-using agents.
      const source = await screen.findByLabelText("GITHUB_TOKEN", { selector: "select" });
      await screen.findByRole("option", { name: "GitHub Creds", hidden: true });
      fireEvent.change(source, { target: { value: "cred:acme/github-creds" } });
      expect(apply).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save credentials", hidden: true }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.credentials).toEqual([
        {
          requirement: { declarer: { mcpServer: { org: "acme", slug: "github" } }, key: "GITHUB_TOKEN" },
          credential: { credential: { org: "acme", slug: "github-creds" } },
        },
      ]);
      // The assignment rides the full spec — nothing else changes.
      expect(input.enabled).toBe(true);
    });

    it("keeps a stored assignment without its writer on any other save", async () => {
      const apply = vi.fn().mockResolvedValue({});
      renderOpenDialog(createMockStigmer({ apply, credentials: [orgCredential("github-creds")] }), {
        agent: makeAgent({ mcpUsages: true }),
        share: makeShare({ enabled: true, credentials: [githubAssignment("github-creds")] }),
      });

      fireEvent.click(screen.getByRole("switch", { hidden: true }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.credentials).toHaveLength(1);
      expect(JSON.stringify(input.credentials)).not.toContain("writer");
    });

    it("hides the section entirely for org-audience shares", () => {
      renderOpenDialog(createMockStigmer(), {
        agent: makeAgent({ mcpUsages: true }),
        share: makeShare({ enabled: true, audience: AgentShareAudience.org }),
      });

      expect(screen.queryByRole("button", { name: "Credentials", hidden: true })).toBeNull();
    });
  });

  describe("Embed tab", () => {
    it("shows the one-line script snippet: loader from the app origin + <stigmer-agent> naming the share", () => {
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
          /<stigmer-agent share="ash_1"><\/stigmer-agent>/,
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
          /src="https:\/\/app\.example\.com\/chat\/ash_1"/,
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

    function openDeveloperSnippet(baseUrl?: string): string {
      renderOpenDialog(createMockStigmer({ baseUrl }), {
        share: makeShare({ enabled: true }),
      });
      fireEvent.click(screen.getByRole("tab", { name: /Developer/, hidden: true }));
      return screen.getByText(/createPlatformClientAuth/).textContent ?? "";
    }

    it("targets the server the console is connected to, not Stigmer Cloud", () => {
      const snippet = openDeveloperSnippet("https://stigmer.acme.internal:8443/");

      expect(snippet).toContain(`baseUrl: "https://stigmer.acme.internal:8443",`);
      expect(snippet).not.toContain("api.stigmer.ai");
    });

    it("keeps the Stigmer Cloud snippet unchanged when connected to Cloud", () => {
      const snippet = openDeveloperSnippet(CLOUD_API_BASE_URL);

      expect(snippet).toContain(`baseUrl: "https://api.stigmer.ai",`);
    });

    // stigmer/stigmer#1335: a relative baseUrl (a same-origin proxy) is not
    // an address a backend can call, so the snippet is built only from an
    // absolute one the host named, and says so when there is none.
    it("says the code is unavailable for a relative baseUrl, instead of printing baseUrl: \"\"", () => {
      renderOpenDialog(createMockStigmer({ baseUrl: "/" }), {
        share: makeShare({ enabled: true }),
      });
      fireEvent.click(screen.getByRole("tab", { name: /Developer/, hidden: true }));

      expect(screen.getByText("Platform client integration")).toBeTruthy();
      expect(
        screen.getByText(/doesn't know your Stigmer server's public address/),
      ).toBeTruthy();
      expect(screen.queryByText(/createPlatformClientAuth/)).toBeNull();
    });

    it("builds the snippet from the host's public base URL behind a relative baseUrl", () => {
      renderOpenDialog(createMockStigmer({ baseUrl: "/" }), {
        share: makeShare({ enabled: true }),
        publicBaseUrl: "https://api.acme.example/",
      });
      fireEvent.click(screen.getByRole("tab", { name: /Developer/, hidden: true }));

      expect(screen.getByText(/createPlatformClientAuth/).textContent).toContain(
        `baseUrl: "https://api.acme.example",`,
      );
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
        screen.getByText("https://app.example.com/chat/ash_1?k=tok123"),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      expect(
        screen.getByText(/<stigmer-agent share="ash_1" token="tok123"><\/stigmer-agent>/),
      ).toBeTruthy();
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
        screen.getByText("https://app.example.com/chat/ash_1"),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Reset link", hidden: true }));

      await waitFor(() =>
        expect(
          screen.getByText(
            "https://app.example.com/chat/ash_1?k=fresh-token",
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
        screen.getByText("https://app.example.com/chat/ash_1"),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Reset link", hidden: true }),
      ).toBeNull();
    });
  });
});
