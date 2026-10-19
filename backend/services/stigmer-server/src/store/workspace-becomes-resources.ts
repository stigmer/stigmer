/**
 * The data migration that turns a conversation's workspace entries into
 * its resources, and a run's attachments into Files (SQLite v44, Postgres
 * v40): what one row becomes, said once for both drivers, which own the
 * SQL, the pages and the transaction.
 *
 *   - Sessions. SessionSpec field 6 (`workspace_entries`, now reserved)
 *     held `WorkspaceEntry{name=1, source=2 WorkspaceSource{oneof
 *     git_repo=1, local_path=2}}`. Each entry becomes one
 *     `SessionResource` in `spec.resources` (field 22), appended after any
 *     resource the row already holds, its name kept: a git source becomes
 *     `git_repository` and a local path `local_path`. `GitRepoSource` and
 *     `GitRepositoryResource` number their fields alike (url 1, branch 2,
 *     commit 3, write_back_mode 5, token 6), so those fields are read
 *     straight off the stored bytes and the token stays sealed exactly as
 *     it was stored; `depth` (4) is reserved in the new message and is
 *     dropped.
 *   - Routines. A routine's `spec.agent` (an AgentInvocation) held the same
 *     entries at field 4, now reserved; they move to its `resources`
 *     (field 9) the same way.
 *   - Runs. RunSpec field 9 (`attachments`, now reserved) held
 *     `Attachment{filename=1, storage_key=2, mount_path=3, content_type=4,
 *     extract=5, local_path=6}`: bytes uploaded for one message. They
 *     leave the run, and each is lifted as one conversion record for the
 *     file domain to make into a File of the run's conversation; the
 *     driver stores the records in `file_conversions` in the same
 *     transaction as the rewritten run.
 *
 * The retired fields are read by wire number, never through a schema that
 * no longer exists (session-harness-state-moved.ts, the precedent). Every
 * rewritten row that held an etag is re-stamped, as the routine rename
 * re-stamps a relabelled run (schedules-become-routines.ts): the etag
 * covers the spec's JSON, which this step changes. A row without the
 * retired field is left byte for byte as it is (undefined). Only live rows
 * are rewritten: sessions, routines and runs write no audit snapshots.
 * `updated_at` is left alone: no list key reads these fields.
 *
 * An undecodable row, or an entry that names no source, fails the step:
 * the driver's transaction rolls back and the boot stops on the row it
 * names.
 *
 * Pinned by __tests__/workspace-becomes-resources.test.ts and both
 * drivers' migration arms.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape, UnknownField } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  GitRepositoryResourceSchema,
  LocalPathResourceSchema,
  SessionResourceSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";

import { stampEtag, storedEtagOf } from "./etag.js";
import type { AttachmentConversion } from "./file-blobs.js";
import { listIndexInstant } from "./list-index.js";

/** The `kind` column values of the rows the step rewrites. */
export const WORKSPACE_SESSION_KIND = "session";
export const WORKSPACE_ROUTINE_KIND = "routine";
export const WORKSPACE_RUN_KIND = "run";

/** How many rows the step decodes per page. */
export const WORKSPACE_RESOURCES_PAGE_SIZE = 200;

/** SessionSpec's retired workspace_entries. */
const SESSION_ENTRIES_FIELD = 6;

/** AgentInvocation's retired workspace_entries. */
const INVOCATION_ENTRIES_FIELD = 4;

/** RunSpec's retired attachments. */
const RUN_ATTACHMENTS_FIELD = 9;

/** WorkspaceEntry, WorkspaceSource and GitRepoSource field numbers. */
const ENTRY_NAME = 1;
const ENTRY_SOURCE = 2;
const SOURCE_GIT_REPO = 1;
const SOURCE_LOCAL_PATH = 2;
const GIT_REPO_DEPTH = 4;

/** Attachment field numbers. */
const ATTACHMENT_FILENAME = 1;
const ATTACHMENT_STORAGE_KEY = 2;
const ATTACHMENT_CONTENT_TYPE = 4;

/** A run row without its attachments, and the attachments it held. */
export interface LiftedRunAttachments {
  readonly data: Uint8Array;
  readonly attachments: readonly AttachmentConversion[];
}

/** Calls `visit` for each field of `bytes`, skipping those it does not take. */
function eachField(bytes: Uint8Array, visit: (no: number, wireType: WireType, reader: BinaryReader) => boolean): void {
  const reader = new BinaryReader(bytes);
  while (reader.pos < reader.len) {
    const [no, wireType] = reader.tag();
    if (!visit(no, wireType, reader)) {
      reader.skip(wireType, no);
    }
  }
}

/** The payloads of the retired repeated message field `no` held in `unknown`. */
function retiredMessages(unknown: readonly UnknownField[], no: number): Uint8Array[] {
  return unknown
    .filter((field) => field.no === no && field.wireType === WireType.LengthDelimited)
    .map((field) => new BinaryReader(field.data).bytes());
}

/** `unknown` without field `no`; undefined when nothing is left. */
function without(unknown: readonly UnknownField[], no: number): UnknownField[] | undefined {
  const kept = unknown.filter((field) => field.no !== no);
  return kept.length === 0 ? undefined : kept;
}

