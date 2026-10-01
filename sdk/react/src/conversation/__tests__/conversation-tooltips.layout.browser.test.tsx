// Tooltip behavior for the conversation status glyphs (F-18), in a real
// Chromium. The fix replaced native `title` hints (OS-delayed, invisible
// to keyboard and touch, dead on disabled buttons) with the house
// tooltip. The fast happy-dom suite pins the STRUCTURE (sr-only names
// kept, no titles, no new tab stops); it cannot honestly pin the
// REVEAL — Base UI opens on real pointer movement, which only a real
// browser delivers. This suite proves a mouse user actually gets the
// explanation. First real-browser tooltip coverage in the SDK; the
// WorkspaceSidebar recents tooltip rides the same primitive.

import "../../../dist/styles.css";

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import type { ReactElement } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelConversationSchema,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import { ConversationListPane } from "../ConversationListPane.js";
import { ConversationTimelineView } from "../ConversationTimelineView.js";

const NOW = new Date("2026-08-07T12:00:00Z");

/**
 * A themed, sized box so hover geometry is real (the F-09 suite's
 * shape) — narrow enough to fit the headless viewport, because a
 * right-aligned business bubble in a pane wider than the viewport puts
 * its receipt tick off-screen where a pointer cannot rest on it.
 */
function renderInPane(ui: ReactElement) {
  const pane = document.createElement("div");
  pane.className = "stgm";
  pane.style.height = "360px";
  pane.style.width = "320px";
  pane.style.display = "flex";
  pane.style.flexDirection = "column";
  document.body.appendChild(pane);
  render(ui, { container: pane });
  return pane;
}

/**
 * Hover `trigger` and wait for `hint` to appear in the PORTAL — i.e. in
 * a `document.body` child other than the pane, proving the tooltip
 * escaped the scroll container — respecting Base UI's open delay.
 */
async function expectHoverReveals(pane: HTMLElement, trigger: Element, hint: string) {
  await userEvent.hover(trigger);
  await vi.waitFor(
    () => {
      const portaled = Array.from(document.body.children)
        .filter((node) => node !== pane)
        .map((node) => node.textContent ?? "")
        .join(" ");
      expect(portaled).toContain(hint);
    },
    { timeout: 3000, interval: 50 },
  );
  await userEvent.unhover(trigger);
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
});

describe("conversation status tooltips (F-18)", () => {
  it("reveals the receipt and failure explanations on hover — with zero native titles", async () => {
    const pane = renderInPane(
      <ConversationTimelineView
        items={[
          create(ConversationTimelineItemSchema, {
            itemId: "ob:read",
            lane: ConversationLane.lane_public,
            author: ConversationItemAuthor.author_teammate,
            text: "your table is ready",
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: ChannelReceiptState.receipt_read,
            at: timestampFromDate(new Date("2026-08-07T11:58:00Z")),
          }),
          create(ConversationTimelineItemSchema, {
            itemId: "dl:failed",
            lane: ConversationLane.lane_public,
            author: ConversationItemAuthor.author_agent,
            text: "a reply that never arrived",
            deliveryStatus: ChannelDeliveryStatus.failed,
            at: timestampFromDate(new Date("2026-08-07T11:59:00Z")),
          }),
        ]}
        isLoading={false}
        error={null}
        hasOlder={false}
        loadOlder={() => {}}
        isLoadingOlder={false}
        provider="whatsapp"
        now={NOW}
      />,
    );

    expect(pane.querySelector("[title]")).toBeNull();

    // The read tick's trigger: the outermost span whose text content is
    // the sr-only name (document order puts the trigger before the
    // sr-only span it contains).
    const readTrigger = Array.from(pane.querySelectorAll("span")).find(
      (el) => el.textContent === "Read",
    );
    await expectHoverReveals(pane, readTrigger!, "Read by the customer");

    // The failed attempt keeps its visible short label and reveals the
    // longer explanation on hover.
    const failed = Array.from(pane.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("Not delivered"),
    );
    await expectHoverReveals(
      pane,
      failed!,
      "The platform could not deliver this message",
    );
  });

  it("reveals the attention reason on the inbox badge without focusable clutter", async () => {
    const pane = renderInPane(
      <ConversationListPane
        conversations={[
          create(ChannelConversationSchema, {
            agentChannelId: "ach_wa",
            conversationKey: "15550001111",
            org: "acme",
            displayName: "Pat",
            needsAttention: true,
            attentionReason: "refund I cannot process",
          }),
        ]}
        isLoading={false}
        error={null}
        hasMore={false}
        loadMore={() => {}}
        isLoadingMore={false}
        channels={[]}
        channelFilter=""
        onChannelFilterChange={() => {}}
        selected={null}
        onSelect={() => {}}
        now={NOW}
      />,
    );

    expect(pane.querySelector("[title]")).toBeNull();
    // The trigger span stays out of the tab order (structure is pinned
    // in the fast suite; re-asserted here against the real DOM).
    expect(pane.querySelectorAll("li [tabindex]")).toHaveLength(0);

    const badgeTrigger = Array.from(pane.querySelectorAll("span")).find(
      (el) => el.textContent === "Needs attention: refund I cannot process",
    );
    await expectHoverReveals(pane, badgeTrigger!, "refund I cannot process");
  });
});
