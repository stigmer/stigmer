// Scroll-on-send wiring pins for MessageThread (stigmer-cloud#267): the
// send moment is the optimistic message's empty→present transition, and it
// must pin the thread exactly once — default-ON, opt-out via
// `scrollOnSend={false}` (the ratified DD-011 divergence). The REAL scroll
// mechanics (pin + follow re-engagement under real layout) are pinned in
// `internal/__tests__/useAutoScroll.layout.test.tsx`; this file pins the
// surface's signal derivation through a spied `jumpToLatest`, with the real
// `usePinToLatestOnSignal` connecting them.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

const jumpToLatestSpy = vi.fn();

// The fake replaces only the scroll machine (browser observers happy-dom
// lacks); `usePinToLatestOnSignal` stays REAL, so these tests exercise the
// actual signal contract between MessageThread and its render paths.
vi.mock("../../internal/useAutoScroll", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../internal/useAutoScroll")>();
  return {
    ...original,
    useAutoScroll: () => ({
      scrollRef: { current: null },
      sentinelRef: { current: null },
      contentRef: () => {},
      isFollowing: true,
      jumpToLatest: jumpToLatestSpy,
    }),
  };
});

import { MessageThread } from "../MessageThread";

afterEach(() => {
  cleanup();
  jumpToLatestSpy.mockClear();
});

function makeExecution(id: string, message: string): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const meta = create(ApiResourceMetadataSchema);
  meta.id = id;
  exec.metadata = meta;
  const spec = create(AgentExecutionSpecSchema);
  spec.message = message;
  exec.spec = spec;
  return exec;
}

describe("MessageThread — scroll-on-send (stigmer-cloud#267)", () => {
  it("pins the thread exactly once when the optimistic message appears (default-on)", () => {
    const executions = [makeExecution("aex_1", "earlier turn")];
    const { rerender } = render(
      <MessageThread executions={executions} pendingUserMessage={null} />,
    );
    expect(jumpToLatestSpy).not.toHaveBeenCalled();

    // The send: the composer sets the optimistic message.
    rerender(
      <MessageThread executions={executions} pendingUserMessage="do the thing" />,
    );
    expect(jumpToLatestSpy).toHaveBeenCalledTimes(1);

    // Re-renders while the message stays pending must not re-pin — the
    // reader may have scrolled up again to read history mid-turn.
    rerender(
      <MessageThread executions={executions} pendingUserMessage="do the thing" />,
    );
    expect(jumpToLatestSpy).toHaveBeenCalledTimes(1);
  });

  it("pins again on the NEXT send after the pending message clears", () => {
    const executions = [makeExecution("aex_1", "earlier turn")];
    const { rerender } = render(
      <MessageThread executions={executions} pendingUserMessage={null} />,
    );

    rerender(
      <MessageThread executions={executions} pendingUserMessage="first send" />,
    );
    rerender(<MessageThread executions={executions} pendingUserMessage={null} />);
    rerender(
      <MessageThread executions={executions} pendingUserMessage="second send" />,
    );

    expect(jumpToLatestSpy).toHaveBeenCalledTimes(2);
  });

  it("does not re-pin on a failed send's retry — pending stays present throughout, and the reader was already brought to it", () => {
    const executions = [makeExecution("aex_1", "earlier turn")];
    const { rerender } = render(
      <MessageThread executions={executions} pendingUserMessage={null} />,
    );

    rerender(
      <MessageThread executions={executions} pendingUserMessage="flaky send" />,
    );
    rerender(
      <MessageThread
        executions={executions}
        pendingUserMessage="flaky send"
        pendingMessageFailed
        onRetrySend={() => {}}
      />,
    );
    rerender(
      <MessageThread executions={executions} pendingUserMessage="flaky send" />,
    );

    expect(jumpToLatestSpy).toHaveBeenCalledTimes(1);
  });

  it("never pins with scrollOnSend={false} — the opt-out preserves today's leave-the-reader-alone behavior", () => {
    const executions = [makeExecution("aex_1", "earlier turn")];
    const { rerender } = render(
      <MessageThread
        executions={executions}
        pendingUserMessage={null}
        scrollOnSend={false}
      />,
    );

    rerender(
      <MessageThread
        executions={executions}
        pendingUserMessage="do the thing"
        scrollOnSend={false}
      />,
    );

    expect(jumpToLatestSpy).not.toHaveBeenCalled();
  });
});
