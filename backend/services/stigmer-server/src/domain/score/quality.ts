/**
 * An agent's quality: how one agent's runs in one organization were
 * graded over the last few days (getAgentQualityReport), and the failed
 * grades among them that the caller can open (listFlaggedByAgent).
 *
 * Both lanes ask two questions before reading a row: can_view on the
 * organization (the annotation, getAgentUsageReport's rule, oss#389: an
 * agent's can_view reaches child organizations through shares, so only
 * the named organization's runs are read) and then can_view on the agent
 * (AuthorizeResolvedTarget, the organization's bar first), so a caller who
 * cannot see the agent learns nothing about it.
 *
 * The report counts every run of the agent in the organization, the
 * conversations the caller cannot open included, because runs are private
 * to their conversation's viewers and an owner would otherwise see only
 * their own. What makes that safe is what the report carries: counts,
 * metric and criterion names, version hashes and dates, never a reason, a
 * comment or a judge's model, so it quotes no conversation. It is counted
 * on read from the score list index's agent key (list-index.ts), batch by
 * batch so memory stays flat, and refused past QUALITY_REPORT_MAX_SCORES
 * rather than keep a page waiting; the wire carries totals only, so a stored
 * table can replace the read without a client change.
 *
 * The flagged list returns whole scores, so it is narrowed per row. It
 * asks the list read scope about each score's SESSION, not the score: a
 * score's visibility is its session's (score → run → session), and a
 * score's own check walks that chain on the authorization engine, the
 * slow path that rolled back on 2026-09-14, while a session's is answered
 * directly. Each session is read and decided once per request, inside the
 * shared page loop's examine budget (pipeline/steps/list-page.ts).
 *
 * Neither lane counts a plugin or agent eval's tries: their scores carry
 * the reserved eval label the create chain copies from the run, and both
 * reads leave those rows out, as the conversation lists leave out the
 * tries' sessions. An `eval` score is skipped by source as well, so the
 * rule holds even for a row written before the label was stamped.
 *
 * Proven by __tests__/quality.test.ts (the tally, the window, the bound,
 * both lanes composed, the session scope, the no-text proof) and the
 * run-scores conformance suite's two-people arm.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import {
  AgentQualityReportSchema,
  CriterionTallySchema,
  MetricTallySchema,
  QualityDaySchema,
  QualitySummarySchema,
  QualityVersionSchema,
  ScoreListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type {
  AgentQualityReport,
  QualitySummary,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  restrictListByReadScope,
  type ListReadScope,
} from "../../extensions/list-read-scope.js";
import {
  failedPreconditionError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import {
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  listIndexInstantOfMillis,
  type ListIndexQuery,
} from "../../store/list-index.js";
import { scoreListIndex } from "./list-index.js";

/** The days a request that names none counts. */
export const QUALITY_DEFAULT_DAYS = 30;

/**
 * How many rows one store read of the report hands back. Measured on
 * Postgres 16 with 100,000 grades of one agent: the read took 2.9 s in
 * batches of 2,000 and 1.6 s in batches of 10,000 (decoding 0.8 s and
 * counting 0.2 s either way), so fewer, larger reads; a batch of 10,000
 * rows of about 430 bytes stays a few megabytes.
 */
export const QUALITY_REPORT_BATCH = 10_000;

/**
 * The most grades one report counts: about 1.3 s at the measured cost
 * above, which is about 1,300 runs a day over 30 days. Past it the read is
 * refused with a shorter window named rather than keep a page waiting; a
 * busier agent's report needs stored running totals, which the wire's
 * totals-only shape lets replace this read without a client change.
 */
export const QUALITY_REPORT_MAX_SCORES = 50_000;

const DAY_MILLIS = 86_400_000;

/** The copy both lanes refuse a caller who cannot view the agent with. */
export const QUALITY_AGENT_DENIED_MESSAGE =
  "unauthorized to view agent quality report";

/** The refusal for a window holding more grades than one read counts. */
export function qualityReportTooLargeMessage(days: number): string {
  const shorter = Math.max(1, Math.floor(days / 3));
  return `this agent has more than ${QUALITY_REPORT_MAX_SCORES.toLocaleString("en-US")} grades in the last ${days} days; ask for a shorter window, for example ${shorter} days`;
}

// =============================================================================
// The window
// =============================================================================

/** The UTC days a request counts: today and the days before it. */
export interface QualityWindow {
  readonly days: number;
  /** The first day, YYYY-MM-DD. */
  readonly fromDate: string;
  /** Today, YYYY-MM-DD. */
  readonly toDate: string;
  /** The first day's midnight, as the list index's instant. */
  readonly since: string;
}

