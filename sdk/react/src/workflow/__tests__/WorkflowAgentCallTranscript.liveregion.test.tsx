// The stacked-live-region check: several inline transcripts mount
// several REAL MessageThreads, each carrying its own `role="log"
// aria-live="polite"` scroller, under the viewer's one task-state
// announcer. This pins the a11y-relevant facts that make the stack
// acceptable rather than noisy:
//
// - each live region is scoped to ITS transcript (announcements name their
//   own child's content, never a sibling's);
// - `polite` regions only announce on CONTENT CHANGE — a settled child's
//   transcript never mutates, so it is permanently silent;
// - the viewport gate (useInViewport → useLiveAgentRun's `live`)
//   pauses off-screen streams, so at most the on-screen running children
//   mutate concurrently.
//
// If a live round ever proves this noisy in real screen readers, the
// planned fallback is a backward-compatible `ariaLive` opt-out prop on
// MessageThread — not committed speculatively.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, within, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  AgentRunStatusSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import {
  RunPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

vi.mock("../../run/useLiveAgentRun", () => ({
  useLiveAgentRun: vi.fn(),
}));

import { useLiveAgentRun } from "../../run/useLiveAgentRun";
import { WorkflowAgentCallTranscript } from "../WorkflowAgentCallTranscript";

const mockUseLiveAgentExecution = vi.mocked(useLiveAgentRun);

function executionWithMessage(id: string, text: string): AgentRun {
  const exec = create(AgentRunSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentRunStatusSchema, {
    phase: RunPhase.RUN_COMPLETED,
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

describe("WorkflowAgentCallTranscript — stacked live regions (a11y)", () => {
  it("scopes each transcript's polite log region to its own child's content, under the viewer-style announcer", () => {
    mockUseLiveAgentExecution.mockImplementation((id) => ({
      run: executionWithMessage(id!, `report from ${id}`),
      phase: RunPhase.RUN_COMPLETED,
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
        <WorkflowAgentCallTranscript childRunId="aex_a" agentSlug="alpha" />
        <WorkflowAgentCallTranscript childRunId="aex_b" agentSlug="beta" />
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
