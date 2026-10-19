/**
 * A turn's files (RunSpec.file_ids): each becomes the conversation's own
 * File, joins the conversation's resources, and is recorded on the run as
 * the content block its message carried (RunStatus.message_files), all
 * before the run is stored, so the turn's user.message event, written with
 * the row, carries them after its text.
 *
 * Who may give a file with a message: whoever may send the conversation a
 * message (the run create already asked can_create_run_in) and may view
 * the File, in the run's organization (instances.ts). The conversation's
 * list grows inside the store's synchronous modify of its row, so a
 * participant adds files without the owner's can_edit that a masked update
 * of the list needs, and no write since the turn began is undone.
 *
 * A block is an image for Claude's image types (jpeg, png, gif, webp) and a
 * document for anything else; the runner reads which from the File's type
 * and sniffs an image before it shows it to the model.
 *
 * A create that fails before the run is stored takes back what this step
 * did: the conversation's new entries and the copies it made
 * (undoMessageFiles).
 *
 * Proven by __tests__/message-files.test.ts and the run composed suite.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ContentBlockSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import type { ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { internalError, invalidArgumentError, notFoundError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { FileInstances } from "./instances.js";
import { MAX_SESSION_FILES, uniquifyMountPath } from "./session-resources.js";

/** The types a message shows the model as an image: Claude's image types. */
export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** The content block a message carries for a File. */
export function contentBlockFor(file: File): ContentBlock {
  return create(ContentBlockSchema, {
    type: IMAGE_MIME_TYPES.has(file.spec?.mimeType ?? "") ? "image" : "document",
    source: { type: "file", fileId: file.metadata?.id ?? "" },
  });
}

/** The context key the step's additions ride, for undoMessageFiles. */
export const MESSAGE_FILES_ADDED_KEY = "messageFilesAdded";

/** What the step added to a conversation, for a failed create to take back. */
export interface MessageFilesAdded {
  readonly sessionId: string;
  readonly fileIds: ReadonlyArray<string>;
}

type RunDesc = typeof RunSchema;

function sessionIdOfRun(ctx: RequestContext<RunDesc>): string {
  const target = ctx.newState.spec?.target;
  return target?.case === "sessionId" ? target.value : "";
}

export function newResolveMessageFilesStep(store: Store, instances: FileInstances): PipelineStep<RunDesc> {
  return {
    name: "ResolveMessageFiles",
    async execute(ctx: RequestContext<RunDesc>): Promise<void> {
      const spec = ctx.newState.spec;
      const requested = spec?.fileIds ?? [];
      if (spec === undefined || requested.length === 0) {
        return;
      }
      const sessionId = sessionIdOfRun(ctx);
      const target = { org: ctx.newState.metadata?.org ?? "", sessionId };
      const files: File[] = [];
      for (const fileId of requested) {
        files.push(await instances.resolve(fileId, target, ctx.callerIdentity));
      }

      const added: string[] = [];
      try {
        await store.updateResource(ApiResourceKind.session, sessionId, SessionSchema, (row) => {
          const rowSpec = (row.spec ??= create(SessionSpecSchema));
          const held = new Set<string>();
          const taken = new Set<string>();
          let count = 0;
          for (const entry of rowSpec.resources) {
            if (entry.resource.case === "file") {
              held.add(entry.resource.value.fileId);
              taken.add(entry.resource.value.mountPath);
              count++;
            }
          }
          for (const file of files) {
            const id = file.metadata?.id ?? "";
            if (held.has(id)) {
              continue;
            }
            count++;
            if (count > MAX_SESSION_FILES) {
              throw invalidArgumentError(
                `a conversation holds at most ${MAX_SESSION_FILES} files; this message would add more`,
              );
            }
            const mountPath = uniquifyMountPath(file.spec?.filename ?? "", taken);
            taken.add(mountPath);
            held.add(id);
            added.push(id);
            rowSpec.resources.push(
              create(SessionResourceSchema, { resource: { case: "file", value: { fileId: id, mountPath } } }),
            );
          }
        });
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("session", sessionId);
        }
        if (error instanceof ConnectError) {
          throw error;
        }
        throw internalError(error, "failed to add the message's files to the conversation");
      }
      ctx.set(MESSAGE_FILES_ADDED_KEY, { sessionId, fileIds: added } satisfies MessageFilesAdded);

      // The message names the conversation's own Files.
      spec.fileIds = files.map((file) => file.metadata?.id ?? "");
      const status = (ctx.newState.status ??= create(RunStatusSchema));
      status.messageFiles = files.map(contentBlockFor);
    },
  };
}

/**
 * Takes back what ResolveMessageFiles did for a create that failed before
 * the run was stored: the conversation's new entries, then the copies.
 * Faults are logged, never raised over the create's own.
 */
export async function undoMessageFiles(
  deps: { readonly store: Store; readonly logger: Logger },
  added: MessageFilesAdded | undefined,
  instances: FileInstances,
  caller: CallerIdentity,
): Promise<void> {
  try {
    if (added !== undefined && added.fileIds.length > 0) {
      const gone = new Set(added.fileIds);
      await deps.store.updateResource(ApiResourceKind.session, added.sessionId, SessionSchema, (row) => {
        if (row.spec !== undefined) {
          row.spec.resources = row.spec.resources.filter(
            (entry) => !(entry.resource.case === "file" && gone.has(entry.resource.value.fileId)),
          );
        }
      });
    }
    await instances.discard(caller);
  } catch (error) {
    deps.logger.warn("failed to take back a failed turn's files", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
