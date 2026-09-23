/**
 * ListPendingApprovals — ports list_pending_approvals.go (T14 dashboard):
 * reads the org's IN_PROGRESS executions for tasks in
 * WORKFLOW_TASK_WAITING_APPROVAL and projects them into PendingApproval
 * entries, newest execution first. total_count is the whole set's; the
 * entries are one page (default 20, at most 100), continued by a token
 * whose position is an execution's list-index cursor plus the approval's
 * place among its waiting tasks — stable while approvals land and resolve
 * between pages, where an offset would skip or repeat them.
 */
import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  PendingApprovalSchema,
  PendingApprovalsListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type {
  ListPendingApprovalsRequest,
  PendingApproval,
  PendingApprovalsList,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import {
  decodeListPageToken,
  encodeListPageToken,
  listPageFingerprint,
} from "../../pipeline/steps/list-page.js";
import type { ListPageTokenCursor } from "../../pipeline/steps/list-page.js";
import type { Store } from "../../store/interface.js";
import {
  compareListIndexOrder,
  listIndexInstant,
} from "../../store/list-index.js";

import {
  DEFAULT_PENDING_APPROVALS_PAGE_SIZE,
  MAX_PENDING_APPROVALS_PAGE_SIZE,
} from "./constants.js";
import { parseRfc3339Ms } from "./execution-filter.js";
import { loadWorkflowExecutions } from "./queries.js";

export interface PendingApprovalsDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed list read scope — undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
}

export async function listPendingApprovals(
  deps: PendingApprovalsDeps,
  req: ListPendingApprovalsRequest,
  identity: CallerIdentity,
): Promise<PendingApprovalsList> {
  // Census lane 8: the org's executions that CAN carry a
  // pending approval (in progress, a task waiting) through the list index,
  // then the scope — the last per-row predicate, so a composed driver is
  // asked about a handful of rows — before the approvals projection and
  // its pagination, the Java WorkflowExecutionListPendingApprovalsHandler
  // order.
  if (req.pageSize < 0) {
    throw invalidArgumentError("page_size must not be negative");
  }
  const fingerprint = listPageFingerprint({
    lane: "workflowExecution.listPendingApprovals",
    org: req.org,
  });
  const after =
    req.pageToken === ""
      ? undefined
      : decodeListPageToken(req.pageToken, fingerprint);

  const executions = await restrictListByReadScope(
    deps.listReadScope,
    identity,
    ApiResourceKind.workflow_execution,
    (
      await loadWorkflowExecutions(
        deps.store,
        deps.logger,
        { org: req.org },
        "failed to list workflow executions for pending approvals",
      )
    ).filter(mayHavePendingApproval),
    "",
  );

  let pageSize = req.pageSize;
  if (pageSize === 0) {
    pageSize = DEFAULT_PENDING_APPROVALS_PAGE_SIZE;
  }
  if (pageSize > MAX_PENDING_APPROVALS_PAGE_SIZE) {
    pageSize = MAX_PENDING_APPROVALS_PAGE_SIZE;
  }

  // Newest execution first (the index's order), an execution's waiting
  // tasks in their order; each approval's position is its execution's
  // cursor and its place among that execution's waiting tasks.
  const approvals: Array<{
    readonly approval: PendingApproval;
    readonly at: ListPageTokenCursor & { readonly position: number };
  }> = [];
  for (const execution of executions) {
    const cursor = {
      createdAt: listIndexInstant(
        execution.status?.audit?.specAudit?.createdAt,
      ),
      id: execution.metadata?.id ?? "",
    };
    let position = 0;
    for (const task of execution.status?.tasks ?? []) {
      if (task.status !== WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL) {
        continue;
      }
      approvals.push({
        approval: create(PendingApprovalSchema, {
          executionId: execution.metadata?.id ?? "",
          workflowName: execution.metadata?.name ?? "",
          // task_name, not task_id: the composite task_id ("gate:2")
          // would break submitWorkflowTaskApproval, whose runner-side
          // signal is keyed by the plain task name.
          taskName: task.taskName,
          requester: execution.status?.audit?.specAudit?.createdBy?.id ?? "",
          requestedAt: parseTimestampString(task.startedAt),
          uiHint: task.uiHint,
        }),
        at: { cursor, position },
      });
      position += 1;
    }
  }

  const start =
    after === undefined
      ? 0
      : approvals.findIndex((a) => comesAfter(a.at, after));
  const remaining = start < 0 ? [] : approvals.slice(start);
  const page = remaining.slice(0, pageSize);
  const last = page[page.length - 1];

  return create(PendingApprovalsListSchema, {
    entries: page.map((a) => a.approval),
    totalCount: approvals.length,
    nextPageToken:
      remaining.length > pageSize && last !== undefined
        ? encodeListPageToken(last.at.cursor, fingerprint, last.at.position)
        : "",
  });
}

/** Whether an approval comes strictly after a token's position. */
function comesAfter(
  at: ListPageTokenCursor & { readonly position: number },
  after: ListPageTokenCursor,
): boolean {
  const order = compareListIndexOrder(at.cursor, after.cursor);
  return order > 0 || (order === 0 && at.position > (after.position ?? -1));
}

/** Go parseTimestampString: RFC3339 or nothing (nil on parse failure). */
function parseTimestampString(value: string): Timestamp | undefined {
  const ms = parseRfc3339Ms(value);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return timestampFromMs(ms);
}

/**
 * The per-row predicate of the projection above: only an execution in
 * progress with a task waiting for approval contributes an entry, so only
 * those are worth a scope check. Same rows kept as the loop's own `continue`
 * arms, decided once before the scope.
 */
function mayHavePendingApproval(execution: WorkflowExecution): boolean {
  const phase =
    execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  return (
    phase === ExecutionPhase.EXECUTION_IN_PROGRESS &&
    (execution.status?.tasks ?? []).some(
      (task) =>
        task.status === WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
    )
  );
}
