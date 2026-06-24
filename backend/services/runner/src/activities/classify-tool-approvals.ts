/**
 * ClassifyToolApprovals Temporal activity — uses a lightweight LLM call to
 * classify each tool reported by an MCP server as safe (auto-approve) or
 * sensitive (requires human approval before execution).
 *
 * Part of the `stigmer/mcp-server/connect` workflow: runs after capability
 * discovery, before results are stored. The classifier output feeds
 * `McpServerStatus.tool_approvals` — the lowest-priority layer in the
 * approval policy chain.
 *
 * For large tool sets (>40), tools are classified in batches to stay
 * within LLM output token limits. Failed batches fall back to
 * `requires_approval: true` (safe default).
 *
 * Activity contract:
 *   Name:   "ClassifyToolApprovals"
 *   Input:  ClassifyToolApprovalsInput
 *   Output: ToolApprovalResult[] (only tools requiring approval)
 */

import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { activityStarted, activityFinished } from "../idle-watchdog.js";
import { getSummarizationModel } from "../shared/model-registry.js";
import { buildChatModel } from "../shared/model-client.js";
import type { Config } from "../config.js";

const BATCH_SIZE = 40;
const MAX_TOKENS_PER_TOOL = 60;
const MIN_MAX_TOKENS = 4096;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassifyToolApprovalsInput {
  tools: ToolDescriptor[];
  serverName: string;
  serverDescription: string;
  mcpServerId?: string | null;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  input_schema?: Record<string, unknown> | null;
}

