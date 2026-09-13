/**
 * The harness contract kit, BOTH halves, against the REAL native deep-agent
 * adapter under the sqlite checkpointer.
 *
 * The adapter-side half (`__test-utils__/harness-contract/contract.ts`) is the
 * single statement of what every `HarnessAdapter` owes the runtime;
 * `src/__tests__/harness-contract.test.ts` runs it against the scripted fake
 * under both pause primitives, `execute-cursor/__tests__/hermetic/
 * harness-contract.test.ts` against the real Cursor adapter. The runtime-side
 * half (`runtime-contract.ts`) is what the turn runtime owes every harness,
 * through the real activity under `MockActivityEnvironment`. This file runs
 * BOTH against `createDeepAgentAdapter()` through the native subject
 * (`__test-utils__/contract-subject.ts`), which translates the kit's
 * scenarios onto the `ScriptedModel` double and lets deepagents' real
 * built-ins run over the real approval gate. Nothing of the adapter is
 * mocked; the model client and the control-plane client are the two doubles
 * every native hermetic golden already substitutes.
 *
 * The posture is sqlite, the production local default (`config.ts`): the
 * test-only memory saver re-interrupts on replay and duplicates the gated
 * row (S3 M0 finding F-M0-3), so it cannot carry the HITL arms. One sqlite
 * file per session lands under the hermetic `HOME`, opened and closed per
 * turn by the adapter.
 *
 * What this subject declares it cannot produce, so the kit reports the arm
 * SKIPPED and never silently passes: the `engine` and `actionable` failure
 * surfaces (`turn.ts` classifies every escaped error `internal` — the
 * adapter has one surface), and an engine-side cancel (no native path ends a
 * turn `cancelled`).
 *
 * No golden: the kit asserts behaviour, the goldens under `goldens/` pin
 * transcripts. The hermetic environment is created at module level because
 * the subject's `config` is read at collection time; the forks pool keeps it
 * private to this file.
 */

import { afterAll, beforeAll, describe, vi } from "vitest";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { describeHarnessContract } from "../../../../__test-utils__/harness-contract/contract.js";
import { describeHarnessRuntimeContract } from "../../../../__test-utils__/harness-contract/runtime-contract.js";
import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { createDeepAgentContractSubject } from "../../__test-utils__/contract-subject.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = createDeepAgentContractSubject(env);

describe("ExecuteDeepAgent hermetic — the harness contract kit against the real adapter", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(() => {
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  describeHarnessContract(subject);
  describeHarnessRuntimeContract({ subject, env, clock }, { failureSurfaces: ["internal"] });
});
