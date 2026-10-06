// Run routing seam.
//
// Runs are not addressed through the generic resource registry: agent runs
// (`aex_`) and workflow runs (`wex_`) are served by dedicated controllers, and
// `delete run` maps to a *cancel*, not a destroy. This module owns the
// ID-prefix detection and the cancel-with-result semantics so that the
// prefix-sniffing logic lives in exactly one place.
//
// The agent-run path serves `delete run`, and the module's full
// agent-vs-workflow routing is shared by `usage`, `list runs`, and
// `download`.

import { create } from "@bufbuild/protobuf";
import { AgentRunSchema, type AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import {
  AgentRunListSchema,
  CancelAgentRunInputSchema,
  ListAgentRunsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase as WorkflowRunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import {
  ListWorkflowRunsRequestSchema,
  WorkflowRunListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import type { OutputFormat } from "../output/index.js";
import { readCursorPages } from "./cursor-pages.js";
import type { ResourceResult } from "./get-bindings.js";
import { obj, renderListMessage, str, type TableShape } from "./render.js";

const AGENT_RUN_PREFIX = "aex";
const WORKFLOW_RUN_PREFIX = "wex";

/** True if `ref` is an agent-run ID (`aex_…` or `aex-…`, case-sensitive). */
export function isAgentRunId(ref: string): boolean {
  return hasKindPrefix(ref, AGENT_RUN_PREFIX);
}

/** True if `ref` is a workflow-run ID (`wex_…` or `wex-…`, case-sensitive). */
export function isWorkflowRunId(ref: string): boolean {
  return hasKindPrefix(ref, WORKFLOW_RUN_PREFIX);
}

// Mirrors Go's reference.isResourceIDWithKind: a kind ID prefix followed by
// either separator the backend accepts ("_" canonical, "-" legacy). Matching is
// case-sensitive — "AEX_" is not a run ID.
function hasKindPrefix(ref: string, prefix: string): boolean {
  const trimmed = ref.trim();
  return trimmed.startsWith(`${prefix}_`) || trimmed.startsWith(`${prefix}-`);
}

// Terminal phases cannot be cancelled; mirrors Go's isTerminalAgentPhase.
const TERMINAL_AGENT_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/** True when an agent phase is terminal (no further transitions). Mirrors Go's isTerminalAgentPhase. */
export function isTerminalAgentPhase(phase: RunPhase): boolean {
  return TERMINAL_AGENT_PHASES.has(phase);
}

export interface CancelRunResult {
  readonly run: AgentRun;
  /** True when the run was already terminal, so no cancel was issued. */
  readonly wasAlreadyTerminal: boolean;
}

/**
 * Cancel an agent run, surfacing whether it was already in a terminal
 * state. Mirrors Go's execution.CancelWithResult: Get first to read the phase,
 * short-circuit if terminal, otherwise issue the cancel. Keeping the Get means
 * the success/already-terminal distinction is decided client-side from
 * authoritative state rather than from the cancel RPC's response alone.
 */
export async function cancelAgentRun(client: Stigmer, id: string): Promise<CancelRunResult> {
  const current = await client.agentRun.get(id);
  const phase = current.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (TERMINAL_AGENT_PHASES.has(phase)) {
    return { run: current, wasAlreadyTerminal: true };
  }
  const cancelled = await client.agentRun.cancel(create(CancelAgentRunInputSchema, { id }));
  return { run: cancelled, wasAlreadyTerminal: false };
}

/**
 * True for the `run` type-alias family. Runs bypass the resource
 * registry (they're addressed by `aex_`/`wex_` ID, not slug), so callers route
 * on this predicate before the registry lookup — mirroring Go's command layer.
 */
export function isRunAlias(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "run" || normalized === "runs";
}

/** Agent (`aex_`) vs workflow (`wex_`) run — the two controller families. */
export type RunType = "agent" | "workflow";

/**
 * Resolve a run ID to its type by prefix. Mirrors Go's
 * execution.ResolveType, including the multi-line guidance on an unrecognized
 * format. Surfaced as a usage error (bad user input).
 */
export function resolveRunType(id: string): RunType {
  if (isAgentRunId(id)) return "agent";
  if (isWorkflowRunId(id)) return "workflow";
  throw new UsageError(
    `unrecognized run ID format: ${id}\n\n` +
      "Expected formats:\n" +
      "  Agent run:    aex_<26-char-ulid>\n" +
      "  Workflow run: wex_<26-char-ulid>",
  );
}

/** Fetch a single run (agent or workflow) by ID, with its schema. */
export async function getRun(client: Stigmer, id: string): Promise<ResourceResult> {
  if (resolveRunType(id) === "agent") {
    return { schema: AgentRunSchema, message: await client.agentRun.get(id) };
  }
  return { schema: WorkflowRunSchema, message: await client.workflowRun.get(id) };
}

/**
 * List the newest `limit` agent runs for the current context, reading
 * as many pages as that takes.
 *
 * `org` scopes results to that organization; empty means permission-bounded
 * (all orgs the caller can view — the OSS single-tenant behavior).
 */
export async function listAgentRuns(client: Stigmer, limit: number, org = ""): Promise<ResourceResult> {
  const entries = await readCursorPages(limit, (pageSize, pageToken) =>
    client.agentRun.list(create(ListAgentRunsRequestSchema, { pageSize, pageToken, org })),
  );
  return { schema: AgentRunListSchema, message: create(AgentRunListSchema, { entries, totalPages: 1 }) };
}

/**
 * List the newest `limit` workflow runs for the current context,
 * reading as many pages as that takes.
 *
 * `org` scopes results to that organization; empty means permission-bounded
 * (all orgs the caller can view — the OSS single-tenant behavior).
 */
export async function listWorkflowRuns(client: Stigmer, limit: number, org = ""): Promise<ResourceResult> {
  const entries = await readCursorPages(limit, (pageSize, pageToken) =>
    client.workflowRun.list(create(ListWorkflowRunsRequestSchema, { pageSize, pageToken, org })),
  );
  return {
    schema: WorkflowRunListSchema,
    message: create(WorkflowRunListSchema, { entries, totalPages: 1 }),
  };
}

const AGENT_RUN_TABLE: TableShape = {
  resourceName: "runs",
  headers: ["ID", "AGENT", "STATUS", "STARTED"],
  row: (json) => [
    str(obj(json, "metadata"), "id"),
    dash(str(obj(json, "status"), "agent_id")),
    phaseLabel(str(obj(json, "status"), "phase")),
    dash(str(obj(json, "status"), "started_at")),
  ],
};

const WORKFLOW_RUN_TABLE: TableShape = {
  resourceName: "runs",
  headers: ["ID", "WORKFLOW", "STATUS", "STARTED"],
  row: (json) => [
    str(obj(json, "metadata"), "id"),
    dash(str(obj(json, "spec"), "workflow_id")),
    phaseLabel(str(obj(json, "status"), "phase")),
    dash(str(obj(json, "status"), "started_at")),
  ],
};

/** Render a run list (json/yaml = full envelope; table = grid). */
export function renderRunList(result: ResourceResult, format: OutputFormat, type: RunType): string {
  const table = type === "agent" ? AGENT_RUN_TABLE : WORKFLOW_RUN_TABLE;
  return renderListMessage(result.schema, result.message, format, table);
}

// Friendly phase label from a protojson enum string (table view only — json/yaml
// keep the canonical protojson value). "RUN_IN_PROGRESS" → "in-progress".
function phaseLabel(phase: string): string {
  if (phase === "") return "-";
  return phase.replace(/^RUN_/, "").toLowerCase().replace(/_/g, "-");
}

function dash(value: string): string {
  return value === "" ? "-" : value;
}

/** Human-readable agent-run phase, matching Go's execution.FormatPhase. */
export function formatAgentPhase(phase: RunPhase): string {
  switch (phase) {
    case RunPhase.RUN_PENDING:
      return "pending";
    case RunPhase.RUN_IN_PROGRESS:
      return "running";
    case RunPhase.RUN_WAITING_FOR_APPROVAL:
      return "awaiting-approval";
    case RunPhase.RUN_PAUSED:
      return "paused";
    case RunPhase.RUN_COMPLETED:
      return "completed";
    case RunPhase.RUN_FAILED:
      return "failed";
    case RunPhase.RUN_CANCELLED:
      return "cancelled";
    case RunPhase.RUN_TERMINATED:
      return "terminated";
    default:
      return "unknown";
  }
}

/**
 * Human-readable workflow-run phase, matching Go's
 * execution.FormatWorkflowPhase. Workflow phases live in a *different* proto
 * package than agent phases (the enum values differ — workflow TERMINATED is 6,
 * agent TERMINATED is 8), so this is a deliberately separate mapping rather than
 * a shared one. Workflows have no WAITING_FOR_APPROVAL phase (approval is a task
 * status, not a run phase).
 */
export function formatWorkflowPhase(phase: WorkflowRunPhase): string {
  switch (phase) {
    case WorkflowRunPhase.RUN_PENDING:
      return "pending";
    case WorkflowRunPhase.RUN_IN_PROGRESS:
      return "running";
    case WorkflowRunPhase.RUN_COMPLETED:
      return "completed";
    case WorkflowRunPhase.RUN_FAILED:
      return "failed";
    case WorkflowRunPhase.RUN_CANCELLED:
      return "cancelled";
    case WorkflowRunPhase.RUN_TERMINATED:
      return "terminated";
    case WorkflowRunPhase.RUN_PAUSED:
      return "paused";
    default:
      return "unknown";
  }
}
