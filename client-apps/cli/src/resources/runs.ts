// Run routing seam.
//
// Runs are not addressed through the generic resource registry: runs
// (`run_`) are served by a dedicated controller, and `delete run` maps to a
// *cancel*, not a destroy. This module owns the run-type check, the
// cancel-with-result semantics, and the run reads shared by `get run`,
// `list runs`, `delete run` and `download`; the run-ID check is
// reference.ts's `isRunId`, over the kind's current and retired prefixes.

import { create } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  RunListSchema,
  CancelRunInputSchema,
  ListRunsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { OutputFormat } from "../output/index.js";
import { buildTypeInfo } from "../registry/index.js";
import { readCursorPages } from "./cursor-pages.js";
import type { ResourceResult } from "./get-bindings.js";
import { obj, renderListMessage, str, type TableShape } from "./render.js";

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
  readonly run: Run;
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
  const current = await client.run.get(id);
  const phase = current.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (TERMINAL_AGENT_PHASES.has(phase)) {
    return { run: current, wasAlreadyTerminal: true };
  }
  const cancelled = await client.run.cancel(create(CancelRunInputSchema, { id }));
  return { run: cancelled, wasAlreadyTerminal: false };
}

// The run kind's spellings, derived from its kind_meta row like every
// registered kind's (`run`, `runs`, any case).
const RUN_ALIASES: ReadonlySet<string> = new Set(
  (buildTypeInfo(ApiResourceKind.run)?.aliases ?? []).map((alias) => alias.toLowerCase()),
);

/**
 * True for the `run` type-alias family. Runs bypass the resource
 * registry (they're addressed by `run_` ID, not slug), so callers route
 * on this predicate before the registry lookup — mirroring Go's command layer.
 */
export function isRunAlias(type: string): boolean {
  return RUN_ALIASES.has(type.trim().toLowerCase());
}

/** Fetch a single run by ID, with its schema. */
export async function getRun(client: Stigmer, id: string): Promise<ResourceResult> {
  return { schema: RunSchema, message: await client.run.get(id) };
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
    client.run.list(create(ListRunsRequestSchema, { pageSize, pageToken, org })),
  );
  return { schema: RunListSchema, message: create(RunListSchema, { entries, totalPages: 1 }) };
}

const RUN_TABLE: TableShape = {
  resourceName: "runs",
  headers: ["ID", "AGENT", "STATUS", "STARTED"],
  row: (json) => [
    str(obj(json, "metadata"), "id"),
    dash(str(obj(json, "status"), "agent_id")),
    phaseLabel(str(obj(json, "status"), "phase")),
    dash(str(obj(json, "status"), "started_at")),
  ],
};

/** Render a run list (json/yaml = full envelope; table = grid). */
export function renderRunList(result: ResourceResult, format: OutputFormat): string {
  return renderListMessage(result.schema, result.message, format, RUN_TABLE);
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
