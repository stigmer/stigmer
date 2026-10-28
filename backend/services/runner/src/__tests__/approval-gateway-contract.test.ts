/**
 * The runnable HITL gateway P0 safety contract.
 *
 * Runs the single, authoritative invariant catalog (see
 * `__test-utils__/approval-contract/contract.ts`) against every real
 * enforcement substrate — the in-process deep-agent gate (a real LangGraph
 * graph) and the Claude gate (the production gate and its engine
 * callbacks) — and then asserts the substrates AGREE on the same logical
 * action.
 *
 * This is the consolidation home for the gateway safety behaviors:
 * reverting any P0 behavior on either substrate fails here, and a future
 * substrate joins the safety net by implementing `GatewaySubstrate` and adding
 * one line below.
 */

import {
  describeGatewayContract,
  describeCrossSubstrateAgreement,
} from "../__test-utils__/approval-contract/contract.js";
import { createDeepAgentSubstrate } from "../activities/execute-deep-agent/__test-utils__/gateway-substrate.js";
import { createClaudeSubstrate } from "../activities/execute-claude/__test-utils__/gateway-substrate.js";

const deepAgent = createDeepAgentSubstrate();
const claude = createClaudeSubstrate();

describeGatewayContract(deepAgent);
describeGatewayContract(claude);

describeCrossSubstrateAgreement([deepAgent, claude]);
