// Conformance suite for a finished run's scores: the run-health grade the
// platform writes when a run completes, and a person's thumbs.
// Domain: agentic / score — graded on a real engine, with the scripted model.
//
// The contract under test:
//   - every completed run gets one run-health score, written by the grading
//     workflow on its own queue, from three free checks: the same tool with
//     the same inputs and the same result three times in a row fails
//     `no-repeated-calls` naming the tool and the steps; a run asked for an
//     answer in a fixed shape that gives none fails
//     `structured-output-delivered`; a clean run passes;
//   - a run-health reason names tools and steps, never what anyone typed;
//   - a failed run is never graded, and nobody can rate it;
//   - a person rates a completed run once (a second rating is ALREADY_EXISTS
//     carrying SCORE_EXISTS and the existing score's id), changes it with
//     update, and cannot change a check's verdict; the run's and the
//     session's lists both carry it;
//   - a score lives in its run's organization;
//   - deleting a run removes its scores, and deleting a session removes its
//     runs' scores;
//   - under an enforcing authorizer, a member who cannot see a colleague's
//     run can neither rate it nor read its scores.
import { Code } from "@connectrpc/connect";
import type { JsonObject } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import {
  anthropicText,
  anthropicToolUse,
  type AnthropicMessageBody,
} from "@stigmer/test-support/mock-llm";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import { agentRefOf, makeAgent } from "../support/agents";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import {
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
  sessionIdOf,
} from "../support/runs";
import {
  FEEDBACK,
  NO_REPEATED_CALLS,
  RUN_HEALTH,
  SCORE_CREATE_DENIED_MESSAGE,
  SCORE_EXISTS_REASON,
  SCORE_UPDATE_HUMAN_ONLY_MESSAGE,
  STRUCTURED_OUTPUT_DELIVERED,
  awaitRunHealth,
  editedFeedback,
  makeFeedback,
  runNotCompletedMessage,
  scoreOrgMismatchMessage,
} from "../support/scores";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

// What a person typed, sent through the echo tool: no reason may quote it.
const TYPED_TEXT = "private-words-from-a-person";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  // A run whose arm ended before it reached the model would take the next
  // arm's script; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  await target?.teardown();
});

interface RunOptions {
  readonly script: AnthropicMessageBody[];
  readonly withEchoTool?: boolean;
  readonly schema?: JsonObject;
  readonly sessionId?: string;
}

// One run of a fresh agent in a fresh organization (or a further turn of an
// existing session), scripted on the mock, awaited to its terminal phase.
async function runToEnd(org: string, opts: RunOptions): Promise<Run> {
  const mcpServerRefs: string[] = [];
  if (opts.withEchoTool === true) {
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("mcp-scores"), url: mcp.url() }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    mcpServerRefs.push(server.metadata!.slug);
  }
  let agentRef: ReturnType<typeof agentRefOf> | undefined;
  if (opts.sessionId === undefined) {
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-scores"), mcpServerRefs }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    agentRef = agentRefOf(agent);
  }
  for (const turn of opts.script) mock.enqueue(turn);
  const created = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("run-scores"),
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : { agentRef }),
      message: `Use the tool with ${TYPED_TEXT}.`,
      autoApproveAll: true,
      ...(opts.schema !== undefined ? { structuredOutputSchema: opts.schema } : {}),
    }),
  );
  return awaitTerminal(clients, created.metadata!.id);
}

function expectCompleted(run: Run): void {
  expect(
    run.status?.phase,
    `run ${run.metadata?.id} should COMPLETE; reached ${RunPhase[run.status?.phase ?? 0]} (error: ${run.status?.error ?? ""})`,
  ).toBe(RunPhase.RUN_COMPLETED);
}

function criterion(score: Score, name: string) {
  return score.spec?.criteria.find((c) => c.name === name);
}

