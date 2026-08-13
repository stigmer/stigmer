import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationListFilter,
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

  it("uses the house tooltip for the attention badge and awaiting dot, no native titles anywhere (F-18)", () => {
    const { container } = render(
      <ConversationListPane
        {...baseProps()}
        conversations={[
          conversation({
            displayName: "Pat with a very long name that will truncate",
            needsAttention: true,
            attentionReason: "refund I cannot process",
            // The awaiting dot renders too, so its tooltip trigger is
            // under the same no-title / no-tab-stop assertions below.
            awaitingReply: true,
          }),
        ]}
      />,
    );

    // The truncation title on the row label is deliberately dropped
    // (the full name renders in the open conversation's header), and
    // the badge's reason moved to the house tooltip — so NO native
    // title remains on the pane.
    expect(container.querySelector("[title]")).toBeNull();
    // The badge keeps its screen-reader name.
    expect(
      screen.getByText("Needs attention: refund I cannot process"),
    ).toBeDefined();
    // The tooltip trigger must not nest a button inside the row button
    // or add a tab stop.
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0);
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

  it("marks an awaiting conversation strongly when a human holds it — the agent will not answer (DD-011 D-a, F-13)", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[
          conversation({
            awaitingReply: true,
            control: ConversationControl.control_human,
          }),
        ]}
      />,
    );

    // The copy names the stake, not just the fact (cloud#266): a
    // human-held wait is one only a person can end.
    expect(
      screen.getByText(
        "Customer awaiting reply — a human has this conversation; the agent will not answer",
      ),
    ).toBeDefined();
  });

  it("marks an awaiting agent-held conversation mutedly — the agent is about to answer", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[conversation({ awaitingReply: true })]}
      />,
    );

    expect(
      screen.getByText("Customer awaiting reply — the agent has this conversation"),
    ).toBeDefined();
    expect(
      screen.queryByText(
        "Customer awaiting reply — a human has this conversation; the agent will not answer",
      ),
    ).toBeNull();
  });

  it("shows no awaiting indicator once the customer is answered", () => {
    render(
      <ConversationListPane {...baseProps()} conversations={[conversation()]} />,
    );

    expect(screen.queryByText(/Customer awaiting reply/)).toBeNull();
  });

  it("offers the wants-human filter as a radio group and reports the choice", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[conversation()]}
        onFilterChange={onFilterChange}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Conversation filter" });
    expect(group).toBeDefined();
    expect(
      screen.getByRole("radio", { name: "All conversations", checked: true }),
    ).toBeDefined();

    await user.click(
      screen.getByRole("radio", {
        name: "Conversations where a human action is wanted",
      }),
    );

    expect(onFilterChange).toHaveBeenCalledWith(
      ChannelConversationListFilter.filter_wants_human,
    );
  });

  it("moves selection with arrow keys — the ScopeToggle radiogroup contract", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(
      <ConversationListPane
        {...baseProps()}
        conversations={[conversation()]}
        onFilterChange={onFilterChange}
      />,
    );

    screen.getByRole("radio", { name: "All conversations" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onFilterChange).toHaveBeenCalledWith(
      ChannelConversationListFilter.filter_wants_human,
    );
  });

  it("renders no filter control when the host does not wire it — a dead toggle would lie", () => {
    render(
      <ConversationListPane {...baseProps()} conversations={[conversation()]} />,
    );

    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("tells the truth when the filtered list is empty — never 'No conversations yet' over a full inbox", () => {
    render(
      <ConversationListPane
        {...baseProps()}
        filter={ChannelConversationListFilter.filter_wants_human}
        onFilterChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Nothing needs a human right now")).toBeDefined();
    expect(screen.queryByText("No conversations yet")).toBeNull();
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
