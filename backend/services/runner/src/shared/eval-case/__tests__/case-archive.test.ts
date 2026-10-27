/**
 * Pins how a try reads its case from its source's archive
 * (`case-archive.ts`): the archive at the eval's digest is fetched, verified
 * and indexed by cleaned path; a plugin that cannot be read, moved past the
 * eval's version, records no archive, cannot be fetched, holds no bytes or
 * serves bytes of another digest is refused with a sentence naming why. An
 * Eval's archive is read through the run's own door, under the run's
 * scoped credential, never via a plugin and never by the reference when
 * the door answers (stigmer#2364); inline when the door says the server
 * has no transfer lane (`FailedPrecondition`); by the reference at the
 * stamped digest only when the server predates the door (`Unimplemented`),
 * that read itself over its URL or inline; refused naming the Eval when
 * the door or the read is (a refusal of the door never falls back), when
 * it holds no bytes, or when the bytes are another version's. The index
 * answers the root (`""`) with every file, an Eval's suite being its root.
 */

import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalCaseContextSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/eval_case_pb";
import { buildZip } from "@stigmer/zip-structure/testing";
import { describe, expect, it } from "vitest";
import type { StigmerClient } from "../../../client/stigmer-client.js";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { caseArchiveOf, CaseArchiveError, fetchCaseArchive, joinCasePath } from "../case-archive.js";

const ARCHIVE = buildZip([
  { name: "evals/fix/case.yaml", content: "name: fix\n" },
  { name: "evals/fix/resources/b.md", content: "B" },
  { name: "evals/fix/resources/a.md", content: "A" },
]);
const DIGEST = createHash("sha256").update(ARCHIVE).digest("hex");

const RUN_ID = "run_1";
const SCOPED = "scoped-run-token";

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
    const archive = await fetchCaseArchive(clientServing({}), context(), RUN_ID);
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
    const refused = fetchCaseArchive(clientServing(fields), ctx, RUN_ID);
    await expect(refused).rejects.toBeInstanceOf(CaseArchiveError);
    await expect(refused).rejects.toThrow(`the eval run's case could not be read: ${detail}`);
  });

  it("refuses a plugin whose status carries no digest", async () => {
    const client = clientServing({ plugin: () => Promise.resolve(create(PluginSchema, {})) });
    await expect(fetchCaseArchive(client, context(), RUN_ID)).rejects.toThrow("the plugin has moved past the eval's version");
  });
});

const EVAL_ID = "evs_1";
const evalContext = (digest = DIGEST) => create(EvalCaseContextSchema, { evalId: EVAL_ID, evalDigest: digest, caseDir: "fix" });

/**
 * A client serving an Eval's reads, recording the references they named
 * and the door's asks; `getPlugin` is never asked. The door answers as
 * `door` says, by default as a server that predates it.
 */
function evalClient(fields: {
  door?: () => Promise<{ url: string; sizeBytes: bigint }>;
  mint?: () => Promise<{ url: string; sizeBytes: bigint }>;
  inline?: () => Promise<{ artifact: Uint8Array }>;
  refs?: Array<{ id: string; version: string; kind: number }>;
  doorAsks?: Array<[string, string | undefined]>;
}): StigmerClient {
  const record = (ref: { id: string; version: string; kind: number }) => fields.refs?.push({ id: ref.id, version: ref.version, kind: ref.kind });
  return {
    getPlugin: () => Promise.reject(new Error("an Eval's case reads no plugin")),
    acquireScopedRunnerToken: ({ agentExecutionId }: { agentExecutionId: string }) =>
      Promise.resolve(agentExecutionId === RUN_ID ? SCOPED : undefined),
    getRunEvalCaseArchiveDownloadUrl: (runId: string, scopedToken?: string) => {
      fields.doorAsks?.push([runId, scopedToken]);
      return (fields.door ?? (() => Promise.reject(new ConnectError("no door", Code.Unimplemented))))();
    },
    getEvalDownloadUrl: (ref: { id: string; version: string; kind: number }) => {
      record(ref);
      return (fields.mint ?? (() => Promise.reject(new ConnectError("no lane", Code.FailedPrecondition))))();
    },
    downloadEval: (ref: { id: string; version: string; kind: number }) => {
      record(ref);
      return (fields.inline ?? (() => Promise.resolve({ artifact: ARCHIVE })))();
    },
  } as unknown as StigmerClient;
}

const dataUrl = (bytes: Uint8Array): string => `data:application/zip;base64,${Buffer.from(bytes).toString("base64")}`;

