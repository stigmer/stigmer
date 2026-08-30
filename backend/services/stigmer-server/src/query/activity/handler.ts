/**
 * Recent-activity handler — ports pkg/query/activity/handler/handler.go:
 * sessions and workflow executions merged into one time-sorted list for
 * the console's Recents sidebar.
 *
 * This is the OSS twin of the cloud's ListRecentActivityHandler; the
 * merge, ordering, projection, and filtering semantics are deliberately
 * identical (stigmer#461). What differs is only what single-tenancy
 * removes: with NO ListReadScope composed there is no id enumeration
 * (the candidate set is every stored row) and the request's org is a
 * no-op (a recents filter stricter than the per-kind lists it summarizes
 * would hide locally-owned rows); load-all-then-sort-in-memory replaces
 * per-kind SQL LIMIT windows (each kind's newest page_size rows are a
 * superset of its contribution to the merged page — the identical final
 * list; the full scan is this store's contract, the same pattern every
 * OSS list handler uses). With a composed ListReadScope (20260830.01,
 * census lane 22) both loads narrow to the caller's authorized ids ∩
 * the request's org when non-blank — the Java handler's two
 * listAuthorizedResourceIds calls and its findRecentByIdsAndOrg org arm.
 *
 * Proven by __tests__/handler.test.ts (Go's handler_test.go arms) and
 * activity.conformance.test.ts on local.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import {
  ListRecentActivityResponseSchema,
  RecentActivityEntrySchema,
} from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import type {
  ListRecentActivityRequest,
  ListRecentActivityResponse,
  RecentActivityEntry,
} from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceAudit } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import type { Store } from "../../store/interface.js";

/**
 * defaultPageSize / maxPageSize mirror the cloud handler's
 * DEFAULT_PAGE_SIZE / MAX_PAGE_SIZE — the page contract is part of the
 * cross-edition behavior, not an implementation detail.
 */
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

/**
 * The platform-wide sentinel subject stamped on sessions created without
 * a user-provided title (the SDK's PENDING_SUBJECT, the CLI's resume
 * flow, the runner's call-agent, and this server's agent-execution create
 * all use the same literal). The sidebar shows the friendlier placeholder
 * until subject generation replaces the sentinel.
 */
export const AUTO_CREATED_SESSION_SUBJECT = "Auto-created session";

export const UNTITLED_SESSION_SUBJECT = "Untitled session";
export const UNTITLED_EXECUTION_SUBJECT = "Untitled execution";

/**
 * Marks a session as runtime-originated. Recents shows personal sessions
 * only (cloud design decision 012): channel conversations, guest/share
 * sessions, and schedule-triggered sessions are excluded for every caller
 * — each runtime surface owns its own list. Keys match the cloud's
 * RUNTIME_ORIGIN_LABELS exactly; share/guest are cloud-only today but
 * excluded identically so a future OSS share surface cannot silently
 * regress the recents policy.
 */
export const RUNTIME_ORIGIN_LABELS: readonly string[] = [
  "stigmer.ai/channel-id",
  "stigmer.ai/share-id",
  "stigmer.ai/guest-cookie-id",
  "stigmer.ai/schedule-id",
];

/** Answers ActivityQueryController.listRecentActivity against the store. */
export class ActivityHandler {
  constructor(
    private readonly store: Store,
    private readonly logger: Logger,
    private readonly listReadScope: ListReadScope | undefined,
  ) {}

  /**
   * Go ListRecentActivity: load both kinds, project to sidebar entries,
   * merge-sort newest-first, trim to the page. With a composed scope the
   * per-kind loads narrow to the caller's authorized ids ∩ the request's
   * org (blank = permission-bounded across orgs, the repo convention).
   */
  async listRecentActivity(
    request: ListRecentActivityRequest,
    identity: CallerIdentity,
  ): Promise<ListRecentActivityResponse> {
    const pageSize = normalizePageSize(request.pageSize);

    let sessionScope: ReadonlySet<string> | undefined;
    let executionScope: ReadonlySet<string> | undefined;
    if (this.listReadScope !== undefined) {
      sessionScope = await this.listReadScope.authorizedResourceIds(
        identity,
        ApiResourceKind.session,
      );
      executionScope = await this.listReadScope.authorizedResourceIds(
        identity,
        ApiResourceKind.workflow_execution,
      );
    }

    const sessions = await this.loadSessions(sessionScope, request.org);
    const executions = await this.loadExecutions(executionScope, request.org);

    // Sessions before executions, then a stable sort: entries with equal
    // timestamps keep this insertion order — the same tie-break the
    // cloud gets from java.util.List.sort's stability over the same load
    // order (JS Array.prototype.sort is stable, matching Go's
    // sort.SliceStable).
    let entries = [...sessions, ...executions].sort((a, b) => {
      if (timestampAfter(a.updatedAt, b.updatedAt)) {
        return -1;
      }
      if (timestampAfter(b.updatedAt, a.updatedAt)) {
        return 1;
      }
      return 0;
    });

    if (entries.length > pageSize) {
      entries = entries.slice(0, pageSize);
    }

    this.logger.debug("Recent activity merged", {
      entries: entries.length,
      page_size: pageSize,
    });

    return create(ListRecentActivityResponseSchema, { entries });
  }

