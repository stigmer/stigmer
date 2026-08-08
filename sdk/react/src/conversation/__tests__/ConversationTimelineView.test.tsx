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

  it("renders the provider's failure explanation as VISIBLE text on a failed receipt (DD-014 D-c, R-1)", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("ob:1", {
            author: ConversationItemAuthor.author_teammate,
            text: "your table is ready",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_failed,
            receiptDetail:
              "More than 24 hours have passed since the recipient last replied to the sender number.",
            receiptErrorCode: 131047,
          }),
        ]}
      />,
    );

    // Verbatim relay — the provider's own words, never pattern-matched
    // into local copy. Visible (not hover-only): the reason changes what
    // the operator does next, and the footer glyphs are deliberately
    // non-focusable (F-18), so a tooltip reaches mouse users only.
    expect(
      screen.getByText(/More than 24 hours have passed since the recipient last replied/),
    ).toBeDefined();
    // The numeric code stays off the surface — machine vocabulary for
    // clients that branch, not operator copy.
    expect(screen.queryByText(/131047/)).toBeNull();
  });

  it("keeps today's generic copy when the provider sent no explanation", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("ob:1", {
            author: ConversationItemAuthor.author_agent,
            text: "your table is ready",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_failed,
            // A code with no prose: the bare number would tell an
            // operator nothing, so the tick keeps its generic copy.
            receiptErrorCode: 131047,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Delivery failed")).toBeDefined();
    expect(screen.queryByText(/131047/)).toBeNull();
  });

  it("never shows the receipt explanation on an attempt-failed item — the F-25 boundary", () => {
    render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("dl:1", {
            author: ConversationItemAuthor.author_agent,
            text: "lost reply",
            deliveryStatus: ChannelDeliveryStatus.failed,
            // A malformed item carrying a detail on the wrong axis: the
            // attempt-axis explanation (last_error) is F-25's separate
            // slice, so this lane renders nothing extra.
            receiptDetail: "should never render",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Not delivered")).toBeDefined();
    expect(screen.queryByText("should never render")).toBeNull();
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

  it("explains status glyphs with tooltips, never native titles, and adds no tab stops (F-18)", () => {
    // Every footer status variant at once: failed, suppressed, sending,
    // and the three receipt ticks (sent / delivered / read) plus the
    // receipt-failed arm.
    const { container } = render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("dl:1", {
            author: ConversationItemAuthor.author_agent,
            text: "failed send",
            deliveryStatus: ChannelDeliveryStatus.failed,
          }),
          item("ob:2", {
            author: ConversationItemAuthor.author_agent,
            text: "held send",
            deliveryStatus: ChannelDeliveryStatus.suppressed,
          }),
          item("ob:3", {
            author: ConversationItemAuthor.author_teammate,
            text: "sending now",
            deliveryStatus: ChannelDeliveryStatus.pending,
          }),
          item("ob:4", {
            author: ConversationItemAuthor.author_teammate,
            text: "sent",
            deliveryStatus: ChannelDeliveryStatus.delivered,
          }),
          item("ob:5", {
            author: ConversationItemAuthor.author_teammate,
            text: "delivered",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_delivered,
          }),
          item("ob:6", {
            author: ConversationItemAuthor.author_teammate,
            text: "read",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_read,
          }),
          item("ob:7", {
            author: ConversationItemAuthor.author_teammate,
            text: "receipt failed",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_failed,
          }),
        ]}
      />,
    );

    // Native titles are gone — OS-delayed, imprecise, keyboard- and
    // touch-invisible. The house tooltip replaced them.
    expect(container.querySelector("[title]")).toBeNull();
    // The screen-reader names survive the change (name stays the
    // sr-only/visible text; the tooltip is only the visual description).
    expect(screen.getByText("Sending")).toBeDefined();
    expect(screen.getByText("Sent")).toBeDefined();
    expect(screen.getByText("Delivered")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Not delivered")).toBeDefined();
    expect(screen.getByText("Held")).toBeDefined();
    expect(screen.getByText("Delivery failed")).toBeDefined();
    // Zero new tab stops: seven focusable glyphs per screen of messages
    // would be an accessibility regression dressed as a fix. Nothing
    // inside a message row may be focusable — the Jump-to-latest
    // affordance (which manages its own tabIndex) lives outside the
    // rows and stays the surface's only interactive element.
    expect(container.querySelectorAll("li [tabindex]")).toHaveLength(0);
    expect(container.querySelectorAll("li button")).toHaveLength(0);
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
