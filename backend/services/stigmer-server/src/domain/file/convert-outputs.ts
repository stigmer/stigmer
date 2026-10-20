/**
 * The boot pass that turns the files the native engine uploaded for a run,
 * before what a turn returns became Files, into Files of that run. The
 * store's migration (store/run-artifacts-become-files.ts) took each file
 * entry off its run's status and left one conversion row each; this pass,
 * which has the blob store the migration lacks, drains them: each becomes
 * a File of the run, in the run's conversation, over the bytes already
 * stored at its key, with its real size, owned by the run's creator, with
 * its access written as an output's is. Its run_id is the run's and its
 * output_path its name, so an old conversation lists and downloads it as
 * that turn's output. The engine stored every file flat, so the name is
 * one path segment.
 *
 * A row that cannot become a File is logged and forgotten, never a reason
 * to stop a boot:
 *   - a run or a conversation that is gone, or a run in no conversation;
 *   - a key not of the one shape the engine wrote for this row
 *     (`artifacts/<the run's id>/<name>`, the name one segment an output
 *     path could end in): the run's status was written by its runner, so a
 *     key is trusted only in that shape, which names nothing outside the
 *     run's own folder and nothing of file review's or a tool output's,
 *     which live deeper in it;
 *   - a key whose blob row is another organization's, or staged;
 *   - bytes that are gone, or a blob that turns unavailable before its
 *     File is written.
 *
 * Idempotent, as the attachments' pass is (convert-attachments.ts, whose
 * blob step it shares): a File's id is derived from its run and position
 * under its own tag, an id already held is not inserted twice, its access
 * is written again, and the conversion row goes last. A storage or store
 * fault stops the boot loudly, and an empty table costs one query.
 *
 * Proven by __tests__/convert-outputs.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { resolveResourceCreatedEvent } from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForCreate } from "../../pipeline/steps/defaults.js";
import { FileBlobUnavailableError } from "../../store/file-blobs.js";
import type { OutputConversion } from "../../store/file-blobs.js";
import type { Store } from "../../store/interface.js";
import { adoptStoredBlob, derivedFileId, loadOrUndefined } from "./convert-attachments.js";
import { fileMimeType } from "./mime.js";
import { outputPathProblem } from "./outputs.js";
import { fileNameOf } from "./steps.js";

/** How many conversion rows one read takes. */
const CONVERSION_PAGE = 100;

/** Whether `key` is the one the engine wrote for the file `name` of run `runId`. */
export function isStoredRunFileKey(key: string, runId: string, name: string): boolean {
  return (
    runId !== "" &&
    !runId.includes("/") &&
    !name.includes("/") &&
    outputPathProblem(name) === undefined &&
    key === `artifacts/${runId}/${name}`
  );
}

/** A converted file's File id: the same on every boot, never one an output or an attachment derives. */
export function convertedOutputFileId(runId: string, position: number): string {
  return derivedFileId(["stigmer.run-artifact", runId, String(position)].join("\u0000"));
}

export interface ConvertOutputsDeps {
  readonly store: Store;
  /** The generic store, where the engine uploaded every file. */
  readonly storage: ArtifactStorage;
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly logger: Logger;
}

/** Drains the output conversion table; returns how many Files it made. */
export async function convertStoredOutputs(deps: ConvertOutputsDeps): Promise<number> {
  let converted = 0;
  for (;;) {
    const rows = await deps.store.files.listOutputConversions(CONVERSION_PAGE);
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      if (await convertOne(deps, row)) {
        converted++;
      }
      await deps.store.files.forgetOutputConversion(row.runId, row.position);
    }
  }
  if (converted > 0) {
    deps.logger.info("converted a run's stored files into Files", { count: converted });
  }
  return converted;
}

async function convertOne(deps: ConvertOutputsDeps, row: OutputConversion): Promise<boolean> {
  const { store, storage, logger } = deps;
  const skip = (why: string): false => {
    logger.warn(`a run's stored file is not converted: ${why}`, { runId: row.runId, name: row.name });
    return false;
  };
  const run = await loadOrUndefined(() => store.getResource(ApiResourceKind.run, row.runId, RunSchema));
  if (run === undefined) {
    return false;
  }
  if (row.sessionId === "") {
    return skip("its run is in no conversation");
  }
  if ((await loadOrUndefined(() => store.getResource(ApiResourceKind.session, row.sessionId, SessionSchema))) === undefined) {
    return skip("its conversation is gone");
  }
  if (!isStoredRunFileKey(row.storageKey, row.runId, row.name)) {
    return skip("its key is not the one the engine wrote for it");
  }
  let sizeBytes: number;
  try {
    sizeBytes = await storage.size(row.storageKey);
  } catch (error) {
    if (error instanceof ArtifactStorageNotFoundError) {
      return skip("its bytes are gone");
    }
    throw error;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const refused = await adoptStoredBlob(store, row.storageKey, row.org, sizeBytes, nowSeconds);
  if (refused !== undefined) {
    return skip(refused);
  }

  const id = convertedOutputFileId(row.runId, row.position);
  const creator = run.status?.audit?.specAudit?.createdBy?.id ?? "";
  const caller: CallerIdentity = { identityId: creator, callerClass: "user", issuer: "", rawToken: "" };
  const file = create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: {
      id,
      org: row.org,
      name: fileNameOf(row.name),
      visibility: ApiResourceVisibility.visibility_private,
    },
    spec: { filename: row.name, mimeType: fileMimeType(row.name, "") },
    status: { sizeBytes: BigInt(sizeBytes), sessionId: row.sessionId, runId: row.runId, outputPath: row.name },
  });
  setAuditFieldsForCreate(FileSchema, file, caller);

  try {
    await store.files.insert(
      ApiResourceKind.file,
      id,
      FileSchema,
      file,
      { blobKey: row.storageKey, org: row.org, sizeBytes },
      nowSeconds,
    );
  } catch (error) {
    if (error instanceof FileBlobUnavailableError) {
      return skip(error.message);
    }
    throw error;
  }
  // Written on every pass, not only the one that inserted: a boot that
  // stopped between the row and its access converges, and the writes are
  // idempotent.
  if (deps.lifecycle !== undefined) {
    const event = resolveResourceCreatedEvent(ApiResourceKind.file, file, caller, logger);
    if (event !== undefined) {
      await deps.lifecycle.onResourceCreated(event);
    }
  }
  return true;
}
