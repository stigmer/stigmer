/**
 * The runnable harness adapter contract.
 *
 * Runs the single, authoritative invariant catalog (see
 * `__test-utils__/harness-contract/contract.ts`) against the scripted
 * reference adapter under BOTH real pause primitives and BOTH state-id
 * sources: `interrupt` with an engine-minted id and `deny-and-retry` with a
 * deterministic id. Neither the kit nor the fake branches on the pause
 * primitive — running both is what proves it.
 *
 * This is the fake's home in the net. A real adapter joins by implementing
 * `HarnessContractSubject` over its own SDK double and registering both
 * halves in its own hermetic file, where the mocks its double needs can be
 * hoisted: the Cursor adapter does so in
 * `activities/execute-cursor/__tests__/hermetic/harness-contract.test.ts`
 * (S2 M4), and the fake's runtime-side half runs in
 * `harness/__tests__/run-turn.test.ts`.
 */

import { describeHarnessContract } from "../__test-utils__/harness-contract/contract.js";
import { scriptedSubject } from "../__test-utils__/harness-contract/scripted-adapter.js";

const interruptEngineMinted = scriptedSubject({ pausePrimitive: "interrupt", stateIdSource: "engine-minted" });
const denyAndRetryDeterministic = scriptedSubject({ pausePrimitive: "deny-and-retry", stateIdSource: "deterministic" });

describeHarnessContract(interruptEngineMinted);
describeHarnessContract(denyAndRetryDeterministic);
