// The Library's Files: the direct-query core plus the workbench adapter.
//
// A File is not in the search index, so the Library lists Files the way it
// lists Environments: through the direct `list` query. It asks only for the
// Files that belong to no conversation (`without_session`): what a person
// uploaded to keep and reuse. A conversation's uploads and outputs live
// with that conversation, in its Files tab, and go when it is deleted. Both
// consoles consume this one implementation.

import { create } from "@bufbuild/protobuf";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  ListFilesRequestSchema,
  type FileList,
  type ListFilesRequest,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import type { WorkbenchListFn } from "../resource-workbench/types.js";

/** The slice of the Stigmer client this module needs (mockable in tests). */
export interface FileListClient {
  readonly file: {
    list(input: ListFilesRequest): Promise<FileList>;
  };
}

/** One page of the Library's Files, newest first. */
export interface FilePage {
  /** The Files in the page. */
  readonly entries: readonly StigmerFile[];
  /** Set when more Files follow; `""` on the last page. */
  readonly nextPageToken: string;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Fetch one page of the Files of no conversation the caller can view in
 * `org`: the page `pageToken` names (`""` for the first), at most
 * `pageSize`.
 */
export async function listLibraryFilesPage(
  client: FileListClient,
  org: string,
  page: { readonly pageSize?: number; readonly pageToken?: string } = {},
): Promise<FilePage> {
  const result = await client.file.list(
    create(ListFilesRequestSchema, {
      org,
      withoutSession: true,
      pageSize: page.pageSize && page.pageSize > 0 ? page.pageSize : DEFAULT_PAGE_SIZE,
      pageToken: page.pageToken ?? "",
    }),
  );
  return { entries: result.entries, nextPageToken: result.nextPageToken };
}

/**
 * Build a `ResourceWorkbench` data source over the Library's Files.
 * Consumers type their workbench as `ResourceWorkbench<File>` and pass
 * `getItemId={(f) => f.metadata?.id}`.
 *
 * `request.query` is ignored: Files have no server-side text search
 * (render the workbench with `searchable={false}`).
 */
export function createFileListFn(client: FileListClient): WorkbenchListFn<StigmerFile> {
  return (request) =>
    listLibraryFilesPage(client, request.org, {
      pageSize: request.pageSize,
      pageToken: request.pageToken,
    });
}
