/**
 * Pins the score lanes through the REAL stack on a trusted-local server: a
 * composed server on an ephemeral port, the wire chain for a person and the
 * in-process lane for the server's own checks. Runs and sessions are
 * stored directly as an engine would leave them (no engine runs here).
 *
 * The load-bearing pins:
 *   - a person rates a completed run once; the score lives in the run's
 *     session, and a second rating is ALREADY_EXISTS carrying SCORE_EXISTS
 *     and the existing score's id; update changes its thumbs, a false one
 *     included;
 *   - a check comes from the server alone: refused on the wire, admitted
 *     in process, where a not-graded check keeps the server's reason; a
 *     second run-health score from the same checks version is refused;
 *   - a check's verdict is final on update;
 *   - the run's and the session's lists carry the scores;
 *   - deleting a run removes its scores (its own delete chain), and
 *     deleting a session removes its runs' scores (the session's cascade,
 *     which deletes runs without their chain).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import {
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";
import { generateId } from "../../../pipeline/steps/defaults.js";
import {
  CHECK_SOURCE_REFUSED_MESSAGE,
  SCORE_UPDATE_HUMAN_ONLY_MESSAGE,
  feedbackExistsMessage,
  runHealthExistsMessage,
} from "../constants.js";
import { SCORE_EXISTS_REASON } from "../steps.js";

let dir: string;
let server: ComposedServer;
let wire: Client<typeof ScoreCommandController>;
let inProcess: Client<typeof ScoreCommandController>;
let query: Client<typeof ScoreQueryController>;
let org: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "score-domain-test-"));
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
    metadata: { name: "Score Test Org" },
  });
  org = created.metadata!.id;
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

/** A stored session and a run in it at `phase`, as an engine leaves them. */
async function seedRun(
  phase: RunPhase,
  sessionId = generateId("ses"),
): Promise<{ runId: string; sessionId: string }> {
  const existing = await server.store
    .getResource(ApiResourceKind.session, sessionId, SessionSchema)
    .catch(() => undefined);
  if (existing === undefined) {
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
  }
  const runId = generateId("run");
  await server.store.saveResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Run",
      metadata: { id: runId, name: runId, slug: runId, org },
      spec: { target: { case: "sessionId", value: sessionId } },
      status: { phase },
    }),
  );
  return { runId, sessionId };
}

function feedback(runId: string, passed: boolean, comment = ""): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: { org },
    spec: {
      runId,
      metric: "feedback",
      source: ScoreSource.human,
      value: { case: "passed", value: passed },
      comment,
    },
  });
}

function check(
  runId: string,
  opts: { graded?: boolean; reason?: string } = {},
): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: { org },
    spec: {
      runId,
      metric: "run-health",
      source: ScoreSource.check,
      evaluatorVersion: "checks-v1",
      ...(opts.graded === false
        ? {}
        : { value: { case: "passed", value: true } }),
    },
    ...(opts.reason === undefined
      ? {}
      : { status: { notGradedReason: opts.reason } }),
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

describe("a person's rating", () => {
  it("rates a completed run once, in the run's session, and changes it with update", async () => {
    const { runId, sessionId } = await seedRun(RunPhase.RUN_COMPLETED);
    const rated = await wire.create(feedback(runId, true, "good"));
    expect(rated.metadata?.id).toMatch(/^scr_/);
    expect(rated.spec?.sessionId).toBe(sessionId);
    expect(rated.status?.state).toBe(ScoreState.graded);

    const again = await failureOf(wire.create(feedback(runId, false)));
    expect(again.code).toBe(Code.AlreadyExists);
    expect(again.rawMessage).toBe(feedbackExistsMessage(rated.metadata!.id));
    const [info] = again.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe(SCORE_EXISTS_REASON);
    expect(info?.metadata["score_id"]).toBe(rated.metadata!.id);

    const edited = create(ScoreSchema, rated);
    edited.spec!.value = { case: "passed", value: false };
    edited.spec!.comment = "wrong label";
    const changed = await wire.update(edited);
    expect(changed.spec?.value).toEqual({ case: "passed", value: false });
    expect(changed.spec?.comment).toBe("wrong label");
    expect(changed.status?.state).toBe(ScoreState.graded);
  });
});

