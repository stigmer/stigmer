/**
 * Pins how an eval reads its plugin's archive (suite.ts): the live head's
 * digest and an archived version's both read their recorded archive; a
 * digest that is no version of the plugin, or a plugin that does not
 * exist, is NOT_FOUND before any archive is read; an archive whose bytes
 * do not hash to the version is refused; a version that recorded no key
 * reads its content-addressed key; `loadEvalSuite` hands the files it read
 * to the library's reader and returns both.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import { ArtifactNotFoundError } from "../../../archive/content-store.js";
import { writeArchive } from "../../../archive/write.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { loadEvalSuite, newPluginArchiveReader } from "../suite.js";

const encoder = new TextEncoder();

function archiveOf(files: Record<string, string>): { bytes: Uint8Array; digest: string } {
  const bytes = writeArchive(
    Object.entries(files).map(([path, content]) => ({
      path,
      bytes: encoder.encode(content),
    })),
  );
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}

/** An in-memory archive store keyed as the plugin store keys (`plugins/<digest>.zip`). */
function memoryArchives(): ContentAddressedArchiveStore & { reads: string[] } {
  const blobs = new Map<string, Uint8Array>();
  const reads: string[] = [];
  return {
    reads,
    getStorageKey: (hash) => `plugins/${hash}.zip`,
    async store(hash, data) {
      blobs.set(`plugins/${hash}.zip`, data);
      return `plugins/${hash}.zip`;
    },
    async get(key) {
      reads.push(key);
      const blob = blobs.get(key);
      if (blob === undefined) {
        throw new ArtifactNotFoundError(key);
      }
      return blob;
    },
    async exists(hash) {
      return blobs.has(`plugins/${hash}.zip`);
    },
    async size(key) {
      return blobs.get(key)?.length ?? 0;
    },
  };
}

function pluginAt(digest: string, artifactStorageKey: string) {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "plg_1", org: "org_1", name: "thermos" }),
    status: create(PluginStatusSchema, { digest, artifactStorageKey }),
  });
}

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("newPluginArchiveReader", () => {
  it("reads the head's and an archived version's archives, and nothing else", async () => {
    const v1 = archiveOf({ "evals/a/prompt.md": "first" });
    const v2 = archiveOf({ "evals/a/prompt.md": "second" });
    const archives = memoryArchives();
    await archives.store(v1.digest, v1.bytes);
    await archives.store(v2.digest, v2.bytes);
    await temp.store.saveAudit(
      ApiResourceKind.plugin,
      "plg_1",
      PluginSchema,
      pluginAt(v1.digest, `plugins/${v1.digest}.zip`),
      v1.digest,
      "",
    );
    await temp.store.saveResource(
      ApiResourceKind.plugin,
      "plg_1",
      PluginSchema,
      pluginAt(v2.digest, `plugins/${v2.digest}.zip`),
    );
    const reader = newPluginArchiveReader({ store: temp.store, archives });

    const head = await reader.readArchive("plg_1", v2.digest);
    expect(new TextDecoder().decode(head.read("evals/a/prompt.md"))).toBe("second");
    const archived = await reader.readArchive("plg_1", v1.digest);
    expect(new TextDecoder().decode(archived.read("evals/a/prompt.md"))).toBe("first");

    const other = archiveOf({ "evals/b/prompt.md": "another plugin's" });
    await archives.store(other.digest, other.bytes);
    archives.reads.length = 0;
    const foreign = await reader.readArchive("plg_1", other.digest).catch((e: unknown) => e);
    expect(foreign).toBeInstanceOf(ConnectError);
    expect((foreign as ConnectError).code).toBe(Code.NotFound);
    const missing = await reader.readArchive("plg_absent", v1.digest).catch((e: unknown) => e);
    expect((missing as ConnectError).code).toBe(Code.NotFound);
    expect(archives.reads).toEqual([]);
  });

  it("reads the content-addressed key when the version recorded none", async () => {
    const v1 = archiveOf({ "evals/a/prompt.md": "first" });
    const archives = memoryArchives();
    await archives.store(v1.digest, v1.bytes);
    await temp.store.saveResource(
      ApiResourceKind.plugin,
      "plg_1",
      PluginSchema,
      pluginAt(v1.digest, ""),
    );
    const reader = newPluginArchiveReader({ store: temp.store, archives });
    await reader.readArchive("plg_1", v1.digest);
    expect(archives.reads).toEqual([`plugins/${v1.digest}.zip`]);
  });

  it("refuses an archive whose bytes are not the version's", async () => {
    const v1 = archiveOf({ "evals/a/prompt.md": "first" });
    const swapped = archiveOf({ "evals/a/prompt.md": "swapped" });
    const archives = memoryArchives();
    await archives.store(v1.digest, swapped.bytes);
    await temp.store.saveResource(
      ApiResourceKind.plugin,
      "plg_1",
      PluginSchema,
      pluginAt(v1.digest, `plugins/${v1.digest}.zip`),
    );
    const reader = newPluginArchiveReader({ store: temp.store, archives });
    await expect(reader.readArchive("plg_1", v1.digest)).rejects.toThrow(
      /does not hash to version/,
    );
  });
});

describe("loadEvalSuite", () => {
  it("reads the suite from the version's archive", async () => {
    const v1 = archiveOf({
      "evals/first-case/prompt.md": "Look over my diff.\n",
      "evals/first-case/graders/criteria.md":
        "---\ntype: llm\n---\n\nPASS if the reply names the bug.\n",
    });
    const archives = memoryArchives();
    await archives.store(v1.digest, v1.bytes);
    await temp.store.saveResource(
      ApiResourceKind.plugin,
      "plg_1",
      PluginSchema,
      pluginAt(v1.digest, `plugins/${v1.digest}.zip`),
    );
    const loaded = await loadEvalSuite(
      newPluginArchiveReader({ store: temp.store, archives }),
      "plg_1",
      v1.digest,
    );
    expect(loaded.files.entries.map((e) => e.path)).toContain(
      "evals/first-case/prompt.md",
    );
    expect(loaded.suite.dir).toBe("evals");
    expect(loaded.suite.cases.map((c) => [c.name, c.prompt.trim(), c.graders.length])).toEqual([
      ["first-case", "Look over my diff.", 1],
    ]);
  });
});
