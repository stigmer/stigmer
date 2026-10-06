/**
 * AgentRun domain steps — the list-side chains from list.go and
 * list_by_session.go, plus the full-scan load helper the usage reports
 * share.
 *
 * Both lists read through the list index (list-index.ts beside this file;
 * the store's contract in store/interface.ts), newest first by spec-audit
 * created_at. `list` pages (pipeline/steps/list-page.ts): the store
 * narrows by the request's org, the phase filter and then the read scope
 * run on each batch — the scope last, so a composed driver is asked about
 * the rows the request keeps. `listBySession` returns the session's
 * executions whole: a conversation is read as one, and its consumers (the
 * transcript, the channel and guest turn limits) need all of it.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { AgentRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import {
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
import type { ListPage } from "../../pipeline/steps/list-page.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexRow } from "../../store/list-index.js";
import { agentExecutionListIndex } from "./list-index.js";

/**
 * Inter-step key for the working page AND the final AgentRunList —
 * Go reuses one key ("execution_list") for both, and the controller reads
 * the final response from it.
 */
export const EXECUTION_LIST_KEY = "execution_list";

type ListDesc = typeof AgentRunQueryController.method.list.input;
type ListBySessionDesc =
  typeof AgentRunQueryController.method.listBySession.input;

/**
 * Full-scan agent-execution load for the usage reports, whose org match
 * is case-insensitive (Go strings.EqualFold) where the list index's is
 * exact; malformed rows warn + skip (Go's proto.Unmarshal-continue).
 */
export async function loadAllAgentExecutions(
  store: Store,
  logger: Logger,
): Promise<AgentRun[]> {
  let rows: Uint8Array[];
  try {
    rows = await store.listResources(ApiResourceKind.agent_run);
  } catch (error) {
    throw internalError(error, "failed to list agent executions");
  }
  return decodeExecutions(rows, logger);
}

/** ValidateListRequest — list.go: no required fields today (a no-op). */
export function newValidateListRequestStep(): PipelineStep<ListDesc> {
  return {
    name: "ValidateListRequest",
    execute() {
      // Go validates nothing here yet; page_size is protovalidate's and
      // page_token the page reader's.
    },
  };
}

/**
 * QueryExecutionPage — one page of the request's executions: its org
 * through the index when it names one, its phase when it names one, the
 * read scope last (with no scope composed, every matching
 * execution — the OSS single-user posture).
 */
export function newQueryExecutionPageStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
): PipelineStep<ListDesc> {
  return {
    name: "QueryExecutionPage",
    async execute(ctx) {
      const input = ctx.input;
      const page = await readListPage({
        store,
        declaration: agentExecutionListIndex,
        query: { org: input.org },
        request: input,
        fingerprint: listPageFingerprint({
          lane: "agentExecution.list",
          org: input.org,
          phase: input.phase,
          tags: input.tags,
        }),
        decode: (data) => decodeExecution(data, logger),
        keep: (execution) =>
          input.phase === RunPhase.RUN_PHASE_UNSPECIFIED ||
          (execution.status?.phase ??
            RunPhase.RUN_PHASE_UNSPECIFIED) === input.phase,
        scope: (executions) =>
          restrictListByReadScope(
            listReadScope,
            ctx.callerIdentity,
            ApiResourceKind.agent_run,
            executions,
            "",
          ),
        failure: "failed to list agent executions",
      });
      ctx.set(EXECUTION_LIST_KEY, page);
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
 * QueryExecutionsBySession — list_by_session.go: the session's executions
 * through the index's session key, whole and newest first, then the read
 * scope (bounded by the session id, org never consulted).
 */
export function newQueryExecutionsBySessionStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
): PipelineStep<ListBySessionDesc> {
  return {
    name: "QueryExecutionsBySession",
    async execute(ctx) {
      let rows: ListIndexRow[];
      try {
        rows = await store.queryResources(agentExecutionListIndex, {
          anyKey: [{ name: "session", value: ctx.input.sessionId }],
        });
      } catch (error) {
        throw internalError(error, "failed to list agent executions");
      }
      const executions = await restrictListByReadScope(
        listReadScope,
        ctx.callerIdentity,
        ApiResourceKind.agent_run,
        decodeExecutions(
          rows.map((row) => row.data),
          logger,
        ),
        "",
      );
      logger.debug("Successfully queried executions by session", {
        sessionId: ctx.input.sessionId,
        count: executions.length,
      });
      const page: ListPage<AgentRun> = {
        entries: executions,
        nextPageToken: "",
      };
      ctx.set(EXECUTION_LIST_KEY, page);
    },
  };
}

/**
 * BuildExecutionListResponse — both list files: wraps the page into
 * AgentRunList; total_pages is 1 when the response is whole and 0
 * when a token follows (the contract's "not computed").
 */
export function newBuildExecutionListResponseStep<
  Desc extends ListDesc | ListBySessionDesc,
>(): PipelineStep<Desc> {
  return {
    name: "BuildExecutionListResponse",
    execute(ctx) {
      const page = requirePage(ctx.get(EXECUTION_LIST_KEY));
      ctx.set(
        EXECUTION_LIST_KEY,
        create(AgentRunListSchema, {
          totalPages: page.nextPageToken === "" ? 1 : 0,
          entries: page.entries,
          nextPageToken: page.nextPageToken,
        }),
      );
    },
  };
}

function decodeExecution(
  data: Uint8Array,
  logger: Logger,
): AgentRun | undefined {
  try {
    return fromBinary(AgentRunSchema, data);
  } catch (error) {
    logger.warn("Failed to unmarshal execution, skipping", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function decodeExecutions(
  rows: ReadonlyArray<Uint8Array>,
  logger: Logger,
): AgentRun[] {
  const executions: AgentRun[] = [];
  for (const data of rows) {
    const execution = decodeExecution(data, logger);
    if (execution !== undefined) {
      executions.push(execution);
    }
  }
  return executions;
}

function requirePage(value: unknown): ListPage<AgentRun> {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { entries?: unknown }).entries)
  ) {
    throw internalError(
      new Error("execution list not found in context"),
      "execution list not found in context",
    );
  }
  return value as ListPage<AgentRun>;
}
