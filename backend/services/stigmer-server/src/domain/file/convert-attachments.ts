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
 * turns. A row that cannot become a File is logged and forgotten, never a
 * reason to stop a boot:
 *   - a run or a conversation that is gone;
 *   - a key not of the shape the removed upload minted for this row's
 *     filename (`attachments/<ULID>/<filename>`): a run's create once
 *     stored any non-empty key, so a key is trusted only in that shape,
 *     which names nothing outside the attachments folder;
 *   - a key whose blob row is another organization's, or staged;
 *   - bytes that are gone, or a blob that turns unavailable before its
 *     File is written.
 *
 * Idempotent, so a boot that stops halfway converges on the next one: a
 * File's id is derived from its run and position, a blob the last pass
 * recorded and whose lease ran out is recorded again, a row another
 * server records first is used as it is, an id already held is not
 * inserted twice, its access is written again (idempotently), and a block
 * already on the run is not added twice; the conversion row goes last. A
 * storage or store fault stops the boot loudly (the role reconcile's
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
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { getIdPrefix } from "../../pipeline/apiresource-meta.js";
import { resolveResourceCreatedEvent } from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForCreate } from "../../pipeline/steps/defaults.js";
import { FileBlobUnavailableError } from "../../store/file-blobs.js";
import type { AttachmentConversion } from "../../store/file-blobs.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { BLOB_WRITE_LEASE_MS } from "./constants.js";
import { contentBlockFor } from "./message-files.js";
import { fileMimeType } from "./mime.js";
import { fileNameOf } from "./steps.js";

/** The key the removed upload minted: the attachments folder, an upper-case ULID, the bare filename. */
const MINTED_KEY = /^attachments\/[0-9A-HJKMNP-TV-Z]{26}\/([^/\\\u0000]+)$/;

/** Whether `key` is the one the removed upload would have minted for `filename`. */
export function isMintedAttachmentKey(key: string, filename: string): boolean {
  const name = MINTED_KEY.exec(key)?.[1];
  return name !== undefined && name === filename && name !== "." && name !== "..";
}

/** How many conversion rows one read takes. */
const CONVERSION_PAGE = 100;

/** Crockford's base32, lowercase: the alphabet a ULID, and so an id, is written in. */
const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

/** A File id derived from its run and position: the same on every boot, shaped as a minted one. */
export function convertedFileId(runId: string, position: number): string {
  return derivedFileId(`${runId}\u0000${position}`);
}

/**
 * A File id derived from `material`, shaped as a minted one. Each caller
 * gives its material a form no other caller's can take, so two derivations
 * never meet: a conversion's begins with a run id, an output's with its
 * own tag (outputs.ts).
 */
export function derivedFileId(material: string): string {
  const digest = createHash("sha256").update(material).digest();
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
  const skip = (why: string): false => {
    logger.warn(`a stored attachment is not converted: ${why}`, { runId: row.runId, filename: row.filename });
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
  if (!isMintedAttachmentKey(row.storageKey, row.filename)) {
    return skip("its key is not one an upload minted");
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
  await store.updateResource(ApiResourceKind.run, row.runId, RunSchema, (stored) => {
    const status = (stored.status ??= create(RunStatusSchema));
    const named = status.messageFiles.some((block) => block.source?.fileId === id);
    if (!named) {
      status.messageFiles.push(contentBlockFor(file));
    }
  });
  return true;
}

/**
 * Records the bytes already stored at `key` as an orphaned blob of `org`,
 * leased while its File is written, so the File reuses them where they
 * are; why it may not, or undefined when it may. A blob the last pass
 * recorded and whose lease ran out is leased again, and a row another
 * server draining at once records first is used as it is. Shared by every
 * conversion of stored bytes into Files (convert-outputs.ts too).
 */
export async function adoptStoredBlob(
  store: Store,
  key: string,
  org: string,
  sizeBytes: number,
  nowSeconds: number,
): Promise<string | undefined> {
  const leaseUntil = nowSeconds + Math.ceil(BLOB_WRITE_LEASE_MS / 1000);
  const record = { blobKey: key, org, state: "orphaned" as const, sizeBytes, expiresAt: leaseUntil };
  let blob = await store.files.getBlob(key);
  if (blob !== undefined && blob.state === "orphaned" && blob.expiresAt <= nowSeconds && blob.org === org) {
    // The last pass recorded it and stopped before its File: lease it again.
    await store.files.forgetBlob(key, nowSeconds);
    blob = undefined;
  }
  if (blob === undefined) {
    try {
      await store.files.recordBlob(record);
    } catch (error) {
      // Another server draining at once recorded it first; its row is used as it is.
      blob = await store.files.getBlob(key);
      if (blob === undefined) {
        throw error;
      }
    }
  }
  if (blob !== undefined && blob.org !== org) {
    return "its key's bytes are another organization's";
  }
  if (blob !== undefined && blob.state === "staged") {
    return "its key is a staged upload's";
  }
  return undefined;
}

/** The read's answer, or undefined when the resource is gone; any other fault is raised. */
export async function loadOrUndefined<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}
