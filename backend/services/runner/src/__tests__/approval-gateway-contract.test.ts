/**
 * The runnable HITL gateway P0 safety contract.
 *
 * Runs the single, authoritative invariant catalog (see
 * `__test-utils__/approval-contract/contract.ts`) against BOTH real enforcement
 * substrates — the in-process deep-agent gate (a real LangGraph graph) and the
 * out-of-process Cursor deny-oracle (the real bash hook) — and then asserts the
 * two substrates AGREE on the same logical action.
 *
 * This is the consolidation home for the Phase-2 (T03) gateway safety behaviors:
 * reverting any P0 behavior on either substrate fails here, and a future
 * substrate joins the safety net by implementing `GatewaySubstrate` and adding
 * one line below. The Cursor suite self-skips where `bash` is unavailable.
 */

import {
  describeGatewayContract,
  describeCrossSubstrateAgreement,
} from "../__test-utils__/approval-contract/contract.js";
import { createDeepAgentSubstrate } from "../activities/execute-deep-agent/__test-utils__/gateway-substrate.js";
import { createCursorSubstrate } from "../activities/execute-cursor/__test-utils__/gateway-substrate.js";

const deepAgent = createDeepAgentSubstrate();
const cursor = createCursorSubstrate();

describeGatewayContract(deepAgent);
describeGatewayContract(cursor);

describeCrossSubstrateAgreement([deepAgent, cursor]);
