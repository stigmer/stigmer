/**
 * Pins workspace-becomes-resources.ts: what one stored session, routine or
 * run becomes when workspace entries become resources and attachments
 * become Files.
 *
 *   - a session's git and local entries become resources in order, name,
 *     url, branch, commit, write-back mode and the sealed token kept as
 *     stored, depth dropped, the etag re-stamped, every other field kept;
 *   - entries land after the resources a row already holds, and a spec
 *     field no release defined is kept;
 *   - a routine's entries move inside its agent invocation the same way;
 *   - a run's attachments leave it as conversion records naming its
 *     conversation, position and spec creation instant;
 *   - a row without the retired field is left alone (undefined);
 *   - bytes that do not decode, or an entry with no source, throw, and the
 *     step's error names the row;
 *   - fields no release defined are carried or skipped, never refused: in
 *     an entry and its source they are skipped, a git source's own are kept
 *     beside the dropped depth, and an invocation's or a run spec's are
 *     kept.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { etagOf, stampEtag } from "../etag.js";
import {
  liftRunAttachments,
  migrateRoutineResourcesRow,
  migrateSessionResourcesRow,
  unreadableWorkspaceRowError,
} from "../workspace-becomes-resources.js";
import {
  routineRowWithEntries,
  runRowWithAttachments,
  sessionRowWithEntries,
} from "./retired-workspace-rows.js";
import type { RetiredWorkspaceEntry } from "./retired-workspace-rows.js";

const ORG = "org_01kworkspace0000000000000000";
const SEALED = "sealed:v1:QUJDREVGR0hJSktMTU5PUA==";

const entries: RetiredWorkspaceEntry[] = [
  {
    name: "app",
    gitRepo: {
      url: "https://github.com/acme/app",
      branch: "main",
      commit: "0123abcd",
      depth: 3,
      writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
      token: SEALED,
    },
  },
  { name: "notes", localPath: "/Users/ana/notes" },
];

type ResourceInit = MessageInitShape<typeof SessionResourceSchema>;

/** The resource the git entry becomes, holding `token`. */
function gitResource(token: string): ResourceInit {
  return {
    name: "app",
    resource: {
      case: "gitRepository",
      value: {
        url: "https://github.com/acme/app",
        branch: "main",
        commit: "0123abcd",
        writeBackMode: GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR,
        token,
      },
    },
  };
}

const resources: ResourceInit[] = [
  gitResource(SEALED),
  { name: "notes", resource: { case: "localPath", value: { path: "/Users/ana/notes" } } },
];

const conversation = {
  metadata: { id: "ses_1", org: ORG, slug: "ses-1", etag: "stale-etag" },
  spec: {
    agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: "helper" },
    subject: "Fix the build",
  },
  status: { harnessStateId: "thread-1" },
};

/** The bytes the current release writes for `init`, its etag stamped. */
function stamped<T extends typeof SessionSchema | typeof RoutineSchema | typeof RunSchema>(
  schema: T,
  init: MessageInitShape<T>,
): Uint8Array {
  const row = create(schema, init);
  stampEtag(schema, row);
  return toBinary(schema, row);
}

