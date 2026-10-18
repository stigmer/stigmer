// Routine list fetching — the direct-query core plus the workbench adapter.
//
// Routines are the one Library kind NOT backed by the search service: the
// generic `SearchResult` summary cannot carry the operational fields a
// routine list exists to show (`next_fire_at`, enabled/paused state, last
// run), while the direct `list` query returns full `Routine` protos and was
// explicitly shaped for "the org-context view a console tab needs". Both
// consoles consume this single implementation, so the paging lives once.

import { create } from "@bufbuild/protobuf";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  ListRoutinesRequestSchema,
  type ListRoutinesRequest,
  type RoutineList,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type { WorkbenchListFn } from "../resource-workbench/types.js";

/** The slice of the Stigmer client this module needs (mockable in tests). */
export interface RoutineListClient {
  readonly routine: {
    list(input: ListRoutinesRequest): Promise<RoutineList>;
  };
}

/** One page of routines, newest first. */
export interface RoutinePage {
  /** Full `Routine` protos (spec + status) for the page. */
  readonly entries: readonly Routine[];
  /** Set when more routines follow; `""` on the last page. */
  readonly nextPageToken: string;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Fetch one page of an organization's routines via the direct query:
 * the page `pageToken` names (`""` for the first), at most `pageSize`.
 */
export async function listRoutinesPage(
  client: RoutineListClient,
  org: string,
  page: { readonly pageSize?: number; readonly pageToken?: string } = {},
): Promise<RoutinePage> {
  const result = await client.routine.list(
    create(ListRoutinesRequestSchema, {
      org,
      pageSize: page.pageSize && page.pageSize > 0 ? page.pageSize : DEFAULT_PAGE_SIZE,
      pageToken: page.pageToken ?? "",
    }),
  );
  return { entries: result.entries, nextPageToken: result.nextPageToken };
}

/**
 * Build a `ResourceWorkbench` data source over the direct routine query.
 * Consumers type their workbench as `ResourceWorkbench<Routine>` and pass
 * `getItemId={(s) => s.metadata?.id}`.
 *
 * `request.query` is ignored: routines have no server-side text search
 * (render the workbench with `searchable={false}`).
 */
export function createRoutineListFn(
  client: RoutineListClient,
): WorkbenchListFn<Routine> {
  return (request) =>
    listRoutinesPage(client, request.org, {
      pageSize: request.pageSize,
      pageToken: request.pageToken,
    });
}
