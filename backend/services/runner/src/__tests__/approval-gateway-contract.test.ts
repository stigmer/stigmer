/**
 * The runnable HITL gateway P0 safety contract.
 *
 * Runs the single, authoritative invariant catalog (see
 * `__test-utils__/approval-contract/contract.ts`) against every real
 * enforcement substrate — the in-process deep-agent gate (a real LangGraph
 * graph), the out-of-process Cursor deny-oracle (the real bash hook) and the
 * Claude gate (the production gate and its engine callbacks) — and then
 * asserts the substrates AGREE on the same logical action.
 *
 * This is the consolidation home for the gateway safety behaviors:
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
import { createClaudeSubstrate } from "../activities/execute-claude/__test-utils__/gateway-substrate.js";

const deepAgent = createDeepAgentSubstrate();
const cursor = createCursorSubstrate();
const claude = createClaudeSubstrate();

/** The open issue the Claude substrate's platform-read mark names. */
const CLAUDE_PLATFORM_READ = "stigmer/stigmer#2593";

describeGatewayContract(deepAgent);
describeGatewayContract(cursor);
describeGatewayContract(claude, { knownGaps: { "platform-read-under-lists": CLAUDE_PLATFORM_READ } });

describeCrossSubstrateAgreement([deepAgent, cursor, claude], { claude: { "platform-read-under-lists": CLAUDE_PLATFORM_READ } });
