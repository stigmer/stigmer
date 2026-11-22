/**
 * Pins RecordAgentWarnings (../skill-warnings.ts) over the SQLite store,
 * with file reads that answer each archive's index by its hash:
 *   - an agent without a computer is warned once per skill whose files
 *     hold an executable entry: its own skill references, and each skill of
 *     its plugins whose folder holds one ("<plugin>:<skill>"); a skill or a
 *     plugin skill without one is not;
 *   - an agent with a computer carries no warning, and a save that gives it
 *     one clears what an earlier save recorded;
 *   - the eval suite's files never count, as listFiles never serves them;
 *   - a skill that is gone or whose index cannot be read costs its warning
 *     alone, and the save goes on;
 *   - the step writes status only: the spec it hashes is untouched.
 */
import { clone, create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentWarningSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArchiveFileEntry, ArchiveFileIndex } from "../../../archive/file-index.js";
import { FILE_INDEX_FORMAT } from "../../../archive/file-index.js";
import type { ArchiveFileReads } from "../../../archive/file-reads.js";
import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SKILL_SCRIPTS_WARNING_KIND, newRecordAgentWarningsStep, skillScriptsWarningMessage } from "../skill-warnings.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "org_01warnwarnwarnwarnwarnwa";

const SCRIPTED = "a".repeat(64);
const PLAIN = "b".repeat(64);
const SUITE_ONLY = "c".repeat(64);
const PLUGIN = "d".repeat(64);
const UNREADABLE = "e".repeat(64);

function entry(path: string, executable = false): ArchiveFileEntry {
  return { path, size: 1, sha256: "0".repeat(64), executable, method: 0, offset: 0, storedSize: 1, crc32: 0 };
}

const INDEXES: ReadonlyMap<string, ArchiveFileIndex> = new Map([
  [SCRIPTED, { format: FILE_INDEX_FORMAT, files: [entry("SKILL.md"), entry("scripts/run.sh", true)], suiteDirs: [] }],
  [PLAIN, { format: FILE_INDEX_FORMAT, files: [entry("SKILL.md"), entry("reference.md")], suiteDirs: [] }],
  [SUITE_ONLY, { format: FILE_INDEX_FORMAT, files: [entry("SKILL.md"), entry("evals/grade.sh", true)], suiteDirs: ["evals"] }],
  [
    PLUGIN,
    {
      format: FILE_INDEX_FORMAT,
      files: [entry("skills/deploy/SKILL.md"), entry("skills/deploy/bin/ship", true), entry("skills/notes/SKILL.md")],
      suiteDirs: [],
    },
  ],
]);

const reads: ArchiveFileReads = {
  index: async (hash) => {
    const index = INDEXES.get(hash);
    if (index === undefined) throw new Error(`no index for ${hash}`);
    return index;
  },
  read: () => Promise.reject(new Error("the step reads no file's bytes")),
};

let fx: TempStore;

beforeEach(async () => {
  fx = tempStore();
  for (const [id, hash] of [
    ["skl_01scripted", SCRIPTED],
    ["skl_01plain", PLAIN],
    ["skl_01suite", SUITE_ONLY],
    ["skl_01unreadable", UNREADABLE],
  ] as const) {
    await fx.store.saveResource(
      ApiResourceKind.skill,
      id,
      SkillSchema,
      create(SkillSchema, {
        metadata: { id, org: ORG, slug: id.slice(6), name: id.slice(6) },
        status: { versionHash: hash, artifactStorageKey: `skills/${hash}.zip` },
      }),
    );
  }
  await fx.store.saveResource(
    ApiResourceKind.plugin,
    "plg_01ops",
    PluginSchema,
    create(PluginSchema, {
      metadata: { id: "plg_01ops", org: ORG, slug: "ops", name: "ops" },
      status: {
        digest: PLUGIN,
        artifactStorageKey: `plugins/${PLUGIN}.zip`,
        skills: [
          { name: "deploy", path: "skills/deploy" },
          { name: "notes", path: "skills/notes" },
        ],
      },
    }),
  );
});

afterEach(async () => {
  await fx.cleanup();
});

