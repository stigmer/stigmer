/**
 * The boot pass that turns a self-hosted install's stored attachments into
 * Files. The store's migration (store/workspace-becomes-resources.ts) took
 * each run's attachments off its row and left one conversion row each;
 * this pass, which has the blob store the migration lacks, drains them:
 * each becomes a File of the run's conversation over the bytes already
 * stored at its key, with its real size, owned by the run's creator, with
 * its access written as an upload's is, and the run's message_files gains
 * its block, so the old message still shows and downloads its file.
 *
 * Converted Files are not added to the conversation's resources: they were
 * a past message's inputs, listed and downloadable, not mounted on later
 * turns. An attachment whose bytes are gone is logged and skipped. A run or
 * conversation that is gone takes its conversion with it.
 *
 * Idempotent, so a boot that stops halfway converges on the next one: a
 * File's id is derived from its run and position, a stored blob is not
 * recorded twice, an id already held is not inserted twice, its access is
 * written again (idempotently), and a block already on the run is not
 * added twice; the conversion row goes last.
 * A storage or store fault stops the boot loudly (the role reconcile's
 * posture), and an empty table costs one query.
 *
 * Proven by __tests__/convert-attachments.test.ts.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { getIdPrefix } from "../../pipeline/apiresource-meta.js";
import { resolveResourceCreatedEvent } from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForCreate } from "../../pipeline/steps/defaults.js";
import type { AttachmentConversion } from "../../store/file-blobs.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { BLOB_WRITE_LEASE_MS } from "./constants.js";
import { contentBlockFor } from "./message-files.js";
import { fileMimeType } from "./mime.js";
import { fileNameOf } from "./steps.js";

/** How many conversion rows one read takes. */
const CONVERSION_PAGE = 100;

/** Crockford's base32, lowercase: the alphabet a ULID, and so an id, is written in. */
const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

/** A File id derived from its run and position: the same on every boot, shaped as a minted one. */
export function convertedFileId(runId: string, position: number): string {
  const digest = createHash("sha256").update(`${runId}\u0000${position}`).digest();
  let body = "";
  for (let i = 0; i < 26; i++) {
    body += BASE32[(digest[i] ?? 0) % 32];
  }
  return `${getIdPrefix(ApiResourceKind.file)}_${body}`;
}

export interface ConvertAttachmentsDeps {
  readonly store: Store;
  /** The File store's driver: the generic store's on every arm, where attachments always lived. */
  readonly storage: ArtifactStorage;
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly logger: Logger;
}

/** Drains the conversion table; returns how many Files it made. */
export async function convertStoredAttachments(deps: ConvertAttachmentsDeps): Promise<number> {
  let converted = 0;
  for (;;) {
    const rows = await deps.store.files.listConversions(CONVERSION_PAGE);
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      if (await convertOne(deps, row)) {
        converted++;
      }
      await deps.store.files.forgetConversion(row.runId, row.position);
    }
  }
  if (converted > 0) {
    deps.logger.info("converted stored attachments into Files", { count: converted });
  }
  return converted;
}

async function convertOne(deps: ConvertAttachmentsDeps, row: AttachmentConversion): Promise<boolean> {
  const { store, storage, logger } = deps;
  let run;
  try {
    run = await store.getResource(ApiResourceKind.run, row.runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return false;
    }
    throw error;
  }
  if (row.sessionId === "") {
    logger.warn("a stored attachment's run is in no conversation; it is not converted", {
      runId: row.runId,
      filename: row.filename,
    });
    return false;
  }
  let sizeBytes: number;
  try {
    sizeBytes = await storage.size(row.storageKey);
  } catch (error) {
    if (error instanceof ArtifactStorageNotFoundError) {
      logger.warn("a stored attachment's bytes are gone; it is not converted", {
        runId: row.runId,
        filename: row.filename,
      });
      return false;
    }
    throw error;
  }

  const id = convertedFileId(row.runId, row.position);
  const creator = run.status?.audit?.specAudit?.createdBy?.id ?? "";
  const caller: CallerIdentity = { identityId: creator, callerClass: "user", issuer: "", rawToken: "" };
  const file = create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: {
      id,
      org: row.org,
      name: fileNameOf(row.filename),
      visibility: ApiResourceVisibility.visibility_private,
    },
    spec: { filename: row.filename, mimeType: fileMimeType(row.filename, row.contentType) },
    status: { sizeBytes: BigInt(sizeBytes), sessionId: row.sessionId },
  });
  setAuditFieldsForCreate(FileSchema, file, caller);

  const nowSeconds = Math.floor(Date.now() / 1000);
  if ((await store.files.getBlob(row.storageKey)) === undefined) {
    await store.files.recordBlob({
      blobKey: row.storageKey,
      org: row.org,
      state: "orphaned",
      sizeBytes,
      expiresAt: nowSeconds + Math.ceil(BLOB_WRITE_LEASE_MS / 1000),
    });
  }
  await store.files.insert(
    ApiResourceKind.file,
    id,
    FileSchema,
    file,
    { blobKey: row.storageKey, org: row.org, sizeBytes },
    nowSeconds,
  );
  // Written on every pass, not only the one that inserted: a boot that
  // stopped between the row and its access converges, and the writes are
  // idempotent.
  if (deps.lifecycle !== undefined) {
    const event = resolveResourceCreatedEvent(ApiResourceKind.file, file, caller, logger);
    if (event !== undefined) {
      await deps.lifecycle.onResourceCreated(event);
    }
  }
  await store.updateResource(ApiResourceKind.run, row.runId, RunSchema, (stored) => {
    const status = (stored.status ??= create(RunStatusSchema));
    const named = status.messageFiles.some((block) => block.source?.fileId === id);
    if (!named) {
      status.messageFiles.push(contentBlockFor(file));
    }
  });
  return true;
}
