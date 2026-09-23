/**
 * The workflowexecution read surfaces' shared reads (list,
 * listByWorkflow, getExecutionSummary, listPendingApprovals), all through
 * the list index (list-index.ts beside this file; the store's contract in
 * store/interface.ts) — the request's org or workflow key narrows in the
 * store, newest created first. Malformed rows are skipped rather than
 * failing the read, Go's proto.Unmarshal-continue loop.
 *
 * The two lists share one reader: the default order pages
 * (pipeline/steps/list-page.ts), with the lane's filters and then the read
 * scope on each batch; another sort field sorts the whole matching set and
 * returns its first page_size entries with no token, because only the
 * creation order is an index order.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionSortField,
  WorkflowExecutionListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { WorkflowExecutionList } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import {
  LIST_PAGE_MAX_SIZE,
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
import type { ListPageRequest } from "../../pipeline/steps/list-page.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexQuery, ListIndexRow } from "../../store/list-index.js";
import { applySortField } from "./execution-filter.js";
import { workflowExecutionListIndex } from "./list-index.js";

/** The keys the workflow-execution index declares. */
export type WorkflowExecutionListKey = "workflow" | "workflow_instance";

/** A stored row, or undefined (logged) when it does not decode. */
export function decodeWorkflowExecution(
  data: Uint8Array,
  logger: Logger,
): WorkflowExecution | undefined {
  try {
    return fromBinary(WorkflowExecutionSchema, data);
  } catch (error) {
    logger.warn("Failed to unmarshal workflow execution, skipping", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Every workflow execution the query matches, newest created first. The
 * Internal message varies by caller in Go (each handler wraps the same
 * store error with its own text), so the caller supplies it.
 */
export async function loadWorkflowExecutions(
  store: Store,
  logger: Logger,
  query: ListIndexQuery<WorkflowExecutionListKey>,
  internalMessage: string,
): Promise<WorkflowExecution[]> {
  let rows: ListIndexRow[];
  try {
    rows = await store.queryResources(workflowExecutionListIndex, query);
  } catch (error) {
    throw internalError(error, internalMessage);
  }
  const executions: WorkflowExecution[] = [];
  for (const row of rows) {
    const execution = decodeWorkflowExecution(row.data, logger);
    if (execution !== undefined) {
      executions.push(execution);
    }
  }
  return executions;
}

export interface WorkflowExecutionListRead {
  readonly store: Store;
  readonly logger: Logger;
  readonly listReadScope: ListReadScope | undefined;
  readonly identity: CallerIdentity;
  readonly query: ListIndexQuery<WorkflowExecutionListKey>;
  readonly request: ListPageRequest;
  readonly sortField: ExecutionSortField;
  readonly sortAscending: boolean;
  /** The lane's filters beyond the indexed predicates. */
  readonly keep: (execution: WorkflowExecution) => boolean;
  /** The request's other fields, which its token is bound to. */
  readonly fingerprint: Readonly<Record<string, unknown>>;
}

/** One list response: a page in the default order, or the whole set sorted by another field. */
export async function readWorkflowExecutionList(
  read: WorkflowExecutionListRead,
): Promise<WorkflowExecutionList> {
  const scope = (
    executions: WorkflowExecution[],
  ): Promise<WorkflowExecution[]> =>
    restrictListByReadScope(
      read.listReadScope,
      read.identity,
      ApiResourceKind.workflow_execution,
      executions,
      "",
    );

  if (read.sortField === ExecutionSortField.UNSPECIFIED) {
    const page = await readListPage({
      store: read.store,
      declaration: workflowExecutionListIndex,
      query: read.query,
      request: read.request,
      fingerprint: listPageFingerprint(read.fingerprint),
      decode: (data) => decodeWorkflowExecution(data, read.logger),
      keep: read.keep,
      scope,
      failure: "failed to list workflow executions",
    });
    return create(WorkflowExecutionListSchema, {
      entries: page.entries,
      nextPageToken: page.nextPageToken,
      totalPages: page.nextPageToken === "" ? 1 : 0,
    });
  }

  // Another sort field never issues a token, so none can be continued.
  if (read.request.pageToken !== "") {
    throw invalidArgumentError("invalid page_token");
  }
  if (read.request.pageSize < 0) {
    throw invalidArgumentError("page_size must not be negative");
  }
  const executions = await scope(
    (
      await loadWorkflowExecutions(
        read.store,
        read.logger,
        read.query,
        "failed to list workflow executions",
      )
    ).filter(read.keep),
  );
  applySortField(executions, read.sortField, read.sortAscending);
  const size = Math.min(read.request.pageSize, LIST_PAGE_MAX_SIZE);
  return create(WorkflowExecutionListSchema, {
    entries: size === 0 ? executions : executions.slice(0, size),
    totalPages: 1,
  });
}
