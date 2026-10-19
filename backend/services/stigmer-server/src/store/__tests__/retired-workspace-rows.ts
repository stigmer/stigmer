/**
 * Test support: the bytes an earlier release wrote for a session's
 * workspace entries (SessionSpec field 6), a routine's (AgentInvocation
 * field 4) and a run's attachments (RunSpec field 9), built by wire number
 * because the current schema reserves those fields. Shared by the module's
 * unit test and both drivers' migration tests, so every one reads the same
 * old shape (../workspace-becomes-resources.ts), and the one scenario both
 * drivers' migration step runs: the rows a database held before it, what
 * each becomes, and the conversion rows it writes.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { DescMessage, MessageInitShape, MessageShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { stampEtag } from "../etag.js";
import type { AttachmentConversion } from "../file-blobs.js";

/** A retired GitRepoSource. */
export interface RetiredGitRepo {
  readonly url: string;
  readonly branch?: string;
  readonly commit?: string;
  readonly depth?: number;
  readonly writeBackMode?: number;
  readonly token?: string;
}

/** A retired WorkspaceEntry: a name and one source. */
export interface RetiredWorkspaceEntry {
  readonly name: string;
  readonly gitRepo?: RetiredGitRepo;
  readonly localPath?: string;
}

/** A retired Attachment. */
export interface RetiredAttachment {
  readonly filename: string;
  readonly storageKey: string;
  readonly mountPath?: string;
  readonly contentType?: string;
  readonly extract?: boolean;
  readonly localPath?: string;
}

function lengthDelimited(w: BinaryWriter, no: number, bytes: Uint8Array): void {
  w.tag(no, WireType.LengthDelimited).bytes(bytes);
}

function text(w: BinaryWriter, no: number, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    w.tag(no, WireType.LengthDelimited).string(value);
  }
}

/** One WorkspaceEntry{name=1, source=2 WorkspaceSource{git_repo=1, local_path=2}} as a release wrote it. */
export function retiredEntryBytes(entry: RetiredWorkspaceEntry): Uint8Array {
  const source = new BinaryWriter();
  if (entry.gitRepo !== undefined) {
    const git = new BinaryWriter();
    text(git, 1, entry.gitRepo.url);
    text(git, 2, entry.gitRepo.branch);
    text(git, 3, entry.gitRepo.commit);
    if (entry.gitRepo.depth !== undefined) {
      git.tag(4, WireType.Varint).int32(entry.gitRepo.depth);
    }
    if (entry.gitRepo.writeBackMode !== undefined && entry.gitRepo.writeBackMode !== 0) {
      git.tag(5, WireType.Varint).int32(entry.gitRepo.writeBackMode);
    }
    text(git, 6, entry.gitRepo.token);
    lengthDelimited(source, 1, git.finish());
  }
  if (entry.localPath !== undefined) {
    const local = new BinaryWriter();
    text(local, 1, entry.localPath);
    lengthDelimited(source, 2, local.finish());
  }
  const w = new BinaryWriter();
  text(w, 1, entry.name);
  lengthDelimited(w, 2, source.finish());
  return w.finish();
}

/** One Attachment{filename=1, storage_key=2, mount_path=3, content_type=4, extract=5, local_path=6}. */
export function retiredAttachmentBytes(attachment: RetiredAttachment): Uint8Array {
  const w = new BinaryWriter();
  text(w, 1, attachment.filename);
  text(w, 2, attachment.storageKey);
  text(w, 3, attachment.mountPath);
  text(w, 4, attachment.contentType);
  if (attachment.extract === true) {
    w.tag(5, WireType.Varint).bool(true);
  }
  text(w, 6, attachment.localPath);
  return w.finish();
}

/** The unknown-field entries a decoder keeps for repeated message field `no`. */
function retired(no: number, payloads: readonly Uint8Array[]) {
  return payloads.map((payload) => ({
    no,
    wireType: WireType.LengthDelimited,
    data: new BinaryWriter().bytes(payload).finish(),
  }));
}

/** A session row whose spec held `entries` at field 6. */
export function sessionRowWithEntries(
  init: MessageInitShape<typeof SessionSchema>,
  entries: readonly RetiredWorkspaceEntry[],
): Uint8Array {
  const session = create(SessionSchema, init);
  const spec = session.spec;
  if (spec === undefined) {
    throw new Error("the fixture needs a session spec");
  }
  spec.$unknown = [...(spec.$unknown ?? []), ...retired(6, entries.map(retiredEntryBytes))];
  return toBinary(SessionSchema, session);
}

/** A routine row whose `spec.agent` held `entries` at field 4. */
export function routineRowWithEntries(
  init: MessageInitShape<typeof RoutineSchema>,
  entries: readonly RetiredWorkspaceEntry[],
): Uint8Array {
  const routine = create(RoutineSchema, init);
  const agent = routine.spec?.agent;
  if (agent === undefined) {
    throw new Error("the fixture needs a routine agent invocation");
  }
  agent.$unknown = [...(agent.$unknown ?? []), ...retired(4, entries.map(retiredEntryBytes))];
  return toBinary(RoutineSchema, routine);
}

/** A run row whose spec held `attachments` at field 9. */
export function runRowWithAttachments(
  init: MessageInitShape<typeof RunSchema>,
  attachments: readonly RetiredAttachment[],
): Uint8Array {
  const run = create(RunSchema, init);
  const spec = run.spec;
  if (spec === undefined) {
    throw new Error("the fixture needs a run spec");
  }
  spec.$unknown = [...(spec.$unknown ?? []), ...retired(9, attachments.map(retiredAttachmentBytes))];
  return toBinary(RunSchema, run);
}

