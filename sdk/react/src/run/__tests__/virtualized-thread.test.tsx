/**
 * Pins MessageThread's two render paths over the session's folded turns:
 * the thread item renderer for a person's message (pending dimmed), a phase
 * badge and setup progress; the default scroll container with its log
 * semantics; and the opt-in virtualized path (Virtuoso mocked): bottom
 * alignment, follow-output, semantic keys, the 80px threshold, the
 * scroller's log semantics, real item content, overscan, the same items as
 * the plain path, and entry animation only on the tail items.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { samples } from "../../test/samples";
import {
  buildThreadItems,
  ThreadItemRenderer,
  type ThreadItem,
} from "../MessageThread";

// ---------------------------------------------------------------------------
// Mock react-virtuoso — Virtuoso's internal scroll/resize machinery
// does not work in happy-dom. We mock the component to capture props
// and verify configuration.
// ---------------------------------------------------------------------------

let capturedVirtuosoProps: Record<string, unknown> = {};

vi.mock("react-virtuoso", () => ({
  Virtuoso: React.forwardRef(function MockVirtuoso(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    capturedVirtuosoProps = props;
    const data = props.data as ThreadItem[];
    const itemContent = props.itemContent as (
      index: number,
      item: ThreadItem,
    ) => React.ReactNode;

    React.useImperativeHandle(ref, () => ({
      scrollToIndex: vi.fn(),
    }));

    const Scroller =
      (
        props.components as {
          Scroller?: React.ComponentType<Record<string, unknown>>;
        }
      )?.Scroller ?? "div";

    return (
      <Scroller data-testid="virtuoso-scroller">
        {data.map((item, i) => (
          <div key={item.key} data-testid={`virtuoso-item-${i}`}>
            {itemContent(i, item)}
          </div>
        ))}
      </Scroller>
    );
  }),
}));

// ---------------------------------------------------------------------------
// Observer / rAF mocks (required for useAutoScroll in non-virtualized path)
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedVirtuosoProps = {};

  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
      root: null,
      rootMargin: "",
      thresholds: [0],
    })),
  );

  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );

  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    }),
  );

  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A conversation of finished turns, each `[runId, message, reply]`: the runs and their folded events. */
function makeConversation(...turns: Array<[string, string, string]>) {
  return {
    turns: samples.fold(
      turns.flatMap(([runId, message, reply]) => samples.turnEvents({ runId, message, reply })),
    ).turns,
    runs: turns.map(([id, message]) => samples.run({ id, message })),
  };
}

// Lazy import — must import after mocks are set up
async function importMessageThread() {
  const mod = await import("../MessageThread");
  return mod.MessageThread;
}

// ---------------------------------------------------------------------------
// Tests: ThreadItemRenderer
// ---------------------------------------------------------------------------

