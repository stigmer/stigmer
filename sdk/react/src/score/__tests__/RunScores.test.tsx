/**
 * Pins the run-score surface inside a thread: a thread with run scores off
 * (the guest and embedded audiences) makes no score request and renders no
 * control; with them on, the session's scores are read once, the final
 * answer of a completed run carries the thumbs and the health chip, the
 * chip opens to each flag's reason, a run the platform could not grade
 * says so, and a thumbs-down is sent as a feedback score whose value is
 * false. A second rating the server refuses with SCORE_EXISTS changes the
 * existing one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  RunSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import {
  MessageType,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  ScoreSchema,
  type Score,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreListSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { buildScoreProto, type ScoreInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { MessageThread } from "../../run/MessageThread";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function completedRun(id: string, answer: string): Run {
  return create(RunSchema, {
    metadata: { id, org: "org_acme" },
    spec: {
      message: "triage last night's tickets",
      target: { case: "sessionId", value: "ses_1" },
    },
    status: {
      phase: RunPhase.RUN_COMPLETED,
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: answer,
        }),
      ],
    },
  });
}

function flaggedHealth(runId: string): Score {
  return create(ScoreSchema, {
    metadata: { id: "scr_health" },
    spec: {
      runId,
      sessionId: "ses_1",
      metric: "run-health",
      source: ScoreSource.check,
      value: { case: "passed", value: false },
      criteria: [
        { name: "no-repeated-calls", result: CriterionResult.passed },
        {
          name: "last-action-succeeded",
          result: CriterionResult.failed,
          reason: "ended on a failed action: create_ticket (step 7)",
        },
      ],
    },
    status: { state: ScoreState.graded },
  });
}

function client(scores: Score[]) {
  return {
    score: {
      listBySession: vi
        .fn()
        .mockResolvedValue(
          create(ScoreListSchema, { totalCount: scores.length, items: scores }),
        ),
      create: vi
        .fn()
        .mockImplementation(async () => create(ScoreSchema, {})),
      get: vi.fn(),
      update: vi
        .fn()
        .mockImplementation(async () => create(ScoreSchema, {})),
    },
    identityAccount: {
      whoAmI: vi
        .fn()
        .mockResolvedValue({ metadata: { id: "ida_me" }, spec: { idpId: "" } }),
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

describe("run scores in a thread", () => {
  it("makes no score request and renders no control when run scores are off", async () => {
    const mock = client([flaggedHealth("run_1")]);
    render(
      <MessageThread runs={[completedRun("run_1", "Labelled 12 tickets.")]} />,
      {
        wrapper: wrap(mock),
      },
    );
    await screen.findByText("Labelled 12 tickets.");
    expect(mock.score.listBySession).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
  });

  it("reads the session's scores once and shows thumbs and the flag chip", async () => {
    const mock = client([flaggedHealth("run_1")]);
    render(
      <MessageThread
        runs={[completedRun("run_1", "Labelled 12 tickets.")]}
        runScores
      />,
      { wrapper: wrap(mock) },
    );

    const chip = await screen.findByRole("button", { name: "1 flag" });
    expect(mock.score.listBySession).toHaveBeenCalledTimes(1);
    expect(mock.score.listBySession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "ses_1" }),
    );
    expect(screen.getByRole("button", { name: "Good answer" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Bad answer" })).toBeDefined();

    fireEvent.click(chip);
    expect(
      screen.getByText("ended on a failed action: create_ticket (step 7)"),
    ).toBeDefined();
  });

  it("says a run was not graded, with the reason", async () => {
    const notGraded = create(ScoreSchema, {
      spec: { runId: "run_1", metric: "run-health", source: ScoreSource.check },
      status: {
        state: ScoreState.not_graded,
        notGradedReason: "grading could not start",
      },
    });
    render(
      <MessageThread runs={[completedRun("run_1", "Done.")]} runScores />,
      { wrapper: wrap(client([notGraded])) },
    );
    expect(
      await screen.findByText("Not graded: grading could not start"),
    ).toBeDefined();
  });

  it("records a thumbs-down as a rating of false on the run's organization", async () => {
    const mock = client([]);
    render(
      <MessageThread runs={[completedRun("run_1", "Done.")]} runScores />,
      {
        wrapper: wrap(mock),
      },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Bad answer" }));
    await waitFor(() =>
      expect(mock.score.create).toHaveBeenCalledTimes(1),
    );
    // What the SDK sends for the input the hook passed: a thumbs-down is a
    // set `false`, never a missing value.
    const sent = buildScoreProto(mock.score.create.mock.calls[0]?.[0] as ScoreInput);
    expect(sent.metadata?.org).toBe("org_acme");
    expect(sent.spec?.runId).toBe("run_1");
    expect(sent.spec?.metric).toBe("feedback");
    expect(sent.spec?.source).toBe(ScoreSource.human);
    expect(sent.spec?.value).toEqual({ case: "passed", value: false });
  });

  it("changes the existing rating when the server says this person already rated", async () => {
    const mock = client([]);
    const existing = create(ScoreSchema, {
      metadata: { id: "scr_mine", org: "org_acme" },
      spec: {
        runId: "run_1",
        metric: "feedback",
        source: ScoreSource.human,
        value: { case: "passed", value: false },
      },
    });
    mock.score.create.mockRejectedValueOnce(
      new ConnectError(
        "you already rated this run",
        Code.AlreadyExists,
        undefined,
        [
          {
            desc: ErrorInfoSchema,
            value: {
              reason: "SCORE_EXISTS",
              domain: "stigmer.ai",
              metadata: { score_id: "scr_mine" },
            },
          },
        ],
      ),
    );
    mock.score.get.mockResolvedValue(existing);
    render(
      <MessageThread runs={[completedRun("run_1", "Done.")]} runScores />,
      {
        wrapper: wrap(mock),
      },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Good answer" }));
    await waitFor(() =>
      expect(mock.score.update).toHaveBeenCalledTimes(1),
    );
    expect(mock.score.get).toHaveBeenCalledWith("scr_mine");
    const changed = buildScoreProto(mock.score.update.mock.calls[0]?.[0] as ScoreInput);
    expect(changed.metadata?.id).toBe("scr_mine");
    expect(changed.spec?.value).toEqual({ case: "passed", value: true });
  });
});
