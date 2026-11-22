/**
 * The skill and plugin file reads through the real stack: a composed server,
 * a native gRPC client, the interceptor chain and the local blob driver.
 *
 * Pins what a reader of one file is held to on both kinds: the version is
 * the resource's own (its head or its history; a hash another resource
 * carries answers NotFound, so a hash learned elsewhere opens nothing),
 * the path is matched exactly, the eval suite is never served, a file over
 * 8 MB is refused with the sentence that says why, and a version pushed
 * before indexes existed reads once its index is built on first read. A
 * skill whose head lost its hash (its version failed to archive) still
 * reads its stored archive through an empty version.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildZip } from "@stigmer/zip-structure/testing";
import { claudePlugin } from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";
import { writeArchive } from "../write.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "acme";

let server: ComposedServer;
let skills: Client<typeof SkillCommandController>;
let skillQuery: Client<typeof SkillQueryController>;
let plugins: Client<typeof PluginCommandController>;
let pluginQuery: Client<typeof PluginQueryController>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "serve-files-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  await seedOrganizations(transport, [ORG]);
  skills = createClient(SkillCommandController, transport);
  skillQuery = createClient(SkillQueryController, transport);
  plugins = createClient(PluginCommandController, transport);
  pluginQuery = createClient(PluginQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
const unique = (prefix: string): string => `${prefix}-${(counter += 1)}`;
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Text that deflates about 6:1, so a large file stays inside the push's ratio cap. */
function filler(size: number): string {
  const chunks: string[] = [];
  let seed = 11;
  let length = 0;
  while (length < size) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const word = (seed % 100000).toString(36);
    chunks.push(word);
    length += word.length;
  }
  return chunks.join("").slice(0, size);
}

function skillZip(name: string, files: Array<{ name: string; content: string; method?: "stored" | "deflated" }> = []): Uint8Array {
  return buildZip([{ name: "SKILL.md", content: `---\nname: ${name}\ndescription: d\n---\nbody of ${name}` }, ...files]);
}

async function codeOf(call: Promise<unknown>): Promise<{ code: Code; message: string }> {
  try {
    await call;
  } catch (error) {
    const connect = ConnectError.from(error);
    return { code: connect.code, message: connect.rawMessage };
  }
  throw new Error("expected the call to be refused");
}

function archiveOf(fixture: PluginFixture): Uint8Array {
  return writeArchive([...fixture.entries()].map(([filePath, content]) => ({
    path: filePath,
    bytes: typeof content === "string" ? new TextEncoder().encode(content) : content,
  })));
}

