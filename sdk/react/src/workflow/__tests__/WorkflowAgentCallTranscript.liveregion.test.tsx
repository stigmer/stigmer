// The T07 stacked-live-region check: several inline transcripts mount
// several REAL MessageThreads, each carrying its own `role="log"
// aria-live="polite"` scroller, under the viewer's one task-state
// announcer. This pins the a11y-relevant facts that make the stack
// acceptable rather than noisy:
//
// - each live region is scoped to ITS transcript (announcements name their
//   own child's content, never a sibling's);
// - `polite` regions only announce on CONTENT CHANGE — a settled child's
//   transcript never mutates, so it is permanently silent;
// - the viewport gate (useInViewport → useLiveAgentExecution's `live`)
//   pauses off-screen streams, so at most the on-screen running children
//   mutate concurrently.
//
// If a live round ever proves this noisy in real screen readers, the
// planned fallback is a backward-compatible `ariaLive` opt-out prop on
// MessageThread (DD-011) — not committed speculatively.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, within, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../execution/useLiveAgentExecution", () => ({
  useLiveAgentExecution: vi.fn(),
}));

import { useLiveAgentExecution } from "../../execution/useLiveAgentExecution";
import { WorkflowAgentCallTranscript } from "../WorkflowAgentCallTranscript";

const mockUseLiveAgentExecution = vi.mocked(useLiveAgentExecution);

function executionWithMessage(id: string, text: string): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    messages: [
      create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: text,
      }),
    ],
  });
  return exec;
}

beforeEach(() => {
  vi.clearAllMocks();
  // MessageThread's auto-scroll + the transcript's viewport gate both need
  // observers happy-dom lacks.
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkflowAgentCallTranscript — stacked live regions (T07 a11y)", () => {
  it("scopes each transcript's polite log region to its own child's content, under the viewer-style announcer", () => {
    mockUseLiveAgentExecution.mockImplementation((id) => ({
      execution: executionWithMessage(id!, `report from ${id}`),
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      isLoading: false,
      isStreaming: false,
      isReconnecting: false,
      error: null,
      reconnect: vi.fn(),
    }));

    const { container } = render(
      <div>
        {/* The viewer's single always-visible task-state announcer. */}
        <div role="log" aria-live="polite" data-testid="viewer-announcer" />
        <WorkflowAgentCallTranscript childExecutionId="aex_a" agentSlug="alpha" />
        <WorkflowAgentCallTranscript childExecutionId="aex_b" agentSlug="beta" />
      </div>,
    );

    // Three polite regions coexist: the announcer + one per transcript.
    const regions = Array.from(
      container.querySelectorAll('[aria-live="polite"]'),
    );
    expect(regions).toHaveLength(3);
    for (const region of regions) {
      expect(region.getAttribute("aria-live")).toBe("polite");
    }

    // Scoping: each transcript's log carries ONLY its own child's content —
    // an announcement can never attribute one agent's words to another.
    const transcriptA = screen.getByRole("group", {
      name: "Transcript of agent alpha",
    });
    const transcriptB = screen.getByRole("group", {
      name: "Transcript of agent beta",
    });
    expect(within(transcriptA).getByText("report from aex_a")).toBeTruthy();
    expect(within(transcriptA).queryByText("report from aex_b")).toBeNull();
    expect(within(transcriptB).getByText("report from aex_b")).toBeTruthy();
  });
});
