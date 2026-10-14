/**
 * Run domain steps — the list-side chains from list.go and
 * list_by_session.go.
 *
 * Both lists read through the list index (list-index.ts beside this file;
 * the store's contract in store/interface.ts), newest first by spec-audit
 * created_at, one page at a time (pipeline/steps/list-page.ts). `list`:
 * the store narrows by the request's org, the phase filter and then the
 * read scope run on each batch — the scope last, so a composed driver is
 * asked about the rows the request keeps. `listBySession`: the store
 * narrows by the session's key, then the read scope; a reader that needs a
 * conversation whole walks its tokens.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunListSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
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
import { agentExecutionListIndex } from "./list-index.js";
import { matchesAllLabels, sortedLabels } from "../../pipeline/steps/helpers.js";

/**
 * Inter-step key for the working page AND the final RunList —
 * Go reuses one key ("execution_list") for both, and the controller reads
 * the final response from it.
 */
export const EXECUTION_LIST_KEY = "execution_list";

type ListDesc = typeof RunQueryController.method.list.input;
type ListBySessionDesc =
  typeof RunQueryController.method.listBySession.input;

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
 * through the index when it names one, its phase and labels when it names
 * them (each row's keep), the read scope last (with no scope composed, every matching
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
          labels: sortedLabels(input.labels),
        }),
        decode: (data) => decodeExecution(data, logger),
        keep: (execution) =>
          (input.phase === RunPhase.RUN_PHASE_UNSPECIFIED ||
            (execution.status?.phase ??
              RunPhase.RUN_PHASE_UNSPECIFIED) === input.phase) &&
          matchesAllLabels(execution.metadata?.labels ?? {}, input.labels),
        scope: (executions) =>
          restrictListByReadScope(
            listReadScope,
            ctx.callerIdentity,
            ApiResourceKind.run,
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
 * QueryExecutionsBySession — one page of the session's executions through
 * the index's session key, newest first, then the read scope (bounded by
 * the session id, org never consulted).
 */
export function newQueryExecutionsBySessionStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
): PipelineStep<ListBySessionDesc> {
  return {
    name: "QueryExecutionsBySession",
    async execute(ctx) {
      const sessionId = ctx.input.sessionId;
      const page = await readListPage({
        store,
        declaration: agentExecutionListIndex,
        query: { anyKey: [{ name: "session", value: sessionId }] },
        request: ctx.input,
        fingerprint: listPageFingerprint({
          lane: "agentExecution.listBySession",
          sessionId,
          labels: sortedLabels(ctx.input.labels),
        }),
        decode: (data) => decodeExecution(data, logger),
        keep: (execution) =>
          matchesAllLabels(execution.metadata?.labels ?? {}, ctx.input.labels),
        scope: (executions) =>
          restrictListByReadScope(
            listReadScope,
            ctx.callerIdentity,
            ApiResourceKind.run,
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
 * BuildExecutionListResponse — both list files: wraps the page into
 * RunList.
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
        create(RunListSchema, {
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
): Run | undefined {
  try {
    return fromBinary(RunSchema, data);
  } catch (error) {
    logger.warn("Failed to unmarshal execution, skipping", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function requirePage(value: unknown): ListPage<Run> {
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
  return value as ListPage<Run>;
}
