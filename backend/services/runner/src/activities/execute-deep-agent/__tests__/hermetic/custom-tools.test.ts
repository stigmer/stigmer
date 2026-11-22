/**
 * Hermetic: the host app's own tools on the Stigmer engine, held to the
 * contract every engine runs (`__test-utils__/custom-tool-contract/contract.ts`),
 * once for a conversation with a computer and once for one without
 * (`Computer.NONE`): the host's tools need nothing of the computer.
 */

import { afterAll, beforeAll, vi } from "vitest";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { describeCustomToolContract } from "../../../../__test-utils__/custom-tool-contract/contract.js";
import { stigmerCustomToolSubject } from "../../__test-utils__/custom-tool-subject.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
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

describeCustomToolContract(stigmerCustomToolSubject(env, clock, undefined, "stigmer"));
describeCustomToolContract(stigmerCustomToolSubject(env, clock, Computer.NONE, "stigmer (no computer)"));