describe("ThreadItemRenderer", () => {
  it("renders a message item", () => {
    const item: ThreadItem = {
      kind: "message",
      message: { kind: "user", id: "u1", text: "Hello world" },
      key: "test-1",
    };

    render(<ThreadItemRenderer item={item} />);
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders a pending message with opacity", () => {
    const item: ThreadItem = {
      kind: "message",
      message: { kind: "user", id: "pending", text: "Sending..." },
      key: "pending",
      isPending: true,
    };

    const { container } = render(<ThreadItemRenderer item={item} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root?.className).toContain("stg:opacity-70");
  });

  it("renders a phase badge item", () => {
    const item: ThreadItem = {
      kind: "phase-badge",
      phase: RunPhase.RUN_FAILED,
      key: "phase-1",
    };

    render(<ThreadItemRenderer item={item} />);
    expect(screen.getByText(/failed/i)).toBeTruthy();
  });

  it("renders a setup progress item", () => {
    const item: ThreadItem = {
      kind: "setup-progress",
      workspaceEntries: [],
      key: "setup",
    };

    render(<ThreadItemRenderer item={item} />);
    expect(document.querySelector("[class]")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: MessageThread with virtualized=false (default, regression)
// ---------------------------------------------------------------------------

describe("MessageThread (non-virtualized)", () => {
  it("renders items in a role=log container by default", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi there"]);

    render(<MessageThread {...exec} />);

    const log = screen.getByRole("log");
    expect(log).toBeTruthy();
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-relevant")).toBe("additions");
  });

  it("does not render Virtuoso when virtualized is false", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi"]);

    render(<MessageThread {...exec} />);
    expect(capturedVirtuosoProps.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: MessageThread with virtualized=true
// ---------------------------------------------------------------------------

describe("MessageThread (virtualized)", () => {
  it("renders via Virtuoso when virtualized=true", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi there"]);

    render(<MessageThread {...exec} virtualized />);

    // Wait for lazy import to resolve
    await vi.waitFor(() => {
      expect(capturedVirtuosoProps.data).toBeDefined();
    });

    const data = capturedVirtuosoProps.data as ThreadItem[];
    expect(data.length).toBeGreaterThan(0);
  });

  it("passes alignToBottom=true to Virtuoso", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi"]);

    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      expect(capturedVirtuosoProps.alignToBottom).toBe(true);
    });
  });

  it("passes followOutput callback to Virtuoso", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi"]);

    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      expect(typeof capturedVirtuosoProps.followOutput).toBe("function");
    });

    const followOutput = capturedVirtuosoProps.followOutput as (
      atBottom: boolean,
    ) => string | false;
    expect(followOutput(true)).toBe("smooth");
    expect(followOutput(false)).toBe(false);
  });

  it("uses stable semantic keys via computeItemKey", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["exec-42", "Hello", "Hi"]);

    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      expect(capturedVirtuosoProps.computeItemKey).toBeDefined();
    });

    const data = capturedVirtuosoProps.data as ThreadItem[];
    const computeItemKey = capturedVirtuosoProps.computeItemKey as (
      index: number,
      item: ThreadItem,
    ) => string;

    for (let i = 0; i < data.length; i++) {
      expect(computeItemKey(i, data[i])).toBe(data[i].key);
    }
  });

  it("sets atBottomThreshold matching the non-virtualized 80px margin", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi"]);

    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      expect(capturedVirtuosoProps.atBottomThreshold).toBe(80);
    });
  });

  it("applies a11y attributes to the scroller", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi"]);

    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      const scroller = screen.getByTestId("virtuoso-scroller");
      expect(scroller.getAttribute("role")).toBe("log");
      expect(scroller.getAttribute("aria-live")).toBe("polite");
      expect(scroller.getAttribute("aria-relevant")).toBe("additions");
    });
  });

  it("renders actual thread item content through Virtuoso", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello from user", "Hello from AI"]);

    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      expect(screen.getAllByText("Hello from user").length).toBeGreaterThan(0);
      expect(screen.getByText("Hello from AI")).toBeTruthy();
    });
  });

  it("sets increaseViewportBy for overscan", async () => {
    const MessageThread = await importMessageThread();
    const exec = makeConversation(["e1", "Hello", "Hi"]);

    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      expect(capturedVirtuosoProps.increaseViewportBy).toEqual({
        top: 200,
        bottom: 200,
      });
    });
  });

  it("builds the same items for both paths", async () => {
    const exec = makeConversation(["e1", "Hello", "Hi there"]);
    const items = buildThreadItems(exec.turns, exec.runs);

    const MessageThread = await importMessageThread();
    render(<MessageThread {...exec} virtualized />);

    await vi.waitFor(() => {
      const data = capturedVirtuosoProps.data as ThreadItem[];
      expect(data.map((d) => d.key)).toEqual(items.map((i) => i.key));
    });
  });

  it("applies entry animation only to tail items (last 2)", async () => {
    const execs = makeConversation(
      ["e1", "First", "Response 1"],
      ["e2", "Second", "Response 2"],
      ["e3", "Third", "Response 3"],
    );

    const MessageThread = await importMessageThread();
    render(<MessageThread {...execs} virtualized />);

    await vi.waitFor(() => {
      const data = capturedVirtuosoProps.data as ThreadItem[];
      expect(data.length).toBeGreaterThan(2);
    });

    const data = capturedVirtuosoProps.data as ThreadItem[];
    const itemContent = capturedVirtuosoProps.itemContent as (
      index: number,
      item: ThreadItem,
    ) => React.ReactNode;
    const tailThreshold = data.length - 2;

    // Non-tail item: no animation wrapper
    const earlyResult = render(
      <div data-testid="early">{itemContent(0, data[0])}</div>,
    );
    expect(
      earlyResult.container.querySelector(".stgm-thread-item-enter"),
    ).toBeNull();
    earlyResult.unmount();

    // Tail item: has animation wrapper
    const lastIdx = data.length - 1;
    const tailResult = render(
      <div data-testid="tail">{itemContent(lastIdx, data[lastIdx])}</div>,
    );
    expect(
      tailResult.container.querySelector(".stgm-thread-item-enter"),
    ).toBeTruthy();
    tailResult.unmount();
  });
});
