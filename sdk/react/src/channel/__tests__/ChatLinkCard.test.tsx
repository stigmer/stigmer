// ChatLinkCard: one chat link's card in an agent's Channels tab. Pins what
// the card shows (its path, audience and Active or Paused, an omitted
// audience read as the organization's), what its copy button copies (the
// tokened URL on a public link, the clean URL on an organization link, the
// relative /chat/<channel id> when the host builds no URL), that its switch
// changes `spec.enabled` alone on the card's own channel, that Reset link
// rotates the card's own channel and only on a public link, and that the
// switch and menu follow the viewer's permissions. The list around it, its
// count, empty state, create, edit and delete flows, is pinned in
// ChannelsPanel.test.tsx.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { toast } from "../../feedback/toast";
import { ChatLinkCard, type ChatLinkCardProps } from "../ChatLinkCard";

// Toasts are visual feedback owned by the feedback module; keep them inert.
vi.mock("../../feedback/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
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
  update?: (resource: Channel, paths: string[]) => Promise<unknown>;
  rotateLink?: (input: unknown) => Promise<unknown>;
  /** Per-relation authorization; every relation is allowed when omitted. */
  checkPermission?: (relation: string) => boolean;
}

function createMockStigmer(overrides: MockOverrides = {}) {
  return {
    channel: {
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
      rotateLink: overrides.rotateLink ?? vi.fn().mockResolvedValue({}),
    },
    grant: {
      checkMyPermission: vi
        .fn()
        .mockImplementation((input: { relation: string }) =>
          Promise.resolve({
            isAuthorized: overrides.checkPermission
              ? overrides.checkPermission(input.relation)
              : true,
          }),
        ),
    },
  } as never;
}

