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
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { activityStarted, activityFinished } from "../idle-watchdog.js";
import { getSummarizationModel } from "../shared/model-registry.js";
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

1. READ-ONLY operations → requires_approval: false
   Examples: search, list, get, query, read, fetch, describe, count
   These only retrieve data and have no side effects.

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
      allApprovals.push(...batchResult);
    } catch (err) {
      console.error(
        `[ClassifyToolApprovals] Batch ${batchIdx + 1}/${batches.length} failed ` +
        `for '${serverName}' (${batch.length} tools) — falling back to requires_approval=true`,
        err,
      );
      allApprovals.push(...fallbackApprovals(batch));
    }
  }

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

  const headers: Record<string, string> = {};
  if (stigmerToken) {
    headers["Authorization"] = `Bearer ${stigmerToken}`;
  }
  if (mcpServerId) {
    headers["X-Stigmer-Mcp-Server-Id"] = mcpServerId;
  }

  const llm = new ChatOpenAI({
    model,
    temperature: 0,
    maxTokens,
    configuration: {
      baseURL: proxyEndpoint,
      defaultHeaders: headers,
    },
  });

  const structuredLlm = llm.withStructuredOutput(ClassifyToolApprovalsOutputSchema);

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

export function fallbackApprovals(tools: ToolDescriptor[]): ToolApprovalResult[] {
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