describe("fetchCaseArchive for an Eval's case", () => {
  it("reads the case through the run's door under its scoped credential, never by the reference", async () => {
    const refs: Array<{ id: string; version: string; kind: number }> = [];
    const doorAsks: Array<[string, string | undefined]> = [];
    const client = evalClient({
      door: () => Promise.resolve({ url: dataUrl(ARCHIVE), sizeBytes: BigInt(ARCHIVE.length) }),
      refs,
      doorAsks,
    });
    const archive = await fetchCaseArchive(client, evalContext(), RUN_ID);
    expect(archive.text("evals/fix/case.yaml")).toBe("name: fix\n");
    expect(doorAsks).toEqual([[RUN_ID, SCOPED]]);
    expect(refs).toEqual([]);
  });

  it("reads it inline by the reference when the door says the server has no transfer lane", async () => {
    const refs: Array<{ id: string; version: string; kind: number }> = [];
    const client = evalClient({ door: () => Promise.reject(new ConnectError("no lane", Code.FailedPrecondition)), refs });
    const archive = await fetchCaseArchive(client, evalContext(), RUN_ID);
    expect(archive.text("evals/fix/case.yaml")).toBe("name: fix\n");
    expect(refs).toEqual([{ id: EVAL_ID, version: DIGEST, kind: ApiResourceKind.eval }]);
  });

  it("reads the Eval at its stamped digest over the download URL when the server predates the door", async () => {
    const refs: Array<{ id: string; version: string; kind: number }> = [];
    const client = evalClient({ mint: () => Promise.resolve({ url: dataUrl(ARCHIVE), sizeBytes: BigInt(ARCHIVE.length) }), refs });
    const archive = await fetchCaseArchive(client, evalContext(), RUN_ID);
    expect(archive.text("evals/fix/case.yaml")).toBe("name: fix\n");
    expect(refs).toEqual([{ id: EVAL_ID, version: DIGEST, kind: ApiResourceKind.eval }]);
  });

  it("never falls back past the door's refusal", async () => {
    const refs: Array<{ id: string; version: string; kind: number }> = [];
    const client = evalClient({
      door: () => Promise.reject(new ConnectError("only the runner acting for this run may fetch its eval case", Code.PermissionDenied)),
      refs,
    });
    const refused = fetchCaseArchive(client, evalContext(), RUN_ID);
    await expect(refused).rejects.toBeInstanceOf(CaseArchiveError);
    await expect(refused).rejects.toThrow(`eval ${EVAL_ID} could not be read ([permission_denied] only the runner acting for this run`);
    expect(refs).toEqual([]);
  });

  it.each([
    ["has no transfer lane", Code.FailedPrecondition],
    ["predates the transfer lane", Code.Unimplemented],
  ])("reads it inline when a server that predates the door %s", async (_why, code) => {
    const client = evalClient({ mint: () => Promise.reject(new ConnectError("no lane", code)) });
    const archive = await fetchCaseArchive(client, evalContext(), RUN_ID);
    expect(archive.under("evals/fix/resources").map(([path]) => path)).toEqual(["a.md", "b.md"]);
  });

  it.each([
    [
      "the read is refused",
      { mint: () => Promise.reject(new ConnectError("unauthorized to get eval", Code.PermissionDenied)) },
      `eval ${EVAL_ID} could not be read ([permission_denied] unauthorized to get eval)`,
    ],
    ["the server holds no bytes", { inline: () => Promise.resolve({ artifact: new Uint8Array() }) }, `the server holds no archive for eval ${EVAL_ID}`],
    [
      "the bytes are another version's",
      { inline: () => Promise.resolve({ artifact: buildZip([{ name: "x", content: "y" }]) }) },
      "the fetched archive does not match the eval's version",
    ],
  ] as const)("refuses when %s, naming the Eval", async (_why, fields, detail) => {
    const refused = fetchCaseArchive(evalClient(fields), evalContext(), RUN_ID);
    await expect(refused).rejects.toBeInstanceOf(CaseArchiveError);
    await expect(refused).rejects.toThrow(`the eval run's case could not be read: ${detail}`);
  });
});

describe("caseArchiveOf", () => {
  it("answers undefined for a path the archive lacks", () => {
    const archive = caseArchiveOf([]);
    expect([archive.read("a"), archive.text("a"), archive.under("a")]).toEqual([undefined, undefined, []]);
  });

  it("answers the root with every file, an Eval's suite being its archive's root", () => {
    const archive = caseArchiveOf([
      { path: "fix/prompt.md", content: new Uint8Array([1]) },
      { path: "mocks/billing/refund.md", content: new Uint8Array([2]) },
    ]);
    expect(archive.under("").map(([path]) => path)).toEqual(["fix/prompt.md", "mocks/billing/refund.md"]);
  });
});

describe("joinCasePath", () => {
  it("joins under a directory, and names a root path as itself", () => {
    expect([joinCasePath("evals", "mocks/x.md"), joinCasePath("", "mocks/x.md")]).toEqual(["evals/mocks/x.md", "mocks/x.md"]);
  });
});
