// Conformance suite for the Score domain, the refusals that need no finished
// run.
// Domain: agentic / score — the grades of a finished run.
//
// A run completes only where an engine runs it, so everything about a scored
// run (grading, rating, editing, the cascades) is pinned in the execution
// slice (suites-execution/run-scores.conformance.test.ts). What holds on every
// edition without an engine is pinned here:
//   - a run-health score is the platform's alone: a caller who gives
//     score_source_check is refused before anything about the run is read;
//   - a score names a run, a metric and a source (protovalidate);
//   - a score on a run that does not exist answers NOT_FOUND, as the run's
//     own `get` does;
//   - a score id nothing holds answers NOT_FOUND on get, update and delete;
//   - under an enforcing authorizer an outsider naming a run gets the same
//     NOT_FOUND the run's `get` gives them, and reads no list;
//   - an agent's quality report over no runs is a complete zero shape and
//     its flagged list is empty; an empty agent id and a window past 90 days
//     are refused; under an enforcing authorizer an outsider reads neither
//     for an organization they are not in, and a member reads neither for
//     an agent they cannot view.
import { Code } from "@connectrpc/connect";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import {
  CHECK_SOURCE_REFUSED_MESSAGE,
  FEEDBACK,
  SCORE_API_VERSION,
  SCORE_KIND,
  makeFeedback,
  makeForgedCheck,
} from "../support/scores";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

// An id shaped like a run's that no run holds.
const MISSING_RUN_ID = "run_01jzzzzzzzzzzzzzzzzzzzzzzz";
const MISSING_SCORE_ID = "scr_01jzzzzzzzzzzzzzzzzzzzzzzz";

let target: TargetProfile;
let clients: ConformanceClients;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterAll(async () => {
  await target?.teardown();
});

