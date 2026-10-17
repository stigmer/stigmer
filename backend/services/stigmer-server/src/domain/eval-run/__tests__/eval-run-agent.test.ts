/**
 * Composed-server round-trips for eval runs about an agent: a real server
 * over a temp SQLite store with no engine behind it, raw Connect clients,
 * plugins pushed as the CLI pushes them and agents created as the CLI
 * creates them. Pins: create mints the eval run's own id, stamps the agent
 * version's hash (by default the current one, by tag or by hash when named)
 * and every plugin a try loads with its digest, whether attached and
 * compared, the reason a plugin's cases do not run (not selected, no cases
 * at this version), the planned tries, and with no engine to start its
 * workflow answers the eval run failed with the reason. With a plugin
 * compared, attached or not, only its cases run and both arms are planned;
 * named case sources choose whose cases run. Create refuses an eval run
 * naming no subject, an agent's fields on an eval run of a plugin, an agent
 * version with nothing whose cases could run, a case source no try loads,
 * an eval run none of whose plugins has cases, an organization that is not
 * the agent's, a version the agent does not hold, a missing agent and an
 * allow_tools entry naming a server no try loads; listByAgent answers an
 * agent's eval runs newest first without their tries; cancel answers a
 * finished eval run unchanged and, with no engine to ask, is UNAVAILABLE
 * for one still pending, which it leaves pending; delete is refused while
 * the eval run runs and otherwise removes it with its tries'
 * conversations; the agent's delete is refused while one of its eval runs
 * runs and otherwise removes them and their tries, while a compared
 * plugin's delete leaves the agent's eval runs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claudePlugin } from "@stigmer/plugin-package/testing";
import type { PluginFixture } from "@stigmer/plugin-package/testing";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunCommandController } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/command_pb";
import { EvalRunQueryController } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/query_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import { EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { seedOrganizations } from "../../organization/__tests__/support.js";
import {
  EVAL_RUN_LABEL,
  EVAL_RUN_NO_CASE_SOURCES_MESSAGE,
  EVAL_RUN_NO_CASES_MESSAGE,
  EVAL_RUN_NO_ENGINE_MESSAGE,
  EVAL_RUN_NOT_STARTED_ERROR,
  PLUGIN_NO_CASES_REASON,
  PLUGIN_NOT_SELECTED_REASON,
  evalRunActiveDeleteMessage,
  evalRunActiveOnSubjectDeleteMessage,
  evalRunUnloadedCaseSourceMessage,
} from "../constants.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
const OTHER_ORG = "globex";
const encoder = new TextEncoder();

let dir: string;
let server: ComposedServer;
let plugins: Client<typeof PluginCommandController>;
let agents: Client<typeof AgentCommandController>;
let evals: Client<typeof EvalRunCommandController>;
let evalQuery: Client<typeof EvalRunQueryController>;
let sessions: Client<typeof SessionCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "eval-run-agent-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine: 127.0.0.1:1 is deterministically closed.
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
  await seedOrganizations(transport, [ORG, OTHER_ORG]);
  plugins = createClient(PluginCommandController, transport);
  agents = createClient(AgentCommandController, transport);
  evals = createClient(EvalRunCommandController, transport);
  evalQuery = createClient(EvalRunQueryController, transport);
  sessions = createClient(SessionCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function archiveOf(fixture: PluginFixture): Uint8Array {
  return writeArchive(
    [...fixture.entries()].map(([filePath, content]) => ({
      path: filePath,
      bytes: typeof content === "string" ? encoder.encode(content) : content,
    })),
  );
}

const CASES = {
  "evals/answers/prompt.md": "Where is my refund?\n",
  "evals/answers/graders/names-window.md": "---\ntype: regex\npattern: 30 days\n---\n",
  "evals/polite/prompt.md": "---\nruns: 2\n---\n\nThis is the third time I ask.\n",
  "evals/polite/graders/criteria.md": "---\ntype: llm\n---\n\nPASS if the reply apologises.\n",
};

let counter = 0;
async function install(files: Record<string, string> = CASES): Promise<Plugin> {
  counter += 1;
  return plugins.push({
    org: ORG,
    artifact: archiveOf(
      claudePlugin({
        name: `desk-${counter}`,
        version: "1.0.0",
        skills: [{ name: `desk-${counter}-answer`, description: "Answer tickets", body: "# Answer\nBe kind." }],
        files,
      }),
    ),
  });
}

async function agentWith(attached: ReadonlyArray<Plugin>, org = ORG): Promise<Agent> {
  counter += 1;
  return agents.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name: `Support Desk ${counter}`, org },
    spec: {
      instructions: "You answer support tickets for the shop, politely.",
      plugins: attached.map((plugin) => ({ kind: ApiResourceKind.plugin, slug: plugin.metadata!.slug })),
    },
  });
}

function evalOf(agent: Agent, spec: Record<string, unknown> = {}, org = ORG) {
  return {
    apiVersion: API_VERSION,
    kind: "EvalRun",
    metadata: { org },
    spec: { subject: { case: "agentId" as const, value: agent.metadata!.id }, maxCostUsd: 5, ...spec },
  };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

async function setPhase(evalId: string, phase: EvalRunPhase): Promise<void> {
  await server.store.updateResource(ApiResourceKind.eval_run, evalId, EvalRunSchema, (live) => {
    live.status!.phase = phase;
  });
}

/** A conversation as the eval's workflow creates a try's: labelled with the eval. */
async function trySession(evalId: string): Promise<string> {
  const created = await sessions.create({
    apiVersion: API_VERSION,
    kind: "Session",
    metadata: { name: `try-${counter++}`, org: ORG },
    spec: {},
  });
  const id = created.metadata!.id;
  const stored = await server.store.getResource(ApiResourceKind.session, id, SessionSchema);
  stored.metadata!.labels[EVAL_RUN_LABEL] = evalId;
  await server.store.saveResource(ApiResourceKind.session, id, SessionSchema, stored);
  return id;
}

