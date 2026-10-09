/**
 * Pins the AI judge's chip in a thread: "Judge: grading…" while the grade
 * is pending, then "Judge: passed" or "Judge: 1 of 2 failed", which opens to
 * each rubric's result and reason and the model that graded it; a run the
 * judge could not grade says so with the reason; a run with no judge score
 * shows no chip. While a grade is pending the thread asks again, and stops
 * once none is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { MessageType, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema, type Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreListSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { MessageThread } from "../../run/MessageThread";
import { PENDING_POLL_FIRST_MS } from "../useSessionScores";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function completedRun(): Run {
  return create(RunSchema, {
    metadata: { id: "run_1", org: "org_acme" },
    spec: { message: "assign the ticket", target: { case: "sessionId", value: "ses_1" } },
    status: {
      phase: RunPhase.RUN_COMPLETED,
      messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "Assigned." })],
    },
  });
}

function judge(state: ScoreState, opts: { passed?: boolean; reason?: string } = {}): Score {
  return create(ScoreSchema, {
    metadata: { id: "scr_judge" },
    spec: {
      runId: "run_1",
      sessionId: "ses_1",
      metric: "judge",
      source: ScoreSource.judge,
      judgeModel: "claude-sonnet-4-6",
      ...(opts.passed === undefined ? {} : { value: { case: "passed", value: opts.passed } }),
      criteria:
        state === ScoreState.graded
          ? [
              {
                name: "did-the-task",
                result: opts.passed === true ? CriterionResult.passed : CriterionResult.failed,
                reason: "said the ticket was assigned, but the assign call failed",
              },
              { name: "made-nothing-up", result: CriterionResult.not_applicable, reason: "no claims" },
            ]
          : [],
    },
    status: { state, notGradedReason: opts.reason ?? "" },
  });
}

function client(answers: Score[][]) {
  const listBySession = vi.fn();
  for (const scores of answers) {
    listBySession.mockResolvedValueOnce(create(ScoreListSchema, { totalCount: scores.length, items: scores }));
  }
  const last = answers[answers.length - 1] ?? [];
  listBySession.mockResolvedValue(create(ScoreListSchema, { totalCount: last.length, items: last }));
  return {
    score: { listBySession, create: vi.fn(), get: vi.fn(), update: vi.fn() },
    identityAccount: {
      whoAmI: vi.fn().mockResolvedValue({ metadata: { id: "ida_me" }, spec: { idpId: "" } }),
    },
  };
}

function wrap(mock: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={mock as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("the judge chip", () => {
  it("opens a failed verdict to each rubric's reason and the model that graded it", async () => {
    render(<MessageThread runs={[completedRun()]} runScores />, {
      wrapper: wrap(client([[judge(ScoreState.graded, { passed: false })]])),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Judge: 1 of 2 failed" }));
    expect(
      screen.getByText("Did the task: failed — said the ticket was assigned, but the assign call failed"),
    ).toBeDefined();
    expect(screen.getByText("Made nothing up: not applicable — no claims")).toBeDefined();
    expect(screen.getByText("Graded by claude-sonnet-4-6")).toBeDefined();
  });

  it("says passed when no rubric failed", async () => {
    render(<MessageThread runs={[completedRun()]} runScores />, {
      wrapper: wrap(client([[judge(ScoreState.graded, { passed: true })]])),
    });
    expect(await screen.findByRole("button", { name: "Judge: passed" })).toBeDefined();
  });

  it("says a run was not graded, with the reason, and never as a failure", async () => {
    render(<MessageThread runs={[completedRun()]} runScores />, {
      wrapper: wrap(client([[judge(ScoreState.not_graded, { reason: "spending limit reached" })]])),
    });
    expect(await screen.findByText("Judge: not graded: spending limit reached")).toBeDefined();
    expect(screen.queryByRole("button", { name: /failed/ })).toBeNull();
  });

  it("shows grading while the grade is pending, asks again, and shows the verdict once it lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = client([[judge(ScoreState.pending)], [judge(ScoreState.graded, { passed: true })]]);
    render(<MessageThread runs={[completedRun()]} runScores />, { wrapper: wrap(mock) });
    expect(await screen.findByText("Judge: grading…")).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_POLL_FIRST_MS + 10);
    });
    expect(await screen.findByRole("button", { name: "Judge: passed" })).toBeDefined();
    const calls = mock.score.listBySession.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_POLL_FIRST_MS * 4);
    });
    expect(mock.score.listBySession.mock.calls.length, "no poll once nothing is pending").toBe(calls);
  });

  it("shows no chip for a run with no judge score", async () => {
    render(<MessageThread runs={[completedRun()]} runScores />, { wrapper: wrap(client([[]])) });
    await screen.findByText("Assigned.");
    expect(screen.queryByText(/Judge:/)).toBeNull();
  });
});
