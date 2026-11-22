/**
 * The file-serving rules under faults, which a composed server cannot make
 * happen on demand: a store that fails rather than misses, a version with no
 * archive at all, an archive gone from storage, and bytes that no longer
 * read. A miss is NotFound naming the resource; anything else is an
 * Internal that names no storage key.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { AuditNotFoundError, ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { ArtifactNotFoundError } from "../content-store.js";
import type { ArchiveFileEntry, ArchiveFileIndex } from "../file-index.js";
import type { ArchiveFileReads } from "../file-reads.js";
import { listServedFiles, loadServedResource, readServedFile, resolveServedVersion } from "../serve-files.js";
import type { ServedArchiveBinding, ServedVersion } from "../serve-files.js";

const binding: ServedArchiveBinding<typeof SkillSchema> = {
  kind: ApiResourceKind.skill,
  schema: SkillSchema,
  noun: "skill",
  headHashOf: (skill) => skill.status?.versionHash ?? "",
  storageKeyOf: (skill) => skill.status?.artifactStorageKey ?? "",
  suiteDirOf: () => undefined,
  keyForHash: (hash) => `skills/${hash}.zip`,
  nameOf: (skill) => skill.metadata?.slug ?? "",
};

const HASH = "a".repeat(64);
const entry: ArchiveFileEntry = { path: "a.md", size: 1, sha256: "b".repeat(64), executable: false, method: 0, offset: 0, storedSize: 1, crc32: 0 };
const index: ArchiveFileIndex = { format: 1, files: [entry], suiteDirs: [] };
const version: ServedVersion = { hash: HASH, storageKey: `skills/${HASH}.zip`, hiddenDirs: [], named: "notes" };

function storeThat(overrides: Partial<Store>): Store {
  return overrides as Store;
}

function readsThat(overrides: Partial<ArchiveFileReads>): ArchiveFileReads {
  return { index: async () => index, read: async () => new Uint8Array([1]), ...overrides };
}

async function refusal(call: Promise<unknown>): Promise<{ code: Code; message: string }> {
  try {
    await call;
  } catch (error) {
    const connect = ConnectError.from(error);
    return { code: connect.code, message: connect.rawMessage };
  }
  throw new Error("expected a refusal");
}

describe("the serving rules under faults", () => {
  it("answers a missing resource NotFound and passes any other store fault through", async () => {
    const missing = storeThat({ getResource: async () => Promise.reject(new ResourceNotFoundError("skl_x")) });
    expect(await refusal(loadServedResource(missing, binding, "skl_x"))).toEqual({ code: Code.NotFound, message: "skill not found: skl_x" });
    const broken = storeThat({ getResource: async () => Promise.reject(new Error("database is locked")) });
    await expect(loadServedResource(broken, binding, "skl_x")).rejects.toThrow("database is locked");
  });

  it("answers a history the store cannot read as Internal, never as a missing version", async () => {
    const head = create(SkillSchema, { metadata: { slug: "notes" }, status: { versionHash: HASH, artifactStorageKey: `skills/${HASH}.zip` } });
    const broken = storeThat({ getAuditRecordByHash: async () => Promise.reject(new Error("database is locked")) });
    expect((await refusal(resolveServedVersion(broken, binding, head, "skl_1", "c".repeat(64)))).code).toBe(Code.Internal);
    const missing = storeThat({ getAuditRecordByHash: async () => Promise.reject(new AuditNotFoundError("none")) });
    expect((await refusal(resolveServedVersion(missing, binding, head, "skl_1", "c".repeat(64)))).code).toBe(Code.NotFound);
  });

  it("serves a version with no archive as no files, and any read of it as not found", async () => {
    const head = create(SkillSchema, { metadata: { slug: "notes" }, status: { versionHash: HASH, artifactStorageKey: "" } });
    const none = await resolveServedVersion(storeThat({}), binding, head, "skl_1", "");
    expect(none.hash).toBe("");
    expect(await listServedFiles(readsThat({}), "skill", none)).toEqual([]);
    expect(await refusal(readServedFile(readsThat({}), "skill", none, "SKILL.md"))).toEqual({ code: Code.NotFound, message: "skill file not found: notes/SKILL.md" });
  });

  it("answers an archive gone from storage NotFound, and an index or a read that fails Internal, naming no key", async () => {
    const gone = readsThat({ index: async () => Promise.reject(new ArtifactNotFoundError(`skills/${HASH}.zip`)) });
    expect(await refusal(listServedFiles(gone, "skill", version))).toEqual({ code: Code.NotFound, message: "skill archive not found: notes" });

    const failing = readsThat({ index: async () => Promise.reject(new Error("checksum")) });
    const listed = await refusal(listServedFiles(failing, "skill", version));
    expect(listed.code).toBe(Code.Internal);
    expect(listed.message).not.toContain("skills/");

    const unreadable = readsThat({ read: async () => Promise.reject(new Error("zip: checksum error")) });
    const read = await refusal(readServedFile(unreadable, "skill", version, "a.md"));
    expect(read.code).toBe(Code.Internal);
    expect(read.message).not.toContain("skills/");
  });
});
