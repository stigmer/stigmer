/**
 * Pins the rating controls' behaviour around the thread: the note a person
 * adds after a thumb (typed, capped at 500 characters, trimmed, sent with
 * the same thumb), the bounded refetch after a run turns COMPLETED (asked
 * again until both the run's health score and a judge score arrive, then
 * never again; all three times for a run with no judge; cancelled when the
 * view goes away), a thread with no conversation yet
 * asking for nothing, a control outside a thread rendering nothing, and
 * the two write hooks' answers: a refusal other than SCORE_EXISTS is kept
 * and rethrown, a change to one's own rating is sent as the generated
 * input with the new thumb, and either hook's error clears.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
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
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
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
import { buildScoreProto, type ScoreInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { RunScores } from "../RunScores";
import { RunScoresProvider } from "../RunScoresContext";
import { RATING_COMMENT_MAX_LENGTH } from "../rating-input";
import { useRateRun } from "../useRateRun";
import { useUpdateRating } from "../useUpdateRating";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function run(id: string, phase: RunPhase, sessionId = "ses_1"): Run {
  return create(RunSchema, {
    metadata: { id, org: "org_acme" },
    spec:
      sessionId === ""
        ? {}
        : { target: { case: "sessionId", value: sessionId } },
    status: { phase },
  });
}

/** A judge's graded verdict on the run: no pending poll follows it. */
function judged(runId: string): Score {
  return create(ScoreSchema, {
    metadata: { id: "scr_judge" },
    spec: {
      runId,
      sessionId: "ses_1",
      metric: "judge",
      source: ScoreSource.judge,
      value: { case: "passed", value: true },
    },
    status: { state: ScoreState.graded },
  });
}

function flaggedHealth(runId: string): Score {
  return create(ScoreSchema, {
    spec: {
      runId,
      metric: "run-health",
      source: ScoreSource.check,
      value: { case: "passed", value: false },
      criteria: [
        {
          name: "no-repeated-calls",
          result: CriterionResult.failed,
          reason: "echo was called 3 times in a row",
        },
      ],
    },
    status: { state: ScoreState.graded },
  });
}

function list(scores: Score[]) {
  return create(ScoreListSchema, { totalCount: scores.length, items: scores });
}