/** The window of `days` UTC days ending on `now`'s day; 0 means the default. */
export function qualityWindowOf(days: number, now: Date): QualityWindow {
  const count = days === 0 ? QUALITY_DEFAULT_DAYS : days;
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const first = today - (count - 1) * DAY_MILLIS;
  return {
    days: count,
    fromDate: new Date(first).toISOString().slice(0, 10),
    toDate: new Date(today).toISOString().slice(0, 10),
    since: listIndexInstantOfMillis(first),
  };
}

/** The UTC instant a score was created, or undefined for a stampless row. */
function createdInstantOf(score: Score): string | undefined {
  const created = score.status?.audit?.specAudit?.createdAt;
  if (created === undefined) {
    return undefined;
  }
  const millis =
    Number(created.seconds) * 1000 + Math.floor(created.nanos / 1_000_000);
  return new Date(millis).toISOString();
}

// =============================================================================
// The tally
// =============================================================================

interface CriterionCounts {
  passed: number;
  failed: number;
  notApplicable: number;
}

interface MetricCounts {
  readonly metric: string;
  readonly evaluatorVersion: string;
  passed: number;
  failed: number;
  notGraded: number;
  pending: number;
  /** The newest grade's instant, to put the current version first. */
  lastSeen: string;
  readonly criteria: Map<string, CriterionCounts>;
}

class SummaryCounts {
  private readonly runs = new Set<string>();
  private readonly metrics = new Map<string, MetricCounts>();

  add(score: Score, instant: string): void {
    const spec = score.spec;
    if (spec === undefined) {
      return;
    }
    this.runs.add(spec.runId);
    const key = `${spec.metric}\u0000${spec.evaluatorVersion}`;
    let counts = this.metrics.get(key);
    if (counts === undefined) {
      counts = {
        metric: spec.metric,
        evaluatorVersion: spec.evaluatorVersion,
        passed: 0,
        failed: 0,
        notGraded: 0,
        pending: 0,
        lastSeen: instant,
        criteria: new Map(),
      };
      this.metrics.set(key, counts);
    }
    if (instant > counts.lastSeen) {
      counts.lastSeen = instant;
    }
    switch (score.status?.state ?? ScoreState.unspecified) {
      case ScoreState.graded:
        if (spec.value.case === "passed" && spec.value.value) {
          counts.passed += 1;
        } else {
          counts.failed += 1;
        }
        break;
      case ScoreState.not_graded:
        counts.notGraded += 1;
        break;
      case ScoreState.pending:
        counts.pending += 1;
        break;
      case ScoreState.unspecified:
        break;
      default: {
        const unhandled: never = score.status?.state as never;
        void unhandled;
      }
    }
    for (const criterion of spec.criteria) {
      let tally = counts.criteria.get(criterion.name);
      if (tally === undefined) {
        tally = { passed: 0, failed: 0, notApplicable: 0 };
        counts.criteria.set(criterion.name, tally);
      }
      switch (criterion.result) {
        case CriterionResult.passed:
          tally.passed += 1;
          break;
        case CriterionResult.failed:
          tally.failed += 1;
          break;
        case CriterionResult.not_applicable:
          tally.notApplicable += 1;
          break;
        case CriterionResult.unspecified:
          break;
        default: {
          const unhandled: never = criterion.result;
          void unhandled;
        }
      }
    }
  }

  /**
   * The wire summary: metrics by name, the most recently seen evaluator
   * version first within a metric; criteria by name.
   */
  build(): QualitySummary {
    const metrics = [...this.metrics.values()].sort((a, b) =>
      a.metric !== b.metric
        ? a.metric < b.metric
          ? -1
          : 1
        : a.lastSeen !== b.lastSeen
          ? a.lastSeen > b.lastSeen
            ? -1
            : 1
          : a.evaluatorVersion < b.evaluatorVersion
            ? -1
            : 1,
    );
    return create(QualitySummarySchema, {
      runs: this.runs.size,
      metrics: metrics.map((m) =>
        create(MetricTallySchema, {
          metric: m.metric,
          evaluatorVersion: m.evaluatorVersion,
          passed: m.passed,
          failed: m.failed,
          notGraded: m.notGraded,
          pending: m.pending,
          criteria: [...m.criteria.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([name, c]) =>
              create(CriterionTallySchema, {
                name,
                passed: c.passed,
                failed: c.failed,
                notApplicable: c.notApplicable,
              }),
            ),
        }),
      ),
    });
  }
}

interface VersionCounts {
  readonly summary: SummaryCounts;
  firstSeen: string;
  lastSeen: string;
}

/**
 * The report's accumulator: grades in, the wire report out. Pure over the
 * scores it is given, in any order; a score with no creation stamp (which
 * the index's window read also returns) and a plugin eval's score are
 * skipped, and nothing but counts, names, hashes and dates leaves it.
 */
