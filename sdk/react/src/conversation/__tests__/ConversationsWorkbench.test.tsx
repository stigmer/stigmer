import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
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
    spec: { providerConfig: { case: "whatsapp", value: {} } },
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
    expect(screen.getByText("15550001111 · support-line")).toBeDefined();
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