export interface ToolApprovalResult {
  tool_name: string;
  requires_approval: boolean;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod Schema (structured output)
// ─────────────────────────────────────────────────────────────────────────────

const ToolApprovalClassificationSchema = z.object({
  tool_name: z.string().describe("Exact tool name as reported by the MCP server"),
  requires_approval: z.boolean().describe(
    "True if this tool performs mutations or has side effects",
  ),
  message: z.string().describe(
    "Human-readable approval prompt shown to the user. " +
    "Use {{args.field}} placeholders for dynamic values. " +
    "Empty when requires_approval is false.",
  ),
});

const ClassifyToolApprovalsOutputSchema = z.object({
  approvals: z.array(ToolApprovalClassificationSchema).describe(
    "One classification per tool, same order as input",
  ),
});

type ClassifyToolApprovalsOutput = z.infer<typeof ClassifyToolApprovalsOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a tool safety classifier for AI agent platforms.

Given a list of tools from an MCP server, classify each tool as either \
safe (auto-approve) or sensitive (requires human approval before execution).

Classification rules:

1. READ-ONLY / OBSERVATION operations → requires_approval: false
   Examples: search, list, get, query, read, fetch, describe, count, view,
   inspect, status, screenshot, snapshot, and "get state" style tools.
   These only retrieve or observe data and have no side effects. When a tool
   name begins with one of these verbs (e.g. get_app_state, list_apps), prefer
   requires_approval: false unless its description clearly says it mutates.

2. CREATE or MODIFY operations → requires_approval: true
   Examples: create, update, put, set, add, edit, modify, write, post, send
   These change state or create new resources.

3. DELETE or DESTRUCTIVE operations → requires_approval: true
   Examples: delete, remove, drop, purge, destroy, revoke, terminate
   These permanently remove or disable resources.

4. EXECUTE or INVOKE operations → requires_approval: true
   Examples: execute, run, invoke, call, trigger, deploy, apply
   These perform actions with external side effects.

For tools that require approval, write a concise message (under 80 chars) \
that describes the action using {{args.field}} placeholders to reference \
the tool's input parameters.  Choose the most relevant parameter names \
from the tool's input_schema.

Message guidelines:
- Start with an action verb: "Delete", "Create", "Send", "Execute"
- Include the most important identifier: {{args.repo}}, {{args.path}}, etc.
- Keep it specific: "Delete repository {{args.repo}}" not "Delete something"
- If unsure which field to use, use the tool name: "Execute tool_name"

For tools that do NOT require approval, leave message empty.

Output one classification per tool, maintaining the input order.`;

// ─────────────────────────────────────────────────────────────────────────────
// Read-only authority
// ─────────────────────────────────────────────────────────────────────────────
//
// Read-only auto-approval is owned SOLELY by the trusted LLM classifier above.
// There is deliberately no deterministic name-based relax here: a tool name is
// an untrusted, server-supplied signal, and relaxing a gate on it is the unsafe
// direction (e.g. `get_and_delete_stale_records` leads with `get` yet deletes).
// A prior name-prefix heuristic was removed for exactly this reason. Annotations
// are likewise never trusted to relax — the connect workflow uses `destructiveHint`
// only to TIGHTEN (see applyDestructiveHintTightener). Anything the classifier
// does not affirmatively clear stays gated (fail closed).

// ─────────────────────────────────────────────────────────────────────────────
// Core Classification Logic (no Temporal coupling)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassifyToolsOptions {
  proxyEndpoint: string;
  stigmerToken: string | null;
  primaryModel: string;
}

export async function classifyTools(
  input: ClassifyToolApprovalsInput,
  options: ClassifyToolsOptions,
): Promise<ToolApprovalResult[]> {
  const { tools, serverName, serverDescription, mcpServerId } = input;

  if (tools.length === 0) {
    return [];
  }

  const model = await getSummarizationModel(options.primaryModel);

  const batches: ToolDescriptor[][] = [];
  for (let i = 0; i < tools.length; i += BATCH_SIZE) {
    batches.push(tools.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `[ClassifyToolApprovals] Classifying ${tools.length} tools for '${serverName}' ` +
    `using model '${model}' (${batches.length} batch(es) of up to ${BATCH_SIZE})`,
  );

  const allApprovals: ToolApprovalResult[] = [];

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    try {
      const batchResult = await classifyBatch({
        batch,
        serverName,
        serverDescription,
        model,
        proxyEndpoint: options.proxyEndpoint,
        stigmerToken: options.stigmerToken,
        mcpServerId: mcpServerId ?? null,
        batchIdx,
        totalBatches: batches.length,
      });
      // Reconcile against the input batch: a tool the model omitted must fail
      // closed, never slip through un-gated. Partial output is as dangerous as
      // an outage for the missing tools.
      const { reconciled, failedClosedCount } = reconcileBatchClassifications(batch, batchResult);
      if (failedClosedCount > 0) {
        console.warn(
          `[ClassifyToolApprovals] Batch ${batchIdx + 1}/${batches.length} for '${serverName}': ` +
          `${failedClosedCount} tool(s) missing from classifier output — failing closed (requires_approval=true)`,
        );
      }
      allApprovals.push(...reconciled);
    } catch (err) {
      console.error(
        `[ClassifyToolApprovals] Batch ${batchIdx + 1}/${batches.length} failed ` +
        `for '${serverName}' (${batch.length} tools) — falling back to requires_approval=true`,
        err,
      );
      allApprovals.push(...fallbackApprovals(batch));
    }
  }

  // The LLM classifier is the sole read-only authority: only tools it
  // affirmatively cleared (requires_approval=false) are auto-approved. Tools it
  // gated, omitted (reconciled to fail-closed), or that fell back on an outage
  // all remain gated. No name-based relax runs here by design.
  const approved = allApprovals.filter((a) => a.requires_approval);

  console.log(
    `[ClassifyToolApprovals] Classification complete for '${serverName}': ` +
    `${approved.length}/${allApprovals.length} tools require approval`,
  );

  return approved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Classification
// ─────────────────────────────────────────────────────────────────────────────

interface ClassifyBatchParams {
  batch: ToolDescriptor[];
  serverName: string;
  serverDescription: string;
  model: string;
  proxyEndpoint: string;
  stigmerToken: string | null;
  mcpServerId: string | null;
  batchIdx: number;
  totalBatches: number;
}

async function classifyBatch(params: ClassifyBatchParams): Promise<ToolApprovalResult[]> {
  const {
    batch, serverName, serverDescription, model,
    proxyEndpoint, stigmerToken, mcpServerId,
    batchIdx, totalBatches,
  } = params;

  const maxTokens = Math.max(MIN_MAX_TOKENS, batch.length * MAX_TOKENS_PER_TOOL);

  // Provider is inferred from the resolved economy model — for an Anthropic
  // primary this routes to Claude, not the hardcoded OpenAI path it used to.
  const { model: llm } = await buildChatModel({
    modelName: model,
    proxyEndpoint,
    stigmerToken: stigmerToken ?? undefined,
    headerScope: { mcpServerId: mcpServerId ?? undefined },
    maxTokens,
  });

  // Explicit type param: BaseChatModel.withStructuredOutput widens to
  // Record<string, any>, unlike the concrete SDK overloads, so pin the schema's
  // output type here.
  const structuredLlm = llm.withStructuredOutput<ClassifyToolApprovalsOutput>(
    ClassifyToolApprovalsOutputSchema,
  );

  const toolsPayload = buildToolsPayload(batch);
  const userPrompt =
    `MCP Server: ${serverName}\n` +
    `Description: ${serverDescription || "No description provided"}\n\n` +
    `Tools to classify (${batch.length}):\n\n` +
    toolsPayload;

  console.log(
    `[ClassifyToolApprovals] Classifying batch ${batchIdx + 1}/${totalBatches} ` +
    `(${batch.length} tools, max_tokens=${maxTokens}) for '${serverName}'`,
  );

  const result: ClassifyToolApprovalsOutput = await structuredLlm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  console.log(
    `[ClassifyToolApprovals] Batch ${batchIdx + 1}/${totalBatches} complete ` +
    `for '${serverName}': ${result.approvals.length} classification(s) returned`,
  );

  return result.approvals.map((a) => ({
    tool_name: a.tool_name,
    requires_approval: a.requires_approval,
    message: a.message,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconcile a batch's LLM classifications against the tools that were actually
 * sent. The canonical result is built from the INPUT batch, never the raw model
 * output, so the classifier can never silently disarm a gate by omission:
 *
 * - A tool the model classified is kept as-is (its requires_approval + message).
 * - A tool the model OMITTED fails closed (requires_approval=true) — a missing
 *   decision is treated exactly like an outage for that one tool.
 * - A name the model returned that was never in the batch (a hallucinated or
 *   duplicated entry) is dropped — only real tools earn a policy.
 */
export function reconcileBatchClassifications(
  batch: ToolDescriptor[],
  llmResults: ToolApprovalResult[],
): { reconciled: ToolApprovalResult[]; failedClosedCount: number } {
  const byName = new Map<string, ToolApprovalResult>();
  for (const r of llmResults) {
    if (r.tool_name) byName.set(r.tool_name, r);
  }

  const reconciled: ToolApprovalResult[] = [];
  let failedClosedCount = 0;
  for (const tool of batch) {
    const classified = byName.get(tool.name);
    if (classified) {
      reconciled.push(classified);
      continue;
    }
    reconciled.push({
      tool_name: tool.name,
      requires_approval: true,
      message: `Execute ${tool.name}`,
    });
    failedClosedCount++;
  }

  return { reconciled, failedClosedCount };
}

export function fallbackApprovals(tools: ToolDescriptor[]): ToolApprovalResult[] {
  // Full fail-closed: when the classifier batch throws, every tool in it is
  // gated. With no trusted classification we cannot safely auto-approve anything
  // — a name is an untrusted signal — so the entire batch requires approval
  // until a reconnect re-classifies it. The accepted tradeoff is that, during a
  // rare classifier outage, benign read tools briefly prompt for approval.
  return tools.map((tool) => ({
    tool_name: tool.name,
    requires_approval: true,
    message: `Execute ${tool.name}`,
  }));
}

export function buildToolsPayload(tools: ToolDescriptor[]): string {
  const formatted = tools.map((tool) => {
    const entry: Record<string, unknown> = {
      name: tool.name,
      description: tool.description,
    };
    const schema = tool.input_schema;
    if (schema && typeof schema === "object") {
      const props = (schema as Record<string, unknown>).properties;
      if (props && typeof props === "object") {
        entry.parameters = Object.keys(props as Record<string, unknown>);
      }
    }
    return entry;
  });

  return JSON.stringify(formatted, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporal Activity Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createClassifyToolApprovalsActivities(config: Config) {
  return {
    ClassifyToolApprovals: async (
      input: ClassifyToolApprovalsInput,
    ): Promise<ToolApprovalResult[]> => {
      activityStarted();
      try {
        console.log(
          `[ClassifyToolApprovals] Activity started: ${input.tools.length} tools for '${input.serverName}'`,
        );

        return await classifyTools(input, {
          proxyEndpoint: config.proxyEndpoint ?? config.stigmerBackendEndpoint,
          stigmerToken: config.stigmerToken,
          primaryModel: config.primaryModel,
        });
      } finally {
        activityFinished();
      }
    },
  };
}
