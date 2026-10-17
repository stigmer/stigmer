/**
 * Pins an agent's quality report and flagged list (../quality.ts) and the
 * stamp that makes them possible (StampScoredRun, ../steps.ts).
 *
 * Pure and fake-backed pins:
 *   - the tally: each metric's passed, failed, not graded and pending; a
 *     person's thumbs as feedback; two evaluator versions kept apart, the
 *     most recently seen first; two agent versions; UTC day boundaries; a
 *     stampless row, a row before the window and an eval score skipped;
 *   - the agreement: each thumbs set against each rubric that passed or
 *     failed on the same run, per judge version, the newest first; a rubric
 *     that did not apply, a run with a judge grade and no thumbs, thumbs on
 *     a run with no judge grade, a pending or not-graded judge score and a
 *     grade before the window count nothing; a thumbs down where no rubric
 *     failed is counted apart;
 *   - the window: 0 is 30 days, ending on today's UTC day;
 *   - the bound: a read past QUALITY_REPORT_MAX_SCORES is refused with
 *     FAILED_PRECONDITION naming a shorter window; an undecodable row is
 *     skipped and a store fault is INTERNAL;
 *   - the session scope: one store read per session per request, one
 *     scope question per session, a refused or vanished session's scores
 *     dropped, nothing read without a scope, for the server itself or for
 *     a score that names no session; a store fault is INTERNAL.
 *
 * Composed pins, trusted local (the real stack, runs stored as an engine
 * leaves them):
 *   - a score records its run's agent and version, whatever status the
 *     client sent; a person's thumbs on an
 *     eval's try is accepted and labelled, and a feedback update keeps all
 *     three (a client introducing the label is refused under the built-in
 *     posture, quality-authorization-composed.test.ts);
 *   - the report counts the agent's live runs only, never a try's thumbs
 *     or an eval score, and its bytes carry no reason, comment or judge
 *     model (the no-text proof);
 *   - the flagged list keeps every failed grade on trusted local and pages
 *     with a token;
 *   - an empty agent id and a window past 90 days are INVALID_ARGUMENT;
 *   - a person's thumbs naming an evaluator version is INVALID_ARGUMENT:
 *     thumbs are tallied per version, so one forged version would split
 *     them and carry the person's text onto the agent's page.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toBinary, toJsonString } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreCommandController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/command_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import { AgentQualityReportSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/io_pb";
import type {
  AgentQualityReport,
  QualitySummary,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/io_pb";
import { ScoreQueryController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/query_pb";
import { ScoreStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/score/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../../../extensions/list-read-scope.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { generateId } from "../../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import type { ListIndexRow } from "../../../store/list-index.js";
import { EVAL_RUN_LABEL } from "../../eval-run/constants.js";
import { SCORE_EVALUATOR_VERSION_NOT_HUMAN_MESSAGE } from "../constants.js";
import {
  QUALITY_REPORT_BATCH,
  QUALITY_REPORT_KEY,
  QUALITY_REPORT_MAX_SCORES,
  QualityTally,
  isFlagged,
  newTallyAgentQualityStep,
  qualityReportTooLargeMessage,
  qualityWindowOf,
  sessionReadScope,
} from "../quality.js";

const NOW = new Date("2026-10-12T15:00:00Z");
const PERSON: CallerIdentity = {
  identityId: "acc_person",
  callerClass: "user",
  issuer: "test",
  rawToken: "",
};

interface ScoreFixture {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly metric?: "run-health" | "judge" | "feedback" | "eval";
  readonly evaluatorVersion?: string;
  readonly passed?: boolean;
  readonly state?: ScoreState;
  readonly criteria?: ReadonlyArray<readonly [string, CriterionResult]>;
  readonly at?: string;
  readonly agentVersionHash?: string;
}

const SOURCES = {
  "run-health": ScoreSource.check,
  judge: ScoreSource.judge,
  feedback: ScoreSource.human,
  eval: ScoreSource.eval,
} as const;

/** A stored score as the create chain leaves it, built by hand. */
function scoreOf(fixture: ScoreFixture): Score {
  const metric = fixture.metric ?? "run-health";
  const state = fixture.state ?? ScoreState.graded;
  return create(ScoreSchema, {
    metadata: { id: generateId("scr"), org: "org_a" },
    spec: {
      runId: fixture.runId ?? generateId("run"),
      sessionId: fixture.sessionId ?? "ses_one",
      metric,
      source: SOURCES[metric],
      evaluatorVersion: fixture.evaluatorVersion ?? "",
      ...(state === ScoreState.graded
        ? { value: { case: "passed", value: fixture.passed ?? true } }
        : {}),
      criteria: (fixture.criteria ?? []).map(([name, result]) => ({
        name,
        result,
      })),
    },
    status: {
      state,
      agentId: "agt_one",
      agentVersionHash: fixture.agentVersionHash ?? "hash-a",
      ...(fixture.at === undefined
        ? {}
        : {
            audit: {
              specAudit: {
                createdAt: timestampFromMs(Date.parse(fixture.at)),
              },
            },
          }),
    },
  });
}

