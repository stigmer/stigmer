// Thread emission rules for the retriever transparency card
// (stigmer/stigmer#293 Phase 3), over the session's folded turns. The
// load-bearing pins:
//
//   1. The card is a PER-SEGMENT item derived from each turn's own
//      recall event (`stigmer.memory.recalled`, `Turn.memory`) and its
//      run's recalled facts — NOT a live-only tail indicator like
//      setup-progress. A finished turn keeps its card forever; that is the
//      audit property, and the regression this file exists to catch.
//   2. No recall event, and a recall without selection, both render
//      NOTHING — wholesale is the unchanged majority behavior.
//   3. The card is gated on the RECALL, not the prompt bubble:
//      syntheticUserPrompt deliberately skips some user turns (empty
//      prompt), and those turns can still be selection-active.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  RunStatusSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunSpecSchema,
  RecalledMemoriesSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { TurnPhase } from "@stigmer/sdk";
import { samples } from "../../test/samples";

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

interface TurnInit {
  readonly id: string;
  readonly specMessage?: string;
  readonly facts?: ReadonlyArray<{ id: string; content: string }>;
  readonly recall?: { selectionActive: boolean; injectedMemoryIds?: string[] };
  readonly phase?: TurnPhase;
}

/** The turn's run: its message and the memory snapshot it recalled from. */
function makeRun(opts: TurnInit): Run {
  const exec = create(RunSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id: opts.id });
  exec.spec = create(RunSpecSchema, { message: opts.specMessage ?? "Hello" });
  const status = create(RunStatusSchema, { phase: RunPhase.RUN_COMPLETED });
  if (opts.facts) {
    status.recalledMemories = create(RecalledMemoriesSchema, {
      enabled: true,
      facts: opts.facts.map((f) => ({ memoryId: f.id, content: f.content })),
    });
  }
  exec.status = status;
  return exec;
}

/** The turn's events: its message, its recall (when given), a reply and its phase. */
function makeEvents(opts: TurnInit): SessionEvent[] {
  const events = samples.turnEvents({
    runId: opts.id,
    message: opts.specMessage ?? "Hello",
    reply: "Done.",
    phase: opts.phase ?? "completed",
  });
  if (opts.recall) {
    events.splice(
      1,
      0,
      create(SessionEventSchema, {
        runId: opts.id,
        event: {
          case: "stigmerMemoryRecalled",
          value: {
            id: `${opts.id}.memory`,
            selectionActive: opts.recall.selectionActive,
            injectedMemoryIds: opts.recall.injectedMemoryIds ?? [],
            embeddingModel: opts.recall.selectionActive ? "text-embedding-3-small" : "",
          },
        },
      }),
    );
  }
  return events;
}

function thread(...turns: TurnInit[]) {
  return {
    turns: samples.fold(turns.flatMap(makeEvents)).turns,
    runs: turns.map(makeRun),
  };
}

const FACTS = [
  { id: "mem_a", content: "Prefers concise answers." },
  { id: "mem_b", content: "Deploys with Bazel." },
  { id: "mem_c", content: "Reviews PRs on Fridays." },
];

describe("MessageThread recalled-memories item", () => {
  it("emits the card inside a selection-active turn's segment, after the person's message", () => {
    render(
      <MessageThread
        {...thread({
          id: "e1",
          specMessage: "prompt text",
          facts: FACTS,
          recall: { selectionActive: true, injectedMemoryIds: ["mem_a", "mem_c"] },
        })}
      />,
    );

    const card = screen.getByRole("status", { name: "Recalled 2 of 3 memories" });
    const userBubble = screen.getByRole("article", { name: "User message" });
    // Segment order: user turn first, then the card the turn's prompt selected.
    expect(
      userBubble.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("emits nothing for a turn that recorded no recall", () => {
    render(<MessageThread {...thread({ id: "e1", facts: FACTS })} />);
    expect(screen.queryByRole("status", { name: /Recalled/ })).toBeNull();
  });

  it("emits nothing for a wholesale recall (no selection)", () => {
    render(<MessageThread {...thread({ id: "e1", facts: FACTS, recall: { selectionActive: false } })} />);
    expect(screen.queryByRole("status", { name: /Recalled/ })).toBeNull();
  });

  it("keeps the card on a FINISHED turn while another turn works", () => {
    // The audit pin: the card derives from the turn's own segment, so it
    // must survive the turn no longer being the live one — a live-only
    // mechanism (the setup-progress shape) would lose it here.
    render(
      <MessageThread
        {...thread(
          {
            id: "e-old",
            specMessage: "earlier turn",
            facts: FACTS,
            recall: { selectionActive: true, injectedMemoryIds: ["mem_b"] },
          },
          { id: "e-live", specMessage: "current turn", phase: "running" },
        )}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Recalled 1 of 3 memories" }),
    ).toBeTruthy();
  });

  it("emits one card per selection-active turn", () => {
    render(
      <MessageThread
        {...thread(
          { id: "e1", facts: FACTS, recall: { selectionActive: true, injectedMemoryIds: ["mem_a"] } },
          { id: "e2", facts: FACTS },
          { id: "e3", facts: FACTS, recall: { selectionActive: true, injectedMemoryIds: ["mem_a", "mem_b"] } },
        )}
      />,
    );

    expect(screen.getByRole("status", { name: "Recalled 1 of 3 memories" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Recalled 2 of 3 memories" })).toBeTruthy();
    expect(screen.getAllByRole("status", { name: /Recalled/ })).toHaveLength(2);
  });

  it("emits the card even when the user-turn bubble is skipped (empty prompt)", () => {
    render(
      <MessageThread
        {...thread({
          id: "e1",
          specMessage: "",
          facts: FACTS,
          recall: { selectionActive: true, injectedMemoryIds: ["mem_c"] },
        })}
      />,
    );

    expect(screen.queryByRole("article", { name: "User message" })).toBeNull();
    expect(
      screen.getByRole("status", { name: "Recalled 1 of 3 memories" }),
    ).toBeTruthy();
  });
});