  /**
   * Go loadSessions: every stored personal session projected to a recents
   * entry; runtime-originated sessions excluded.
   */
  private async loadSessions(
    authorizedIds: ReadonlySet<string> | undefined,
    org: string,
  ): Promise<RecentActivityEntry[]> {
    const rows = await this.store.listResources(ApiResourceKind.session);
    const entries: RecentActivityEntry[] = [];
    for (const row of rows) {
      let session;
      try {
        session = fromBinary(SessionSchema, row);
      } catch {
        this.logger.warn("Skipping undecodable session row in recent activity");
        continue;
      }
      if (hasRuntimeOriginLabel(session.metadata)) {
        continue;
      }
      if (
        authorizedIds !== undefined &&
        !isVisibleUnderScope(authorizedIds, org, session.metadata)
      ) {
        continue;
      }
      entries.push(
        create(RecentActivityEntrySchema, {
          id: session.metadata?.id ?? "",
          type: "session",
          subject: resolveSubject(session.spec?.subject ?? ""),
          updatedAt: extractUpdatedAt(session.status?.audit),
        }),
      );
    }
    return entries;
  }

  /** Go loadExecutions: every stored workflow execution projected. */
  private async loadExecutions(
    authorizedIds: ReadonlySet<string> | undefined,
    org: string,
  ): Promise<RecentActivityEntry[]> {
    const rows = await this.store.listResources(
      ApiResourceKind.workflow_execution,
    );
    const entries: RecentActivityEntry[] = [];
    for (const row of rows) {
      let execution;
      try {
        execution = fromBinary(WorkflowExecutionSchema, row);
      } catch {
        this.logger.warn(
          "Skipping undecodable workflow execution row in recent activity",
        );
        continue;
      }
      if (
        authorizedIds !== undefined &&
        !isVisibleUnderScope(authorizedIds, org, execution.metadata)
      ) {
        continue;
      }
      const name = execution.metadata?.name ?? "";
      entries.push(
        create(RecentActivityEntrySchema, {
          id: execution.metadata?.id ?? "",
          type: "workflow_execution",
          subject: name === "" ? UNTITLED_EXECUTION_SUBJECT : name,
          updatedAt: extractUpdatedAt(execution.status?.audit),
          status: resolvePhase(
            execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
          ),
        }),
      );
    }
    return entries;
  }
}

/**
 * The scoped-visibility test both loads share when a scope is composed:
 * the row's id must be authorized and, when the request names an org, the
 * row must belong to it (the Java findRecentByIdsAndOrg arm).
 */
function isVisibleUnderScope(
  authorizedIds: ReadonlySet<string>,
  org: string,
  metadata: ApiResourceMetadata | undefined,
): boolean {
  if (!authorizedIds.has(metadata?.id ?? "")) {
    return false;
  }
  return org === "" || (metadata?.org ?? "") === org;
}

/** Go normalizePageSize: ≤0 → default 30; >100 → cap 100. */
export function normalizePageSize(requested: number): number {
  if (requested <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  if (requested > MAX_PAGE_SIZE) {
    return MAX_PAGE_SIZE;
  }
  return requested;
}

function hasRuntimeOriginLabel(
  metadata: ApiResourceMetadata | undefined,
): boolean {
  const labels = metadata?.labels;
  if (labels === undefined) {
    return false;
  }
  // Object.hasOwn, not `in`: own keys only, matching Go's map lookup
  // (the #17 least-privilege-filter precedent).
  return RUNTIME_ORIGIN_LABELS.some((key) => Object.hasOwn(labels, key));
}

/**
 * Go resolveSubject: missing subjects AND the auto-created sentinel map
 * to the display placeholder — a just-created session shows "Untitled
 * session" until subject generation writes a real title.
 */
export function resolveSubject(subject: string): string {
  if (subject === "" || subject === AUTO_CREATED_SESSION_SUBJECT) {
    return UNTITLED_SESSION_SUBJECT;
  }
  return subject;
}

/**
 * Go resolvePhase: the lifecycle phase → the display token the console's
 * status badge renders. Unspecified (and any future value this build
 * does not know) reads as "unknown" — no badge.
 */
export function resolvePhase(phase: ExecutionPhase): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_PENDING:
      return "pending";
    case ExecutionPhase.EXECUTION_IN_PROGRESS:
      return "running";
    case ExecutionPhase.EXECUTION_COMPLETED:
      return "completed";
    case ExecutionPhase.EXECUTION_FAILED:
      return "failed";
    case ExecutionPhase.EXECUTION_CANCELLED:
      return "cancelled";
    case ExecutionPhase.EXECUTION_TERMINATED:
      return "terminated";
    case ExecutionPhase.EXECUTION_PAUSED:
      return "paused";
    default:
      return "unknown";
  }
}

/**
 * Go extractUpdatedAt — the entry's sort key: statusAudit.updatedAt
 * (bumped on meaningful status changes; heartbeats deliberately do NOT
 * bump it) falling back to specAudit.createdAt for rows whose status
 * audit was never stamped (older builds or external tooling; OSS creates
 * always stamp both slots).
 */
export function extractUpdatedAt(
  audit: ApiResourceAudit | undefined,
): Timestamp {
  const updatedAt = audit?.statusAudit?.updatedAt;
  if (updatedAt !== undefined) {
    return updatedAt;
  }
  const createdAt = audit?.specAudit?.createdAt;
  if (createdAt !== undefined) {
    return createdAt;
  }
  return create(TimestampSchema);
}

/**
 * Go timestampAfter: a sorts strictly after b (newer first), comparing
 * (seconds, nanos) exactly like the cloud's comparator.
 */
export function timestampAfter(
  a: Timestamp | undefined,
  b: Timestamp | undefined,
): boolean {
  const aSeconds = a?.seconds ?? 0n;
  const bSeconds = b?.seconds ?? 0n;
  if (aSeconds !== bSeconds) {
    return aSeconds > bSeconds;
  }
  return (a?.nanos ?? 0) > (b?.nanos ?? 0);
}