function tallyOf(summary: QualitySummary | undefined, metric: string) {
  return summary?.metrics.filter((m) => m.metric === metric) ?? [];
}

describe("the window", () => {
  it("counts 30 UTC days ending today when none is named", () => {
    const window = qualityWindowOf(0, NOW);
    expect(window.days).toBe(30);
    expect(window.toDate).toBe("2026-10-12");
    expect(window.fromDate).toBe("2026-09-13");
    expect(window.since.startsWith("2026-09-13T00:00:00.")).toBe(true);
  });

  it("counts one day as today alone, whatever the hour", () => {
    const window = qualityWindowOf(1, new Date("2026-10-12T00:00:01Z"));
    expect(window.fromDate).toBe("2026-10-12");
    expect(window.toDate).toBe("2026-10-12");
  });
});

describe("the tally", () => {
  it("counts each metric's outcomes and its criteria, thumbs as feedback", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    const at = "2026-10-12T10:00:00Z";
    tally.add(scoreOf({ runId: "run_1", evaluatorVersion: "c1", at }));
    tally.add(
      scoreOf({
        runId: "run_2",
        evaluatorVersion: "c1",
        passed: false,
        criteria: [
          ["no-repeated-calls", CriterionResult.failed],
          ["ended-cleanly", CriterionResult.passed],
        ],
        at,
      }),
    );
    tally.add(
      scoreOf({
        runId: "run_3",
        evaluatorVersion: "c1",
        state: ScoreState.not_graded,
        at,
      }),
    );
    tally.add(
      scoreOf({
        runId: "run_1",
        metric: "judge",
        evaluatorVersion: "j1",
        state: ScoreState.pending,
        at,
      }),
    );
    tally.add(
      scoreOf({
        runId: "run_2",
        metric: "judge",
        evaluatorVersion: "j1",
        passed: false,
        criteria: [
          ["did-the-task", CriterionResult.failed],
          ["made-nothing-up", CriterionResult.not_applicable],
        ],
        at,
      }),
    );
    tally.add(scoreOf({ runId: "run_1", metric: "feedback", at }));
    tally.add(
      scoreOf({ runId: "run_2", metric: "feedback", passed: false, at }),
    );

    const report = tally.build();
    expect(report.total?.runs).toBe(3);
    const [health] = tallyOf(report.total, "run-health");
    expect(health).toMatchObject({
      evaluatorVersion: "c1",
      passed: 1,
      failed: 1,
      notGraded: 1,
      pending: 0,
    });
    expect(health?.criteria.map((c) => c.name)).toEqual([
      "ended-cleanly",
      "no-repeated-calls",
    ]);
    expect(health?.criteria[1]).toMatchObject({ passed: 0, failed: 1 });
    const [judge] = tallyOf(report.total, "judge");
    expect(judge).toMatchObject({ passed: 0, failed: 1, pending: 1 });
    expect(judge?.criteria).toEqual([
      expect.objectContaining({ name: "did-the-task", failed: 1 }),
      expect.objectContaining({ name: "made-nothing-up", notApplicable: 1 }),
    ]);
    const [thumbs] = tallyOf(report.total, "feedback");
    expect(thumbs).toMatchObject({
      evaluatorVersion: "",
      passed: 1,
      failed: 1,
    });
    expect(report.total?.metrics.map((m) => m.metric)).toEqual([
      "feedback",
      "judge",
      "run-health",
    ]);
  });

  it("sets each thumbs against each rubric that passed or failed on the same run, per judge version", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    const at = "2026-10-11T10:00:00Z";
    const judge = (runId: string, version: string, criteria: ReadonlyArray<readonly [string, CriterionResult]>, when = at) =>
      tally.add(
        scoreOf({
          runId,
          metric: "judge",
          evaluatorVersion: version,
          passed: !criteria.some(([, result]) => result === CriterionResult.failed),
          criteria,
          at: when,
        }),
      );
    const thumbs = (runId: string, up: boolean, when = at) =>
      tally.add(scoreOf({ runId, metric: "feedback", passed: up, at: when }));

    // run_1: the judge failed acted-only-as-asked, people liked it twice.
    judge("run_1", "j2", [
      ["acted-only-as-asked", CriterionResult.failed],
      ["did-the-task", CriterionResult.passed],
      ["asked-when-unclear", CriterionResult.not_applicable],
    ]);
    thumbs("run_1", true);
    thumbs("run_1", true);
    // run_2: everything passed, people disliked it: a missing rule.
    judge("run_2", "j2", [
      ["acted-only-as-asked", CriterionResult.passed],
      ["did-the-task", CriterionResult.passed],
    ]);
    thumbs("run_2", false);
    // run_3: both agree it failed.
    judge("run_3", "j2", [["did-the-task", CriterionResult.failed]]);
    thumbs("run_3", false);
    // run_4: an older version, newer in nothing.
    judge("run_4", "j1", [["did-the-task", CriterionResult.passed]], "2026-10-07T10:00:00Z");
    thumbs("run_4", true);
    // Counted nowhere: no thumbs, no judge grade, a pending and a
    // not-graded judge score, and a judge grade before the window.
    judge("run_5", "j2", [["did-the-task", CriterionResult.failed]]);
    thumbs("run_6", false);
    tally.add(scoreOf({ runId: "run_7", metric: "judge", evaluatorVersion: "j2", state: ScoreState.pending, at }));
    tally.add(scoreOf({ runId: "run_7", metric: "judge", evaluatorVersion: "j0", state: ScoreState.not_graded, at }));
    thumbs("run_7", false);
    judge("run_8", "j2", [["did-the-task", CriterionResult.failed]], "2026-09-01T10:00:00Z");
    thumbs("run_8", true);

    const agreement = tally.build().agreement;
    expect(agreement.map((a) => [a.evaluatorVersion, a.runs, a.thumbsDownNoneFailed])).toEqual([
      ["j2", 3, 1],
      ["j1", 1, 0],
    ]);
    const rules = agreement[0]?.rules.map((r) => [
      r.name,
      r.failedThumbsDown,
      r.failedThumbsUp,
      r.passedThumbsDown,
      r.passedThumbsUp,
    ]);
    expect(rules).toEqual([
      ["acted-only-as-asked", 0, 2, 1, 0],
      ["did-the-task", 1, 0, 1, 2],
    ]);
    expect(agreement[1]?.rules.map((r) => [r.name, r.passedThumbsUp])).toEqual([["did-the-task", 1]]);
  });

  it("puts the judge version seen most recently first in the agreement, whichever run it came from", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    const judged = (runId: string, version: string, at: string) => {
      tally.add(
        scoreOf({ runId, metric: "judge", evaluatorVersion: version, criteria: [["did-the-task", CriterionResult.passed]], at }),
      );
      tally.add(scoreOf({ runId, metric: "feedback", passed: true, at }));
    };
    judged("run_1", "j-old", "2026-10-07T10:00:00Z");
    judged("run_2", "j-new", "2026-10-09T10:00:00Z");
    judged("run_3", "j-old", "2026-10-11T10:00:00Z");
    expect(tally.build().agreement.map((a) => [a.evaluatorVersion, a.runs])).toEqual([
      ["j-old", 2],
      ["j-new", 1],
    ]);
  });

  it("never adds two evaluator versions together, and puts the newest first", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    tally.add(
      scoreOf({
        metric: "judge",
        evaluatorVersion: "j-old",
        at: "2026-10-08T10:00:00Z",
      }),
    );
    tally.add(
      scoreOf({
        metric: "judge",
        evaluatorVersion: "j-new",
        passed: false,
        at: "2026-10-11T10:00:00Z",
      }),
    );
    const judges = tallyOf(tally.build().total, "judge");
    expect(judges.map((j) => [j.evaluatorVersion, j.passed, j.failed])).toEqual(
      [
        ["j-new", 0, 1],
        ["j-old", 1, 0],
      ],
    );
  });

  it("keeps agent versions apart, most recently seen first, with their days", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    tally.add(scoreOf({ agentVersionHash: "v1", at: "2026-10-06T08:00:00Z" }));
    tally.add(scoreOf({ agentVersionHash: "v1", at: "2026-10-09T08:00:00Z" }));
    tally.add(scoreOf({ agentVersionHash: "v2", at: "2026-10-10T08:00:00Z" }));
    tally.add(scoreOf({ agentVersionHash: "", at: "2026-10-07T08:00:00Z" }));
    const versions = tally.build().versions;
    expect(
      versions.map((v) => [
        v.agentVersionHash,
        v.firstDate,
        v.lastDate,
        v.summary?.runs,
      ]),
    ).toEqual([
      ["v2", "2026-10-10", "2026-10-10", 1],
      ["v1", "2026-10-06", "2026-10-09", 2],
      ["", "2026-10-07", "2026-10-07", 1],
    ]);
  });

  it("buckets by the UTC day a grade was given, oldest first", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    tally.add(scoreOf({ at: "2026-10-11T23:59:59.999Z" }));
    tally.add(scoreOf({ at: "2026-10-12T00:00:00Z" }));
    tally.add(scoreOf({ at: "2026-10-12T14:00:00Z" }));
    expect(tally.build().days.map((d) => [d.date, d.summary?.runs])).toEqual([
      ["2026-10-11", 1],
      ["2026-10-12", 2],
    ]);
  });

  it("skips a stampless row, a row before the window and an eval score", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    tally.add(scoreOf({}));
    tally.add(scoreOf({ at: "2026-10-05T23:59:59Z" }));
    tally.add(scoreOf({ metric: "eval", at: "2026-10-12T10:00:00Z" }));
    const report = tally.build();
    expect(report.total?.runs).toBe(0);
    expect(report.days).toEqual([]);
    expect(report.versions).toEqual([]);
  });

  it("counts a state or a criterion result with no meaning nowhere, and skips a score with no spec", () => {
    const tally = new QualityTally(qualityWindowOf(7, NOW));
    tally.add(
      scoreOf({
        state: ScoreState.unspecified,
        criteria: [["ended-cleanly", CriterionResult.unspecified]],
        at: "2026-10-12T10:00:00Z",
      }),
    );
    const noSpec = scoreOf({ at: "2026-10-12T10:00:00Z" });
    noSpec.spec = undefined;
    tally.add(noSpec);
    const [health] = tallyOf(tally.build().total, "run-health");
    expect(health).toMatchObject({
      passed: 0,
      failed: 0,
      notGraded: 0,
      pending: 0,
    });
    expect(health?.criteria).toEqual([
      expect.objectContaining({
        name: "ended-cleanly",
        passed: 0,
        failed: 0,
        notApplicable: 0,
      }),
    ]);
  });

  it("flags a graded failure only", () => {
    const at = "2026-10-12T10:00:00Z";
    expect(isFlagged(scoreOf({ passed: false, at }))).toBe(true);
    expect(isFlagged(scoreOf({ metric: "feedback", passed: false, at }))).toBe(
      true,
    );
    expect(isFlagged(scoreOf({ passed: true, at }))).toBe(false);
    expect(isFlagged(scoreOf({ state: ScoreState.not_graded, at }))).toBe(
      false,
    );
    expect(isFlagged(scoreOf({ metric: "eval", passed: false, at }))).toBe(
      false,
    );
    expect(isFlagged(scoreOf({ passed: false }))).toBe(false);
  });
});

