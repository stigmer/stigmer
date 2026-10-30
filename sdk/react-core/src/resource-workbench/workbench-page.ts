// The page contract every list function answers: what a workbench asks
// for and the page it gets back. Kept apart from the workbench's view types
// so a list function (the library source, search/librarySource.ts) carries
// no component type.

import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

/** What a workbench asks its list function for: one page of an organization's rows. */
export interface WorkbenchPageRequest {
  /** Organization id (a slug is also accepted). */
  readonly org: string;
  /** The search box's text; empty or absent when nothing is typed. */
  readonly query?: string;
  /** The most rows the page holds. */
  readonly pageSize: number;
  /** The previous page's `nextPageToken`; `""` for the first page. */
  readonly pageToken: string;
}

/** One page of rows, as every Stigmer list answers it. */
export interface WorkbenchPage<TData = SearchResult> {
  readonly entries: readonly TData[];
  /** Set when more rows follow; `""` on the last page. */
  readonly nextPageToken: string;
}

/**
 * A workbench's data source: reads the page a request names. The
 * workbench pages by token (next and previous), so a list carries no total.
 */
export type WorkbenchListFn<TData = SearchResult> = (
  request: WorkbenchPageRequest,
) => Promise<WorkbenchPage<TData>>;
