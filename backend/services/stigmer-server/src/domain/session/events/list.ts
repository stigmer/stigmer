/**
 * SessionQueryController.listEvents: one page of a session's event log, by
 * seq, oldest first unless desc is asked for.
 *
 * Paging follows the session lists' rule (pipeline/steps/list-page.ts): the
 * token is opaque, carries the last seq returned, and is bound to the
 * request's other fields, so a continuing request must repeat them. One
 * divergence: page_size zero means the default of 100, never "all", because
 * a log grows without bound; at most 1000.
 *
 * The created_at bounds are Managed Agents' range filter and apply to the
 * time the server accepted each event. Any RFC 3339 instant is accepted
 * and compared at millisecond precision in the store's fixed-width form.
 *
 * Authorization: the chain's Authorize step, can_view on the session the
 * request names (field_path session_id).
 *
 * Proven by __tests__/list.test.ts and the session-events conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";

import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import {
  SessionEventListSchema,
  type ListSessionEventsRequest,
  type SessionEventList,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { internalError, invalidArgumentError } from "../../../pipeline/errors.js";
import { callerIdentityOf } from "../../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../../pipeline/steps/authorize.js";
import {
  decodeListPageToken,
  encodeListPageToken,
  listPageFingerprint,
} from "../../../pipeline/steps/list-page.js";
import { newValidateProtoStep } from "../../../pipeline/steps/validation.js";
import type { Store } from "../../../store/interface.js";
import type { SessionEventQuery, SessionEventRecord } from "../../../store/session-events.js";
import { eventOf } from "./codec.js";

/** A page's size when the request asks for none. */
export const SESSION_EVENT_PAGE_DEFAULT_SIZE = 100;

export interface ListSessionEventsDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
}

export async function listSessionEvents(
  deps: ListSessionEventsDeps,
  req: ListSessionEventsRequest,
  ctx: HandlerContext,
): Promise<SessionEventList> {
  const reqCtx = new RequestContext(
    SessionQueryController.method.listEvents.input,
    req,
    callerIdentityOf(ctx),
    ApiResourceKind.session,
  );
  let result = create(SessionEventListSchema);
  await newPipeline<typeof SessionQueryController.method.listEvents.input>(
    "session-list-events",
    deps.logger,
  )
    .addStep(newAuthorizeStep(SessionQueryController.method.listEvents, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep({
      name: "ListSessionEvents",
      async execute(stepCtx) {
        result = await readSessionEventPage(deps.store, stepCtx.input);
      },
    })
    .build()
    .execute(reqCtx);
  return result;
}

/** One page of a request, read from the store (the chain's last step, after authorization). */
export async function readSessionEventPage(
  store: Store,
  req: ListSessionEventsRequest,
): Promise<SessionEventList> {
  const order = req.order === "desc" ? "desc" : "asc";
  const size = req.pageSize === 0 ? SESSION_EVENT_PAGE_DEFAULT_SIZE : req.pageSize;
  const fingerprint = listPageFingerprint({
    session: req.sessionId,
    order,
    size,
    types: req.types,
    gt: req.createdAtGt,
    gte: req.createdAtGte,
    lt: req.createdAtLt,
    lte: req.createdAtLte,
  });
  const query: SessionEventQuery = {
    order,
    limit: size + 1,
    ...(req.pageToken === "" ? {} : { afterSeq: seqOfToken(req.pageToken, fingerprint) }),
    ...(req.types.length === 0 ? {} : { types: req.types }),
    ...bound("processedAtGt", "created_at_gt", req.createdAtGt),
    ...bound("processedAtGte", "created_at_gte", req.createdAtGte),
    ...bound("processedAtLt", "created_at_lt", req.createdAtLt),
    ...bound("processedAtLte", "created_at_lte", req.createdAtLte),
  };

  let records: SessionEventRecord[];
  try {
    records = await store.sessionEvents.list(req.sessionId, query);
  } catch (error) {
    throw internalError(error, "failed to list session events");
  }
  // One event past the page is read only to learn whether more follow, so
  // a log that ends exactly on a page carries no token.
  const page = records.slice(0, size);
  const last = page[page.length - 1];
  return create(SessionEventListSchema, {
    events: page.map(eventOf),
    nextPageToken:
      records.length > size && last !== undefined
        ? encodeListPageToken({ createdAt: "", id: String(last.seq) }, fingerprint)
        : "",
  });
}

function seqOfToken(token: string, fingerprint: string): number {
  const seq = Number(decodeListPageToken(token, fingerprint).cursor.id);
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw invalidArgumentError("invalid page_token");
  }
  return seq;
}

/** A created_at bound as the store's fixed-width instant; absent when the request sets none. */
function bound<K extends keyof SessionEventQuery>(
  key: K,
  field: string,
  value: string,
): Partial<Record<K, string>> {
  if (value === "") {
    return {};
  }
  const millis = Date.parse(value);
  if (Number.isNaN(millis) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw invalidArgumentError(`${field} must be an RFC 3339 instant, got '${value}'`);
  }
  return { [key]: new Date(millis).toISOString() } as Partial<Record<K, string>>;
}