describe("the bound", () => {
  it("refuses a window holding more grades than one read counts", async () => {
    const row = (i: number): ListIndexRow => ({
      id: `scr_${i}`,
      data: new Uint8Array(),
      cursor: { createdAt: "2026-10-12T00:00:00.000000000Z", id: `scr_${i}` },
    });
    const batch = Array.from({ length: QUALITY_REPORT_BATCH }, (_, i) =>
      row(i),
    );
    let reads = 0;
    const store = {
      queryResources: () => {
        reads += 1;
        return Promise.resolve(batch);
      },
    } as unknown as Store;
    const step = newTallyAgentQualityStep({
      store,
      logger: silentLogger,
      listReadScope: undefined,
      now: () => NOW,
    });
    const ctx = new RequestContext(
      ScoreQueryController.method.getAgentQualityReport.input,
      create(ScoreQueryController.method.getAgentQualityReport.input, {
        org: "org_a",
        agentId: "agt_one",
        days: 90,
      }),
      PERSON,
      ApiResourceKind.score,
    );
    const failure = await Promise.resolve(step.execute(ctx)).then(
      () => undefined,
      (error: unknown) => ConnectError.from(error),
    );
    expect(failure?.code).toBe(Code.FailedPrecondition);
    expect(failure?.rawMessage).toBe(qualityReportTooLargeMessage(90));
    expect(reads).toBe(
      Math.floor(QUALITY_REPORT_MAX_SCORES / QUALITY_REPORT_BATCH) + 1,
    );
  });
});

