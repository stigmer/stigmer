import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { UpdateAgentSharingInput } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
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
  updateSharing?: (input: UpdateAgentSharingInput) => Promise<unknown>;
  getOrCreateBillingAccount?: (orgId: string) => Promise<unknown>;
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    agent: {
      updateSharing: overrides.updateSharing ?? vi.fn().mockResolvedValue({}),
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

function makeAgent(sharing?: {
  enabled?: boolean;
  allowedOrigins?: string[];
  messages?: {
    rateLimited?: string;
    unavailable?: string;
    conversationEnded?: string;
  };
}) {
  return {
    metadata: {
      id: "agt_1",
      org: "acme",
      slug: "support-agent",
      name: "Support Agent",
    },
    spec: { sharing },
  } as never;
}

const buildShareUrl = (org: string, slug: string) =>
  `https://app.example.com/chat/${org}/${slug}`;

describe("ShareAgentDialog", () => {
  it("mounts no body while closed (billing fetch stays lazy)", () => {
    const getOrCreateBillingAccount = vi.fn();
    render(
      <Providers client={createMockStigmer({ getOrCreateBillingAccount })}>
        <ShareAgentDialog
          open={false}
          onOpenChange={() => {}}
          agent={makeAgent()}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    expect(screen.queryByText("Share")).toBeNull();
    expect(getOrCreateBillingAccount).not.toHaveBeenCalled();
  });

  it("renders header, toggle, and the share link from buildShareUrl", () => {
    render(
      <Providers client={createMockStigmer()}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent({ enabled: true })}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    expect(screen.getByText("Share")).toBeTruthy();
    expect(screen.getByText("Support Agent")).toBeTruthy();
    expect(screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText("https://app.example.com/chat/acme/support-agent"),
    ).toBeTruthy();
  });

  it("falls back to the relative /chat path when buildShareUrl is omitted", () => {
    render(
      <Providers client={createMockStigmer()}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent({ enabled: true })}
        />
      </Providers>,
    );

    expect(screen.getByText("/chat/acme/support-agent")).toBeTruthy();
  });

  it("shows the indexability warning", () => {
    render(
      <Providers client={createMockStigmer()}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent({ enabled: true })}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    expect(
      screen.getByText(/forwarded and indexed by search engines/),
    ).toBeTruthy();
  });

  it("enabling sends the complete sharing block and notifies the host", async () => {
    const updateSharing = vi.fn().mockResolvedValue({});
    const onSharingChanged = vi.fn();
    render(
      <Providers client={createMockStigmer({ updateSharing })}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent({
            enabled: false,
            allowedOrigins: ["https://example.com"],
            messages: { rateLimited: "Easy there." },
          })}
          buildShareUrl={buildShareUrl}
          onSharingChanged={onSharingChanged}
        />
      </Providers>,
    );

    fireEvent.click(screen.getByRole("switch", { hidden: true }));

    await waitFor(() => expect(updateSharing).toHaveBeenCalledTimes(1));
    const input = updateSharing.mock.calls[0][0] as UpdateAgentSharingInput;
    expect(input.resourceId).toBe("agt_1");
    expect(input.sharing?.enabled).toBe(true);
    // The RPC replaces spec.sharing wholesale — the toggle must carry the
    // existing origins and messages or it would silently erase them.
    expect(input.sharing?.allowedOrigins).toEqual(["https://example.com"]);
    expect(input.sharing?.messages?.rateLimited).toBe("Easy there.");
    await waitFor(() => expect(onSharingChanged).toHaveBeenCalled());
  });

  it("adopts the server's returned sharing state after a commit", async () => {
    // Server echoes the update but with a normalized origin list.
    const updateSharing = vi.fn().mockResolvedValue(
      makeAgent({
        enabled: true,
        allowedOrigins: ["https://normalized.example.com"],
      }),
    );
    render(
      <Providers client={createMockStigmer({ updateSharing })}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent({ enabled: false })}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    fireEvent.click(screen.getByRole("switch", { hidden: true }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { hidden: true }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
    expect(screen.getByText("https://normalized.example.com")).toBeTruthy();
  });

  describe("Embed tab", () => {
    it("shows a working iframe snippet for the share URL", () => {
      render(
        <Providers client={createMockStigmer()}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({ enabled: true })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      expect(
        screen.getByText(
          /src="https:\/\/app\.example\.com\/chat\/acme\/support-agent"/,
        ),
      ).toBeTruthy();
    });

    it("rejects an invalid origin without calling the RPC", async () => {
      const updateSharing = vi.fn();
      render(
        <Providers client={createMockStigmer({ updateSharing })}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({ enabled: true })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      const input = screen.getByLabelText("Add allowed origin");
      fireEvent.change(input, {
        target: { value: "https://example.com/path" },
      });
      fireEvent.click(screen.getByText("Add"));

      expect(await screen.findByRole("alert", { hidden: true })).toBeTruthy();
      expect(updateSharing).not.toHaveBeenCalled();
    });

    it("adds a valid origin by committing the appended list", async () => {
      const updateSharing = vi.fn().mockResolvedValue({});
      render(
        <Providers client={createMockStigmer({ updateSharing })}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({
              enabled: true,
              allowedOrigins: ["https://existing.example.com"],
            })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      fireEvent.change(screen.getByLabelText("Add allowed origin"), {
        target: { value: "https://new.example.com" },
      });
      fireEvent.click(screen.getByText("Add"));

      await waitFor(() => expect(updateSharing).toHaveBeenCalledTimes(1));
      const input = updateSharing.mock.calls[0][0] as UpdateAgentSharingInput;
      expect(input.sharing?.allowedOrigins).toEqual([
        "https://existing.example.com",
        "https://new.example.com",
      ]);
      // Enabled state rides along untouched.
      expect(input.sharing?.enabled).toBe(true);
    });

    it("rejects a duplicate origin", async () => {
      const updateSharing = vi.fn();
      render(
        <Providers client={createMockStigmer({ updateSharing })}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({
              enabled: true,
              allowedOrigins: ["https://example.com"],
            })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      fireEvent.change(screen.getByLabelText("Add allowed origin"), {
        target: { value: "https://example.com" },
      });
      fireEvent.click(screen.getByText("Add"));

      expect(await screen.findByRole("alert", { hidden: true })).toBeTruthy();
      expect(updateSharing).not.toHaveBeenCalled();
    });

    it("removes an origin by committing the filtered list", async () => {
      const updateSharing = vi.fn().mockResolvedValue({});
      render(
        <Providers client={createMockStigmer({ updateSharing })}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({
              enabled: true,
              allowedOrigins: ["https://a.example.com", "https://b.example.com"],
            })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      fireEvent.click(screen.getByRole("tab", { name: /Embed/, hidden: true }));
      fireEvent.click(screen.getByLabelText("Remove https://a.example.com"));

      await waitFor(() => expect(updateSharing).toHaveBeenCalledTimes(1));
      const input = updateSharing.mock.calls[0][0] as UpdateAgentSharingInput;
      expect(input.sharing?.allowedOrigins).toEqual(["https://b.example.com"]);
    });
  });

  describe("visitor messages", () => {
    it("saves edited messages as part of the complete block", async () => {
      const updateSharing = vi.fn().mockResolvedValue({});
      render(
        <Providers client={createMockStigmer({ updateSharing })}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({
              enabled: true,
              allowedOrigins: ["https://example.com"],
            })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      fireEvent.click(screen.getByText("Customize visitor messages"));
      fireEvent.change(screen.getByLabelText(/Rate limited/), {
        target: { value: "Please slow down." },
      });
      fireEvent.click(screen.getByText("Save messages"));

      await waitFor(() => expect(updateSharing).toHaveBeenCalledTimes(1));
      const input = updateSharing.mock.calls[0][0] as UpdateAgentSharingInput;
      expect(input.sharing?.messages?.rateLimited).toBe("Please slow down.");
      expect(input.sharing?.enabled).toBe(true);
      expect(input.sharing?.allowedOrigins).toEqual(["https://example.com"]);
    });

    it("caps each message at 300 characters", () => {
      render(
        <Providers client={createMockStigmer()}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({ enabled: true })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

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
      render(
        <Providers
          client={createMockStigmer({ getOrCreateBillingAccount })}
          mode="cloud"
        >
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({ enabled: true })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByText(/\$12\.50 available/)).toBeTruthy(),
      );
      expect(getOrCreateBillingAccount).toHaveBeenCalledWith("acme");
    });

    it("degrades to the who-pays line alone in local mode (no billing fetch)", () => {
      const getOrCreateBillingAccount = vi.fn();
      render(
        <Providers
          client={createMockStigmer({ getOrCreateBillingAccount })}
          mode="local"
        >
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({ enabled: true })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      expect(screen.queryByText(/available/)).toBeNull();
      expect(getOrCreateBillingAccount).not.toHaveBeenCalled();
    });

    it("degrades silently when the billing fetch fails", async () => {
      const getOrCreateBillingAccount = vi
        .fn()
        .mockRejectedValue(new Error("billing unavailable"));
      render(
        <Providers
          client={createMockStigmer({ getOrCreateBillingAccount })}
          mode="cloud"
        >
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({ enabled: true })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      await waitFor(() => expect(getOrCreateBillingAccount).toHaveBeenCalled());
      expect(screen.getByText(/Visitors chat on/)).toBeTruthy();
      expect(screen.queryByText(/available/)).toBeNull();
      expect(screen.queryByText(/billing unavailable/)).toBeNull();
    });
  });

  describe("Developer tab", () => {
    it("shows the platform client snippet and docs link", () => {
      render(
        <Providers client={createMockStigmer()}>
          <ShareAgentDialog
            open
            onOpenChange={() => {}}
            agent={makeAgent({ enabled: true })}
            buildShareUrl={buildShareUrl}
          />
        </Providers>,
      );

      fireEvent.click(screen.getByRole("tab", { name: /Developer/, hidden: true }));
      expect(screen.getByText(/createPlatformClientAuth/)).toBeTruthy();
      const link = screen.getByText(/platform client guide/);
      expect(link.getAttribute("href")).toContain("platform-client");
    });
  });

  it("renders in-flow without showModal when modal is false", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(
      <Providers client={createMockStigmer()}>
        <ShareAgentDialog
          open
          onOpenChange={() => {}}
          agent={makeAgent({ enabled: true })}
          buildShareUrl={buildShareUrl}
          modal={false}
        />
      </Providers>,
    );

    expect(screen.getByText("Share")).toBeTruthy();
    expect(showModal).not.toHaveBeenCalled();
    showModal.mockRestore();
  });

  it("requests close via Done and the close affordance", () => {
    const onOpenChange = vi.fn();
    render(
      <Providers client={createMockStigmer()}>
        <ShareAgentDialog
          open
          onOpenChange={onOpenChange}
          agent={makeAgent({ enabled: true })}
          buildShareUrl={buildShareUrl}
        />
      </Providers>,
    );

    screen.getByText("Done").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    screen.getByLabelText("Close").click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