describe("migrateSessionResourcesRow", () => {
  it("turns git and local entries into resources, the sealed token kept as stored and depth dropped", () => {
    const migrated = migrateSessionResourcesRow(sessionRowWithEntries(conversation, entries));
    expect(migrated).toEqual(stamped(SessionSchema, { ...conversation, spec: { ...conversation.spec, resources } }));

    const session = fromBinary(SessionSchema, migrated!);
    const git = session.spec?.resources[0]?.resource;
    expect(git?.case === "gitRepository" ? git.value.token : undefined).toBe(SEALED);
    expect(session.spec?.$unknown).toBeUndefined();
    expect(session.metadata?.etag).toBe(etagOf(SessionSchema, session));
    expect(session.metadata?.etag).not.toBe("stale-etag");
  });

  it("appends after the resources a row already holds, keeping a spec field no release defined", () => {
    const held: ResourceInit = { resource: { case: "file", value: { fileId: "file_01held", mountPath: "a.txt" } } };
    const before = fromBinary(
      SessionSchema,
      sessionRowWithEntries({ ...conversation, spec: { ...conversation.spec, resources: [held] } }, entries.slice(1)),
    );
    before.spec!.$unknown!.push({ no: 99, wireType: WireType.LengthDelimited, data: new Uint8Array([3, 0x61, 0x62, 0x63]) });

    const migrated = fromBinary(SessionSchema, migrateSessionResourcesRow(toBinary(SessionSchema, before))!);
    expect(migrated.spec?.resources).toEqual([
      create(SessionResourceSchema, held),
      create(SessionResourceSchema, resources[1]),
    ]);
    expect(migrated.spec?.$unknown?.map((field) => field.no)).toEqual([99]);
  });

  it("leaves a session without entries alone, a spec-less one included", () => {
    expect(migrateSessionResourcesRow(toBinary(SessionSchema, create(SessionSchema, conversation)))).toBeUndefined();
    expect(migrateSessionResourcesRow(toBinary(SessionSchema, create(SessionSchema, { metadata: conversation.metadata })))).toBeUndefined();
  });

  it("re-stamps no etag on a row that held none", () => {
    const unstamped = { ...conversation, metadata: { ...conversation.metadata, etag: "" } };
    const migrated = fromBinary(SessionSchema, migrateSessionResourcesRow(sessionRowWithEntries(unstamped, entries))!);
    expect(migrated.metadata?.etag).toBe("");
    expect(migrated.spec?.resources).toHaveLength(2);
  });

  it("refuses an entry that names no source, and bytes that do not decode", () => {
    expect(() => migrateSessionResourcesRow(sessionRowWithEntries(conversation, [{ name: "empty" }]))).toThrow(
      "the workspace entry 'empty' names no git repository or local path",
    );
    expect(() => migrateSessionResourcesRow(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
    expect(unreadableWorkspaceRowError("session", "ses_broken", new Error("bad")).message).toBe(
      "session 'ses_broken' cannot be read to turn its workspace entries into resources: bad",
    );
  });
});

describe("migrateRoutineResourcesRow", () => {
  const routine = {
    metadata: { id: "rtn_1", org: ORG, slug: "nightly", etag: "stale-etag" },
    spec: {
      cron: "0 9 * * *",
      agent: { agentRef: { org: ORG, id: "agt_helper" }, message: "Triage the issues." },
    },
  };

  it("moves the agent invocation's entries to its resources, etag re-stamped", () => {
    const gitOnly = [{ ...entries[0]!, gitRepo: { ...entries[0]!.gitRepo!, token: undefined } }];
    const migrated = migrateRoutineResourcesRow(routineRowWithEntries(routine, gitOnly));
    expect(migrated).toEqual(
      stamped(RoutineSchema, {
        ...routine,
        spec: { ...routine.spec, agent: { ...routine.spec.agent, resources: [gitResource("")] } },
      }),
    );
  });

  it("leaves a routine without entries alone", () => {
    expect(migrateRoutineResourcesRow(toBinary(RoutineSchema, create(RoutineSchema, routine)))).toBeUndefined();
    expect(migrateRoutineResourcesRow(toBinary(RoutineSchema, create(RoutineSchema, { metadata: routine.metadata })))).toBeUndefined();
  });
});

describe("liftRunAttachments", () => {
  const createdAt = new Date("2026-10-01T08:30:00.250Z");
  const run = {
    metadata: { id: "run_1", org: ORG, etag: "stale-etag" },
    spec: { target: { case: "sessionId" as const, value: "ses_1" } },
    status: { audit: { specAudit: { createdAt: timestampFromDate(createdAt) } } },
  };

  it("lifts every attachment as a conversion record and leaves the run without them, etag re-stamped", () => {
    const lifted = liftRunAttachments(
      runRowWithAttachments(run, [
        { filename: "report.pdf", storageKey: "attachments/01a/report.pdf", contentType: "application/pdf", mountPath: "docs" },
        { filename: "data.zip", storageKey: "attachments/01b/data.zip", extract: true, localPath: "/tmp/data.zip" },
      ]),
    );
    expect(lifted?.attachments).toEqual([
      {
        runId: "run_1",
        org: ORG,
        sessionId: "ses_1",
        position: 0,
        filename: "report.pdf",
        storageKey: "attachments/01a/report.pdf",
        contentType: "application/pdf",
        createdAt: "2026-10-01T08:30:00.250000000Z",
      },
      {
        runId: "run_1",
        org: ORG,
        sessionId: "ses_1",
        position: 1,
        filename: "data.zip",
        storageKey: "attachments/01b/data.zip",
        contentType: "",
        createdAt: "2026-10-01T08:30:00.250000000Z",
      },
    ]);
    expect(lifted?.data).toEqual(stamped(RunSchema, run));
  });

  it("names no conversation or instant the run does not hold", () => {
    const bare = { metadata: { id: "run_2", org: ORG }, spec: {} };
    const lifted = liftRunAttachments(runRowWithAttachments(bare, [{ filename: "a.txt", storageKey: "attachments/01c/a.txt" }]));
    expect(lifted?.attachments.map((a) => [a.sessionId, a.createdAt])).toEqual([["", ""]]);
    expect(lifted?.data).toEqual(toBinary(RunSchema, create(RunSchema, bare)));
  });

  it("leaves a run without attachments alone", () => {
    expect(liftRunAttachments(toBinary(RunSchema, create(RunSchema, run)))).toBeUndefined();
    expect(liftRunAttachments(toBinary(RunSchema, create(RunSchema, { metadata: run.metadata })))).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => liftRunAttachments(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
  });
});

describe("fields no release defined", () => {
  /** The numbers of the unknown fields a message kept. */
  const unknownNumbers = (message: { $unknown?: Array<{ no: number }> } | undefined): number[] =>
    (message?.$unknown ?? []).map((field) => field.no);

  it("skips them in an entry and its source, and keeps a git source's own beside the dropped depth", () => {
    const git = new BinaryWriter();
    git.tag(1, WireType.LengthDelimited).string("https://github.com/acme/app");
    git.tag(4, WireType.Varint).int32(3);
    git.tag(9, WireType.LengthDelimited).string("kept");
    const source = new BinaryWriter();
    source.tag(1, WireType.LengthDelimited).bytes(git.finish());
    source.tag(3, WireType.Varint).int32(1);
    source.tag(4, WireType.LengthDelimited).string("future source");
    const entry = new BinaryWriter();
    entry.tag(1, WireType.LengthDelimited).string("app");
    entry.tag(7, WireType.Varint).int32(1);
    entry.tag(8, WireType.LengthDelimited).string("future entry");
    entry.tag(2, WireType.LengthDelimited).bytes(source.finish());

    const session = create(SessionSchema, conversation);
    session.spec!.$unknown = [
      { no: 6, wireType: WireType.LengthDelimited, data: new BinaryWriter().bytes(entry.finish()).finish() },
    ];
    const migrated = migrateSessionResourcesRow(toBinary(SessionSchema, session));
    const resource = fromBinary(SessionSchema, migrated!).spec?.resources[0];
    expect(resource?.name).toBe("app");
    expect(resource?.resource.case).toBe("gitRepository");
    const repo = resource?.resource.case === "gitRepository" ? resource.resource.value : undefined;
    expect(repo?.url).toBe("https://github.com/acme/app");
    expect(unknownNumbers(repo), "depth goes, the git source's own field stays").toEqual([9]);
  });

  it("keeps an invocation's own beside its moved entries", () => {
    const routine = fromBinary(
      RoutineSchema,
      routineRowWithEntries(
        { metadata: { id: "rtn_2", org: ORG }, spec: { agent: { message: "Triage." } } },
        [{ name: "notes", localPath: "/Users/ana/notes" }],
      ),
    );
    routine.spec!.agent!.$unknown = [
      ...(routine.spec!.agent!.$unknown ?? []),
      { no: 99, wireType: WireType.Varint, data: new BinaryWriter().int32(1).finish() },
    ];
    const migrated = fromBinary(RoutineSchema, migrateRoutineResourcesRow(toBinary(RoutineSchema, routine))!);
    expect(migrated.spec?.agent?.resources.map((r) => r.name)).toEqual(["notes"]);
    expect(unknownNumbers(migrated.spec?.agent)).toEqual([99]);
  });

  it("keeps a run spec's own beside its lifted attachments", () => {
    const run = fromBinary(
      RunSchema,
      runRowWithAttachments({ metadata: { id: "run_3", org: ORG }, spec: {} }, [
        { filename: "a.txt", storageKey: "attachments/01d/a.txt" },
      ]),
    );
    run.spec!.$unknown = [
      ...(run.spec!.$unknown ?? []),
      { no: 99, wireType: WireType.Varint, data: new BinaryWriter().int32(1).finish() },
    ];
    const lifted = liftRunAttachments(toBinary(RunSchema, run));
    expect(lifted?.attachments).toHaveLength(1);
    expect(unknownNumbers(fromBinary(RunSchema, lifted!.data).spec)).toEqual([99]);
  });
});
