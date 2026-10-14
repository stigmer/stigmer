/**
 * The lane's query strings as Anthropic's SDK writes them: arrays in
 * brackets (`types[]=a&types[]=b`, `event_deltas[]=agent.message`), the
 * time range as `created_at[gt]` and its three siblings, and the paging
 * pair `limit` and `page`. The brackets arrive percent-encoded and
 * URLSearchParams decodes them. A bare `types=` or `event_deltas=` is read
 * the same way, so a hand-written `curl` needs no brackets.
 *
 * Only what the lane serves is checked here, and named by the client's own
 * parameter: `limit`'s range, `order`'s two values, and the event types a
 * Managed Agents client may ask for. Everything else (a malformed time, an
 * unknown type's shape) is the native method's to refuse. Parameters the
 * lane does not read (the SDK's `beta=true`) are ignored.
 *
 * Proven by __tests__/rules.test.ts.
 */
import { isStigmerEventType } from "@stigmer/session-log";

import { invalidRequest, type LaneError } from "./errors.js";

/** The most events one page holds (the native list's own bound). */
export const MAX_LIST_LIMIT = 1000;

/** The event types a stream may preview, as Managed Agents names them. */
export const STREAM_DELTA_TYPES: ReadonlySet<string> = new Set(["agent.message", "agent.thinking"]);

/** A list request's parameters, decoded. */
export interface ListQuery {
  /** Zero when absent: the native list's default page. */
  readonly limit: number;
  readonly page: string;
  readonly order: "" | "asc" | "desc";
  readonly types: readonly string[];
  readonly createdAtGt: string;
  readonly createdAtGte: string;
  readonly createdAtLt: string;
  readonly createdAtLte: string;
}

/** A stream request's parameters, decoded. */
export interface StreamQuery {
  readonly eventDeltas: readonly string[];
}

export function parseListQuery(params: URLSearchParams): ListQuery | LaneError {
  const limitText = params.get("limit");
  let limit = 0;
  if (limitText !== null) {
    limit = Number(limitText);
    if (!/^\d+$/.test(limitText) || limit < 1 || limit > MAX_LIST_LIMIT) {
      return invalidRequest(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`);
    }
  }
  const order = params.get("order") ?? "";
  if (order !== "" && order !== "asc" && order !== "desc") {
    return invalidRequest("order must be asc or desc");
  }
  const types = arrayParam(params, "types");
  const stigmerType = types.find(isStigmerEventType);
  if (stigmerType !== undefined) {
    return invalidRequest(
      `'${stigmerType}' is a Stigmer event type, which this API does not serve; read it through Stigmer's own session API`,
    );
  }
  return {
    limit,
    page: params.get("page") ?? "",
    order,
    types,
    createdAtGt: params.get("created_at[gt]") ?? "",
    createdAtGte: params.get("created_at[gte]") ?? "",
    createdAtLt: params.get("created_at[lt]") ?? "",
    createdAtLte: params.get("created_at[lte]") ?? "",
  };
}

export function parseStreamQuery(params: URLSearchParams): StreamQuery | LaneError {
  const eventDeltas = [...new Set(arrayParam(params, "event_deltas"))];
  const unserved = eventDeltas.find((type) => !STREAM_DELTA_TYPES.has(type));
  if (unserved !== undefined) {
    return invalidRequest(`event_deltas may name agent.message and agent.thinking, not '${unserved}'`);
  }
  return { eventDeltas };
}

/** Every value of an array parameter, bracketed or bare, in the order given. */
function arrayParam(params: URLSearchParams, name: string): string[] {
  return [...params.getAll(`${name}[]`), ...params.getAll(name)];
}