describe("Score conformance (no finished run)", () => {
  it("[rpc:ScoreCommandController.create] a run-health score from a caller is refused before the run is read", async () => {
    const { org } = await target.provisionTenancy();
    const refused = await expectGrpcCode(
      () => clients.scoreCommand.create(makeForgedCheck(org, MISSING_RUN_ID)),
      Code.PermissionDenied,
      "a caller forging a check's verdict",
    );
    expect(refused.rawMessage).toBe(CHECK_SOURCE_REFUSED_MESSAGE);
  });

  it("[rpc:ScoreCommandController.create] a score names its run, its metric and its source", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.scoreCommand.create(makeFeedback(org, "", true)),
      Code.InvalidArgument,
      "a score with no run",
    );
    await expectGrpcCode(
      () =>
        clients.scoreCommand.create({
          apiVersion: SCORE_API_VERSION,
          kind: SCORE_KIND,
          metadata: { org },
          spec: { runId: MISSING_RUN_ID, metric: FEEDBACK, value: { case: "passed", value: true } },
        }),
      Code.InvalidArgument,
      "a score with no source",
    );
    await expectGrpcCode(
      () =>
        clients.scoreCommand.create({
          apiVersion: SCORE_API_VERSION,
          kind: SCORE_KIND,
          metadata: { org },
          spec: { runId: MISSING_RUN_ID, source: ScoreSource.human, value: { case: "passed", value: true } },
        }),
      Code.InvalidArgument,
      "a score with no metric",
    );
    await expectGrpcCode(
      () => clients.scoreCommand.create(makeFeedback(org, MISSING_RUN_ID, true, "x".repeat(501))),
      Code.InvalidArgument,
      "a comment over 500 characters",
    );
  });

  it("[rpc:ScoreCommandController.create] a person's rating of a run that does not exist answers NOT_FOUND", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.scoreCommand.create(makeFeedback(org, MISSING_RUN_ID, true)),
      Code.NotFound,
      "rating a missing run",
    );
  });

  it("[rpc:ScoreQueryController.get] [rpc:ScoreCommandController.update] [rpc:ScoreCommandController.delete] a score id nothing holds answers NOT_FOUND", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.scoreQuery.get({ value: MISSING_SCORE_ID }),
      Code.NotFound,
      "get of a missing score",
    );
    const update = makeFeedback(org, MISSING_RUN_ID, false);
    update.metadata = { ...update.metadata, id: MISSING_SCORE_ID };
    await expectGrpcCode(
      () => clients.scoreCommand.update(update),
      Code.NotFound,
      "update of a missing score",
    );
    await expectGrpcCode(
      () => clients.scoreCommand.delete({ value: MISSING_SCORE_ID }),
      Code.NotFound,
      "delete of a missing score",
    );
  });

  it("[rpc:ScoreQueryController.listByRun] [rpc:ScoreQueryController.listBySession] an outsider reads no run's or session's scores", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const outsider = await lane.provisionIdentity();
    await expectGrpcCode(
      () => outsider.scoreQuery.listByRun({ runId: MISSING_RUN_ID }),
      Code.NotFound,
      "an outsider listing a missing run's scores",
    );
    await expectGrpcCode(
      () => outsider.scoreQuery.listBySession({ sessionId: "ses_01jzzzzzzzzzzzzzzzzzzzzzzz" }),
      Code.NotFound,
      "an outsider listing a missing session's scores",
    );
    const tenancy = await lane.provisionTenancy();
    await expectGrpcCode(
      () => outsider.scoreCommand.create(makeFeedback(tenancy.org, MISSING_RUN_ID, true)),
      Code.NotFound,
      "an outsider rating a missing run",
    );
    await lane.cleanupTenancy(tenancy);
  });
  it("[rpc:ScoreQueryController.getAgentQualityReport] [rpc:ScoreQueryController.listFlaggedByAgent] an agent with no graded runs reports a zero shape and lists nothing", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-quality") }));
    const agentId = agent.metadata!.id;
    try {
      const report = await clients.scoreQuery.getAgentQualityReport({ org, agentId });
      expect(report.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(report.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(report.total?.runs ?? 0).toBe(0);
      expect(report.total?.metrics ?? []).toEqual([]);
      expect(report.days).toEqual([]);
      expect(report.versions).toEqual([]);
      const week = await clients.scoreQuery.getAgentQualityReport({ org, agentId, days: 7 });
      expect(Date.parse(week.toDate) - Date.parse(week.fromDate)).toBe(6 * 86_400_000);
      const flagged = await clients.scoreQuery.listFlaggedByAgent({ org, agentId });
      expect(flagged.items).toEqual([]);
      expect(flagged.nextPageToken).toBe("");
    } finally {
      await clients.agentCommand.delete({ value: agentId });
    }
  });

  it("[rpc:ScoreQueryController.getAgentQualityReport] [rpc:ScoreQueryController.listFlaggedByAgent] an empty agent id and a window past 90 days are refused", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.scoreQuery.getAgentQualityReport({ org, agentId: "" }),
      Code.InvalidArgument,
      "a quality report naming no agent",
    );
    await expectGrpcCode(
      () => clients.scoreQuery.getAgentQualityReport({ org, agentId: "agt_01conformancemissing", days: 91 }),
      Code.InvalidArgument,
      "a quality report over 91 days",
    );
    await expectGrpcCode(
      () => clients.scoreQuery.listFlaggedByAgent({ org, agentId: "" }),
      Code.InvalidArgument,
      "a flagged list naming no agent",
    );
  });

  it("[rpc:ScoreQueryController.getAgentQualityReport] [rpc:ScoreQueryController.listFlaggedByAgent] an outsider reads no organization's agent quality, and a member none of an agent they cannot view", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    try {
      const shared = await lane.clients.agentCommand.create(
        makeAgent({ org: tenancy.org, name: uniqueName("agent-quality-shared") }),
      );
      const privateDraft = makeAgent({ org: tenancy.org, name: uniqueName("agent-quality-private") });
      const hidden = await lane.clients.agentCommand.create({
        ...privateDraft,
        metadata: { ...privateDraft.metadata, visibility: ApiResourceVisibility.visibility_private },
      });

      const outsider = await lane.provisionIdentity();
      await expectGrpcCode(
        () => outsider.scoreQuery.getAgentQualityReport({ org: tenancy.org, agentId: shared.metadata!.id }),
        Code.PermissionDenied,
        "an outsider reading an organization's agent quality",
      );
      await expectGrpcCode(
        () => outsider.scoreQuery.listFlaggedByAgent({ org: tenancy.org, agentId: shared.metadata!.id }),
        Code.PermissionDenied,
        "an outsider listing an organization's flagged scores",
      );

      const member = await lane.provisionMember(tenancy);
      const visible = await member.scoreQuery.getAgentQualityReport({
        org: tenancy.org,
        agentId: shared.metadata!.id,
      });
      expect(visible.total?.runs ?? 0).toBe(0);
      await expectGrpcCode(
        () => member.scoreQuery.getAgentQualityReport({ org: tenancy.org, agentId: hidden.metadata!.id }),
        Code.PermissionDenied,
        "a member reading the quality of an agent they cannot view",
      );
      await expectGrpcCode(
        () => member.scoreQuery.listFlaggedByAgent({ org: tenancy.org, agentId: hidden.metadata!.id }),
        Code.PermissionDenied,
        "a member listing the flagged scores of an agent they cannot view",
      );
    } finally {
      await lane.cleanupTenancy(tenancy);
    }
  });
});
