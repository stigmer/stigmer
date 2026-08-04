// Schedule list fetching — the direct-query core plus the workbench adapter.
//
// Schedules are the one Library kind NOT backed by the search service: the
// generic `SearchResult` summary cannot carry the operational fields a
// schedule list exists to show (`next_fire_at`, enabled/paused state, last
// run), while the direct `listSchedules` query returns full `Schedule`
// protos and was explicitly shaped for "the org-context view a console tab
// needs". Both consoles consume this single implementation — inlining it
// per-app would duplicate correctness-bearing pagination logic (DD-016).

import { create } from "@bufbuild/protobuf";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ListSchedulesRequestSchema,
  type ListSchedulesRequest,
  type ScheduleList,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { ListParams, ListResult } from "@stigmer/sdk";

/** The slice of the Stigmer client this module needs (mockable in tests). */
export interface ScheduleListClient {
  readonly schedule: {
    list(input: ListSchedulesRequest): Promise<ScheduleList>;
  };
}

/** One page of schedules, with pagination totals. */
export interface SchedulePage {
  /** Full `Schedule` protos (spec + status) for the requested page. */
  readonly items: readonly Schedule[];
  /** Total schedules in the org (across all pages). */
  readonly totalCount: number;
  /** Total pages at the requested page size. */
  readonly totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Fetch one page of an organization's schedules via the direct query.
 *
 * Handles a verified split between the two server editions: cloud slices
 * pages server-side, while the OSS server documents that it ignores
 * `page_info` and returns every matching schedule. A server that
 * paginated can never return more rows than the requested size, so an
 * overflowing response is the tell that the server ignored pagination —
 * only then is the page sliced locally (absolute indices into the full
 * list). A cloud page passes through untouched.
 */
export async function listSchedulesPage(
  client: ScheduleListClient,
  org: string,
  page: { readonly num?: number; readonly size?: number } = {},
): Promise<SchedulePage> {
  const size = page.size && page.size > 0 ? page.size : DEFAULT_PAGE_SIZE;
  const num = page.num && page.num > 0 ? page.num : 1;

  const result = await client.schedule.list(
    create(ListSchedulesRequestSchema, {
      org,
      pageInfo: { num, size },
    }),
  );

  const items =
    result.items.length > size
      ? result.items.slice((num - 1) * size, num * size)
      : result.items;

  return {
    items,
    totalCount: result.totalCount,
    totalPages: Math.ceil(result.totalCount / size),
  };
}

/**
 * Build a `ResourceWorkbench`-compatible `listFn` over the direct
 * schedule query.
 *
 * The returned entries are full `Schedule` protos occupying the
 * `SearchResult` slot of `ListResult` — `ResourceWorkbench` is generic
 * over its row type (`useResourceCollection` casts entries through to
 * `TData`), and this is the one documented place where that cast
 * happens. Consumers type their workbench as
 * `ResourceWorkbench<Schedule>` and pass `getItemId={(s) => s.metadata?.id}`.
 *
 * `params.query` and `params.crossOrgPublic` are ignored: schedules have
 * no server-side text search (render the workbench with
 * `searchable={false}`) and are never public/cross-org.
 */
export function createScheduleListFn(
  client: ScheduleListClient,
): (params: ListParams) => Promise<ListResult> {
  return async (params: ListParams): Promise<ListResult> => {
    const { items, totalCount, totalPages } = await listSchedulesPage(
      client,
      params.org,
      params.page ?? {},
    );
    return {
      entries: items as unknown as SearchResult[],
      totalCount,
      totalPages,
    };
  };
}
