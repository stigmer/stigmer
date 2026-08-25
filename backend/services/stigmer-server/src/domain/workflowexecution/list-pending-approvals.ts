/**
 * ListPendingApprovals — ports list_pending_approvals.go (T14 dashboard):
 * scans IN_PROGRESS executions for tasks in WORKFLOW_TASK_WAITING_APPROVAL
 * and projects them into PendingApproval entries. total_count is the
 * pre-truncation total; only the entries list is trimmed to the page.
 */
import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";

import { ExecutionPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  PendingApprovalSchema,
  PendingApprovalsListSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type {
  ListPendingApprovalsRequest,
  PendingApproval,
  PendingApprovalsList,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";

import {
  DEFAULT_PENDING_APPROVALS_PAGE_SIZE,
  MAX_PENDING_APPROVALS_PAGE_SIZE,
} from "./constants.js";
import { parseRfc3339Ms } from "./execution-filter.js";
import { loadAllWorkflowExecutions } from "./queries.js";

export interface PendingApprovalsDeps {
  readonly store: Store;
  readonly logger: Logger;
}

export async function listPendingApprovals(
  deps: PendingApprovalsDeps,
  req: ListPendingApprovalsRequest,
): Promise<PendingApprovalsList> {
  const executions = await loadAllWorkflowExecutions(
    deps.store,
    deps.logger,
    "failed to list workflow executions for pending approvals",
  );

  let pageSize = req.pageSize;
  if (pageSize <= 0) {
    pageSize = DEFAULT_PENDING_APPROVALS_PAGE_SIZE;
  }
  if (pageSize > MAX_PENDING_APPROVALS_PAGE_SIZE) {
    pageSize = MAX_PENDING_APPROVALS_PAGE_SIZE;
  }

  let approvals: PendingApproval[] = [];
  for (const execution of executions) {
    const phase =
      execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    if (phase !== ExecutionPhase.EXECUTION_IN_PROGRESS) {
      continue;
    }

    for (const task of execution.status?.tasks ?? []) {
      if (task.status !== WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL) {
        continue;
      }
      approvals.push(
        create(PendingApprovalSchema, {
          executionId: execution.metadata?.id ?? "",
          workflowName: execution.metadata?.name ?? "",
          // task_name, not task_id: the composite task_id ("gate:2")
          // would break submitWorkflowTaskApproval, whose runner-side
          // signal is keyed by the plain task name.
          taskName: task.taskName,
          requester:
            execution.status?.audit?.specAudit?.createdBy?.id ?? "",
          requestedAt: parseTimestampString(task.startedAt),
          uiHint: task.uiHint,
        }),
      );
    }
  }

  const totalCount = approvals.length;
  if (approvals.length > pageSize) {
    approvals = approvals.slice(0, pageSize);
  }

  return create(PendingApprovalsListSchema, {
    entries: approvals,
    totalCount,
  });
}

/** Go parseTimestampString: RFC3339 or nothing (nil on parse failure). */
function parseTimestampString(value: string): Timestamp | undefined {
  const ms = parseRfc3339Ms(value);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return timestampFromMs(ms);
}
