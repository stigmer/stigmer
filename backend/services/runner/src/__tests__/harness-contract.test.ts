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
 * This is the consolidation home for what every harness owes the turn
 * runtime. A real adapter joins the net by implementing
 * `HarnessContractSubject` for its own SDK double and adding one line below;
 * the runtime extraction (S2 of the program) adds the Cursor adapter here
 * and runs the runtime-side half through the hermetic activity driver.
 */

import { describeHarnessContract } from "../__test-utils__/harness-contract/contract.js";
import { scriptedSubject } from "../__test-utils__/harness-contract/scripted-adapter.js";

const interruptEngineMinted = scriptedSubject({ pausePrimitive: "interrupt", stateIdSource: "engine-minted" });
const denyAndRetryDeterministic = scriptedSubject({ pausePrimitive: "deny-and-retry", stateIdSource: "deterministic" });

describeHarnessContract(interruptEngineMinted);
describeHarnessContract(denyAndRetryDeterministic);
