/**
 * A plugin-eval try's own phases through the real runtime, with the scripted
 * fake adapter under `MockActivityEnvironment`: the case's setup
 * (`prepareEvalCasePhase`) and its MCP stand-ins (`startEvalMocks`) in
 * `turn-context.ts`, and the two settlements they feed in `run-turn.ts`.
 *
 *  - A failed scaffold settles the turn before any engine starts: TERMINATED,
 *    with the try stop's sentence as the error, so the eval reads it back
 *    with `parseTryStop`.
 *  - A prepared case carries its variables into the run's values, and its
 *    mocks' endpoint is started, bound to the turn's stop and cost cap, and
 *    closed when the turn ends. A mock that stops the try ends the turn
 *    TERMINATED with the mock-abort sentence.
 *
 * The archive read, the setup and the endpoint are module fakes here: each
 * has its own suite under `shared/plugin-eval/__tests__/`, and what this file
 * pins is the runtime's wiring of them. The hermetic environment is created
 * at module level because the subject's `config` is read at collection time.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { PluginEvalCaseContextSchema, PluginEvalMockServerSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/plugin_eval_case_pb";
import { parseTryStop } from "@stigmer/eval-runtime";

import type { PrepareOutcome } from "../../shared/plugin-eval/prepare-case.js";
import type { MockEndpoint, MockEndpointBinding } from "../../shared/plugin-eval/mock-endpoint.js";

const fakes = vi.hoisted(() => ({
  outcome: undefined as PrepareOutcome | undefined,
  prepared: [] as { sessionId: string; primaryDir: string }[],
  bindings: [] as MockEndpointBinding[],
  started: 0,
  closed: 0,
  /** What the endpoint does once bound: report a cost, then stop the try. */
  onBound: undefined as ((binding: MockEndpointBinding) => void) | undefined,
}));

vi.mock("../../client/stigmer-client.js", async () =>
  (await import("../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);
vi.mock("../../shared/plugin-eval/case-archive.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/plugin-eval/case-archive.js")>();
  return { ...actual, fetchCaseArchive: () => Promise.resolve(actual.caseArchiveOf([])) };
});
vi.mock("../../shared/plugin-eval/prepare-case.js", () => ({
  prepareEvalCase: (args: { sessionId: string; primaryDir: string }) => {
    fakes.prepared.push({ sessionId: args.sessionId, primaryDir: args.primaryDir });
    if (fakes.outcome === undefined) throw new Error("no outcome scripted");
    return Promise.resolve(fakes.outcome);
  },
}));
vi.mock("../../shared/plugin-eval/mock-endpoint.js", () => ({
  startMockEndpoint: (): Promise<MockEndpoint> => {
    fakes.started += 1;
    return Promise.resolve({
      servers: [],
      bind: (binding: MockEndpointBinding) => {
        fakes.bindings.push(binding);
        fakes.onBound?.(binding);
      },
      close: () => {
        fakes.closed += 1;
        return Promise.resolve();
      },
    });
  },
}));

import { ScriptedClock, createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { scriptedSubject } from "../../__test-utils__/harness-contract/scripted-adapter.js";
import { scenario } from "../../__test-utils__/harness-contract/types.js";
import { RuntimeExecutionDriver, type RuntimeContractHarness } from "../../__test-utils__/harness-contract/runtime-contract.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = scriptedSubject({
  pausePrimitive: "interrupt",
  stateIdSource: "engine-minted",
  config: { workspaceRootDir: env.workspaceRootDir, taskQueue: "runtime-eval-case-queue" },
});
const harness: RuntimeContractHarness = { subject, env, clock };

/** A driver whose run is a plugin-eval try, with mocks when `mocked`. */
function tryDriver(label: string, mocked: boolean): RuntimeExecutionDriver {
  const driver = new RuntimeExecutionDriver(harness, label);
  driver.record.execution.spec!.pluginEvalCase = create(PluginEvalCaseContextSchema, {
    pluginId: "plg_1",
    pluginDigest: "a".repeat(64),
    suiteDir: "evals",
    caseDir: "evals/fix",
    mocks: mocked ? [create(PluginEvalMockServerSchema, { server: "tracker", segment: "plugin_kit_tracker" })] : [],
  });
  return driver;
}

describe("run-turn: a plugin-eval try's own phases", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(async () => {
    registry = stubRegistryFetch();
    clock.install();
    await subject.adapter.boot(subject.config);
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  beforeEach(() => {
    clock.reset();
    fakes.outcome = undefined;
    fakes.prepared.length = 0;
    fakes.bindings.length = 0;
    fakes.started = 0;
    fakes.closed = 0;
    fakes.onBound = undefined;
  });

  it("a failed scaffold settles the turn TERMINATED with the try stop's sentence, before any engine or endpoint starts", async () => {
    fakes.outcome = { kind: "scaffold-failed", detail: "exit 3: no such repository" };
    const driver = tryDriver("eval-scaffold-failed", true);

    await driver.turn([scenario.say("never said")]);

    expect(fakes.prepared.map((p) => p.sessionId)).toEqual([driver.sessionId]);
    expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_TERMINATED);
    const error = driver.record.lastFullStatus?.error ?? "";
    expect(parseTryStop(error)).toEqual({ kind: "scaffold-failed", detail: "exit 3: no such repository" });
    expect(fakes.started, "the mocks start after the setup").toBe(0);
  });

  it("a prepared case starts its mocks, binds them to the turn's cap and stop, and a mock's stop ends the turn TERMINATED", async () => {
    fakes.outcome = { kind: "ready", prepared: { referenceInputs: [], history: undefined, env: { EVAL_X: "x" } } };
    fakes.onBound = (binding) => {
      binding.onCost(0.001);
      setTimeout(() => binding.onAbort({ server: "tracker", tool: "create_issue", reason: "input.title must be a string" }), 5);
    };
    const driver = tryDriver("eval-mock-abort", true);

    await driver.turn([scenario.say("Filing the issue."), scenario.hang()]);

    expect(fakes.started).toBe(1);
    expect(fakes.bindings).toHaveLength(1);
    expect(fakes.closed, "the turn closes its endpoint").toBe(1);
    expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_TERMINATED);
    expect(parseTryStop(driver.record.lastFullStatus?.error ?? "")).toEqual({
      kind: "mock-aborted",
      server: "tracker",
      tool: "create_issue",
      reason: "input.title must be a string",
    });
  });

  it("a prepared case without mocks starts no endpoint and completes", async () => {
    fakes.outcome = { kind: "ready", prepared: { referenceInputs: [], history: undefined, env: {} } };
    const driver = tryDriver("eval-no-mocks", false);

    await driver.turn([scenario.say("Done.")]);

    expect(fakes.prepared).toHaveLength(1);
    expect(fakes.started).toBe(0);
    expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
  });
});
