/**
 * Pins the score chain's own steps, one by one, against the callers and
 * runs that reach them:
 *   - GuardScoreSource admits a person's feedback from a first-party
 *     person (a sign-in or the person's own API key) and refuses it from
 *     the server, a runner, a machine account, a PlatformClient user token
 *     and an in-process propagated person; it admits a check from the
 *     server alone;
 *   - the create lane asks can_view on the run named in spec.run_id, and a
 *     server-composed request asks nothing;
 *   - ResolveScoreDefaults ties a score to its run: the run's organization,
 *     a completed run, a metric that agrees with the source, no comment or
 *     criteria on a check, thumbs on feedback; it fills session_id from the
 *     run and names an unnamed score by its minted id;
 *   - InitializeScoreState stamps graded when a value was given and not
 *     graded otherwise, keeping a reason only from the server's own check;
 *   - ValidateScoreUpdate changes a person's thumbs and comment and nothing
 *     else, and never a check's verdict.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  CHECK_SOURCE_REFUSED_MESSAGE,
  FEEDBACK_VALUE_REQUIRED_MESSAGE,
  HUMAN_SOURCE_REFUSED_MESSAGE,
  SCORE_COMMENT_HUMAN_ONLY_MESSAGE,
  SCORE_CREATE_DENIED_MESSAGE,
  SCORE_CRITERIA_NOT_HUMAN_MESSAGE,
  SCORE_METRIC_SOURCE_MISMATCH_MESSAGE,
  SCORE_UPDATE_FIELDS_MESSAGE,
  SCORE_UPDATE_HUMAN_ONLY_MESSAGE,
  runNotCompletedMessage,
  scoreOrgMismatchMessage,
} from "../constants.js";
import {
  SCORED_RUN_KEY,
  newGuardScoreSourceStep,
  newInitializeScoreStateStep,
  newResolveScoreDefaultsStep,
  newValidateScoreUpdateStep,
  resolveScoreCreateTargets,
} from "../steps.js";

/** A JWT-shaped bearer; GuardScoreSource reads only its claims. */
function jwtWith(payload: Record<string, unknown>): string {
  const segment = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "RS256", typ: "JWT" })}.${segment(payload)}.signature`;
}

const PERSON = testCallerIdentity({ identityId: "ida_person", origin: "wire" });

function feedback(
  fields: Partial<{
    comment: string;
    passed: boolean | undefined;
    org: string;
  }> = {},
): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: { org: fields.org ?? "org_1" },
    spec: {
      runId: "run_1",
      sessionId: "ses_forged",
      metric: "feedback",
      source: ScoreSource.human,
      ...("passed" in fields && fields.passed === undefined
        ? {}
        : { value: { case: "passed", value: fields.passed ?? false } }),
      comment: fields.comment ?? "",
    },
  });
}

function check(
  fields: Partial<{
    comment: string;
    criteria: boolean;
    reason: string;
    graded: boolean;
  }> = {},
): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: { org: "org_1" },
    spec: {
      runId: "run_1",
      metric: "run-health",
      source: ScoreSource.check,
      evaluatorVersion: "v1",
      ...(fields.graded === false
        ? {}
        : { value: { case: "passed", value: true } }),
      comment: fields.comment ?? "",
      criteria:
        fields.criteria === true
          ? [{ name: "no-repeated-calls", result: CriterionResult.passed }]
          : [],
    },
    ...(fields.reason === undefined
      ? {}
      : { status: { notGradedReason: fields.reason } }),
  });
}

function runIn(phase: RunPhase, org = "org_1"): Run {
  return create(RunSchema, {
    metadata: { id: "run_1", org },
    spec: { target: { case: "sessionId", value: "ses_1" } },
    status: { phase },
  });
}

function ctxFor(score: Score, caller: CallerIdentity, run?: Run) {
  const ctx = new RequestContext(
    ScoreSchema,
    score,
    caller,
    ApiResourceKind.score,
  );
  if (run !== undefined) {
    ctx.set(SCORED_RUN_KEY, run);
  }
  return ctx;
}

/** What BuildNewState does to a create's status between the two steps. */
function wipeStatus(score: Score): void {
  score.status = undefined;
}

async function refusal(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

describe("GuardScoreSource", () => {
  const guard = newGuardScoreSourceStep();

  it("admits a person's feedback from their sign-in and from their own API key", () => {
    expect(() => guard.execute(ctxFor(feedback(), PERSON))).not.toThrow();
    expect(() =>
      guard.execute(
        ctxFor(feedback(), { ...PERSON, rawToken: "stg_live_personal_key" }),
      ),
    ).not.toThrow();
  });

  it.each<[string, Partial<CallerIdentity>]>([
    ["the server itself", { callerClass: "internal", origin: "in-process" }],
    ["a runner", { callerClass: "runner" }],
    ["a machine account", { callerClass: "machine" }],
    ["a person propagated in process", { origin: "in-process" }],
    [
      "a PlatformClient user token",
      {
        issuer: "stigmer",
        rawToken: jwtWith({
          iss: "stigmer",
          sub: "ida_person",
          platform_client_id: "pc_1",
        }),
      },
    ],
  ])("refuses a person's feedback from %s", async (_label, fields) => {
    const failure = await refusal(() =>
      guard.execute(ctxFor(feedback(), { ...PERSON, ...fields })),
    );
    expect(failure.code).toBe(Code.PermissionDenied);
    expect(failure.rawMessage).toBe(HUMAN_SOURCE_REFUSED_MESSAGE);
  });

  it("admits a check from the server alone", async () => {
    expect(() =>
      guard.execute(
        ctxFor(check(), testCallerIdentity({ callerClass: "internal" })),
      ),
    ).not.toThrow();
    for (const fields of [
      {},
      { callerClass: "runner" },
      { callerClass: "machine" },
    ]) {
      const failure = await refusal(() =>
        guard.execute(ctxFor(check(), { ...PERSON, ...fields })),
      );
      expect(failure.code).toBe(Code.PermissionDenied);
      expect(failure.rawMessage).toBe(CHECK_SOURCE_REFUSED_MESSAGE);
    }
  });

  it("refuses a score with no source", async () => {
    const score = feedback();
    score.spec!.source = ScoreSource.unspecified;
    expect(
      (await refusal(() => guard.execute(ctxFor(score, PERSON)))).code,
    ).toBe(Code.InvalidArgument);
  });
});

describe("resolveScoreCreateTargets", () => {
  it("asks can_view on the named run for a wire caller", () => {
    expect(resolveScoreCreateTargets(ctxFor(feedback(), PERSON))).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.run,
        resourceId: "run_1",
        deniedMessage: SCORE_CREATE_DENIED_MESSAGE,
      },
    ]);
  });

  it("asks nothing for a server-composed request", () => {
    expect(
      resolveScoreCreateTargets(
        ctxFor(check(), testCallerIdentity({ callerClass: "internal" })),
      ),
    ).toEqual([]);
  });
});

describe("ResolveScoreDefaults", () => {
  const step = newResolveScoreDefaultsStep();
  const completed = runIn(RunPhase.RUN_COMPLETED);

  it("fills session_id from the run and names an unnamed score by its id", () => {
    const ctx = ctxFor(feedback(), PERSON, completed);
    step.execute(ctx);
    expect(ctx.newState.spec?.sessionId).toBe("ses_1");
    expect(ctx.newState.metadata?.id).toMatch(/^scr_/);
    expect(ctx.newState.metadata?.name).toBe(ctx.newState.metadata?.id);
  });

  it("refuses a run that has not completed, with the pinned copy", async () => {
    for (const phase of [
      RunPhase.RUN_PENDING,
      RunPhase.RUN_IN_PROGRESS,
      RunPhase.RUN_FAILED,
    ]) {
      const failure = await refusal(() =>
        step.execute(ctxFor(feedback(), PERSON, runIn(phase))),
      );
      expect(failure.code).toBe(Code.FailedPrecondition);
      expect(failure.rawMessage).toBe(runNotCompletedMessage("run_1"));
    }
  });

  it("refuses an organization that is not the run's", async () => {
    const failure = await refusal(() =>
      step.execute(ctxFor(feedback({ org: "org_2" }), PERSON, completed)),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(scoreOrgMismatchMessage("org_1"));
  });

  it("refuses a metric the source does not give", async () => {
    const wrong = feedback();
    wrong.spec!.metric = "run-health";
    const failure = await refusal(() =>
      step.execute(ctxFor(wrong, PERSON, completed)),
    );
    expect(failure.code).toBe(Code.InvalidArgument);
    expect(failure.rawMessage).toBe(SCORE_METRIC_SOURCE_MISMATCH_MESSAGE);
  });

  it("refuses a comment or criteria where they do not belong, and feedback without thumbs", async () => {
    const internal = testCallerIdentity({ callerClass: "internal" });
    expect(
      (
        await refusal(() =>
          step.execute(ctxFor(check({ comment: "nice" }), internal, completed)),
        )
      ).rawMessage,
    ).toBe(SCORE_COMMENT_HUMAN_ONLY_MESSAGE);
    const withCriteria = feedback();
    withCriteria.spec!.criteria = check({ criteria: true }).spec!.criteria;
    expect(
      (
        await refusal(() =>
          step.execute(ctxFor(withCriteria, PERSON, completed)),
        )
      ).rawMessage,
    ).toBe(SCORE_CRITERIA_NOT_HUMAN_MESSAGE);
    expect(
      (
        await refusal(() =>
          step.execute(
            ctxFor(feedback({ passed: undefined }), PERSON, completed),
          ),
        )
      ).rawMessage,
    ).toBe(FEEDBACK_VALUE_REQUIRED_MESSAGE);
  });
});

describe("InitializeScoreState", () => {
  const defaults = newResolveScoreDefaultsStep();
  const init = newInitializeScoreStateStep();
  const completed = runIn(RunPhase.RUN_COMPLETED);
  const internal = testCallerIdentity({ callerClass: "internal" });

  it("stamps graded when a value was given, even a false one", () => {
    const ctx = ctxFor(feedback({ passed: false }), PERSON, completed);
    defaults.execute(ctx);
    init.execute(ctx);
    expect(ctx.newState.status?.state).toBe(ScoreState.graded);
    expect(ctx.newState.status?.notGradedReason).toBe("");
  });

  it("keeps the server check's not-graded reason across the status wipe", () => {
    const ctx = ctxFor(
      check({ graded: false, reason: "grading could not start" }),
      internal,
      completed,
    );
    defaults.execute(ctx);
    // BuildNewState discards the request's status between the two steps.
    wipeStatus(ctx.newState);
    init.execute(ctx);
    expect(ctx.newState.status?.state).toBe(ScoreState.not_graded);
    expect(ctx.newState.status?.notGradedReason).toBe(
      "grading could not start",
    );
  });

  it("keeps no reason a person sent on their feedback", () => {
    const score = feedback({ passed: true });
    score.status = create(ScoreStatusSchema, {
      state: ScoreState.not_graded,
      notGradedReason: "forged",
    });
    const ctx = ctxFor(score, PERSON, completed);
    defaults.execute(ctx);
    wipeStatus(ctx.newState);
    init.execute(ctx);
    expect(ctx.newState.status?.state).toBe(ScoreState.graded);
    expect(ctx.newState.status?.notGradedReason).toBe("");
  });
});

describe("ValidateScoreUpdate", () => {
  const step = newValidateScoreUpdateStep();

  function updateCtx(existing: Score, next: Score) {
    const ctx = ctxFor(next, PERSON);
    ctx.set(EXISTING_RESOURCE_KEY, existing);
    return ctx;
  }

  it("changes a person's thumbs and comment", () => {
    const next = feedback({ passed: true, comment: "fine after all" });
    expect(() => step.execute(updateCtx(feedback(), next))).not.toThrow();
  });

  it("never changes a check's verdict", async () => {
    const failure = await refusal(() =>
      step.execute(updateCtx(check(), check())),
    );
    expect(failure.code).toBe(Code.FailedPrecondition);
    expect(failure.rawMessage).toBe(SCORE_UPDATE_HUMAN_ONLY_MESSAGE);
  });

  it("refuses a change of run, metric or source", async () => {
    for (const mutate of [
      (s: Score) => (s.spec!.runId = "run_2"),
      (s: Score) => (s.spec!.metric = "run-health"),
      (s: Score) => (s.spec!.source = ScoreSource.check),
    ]) {
      const next = feedback();
      mutate(next);
      const failure = await refusal(() =>
        step.execute(updateCtx(feedback(), next)),
      );
      expect(failure.rawMessage).toBe(SCORE_UPDATE_FIELDS_MESSAGE);
    }
  });

  it("keeps a rating's name and labels as created", async () => {
    for (const mutate of [
      (s: Score) => (s.metadata!.name = "renamed"),
      (s: Score) => (s.metadata!.labels = { team: "support" }),
    ]) {
      const next = feedback();
      mutate(next);
      const failure = await refusal(() =>
        step.execute(updateCtx(feedback(), next)),
      );
      expect(failure.rawMessage).toBe(SCORE_UPDATE_FIELDS_MESSAGE);
    }
    const labelled = feedback();
    labelled.metadata!.labels = { team: "support" };
    const same = feedback();
    same.metadata!.labels = { team: "support" };
    expect(() => step.execute(updateCtx(labelled, same))).not.toThrow();
  });

  it("refuses removing the thumbs", async () => {
    const failure = await refusal(() =>
      step.execute(updateCtx(feedback(), feedback({ passed: undefined }))),
    );
    expect(failure.rawMessage).toBe(FEEDBACK_VALUE_REQUIRED_MESSAGE);
  });
});