function client() {
  return {
    score: {
      listBySession: vi.fn().mockResolvedValue(list([])),
      // The server answers with the stored rating: what was sent, as a score.
      create: vi
        .fn()
        .mockImplementation(async (input: ScoreInput) =>
          buildScoreProto(input),
        ),
      get: vi.fn(),
      update: vi.fn().mockImplementation(async () => create(ScoreSchema, {})),
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

function thread(runs: readonly Run[], runId: string) {
  return (
    <RunScoresProvider runs={runs}>
      <RunScores runId={runId} />
    </RunScoresProvider>
  );
}

describe("the rating control", () => {
  it("renders nothing outside a thread that shows run scores", () => {
    const { container } = render(<RunScores runId="run_1" />, {
      wrapper: wrap(client()),
    });
    expect(container.innerHTML).toBe("");
  });

  it("opens a note after a thumb, capped at 500 characters, and sends it trimmed with the same thumb", async () => {
    const mock = client();
    render(thread([run("run_1", RunPhase.RUN_COMPLETED)], "run_1"), {
      wrapper: wrap(mock),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Bad answer" }));
    await waitFor(() => expect(mock.score.create).toHaveBeenCalledTimes(1));

    const note = await screen.findByRole("textbox", {
      name: "Note on this answer",
    });
    expect(note.getAttribute("maxlength")).toBe(
      String(RATING_COMMENT_MAX_LENGTH),
    );
    expect(RATING_COMMENT_MAX_LENGTH).toBe(500);
    fireEvent.change(note, { target: { value: "  picked the wrong label  " } });
    fireEvent.submit(note.closest("form") as HTMLFormElement);

    await waitFor(() => expect(mock.score.create).toHaveBeenCalledTimes(2));
    const sent = buildScoreProto(
      mock.score.create.mock.calls[1]?.[0] as ScoreInput,
    );
    expect(sent.spec?.comment).toBe("picked the wrong label");
    expect(sent.spec?.value).toEqual({ case: "passed", value: false });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("asks for nothing while the thread has no conversation yet", async () => {
    const mock = client();
    render(thread([run("run_1", RunPhase.RUN_COMPLETED, "")], "run_1"), {
      wrapper: wrap(mock),
    });
    await screen.findByRole("button", { name: "Good answer" });
    expect(mock.score.listBySession).not.toHaveBeenCalled();
  });
});

describe("the refetch after a run completes", () => {
  it("asks again until the run's health and judge scores arrive, then stops", async () => {
    const mock = client();
    mock.score.listBySession
      .mockResolvedValueOnce(list([]))
      .mockResolvedValue(list([flaggedHealth("run_1"), judged("run_1")]));
    // A run with no id is skipped, never tracked.
    const unnamed = create(RunSchema, {
      spec: { target: { case: "sessionId", value: "ses_1" } },
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    });
    const view = render(
      thread([run("run_1", RunPhase.RUN_IN_PROGRESS), unnamed], "run_1"),
      { wrapper: wrap(mock) },
    );
    await waitFor(() =>
      expect(mock.score.listBySession).toHaveBeenCalledTimes(1),
    );

    view.rerender(
      thread([run("run_1", RunPhase.RUN_COMPLETED), unnamed], "run_1"),
    );
    expect(
      await screen.findByRole("button", { name: "1 flag" }, { timeout: 2_500 }),
    ).toBeDefined();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
    });
    expect(mock.score.listBySession).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("asks all three times for a run whose agent has no AI grading", async () => {
    const mock = client();
    mock.score.listBySession
      .mockResolvedValueOnce(list([]))
      .mockResolvedValue(list([flaggedHealth("run_1")]));
    const view = render(thread([run("run_1", RunPhase.RUN_IN_PROGRESS)], "run_1"), {
      wrapper: wrap(mock),
    });
    await waitFor(() => expect(mock.score.listBySession).toHaveBeenCalledTimes(1));
    view.rerender(thread([run("run_1", RunPhase.RUN_COMPLETED)], "run_1"));
    await waitFor(() => expect(mock.score.listBySession).toHaveBeenCalledTimes(4), {
      timeout: 6_000,
    });
  }, 12_000);

  it("cancels the schedule when the view goes away", async () => {
    const mock = client();
    const view = render(
      thread([run("run_1", RunPhase.RUN_IN_PROGRESS)], "run_1"),
      {
        wrapper: wrap(mock),
      },
    );
    await waitFor(() =>
      expect(mock.score.listBySession).toHaveBeenCalledTimes(1),
    );
    view.rerender(thread([run("run_1", RunPhase.RUN_COMPLETED)], "run_1"));
    view.unmount();
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    expect(mock.score.listBySession).toHaveBeenCalledTimes(1);
  });
});

describe("the write hooks", () => {
  it("keeps and rethrows a refusal that is not SCORE_EXISTS, and clears it", async () => {
    const mock = client();
    const refusal = new ConnectError(
      "run run_1 has not completed; only a completed run is scored",
      Code.FailedPrecondition,
    );
    mock.score.create.mockRejectedValueOnce(refusal);
    const { result } = renderHook(() => useRateRun(), { wrapper: wrap(mock) });

    await act(async () => {
      await expect(
        result.current.rateRun({
          org: "org_acme",
          runId: "run_1",
          passed: true,
        }),
      ).rejects.toBe(refusal);
    });
    expect(mock.score.get).not.toHaveBeenCalled();
    expect(result.current.error?.message).toContain("has not completed");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("changes one's own rating to the new thumb and comment", async () => {
    const mock = client();
    const mine = create(ScoreSchema, {
      metadata: { id: "scr_mine", org: "org_acme" },
      spec: {
        runId: "run_1",
        metric: "feedback",
        source: ScoreSource.human,
        value: { case: "passed", value: true },
        comment: "fine",
      },
    });
    const { result } = renderHook(() => useUpdateRating(), {
      wrapper: wrap(mock),
    });
    await act(async () => {
      await result.current.updateRating(mine, { passed: false });
    });
    const sent = buildScoreProto(
      mock.score.update.mock.calls[0]?.[0] as ScoreInput,
    );
    expect(sent.metadata?.id).toBe("scr_mine");
    expect(sent.spec?.value).toEqual({ case: "passed", value: false });
    expect(sent.spec?.comment).toBe("");
    expect(result.current.isUpdating).toBe(false);
  });

  it("keeps and rethrows an update's refusal, and clears it", async () => {
    const mock = client();
    const refusal = new ConnectError(
      "only a person's feedback can be changed; a check's verdict is final",
      Code.FailedPrecondition,
    );
    mock.score.update.mockRejectedValueOnce(refusal);
    const { result } = renderHook(() => useUpdateRating(), {
      wrapper: wrap(mock),
    });
    await act(async () => {
      await expect(
        result.current.updateRating(flaggedHealth("run_1"), { passed: true }),
      ).rejects.toBe(refusal);
    });
    expect(result.current.error?.message).toContain("verdict is final");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
