import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { AgentShareInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { DeploymentModeContext } from "../../deployment-mode";
import { AgentShareList } from "../AgentShareList";

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
  getByAgent?: (input: unknown) => Promise<unknown>;
  apply?: (input: AgentShareInput) => Promise<unknown>;
  deleteShare?: (id: string) => Promise<unknown>;
  rotateShareLink?: (input: unknown) => Promise<unknown>;
  isAuthorized?: boolean;
  /**
   * Per-relation authorization, for tests that need `can_edit` and
   * `can_delete` to differ. Takes precedence over `isAuthorized`.
   */
  checkPermission?: (relation: string) => boolean;
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    agentShare: {
      getByAgent:
        overrides.getByAgent ??
        vi.fn().mockResolvedValue({ totalCount: 0, items: [] }),
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
      delete: overrides.deleteShare ?? vi.fn().mockResolvedValue({}),
      rotateShareLink:
        overrides.rotateShareLink ?? vi.fn().mockResolvedValue({}),
    },
    iamPolicy: {
      checkMyPermission: vi
        .fn()
        .mockImplementation((input: { relation: string }) =>
          Promise.resolve({
            isAuthorized: overrides.checkPermission
              ? overrides.checkPermission(input.relation)
              : (overrides.isAuthorized ?? true),
          }),
        ),
    },
    environment: {
      list: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      getByReference: vi.fn().mockRejectedValue(new Error("not found")),
    },
    billing: {
      getOrCreateBillingAccount: vi.fn().mockResolvedValue(null),
    },
  } as never;
}

function Providers({
  client,
  children,
}: {
  client: unknown;
  children: ReactNode;
}) {
  return (
    <FetchCacheContext.Provider value={null}>
      <DeploymentModeContext.Provider value="cloud">
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </DeploymentModeContext.Provider>
    </FetchCacheContext.Provider>
  );
}

const AGENT = {
  metadata: {
    id: "agt_1",
    org: "acme",
    slug: "support-agent",
    name: "Support Agent",
    visibility: ApiResourceVisibility.visibility_public,
  },
  spec: { mcpServerUsages: [] },
} as never;

function makeShare(overrides?: {
  id?: string;
  org?: string;
  slug?: string;
  name?: string;
  enabled?: boolean;
  audience?: AgentShareAudience;
  allowedOrigins?: string[];
  shareLinkToken?: string;
}) {
  return {
    metadata: {
      id: overrides?.id ?? "ash_1",
      org: overrides?.org ?? "acme",
      slug: overrides?.slug ?? "support-agent",
      name: overrides?.name ?? "Support Agent",
    },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: overrides?.enabled ?? true,
      ...(overrides?.audience !== undefined && { audience: overrides.audience }),
      ...(overrides?.allowedOrigins && { allowedOrigins: overrides.allowedOrigins }),
    },
    ...(overrides?.shareLinkToken !== undefined
      ? { status: { shareLinkToken: overrides.shareLinkToken } }
      : {}),
  };
}

function withShares(...shares: unknown[]) {
  return vi.fn().mockResolvedValue({ totalCount: shares.length, items: shares });
}

const buildShareUrl = (org: string, slug: string) =>
  `https://app.example.com/chat/${org}/${slug}`;

async function renderList(
  client: unknown,
  props?: Partial<Parameters<typeof AgentShareList>[0]>,
) {
  render(
    <Providers client={client}>
      <AgentShareList
        agent={AGENT}
        buildShareUrl={buildShareUrl}
        {...props}
      />
    </Providers>,
  );
  await waitFor(() =>
    expect(document.querySelector('[class*="animate-pulse"]')).toBeNull(),
  );
}

/**
 * Opens a row's overflow (kebab) menu and resolves once its items mount.
 * Pass the row's visible name to disambiguate when several rows are present.
 * The menu content is portaled, so query its items from `screen`, not the row.
 */
