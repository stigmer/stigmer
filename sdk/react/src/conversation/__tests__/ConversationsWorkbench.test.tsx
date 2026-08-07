import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
