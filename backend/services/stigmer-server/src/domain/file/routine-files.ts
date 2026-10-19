/**
 * The Files a routine names (spec.agent.resources), checked when the
 * routine is written: each must exist, be of the routine's organization,
 * and be one the writer may view. A routine holds no copy (each fire makes
 * its new conversation's own, as its owner, through the session create),
 * so this is the only point a writer's reach is asked before the name is
 * stored. Without it, anyone who may write a routine could name a File
 * they were never shown, and so keep its uploader from deleting it
 * (steps.ts refuses deleting a File a routine names).
 *
 * A File the stored routine already named is not asked again on an
 * update: it was asked when it was named.
 *
 * Proven by __tests__/routine-files.test.ts.
 */
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { Routine, RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import { failedPreconditionError, internalError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { mayNotNameFileMessage } from "./instances.js";

/** The ids of the Files a routine names, in order. */
function namedFiles(routine: Routine | undefined): string[] {
  return (routine?.spec?.agent?.resources ?? []).flatMap((entry) =>
    entry.resource.case === "file" ? [entry.resource.value.fileId] : [],
  );
}

export function newCheckRoutineFilesStep(deps: {
  readonly store: Store;
  readonly authorizer: Authorizer;
}): PipelineStep<typeof RoutineSchema> {
  return {
    name: "CheckRoutineFiles",
    async execute(ctx: RequestContext<typeof RoutineSchema>): Promise<void> {
      const org = ctx.newState.metadata?.org ?? "";
      const asked = new Set(namedFiles(ctx.get(EXISTING_RESOURCE_KEY) as Routine | undefined));
      for (const fileId of namedFiles(ctx.newState)) {
        if (asked.has(fileId)) {
          continue;
        }
        asked.add(fileId);
        let file;
        try {
          file = await deps.store.getResource(ApiResourceKind.file, fileId, FileSchema);
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("file", fileId);
          }
          throw internalError(error, "failed to load file");
        }
        if ((file.metadata?.org ?? "") !== org) {
          throw failedPreconditionError(`file ${fileId} belongs to another organization`);
        }
        await authorizeResolvedResource(
          deps.authorizer,
          ctx.callerIdentity,
          { permission: IamPermission.can_view, resourceKind: ApiResourceKind.file, resourceId: fileId },
          mayNotNameFileMessage(fileId),
        );
      }
    },
  };
}