async function openRowMenu(rowName?: string) {
  const scope = rowName
    ? within(screen.getByText(rowName).closest("tr")!)
    : screen;
  fireEvent.click(scope.getByRole("button", { name: /^Actions for/ }));
  await screen.findByRole("menuitem", { name: "Edit" });
}

describe("AgentShareList", () => {
  it("lists every share with link, audience, and status — no canonical collapse", async () => {
    const client = createMockStigmer({
      getByAgent: withShares(
        makeShare(),
        makeShare({
          id: "ash_2",
          slug: "help-desk",
          name: "Help Desk",
          enabled: false,
          audience: AgentShareAudience.org,
        }),
      ),
    });
    await renderList(client);

    expect(screen.getByText("2 shares")).toBeTruthy();
    expect(screen.getByText("Support Agent")).toBeTruthy();
    expect(screen.getByText("Help Desk")).toBeTruthy();
    expect(screen.getByText("/chat/acme/support-agent")).toBeTruthy();
    expect(screen.getByText("/chat/acme/help-desk")).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Org members")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("marks another org's channel of this agent as cross-org", async () => {
    const client = createMockStigmer({
      getByAgent: withShares(
        makeShare({ id: "ash_ext", org: "consumer-org" }),
      ),
    });
    await renderList(client);

    expect(screen.getByText("Cross-org")).toBeTruthy();
    expect(screen.getByText("/chat/consumer-org/support-agent")).toBeTruthy();
  });

  it("shows the empty state with a create call-to-action when allowed", async () => {
    const client = createMockStigmer();
    await renderList(client);

    expect(screen.getByText("No shares yet")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create share/ }),
    ).toBeTruthy();
  });

  it("hides the create affordances when the viewer fails the create bar", async () => {
    const client = createMockStigmer({ isAuthorized: false });
    await renderList(client);

    expect(screen.getByText("No shares yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create share/ })).toBeNull();
  });

  it("opens the dialog in create mode from the Create button", async () => {
    const client = createMockStigmer({ getByAgent: withShares(makeShare()) });
    await renderList(client);

    fireEvent.click(screen.getByRole("button", { name: /Create share/ }));

    // The dialog's create step renders identity fields.
    expect(await screen.findByLabelText("Name", { selector: "input" })).toBeTruthy();
    expect(screen.getByLabelText("Slug", { selector: "input" })).toBeTruthy();
  });

  it("opens the dialog on the EXACT share of the clicked row", async () => {
    const client = createMockStigmer({
      getByAgent: withShares(
        makeShare(),
        makeShare({ id: "ash_2", slug: "help-desk", name: "Help Desk" }),
      ),
    });
    await renderList(client);

    await openRowMenu("Help Desk");
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

    // The editor shows the chosen share's URL — not the first row's.
    expect(
      await screen.findByText("https://app.example.com/chat/acme/help-desk"),
    ).toBeTruthy();
  });

  it("copies the tokened URL for public shares and the clean URL for org shares", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const client = createMockStigmer({
      getByAgent: withShares(
        makeShare({ shareLinkToken: "tok123" }),
        makeShare({
          id: "ash_2",
          slug: "internal",
          name: "Internal",
          audience: AgentShareAudience.org,
          shareLinkToken: "tok456",
        }),
      ),
    });
    await renderList(client);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy link for Support Agent" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://app.example.com/chat/acme/support-agent?k=tok123",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Copy link for Internal" }),
    );
    // Org access is gated by membership, not the token — the member link
    // stays clean.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://app.example.com/chat/acme/internal",
      ),
    );
  });

  describe("pause / resume", () => {
    it("pauses by applying the FULL spec with only enabled flipped", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShares(
          makeShare({ allowedOrigins: ["https://example.com"] }),
        ),
      });
      await renderList(client);

      await openRowMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Pause" }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.enabled).toBe(false);
      // Apply replaces the spec wholesale — the toggle must carry the
      // existing config or it would silently erase it.
      expect(input.allowedOrigins).toEqual(["https://example.com"]);
      // Keyed on the row's own identity — never a new row.
      expect(input.org).toBe("acme");
      expect(input.slug).toBe("support-agent");
    });

    it("resumes a paused share", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({
        apply,
        getByAgent: withShares(makeShare({ enabled: false })),
      });
      await renderList(client);

      await openRowMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Resume" }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      expect((apply.mock.calls[0][0] as AgentShareInput).enabled).toBe(true);
    });
  });

  describe("reset link", () => {
    it("rotates the row's own share", async () => {
      const rotateShareLink = vi.fn().mockResolvedValue(makeShare());
      const client = createMockStigmer({
        rotateShareLink,
        getByAgent: withShares(makeShare()),
      });
      await renderList(client);

      await openRowMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Reset link" }));

      await waitFor(() => expect(rotateShareLink).toHaveBeenCalledTimes(1));
      expect(
        (rotateShareLink.mock.calls[0][0] as { resourceId: string }).resourceId,
      ).toBe("ash_1");
    });

    it("is not offered on org-audience shares (membership gates access, not the token)", async () => {
      const client = createMockStigmer({
        getByAgent: withShares(
          makeShare({ audience: AgentShareAudience.org }),
        ),
      });
      await renderList(client);

      await openRowMenu();
      expect(screen.queryByRole("menuitem", { name: "Reset link" })).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes after confirmation and refetches", async () => {
      const deleteShare = vi.fn().mockResolvedValue({});
      const getByAgent = withShares(makeShare());
      const client = createMockStigmer({ deleteShare, getByAgent });
      await renderList(client);

      await openRowMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

      // The confirmation names the destructive consequence and the
      // config-preserving alternative (pause).
      const title = await screen.findByText("Delete share?");
      expect(screen.getByText(/pause it instead/i)).toBeTruthy();

      const confirmDialog = title.closest("dialog") as HTMLElement;
      fireEvent.click(
        within(confirmDialog).getByRole("button", { name: "Delete", hidden: true }),
      );

      await waitFor(() => expect(deleteShare).toHaveBeenCalledWith("ash_1"));
      await waitFor(() => expect(getByAgent).toHaveBeenCalledTimes(2));
    });

    it("does nothing when the confirmation is cancelled", async () => {
      const deleteShare = vi.fn();
      const client = createMockStigmer({
        deleteShare,
        getByAgent: withShares(makeShare()),
      });
      await renderList(client);

      await openRowMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(await screen.findByText("Delete share?")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Cancel", hidden: true }));
      expect(deleteShare).not.toHaveBeenCalled();
    });
  });

  describe("actions menu gating", () => {
    it("hides the kebab entirely when the viewer can neither edit nor delete", async () => {
      const client = createMockStigmer({
        getByAgent: withShares(makeShare()),
        isAuthorized: false,
      });
      await renderList(client);

      // The row still renders; only its actions collapse away — an empty
      // overflow menu would be worse than no menu. The permission self-check
      // resolves asynchronously (optimistic-visible first), so wait for the
      // denial to land and the kebab to disappear.
      expect(screen.getByText("Support Agent")).toBeTruthy();
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull(),
      );
    });

    it("offers only Delete when the viewer can delete but not edit", async () => {
      const client = createMockStigmer({
        getByAgent: withShares(makeShare()),
        checkPermission: (relation) => relation === "can_delete",
      });
      await renderList(client);

      fireEvent.click(screen.getByRole("button", { name: /^Actions for/ }));
      expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Pause" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Reset link" })).toBeNull();
    });
  });

  it("shows an error state when the share list fails to load", async () => {
    const client = createMockStigmer({
      getByAgent: vi.fn().mockRejectedValue(new Error("backend unavailable")),
    });
    await renderList(client);

    expect(screen.getByText("Failed to load shares")).toBeTruthy();
  });
});
