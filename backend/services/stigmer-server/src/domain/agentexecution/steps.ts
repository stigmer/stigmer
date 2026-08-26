/**
 * AgentExecution domain steps — the list-side chains from list.go and
 * list_by_session.go, plus the full-scan load helper the usage reports
 * share.
 *
 * List semantics ported verbatim: no sorting (unlike the session domain's
 * newest-first list), no pagination (total_pages pinned to 1 — Go's
 * placeholder), the request `org` field a deliberate no-op (single-tenant
 * edition), and phase filtering only when a phase is specified.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";

/**
 * Inter-step key for the working execution list AND the final
 * AgentExecutionList — Go reuses one key ("execution_list") for both, and
 * the controller reads the final response from it.
 */
export const EXECUTION_LIST_KEY = "execution_list";

type ListDesc = typeof AgentExecutionQueryController.method.list.input;
type ListBySessionDesc =
  typeof AgentExecutionQueryController.method.listBySession.input;

/**
 * Full-scan agent-execution load shared by the list steps and the usage
 * reports; malformed rows warn + skip (Go's proto.Unmarshal-continue).
 */
export async function loadAllAgentExecutions(
  store: Store,
  logger: Logger,
): Promise<AgentExecution[]> {
  let rows: Uint8Array[];
  try {
    rows = await store.listResources(ApiResourceKind.agent_execution);
  } catch (error) {
    throw internalError(error, "failed to list agent executions");
  }

  const executions: AgentExecution[] = [];
  for (const data of rows) {
    let execution: AgentExecution;
    try {
      execution = fromBinary(AgentExecutionSchema, data);
    } catch (error) {
      logger.warn("Failed to unmarshal execution, skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    executions.push(execution);
  }
  return executions;
}

/** ValidateListRequest — list.go: no required fields today (a no-op). */
export function newValidateListRequestStep(): PipelineStep<ListDesc> {
  return {
    name: "ValidateListRequest",
    execute() {
      // Go validates nothing here yet; pagination validation would land
      // in both editions together.
    },
  };
}

/** QueryAllExecutions — list.go: full scan into the context. */
export function newQueryAllExecutionsStep(
  store: Store,
  logger: Logger,
): PipelineStep<ListDesc> {
  return {
    name: "QueryAllExecutions",
    async execute(ctx) {
      const executions = await loadAllAgentExecutions(store, logger);
      logger.debug("Successfully queried executions", {
        count: executions.length,
      });
      ctx.set(EXECUTION_LIST_KEY, executions);
    },
  };
}

/**
 * ApplyPhaseFilter — list.go: status.phase equality filter, skipped when
 * the request carries no phase.
 */
export function newApplyPhaseFilterStep(
  logger: Logger,
): PipelineStep<ListDesc> {
  return {
    name: "ApplyPhaseFilter",
    execute(ctx) {
      const executions = requireExecutions(ctx.get(EXECUTION_LIST_KEY));
      if (ctx.input.phase === ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) {
        logger.debug("No phase filter specified, skipping");
        return;
      }
      const filtered = executions.filter(
        (execution) =>
          (execution.status?.phase ??
            ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) === ctx.input.phase,
      );
      logger.debug("Phase filter applied", {
        originalCount: executions.length,
        filteredCount: filtered.length,
      });
      ctx.set(EXECUTION_LIST_KEY, filtered);
    },
  };
}

/**
 * ValidateListBySessionRequest — list_by_session.go: session_id required.
 */
export function newValidateListBySessionRequestStep(): PipelineStep<ListBySessionDesc> {
  return {
    name: "ValidateListBySessionRequest",
    execute(ctx) {
      if (ctx.input.sessionId === "") {
        throw invalidArgumentError("session_id is required");
      }
    },
  };
}

/**
 * QueryExecutionsBySession — list_by_session.go: full scan +
 * spec.session_id equality filter.
 */
export function newQueryExecutionsBySessionStep(
  store: Store,
  logger: Logger,
): PipelineStep<ListBySessionDesc> {
  return {
    name: "QueryExecutionsBySession",
    async execute(ctx) {
      const all = await loadAllAgentExecutions(store, logger);
      const executions = all.filter(
        (execution) =>
          (execution.spec?.sessionId ?? "") === ctx.input.sessionId,
      );
      logger.debug("Successfully queried executions by session", {
        sessionId: ctx.input.sessionId,
        count: executions.length,
      });
      ctx.set(EXECUTION_LIST_KEY, executions);
    },
  };
}

/**
 * BuildExecutionListResponse — both list files: wraps the working list
 * into AgentExecutionList with the total_pages placeholder pinned to 1.
 */
export function newBuildExecutionListResponseStep<
  Desc extends ListDesc | ListBySessionDesc,
>(): PipelineStep<Desc> {
  return {
    name: "BuildExecutionListResponse",
    execute(ctx) {
      const executions = requireExecutions(ctx.get(EXECUTION_LIST_KEY));
      ctx.set(
        EXECUTION_LIST_KEY,
        create(AgentExecutionListSchema, {
          totalPages: 1,
          entries: executions,
        }),
      );
    },
  };
}

function requireExecutions(value: unknown): AgentExecution[] {
  if (!Array.isArray(value)) {
    throw internalError(
      new Error("execution list not found in context"),
      "execution list not found in context",
    );
  }
  return value as AgentExecution[];
}
