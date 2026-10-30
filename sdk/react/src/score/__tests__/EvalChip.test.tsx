/**
 * Pins an eval run's try in a thread: the eval chip says "Eval: passed"
 * or "Eval: 1 of 2 failed" and opens to each check's verdict and reason
 * (an indicator-only check is not applicable, not a failure); a try that
 * was not graded says why. "Make a test case" is pinned by
 * MakeTestCasePanel.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  type Run,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  ScoreSchema,
  type Score,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreListSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/io_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { MessageThread } from "../../run/MessageThread";
import type { Turn } from "@stigmer/client";
import { samples } from "@stigmer/react-core/test";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** A thread of completed turns, each `[runId, message]`: the runs' records and their events, folded. */
function completedTurns(...turns: Array<[string, string]>): { turns: readonly Turn[]; runs: Run[] } {
  const runs = turns.map(([id, message]) =>
    create(RunSchema, {
      metadata: { id, org: "org_acme" },
      spec: { message, target: { case: "sessionId", value: "ses_1" } },
      status: { phase: RunPhase.RUN_COMPLETED },
    }),
  );
  const events = turns.flatMap(([id, message]) =>
    samples.turnEvents({ runId: id, message, reply: `Answer to ${message}.` }),
  );
  return { turns: samples.fold(events).turns, runs };
}

function evalScore(state: ScoreState, passed: boolean, reason = ""): Score {
  return create(ScoreSchema, {
    metadata: { id: "scr_eval" },
    spec: {
      runId: "run_1",
      sessionId: "ses_1",
      metric: "eval",
      source: ScoreSource.eval,
      value: { case: "passed", value: passed },
      criteria:
        state === ScoreState.graded
          ? [
              {
                name: "criteria",
                result: passed
                  ? CriterionResult.passed
                  : CriterionResult.failed,
                reason: "the reply missed the null check",
              },
              {
                name: "skill-fired",
                result: CriterionResult.not_applicable,
                reason: "indicator only",
              },
            ]
          : [],
    },
    status: { state, notGradedReason: reason },
  });
}

function client(scores: Score[]) {
  return {
    score: {
      listBySession: vi.fn(async () =>
        create(ScoreListSchema, { entries: scores, nextPageToken: "" }),
      ),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
    identityAccount: {
      whoAmI: vi.fn(async () => ({
        metadata: { id: "ida_me" },
        spec: { idpId: "" },
      })),
    },
  };
}

function wrap(mock: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={mock as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("the eval chip", () => {
  it("opens a failed try to each check's verdict and reason", async () => {
    render(
      <MessageThread
        {...completedTurns(["run_1", "look over my diff"])}
        runScores
      />,
      {
        wrapper: wrap(client([evalScore(ScoreState.graded, false)])),
      },
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Eval: 1 of 2 failed" }),
    );
    expect(
      screen.getByText("criteria: failed — the reply missed the null check"),
    ).toBeDefined();
    expect(
      screen.getByText("skill-fired: not applicable — indicator only"),
    ).toBeDefined();
  });

  it("says passed, and says why a try was not graded", async () => {
    render(
      <MessageThread
        {...completedTurns(["run_1", "look over my diff"])}
        runScores
      />,
      {
        wrapper: wrap(client([evalScore(ScoreState.graded, true)])),
      },
    );
    expect(
      await screen.findByRole("button", { name: "Eval: passed" }),
    ).toBeDefined();
    cleanup();
    render(
      <MessageThread
        {...completedTurns(["run_1", "look over my diff"])}
        runScores
      />,
      {
        wrapper: wrap(
          client([evalScore(ScoreState.not_graded, false, "platform busy")]),
        ),
      },
    );
    expect(
      await screen.findByText("Eval: not graded: platform busy"),
    ).toBeDefined();
  });
});