describe("the report's faults", () => {
  function stepOver(store: Store) {
    const step = newTallyAgentQualityStep({
      store,
      logger: silentLogger,
      listReadScope: undefined,
      now: () => NOW,
    });
    const ctx = new RequestContext(
      ScoreQueryController.method.getAgentQualityReport.input,
      create(ScoreQueryController.method.getAgentQualityReport.input, {
        org: "org_a",
        agentId: "agt_one",
      }),
      PERSON,
      ApiResourceKind.score,
    );
    return { step, ctx };
  }

  it("skips a row it cannot decode and counts the rest", async () => {
    const good = scoreOf({ at: "2026-10-12T10:00:00Z" });
    const rows: ListIndexRow[] = [
      {
        id: "scr_bad",
        data: new Uint8Array([0xff, 0xff, 0xff]),
        cursor: { createdAt: "2026-10-12T10:00:00Z", id: "scr_bad" },
      },
      {
        id: good.metadata!.id,
        data: toBinary(ScoreSchema, good),
        cursor: { createdAt: "2026-10-12T10:00:00Z", id: good.metadata!.id },
      },
    ];
    const { step, ctx } = stepOver({
      queryResources: () => Promise.resolve(rows),
    } as unknown as Store);
    await step.execute(ctx);
    const report = ctx.get(QUALITY_REPORT_KEY) as AgentQualityReport;
    expect(report.total?.runs).toBe(1);
  });

  it("answers a store fault as INTERNAL", async () => {
    const { step, ctx } = stepOver({
      queryResources: () => Promise.reject(new Error("connection refused")),
    } as unknown as Store);
    const failure = await Promise.resolve(step.execute(ctx)).then(
      () => undefined,
      (error: unknown) => ConnectError.from(error),
    );
    expect(failure?.code).toBe(Code.Internal);
  });
});

