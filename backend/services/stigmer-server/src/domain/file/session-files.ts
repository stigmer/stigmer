/**
 * A conversation's Files go with it. The session's delete chain (and its
 * purge) runs CascadeDeleteSessionFiles before the session's row, as it
 * cascades the session's runs: each File's row, its ref and, when no other
 * File shares them, its bytes, then its access, while the session still
 * links it to its organization. Children before the parent, so a delete
 * that stops halfway converges when it is retried.
 *
 * The Files are read through the File list index's `session` key, every
 * page of it: a conversation holds at most a few hundred Files.
 *
 * Proven by __tests__/file.test.ts ("deleting a session deletes its Files").
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexRow } from "../../store/list-index.js";
import type { FileBlobs } from "./blobs.js";
import { fileListIndex } from "./list-index.js";

/** How many of a conversation's Files one read takes. */
const PAGE = 200;

export function newCascadeDeleteSessionFilesStep<Desc extends DescMessage>(
  store: Store,
  blobs: FileBlobs,
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteSessionFiles",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const sessionId = ctx.get(RESOURCE_ID_KEY);
      if (typeof sessionId !== "string" || sessionId === "") {
        throw internalError(
          new Error("session id not in context (ExtractResourceId must run first)"),
          "cascade delete session files",
        );
      }
      let removed = 0;
      for (;;) {
        // Each pass reads from the top: the rows removed below are gone
        // from the index, so the next page is what is left.
        let rows: ListIndexRow[];
        try {
          rows = await store.queryResources(fileListIndex, {
            anyKey: [{ name: "session", value: sessionId }],
            limit: PAGE,
          });
        } catch (error) {
          throw internalError(error, "failed to list the session's files");
        }
        for (const row of rows) {
          const org = fromBinary(FileSchema, row.data).metadata?.org ?? "";
          await blobs.removeFile(row.id);
          await cleanUpDeletedResource(lifecycle, logger, {
            kind: ApiResourceKind.file,
            resourceId: row.id,
            orgId: org,
            caller: ctx.callerIdentity,
          });
          removed++;
        }
        if (rows.length < PAGE) {
          break;
        }
      }
      if (removed > 0) {
        logger.info("Cascade-deleted files of session", { sessionId, count: removed });
      }
    },
  };
}
