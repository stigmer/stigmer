import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import { ConversationTimelineView } from "../ConversationTimelineView";

const NOW = new Date("2026-08-07T12:00:00Z");

function item(id: string, fields: Record<string, unknown> = {}) {
  return create(ConversationTimelineItemSchema, {
    itemId: id,
    lane: ConversationLane.lane_public,
    at: timestampFromDate(new Date("2026-08-07T09:00:00Z")),
    ...fields,
  });
}

function baseProps() {
  return {
    items: [] as never[],
    isLoading: false,
    error: null,
    hasOlder: false,
    loadOlder: vi.fn(),
    isLoadingOlder: false,
    provider: "whatsapp" as const,
    now: NOW,
  };
}

describe("ConversationTimelineView", () => {
  afterEach(() => cleanup());

  it("renders customer and business sides with author captions", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("wa:1", {
            author: ConversationItemAuthor.author_customer,
            text: "where is my order?",
          }),
          item("dl:2", {
            author: ConversationItemAuthor.author_agent,
            text: "checking now",
            deliveryStatus: ChannelDeliveryStatus.delivered,
          }),
          item("ob:3", {
            author: ConversationItemAuthor.author_teammate,
            text: "I'll take this one",
            deliveryStatus: ChannelDeliveryStatus.delivered,
          }),
          item("ob:4", {
            author: ConversationItemAuthor.author_platform,
            text: "A team member will reply shortly.",
            deliveryStatus: ChannelDeliveryStatus.delivered,
          }),
        ]}
      />,
    );

    expect(screen.getByText("where is my order?")).toBeDefined();
    expect(screen.getByText("Agent")).toBeDefined();
    expect(screen.getByText("Teammate")).toBeDefined();
    expect(screen.getByText("Automated")).toBeDefined();
    // The customer side never carries a caption.
    expect(screen.queryByText("Customer")).toBeNull();
  });

  it("renders a typed placeholder for non-text inbound instead of hiding it", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("wa:1", {
            author: ConversationItemAuthor.author_customer,
            providerMessageType: "image",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Photo")).toBeDefined();
  });

  it("keeps the two status axes distinct: provider-accepted yet receipt-failed", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("ob:1", {
            author: ConversationItemAuthor.author_agent,
            text: "your table is ready",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_failed,
          }),
        ]}
      />,
    );
    // The attempt succeeded — no "Not delivered" — but the provider's
    // receipt axis reports the failure on its own.
    expect(screen.queryByText("Not delivered")).toBeNull();
    expect(screen.getByText("Delivery failed")).toBeDefined();
  });

  it("renders a dead-lettered send as exactly that", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("dl:1", {
            author: ConversationItemAuthor.author_agent,
            text: "lost reply",
            deliveryStatus: ChannelDeliveryStatus.failed,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Not delivered")).toBeDefined();
  });

  it("renders a suppressed send as held, never as sent", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("ob:1", {
            author: ConversationItemAuthor.author_agent,
            text: "reminder that never went",
            deliveryStatus: ChannelDeliveryStatus.suppressed,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Held")).toBeDefined();
  });

  it("advances the receipt ticks: sent, delivered, read", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("ob:1", {
            author: ConversationItemAuthor.author_agent,
            text: "one",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_sent,
          }),
          item("ob:2", {
            author: ConversationItemAuthor.author_agent,
            text: "two",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_delivered,
          }),
          item("ob:3", {
            author: ConversationItemAuthor.author_agent,
            text: "three",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_read,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Sent")).toBeDefined();
    expect(screen.getByText("Delivered")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
  });

  it("renders internal-lane events as system rows the customer never saw", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("ev:1", {
            lane: ConversationLane.lane_internal,
            author: ConversationItemAuthor.author_agent,
            text: "the member is asking about a refund I cannot process",
          }),
          item("ev:2", {
            lane: ConversationLane.lane_internal,
            author: ConversationItemAuthor.author_teammate,
          }),
        ]}
      />,
    );

    expect(
      screen.getByText(/Agent escalated to a human — “the member is asking/),
    ).toBeDefined();
    expect(screen.getByText("A teammate resolved the attention flag")).toBeDefined();
  });

  it("tells the truth about Slack timelines", () => {
    const { rerender } = render(
      <ConversationTimelineView {...baseProps()} provider="slack" />,
    );
    expect(
      screen.getByText(/Customer messages on Slack channels aren't shown here yet/),
    ).toBeDefined();

    rerender(<ConversationTimelineView {...baseProps()} provider="whatsapp" />);
    expect(
      screen.queryByText(/Customer messages on .* channels aren't shown/),
    ).toBeNull();
  });

  it("separates days and labels the current one Today", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("wa:1", {
            author: ConversationItemAuthor.author_customer,
            text: "yesterday's question",
            at: timestampFromDate(new Date("2026-08-06T18:00:00Z")),
          }),
          item("wa:2", {
            author: ConversationItemAuthor.author_customer,
            text: "today's follow-up",
            at: timestampFromDate(new Date("2026-08-07T09:00:00Z")),
          }),
        ]}
      />,
    );

    expect(screen.getByText("Yesterday")).toBeDefined();
    expect(screen.getByText("Today")).toBeDefined();
  });

  it("offers Load earlier messages exactly while older history exists", async () => {
    const user = userEvent.setup();
    const loadOlder = vi.fn();
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[item("wa:1", { author: ConversationItemAuthor.author_customer, text: "hi" })]}
        hasOlder
        loadOlder={loadOlder}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(loadOlder).toHaveBeenCalled();
  });

  it("renders the empty and error states honestly", () => {
    const { rerender } = render(<ConversationTimelineView {...baseProps()} />);
    expect(screen.getByText("No messages yet")).toBeDefined();

    rerender(
      <ConversationTimelineView {...baseProps()} error={new Error("stitch failed")} />,
    );
    expect(screen.getByText("stitch failed")).toBeDefined();
  });
});