describe("the session scope", () => {
  function sessionOf(id: string): Session {
    return create(SessionSchema, { metadata: { id, org: "org_a" } });
  }

  function fakes(kept: ReadonlySet<string>, missing: ReadonlySet<string>) {
    const reads: string[] = [];
    const offered: string[] = [];
    const store = {
      getResource: (_kind: ApiResourceKind, id: string) => {
        reads.push(id);
        return missing.has(id)
          ? Promise.reject(new ResourceNotFoundError(`session ${id}`))
          : Promise.resolve(sessionOf(id));
      },
    } as unknown as Store;
    const scope: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set()),
      restrictListEntries: (
        _caller: CallerIdentity,
        kind: ApiResourceKind,
        entries: ReadonlyArray<ListEntryMeta>,
      ) => {
        expect(kind).toBe(ApiResourceKind.session);
        offered.push(...entries.map((e) => e.id));
        return Promise.resolve(
          new Set(entries.map((e) => e.id).filter((id) => kept.has(id))),
        );
      },
    };
    return { store, scope, reads, offered };
  }

  it("reads and asks once per session per request, dropping refused and vanished sessions", async () => {
    const { store, scope, reads, offered } = fakes(
      new Set(["ses_mine"]),
      new Set(["ses_gone"]),
    );
    const narrow = sessionReadScope(store, silentLogger, scope, PERSON);
    const mine = scoreOf({ sessionId: "ses_mine" });
    const theirs = scoreOf({ sessionId: "ses_theirs" });
    const gone = scoreOf({ sessionId: "ses_gone" });
    expect(await narrow([mine, theirs, gone, mine])).toEqual([mine, mine]);
    const again = scoreOf({ sessionId: "ses_mine" });
    expect(await narrow([again, scoreOf({ sessionId: "ses_theirs" })])).toEqual(
      [again],
    );
    expect(reads.sort()).toEqual(["ses_gone", "ses_mine", "ses_theirs"]);
    expect(offered.sort()).toEqual(["ses_mine", "ses_theirs"]);
  });

  it("drops a score that names no session without reading, and faults on a store error", async () => {
    const { store, scope, reads } = fakes(new Set(["ses_mine"]), new Set());
    const narrow = sessionReadScope(store, silentLogger, scope, PERSON);
    expect(await narrow([scoreOf({ sessionId: "" })])).toEqual([]);
    expect(reads).toEqual([]);

    const broken = {
      getResource: () => Promise.reject(new Error("connection refused")),
    } as unknown as Store;
    const failure = await sessionReadScope(
      broken,
      silentLogger,
      scope,
      PERSON,
    )([scoreOf({ sessionId: "ses_mine" })]).then(
      () => undefined,
      (error: unknown) => ConnectError.from(error),
    );
    expect(failure?.code).toBe(Code.Internal);
  });

  it("keeps everything, reading nothing, with no scope or for the server itself", async () => {
    const { store, scope, reads } = fakes(new Set(), new Set());
    const scores = [scoreOf({ sessionId: "ses_x" })];
    expect(
      await sessionReadScope(store, silentLogger, undefined, PERSON)(scores),
    ).toEqual(scores);
    expect(
      await sessionReadScope(store, silentLogger, scope, {
        ...PERSON,
        callerClass: "internal",
      })(scores),
    ).toEqual(scores);
    expect(reads).toEqual([]);
  });
});

