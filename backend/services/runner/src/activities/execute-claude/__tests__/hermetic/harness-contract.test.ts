/**
 * The harness contract kit, BOTH halves, against the REAL Claude adapter on
 * the REAL engine.
 *
 * The subject (`__test-utils__/contract-subject.ts`) hosts
 * `createClaudeAdapter()` as production does and scripts only what the
 * engine's model says, through the wire-level mock behind the runner's real
 * proxy. Nothing of the adapter or the engine is doubled; the control-plane
 * client is the one double every hermetic run substitutes.
 *
 * Every arm that drives a person's approval runs: the gate pauses at the
 * call (`defer`), and the resumed engine runs exactly that call.
 *
 * Declared off, each with its reason:
 *  - the `actionable` and `internal` failure surfaces: no model answer
 *    provokes them (a refused turn is actionable, a broken engine internal;
 *    each has its own golden);
 *  - the tool-call limit: the runtime's operation limit bounds a Claude turn,
 *    as it does a Cursor one; the engine has no round budget of Stigmer's;
 *  - an engine-side cancel: the engine never ends a run cancelled;
 *  - a cut vendor connection: every model call is its own request through
 *    the runner's proxy, so no connection outlives a call.
 */

import { afterAll, beforeAll, describe, vi } from "vitest";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { describeHarnessContract } from "../../../../__test-utils__/harness-contract/contract.js";
import { describeHarnessRuntimeContract } from "../../../../__test-utils__/harness-contract/runtime-contract.js";
import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { createClaudeContractSubject } from "../../__test-utils__/contract-subject.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = createClaudeContractSubject(env);

describe("ExecuteClaude hermetic — the harness contract kit against the real adapter and engine", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(() => {
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(async () => {
    clock.uninstall();
    registry.restore();
    await subject.close();
    env.dispose();
  });

  describeHarnessContract(subject);
  describeHarnessRuntimeContract({ subject, env, clock }, {
    failureSurfaces: ["engine"],
    toolCallLimit: false,
    engineCancel: false,
    streamCut: false,
  });
});