// =============================================================================
// The migration step's scenario
// =============================================================================

/** One stored row: its kind column, its id and its bytes. */
export interface WorkspaceStepRow {
  readonly kind: string;
  readonly id: string;
  readonly data: Uint8Array;
}

const STEP_ORG = "org_01kworkspacestep0000000000";
const STEP_SEALED = "sealed:v1:c3RlcC10b2tlbg==";
const STEP_CREATED_AT = new Date("2026-09-30T12:00:00.500Z");

function stampedBytes<Desc extends DescMessage>(schema: Desc, row: MessageShape<Desc>): Uint8Array {
  stampEtag(schema, row);
  return toBinary(schema, row);
}

const stepSession = {
  metadata: { id: "ses_step", org: STEP_ORG, slug: "ses-step", etag: "stale-etag" },
  spec: { subject: "Ship it" },
};
const stepRoutine = {
  metadata: { id: "rtn_step", org: STEP_ORG, slug: "nightly", etag: "stale-etag" },
  spec: { cron: "0 9 * * *", agent: { agentRef: { org: STEP_ORG, id: "agt_helper" }, message: "Triage." } },
};
const stepRun = {
  metadata: { id: "run_step", org: STEP_ORG, etag: "stale-etag" },
  spec: { target: { case: "sessionId" as const, value: "ses_step" } },
  status: { audit: { specAudit: { createdAt: timestampFromDate(STEP_CREATED_AT) } } },
};
const quietSession = toBinary(
  SessionSchema,
  create(SessionSchema, { metadata: { id: "ses_quiet", org: STEP_ORG, etag: "kept" }, spec: { subject: "Nothing to move" } }),
);
const quietRun = toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_quiet", org: STEP_ORG }, spec: {} }));

/** The rows a database held before the step. */
export const WORKSPACE_STEP_ROWS: readonly WorkspaceStepRow[] = [
  {
    kind: "session",
    id: "ses_step",
    data: sessionRowWithEntries(stepSession, [
      {
        name: "app",
        gitRepo: {
          url: "https://github.com/acme/app",
          branch: "main",
          depth: 1,
          writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
          token: STEP_SEALED,
        },
      },
      { name: "notes", localPath: "/home/ana/notes" },
    ]),
  },
  { kind: "session", id: "ses_quiet", data: quietSession },
  {
    kind: "routine",
    id: "rtn_step",
    data: routineRowWithEntries(stepRoutine, [{ name: "app", gitRepo: { url: "https://github.com/acme/app", commit: "abc123" } }]),
  },
  {
    kind: "run",
    id: "run_step",
    data: runRowWithAttachments(stepRun, [
      { filename: "plan.md", storageKey: "attachments/01step/plan.md", contentType: "text/markdown" },
      { filename: "logs.zip", storageKey: "attachments/01step/logs.zip", extract: true },
    ]),
  },
  { kind: "run", id: "run_quiet", data: quietRun },
];

/** What each row holds after the step: the bytes the current release writes for it. */
export const WORKSPACE_STEP_EXPECTED: ReadonlyMap<string, Uint8Array> = new Map([
  [
    "ses_step",
    stampedBytes(
      SessionSchema,
      create(SessionSchema, {
        ...stepSession,
        spec: {
          ...stepSession.spec,
          resources: [
            {
              name: "app",
              resource: {
                case: "gitRepository",
                value: {
                  url: "https://github.com/acme/app",
                  branch: "main",
                  writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
                  token: STEP_SEALED,
                },
              },
            },
            { name: "notes", resource: { case: "localPath", value: { path: "/home/ana/notes" } } },
          ],
        },
      }),
    ),
  ],
  ["ses_quiet", quietSession],
  [
    "rtn_step",
    stampedBytes(
      RoutineSchema,
      create(RoutineSchema, {
        ...stepRoutine,
        spec: {
          ...stepRoutine.spec,
          agent: {
            ...stepRoutine.spec.agent,
            resources: [
              { name: "app", resource: { case: "gitRepository", value: { url: "https://github.com/acme/app", commit: "abc123" } } },
            ],
          },
        },
      }),
    ),
  ],
  ["run_step", stampedBytes(RunSchema, create(RunSchema, stepRun))],
  ["run_quiet", quietRun],
]);

/** The conversion rows the step writes, by run then position. */
export const WORKSPACE_STEP_CONVERSIONS: readonly AttachmentConversion[] = [
  {
    runId: "run_step",
    position: 0,
    org: STEP_ORG,
    sessionId: "ses_step",
    filename: "plan.md",
    storageKey: "attachments/01step/plan.md",
    contentType: "text/markdown",
    createdAt: "2026-09-30T12:00:00.500000000Z",
  },
  {
    runId: "run_step",
    position: 1,
    org: STEP_ORG,
    sessionId: "ses_step",
    filename: "logs.zip",
    storageKey: "attachments/01step/logs.zip",
    contentType: "",
    createdAt: "2026-09-30T12:00:00.500000000Z",
  },
];

/** A conversion row read raw, in the record's shape. */
export function conversionOfRow(row: Record<string, unknown>): AttachmentConversion {
  return {
    runId: String(row.run_id),
    position: Number(row.position),
    org: String(row.org),
    sessionId: String(row.session_id),
    filename: String(row.filename),
    storageKey: String(row.storage_key),
    contentType: String(row.content_type),
    createdAt: String(row.created_at),
  };
}
