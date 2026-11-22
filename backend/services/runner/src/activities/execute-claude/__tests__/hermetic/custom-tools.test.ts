/**
 * Hermetic: the host app's own tools on the Claude engine, held to the
 * contract every engine runs (`__test-utils__/custom-tool-contract/contract.ts`)
 * on the real engine against the wire-level mock.
 */

import { afterAll, beforeAll, vi } from "vitest";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { describeCustomToolContract } from "../../../../__test-utils__/custom-tool-contract/contract.js";
import { claudeScenarioFile, type ClaudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";
import { claudeCustomToolSubject } from "../../__test-utils__/custom-tool-subject.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
let file: ClaudeScenarioFile;

beforeAll(async () => {
  file = claudeScenarioFile(env, clock);
  await file.start();
});
afterAll(async () => {
  await file.stop();
});

describeCustomToolContract(claudeCustomToolSubject(() => file));
