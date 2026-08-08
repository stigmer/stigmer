import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationListFilter,
  ChannelConversationSchema,
  ConversationControl,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import {
  ChannelSendOutcome,
  SendChannelMessageOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { advanceInSlices } from "../../internal/__tests__/fake-timer-slices";
import { ConversationsWorkbench } from "../ConversationsWorkbench";

const SELECTED = { agentChannelId: "ach_wa", conversationKey: "15550001111" };

function whatsappChannel() {
  return create(AgentChannelSchema, {
    metadata: { id: "ach_wa", org: "acme", name: "support-line", slug: "support-line" },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      providerConfig: { case: "whatsapp", value: {} },
    },
  });
}

function slackChannel() {
  return create(AgentChannelSchema, {
    metadata: { id: "ach_sl", org: "acme", name: "eng-help", slug: "eng-help" },
    spec: { providerConfig: { case: "slack", value: {} } },
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return create(ChannelConversationSchema, {
    ...SELECTED,
    org: "acme",
    displayName: "Pat",
    control: ConversationControl.control_agent,
    lastActivityAt: timestampFromDate(new Date("2026-08-07T11:00:00Z")),
    ...overrides,
  });
}

function customerItem(id: string, text: string) {
  return create(ConversationTimelineItemSchema, {
    itemId: id,
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_customer,
    text,
    at: timestampFromDate(new Date("2026-08-07T10:00:00Z")),
  });
}

function publicItem(
  id: string,
  author: ConversationItemAuthor,
  iso: string,
  text: string,
) {
  return create(ConversationTimelineItemSchema, {
    itemId: id,
    lane: ConversationLane.lane_public,
    author,
    text,
    at: timestampFromDate(new Date(iso)),
  });
}

function createMockStigmer(overrides: Record<string, unknown> = {}) {
  return {
    agentChannel: {
      list: vi.fn().mockResolvedValue({ items: [whatsappChannel()], totalCount: 1 }),
      listConversations: vi.fn().mockResolvedValue({ items: [row()], totalCount: 1 }),
      getConversation: vi.fn().mockResolvedValue(row()),
      getTimeline: vi.fn().mockResolvedValue({
        items: [customerItem("wa:1", "where is my order?")],
        nextPageToken: "",
      }),
      reply: vi.fn().mockResolvedValue(
        create(SendChannelMessageOutputSchema, {
          outcome: ChannelSendOutcome.accepted,
          outboundMessageId: "obm_1",
        }),
      ),
      takeOver: vi
        .fn()
        .mockResolvedValue(row({ control: ConversationControl.control_human, controlledBy: "idt_winner" })),
      handBack: vi.fn().mockResolvedValue(row()),
      clearAttention: vi.fn().mockResolvedValue(row()),
      ...overrides,
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("ConversationsWorkbench", () => {
  afterEach(() => cleanup());

  it("renders the inbox and prompts for a selection", async () => {
    render(
      <ConversationsWorkbench org="acme" selected={null} onSelectionChange={vi.fn()} />,
      { wrapper: wrapper(createMockStigmer()) },
    );

    await waitFor(() => expect(screen.getByText("Pat")).toBeDefined());
    expect(screen.getByText("Select a conversation")).toBeDefined();
  });

  it("opens a conversation: row, timeline, banners, and composer wire together", async () => {
    const client = createMockStigmer();
    render(
      <ConversationsWorkbench
        org="acme"
        selected={SELECTED}
        onSelectionChange={vi.fn()}
      />,
      { wrapper: wrapper(client) },
    );

    await waitFor(() =>
      expect(screen.getByText("where is my order?")).toBeDefined(),
    );
    expect(screen.getByText("The agent is serving this conversation.")).toBeDefined();
    expect(screen.getByLabelText("Reply to the customer")).toBeDefined();
    // The header keeps the call-back path visible: the display name wins
    // the title, so the WhatsApp number renders in the sub-line beside
    // the channel name (F-17).
    expect(screen.getByRole("heading", { name: "Pat" })).toBeDefined();
    // Matched on the sub-line's full text content: the contact and the
    // channel name render as separate nodes (the channel name can be a
    // link, F-11) but read as one line.
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === "15550001111 · support-line",
      ),
    ).toBeDefined();
    const agentChannel = (client as { agentChannel: Record<string, ReturnType<typeof vi.fn>> })
      .agentChannel;
    expect(agentChannel.getConversation).toHaveBeenCalledWith(
      expect.objectContaining(SELECTED),
    );
  });

  it("adopts the takeover answer immediately — including a lost race's winner", async () => {
    const user = userEvent.setup();
    render(
      <ConversationsWorkbench
        org="acme"
        selected={SELECTED}
        onSelectionChange={vi.fn()}
        currentIdentityAccountId="idt_me"
      />,
      { wrapper: wrapper(createMockStigmer()) },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take over" })).toBeDefined(),
    );

    await user.click(screen.getByRole("button", { name: "Take over" }));

    // The server answered with idt_winner holding it — the banner tells
    // that truth instead of assuming the caller's transition won.
    await waitFor(() =>
      expect(screen.getByText(/A teammate has this conversation/)).toBeDefined(),
    );
  });

  it("reflects a takeover in the inbox row the instant the command answers (DD-012 D-a)", async () => {
    const user = userEvent.setup();
    // The retiring head fetch (applyServerState's round-trip) is PARKED:
    // the row's new state must come from the seam alone — no list answer,
    // no poll tick. This is the F-06 complaint pinned at the composed
    // level: your own takeover may never lag the inbox.
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [row()], totalCount: 1 })
      .mockReturnValue(new Promise(() => {}));
    render(
      <ConversationsWorkbench
        org="acme"
        selected={SELECTED}
        onSelectionChange={vi.fn()}
        currentIdentityAccountId="idt_me"
      />,
      { wrapper: wrapper(createMockStigmer({ listConversations })) },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take over" })).toBeDefined(),
    );
    expect(screen.queryByText("Human has the conversation")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Take over" }));

    await waitFor(() =>
      expect(screen.getByText("Human has the conversation")).toBeDefined(),
    );
  });

  it("threads the wants-human filter to the server — never a client-side sieve (DD-011 D-g)", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer();
    render(
      <ConversationsWorkbench org="acme" selected={null} onSelectionChange={vi.fn()} />,
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(screen.getByText("Pat")).toBeDefined());

    await user.click(
      screen.getByRole("radio", {
        name: "Conversations where a human action is wanted",
      }),
    );

    const agentChannel = (client as {
      agentChannel: Record<string, ReturnType<typeof vi.fn>>;
    }).agentChannel;
    await waitFor(() =>
      expect(agentChannel.listConversations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filter: ChannelConversationListFilter.filter_wants_human,
        }),
      ),
    );
  });

  it("refetches the timeline after a reply so the real ledger item renders", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer();
    render(
      <ConversationsWorkbench
        org="acme"
        selected={SELECTED}
        onSelectionChange={vi.fn()}
      />,
      { wrapper: wrapper(client) },
    );
    const input = await screen.findByLabelText("Reply to the customer");
    const agentChannel = (client as { agentChannel: Record<string, ReturnType<typeof vi.fn>> })
      .agentChannel;
    const timelineCallsBefore = agentChannel.getTimeline.mock.calls.length;

    await user.type(input, "on my way{Enter}");

    expect(agentChannel.reply).toHaveBeenCalled();
    await waitFor(() =>
      expect(agentChannel.getTimeline.mock.calls.length).toBeGreaterThan(
        timelineCallsBefore,
      ),
    );
  });

  it("links the header's channel name to the host's channel page (F-11)", async () => {
    render(
      <ConversationsWorkbench
        org="acme"
        selected={SELECTED}
        onSelectionChange={vi.fn()}
        channelHref={(channel) =>
          channel.spec?.agentRef
            ? `/library/agents/${channel.spec.agentRef.org}/${channel.spec.agentRef.slug}?tab=channels`
            : null
        }
      />,
      { wrapper: wrapper(createMockStigmer()) },
    );

    const link = await screen.findByRole("link", { name: "support-line" });
    expect(link.getAttribute("href")).toBe(
      "/library/agents/acme/support-agent?tab=channels",
    );
  });

  it("keeps the channel name plain text when the host provides no channel route (F-11)", async () => {
    render(
      <ConversationsWorkbench org="acme" selected={SELECTED} onSelectionChange={vi.fn()} />,
      { wrapper: wrapper(createMockStigmer()) },
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          (_, el) => el?.tagName === "P" && el.textContent === "15550001111 · support-line",
        ),
      ).toBeDefined(),
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("hands the selected channel to a function-form headerAccessory (F-11)", async () => {
    render(
      <ConversationsWorkbench
        org="acme"
        selected={SELECTED}
        onSelectionChange={vi.fn()}
        headerAccessory={({ channel }) => (
          <span>accessory for {channel?.metadata?.name ?? "nobody"}</span>
        )}
      />,
      { wrapper: wrapper(createMockStigmer()) },
    );

    // The context carries the loaded channel, so a host can scope its
    // access affordance ("Channel access" + the channel's name) without
    // re-fetching what the workbench already holds.
    await waitFor(() =>
      expect(screen.getByText("accessory for support-line")).toBeDefined(),
    );
  });

  it("keeps the composer busy after a reply until the sent item is on screen (F-05)", async () => {
    const user = userEvent.setup();
    const initialItems = [customerItem("wa:1", "where is my order?")];
    let releaseRefetch!: (page: {
      items: readonly unknown[];
      nextPageToken: string;
    }) => void;
    const getTimeline = vi
      .fn()
      // Initial load, then the post-reply refetch held open under test
      // control, then a default for any later poll tick.
      .mockResolvedValueOnce({ items: initialItems, nextPageToken: "" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRefetch = resolve;
          }),
      )
      .mockResolvedValue({ items: initialItems, nextPageToken: "" });
    const client = createMockStigmer({ getTimeline });
    render(
      <ConversationsWorkbench org="acme" selected={SELECTED} onSelectionChange={vi.fn()} />,
      { wrapper: wrapper(client) },
    );
    const input = await screen.findByLabelText("Reply to the customer");

    await user.type(input, "on my way{Enter}");

    // The post-reply refetch firing proves the reply COMMAND fully
    // settled; flush its state commits. The reply's ledger item is
    // still in flight, so the composer must STILL be busy — an idle
    // button over an emptied box with the message nowhere on screen is
    // exactly the F-05 dead interval.
    await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const sendButton = screen.getByRole("button", { name: "Send reply" });
    expect(sendButton.textContent).toContain("Sending…");
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);

    // The refetch answers with the real ledger item (ob:<id>, the id
    // the reply output promised) — busy clears only now.
    releaseRefetch({
      items: [
        publicItem(
          "ob:obm_1",
          ConversationItemAuthor.author_teammate,
          "2026-08-07T10:06:00Z",
          "on my way",
        ),
        ...initialItems,
      ],
      nextPageToken: "",
    });
    await waitFor(() => expect(screen.getByText("on my way")).toBeDefined());
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Send reply" });
      expect(btn.textContent).not.toContain("Sending…");
    });
  });

  it("frees the composer immediately on a refused reply — the draft needs editing, not a wait (F-05)", async () => {
    const user = userEvent.setup();
    const client = createMockStigmer({
      reply: vi.fn().mockResolvedValue(
        create(SendChannelMessageOutputSchema, {
          outcome: ChannelSendOutcome.refused,
          detail: "the 24-hour service window is closed",
        }),
      ),
    });
    render(
      <ConversationsWorkbench org="acme" selected={SELECTED} onSelectionChange={vi.fn()} />,
      { wrapper: wrapper(client) },
    );
    const input = await screen.findByLabelText("Reply to the customer");

    await user.type(input, "did this arrive?{Enter}");

    await waitFor(() =>
      expect(screen.getByText("the 24-hour service window is closed")).toBeDefined(),
    );
    // Refusal restores the draft for editing — holding the composer
    // busy would fight the correction the notice is asking for.
    expect((input as HTMLTextAreaElement).value).toBe("did this arrive?");
    const sendButton = screen.getByRole("button", { name: "Send reply" });
    expect(sendButton.textContent).not.toContain("Sending…");
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("arms the handback confirm from a customer message that arrives on a poll tick (F-16, DD-007 D-e)", async () => {
    // The composed guard path: timeline poll → head upsert →
    // unansweredCustomer → confirm. The banner-level guard is pinned in
    // ConversationControlBanner.test.tsx; what production exposed (and a
    // starved poll would break again) is the message ARRIVING here at
    // all — so this test delivers the unanswered message via a later
    // poll tick, never via the initial load.
    vi.useFakeTimers();
    try {
      const answered = [
        publicItem(
          "dl:2",
          ConversationItemAuthor.author_agent,
          "2026-08-07T10:01:00Z",
          "We are open 6am to 10pm.",
        ),
        publicItem(
          "wa:1",
          ConversationItemAuthor.author_customer,
          "2026-08-07T10:00:00Z",
          "When are you open?",
        ),
      ];
      const getTimeline = vi
        .fn()
        .mockResolvedValue({ items: answered, nextPageToken: "" });
      const client = createMockStigmer({
        getConversation: vi.fn().mockResolvedValue(
          row({ control: ConversationControl.control_human, controlledBy: "idt_me" }),
        ),
        getTimeline,
      });
      render(
        <ConversationsWorkbench
          org="acme"
          selected={SELECTED}
          onSelectionChange={vi.fn()}
          currentIdentityAccountId="idt_me"
        />,
        { wrapper: wrapper(client) },
      );

      // Flush the initial load: human-held, newest item answered.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        screen.getByRole("button", { name: "Hand back to agent" }),
      ).toBeDefined();
      const callsBeforePoll = getTimeline.mock.calls.length;

      // The customer writes again; the next poll tick delivers it.
      getTimeline.mockResolvedValue({
        items: [
          publicItem(
            "wa:3",
            ConversationItemAuthor.author_customer,
            "2026-08-07T10:05:00Z",
            "And on Sundays?",
          ),
          ...answered,
        ],
        nextPageToken: "",
      });
      await advanceInSlices(5000);
      expect(getTimeline.mock.calls.length).toBeGreaterThan(callsBeforePoll);
      expect(screen.getByText("And on Sundays?")).toBeDefined();

      // The polled-in unanswered message must arm the confirm guard.
      // fireEvent, not userEvent: userEvent's inter-event waits hang
      // under fake timers, and pointer realism adds nothing here — the
      // confirm's interaction contract is pinned with real userEvent in
      // ConversationControlBanner.test.tsx.
      fireEvent.click(screen.getByRole("button", { name: "Hand back to agent" }));
      expect(
        screen.getByText(/The customer's last message has no reply/),
      ).toBeDefined();
      const agentChannel = (client as {
        agentChannel: Record<string, ReturnType<typeof vi.fn>>;
      }).agentChannel;
      expect(agentChannel.handBack).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the composer draft when switching conversations (F-22)", async () => {
    // The detail column is keyed by conversation identity (DD-014), so a
    // switch REMOUNTS it — a half-typed reply to customer A must never
    // sit in the box one Enter away from being sent to customer B. This
    // is the remount's observable contract: remove the key and this
    // fails.
    const user = userEvent.setup();
    const other = { agentChannelId: "ach_wa", conversationKey: "15550009999" };
    const client = createMockStigmer({
      listConversations: vi.fn().mockResolvedValue({
        items: [row(), row({ conversationKey: other.conversationKey, displayName: "Sam" })],
        totalCount: 2,
      }),
    });
    const { rerender } = render(
      <ConversationsWorkbench org="acme" selected={SELECTED} onSelectionChange={vi.fn()} />,
      { wrapper: wrapper(client) },
    );
    const input = await screen.findByLabelText("Reply to the customer");

    await user.type(input, "half-typed reply meant for Pat");
    expect((input as HTMLTextAreaElement).value).toBe("half-typed reply meant for Pat");

    rerender(
      <ConversationsWorkbench org="acme" selected={other} onSelectionChange={vi.fn()} />,
    );

    const freshInput = await screen.findByLabelText("Reply to the customer");
    expect((freshInput as HTMLTextAreaElement).value).toBe("");
  });

  it("disables the composer on Slack with the honest reason", async () => {
    const client = createMockStigmer({
      list: vi.fn().mockResolvedValue({ items: [slackChannel()], totalCount: 1 }),
      listConversations: vi.fn().mockResolvedValue({
        items: [row({ agentChannelId: "ach_sl", conversationKey: "1723012345.678900" })],
        totalCount: 1,
      }),
      getConversation: vi
        .fn()
        .mockResolvedValue(row({ agentChannelId: "ach_sl", conversationKey: "1723012345.678900" })),
      getTimeline: vi.fn().mockResolvedValue({ items: [], nextPageToken: "" }),
    });
    render(
      <ConversationsWorkbench
        org="acme"
        selected={{ agentChannelId: "ach_sl", conversationKey: "1723012345.678900" }}
        onSelectionChange={vi.fn()}
      />,
      { wrapper: wrapper(client) },
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Staff replies aren't available on Slack channels yet/),
      ).toBeDefined(),
    );
    expect(screen.queryByLabelText("Reply to the customer")).toBeNull();
  });
});