describe("an agent's quality, composed (trusted local)", () => {
  const MARKER = "zz-quoted-conversation-marker";
  let dir: string;
  let server: ComposedServer;
  let wire: Client<typeof ScoreCommandController>;
  let inProcess: Client<typeof ScoreCommandController>;
  let query: Client<typeof ScoreQueryController>;
  let org: string;
  const agentId = generateId("agt");

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "score-quality-test-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    wire = createClient(ScoreCommandController, transport);
    query = createClient(ScoreQueryController, transport);
    inProcess = createClient(ScoreCommandController, server.inProcessTransport);
    const created = await createClient(
      OrganizationCommandController,
      transport,
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "Score Quality Org" },
    });
    org = created.metadata!.id;
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A completed run of the agent in a fresh session, as an engine leaves it. */
  async function seedRun(
    opts: { version?: string; evalTry?: boolean } = {},
  ): Promise<string> {
    const sessionId = generateId("ses");
    await server.store.saveResource(
      ApiResourceKind.session,
      sessionId,
      SessionSchema,
      create(SessionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Session",
        metadata: { id: sessionId, name: sessionId, slug: sessionId, org },
      }),
    );
    const runId = generateId("run");
    await server.store.saveResource(
      ApiResourceKind.run,
      runId,
      RunSchema,
      create(RunSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Run",
        metadata: {
          id: runId,
          name: runId,
          slug: runId,
          org,
          labels: opts.evalTry === true ? { [EVAL_RUN_LABEL]: "evr_x" } : {},
        },
        spec: { target: { case: "sessionId", value: sessionId } },
        status: {
          phase: RunPhase.RUN_COMPLETED,
          agentId,
          agentVersionHash: opts.version ?? "hash-1",
        },
      }),
    );
    return runId;
  }

  function thumbs(runId: string, passed: boolean, labels = {}): Score {
    return create(ScoreSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Score",
      metadata: { org, labels },
      spec: {
        runId,
        metric: "feedback",
        source: ScoreSource.human,
        value: { case: "passed", value: passed },
        comment: MARKER,
      },
    });
  }

  function verdict(
    runId: string,
    metric: "run-health" | "judge" | "eval",
    passed: boolean,
  ): Score {
    return create(ScoreSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Score",
      metadata: { org },
      spec: {
        runId,
        metric,
        source: SOURCES[metric],
        evaluatorVersion: `${metric}-v1`,
        value: { case: "passed", value: passed },
        criteria: [
          {
            name: "did-the-task",
            result: passed ? CriterionResult.passed : CriterionResult.failed,
            reason: MARKER,
          },
        ],
        ...(metric === "judge" ? { judgeModel: `${MARKER}-model` } : {}),
      },
    });
  }

  async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
    try {
      await promise;
    } catch (error) {
      return ConnectError.from(error);
    }
    throw new Error("expected the call to fail");
  }

  it("records the run's agent and version, and labels a person's thumbs on an eval's try", async () => {
    const live = await seedRun({ version: "hash-live" });
    const forged = thumbs(live, true);
    forged.status = create(ScoreStatusSchema, {
      agentId: "agt_forged",
      agentVersionHash: "hash-forged",
    });
    const rated = await wire.create(forged);
    expect(rated.status?.agentId).toBe(agentId);
    expect(rated.status?.agentVersionHash).toBe("hash-live");
    expect(rated.metadata?.labels[EVAL_RUN_LABEL]).toBeUndefined();

    const evalTry = await seedRun({ evalTry: true });
    const onTry = await wire.create(thumbs(evalTry, false));
    expect(onTry.metadata?.labels[EVAL_RUN_LABEL]).toBe("evr_x");
    expect(onTry.status?.agentId).toBe(agentId);

    const edited = create(ScoreSchema, onTry);
    edited.spec!.value = { case: "passed", value: true };
    const changed = await wire.update({ resource: edited, updateMask: { paths: ["*"] } });
    expect(changed.metadata?.labels[EVAL_RUN_LABEL]).toBe("evr_x");
    expect(changed.status?.agentId).toBe(agentId);
    expect(changed.status?.agentVersionHash).toBe("hash-1");
  });

  it("counts live runs only and carries no text", async () => {
    const reportBefore = await query.getAgentQualityReport({ org, agentId });
    const runsBefore = reportBefore.total?.runs ?? 0;

    const good = await seedRun({ version: "hash-2" });
    const bad = await seedRun({ version: "hash-2" });
    await inProcess.create(verdict(good, "run-health", true));
    await inProcess.create(verdict(bad, "run-health", false));
    await inProcess.create(verdict(bad, "judge", false));
    await wire.create(thumbs(bad, false));
    const evalTry = await seedRun({ evalTry: true, version: "hash-2" });
    await wire.create(thumbs(evalTry, false));
    await inProcess.create(verdict(evalTry, "eval", false));

    const report = await query.getAgentQualityReport({ org, agentId, days: 7 });
    expect(report.total?.runs).toBe(runsBefore + 2);
    const v2 = report.versions.find((v) => v.agentVersionHash === "hash-2");
    expect(v2?.summary?.runs).toBe(2);
    const health = tallyOf(v2?.summary, "run-health")[0];
    expect([health?.passed, health?.failed]).toEqual([1, 1]);
    const thumbsDown = tallyOf(v2?.summary, "feedback")[0];
    expect([thumbsDown?.passed, thumbsDown?.failed]).toEqual([0, 1]);
    expect(tallyOf(v2?.summary, "eval")).toEqual([]);

    const bytes = Buffer.from(
      toBinary(AgentQualityReportSchema, report),
    ).toString("latin1");
    expect(bytes).not.toContain(MARKER);
    expect(toJsonString(AgentQualityReportSchema, report)).not.toContain(
      MARKER,
    );
  });

  it("lists every failed grade on trusted local, newest first, paged with a token", async () => {
    const run = await seedRun({ version: "hash-3" });
    await inProcess.create(verdict(run, "run-health", false));
    await inProcess.create(verdict(run, "judge", false));
    await wire.create(thumbs(run, false));

    const all = await query.listFlaggedByAgent({ org, agentId });
    expect(all.nextPageToken).toBe("");
    expect(all.nextPageToken).toBe("");
    expect(
      all.entries.every(
        (s) => s.spec?.value.case === "passed" && !s.spec.value.value,
      ),
    ).toBe(true);
    expect(all.entries.some((s) => s.spec?.runId === run)).toBe(true);
    expect(
      all.entries.some(
        (s) => s.metadata?.labels[EVAL_RUN_LABEL] !== undefined,
      ),
    ).toBe(false);

    const first = await query.listFlaggedByAgent({ org, agentId, pageSize: 1 });
    expect(first.entries).toHaveLength(1);
    expect(first.nextPageToken).not.toBe("");
    const second = await query.listFlaggedByAgent({
      org,
      agentId,
      pageSize: 1,
      pageToken: first.nextPageToken,
    });
    expect(second.entries[0]?.metadata?.id).not.toBe(
      first.entries[0]?.metadata?.id,
    );
    expect(all.entries[1]?.metadata?.id).toBe(second.entries[0]?.metadata?.id);
  });

  it("walks only the flagged grades carrying every label named, a page at a time", async () => {
    const labels = { reviewer: "triage", tier: "gold" };
    const flagged = [
      (await wire.create(thumbs(await seedRun({ version: "hash-label" }), false, labels))).metadata!.id,
      (await wire.create(thumbs(await seedRun({ version: "hash-label" }), false, { ...labels, extra: "x" }))).metadata!.id,
    ];
    await wire.create(thumbs(await seedRun({ version: "hash-label" }), false, { reviewer: "triage" }));
    await wire.create(thumbs(await seedRun({ version: "hash-label" }), false));
    await wire.create(thumbs(await seedRun({ version: "hash-label" }), true, labels));

    const walked: string[] = [];
    let pageToken = "";
    do {
      const page = await query.listFlaggedByAgent({ org, agentId, labels, pageSize: 1, pageToken });
      expect(page.entries.length).toBeLessThanOrEqual(1);
      walked.push(...page.entries.map((score) => score.metadata!.id));
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
    expect(new Set(walked)).toEqual(new Set(flagged));
    expect(walked).toHaveLength(2);
  });

  it("refuses a person's thumbs that names an evaluator version, which would split the report's thumbs", async () => {
    const live = await seedRun();
    const forged = thumbs(live, false);
    forged.spec!.evaluatorVersion = `${MARKER}-version`;
    const failure = await failureOf(wire.create(forged));
    expect(failure.code).toBe(Code.InvalidArgument);
    expect(failure.rawMessage).toBe(SCORE_EVALUATOR_VERSION_NOT_HUMAN_MESSAGE);
  });

  it("refuses an empty agent id and a window past 90 days", async () => {
    expect(
      (await failureOf(query.getAgentQualityReport({ org, agentId: "" }))).code,
    ).toBe(Code.InvalidArgument);
    expect(
      (await failureOf(query.getAgentQualityReport({ org, agentId, days: 91 })))
        .code,
    ).toBe(Code.InvalidArgument);
    expect(
      (await failureOf(query.listFlaggedByAgent({ org, agentId: "" }))).code,
    ).toBe(Code.InvalidArgument);
  });
});
