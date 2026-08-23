// Thread emission rules for the retriever transparency card
// (stigmer/stigmer#293 Phase 3a, DD-008 D5). The load-bearing pins:
//
//   1. The card is a PER-SEGMENT item derived from each execution's own
//      spec+status — NOT a live-only tail indicator like setup-progress.
//      A historical (non-active) execution keeps its card forever; that
//      is the audit property, and the regression this file exists to
//      catch (a live-only mechanism would render correctly during
//      streaming and silently lose the record afterwards).
//   2. Absent report and selection_active=false both render NOTHING —
//      wholesale is the unchanged majority behavior and earns no noise.
//   3. The card is gated on the REPORT, not the prompt bubble:
//      syntheticUserPrompt deliberately skips some user turns (empty
//      prompt), and those executions can still be selection-active.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  RecalledMemoriesReportSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSpecSchema,
  RecalledMemoriesSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { MessageThread } from "../MessageThread";

// useAutoScroll depends on browser APIs not available in happy-dom.
beforeEach(() => {
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
    vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeExecution(opts: {
  id: string;
  specMessage?: string;
  facts?: ReadonlyArray<{ id: string; content: string }>;
  report?: { selectionActive: boolean; injectedMemoryIds?: string[] };
}): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id: opts.id });

  const spec = create(AgentExecutionSpecSchema);
  spec.message = opts.specMessage ?? "Hello";
  if (opts.facts) {
    spec.recalledMemories = create(RecalledMemoriesSchema, {
      enabled: true,
      facts: opts.facts.map((f) => ({ memoryId: f.id, content: f.content })),
    });
  }
  exec.spec = spec;

  const status = create(AgentExecutionStatusSchema);
  status.phase = ExecutionPhase.EXECUTION_COMPLETED;
  status.messages = [
    create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "Done." }),
  ];
  if (opts.report) {
    status.recalledMemoriesReport = create(RecalledMemoriesReportSchema, {
      selectionActive: opts.report.selectionActive,
      injectedMemoryIds: opts.report.injectedMemoryIds ?? [],
      embeddingModel: opts.report.selectionActive ? "text-embedding-3-small" : "",
    });
  }
  exec.status = status;
  return exec;
}

const FACTS = [
  { id: "mem_a", content: "Prefers concise answers." },
  { id: "mem_b", content: "Deploys with Bazel." },
  { id: "mem_c", content: "Reviews PRs on Fridays." },
];

describe("MessageThread recalled-memories item", () => {
  it("emits the card inside a selection-active execution's segment, after the user turn", () => {
    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            specMessage: "prompt text",
            facts: FACTS,
            report: { selectionActive: true, injectedMemoryIds: ["mem_a", "mem_c"] },
          }),
        ]}
      />,
    );

    const card = screen.getByRole("status", { name: "Recalled 2 of 3 memories" });
    const userBubble = screen.getByRole("article", { name: "User message" });
    // Segment order: user turn first, then the card the turn's prompt selected.
    expect(
      userBubble.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("emits nothing for an absent report (pre-3a and no-injection executions read identically)", () => {
    render(
      <MessageThread
        executions={[makeExecution({ id: "e1", facts: FACTS })]}
      />,
    );
    expect(screen.queryByRole("status", { name: /Recalled/ })).toBeNull();
  });

  it("emits nothing for a wholesale report (selection_active=false)", () => {
    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            facts: FACTS,
            report: { selectionActive: false },
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("status", { name: /Recalled/ })).toBeNull();
  });

  it("keeps the card on a HISTORICAL execution while another execution streams", () => {
    // The audit pin: the card derives from the execution's own segment, so
    // it must survive the execution no longer being the active stream — a
    // live-only mechanism (the setup-progress shape) would lose it here.
    const historical = makeExecution({
      id: "e-old",
      specMessage: "earlier turn",
      facts: FACTS,
      report: { selectionActive: true, injectedMemoryIds: ["mem_b"] },
    });
    const live = makeExecution({ id: "e-live", specMessage: "current turn" });
    live.status!.phase = ExecutionPhase.EXECUTION_IN_PROGRESS;

    render(
      <MessageThread executions={[historical]} activeStreamExecution={live} />,
    );

    expect(
      screen.getByRole("status", { name: "Recalled 1 of 3 memories" }),
    ).toBeTruthy();
  });

  it("emits one card per selection-active execution", () => {
    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            facts: FACTS,
            report: { selectionActive: true, injectedMemoryIds: ["mem_a"] },
          }),
          makeExecution({ id: "e2", facts: FACTS }),
          makeExecution({
            id: "e3",
            facts: FACTS,
            report: { selectionActive: true, injectedMemoryIds: ["mem_a", "mem_b"] },
          }),
        ]}
      />,
    );

    expect(screen.getByRole("status", { name: "Recalled 1 of 3 memories" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Recalled 2 of 3 memories" })).toBeTruthy();
    expect(screen.getAllByRole("status", { name: /Recalled/ })).toHaveLength(2);
  });

  it("emits the card even when the user-turn bubble is skipped (empty prompt)", () => {
    render(
      <MessageThread
        executions={[
          makeExecution({
            id: "e1",
            specMessage: "",
            facts: FACTS,
            report: { selectionActive: true, injectedMemoryIds: ["mem_c"] },
          }),
        ]}
      />,
    );

    expect(screen.queryByRole("article", { name: "User message" })).toBeNull();
    expect(
      screen.getByRole("status", { name: "Recalled 1 of 3 memories" }),
    ).toBeTruthy();
  });
});
