/**
 * The data migration that lifts the files the native engine uploaded for a
 * run off the run's status, to become Files of the run (SQLite v45,
 * Postgres v41): what one row becomes, said once for both drivers, which
 * own the SQL, the pages and the transaction.
 *
 * RunStatus field 15 (`artifacts`, now reserved) held `RunArtifact{name=1,
 * sandbox_path=2, kind=3, size_bytes=4, storage_key=5, created_at=7,
 * expires_at=8, entries=9, content_hash=10}`, one per file the engine
 * uploaded. Each FILE entry (kind 1) is lifted as one conversion record
 * for the file domain to make into a File of the run, its name becoming
 * the File's filename and output path; a DIRECTORY entry, which nothing
 * has produced since directories stopped being archived, is dropped. The
 * field leaves the row whatever it held.
 *
 * The retired field is read by wire number (retired-fields.ts), never
 * through a schema that no longer exists. Only the status changes, and a
 * run's etag covers its spec alone (etag.ts), so the row is not re-stamped.
 * A row without the field is left byte for byte as it is (undefined).
 * `updated_at` is left alone: no list key reads the field. An undecodable
 * row fails the step: the driver's transaction rolls back and the boot
 * stops on the row it names.
 *
 * Pinned by __tests__/run-artifacts-become-files.test.ts and both drivers'
 * migration arms.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { WireType } from "@bufbuild/protobuf/wire";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import type { OutputConversion } from "./file-blobs.js";
import { listIndexInstant } from "./list-index.js";
import { dropRetired, eachField, retiredMessages } from "./retired-fields.js";

/** The `kind` column value of the rows the step rewrites. */
export const RUN_ARTIFACTS_RUN_KIND = "run";

/** How many rows the step decodes per page. */
export const RUN_ARTIFACTS_PAGE_SIZE = 200;

/** RunStatus's retired artifacts. */
const STATUS_ARTIFACTS_FIELD = 15;

/** RunArtifact field numbers. */
const ARTIFACT_NAME = 1;
const ARTIFACT_KIND = 3;
const ARTIFACT_STORAGE_KEY = 5;

/** RunArtifactKind's FILE value. */
const KIND_FILE = 1;

/** A run row without its stored files, and the files it held. */
export interface LiftedRunArtifacts {
  readonly data: Uint8Array;
  readonly outputs: readonly OutputConversion[];
}

/**
 * The run row without its stored files and the file entries it held, in
 * order; undefined when it holds none. Throws when the bytes do not
 * decode.
 */
export function liftRunArtifacts(data: Uint8Array): LiftedRunArtifacts | undefined {
  const run = fromBinary(RunSchema, data);
  const status = run.status;
  const unknown = status?.$unknown ?? [];
  if (status === undefined || !unknown.some((field) => field.no === STATUS_ARTIFACTS_FIELD)) {
    return undefined;
  }
  const runId = run.metadata?.id ?? "";
  const org = run.metadata?.org ?? "";
  const target = run.spec?.target;
  const sessionId = target?.case === "sessionId" ? target.value : "";
  const createdAt = listIndexInstant(status.audit?.specAudit?.createdAt);
  const outputs: OutputConversion[] = [];
  retiredMessages(unknown, STATUS_ARTIFACTS_FIELD).forEach((bytes, position) => {
    let name = "";
    let storageKey = "";
    let kind = 0;
    eachField(bytes, (no, wireType, reader) => {
      if (no === ARTIFACT_KIND && wireType === WireType.Varint) {
        kind = reader.int32();
        return true;
      }
      if (wireType !== WireType.LengthDelimited) {
        return false;
      }
      if (no === ARTIFACT_NAME) {
        name = reader.string();
      } else if (no === ARTIFACT_STORAGE_KEY) {
        storageKey = reader.string();
      } else {
        return false;
      }
      return true;
    });
    if (kind === KIND_FILE) {
      outputs.push({ runId, org, sessionId, position, name, storageKey, createdAt });
    }
  });
  dropRetired(status, STATUS_ARTIFACTS_FIELD);
  return { data: toBinary(RunSchema, run), outputs };
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableRunArtifactsRowError(id: string, error: unknown): Error {
  return new Error(
    `run '${id}' cannot be read to turn its stored files into Files: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}
