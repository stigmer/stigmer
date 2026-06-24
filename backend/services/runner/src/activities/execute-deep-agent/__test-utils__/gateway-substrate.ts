/**
 * Deep-agent adapter for the HITL gateway Contract Test Kit.
 *
 * Drives the REAL in-process gateway: a `createDeepAgent` graph carrying the
 * production {@link createApprovalGateMiddleware}, a `MemorySaver` checkpointer,
 * and a scripted model that proposes the action under test. `authorize` runs the
 * graph to its first pause and, for an approving/non-approving decision, resumes
 * via `Command(resume=…)` — exactly the production pause/resume cycle proven in
 * `__tests__/subagent-approval-propagation.test.ts`. There is no mocked
 * `interrupt()`: the gate's own `interrupt()` fires, so the contract exercises the
 * gateway end-to-end.
 *
 * Capabilities: this substrate IS the side effect, so it observes (and counts)
 * execution; resource-exact leasing is not a property of this gate (sameness comes
 * from checkpoint replay), so `enforcesExactResource` is false and
 * `authorizeAfterGrant` is intentionally not implemented.
 */

import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";

import { createApprovalGateMiddleware } from "../../../middleware/approval-gate.js";
import { deriveLeaseScope } from "../../../shared/approval-policy.js";
import type { ToolApprovalCategory } from "../../../shared/tool-kind.js";
import { ScriptedModel, readPendingInterrupts } from "./scripted-model.js";
import type {
  GatewayDecision,
  GatewayOutcome,
  GatewaySubstrate,
  ProposedAction,
} from "../../../__test-utils__/approval-contract/types.js";

/**
 * Translate an abstract action into a deep-agent tool name + args + MCP server.
 * The names are deliberately ALIASES, not deepagents built-ins, so we can attach
 * a counting handler without shadowing an injected built-in, while still hitting
 * the right approval category via the shared classifier:
 *  - write  → `overwrite_file` (FILE_WRITE), delete → `remove_file` (FILE_DELETE),
 *    shell → `execute_command` (SHELL): each gated fail-closed by category.
 *  - read   → an unknown, non-mutating name: auto-approved (fail-open), no gate.
 *  - mcp    → the MCP tool name mapped to its server: governed by policy, absent
 *    policy ⇒ auto-approved.
 */
function toDeepAgentTool(action: ProposedAction): {
  name: string;
  args: Record<string, unknown>;
  serverSlug: string;
} {
  switch (action.kind) {
    case "write":
      return { name: "overwrite_file", args: { path: action.resource, content: "x" }, serverSlug: "" };
    case "shell":
      return { name: "execute_command", args: { command: action.resource }, serverSlug: "" };
    case "delete":
      return { name: "remove_file", args: { path: action.resource }, serverSlug: "" };
    case "read":
      return { name: "inspect_resource", args: { path: action.resource }, serverSlug: "" };
    case "mcp":
      return { name: action.mcpToolName ?? "mcp_tool", args: {}, serverSlug: action.mcpServerSlug ?? "srv" };
  }
}

/** Map a contract decision to the gate's resume verdict (anything unrecognized = unknown). */
function toResumeAction(decision: GatewayDecision): string {
  switch (decision) {
    case "approve":
      return "approve";
    case "skip":
      return "skip";
    case "reject":
      return "reject";
    default:
      return "unrecognized-verdict";
  }
}

let threadSeq = 0;

/**
 * Drive one probe action through a freshly built gate and report the outcome.
 * `leasedCategories` pre-arms a run-lifetime class lease (empty for the plain
 * authorize path); `decision` resumes a pause for the non-lease drives.
 */
async function runProbe(
  action: ProposedAction,
  decision: GatewayDecision,
  leasedCategories: ReadonlySet<ToolApprovalCategory>,
): Promise<GatewayOutcome> {
  const { name, args, serverSlug } = toDeepAgentTool(action);

  let executionCount = 0;
  const countingTool = tool(
    async () => {
      executionCount += 1;
      return "ok";
    },
    {
      name,
      description: `contract probe tool ${name}`,
      schema: z.object({}).passthrough(),
    },
  );

  const toolServerMap = serverSlug ? new Map([[name, serverSlug]]) : new Map<string, string>();
  const gate = createApprovalGateMiddleware({
    policies: new Map(),
    toolServerMap,
    leasedCategories,
  });

  const agent = await createDeepAgent({
    model: new ScriptedModel(() => ({
      toolCalls: [{ name, args, id: "call_1" }],
      done: "done",
    })),
    checkpointer: new MemorySaver() as never,
    backend: new StateBackend(),
    tools: [countingTool],
    middleware: [gate],
  } as unknown as Parameters<typeof createDeepAgent>[0]);

  const config = { configurable: { thread_id: `contract-${threadSeq++}` }, recursionLimit: 50 };

  // Run to the first pause. A gated tool interrupts before its handler runs.
  await agent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);
  const pending = readPendingInterrupts((await agent.getState(config)) as never);
  const gated = pending.length > 0;

  // `none` is the "no decision yet" probe: leave the action withheld.
  if (gated && decision !== "none") {
    const resume: Record<string, { action: string }> = {};
    for (const p of pending) resume[p.interruptId] = { action: toResumeAction(decision) };
    await agent.invoke(new Command({ resume }), config);
  }

  return { executed: executionCount > 0, gated, executionCount };
}

const NO_LEASED_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();

export function createDeepAgentSubstrate(): GatewaySubstrate {
  return {
    name: "deep-agent",
    available: true,
    capabilities: {
      observesExecution: true,
      enforcesExactResource: false,
      appliesRunLifetimeLease: true,
    },

    async authorize(action: ProposedAction, decision: GatewayDecision): Promise<GatewayOutcome> {
      return runProbe(action, decision, NO_LEASED_CATEGORIES);
    },

    async authorizeUnderClassLease(
      leased: ProposedAction,
      probe: ProposedAction,
    ): Promise<GatewayOutcome> {
      // Reduce the leased action to its class exactly as the runner does, then
      // arm the gate with that category lease and run the probe with no fresh
      // decision — so only the lease can clear it.
      const leasedTool = toDeepAgentTool(leased);
      const scope = deriveLeaseScope(leasedTool.name, leasedTool.serverSlug);
      const leasedCategories =
        scope?.kind === "category" ? new Set([scope.category]) : NO_LEASED_CATEGORIES;
      return runProbe(probe, "none", leasedCategories);
    },
  };
}
