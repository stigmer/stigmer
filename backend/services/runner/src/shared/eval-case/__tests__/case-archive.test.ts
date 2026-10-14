/**
 * Pins how a try reads its case from the plugin's archive
 * (`case-archive.ts`): the archive at the eval's digest is fetched, verified
 * and indexed by cleaned path; a plugin that cannot be read, moved past the
 * eval's version, records no archive, cannot be fetched, holds no bytes or
 * serves bytes of another digest is refused with a sentence naming why.
 */

import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalCaseContextSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/eval_case_pb";
import { buildZip } from "@stigmer/zip-structure/testing";
import { describe, expect, it } from "vitest";
import type { StigmerClient } from "../../../client/stigmer-client.js";
import { caseArchiveOf, CaseArchiveError, fetchCaseArchive } from "../case-archive.js";

const ARCHIVE = buildZip([
  { name: "evals/fix/case.yaml", content: "name: fix\n" },
  { name: "evals/fix/resources/b.md", content: "B" },
  { name: "evals/fix/resources/a.md", content: "A" },
]);
const DIGEST = createHash("sha256").update(ARCHIVE).digest("hex");

const context = (digest = DIGEST) => create(EvalCaseContextSchema, { pluginId: "plg_1", pluginDigest: digest });

const pluginRecord = (status: { digest?: string; artifactStorageKey?: string }): Plugin =>
  create(PluginSchema, { status: { digest: DIGEST, artifactStorageKey: "plugins/abc.zip", ...status } });

/** A client whose download lane is absent, so the unary read answers with `bytes`. */
function clientServing(fields: {
  plugin?: () => Promise<Plugin>;
  bytes?: Uint8Array;
  fetchError?: Error;
}): StigmerClient {
  return {
    getPlugin: fields.plugin ?? (() => Promise.resolve(pluginRecord({}))),
    getPluginArtifactDownloadUrl: () => Promise.reject(fields.fetchError ?? new ConnectError("no lane", Code.Unimplemented)),
    getPluginArtifact: () => Promise.resolve({ artifact: fields.bytes ?? ARCHIVE }),
  } as unknown as StigmerClient;
}

describe("fetchCaseArchive", () => {
  it("indexes the verified archive's files by path", async () => {
    const archive = await fetchCaseArchive(clientServing({}), context());
    expect(archive.text("evals/fix/case.yaml")).toBe("name: fix\n");
    expect(archive.under("evals/fix/resources").map(([path]) => path)).toEqual(["a.md", "b.md"]);
  });

  it.each([
    ["the plugin cannot be read", { plugin: () => Promise.reject(new Error("not found")) }, context(), "the plugin could not be read (not found)"],
    ["the read fails with a non-error", { plugin: () => Promise.reject("gone") }, context(), "the plugin could not be read (gone)"],
    ["the plugin moved past the eval", {}, context("b".repeat(64)), "the plugin has moved past the eval's version"],
    ["the plugin records no archive", { plugin: () => Promise.resolve(pluginRecord({ artifactStorageKey: "" })) }, context(), "the plugin records no archive"],
    ["the fetch fails", { fetchError: new Error("connection reset") }, context(), "the archive could not be fetched (connection reset)"],
    ["the server holds no bytes", { bytes: new Uint8Array() }, context(), "the server holds no archive for the plugin"],
    ["the bytes are another version's", { bytes: buildZip([{ name: "x", content: "y" }]) }, context(), "the fetched archive does not match the eval's version"],
  ] as const)("refuses when %s", async (_why, fields, ctx, detail) => {
    const refused = fetchCaseArchive(clientServing(fields), ctx);
    await expect(refused).rejects.toBeInstanceOf(CaseArchiveError);
    await expect(refused).rejects.toThrow(`the eval run's case could not be read: ${detail}`);
  });

  it("refuses a plugin whose status carries no digest", async () => {
    const client = clientServing({ plugin: () => Promise.resolve(create(PluginSchema, {})) });
    await expect(fetchCaseArchive(client, context())).rejects.toThrow("the plugin has moved past the eval's version");
  });
});

describe("caseArchiveOf", () => {
  it("answers undefined for a path the archive lacks", () => {
    const archive = caseArchiveOf([]);
    expect([archive.read("a"), archive.text("a"), archive.under("a")]).toEqual([undefined, undefined, []]);
  });
});
