/**
 * Pins the AI judge's parts the server keeps: which runs are sampled, what
 * the judge is shown of a stored run and its session, and the judge run's
 * request. How the parts are rendered, how the judge's answer is read and
 * the version every judge score carries are pinned with the rule set, in
 * @stigmer/eval-runtime.
 *
 * The load-bearing pins:
 *   - sampling is fixed by the run's id and lands near the rate over ten
 *     thousand ids; a rate of 1 picks every run;
 *   - the parts are the request, each top-level call with its canonical
 *     arguments, status name and error, and the answer (the structured
 *     output when delivered); a spilled result is marked cut;
 *   - the earlier turns are the session's runs strictly before the graded
 *     one in the index's order, at most three, oldest first, never a later
 *     run, another session's or another organization's;
 *   - the judge run carries the reserved label, the grade's cap, the
 *     verdict schema, a session subject and the native harness, in the
 *     judged run's organization, under a name fixed by the judged run.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VERDICT_SCHEMA, renderSubject } from "@stigmer/eval-runtime/judge";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  GRADES_RUN_LABEL,
  JUDGE_SESSION_SUBJECT,
  PER_GRADE_CAP_USD,
  isJudgeRun,
  judgeRunName,
  judgeRunRequest,
} from "../judge-run.js";
import { isSampled } from "../sampling.js";
import { earlierRunsOf, subjectPartsOf } from "../subject.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";

function runWith(opts: {
  readonly message?: string;
  readonly calls?: ReadonlyArray<{
    readonly name: string;
    readonly result?: string;
    readonly spilled?: boolean;
    readonly status?: ToolCallStatus;
    readonly error?: string;
  }>;
  readonly answer?: string;
}): Run {
  return create(RunSchema, {
    metadata: { id: "run_01j5q3k7m8r2s4tnz2hfp0q0f5", org: "org_a" },
    spec: { message: opts.message ?? "Assign the ticket to Priya." },
    status: {
      messages: [
        {
          type: MessageType.MESSAGE_AI,
          toolCalls: (opts.calls ?? []).map((call) => ({
            name: call.name,
            result: call.result ?? "",
            status: call.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
            error: call.error ?? "",
            args: { ticket: "T-1" },
            ...(call.spilled === true
              ? { outputRef: { contentHash: "abc", storageKey: "k" } }
              : {}),
          })),
        },
        { type: MessageType.MESSAGE_AI, content: opts.answer ?? "Done." },
      ],
    },
  });
}

describe("sampling", () => {
  it("decides the same way for the same run, every time", () => {
    for (const id of ["run_a", "run_b", "run_c"]) {
      expect(isSampled(id, 0.5)).toBe(isSampled(id, 0.5));
    }
  });

  it("picks about the rate's share of ten thousand runs, every run at 1 and none below 0", () => {
    let picked = 0;
    for (let i = 0; i < 10_000; i++) {
      if (isSampled(`run_${i.toString(36)}`, 0.1)) picked++;
    }
    expect(picked).toBeGreaterThan(900);
    expect(picked).toBeLessThan(1_100);
    expect(isSampled("run_any", 1)).toBe(true);
    expect(isSampled("run_any", 0)).toBe(false);
  });
});

describe("subjectPartsOf", () => {
  it("reads the request, each call with its canonical arguments, status and error, and the answer", () => {
    const parts = subjectPartsOf(
      runWith({
        calls: [
          { name: "assign", result: "assigned" },
          { name: "notify", result: "", status: ToolCallStatus.TOOL_CALL_FAILED, error: "smtp down" },
        ],
        answer: "Assigned and notified.",
      }),
      [],
    );
    expect(parts).toEqual({
      earlierTurns: [],
      request: "Assign the ticket to Priya.",
      toolCalls: [
        { name: "assign", args: '{"ticket":"T-1"}', status: "completed", error: "", result: "assigned", resultCut: false },
        { name: "notify", args: '{"ticket":"T-1"}', status: "failed", error: "smtp down", result: "", resultCut: false },
      ],
      answer: "Assigned and notified.",
    });
  });

  it("marks a spilled result cut, since the run keeps only its preview, and renders it marked", () => {
    const parts = subjectPartsOf(runWith({ calls: [{ name: "fetch", result: "head of the page", spilled: true }] }), []);
    expect(parts.toolCalls[0]?.resultCut).toBe(true);
    const subject = JSON.parse(renderSubject(parts)) as { tool_calls: Array<{ result: string }> };
    expect(subject.tool_calls[0]?.result).toBe("head of the page [cut]");
  });

  it("reads a delivered structured output as the answer", () => {
    const run = runWith({});
    if (run.status !== undefined) run.status.structuredOutput = { label: "bug" };
    expect(subjectPartsOf(run, []).answer).toBe('{"label":"bug"}');
  });

  it("reads each earlier run as its request and final answer, in the order given", () => {
    const first = runWith({ message: "Draft the release note.", answer: "Here is the draft." });
    const second = runWith({ message: "Shorter, please.", answer: "Shorter draft." });
    expect(subjectPartsOf(runWith({ message: "yes, go ahead" }), [first, second]).earlierTurns).toEqual([
      { request: "Draft the release note.", answer: "Here is the draft." },
      { request: "Shorter, please.", answer: "Shorter draft." },
    ]);
  });
});

describe("earlierRunsOf", () => {
  let temp: TempStore;

  beforeEach(() => {
    temp = tempStore();
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  async function seed(id: string, seconds: number, sessionId: string, org = "org_a"): Promise<Run> {
    const run = create(RunSchema, {
      metadata: { id, name: id, slug: id, org },
      spec: { target: { case: "sessionId", value: sessionId }, message: `request ${id}` },
      status: { audit: { specAudit: { createdAt: { seconds: BigInt(seconds), nanos: 0 } } } },
    });
    await temp.store.saveResource(ApiResourceKind.run, id, RunSchema, run);
    return run;
  }

  it("reads up to three runs before the graded one in its session, oldest first, never a later one or another session's", async () => {
    for (let i = 1; i <= 5; i++) {
      await seed(`run_${i}`, 1_000 + i, "ses_1");
    }
    await seed("run_other", 1_002, "ses_2");
    await seed("run_other_org", 1_002, "ses_1", "org_b");
    const graded = await seed("run_6", 1_006, "ses_1");
    await seed("run_7", 1_007, "ses_1");
    const earlier = await earlierRunsOf(temp.store, graded);
    expect(earlier.map((run) => run.metadata?.id)).toEqual(["run_3", "run_4", "run_5"]);
    const second = await seed("run_b", 2_000, "ses_3");
    await seed("run_a", 1_999, "ses_3");
    expect((await earlierRunsOf(temp.store, second)).map((run) => run.metadata?.id)).toEqual(["run_a"]);
    expect(await earlierRunsOf(temp.store, await seed("run_first", 3_000, "ses_4"))).toEqual([]);
  });

  it("reads none for a run with no session", async () => {
    expect(await earlierRunsOf(temp.store, create(RunSchema, { metadata: { id: "run_x", org: "org_a" } }))).toEqual([]);
  });
});

describe("the judge run", () => {
  it("is labelled, capped, shaped and named for the run it grades", () => {
    const judged = runWith({});
    const request = judgeRunRequest({
      judged,
      modelName: "claude-haiku-4-5",
      message: "grade this",
      verdictSchema: VERDICT_SCHEMA,
    });
    expect(request.metadata?.org).toBe("org_a");
    expect(request.metadata?.name).toBe("grade-run-01j5q3k7m8r2s4tnz2hfp0q0f5");
    expect(judgeRunName("run_01J5")).toBe("grade-run-01j5");
    expect(request.metadata?.labels[GRADES_RUN_LABEL]).toBe("run_01j5q3k7m8r2s4tnz2hfp0q0f5");
    expect(isJudgeRun(request)).toBe(true);
    expect(isJudgeRun(judged)).toBe(false);
    expect(request.spec?.runConfig?.maxCostUsd).toBe(PER_GRADE_CAP_USD);
    expect(request.spec?.runConfig?.modelName).toBe("claude-haiku-4-5");
    expect(request.spec?.structuredOutputSchema).toEqual(VERDICT_SCHEMA);
    const target = request.spec?.target;
    expect(target?.case).toBe("sessionSpec");
    if (target?.case === "sessionSpec") {
      expect(target.value.subject).toBe(JUDGE_SESSION_SUBJECT);
      expect(target.value.harness).toBe(Harness.NATIVE);
      expect(target.value.agentRef, "a judge runs no agent of the organization's").toBeUndefined();
    }
  });
});