async function sessionExists(id: string): Promise<boolean> {
  try {
    await server.store.getResource(ApiResourceKind.session, id, SessionSchema);
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) return false;
    throw error;
  }
}

describe("eval run about an agent: create", () => {
  it("stamps the agent version and every attached plugin, plans the tries, and fails with the reason when no engine can start it", async () => {
    const desk = await install();
    const style = await install({ "README.md": "no evals here\n" });
    const agent = await agentWith([desk, style]);
    const created = await evals.create(evalOf(agent, { runs: 3 }));

    expect(created.metadata?.id).toMatch(/^evr_/);
    expect(created.spec?.agentVersion).toBe(agent.status?.versionHash);
    expect(created.status?.agentVersionHash).toBe(agent.status?.versionHash);
    expect(
      created.status?.plugins.map((plugin) => [plugin.pluginSlug, plugin.pluginDigest, plugin.attached, plugin.compared, plugin.notRunReason]),
    ).toEqual([
      [desk.metadata!.slug, desk.status!.digest, true, false, ""],
      [style.metadata!.slug, style.status!.digest, true, false, PLUGIN_NO_CASES_REASON],
    ]);
    expect(created.status?.triesTotal).toBe(6);
    expect(created.status?.phase).toBe(EvalRunPhase.failed);
    expect(created.status?.error).toBe(EVAL_RUN_NOT_STARTED_ERROR);
  });

  it("runs only the named case sources, and keeps the rest attached as not selected", async () => {
    const one = await install();
    const two = await install();
    const agent = await agentWith([one, two]);
    const created = await evals.create(evalOf(agent, { cases: [{ source: { case: "plugin" as const, value: { kind: ApiResourceKind.plugin, slug: two.metadata!.slug } } }], runs: 1 }));
    expect(created.status?.plugins.map((plugin) => plugin.notRunReason)).toEqual([PLUGIN_NOT_SELECTED_REASON, ""]);
    expect(created.status?.triesTotal).toBe(2);
  });

  it("refuses an agent version that attaches no plugin when none is compared", async () => {
    const agent = await agentWith([]);
    const error = await refusal(evals.create(evalOf(agent)));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(EVAL_RUN_NO_CASE_SOURCES_MESSAGE);
  });

  it("refuses a case source no try loads: a plugin the agent neither attaches nor compares", async () => {
    const other = await install();
    const agent = await agentWith([await install()]);
    const error = await refusal(evals.create(evalOf(agent, { cases: [{ source: { case: "plugin" as const, value: { kind: ApiResourceKind.plugin, slug: other.metadata!.slug } } }] })));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(evalRunUnloadedCaseSourceMessage(other.metadata!.slug));
  });

  it("refuses an eval run naming no subject, and an agent's fields on an eval run of a plugin", async () => {
    const plugin = await install();
    const agent = await agentWith([plugin]);
    const none = await refusal(evals.create({ ...evalOf(agent), spec: { maxCostUsd: 5 } }));
    expect(none.code).toBe(Code.InvalidArgument);
    const onPlugin = { subject: { case: "pluginId" as const, value: plugin.metadata!.id }, maxCostUsd: 5 };
    for (const extra of [
      { comparedPluginId: plugin.metadata!.id },
      { agentVersion: "latest" },
      { cases: [{ source: { case: "plugin" as const, value: { kind: ApiResourceKind.plugin, slug: plugin.metadata!.slug } } }] },
    ]) {
      const refused = await refusal(evals.create({ ...evalOf(agent), spec: { ...onPlugin, ...extra } }));
      expect(refused.code, Object.keys(extra).join()).toBe(Code.InvalidArgument);
    }
  });

  it("compares an attached plugin: only its cases run, in both arms", async () => {
    const desk = await install();
    const other = await install();
    const agent = await agentWith([desk, other]);
    const created = await evals.create(evalOf(agent, { comparedPluginId: other.metadata!.id, runs: 1 }));
    expect(created.status?.plugins.map((plugin) => [plugin.pluginSlug, plugin.attached, plugin.compared, plugin.notRunReason])).toEqual([
      [desk.metadata!.slug, true, false, PLUGIN_NOT_SELECTED_REASON],
      [other.metadata!.slug, true, true, ""],
    ]);
    // Its two cases, one try each, with and without.
    expect(created.status?.triesTotal).toBe(4);
  });

  it("compares a plugin the agent does not attach: stamped last, unattached, its cases in both arms", async () => {
    const desk = await install();
    const candidate = await install();
    const agent = await agentWith([desk]);
    const created = await evals.create(evalOf(agent, { comparedPluginId: candidate.metadata!.id, runs: 1 }));
    expect(created.status?.plugins.map((plugin) => [plugin.pluginSlug, plugin.pluginDigest, plugin.attached, plugin.compared])).toEqual([
      [desk.metadata!.slug, desk.status!.digest, true, false],
      [candidate.metadata!.slug, candidate.status!.digest, false, true],
    ]);
    expect(created.status?.triesTotal).toBe(4);
    // Deleting the compared plugin leaves the agent's eval run: it is no subject.
    await plugins.delete({ value: candidate.metadata!.id });
    expect((await evalQuery.get({ value: created.metadata!.id })).metadata?.id).toBe(created.metadata!.id);
  });

  it("refuses an eval none of whose plugins has cases", async () => {
    const agent = await agentWith([await install({ "README.md": "nothing\n" })]);
    const error = await refusal(evals.create(evalOf(agent)));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(EVAL_RUN_NO_CASES_MESSAGE);
  });

  it("refuses an organization that is not the agent's, a version the agent does not hold, and a missing agent", async () => {
    const agent = await agentWith([await install()]);
    expect((await refusal(evals.create(evalOf(agent, {}, OTHER_ORG)))).code).toBe(Code.FailedPrecondition);
    expect((await refusal(evals.create(evalOf(agent, { agentVersion: "9".repeat(64) })))).code).toBe(Code.NotFound);
    expect((await refusal(evals.create(evalOf(agent, { agentVersion: "no-such-tag" })))).code).toBe(Code.NotFound);
    const missing = await refusal(
      evals.create({ ...evalOf(agent), spec: { subject: { case: "agentId" as const, value: "agt_missing" }, maxCostUsd: 5 } }),
    );
    expect(missing.code).toBe(Code.NotFound);
  });

  it("refuses an allow_tools entry naming a server of no attached plugin", async () => {
    const agent = await agentWith([await install()]);
    const error = await refusal(evals.create(evalOf(agent, { allowTools: ["mcp__plugin_other_github__*"] })));
    expect(error.code).toBe(Code.InvalidArgument);
  });
});