export class QualityTally {
  private readonly total = new SummaryCounts();
  private readonly days = new Map<string, SummaryCounts>();
  private readonly versions = new Map<string, VersionCounts>();

  constructor(private readonly window: QualityWindow) {}

  add(score: Score): void {
    if (score.spec?.source === ScoreSource.eval) {
      return;
    }
    const instant = createdInstantOf(score);
    if (instant === undefined) {
      return;
    }
    const date = instant.slice(0, 10);
    if (date < this.window.fromDate) {
      return;
    }
    this.total.add(score, instant);

    let day = this.days.get(date);
    if (day === undefined) {
      day = new SummaryCounts();
      this.days.set(date, day);
    }
    day.add(score, instant);

    const hash = score.status?.agentVersionHash ?? "";
    let version = this.versions.get(hash);
    if (version === undefined) {
      version = {
        summary: new SummaryCounts(),
        firstSeen: instant,
        lastSeen: instant,
      };
      this.versions.set(hash, version);
    }
    if (instant < version.firstSeen) {
      version.firstSeen = instant;
    }
    if (instant > version.lastSeen) {
      version.lastSeen = instant;
    }
    version.summary.add(score, instant);
  }

  build(): AgentQualityReport {
    return create(AgentQualityReportSchema, {
      fromDate: this.window.fromDate,
      toDate: this.window.toDate,
      total: this.total.build(),
      days: [...this.days.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, summary]) =>
          create(QualityDaySchema, { date, summary: summary.build() }),
        ),
      versions: [...this.versions.entries()]
        .sort(([, a], [, b]) =>
          a.lastSeen > b.lastSeen ? -1 : a.lastSeen < b.lastSeen ? 1 : 0,
        )
        .map(([hash, v]) =>
          create(QualityVersionSchema, {
            agentVersionHash: hash,
            firstDate: v.firstSeen.slice(0, 10),
            lastDate: v.lastSeen.slice(0, 10),
            summary: v.summary.build(),
          }),
        ),
    });
  }
}

// =============================================================================
// The lanes
// =============================================================================

export interface QualityLaneDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed list read scope; undefined = trusted local, nothing narrowed. */
  readonly listReadScope: ListReadScope | undefined;
  /** Today's clock; tests pin it. */
  readonly now: () => Date;
}

type ReportDesc =
  typeof ScoreQueryController.method.getAgentQualityReport.input;
type FlaggedDesc = typeof ScoreQueryController.method.listFlaggedByAgent.input;

/** Context key for the report TallyAgentQuality builds. */
export const QUALITY_REPORT_KEY = "agentQualityReport";

/** Context key for the page ListFlaggedScores reads. */
export const FLAGGED_SCORES_KEY = "flaggedScores";

/**
 * Both lanes' second question, for AuthorizeResolvedTarget after the
 * annotation's can_view on the organization: can_view on the agent. An
 * empty agent id never reaches it: the request's protovalidate rule
 * refuses it first.
 */
export function resolveQualityAgentTarget(ctx: {
  readonly input: { readonly agentId: string };
}): ReadonlyArray<AuthorizationTarget> {
  return [
    {
      permission: IamPermission.can_view,
      resourceKind: ApiResourceKind.agent,
      resourceId: ctx.input.agentId,
      deniedMessage: QUALITY_AGENT_DENIED_MESSAGE,
    },
  ];
}

/** One agent's live scores in one organization since the window's first day. */
function agentScoresQuery(
  org: string,
  agentId: string,
  window: QualityWindow,
): ListIndexQuery<keyof typeof scoreListIndex.keys & string> {
  return {
    org,
    anyKey: [{ name: "agent", value: agentId }],
    withoutKeys: ["plugin_eval"],
    createdAtOrAfter: window.since,
  };
}