function Providers({ client, children }: { client: unknown; children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

function makeChatLink(overrides?: {
  id?: string;
  name?: string;
  enabled?: boolean;
  audience?: ChannelAudience;
  allowedOrigins?: string[];
  linkToken?: string;
}): Channel {
  return {
    metadata: {
      id: overrides?.id ?? "ash_1",
      org: "acme",
      slug: "support-agent",
      name: overrides?.name ?? "Support Agent",
    },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: overrides?.enabled ?? true,
      type: {
        case: "web",
        value: {
          // A public link unless the case says otherwise; `audience: undefined`
          // leaves it unset, the omitted case.
          ...(overrides !== undefined && "audience" in overrides
            ? overrides.audience !== undefined && { audience: overrides.audience }
            : { audience: ChannelAudience.public }),
          ...(overrides?.allowedOrigins && { allowedOrigins: overrides.allowedOrigins }),
        },
      },
    },
    ...(overrides?.linkToken !== undefined
      ? { status: { typeStatus: { case: "web", value: { linkToken: overrides.linkToken } } } }
      : {}),
  } as unknown as Channel;
}

// A link names the channel by its id alone — never its organization or slug.
const buildChatLinkUrl = (channelId: string) =>
  `https://app.example.com/chat/${channelId}`;

function renderCard(
  client: unknown,
  channel: Channel,
  props: Partial<Omit<ChatLinkCardProps, "channel">> = {},
) {
  const handlers = {
    onEditClick: vi.fn(),
    onDeleteClick: vi.fn(),
    refetch: vi.fn(),
  };
  render(
    <Providers client={client}>
      <ChatLinkCard
        channel={channel}
        buildChatLinkUrl={buildChatLinkUrl}
        {...handlers}
        {...props}
      />
    </Providers>,
  );
  return handlers;
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("ChatLinkCard", () => {
  it("shows a public link's path, audience and Active state in the chat-link frame", () => {
    renderCard(createMockStigmer(), makeChatLink({ linkToken: "tok123" }));

    expect(screen.getByRole("group", { name: "Chat link: Support Agent" })).toBeTruthy();
    // The bare path: the token is a secret, not an address.
    expect(screen.getByText("/chat/ash_1")).toBeTruthy();
    expect(screen.queryByText(/tok123/)).toBeNull();
    expect(screen.getByText("Anyone with the link")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("shows an organization link's audience and a paused link's state", () => {
    renderCard(
      createMockStigmer(),
      makeChatLink({ id: "ash_2", name: "Help Desk", enabled: false, audience: ChannelAudience.org }),
    );

    expect(screen.getByText("/chat/ash_2")).toBeTruthy();
    expect(screen.getByText("Organization members")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("reads a link with no audience as the organization's, never public", () => {
    renderCard(createMockStigmer(), makeChatLink({ audience: undefined }));

    expect(screen.getByText("Organization members")).toBeTruthy();
    expect(screen.queryByText("Anyone with the link")).toBeNull();
  });

  describe("copy", () => {
    it("copies the tokened URL for a public link", async () => {
      const writeText = stubClipboard();
      renderCard(createMockStigmer(), makeChatLink({ linkToken: "tok123" }));

      fireEvent.click(screen.getByRole("button", { name: "Copy link for Support Agent" }));
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith("https://app.example.com/chat/ash_1?k=tok123"),
      );
    });

    it("copies the clean URL for an organization link", async () => {
      const writeText = stubClipboard();
      renderCard(
        createMockStigmer(),
        makeChatLink({ id: "ash_2", name: "Internal", audience: ChannelAudience.org, linkToken: "tok456" }),
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy link for Internal" }));
      // Org access is gated by membership, not the token — the member link
      // stays clean.
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith("https://app.example.com/chat/ash_2"),
      );
    });

    it("falls back to the relative /chat/<channel id> link when the host builds no URL", async () => {
      const writeText = stubClipboard();
      renderCard(createMockStigmer(), makeChatLink({ linkToken: "tok123" }), {
        buildChatLinkUrl: undefined,
      });

      fireEvent.click(screen.getByRole("button", { name: "Copy link for Support Agent" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("/chat/ash_1?k=tok123"));
    });
  });

  describe("the on/off switch", () => {
    it("pauses by naming spec.enabled alone, on the channel's id", async () => {
      const update = vi.fn().mockResolvedValue({});
      const handlers = renderCard(
        createMockStigmer({ update }),
        makeChatLink({ allowedOrigins: ["https://example.com"] }),
      );

      const toggle = screen.getByRole("switch", { name: "Turn Support Agent off" });
      fireEvent.click(toggle);

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = sentUpdate<Channel>(update);
      expect(sent.resource.spec?.enabled).toBe(false);
      // The flag alone: the origins and every other field keep their
      // stored values without being sent back.
      expect(sent.paths).toEqual(["spec.enabled"]);
      // Addressed by the card's own id — never a new channel.
      expect(sent.id).toBe("ash_1");
      await waitFor(() => expect(handlers.refetch).toHaveBeenCalledTimes(1));
      expect(toast.success).toHaveBeenCalledWith("Chat link paused");
    });

    it("resumes a paused link", async () => {
      const update = vi.fn().mockResolvedValue({});
      renderCard(createMockStigmer({ update }), makeChatLink({ enabled: false }));

      fireEvent.click(screen.getByRole("switch", { name: "Turn Support Agent on" }));

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(sentUpdate<Channel>(update).resource.spec?.enabled).toBe(true);
      expect(toast.success).toHaveBeenCalledWith("Chat link resumed");
    });
  });

  describe("the menu", () => {
    it("opens the editor and asks to delete through the panel's handlers", async () => {
      const handlers = renderCard(createMockStigmer(), makeChatLink());

      await openMenu(screen.getByRole("button", { name: "Actions for Support Agent" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
      expect(handlers.onEditClick).toHaveBeenCalledTimes(1);

      await openMenu(screen.getByRole("button", { name: "Actions for Support Agent" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(handlers.onDeleteClick).toHaveBeenCalledTimes(1);
    });

    it("Reset link rotates the card's own channel", async () => {
      const rotateLink = vi.fn().mockResolvedValue(makeChatLink());
      const handlers = renderCard(createMockStigmer({ rotateLink }), makeChatLink());

      await openMenu(screen.getByRole("button", { name: "Actions for Support Agent" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Reset link" }));

      await waitFor(() => expect(rotateLink).toHaveBeenCalledTimes(1));
      expect((rotateLink.mock.calls[0]![0] as { resourceId: string }).resourceId).toBe("ash_1");
      await waitFor(() => expect(handlers.refetch).toHaveBeenCalledTimes(1));
    });

    it("does not offer Reset link on an organization link (membership gates access, not the token)", async () => {
      renderCard(createMockStigmer(), makeChatLink({ audience: ChannelAudience.org }));

      await openMenu(screen.getByRole("button", { name: "Actions for Support Agent" }));
      expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Reset link" })).toBeNull();
    });
  });

  describe("permissions", () => {
    it("hides the switch and the menu entirely when the viewer can neither edit nor delete", async () => {
      renderCard(createMockStigmer({ checkPermission: () => false }), makeChatLink());

      // The card still renders; only its controls collapse away — an empty
      // menu would be worse than none. The permission self-check resolves
      // asynchronously (optimistic-visible first), so wait for the denial.
      expect(screen.getByText("Support Agent")).toBeTruthy();
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull(),
      );
      expect(screen.queryByRole("switch")).toBeNull();
      // Copying needs no permission beyond seeing the card.
      expect(screen.getByRole("button", { name: "Copy link for Support Agent" })).toBeTruthy();
    });

    it("offers only Delete, and no switch, when the viewer can delete but not edit", async () => {
      renderCard(
        createMockStigmer({ checkPermission: (relation) => relation === "can_delete" }),
        makeChatLink(),
      );

      await waitFor(() => expect(screen.queryByRole("switch")).toBeNull());
      await openMenu(screen.getByRole("button", { name: /^Actions for/ }));
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Reset link" })).toBeNull();
    });
  });
});
