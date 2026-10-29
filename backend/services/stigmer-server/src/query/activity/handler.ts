/**
 * Recent-activity handler: the caller's personal sessions as one
 * time-sorted list for the console's Recents sidebar.
 *
 * Every edition serves recents through this handler, so the ordering,
 * projection, and filtering semantics are one contract (stigmer#461). The load reads the request's org through the
 * list index (every org when blank) — the same narrowing the session
 * list it summarizes applies, so recents is never stricter than it is —
 * and, with a composed ListReadScope, offers those rows to its restrict
 * verb: one read, exact, rather than enumerating the caller's authorized
 * ids and then scanning. Recents orders by the last update,
 * not by creation, so the org's sessions are read whole and sorted in
 * memory.
 *
 * Proven by __tests__/handler.test.ts and
 * activity.conformance.test.ts on local.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import {
  ListRecentActivityResponseSchema,
  RecentActivityEntrySchema,
} from "@stigmer/apis/ai/stigmer/activity/v1/io_pb";
import type {
  ListRecentActivityRequest,
  ListRecentActivityResponse,
  RecentActivityEntry,
} from "@stigmer/apis/ai/stigmer/activity/v1/io_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceAudit } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";
import type { ApiResourceMetadata } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import { EVAL_RUN_LABEL } from "../../domain/eval-run/constants.js";
import { sessionListIndex } from "../../domain/session/list-index.js";
import type { Store } from "../../store/interface.js";

/**
 * The default and maximum page sizes — the page contract is part of the
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

/**
 * Marks a session as runtime-originated. Recents shows personal sessions
 * only: every channel's conversations (a chat link's guests and a Slack or
 * WhatsApp channel's alike carry the channel id), guest sessions,
 * schedule-triggered sessions and an eval run's tries and votes are
 * excluded for every caller — each runtime surface owns its own list (an
 * eval's tries are read through the eval). Guests are cloud-only today but
 * excluded identically so a future OSS guest surface cannot silently
 * regress the recents policy.
 */
export const RUNTIME_ORIGIN_LABELS: readonly string[] = [
  "stigmer.ai/channel-id",
  "stigmer.ai/guest-cookie-id",
  "stigmer.ai/routine-id",
  EVAL_RUN_LABEL,
];

/** Answers ActivityQueryController.listRecentActivity against the store. */
export class ActivityHandler {
  constructor(
    private readonly store: Store,
    private readonly logger: Logger,
    private readonly listReadScope: ListReadScope | undefined,
  ) {}

  /**
   * Loads the sessions (the request's org, every org
   * when blank; the scope's restrict verb when one is composed), project
   * to sidebar entries, sort newest-first, trim to the page.
   */
  async listRecentActivity(
    request: ListRecentActivityRequest,
    identity: CallerIdentity,
  ): Promise<ListRecentActivityResponse> {
    const pageSize = normalizePageSize(request.pageSize);

    const sessions = await this.loadSessions(identity, request.org);

    // A stable sort: entries with equal timestamps keep the load order
    // (JS Array.prototype.sort is stable).
    let entries = [...sessions].sort((a, b) => {
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

    this.logger.debug("Recent activity listed", {
      entries: entries.length,
      page_size: pageSize,
    });

    return create(ListRecentActivityResponseSchema, { entries });
  }

  /**
   * The org's personal sessions the caller may see,
   * projected to recents entries; runtime-originated sessions excluded.
   */
  private async loadSessions(
    identity: CallerIdentity,
    org: string,
  ): Promise<RecentActivityEntry[]> {
    const rows = await this.store.queryResources(sessionListIndex, { org });
    const personal: Session[] = [];
    for (const row of rows) {
      let session: Session;
      try {
        session = fromBinary(SessionSchema, row.data);
      } catch {
        this.logger.warn("Skipping undecodable session row in recent activity");
        continue;
      }
      if (!hasRuntimeOriginLabel(session.metadata)) {
        personal.push(session);
      }
    }
    const visible = await restrictListByReadScope(
      this.listReadScope,
      identity,
      ApiResourceKind.session,
      personal,
      "",
    );
    const entries: RecentActivityEntry[] = [];
    for (const session of visible) {
      entries.push(
        create(RecentActivityEntrySchema, {
          id: session.metadata?.id ?? "",
          subject: resolveSubject(session.spec?.subject ?? ""),
          updatedAt: extractUpdatedAt(session.status?.audit),
        }),
      );
    }
    return entries;
  }
}

/** ≤0 → default 30; >100 → cap 100. */
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
  // Object.hasOwn, not `in`: own keys only (the least-privilege filter's
  // precedent).
  return RUNTIME_ORIGIN_LABELS.some((key) => Object.hasOwn(labels, key));
}

/**
 * Missing subjects AND the auto-created sentinel map
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
 * The entry's sort key: statusAudit.updatedAt (bumped on meaningful
 * status changes; heartbeats deliberately do NOT bump it) falling back to
 * specAudit.createdAt for a row whose status audit is unstamped (one
 * written outside the create chain, which always stamps both slots).
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
 * a sorts strictly after b (newer first), comparing (seconds, nanos).
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
