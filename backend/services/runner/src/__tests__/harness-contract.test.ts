/**
 * The runnable harness adapter contract.
 *
 * Runs the single, authoritative invariant catalog (see
 * `__test-utils__/harness-contract/contract.ts`) against the scripted
 * reference adapter.
 *
 * This is the fake's home in the net. A real adapter joins by implementing
 * `HarnessContractSubject` over its own SDK double and registering both
 * halves in its own hermetic file, where the mocks its double needs can be
 * hoisted: the native adapter does so in
 * `activities/execute-deep-agent/__tests__/hermetic/harness-contract.test.ts`,
 * the Claude adapter in
 * `activities/execute-claude/__tests__/hermetic/harness-contract.test.ts`,
 * and the fake's runtime-side half runs in
 * `harness/__tests__/run-turn.test.ts`.
 */

import { describeHarnessContract } from "../__test-utils__/harness-contract/contract.js";
import { scriptedSubject } from "../__test-utils__/harness-contract/scripted-adapter.js";

describeHarnessContract(scriptedSubject({}));