describe("a check's verdict", () => {
  it("comes from the server alone", async () => {
    const { runId } = await seedRun(RunPhase.RUN_COMPLETED);
    const refused = await failureOf(wire.create(check(runId)));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(CHECK_SOURCE_REFUSED_MESSAGE);
    const recorded = await inProcess.create(check(runId));
    expect(recorded.spec?.source).toBe(ScoreSource.check);
  });

  it("is recorded once per version of the checks", async () => {
    const { runId } = await seedRun(RunPhase.RUN_COMPLETED);
    const first = await inProcess.create(check(runId));
    const second = await failureOf(inProcess.create(check(runId)));
    expect(second.code).toBe(Code.AlreadyExists);
    expect(second.rawMessage).toBe(runHealthExistsMessage(first.metadata!.id));
  });

  it("keeps the server's not-graded reason", async () => {
    const { runId } = await seedRun(RunPhase.RUN_COMPLETED);
    const recorded = await inProcess.create(
      check(runId, { graded: false, reason: "grading could not start" }),
    );
    expect(recorded.status?.state).toBe(ScoreState.not_graded);
    expect(recorded.status?.notGradedReason).toBe("grading could not start");
    expect(recorded.spec?.value.case).toBeUndefined();
  });

  it("is final on update", async () => {
    const { runId } = await seedRun(RunPhase.RUN_COMPLETED);
    const recorded = await inProcess.create(check(runId));
    const edited = create(ScoreSchema, recorded);
    edited.spec!.value = { case: "passed", value: false };
    const refused = await failureOf(wire.update(edited));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(SCORE_UPDATE_HUMAN_ONLY_MESSAGE);
  });
});

describe("the lists", () => {
  it("carry a run's scores and a session's runs' scores", async () => {
    const first = await seedRun(RunPhase.RUN_COMPLETED);
    const second = await seedRun(RunPhase.RUN_COMPLETED, first.sessionId);
    await wire.create(feedback(first.runId, true));
    await inProcess.create(check(first.runId));
    await inProcess.create(check(second.runId));

    expect((await query.listByRun({ runId: first.runId })).items).toHaveLength(
      2,
    );
    const session = await query.listBySession({ sessionId: first.sessionId });
    expect(session.totalCount).toBe(3);
    expect(new Set(session.items.map((s) => s.spec?.runId))).toEqual(
      new Set([first.runId, second.runId]),
    );
  });
});

describe("the cascades", () => {
  it("deleting a run removes its scores", async () => {
    const { runId } = await seedRun(RunPhase.RUN_COMPLETED);
    const rating = await wire.create(feedback(runId, true));
    const health = await inProcess.create(check(runId));
    await createClient(RunCommandController, server.inProcessTransport).delete({
      value: runId,
    });
    for (const id of [rating.metadata!.id, health.metadata!.id]) {
      expect((await failureOf(query.get({ value: id }))).code).toBe(
        Code.NotFound,
      );
    }
  });

  it("deleting a session removes its runs' scores", async () => {
    const first = await seedRun(RunPhase.RUN_COMPLETED);
    const second = await seedRun(RunPhase.RUN_COMPLETED, first.sessionId);
    const a = await inProcess.create(check(first.runId));
    const b = await wire.create(feedback(second.runId, false));
    await createClient(
      SessionCommandController,
      server.inProcessTransport,
    ).delete({
      value: first.sessionId,
    });
    for (const id of [a.metadata!.id, b.metadata!.id]) {
      expect((await failureOf(query.get({ value: id }))).code).toBe(
        Code.NotFound,
      );
    }
    expect(
      (await query.listBySession({ sessionId: first.sessionId })).items,
    ).toEqual([]);
  });
});
