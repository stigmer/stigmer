/**
 * Pins a plugin eval's try in a thread: the eval chip says "Eval: passed"
 * or "Eval: 1 of 2 failed" and opens to each check's verdict and reason
 * (an indicator-only check is not applicable, not a failure); a try that
 * was not graded says why. And "Make a test case" on a completed run
 * downloads the run as a case folder zip named after its request, its FAIL
 * line seeded from the failing check, with the multi-turn note on a run
 * that followed another.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { strFromU8, unzipSync } from "fflate";
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
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { MessageThread } from "../../run/MessageThread";

const download = vi.hoisted(() => ({
  downloadBinaryFile: vi.fn(),
  downloadTextFile: vi.fn(),
}));
vi.mock("../../internal/download.js", () => download);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function completedRun(id: string, message: string): Run {
  return create(RunSchema, {
    metadata: { id, org: "org_acme" },
    spec: { message, target: { case: "sessionId", value: "ses_1" } },
    status: {
      phase: RunPhase.RUN_COMPLETED,
      messages: [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          content: `Answer to ${message}.`,
        }),
      ],
    },
  });
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
        create(ScoreListSchema, { totalCount: scores.length, items: scores }),
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
        runs={[completedRun("run_1", "look over my diff")]}
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
        runs={[completedRun("run_1", "look over my diff")]}
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
        runs={[completedRun("run_1", "look over my diff")]}
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

describe("Make a test case", () => {
  it("downloads the run as a case folder, its FAIL line from the failing check", async () => {
    render(
      <MessageThread
        runs={[completedRun("run_1", "look over my diff")]}
        runScores
      />,
      {
        wrapper: wrap(client([evalScore(ScoreState.graded, false)])),
      },
    );
    await screen.findByRole("button", { name: "Eval: 1 of 2 failed" });
    fireEvent.click(screen.getByRole("button", { name: "Make a test case" }));
    expect(download.downloadBinaryFile).toHaveBeenCalledTimes(1);
    const [bytes, filename, mime] = download.downloadBinaryFile.mock
      .calls[0] as [Uint8Array, string, string];
    expect([filename, mime]).toEqual([
      "look-over-my-diff.zip",
      "application/zip",
    ]);
    const entries = unzipSync(bytes);
    expect(strFromU8(entries["look-over-my-diff/prompt.md"]!)).toContain(
      "look over my diff\n",
    );
    expect(
      strFromU8(entries["look-over-my-diff/graders/criteria.md"]!),
    ).toContain("the reply missed the null check.");
    expect(screen.queryByText(/resumed conversations/)).toBeNull();
  });

  it("says a case from a follow-up run holds only its last request", async () => {
    render(
      <MessageThread
        runs={[
          completedRun("run_0", "first ask"),
          completedRun("run_1", "then this"),
        ]}
        runScores
      />,
      { wrapper: wrap(client([])) },
    );
    const buttons = await screen.findAllByRole("button", {
      name: "Make a test case",
    });
    fireEvent.click(buttons[1]!);
    expect(
      await screen.findByText(/resumed conversations are not run yet/),
    ).toBeDefined();
    expect(download.downloadBinaryFile.mock.calls[0]?.[1]).toBe(
      "then-this.zip",
    );
  });
});
