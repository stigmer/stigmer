/**
 * Native built-in tools for the deep-agent harness.
 *
 * These are Stigmer-authored capabilities appended to the agent's tool list
 * in execute-deep-agent/setup.ts (and mirrored for sub-agents in
 * subagent-transformer.ts) — distinct from deepagents' backend tools
 * (ls/read_file/execute/…) and from MCP tools, which arrive via the
 * connection layer.
 *
 * Contract for adding a native tool (what keeps the two harnesses at parity):
 *
 * 1. Name it in snake_case (`web_fetch`, not `WebFetch` — PascalCase names
 *    belong to the Cursor harness).
 * 2. Register the name in shared/tool-kind.ts `TOOL_NAME_TO_KIND` and its
 *    lockstep mirrors (test/fixtures/tool-view/classification.json, the SDK
 *    fallback resolver), and extend the ToolKind enum comment in
 *    agentexecution/v1/enum.proto with a `Native:` clause.
 * 3. Name the primary argument to match the SDK's presentation `primaryField`
 *    for the tool's kind (sdk/react tool-categories.ts) so both harnesses
 *    render identically.
 * 4. Decide the approval posture explicitly: unless the tool's kind maps to
 *    an approval category in `toolApprovalCategory`, it is auto-approved.
 */

export { createThinkTool } from "./think-tool.js";
export { createWebFetchTool } from "./web-fetch-tool.js";
export { validateFetchUrl, resolveGuardPosture, UrlGuardError } from "./url-guard.js";
export type { GuardPosture } from "./url-guard.js";
