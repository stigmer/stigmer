import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationSchema,
  ConversationControl,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ConversationListPane } from "../ConversationListPane";

const NOW = new Date("2026-08-07T12:00:00Z");

function whatsappChannel(id: string, name: string) {
  return create(AgentChannelSchema, {
    metadata: { id, org: "acme", name, slug: name },
    spec: { providerConfig: { case: "whatsapp", value: {} } },
  });
}

function slackChannel(id: string, name: string) {
  return create(AgentChannelSchema, {
    metadata: { id, org: "acme", name, slug: name },
    spec: { providerConfig: { case: "slack", value: {} } },
  });
}

function conversation(overrides: Record<string, unknown> = {}) {
  return create(ChannelConversationSchema, {
    agentChannelId: "ach_wa",
    conversationKey: "15550001111",
    org: "acme",
    lastActivityAt: timestampFromDate(new Date("2026-08-07T11:55:00Z")),
    ...overrides,
  });
}

function baseProps() {
  return {
    conversations: [] as never[],
    isLoading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    isLoadingMore: false,
    channels: [whatsappChannel("ach_wa", "support-line")],
    channelFilter: "",
    onChannelFilterChange: vi.fn(),
    selected: null,
    onSelect: vi.fn(),
    now: NOW,
  };
}

describe("ConversationListPane", () => {
  afterEach(() => cleanup());

  it("renders rows with the display name and relative activity", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[conversation({ displayName: "Pat" })]}
      />,
    );

    expect(screen.getByText("Pat")).toBeDefined();
    expect(screen.getByText("5m")).toBeDefined();
  });

  it("labels a nameless Slack conversation as a thread, never a raw timestamp", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        channels={[slackChannel("ach_sl", "eng-help")]}
        conversations={[
          conversation({ agentChannelId: "ach_sl", conversationKey: "1723012345.678900" }),
        ]}
      />,
    );

    expect(screen.getByText("Slack thread")).toBeDefined();
    expect(screen.queryByText("1723012345.678900")).toBeNull();
  });

  it("falls back to the phone number on WhatsApp — a real label", () => {
    render(
      <ConversationListPane {...baseProps()} conversations={[conversation()]} />,
    );
    expect(screen.getByText("15550001111")).toBeDefined();
  });

  it("keeps the number visible under a display name — and never twice (F-17)", () => {
    // A display name wins the row title, so the call-back path renders
    // as the muted sub-line. When the number IS the title (no display
    // name), no sub-line repeats it — pinned by the fallback test above
    // rendering exactly one occurrence.
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[conversation({ displayName: "Pat" })]}
      />,
    );

    expect(screen.getByText("Pat")).toBeDefined();
    expect(screen.getByText("15550001111")).toBeDefined();
  });

  it("shows no contact sub-line for Slack threads — a timestamp is not an address", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        channels={[slackChannel("ach_sl", "eng-help")]}
        conversations={[
          conversation({
            agentChannelId: "ach_sl",
            conversationKey: "1723012345.678900",
            displayName: "deploy question",
          }),
        ]}
      />,
    );

    expect(screen.getByText("deploy question")).toBeDefined();
    expect(screen.queryByText("1723012345.678900")).toBeNull();
  });

  it("badges attention with the escalating agent's reason", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[
          conversation({
            displayName: "Pat",
            needsAttention: true,
            attentionReason: "refund I cannot process",
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("Needs attention: refund I cannot process"),
    ).toBeDefined();
  });

  it("marks a human-held conversation", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[
          conversation({
            displayName: "Pat",
            control: ConversationControl.control_human,
            controlledBy: "idt_staff",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Human has the conversation")).toBeDefined();
  });

  it("selects a conversation on click and highlights the open one", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const open = conversation({ displayName: "Pat" });
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[open]}
        onSelect={onSelect}
        selected={{ agentChannelId: "ach_wa", conversationKey: "15550001111" }}
      />,
    );

    const row = screen.getByRole("button", { name: /Pat/ });
    expect(row.getAttribute("aria-current")).toBe("true");
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(open);
  });

  it("distinguishes no-channel-access from no-conversations-yet", () => {
    const { rerender } = render(
      <ConversationListPane {...baseProps()} channels={[]} />,
    );
    expect(screen.getByText("No channels to watch")).toBeDefined();

    rerender(<ConversationListPane {...baseProps()} />);
    expect(screen.getByText("No conversations yet")).toBeDefined();
  });

  it("shows the channel filter only when there is a choice to make", async () => {
    const user = userEvent.setup();
    const onChannelFilterChange = vi.fn();
    const { rerender } = render(
      <ConversationListPane {...baseProps()} onChannelFilterChange={onChannelFilterChange} />,
    );
    expect(screen.queryByLabelText("Filter by channel")).toBeNull();

    rerender(
      <ConversationListPane
        {...baseProps()}
        onChannelFilterChange={onChannelFilterChange}
        channels={[whatsappChannel("ach_wa", "support-line"), slackChannel("ach_sl", "eng-help")]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Filter by channel"), "ach_sl");
    expect(onChannelFilterChange).toHaveBeenCalledWith("ach_sl");
  });

  it("offers Show more exactly while more pages exist", async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[conversation()]}
        hasMore
        loadMore={loadMore}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(loadMore).toHaveBeenCalled();
  });

  it("surfaces a read failure verbatim", () => {
    render(
      <ConversationListPane {...baseProps()} error={new Error("unauthorized to list")} />,
    );
    expect(screen.getByText("unauthorized to list")).toBeDefined();
  });
});