function decodeScore(data: Uint8Array, logger: Logger): Score | undefined {
  try {
    return fromBinary(ScoreSchema, data);
  } catch (error) {
    logger.warn("Failed to unmarshal score, skipping", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * TallyAgentQuality: reads the agent's scores in batches through the
 * index's cursor and tallies each batch as it goes, refusing past the
 * bound.
 */
export function newTallyAgentQualityStep(
  deps: QualityLaneDeps,
): PipelineStep<ReportDesc> {
  return {
    name: "TallyAgentQuality",
    async execute(ctx: RequestContext<ReportDesc>): Promise<void> {
      const window = qualityWindowOf(ctx.input.days, deps.now());
      const query = agentScoresQuery(ctx.input.org, ctx.input.agentId, window);
      const tally = new QualityTally(window);
      let after: ListIndexQuery["after"];
      let read = 0;
      for (;;) {
        let rows;
        try {
          rows = await deps.store.queryResources(scoreListIndex, {
            ...query,
            ...(after === undefined ? {} : { after }),
            limit: QUALITY_REPORT_BATCH,
          });
        } catch (error) {
          throw internalError(error, "failed to read the agent's scores");
        }
        read += rows.length;
        if (read > QUALITY_REPORT_MAX_SCORES) {
          throw failedPreconditionError(
            qualityReportTooLargeMessage(window.days),
          );
        }
        for (const row of rows) {
          const score = decodeScore(row.data, deps.logger);
          if (score !== undefined) {
            tally.add(score);
          }
        }
        const last = rows[rows.length - 1];
        if (rows.length < QUALITY_REPORT_BATCH || last === undefined) {
          break;
        }
        after = last.cursor;
      }
      ctx.set(QUALITY_REPORT_KEY, tally.build());
    },
  };
}

/** A failed grade: a failed check, a failed judge verdict, a thumbs down. */
export function isFlagged(score: Score): boolean {
  const spec = score.spec;
  return (
    spec !== undefined &&
    spec.source !== ScoreSource.eval &&
    score.status?.state === ScoreState.graded &&
    spec.value.case === "passed" &&
    !spec.value.value &&
    createdInstantOf(score) !== undefined
  );
}

/**
 * ListFlaggedScores: one page of the agent's failed grades, newest first,
 * through the shared page loop, narrowed last by the sessions' read scope.
 */
export function newListFlaggedScoresStep(
  deps: QualityLaneDeps,
): PipelineStep<FlaggedDesc> {
  return {
    name: "ListFlaggedScores",
    async execute(ctx: RequestContext<FlaggedDesc>): Promise<void> {
      const input = ctx.input;
      const window = qualityWindowOf(input.days, deps.now());
      const bySession = sessionReadScope(
        deps.store,
        deps.logger,
        deps.listReadScope,
        ctx.callerIdentity,
      );
      const page = await readListPage({
        store: deps.store,
        declaration: scoreListIndex,
        query: agentScoresQuery(input.org, input.agentId, window),
        request: input,
        fingerprint: listPageFingerprint({
          lane: "score.listFlaggedByAgent",
          org: input.org,
          agentId: input.agentId,
          days: window.days,
        }),
        decode: (data) => decodeScore(data, deps.logger),
        keep: isFlagged,
        scope: bySession,
        failure: "failed to list the agent's flagged scores",
      });
      ctx.set(
        FLAGGED_SCORES_KEY,
        create(ScoreListSchema, {
          totalCount: page.entries.length,
          items: page.entries,
          nextPageToken: page.nextPageToken,
        }),
      );
    },
  };
}

/**
 * The flagged list's read scope: a batch of scores is narrowed by their
 * sessions. Each distinct session is read once and decided once per
 * request (the returned function keeps both answers), and offered to the
 * list read scope as kind `session`; a score whose session is gone or
 * refused is dropped. No scope composed (trusted local) and the server
 * acting as itself keep every score, with no session read, as
 * `restrictListByReadScope` would.
 */
export function sessionReadScope(
  store: Store,
  logger: Logger,
  scope: ListReadScope | undefined,
  caller: CallerIdentity,
): (scores: Score[]) => Promise<Score[]> {
  const decided = new Map<string, boolean>();
  return async (scores) => {
    if (scope === undefined || caller.callerClass === "internal") {
      return scores;
    }
    const unread = [
      ...new Set(
        scores
          .map((score) => score.spec?.sessionId ?? "")
          .filter((id) => !decided.has(id)),
      ),
    ];
    if (unread.length > 0) {
      const sessions: Session[] = [];
      await Promise.all(
        unread.map(async (id) => {
          const session = await readSession(store, logger, id);
          if (session === undefined) {
            decided.set(id, false);
          } else {
            sessions.push(session);
          }
        }),
      );
      const kept = new Set(
        (
          await restrictListByReadScope(
            scope,
            caller,
            ApiResourceKind.session,
            sessions,
            "",
          )
        ).map((session) => session.metadata?.id ?? ""),
      );
      for (const session of sessions) {
        const id = session.metadata?.id ?? "";
        decided.set(id, kept.has(id));
      }
    }
    return scores.filter(
      (score) => decided.get(score.spec?.sessionId ?? "") === true,
    );
  };
}

async function readSession(
  store: Store,
  logger: Logger,
  id: string,
): Promise<Session | undefined> {
  if (id === "") {
    return undefined;
  }
  try {
    return await store.getResource(ApiResourceKind.session, id, SessionSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      logger.debug("Flagged score's session is gone, dropping", {
        sessionId: id,
      });
      return undefined;
    }
    throw internalError(error, "failed to read a flagged score's session");
  }
}