function agentWith(computer: Computer, skills: readonly string[], plugins: readonly string[] = []): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_01warn", org: ORG, slug: "helper", name: "helper" },
    spec: {
      instructions: "help",
      computer,
      skillRefs: skills.map((id) => ({ kind: ApiResourceKind.skill, id })),
      plugins: plugins.map((id) => ({ kind: ApiResourceKind.plugin, id })),
    },
  });
}

async function save(agent: Agent): Promise<Agent> {
  const ctx = new RequestContext(AgentSchema, agent, testCallerIdentity(), ApiResourceKind.agent);
  ctx.setNewState(agent);
  await newRecordAgentWarningsStep(fx.store, { skill: reads, plugin: reads }, silentLogger).execute(ctx);
  return ctx.newState;
}

const warning = (skill: string) =>
  create(AgentWarningSchema, { kind: SKILL_SCRIPTS_WARNING_KIND, message: skillScriptsWarningMessage(skill), skill });

describe("RecordAgentWarnings", () => {
  it("warns an agent without a computer once per skill with scripts, its plugins' included", async () => {
    const saved = await save(agentWith(Computer.NONE, ["skl_01scripted", "skl_01plain"], ["plg_01ops"]));
    expect(saved.status?.warnings).toEqual([warning("scripted"), warning("ops:deploy")]);
  });

  it("warns an agent with a computer of nothing, and clears what an earlier save recorded", async () => {
    const agent = agentWith(Computer.REQUIRED, ["skl_01scripted"], ["plg_01ops"]);
    agent.status = { $typeName: "ai.stigmer.agentic.agent.v1.AgentStatus", versionHash: "", warnings: [warning("scripted")] };
    expect((await save(agent)).status?.warnings).toEqual([]);
  });

  it("never counts the eval suite's files", async () => {
    expect((await save(agentWith(Computer.NONE, ["skl_01suite"]))).status?.warnings).toEqual([]);
  });

  it("goes on past a skill that is gone or whose files cannot be read", async () => {
    const saved = await save(agentWith(Computer.NONE, ["skl_01gone", "skl_01unreadable", "skl_01scripted"]));
    expect(saved.status?.warnings).toEqual([warning("scripted")]);
  });

  it("goes on past a plugin that is gone or whose files cannot be read, and leaves an agent with no spec as it is", async () => {
    await fx.store.saveResource(
      ApiResourceKind.plugin,
      "plg_01broken",
      PluginSchema,
      create(PluginSchema, {
        metadata: { id: "plg_01broken", org: ORG, slug: "broken", name: "broken" },
        status: { digest: UNREADABLE, artifactStorageKey: `plugins/${UNREADABLE}.zip`, skills: [{ name: "x", path: "skills/x" }] },
      }),
    );
    expect((await save(agentWith(Computer.NONE, ["skl_01scripted"], ["plg_01broken"]))).status?.warnings, "an unreadable plugin costs itself alone").toEqual([warning("scripted")]);
    expect((await save(agentWith(Computer.NONE, ["skl_01scripted"], ["plg_01gone"]))).status?.warnings, "a plugin that cannot be loaded costs the plugins alone").toEqual([warning("scripted")]);
    const bare = create(AgentSchema, { metadata: { id: "agt_01bare", org: ORG } });
    expect((await save(bare)).status).toBeUndefined();
  });

  it("keeps its skills' warnings when the store cannot load its plugins", async () => {
    const faulty = new Proxy(fx.store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop !== "getResource" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
        return (kind: ApiResourceKind, ...rest: unknown[]) =>
          kind === ApiResourceKind.plugin ? Promise.reject(new Error("store down")) : (value as (...args: unknown[]) => unknown).call(target, kind, ...rest);
      },
    });
    const agent = agentWith(Computer.NONE, ["skl_01scripted"], ["plg_01ops"]);
    const ctx = new RequestContext(AgentSchema, agent, testCallerIdentity(), ApiResourceKind.agent);
    ctx.setNewState(agent);
    await newRecordAgentWarningsStep(faulty, { skill: reads, plugin: reads }, silentLogger).execute(ctx);
    expect(ctx.newState.status?.warnings).toEqual([warning("scripted")]);
  });

  it("writes status only: the spec it hashes is untouched", async () => {
    const agent = agentWith(Computer.NONE, ["skl_01scripted"], ["plg_01ops"]);
    const before = clone(AgentSchema, agent).spec;
    expect((await save(agent)).spec).toEqual(before);
  });
});
