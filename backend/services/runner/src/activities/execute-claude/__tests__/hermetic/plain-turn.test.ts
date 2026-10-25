/**
 * Hermetic golden: the simplest Claude turn through the whole `ExecuteClaude`
 * activity, on the real engine: one message in, one answer out, no tools.
 *
 * Invariant pinned: the activity resolves the record, hosts the adapter as
 * production does, starts the engine against the wire mock through the
 * runner's real proxy, translates its stream into the session's log and
 * rows, persists IN_PROGRESS then COMPLETED, and returns the slim status.
 * The goldens (`goldens/plain-turn.*.json`) are the smallest status, rows
 * and events this engine produces: one answer with the scripted text, its
 * usage priced at the fixture registry's Claude row, on the scripted clock.
 *
 * Every model call the engine makes rides the Anthropic lane with the run's
 * execution id and arrives with the runner's credential, never the turn's
 * key (the proxy swaps it); the egress half of that is `isolation.test.ts`'s.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/plain-turn.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden } from "../../../../__test-utils__/hermetic-activity.js";
import { MessageType } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { WIRE_RUNNER_TOKEN, anthropicText, saidByUser } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";

const USER_MESSAGE = "Say hello.";
const ANSWER = "Hello from the hermetic Claude agent.";
const GOLDEN = "./goldens/plain-turn.status.json";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

describe("ExecuteClaude hermetic — plain turn", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("persists IN_PROGRESS then COMPLETED with one answer, priced, and returns the slim status", async () => {
    const record = claudeExecutionRecord({ message: USER_MESSAGE });
    const invocation = await file.run(record, () => anthropicText(ANSWER, { inputTokens: 1_200, outputTokens: 30 }));

    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.persistedPhases).toEqual([RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_COMPLETED]);

    const final = record.lastFullStatus!;
    const rows = record.rowsOf(final);
    expect(rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content)).toEqual([ANSWER]);
    expect(final.streamingUsage?.model).toBe(FIXTURE.model);
    expect(final.streamingUsage?.estimatedCostUsd, "priced at the registry's Claude row").toBeGreaterThan(0);

    const conversations = file.wire().conversations;
    expect(conversations.length, "one model call answers a turn with no tools").toBe(1);
    expect(saidByUser(conversations[0]!, USER_MESSAGE), "the person's message reaches the model as written").toBe(true);
    for (const request of file.wire().requests()) {
      expect(request.path.startsWith("/v1/proxy/llm/anthropic/v1/messages")).toBe(true);
      expect(request.headers["x-stigmer-execution-id"]).toBe(FIXTURE.executionId);
      expect(request.headers.authorization, "the proxy forwards with the runner's credential").toBe(`Bearer ${WIRE_RUNNER_TOKEN}`);
      expect(request.headers["x-api-key"], "the turn's key never leaves the proxy").toBeUndefined();
    }
    expect(file.registryUrls().every((u) => u.includes("/model-registry"))).toBe(true);

    const json = statusGolden(final);
    expect(json, "no temp path reaches the status").not.toContain(env.workspaceRootDir);
    await expect(json).toMatchFileSnapshot(GOLDEN);
    await expect(rowsGolden(rows)).toMatchFileSnapshot(rowsGoldenPath(GOLDEN));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/plain-turn.events.json");
  });
});
