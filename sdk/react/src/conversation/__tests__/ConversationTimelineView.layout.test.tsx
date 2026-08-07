// Scroll-behavior regression for the conversation timeline (F-09), against
// the REAL component and the shipped stylesheet in a real Chromium — the
// composition that shipped the bug: `ConversationTimelineView` mounts its
// content wrapper inside the loading branch, so the auto-scroll machinery
// must attach to a wrapper that does not exist on first render. The
// hook-level mechanics are pinned in
// `internal/__tests__/useAutoScroll.layout.test.tsx`; this suite proves the
// component wiring delivers them: a conversation OPENS at the newest
// message with "Jump to latest" hidden, and stays pinned as messages land.

import "../../../dist/styles.css";

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
  type ConversationTimelineItem,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ConversationTimelineView } from "../ConversationTimelineView.js";

const NOW = new Date("2026-08-07T12:00:00Z");

function items(count: number): ConversationTimelineItem[] {
  return Array.from({ length: count }, (_, i) =>
    create(ConversationTimelineItemSchema, {
      itemId: `wa:${i}`,
      lane: ConversationLane.lane_public,
      author:
        i % 2 === 0
          ? ConversationItemAuthor.author_customer
          : ConversationItemAuthor.author_agent,
      text: `message ${i}`,
      at: timestampFromDate(new Date(NOW.getTime() - (count - i) * 60_000)),
    }),
  );
}

function view(props: {
  readonly items: readonly ConversationTimelineItem[];
  readonly isLoading: boolean;
}): ReactElement {
  return (
    <ConversationTimelineView
      items={props.items}
      isLoading={props.isLoading}
      error={null}
      hasOlder={false}
      loadOlder={() => {}}
      isLoadingOlder={false}
      provider="whatsapp"
      now={NOW}
    />
  );
}

/**
 * Render inside a fixed-height themed `.stgm` box (the shipped stylesheet
 * is scoped to it) so the timeline's internal scroller actually overflows.
 */
function renderInPane(ui: ReactElement) {
  const pane = document.createElement("div");
  pane.className = "stgm";
  pane.style.height = "360px";
  pane.style.width = "640px";
  pane.style.display = "flex";
  pane.style.flexDirection = "column";
  document.body.appendChild(pane);
  return render(ui, { container: pane });
}

function scroller(): HTMLElement {
  // The component's scroll container is the timeline's direct child pane
  // (ConversationTimelineView.tsx: the overflow-y-auto div under the
  // aria-labelled root).
  const rootEl = document.querySelector('[aria-label="Conversation timeline"]');
  return rootEl?.firstElementChild as HTMLElement;
}

function jumpButton(): HTMLElement {
  return document.querySelector('button[aria-label="Jump to latest"]') as HTMLElement;
}

const isPinnedToBottom = (el: HTMLElement) =>
  el.scrollHeight > el.clientHeight &&
  Math.abs(el.scrollTop - (el.scrollHeight - el.clientHeight)) <= 1;

async function settled(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 2000, interval: 20 });
}

// Determinism note: every case starts loading and fills content on a
// rerender — the production sequence, and also what makes the scroll-up
// case race-free: with a late-mounting wrapper the mount-time scroll
// write is a no-op, so "pinned" can only come from the ResizeObserver
// pathway, proving its initial delivery and rAF write have both run
// before any simulated reader scroll. (Headless Chromium delivers
// initial observations on its own schedule; frame-count waits were
// measured flaky.)

afterEach(() => {
  cleanup();
  document.querySelectorAll(".stgm").forEach((node) => node.remove());
});

describe("ConversationTimelineView scroll behavior (F-09)", () => {
  it("opens at the newest message after the async first load", async () => {
    // The production sequence: the timeline mounts loading (skeleton, no
    // content wrapper), then the first page lands.
    const { rerender } = renderInPane(view({ items: [], isLoading: true }));
    rerender(view({ items: items(40), isLoading: false }));

    await settled(() => {
      expect(
        isPinnedToBottom(scroller()),
        "a conversation must open at its newest message",
      ).toBe(true);
      // Following ⇒ the recovery affordance stays hidden.
      expect(jumpButton().getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("stays pinned as new messages land on poll ticks", async () => {
    const { rerender } = renderInPane(view({ items: [], isLoading: true }));
    rerender(view({ items: items(40), isLoading: false }));
    await settled(() => expect(isPinnedToBottom(scroller())).toBe(true));

    rerender(view({ items: items(42), isLoading: false }));

    await settled(() => {
      expect(isPinnedToBottom(scroller())).toBe(true);
      expect(jumpButton().getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("offers Jump to latest to a reader who scrolled up, without moving them", async () => {
    const { rerender } = renderInPane(view({ items: [], isLoading: true }));
    rerender(view({ items: items(40), isLoading: false }));
    await settled(() => expect(isPinnedToBottom(scroller())).toBe(true));

    scroller().scrollTop = 0;
    await settled(() =>
      expect(jumpButton().getAttribute("aria-hidden")).toBe("false"),
    );

    rerender(view({ items: items(41), isLoading: false }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scroller().scrollTop).toBe(0);

    jumpButton().click();
    await settled(() => {
      expect(isPinnedToBottom(scroller())).toBe(true);
      expect(jumpButton().getAttribute("aria-hidden")).toBe("true");
    });
  });
});
