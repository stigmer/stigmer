import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Stigmer } from "@stigmer/sdk";
import {
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import { StigmerContext } from "../../context";
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
    // would be an accessibility regression dressed as a fix. No status
    // or metadata element inside a message row may be focusable — the
    // Jump-to-latest affordance (which manages its own tabIndex) lives
    // outside the rows. Media affordances (thumbnail preview, document
    // open) are the one deliberate exception: they are the row's
    // CONTENT action, which keyboard users must reach — covered in the
    // "inbound media" suite below. These fixtures carry none, so the
    // row-wide assertion holds here.
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

// ---------------------------------------------------------------------------
// Inbound media (stigmer/stigmer#367): items carrying ingested media render
// the real thing — an inline thumbnail or a document chip whose bytes are
// fetched through getMediaDownloadUrl — instead of the typed placeholder.
// The real hook runs against a mocked Stigmer client, so these cover the
// full wiring: the item address on the RPC, the presigned URL on the
// <img>, and the click-time mint on documents.
// ---------------------------------------------------------------------------

describe("ConversationTimelineView inbound media", () => {
  // happy-dom does not implement the native dialog show/close methods.
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  });

  afterEach(() => cleanup());

  const identityProps = {
    agentChannelId: "ach-1",
    conversationKey: "15551234567",
  };

  const photoMedia = {
    filename: "kitchen-leak.jpg",
    contentType: "image/jpeg",
    sizeBytes: BigInt(204800),
  };

  const documentMedia = {
    filename: "lease-agreement.pdf",
    contentType: "application/pdf",
    sizeBytes: BigInt(1048576),
  };

  function renderWithClient(ui: ReactElement, getMediaDownloadUrl: ReturnType<typeof vi.fn>) {
    const stigmer = { agentChannel: { getMediaDownloadUrl } } as unknown as Stigmer;
    return render(
      <StigmerContext.Provider value={stigmer}>{ui}</StigmerContext.Provider>,
    );
  }

  it("renders an inbound photo as a thumbnail with click-to-open lightbox", async () => {
    const mint = vi.fn().mockResolvedValue({ url: "https://r2.example/presigned/photo" });
    const { container } = renderWithClient(
      <ConversationTimelineView
        {...baseProps()}
        {...identityProps}
        items={[
          item("wa:1", {
            author: ConversationItemAuthor.author_customer,
            providerMessageType: "image",
            media: photoMedia,
          }),
        ]}
      />,
      mint,
    );

    // The URL is minted from the item's full conversation address —
    // never a storage key (whatsapp-media DD-001 D4).
    await waitFor(() => {
      const img = container.querySelector("img[aria-hidden='true']");
      expect(img?.getAttribute("src")).toBe("https://r2.example/presigned/photo");
    });
    const req = mint.mock.calls[0][0];
    expect(req.agentChannelId).toBe("ach-1");
    expect(req.conversationKey).toBe("15551234567");
    expect(req.itemId).toBe("wa:1");

    // The placeholder gave way to the real thing.
    expect(screen.queryByText("Photo")).toBeNull();

    // Click-to-open: the shared lightbox mounts with the full image.
    fireEvent.click(screen.getByRole("button", { name: "Preview kitchen-leak.jpg" }));
    const dialog = container.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview kitchen-leak.jpg");
  });

  it("renders a photo's caption beside it, and no apology when there is none", async () => {
    const mint = vi.fn().mockResolvedValue({ url: "https://r2.example/presigned/photo" });
    renderWithClient(
      <ConversationTimelineView
        {...baseProps()}
        {...identityProps}
        items={[
          item("wa:1", {
            author: ConversationItemAuthor.author_customer,
            providerMessageType: "image",
            text: "here's the leak under the sink",
            media: photoMedia,
          }),
        ]}
      />,
      mint,
    );

    expect(screen.getByText("here's the leak under the sink")).toBeDefined();
    // A caption-less media item is complete as its media — never the
    // "Message content unavailable" apology (that copy is for items
    // with neither text nor media nor a typed placeholder).
    expect(screen.queryByText("Message content unavailable")).toBeNull();
  });

  it("renders an inbound document as a chip; a click mints a fresh URL and opens it", async () => {
    const mint = vi.fn().mockResolvedValue({ url: "https://r2.example/presigned/doc" });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    renderWithClient(
      <ConversationTimelineView
        {...baseProps()}
        {...identityProps}
        items={[
          item("wa:2", {
            author: ConversationItemAuthor.author_customer,
            providerMessageType: "document",
            media: documentMedia,
          }),
        ]}
      />,
      mint,
    );

    // The chip carries the operator's decision facts: name and size.
    expect(screen.getByText("lease-agreement.pdf")).toBeDefined();
    expect(screen.getByText("1.0 MB")).toBeDefined();
    // No render-time mint for documents — the URL is minted fresh at
    // click time (presigned URLs expire; the item address does not).
    expect(mint).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open lease-agreement.pdf" }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    const req = mint.mock.calls[0][0];
    expect(req.agentChannelId).toBe("ach-1");
    expect(req.conversationKey).toBe("15551234567");
    expect(req.itemId).toBe("wa:2");
    anchorClick.mockRestore();
  });

  it("degrades a photo whose URL cannot be minted to the document treatment", async () => {
    const mint = vi
      .fn()
      .mockRejectedValue(new Error("no downloadable media at this timeline item"));
    const { container } = renderWithClient(
      <ConversationTimelineView
        {...baseProps()}
        {...identityProps}
        items={[
          item("wa:1", {
            author: ConversationItemAuthor.author_customer,
            providerMessageType: "image",
            media: photoMedia,
          }),
        ]}
      />,
      mint,
    );

    // Never a broken-image glyph — the file stays reachable as a chip.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open kitchen-leak.jpg" })).toBeDefined(),
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("reports a failed document open under the chip, never a silent dead click", async () => {
    const mint = vi
      .fn()
      .mockRejectedValue(new Error("no downloadable media at this timeline item"));
    renderWithClient(
      <ConversationTimelineView
        {...baseProps()}
        {...identityProps}
        items={[
          item("wa:2", {
            author: ConversationItemAuthor.author_customer,
            providerMessageType: "document",
            media: documentMedia,
          }),
        ]}
      />,
      mint,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open lease-agreement.pdf" }));
    await waitFor(() =>
      expect(screen.getByText(/no downloadable media/)).toBeDefined(),
    );
  });

  it("keeps the typed placeholder without the conversation address — and stays provider-free", () => {
    // Deliberately NO StigmerProvider: without the identity props the
    // media arm must not mount anything that needs one — the view's
    // presentational contract for fixture-driven hosts (documentation
    // tours, visual tests) predates media and must survive it.
    const { container } = render(
      <ConversationTimelineView
        {...baseProps()}
        items={[
          item("wa:1", {
            author: ConversationItemAuthor.author_customer,
            providerMessageType: "image",
            media: photoMedia,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Photo")).toBeDefined();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("li button")).toHaveLength(0);
  });
});