describe("Run scores", () => {
  it("[rpc:ScoreQueryController.listByRun] a run stuck on the same call three times gets a failed run-health naming the tool", async () => {
    const { org } = await target.provisionTenancy();
    const run = await runToEnd(org, {
      withEchoTool: true,
      script: [
        anthropicToolUse("call_1", ECHO_TOOL_NAME, { text: TYPED_TEXT }),
        anthropicToolUse("call_2", ECHO_TOOL_NAME, { text: TYPED_TEXT }),
        anthropicToolUse("call_3", ECHO_TOOL_NAME, { text: TYPED_TEXT }),
        anthropicText("Done."),
      ],
    });
    expectCompleted(run);

    const health = await awaitRunHealth(clients, run.metadata!.id);
    expect(health.spec?.source).toBe(ScoreSource.check);
    expect(health.spec?.sessionId).toBe(sessionIdOf(run));
    expect(health.spec?.evaluatorVersion).not.toBe("");
    expect(health.status?.state).toBe(ScoreState.graded);
    expect(health.spec?.value).toEqual({ case: "passed", value: false });
    const stuck = criterion(health, NO_REPEATED_CALLS);
    expect(stuck?.result).toBe(CriterionResult.failed);
    expect(stuck?.reason).toContain(ECHO_TOOL_NAME);
    expect(stuck?.reason).toContain("steps 1 to 3");
    for (const c of health.spec?.criteria ?? []) {
      expect(c.reason, `criterion ${c.name} quotes no typed text`).not.toContain(TYPED_TEXT);
    }
  });

  it("[rpc:ScoreQueryController.listByRun] a run asked for a fixed shape that answers in prose fails structured-output-delivered", async () => {
    const { org } = await target.provisionTenancy();
    const run = await runToEnd(org, {
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      // The final text carries no JSON, so the runner asks an extractor once
      // more; it answers in prose too, and the run completes without output.
      script: [anthropicText("Here is my answer in words."), anthropicText("Still no structure.")],
    });
    expectCompleted(run);
    expect(run.status?.structuredOutput).toBeUndefined();

    const health = await awaitRunHealth(clients, run.metadata!.id);
    expect(health.spec?.value).toEqual({ case: "passed", value: false });
    expect(criterion(health, STRUCTURED_OUTPUT_DELIVERED)?.result).toBe(CriterionResult.failed);
  });

  it("[rpc:ScoreCommandController.create] [rpc:ScoreCommandController.update] [rpc:ScoreQueryController.get] [rpc:ScoreQueryController.listBySession] a clean run passes, and a person rates it once and changes the rating", async () => {
    const { org } = await target.provisionTenancy();
    const run = await runToEnd(org, { script: [anthropicText("Hello.")] });
    expectCompleted(run);
    const runId = run.metadata!.id;

    const health = await awaitRunHealth(clients, runId);
    expect(health.spec?.value).toEqual({ case: "passed", value: true });
    expect(
      health.spec?.criteria.every((c) => c.result !== CriterionResult.failed),
      "no criterion of a clean run failed",
    ).toBe(true);

    const rated = await clients.scoreCommand.create(makeFeedback(org, runId, false, "picked the wrong label"));
    expect(rated.spec?.metric).toBe(FEEDBACK);
    expect(rated.spec?.sessionId).toBe(sessionIdOf(run));
    expect(rated.status?.state).toBe(ScoreState.graded);
    expect((await clients.scoreQuery.get({ value: rated.metadata!.id })).spec?.comment).toBe("picked the wrong label");

    const again = await expectGrpcCode(
      () => clients.scoreCommand.create(makeFeedback(org, runId, true)),
      Code.AlreadyExists,
      "a second rating of the same run",
    );
    const [info] = again.findDetails(ErrorInfoSchema);
    expect(info?.reason).toBe(SCORE_EXISTS_REASON);
    expect(info?.metadata["score_id"]).toBe(rated.metadata!.id);

    const changed = await clients.scoreCommand.update(editedFeedback(rated, true, "fine after all"));
    expect(changed.spec?.value).toEqual({ case: "passed", value: true });
    expect(changed.spec?.comment).toBe("fine after all");

    const verdict = await expectGrpcCode(
      () => clients.scoreCommand.update(editedFeedback(health, true, "")),
      Code.FailedPrecondition,
      "changing a check's verdict",
    );
    expect(verdict.rawMessage).toBe(SCORE_UPDATE_HUMAN_ONLY_MESSAGE);

    const session = await clients.scoreQuery.listBySession({ sessionId: sessionIdOf(run) });
    expect(session.items.map((s) => s.spec?.metric).sort()).toEqual([FEEDBACK, RUN_HEALTH]);
  });

  it("[rpc:ScoreCommandController.create] a score lives in its run's organization", async () => {
    const { org } = await target.provisionTenancy();
    const { org: elsewhere } = await target.provisionTenancy();
    const run = await runToEnd(org, { script: [anthropicText("Hello.")] });
    expectCompleted(run);
    const refused = await expectGrpcCode(
      () => clients.scoreCommand.create(makeFeedback(elsewhere, run.metadata!.id, true)),
      Code.FailedPrecondition,
      "a score filed in another organization",
    );
    expect(refused.rawMessage).toBe(scoreOrgMismatchMessage(org));
  });

  it("[rpc:ScoreCommandController.create] a failed run is never graded and cannot be rated", async () => {
    const { org } = await target.provisionTenancy();
    mock.enqueueError(400, {
      body: { type: "error", error: { type: "invalid_request_error", message: "refused by the scripted model" } },
    });
    const run = await runToEnd(org, { script: [] });
    expect(run.status?.phase).toBe(RunPhase.RUN_FAILED);
    const runId = run.metadata!.id;

    const refused = await expectGrpcCode(
      () => clients.scoreCommand.create(makeFeedback(org, runId, false)),
      Code.FailedPrecondition,
      "rating a failed run",
    );
    expect(refused.rawMessage).toBe(runNotCompletedMessage(runId));
    // Grading starts on COMPLETED only; give a wrongly started workflow
    // time to write before reading.
    await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
    expect((await clients.scoreQuery.listByRun({ runId })).items).toEqual([]);
  });

  it("[rpc:ScoreCommandController.delete] deleting a run removes its scores, and deleting a session its runs' scores", async () => {
    const { org } = await target.provisionTenancy();
    const first = await runToEnd(org, { script: [anthropicText("First.")] });
    expectCompleted(first);
    const sessionId = sessionIdOf(first);
    const second = await runToEnd(org, { sessionId, script: [anthropicText("Second.")] });
    expectCompleted(second);

    const firstHealth = await awaitRunHealth(clients, first.metadata!.id);
    const firstRating = await clients.scoreCommand.create(makeFeedback(org, first.metadata!.id, true));
    const secondHealth = await awaitRunHealth(clients, second.metadata!.id);

    // A person deletes their own rating.
    await clients.scoreCommand.delete({ value: firstRating.metadata!.id });
    await expectGrpcCode(
      () => clients.scoreQuery.get({ value: firstRating.metadata!.id }),
      Code.NotFound,
      "a deleted rating",
    );

    await clients.agentExecutionCommand.delete({ value: first.metadata!.id });
    await expectGrpcCode(
      () => clients.scoreQuery.get({ value: firstHealth.metadata!.id }),
      Code.NotFound,
      "a deleted run's run-health score",
    );

    await clients.sessionCommand.delete({ value: sessionId });
    await expectGrpcCode(
      () => clients.scoreQuery.get({ value: secondHealth.metadata!.id }),
      Code.NotFound,
      "a deleted session's run's run-health score",
    );
  });

  it("[rpc:ScoreCommandController.create] [rpc:ScoreQueryController.listByRun] a member who cannot see a colleague's run can neither rate it nor read its scores", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    if (lane.llmProxy === undefined) {
      throw new Error(`target "${target.name}" lends an enforcing lane with no runner (no llmProxy)`);
    }
    const laneMock = lane.llmProxy();
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy));
    const member = await lane.provisionMember(tenancy);

    const agent = await lane.clients.agentCommand.create(
      makeAgent({ org: tenancy.org, name: uniqueName("agent-scores-lane") }),
    );
    fixtures.defer(() => lane.clients.agentCommand.delete({ value: agent.metadata!.id }));
    laneMock.enqueue(anthropicText("Hello from the founder's run."));
    const created = await lane.clients.agentExecutionCommand.create(
      makeAgentExecution({
        org: tenancy.org,
        name: uniqueName("run-scores-lane"),
        agentRef: agentRefOf(agent),
        autoApproveAll: true,
      }),
    );
    const run = await awaitTerminal(lane.clients, created.metadata!.id);
    expectCompleted(run);
    const runId = run.metadata!.id;
    await awaitRunHealth(lane.clients, runId);

    const refused = await expectGrpcCode(
      () => member.scoreCommand.create(makeFeedback(tenancy.org, runId, false)),
      Code.PermissionDenied,
      "a member rating a colleague's private run",
    );
    expect(refused.rawMessage).toBe(SCORE_CREATE_DENIED_MESSAGE);
    await expectGrpcCode(
      () => member.scoreQuery.listByRun({ runId }),
      Code.PermissionDenied,
      "a member reading a colleague's run's scores",
    );

    const own = await lane.clients.scoreCommand.create(makeFeedback(tenancy.org, runId, true));
    expect(own.spec?.source).toBe(ScoreSource.human);
    await expectGrpcCode(
      () => member.scoreQuery.get({ value: own.metadata!.id }),
      Code.PermissionDenied,
      "a member reading a colleague's rating",
    );
  });
});