/** One retired WorkspaceEntry as the resource that replaces it. Throws when it names no source. */
function resourceOfEntry(entry: Uint8Array): SessionResource {
  let name = "";
  let source: Uint8Array | undefined;
  eachField(entry, (no, wireType, reader) => {
    if (wireType !== WireType.LengthDelimited) {
      return false;
    }
    if (no === ENTRY_NAME) {
      name = reader.string();
      return true;
    }
    if (no === ENTRY_SOURCE) {
      source = reader.bytes();
      return true;
    }
    return false;
  });
  let resource: SessionResource["resource"] | undefined;
  if (source !== undefined) {
    eachField(source, (no, wireType, reader) => {
      if (wireType !== WireType.LengthDelimited) {
        return false;
      }
      if (no === SOURCE_GIT_REPO) {
        const git = fromBinary(GitRepositoryResourceSchema, reader.bytes());
        const kept = without(git.$unknown ?? [], GIT_REPO_DEPTH);
        if (kept === undefined) {
          delete git.$unknown;
        } else {
          git.$unknown = kept;
        }
        resource = { case: "gitRepository", value: git };
        return true;
      }
      if (no === SOURCE_LOCAL_PATH) {
        resource = { case: "localPath", value: fromBinary(LocalPathResourceSchema, reader.bytes()) };
        return true;
      }
      return false;
    });
  }
  if (resource === undefined) {
    throw new Error(`the workspace entry '${name}' names no git repository or local path`);
  }
  return create(SessionResourceSchema, { name, resource });
}

/** Re-stamps a rewritten row's etag when it holds one, and encodes it. */
function restamped<Desc extends DescMessage>(schema: Desc, row: MessageShape<Desc>): Uint8Array {
  if ((storedEtagOf(schema, row) ?? "") !== "") {
    stampEtag(schema, row);
  }
  return toBinary(schema, row);
}

/**
 * The migrated bytes of one session row, or undefined when its spec holds
 * no workspace entry. Throws when the bytes do not decode.
 */
export function migrateSessionResourcesRow(data: Uint8Array): Uint8Array | undefined {
  const session = fromBinary(SessionSchema, data);
  const spec = session.spec;
  const unknown = spec?.$unknown ?? [];
  if (spec === undefined || !unknown.some((field) => field.no === SESSION_ENTRIES_FIELD)) {
    return undefined;
  }
  spec.resources.push(...retiredMessages(unknown, SESSION_ENTRIES_FIELD).map(resourceOfEntry));
  const kept = without(unknown, SESSION_ENTRIES_FIELD);
  if (kept === undefined) {
    delete spec.$unknown;
  } else {
    spec.$unknown = kept;
  }
  return restamped(SessionSchema, session);
}

/**
 * The migrated bytes of one routine row, or undefined when its agent
 * invocation holds no workspace entry. Throws when the bytes do not decode.
 */
export function migrateRoutineResourcesRow(data: Uint8Array): Uint8Array | undefined {
  const routine = fromBinary(RoutineSchema, data);
  const agent = routine.spec?.agent;
  const unknown = agent?.$unknown ?? [];
  if (agent === undefined || !unknown.some((field) => field.no === INVOCATION_ENTRIES_FIELD)) {
    return undefined;
  }
  agent.resources.push(...retiredMessages(unknown, INVOCATION_ENTRIES_FIELD).map(resourceOfEntry));
  const kept = without(unknown, INVOCATION_ENTRIES_FIELD);
  if (kept === undefined) {
    delete agent.$unknown;
  } else {
    agent.$unknown = kept;
  }
  return restamped(RoutineSchema, routine);
}

/**
 * The run row without its attachments and the attachments it held, in
 * order; undefined when it holds none. Throws when the bytes do not
 * decode.
 */
export function liftRunAttachments(data: Uint8Array): LiftedRunAttachments | undefined {
  const run = fromBinary(RunSchema, data);
  const spec = run.spec;
  const unknown = spec?.$unknown ?? [];
  if (spec === undefined || !unknown.some((field) => field.no === RUN_ATTACHMENTS_FIELD)) {
    return undefined;
  }
  const runId = run.metadata?.id ?? "";
  const org = run.metadata?.org ?? "";
  const sessionId = spec.target.case === "sessionId" ? spec.target.value : "";
  const createdAt = listIndexInstant(run.status?.audit?.specAudit?.createdAt);
  const attachments = retiredMessages(unknown, RUN_ATTACHMENTS_FIELD).map((bytes, position): AttachmentConversion => {
    let filename = "";
    let storageKey = "";
    let contentType = "";
    eachField(bytes, (no, wireType, reader) => {
      if (wireType !== WireType.LengthDelimited) {
        return false;
      }
      if (no === ATTACHMENT_FILENAME) {
        filename = reader.string();
      } else if (no === ATTACHMENT_STORAGE_KEY) {
        storageKey = reader.string();
      } else if (no === ATTACHMENT_CONTENT_TYPE) {
        contentType = reader.string();
      } else {
        return false;
      }
      return true;
    });
    return { runId, org, sessionId, position, filename, storageKey, contentType, createdAt };
  });
  const kept = without(unknown, RUN_ATTACHMENTS_FIELD);
  if (kept === undefined) {
    delete spec.$unknown;
  } else {
    spec.$unknown = kept;
  }
  return { data: restamped(RunSchema, run), attachments };
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableWorkspaceRowError(kind: string, id: string, error: unknown): Error {
  return new Error(
    `${kind} '${id}' cannot be read to turn its workspace entries into resources: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}