describe("eval run about an agent: reads and deletes", () => {
  it("lists an agent's evals newest first, without their tries", async () => {
    const agent = await agentWith([await install()]);
    const first = await evals.create(evalOf(agent, { runs: 1 }));
    const second = await evals.create(evalOf(agent, { runs: 1 }));
    const listed = await evalQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(listed.entries.map((item) => item.metadata?.id)).toEqual([second.metadata?.id, first.metadata?.id]);
    expect(await evalQuery.get({ value: first.metadata!.id })).toMatchObject({ metadata: { id: first.metadata!.id } });
  });

  it("answers a finished eval's cancel unchanged, and is UNAVAILABLE for a pending one while no engine can be asked", async () => {
    const agent = await agentWith([await install()]);
    const created = await evals.create(evalOf(agent, { runs: 1 }));
    const evalId = created.metadata!.id;
    const cancelled = await evals.cancel({ value: evalId });
    expect(cancelled.status?.phase).toBe(EvalRunPhase.failed);
    expect(cancelled.status?.error).toBe(EVAL_RUN_NOT_STARTED_ERROR);

    await setPhase(evalId, EvalRunPhase.pending);
    const refused = await refusal(evals.cancel({ value: evalId }));
    expect(refused.code).toBe(Code.Unavailable);
    expect(refused.rawMessage).toBe(EVAL_RUN_NO_ENGINE_MESSAGE);
    expect((await evalQuery.get({ value: evalId })).status?.phase).toBe(EvalRunPhase.pending);
  });

  it("refuses to delete a running eval, naming cancel, and otherwise removes it with its tries", async () => {
    const agent = await agentWith([await install()]);
    const created = await evals.create(evalOf(agent, { runs: 1 }));
    const evalId = created.metadata!.id;
    const tryId = await trySession(evalId);
    await setPhase(evalId, EvalRunPhase.running);
    const refused = await refusal(evals.delete({ value: evalId }));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(evalRunActiveDeleteMessage(evalId));
    await setPhase(evalId, EvalRunPhase.completed);
    await evals.delete({ value: evalId });
    expect(await sessionExists(tryId)).toBe(false);
    expect((await refusal(evalQuery.get({ value: evalId }))).code).toBe(Code.NotFound);
  });

  it("refuses the agent's delete while one of its evals runs, and otherwise removes its evals and their tries", async () => {
    const agent = await agentWith([await install()]);
    const created = await evals.create(evalOf(agent, { runs: 1 }));
    const evalId = created.metadata!.id;
    const tryId = await trySession(evalId);
    await setPhase(evalId, EvalRunPhase.running);
    const refused = await refusal(agents.delete({ value: agent.metadata!.id }));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(evalRunActiveOnSubjectDeleteMessage("agent", evalId));
    await setPhase(evalId, EvalRunPhase.partial);
    await agents.delete({ value: agent.metadata!.id });
    expect(await sessionExists(tryId)).toBe(false);
    await expect(
      server.store.getResource(ApiResourceKind.eval_run, evalId, EvalRunSchema),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