describe("skill files", () => {
  it("lists a version's files and reads one, its bytes matching the listing's hash", async () => {
    const name = unique("notes");
    const skill = await skills.push({ org: ORG, artifact: skillZip(name, [{ name: "scripts/run.sh", content: "echo hi", method: "deflated" }]) });
    const id = skill.metadata!.id;
    const listed = await skillQuery.listFiles({ skillId: id, versionHash: skill.status!.versionHash });
    expect(listed.files.map((file) => [file.path, file.executable])).toEqual([["SKILL.md", false], ["scripts/run.sh", true]]);

    const read = await skillQuery.readFile({ skillId: id, versionHash: skill.status!.versionHash, path: "scripts/run.sh" });
    expect(text(read.content)).toBe("echo hi");
    expect(sha(read.content)).toBe(listed.files[1]!.sha256);
    expect(listed.files[1]!.sizeBytes).toBe(7n);
  });

  it("reads an earlier version from the skill's history, and an empty version as the head", async () => {
    const name = unique("versions");
    const first = await skills.push({ org: ORG, artifact: skillZip(name, [{ name: "a.md", content: "first" }]) });
    const second = await skills.push({ org: ORG, artifact: skillZip(name, [{ name: "a.md", content: "second" }]) });
    const id = second.metadata!.id;
    expect(text((await skillQuery.readFile({ skillId: id, versionHash: first.status!.versionHash, path: "a.md" })).content)).toBe("first");
    expect(text((await skillQuery.readFile({ skillId: id, versionHash: "", path: "a.md" })).content)).toBe("second");
  });

  it("refuses a version that is not the skill's own, even one another skill holds", async () => {
    const mine = await skills.push({ org: ORG, artifact: skillZip(unique("mine")) });
    const other = await skills.push({ org: ORG, artifact: skillZip(unique("other"), [{ name: "secret.md", content: "s" }]) });
    const refused = await codeOf(
      skillQuery.readFile({ skillId: mine.metadata!.id, versionHash: other.status!.versionHash, path: "secret.md" }),
    );
    expect(refused.code).toBe(Code.NotFound);
    expect(refused.message).toBe(`skill version not found: ${mine.metadata!.slug}:${other.status!.versionHash}`);
    expect((await codeOf(skillQuery.listFiles({ skillId: mine.metadata!.id, versionHash: other.status!.versionHash }))).code).toBe(Code.NotFound);
  });

  it("matches a path exactly: a path the index does not hold, however close, is not found", async () => {
    const skill = await skills.push({ org: ORG, artifact: skillZip(unique("exact"), [{ name: "refs/a.md", content: "a" }]) });
    const id = skill.metadata!.id;
    for (const near of ["./refs/a.md", "refs//a.md", "/refs/a.md", "refs/x/../a.md", "REFS/a.md", "refs"]) {
      expect((await codeOf(skillQuery.readFile({ skillId: id, versionHash: "", path: near }))).code, near).toBe(Code.NotFound);
    }
  });

  it("never serves a plugin's eval suite from its root skill, and keeps a lone skill's own evals/", async () => {
    const root = await skills.push({
      org: ORG,
      artifact: buildZip([
        { name: "SKILL.md", content: `---\nname: ${unique("root")}\ndescription: d\n---\nb` },
        { name: ".claude-plugin/plugin.json", content: JSON.stringify({ name: "p" }) },
        { name: "evals/case/prompt.md", content: "graded case" },
      ]),
    });
    const listed = await skillQuery.listFiles({ skillId: root.metadata!.id, versionHash: "" });
    expect(listed.files.map((file) => file.path)).not.toContain("evals/case/prompt.md");
    expect((await codeOf(skillQuery.readFile({ skillId: root.metadata!.id, versionHash: "", path: "evals/case/prompt.md" }))).code).toBe(Code.NotFound);

    const lone = await skills.push({ org: ORG, artifact: skillZip(unique("lone"), [{ name: "evals/evals.json", content: "{}" }]) });
    expect(text((await skillQuery.readFile({ skillId: lone.metadata!.id, versionHash: "", path: "evals/evals.json" })).content)).toBe("{}");
  });

  it("refuses a file over 8 MB with the sentence that says how to read it", async () => {
    const name = unique("large");
    const skill = await skills.push({ org: ORG, artifact: skillZip(name, [{ name: "data/big.txt", content: filler(8 * 1024 * 1024 + 1), method: "deflated" }]) });
    const refused = await codeOf(skillQuery.readFile({ skillId: skill.metadata!.id, versionHash: "", path: "data/big.txt" }));
    expect(refused).toEqual({
      code: Code.FailedPrecondition,
      message: `'data/big.txt' in skill '${name}' is larger than 8 MB; an agent reads files this large with a computer`,
    });
  });

  it("builds a missing index on first read, as for a version pushed before indexes existed", async () => {
    const skill = await skills.push({ org: ORG, artifact: skillZip(unique("old"), [{ name: "a.md", content: "kept" }]) });
    const indexFile = path.join(dir, "storage", "skill-indexes", "v1", `${skill.status!.versionHash}.json`);
    expect(existsSync(indexFile), "the push stored the index").toBe(true);
    rmSync(indexFile);
    expect(text((await skillQuery.readFile({ skillId: skill.metadata!.id, versionHash: "", path: "a.md" })).content)).toBe("kept");
  });

  it("reads a head whose hash was cleared through an empty version, from its stored archive", async () => {
    const skill = await skills.push({ org: ORG, artifact: skillZip(unique("hashless"), [{ name: "a.md", content: "still here" }]) });
    const stored = await server.store.getResource(ApiResourceKind.skill, skill.metadata!.id, SkillSchema);
    const hashless = clone(SkillSchema, stored);
    hashless.status!.versionHash = "";
    await server.store.saveResource(ApiResourceKind.skill, skill.metadata!.id, SkillSchema, hashless);
    expect(text((await skillQuery.readFile({ skillId: skill.metadata!.id, versionHash: "", path: "a.md" })).content)).toBe("still here");
  });

  it("answers an unknown skill NotFound", async () => {
    expect((await codeOf(skillQuery.listFiles({ skillId: "skl_missing", versionHash: "" }))).code).toBe(Code.NotFound);
  });
});

describe("plugin files", () => {
  it("lists and reads a version's files, never its eval suite", async () => {
    const name = unique("kit");
    const plugin = await plugins.push({
      org: ORG,
      artifact: archiveOf(claudePlugin({
        name,
        skills: [{ name: "review", body: "review body", files: { "refs/style.md": "style" } }],
        files: { "evals/basic/prompt.md": "graded case", "hooks/check": "#!/bin/sh\nexit 0\n" },
      })),
    });
    const id = plugin.metadata!.id;
    const digest = plugin.status!.digest;
    const listed = await pluginQuery.listFiles({ pluginId: id, digest });
    const paths = listed.files.map((file) => file.path);
    expect(paths).toContain("skills/review/refs/style.md");
    expect(paths).not.toContain("evals/basic/prompt.md");
    expect(listed.files.find((file) => file.path === "hooks/check")?.executable).toBe(true);
    expect(text((await pluginQuery.readFile({ pluginId: id, digest, path: "skills/review/refs/style.md" })).content)).toBe("style");
    expect((await codeOf(pluginQuery.readFile({ pluginId: id, digest, path: "evals/basic/prompt.md" }))).code).toBe(Code.NotFound);
  });

  it("refuses a digest that is not the plugin's own", async () => {
    const a = await plugins.push({ org: ORG, artifact: archiveOf(claudePlugin({ name: unique("a") })) });
    const b = await plugins.push({ org: ORG, artifact: archiveOf(claudePlugin({ name: unique("b") })) });
    expect((await codeOf(pluginQuery.listFiles({ pluginId: a.metadata!.id, digest: b.status!.digest }))).code).toBe(Code.NotFound);
  });

  it("refuses a missing or malformed digest before reading anything", async () => {
    const a = await plugins.push({ org: ORG, artifact: archiveOf(claudePlugin({ name: unique("c") })) });
    expect((await codeOf(pluginQuery.listFiles({ pluginId: a.metadata!.id, digest: "" }))).code).toBe(Code.InvalidArgument);
  });
});
