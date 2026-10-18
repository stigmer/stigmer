// Environment list fetching: the direct-query core plus the workbench adapter.
//
// Environments are not in the search index, so the Library lists them the
// way it lists routines: through the direct `list` query, which returns
// full `Environment` protos (network policy and packages included) for the
// columns to read. Both consoles consume this one implementation.

import { create } from "@bufbuild/protobuf";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import {
  ListEnvironmentsRequestSchema,
  type EnvironmentList,
  type ListEnvironmentsRequest,
} from "@stigmer/apis/ai/stigmer/agentic/environment/v1/io_pb";
import type { WorkbenchListFn } from "../resource-workbench/types.js";

/** The slice of the Stigmer client this module needs (mockable in tests). */
export interface EnvironmentListClient {
  readonly environment: {
    list(input: ListEnvironmentsRequest): Promise<EnvironmentList>;
  };
}

/** One page of Environments, newest first. */
export interface EnvironmentPage {
  /** Full `Environment` protos for the page. */
  readonly entries: readonly Environment[];
  /** Set when more Environments follow; `""` on the last page. */
  readonly nextPageToken: string;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Fetch one page of the Environments the caller can view in `org` via the
 * direct query: the page `pageToken` names (`""` for the first), at most
 * `pageSize`.
 */
export async function listEnvironmentsPage(
  client: EnvironmentListClient,
  org: string,
  page: { readonly pageSize?: number; readonly pageToken?: string } = {},
): Promise<EnvironmentPage> {
  const result = await client.environment.list(
    create(ListEnvironmentsRequestSchema, {
      org,
      pageSize: page.pageSize && page.pageSize > 0 ? page.pageSize : DEFAULT_PAGE_SIZE,
      pageToken: page.pageToken ?? "",
    }),
  );
  return { entries: result.entries, nextPageToken: result.nextPageToken };
}

/**
 * Build a `ResourceWorkbench` data source over the direct Environment
 * query. Consumers type their workbench as `ResourceWorkbench<Environment>`
 * and pass `getItemId={(e) => e.metadata?.id}`.
 *
 * `request.query` is ignored: Environments have no server-side text search
 * (render the workbench with `searchable={false}`).
 */
export function createEnvironmentListFn(client: EnvironmentListClient): WorkbenchListFn<Environment> {
  return (request) =>
    listEnvironmentsPage(client, request.org, {
      pageSize: request.pageSize,
      pageToken: request.pageToken,
    });
}
