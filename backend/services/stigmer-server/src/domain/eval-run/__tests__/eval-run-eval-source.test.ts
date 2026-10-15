/**
 * Composed-server round trips for eval runs whose cases come from an Eval:
 * a real server over a temp SQLite store with no engine behind it, an Eval
 * pushed as the CLI pushes it and agents created as the CLI creates them.
 *
 * Pins: create stamps each Eval the spec names in `status.evals` (its id,
 * slug and the digest of its current version, or of the version a tag or a
 * digest names) and plans its cases' tries, whether the agent attaches a
 * plugin or none; an Eval named twice is stamped once; an Eval beside a
 * plugin case source runs both. Create refuses an Eval that is not there, one of another
 * organization, and a version the Eval does not hold, each by name; and an
 * agent with no plugin and no Eval named still has nothing whose cases
 * could run.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claudePlugin } from "@stigmer/plugin-package/testing";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { EvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/command_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { seedOrganizations } from "../../organization/__tests__/support.js";
import {
  EVAL_RUN_NO_CASE_SOURCES_MESSAGE,
  evalRunEvalVersionMessage,
  evalRunUnreadableEvalMessage,
} from "../constants.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
const OTHER_ORG = "globex";
const encoder = new TextEncoder();
const JUDGE = "---\ntype: llm\n---\n\nPASS if the reply names the 30-day window.\n";

let dir: string;
let server: ComposedServer;
let pushes: Client<typeof EvalCommandController>;
let plugins: Client<typeof PluginCommandController>;
let agents: Client<typeof AgentCommandController>;
let evalRuns: Client<typeof EvalRunCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "eval-run-eval-source-"));
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
  pushes = createClient(EvalCommandController, transport);
  plugins = createClient(PluginCommandController, transport);
  agents = createClient(AgentCommandController, transport);
  evalRuns = createClient(EvalRunCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;

/** An evals/ folder of `cases` cases, each with one judged check. */
function folder(cases: number): Uint8Array {
  const files: Record<string, string> = {};
  for (let index = 1; index <= cases; index++) {
    files[`case-${index}/prompt.md`] = `Can I return item ${index}?\n`;
    files[`case-${index}/graders/judge.md`] = JUDGE;
  }
  return writeArchive(Object.entries(files).map(([filePath, content]) => ({ path: filePath, bytes: encoder.encode(content) })));
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function agentWith(attached: ReadonlyArray<Plugin> = [], org = ORG): Promise<Agent> {
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

function evalSource(slug: string, version = "", org = "") {
  return { source: { case: "eval" as const, value: { kind: ApiResourceKind.eval, org, slug, version } } };
}

function evalRunOf(agent: Agent, spec: Record<string, unknown>) {
  return {
    apiVersion: API_VERSION,
    kind: "EvalRun",
    metadata: { org: ORG },
    spec: { subject: { case: "agentId" as const, value: agent.metadata!.id }, maxCostUsd: 5, runs: 1, ...spec },
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

describe("eval run with Eval case sources: create", () => {
  it("stamps the Eval's current version and plans its cases on an agent with no plugin", async () => {
    const slug = `support-${++counter}`;
    const v1 = folder(2);
    const pushed = await pushes.push({ org: ORG, slug, artifact: v1 });
    const agent = await agentWith();
    const created = await evalRuns.create(evalRunOf(agent, { cases: [evalSource(slug), evalSource(slug)] }));

    expect(created.status?.plugins).toEqual([]);
    expect(created.status?.evals.map((block) => [block.evalId, block.evalSlug, block.evalDigest, block.notRunReason])).toEqual([
      [pushed.metadata!.id, slug, digestOf(v1), ""],
    ]);
    expect(created.status?.triesTotal).toBe(2);
  });

  it("stamps the version a tag or a digest names", async () => {
    const slug = `tagged-${++counter}`;
    const stable = folder(1);
    await pushes.push({ org: ORG, slug, artifact: stable, tag: "stable" });
    const next = folder(3);
    await pushes.push({ org: ORG, slug, artifact: next });
    const agent = await agentWith();

    const byTag = await evalRuns.create(evalRunOf(agent, { cases: [evalSource(slug, "stable")] }));
    expect(byTag.status?.evals.map((block) => block.evalDigest)).toEqual([digestOf(stable)]);
    expect(byTag.status?.triesTotal).toBe(1);
    const byDigest = await evalRuns.create(evalRunOf(agent, { cases: [evalSource(slug, digestOf(next))] }));
    expect(byDigest.status?.evals.map((block) => block.evalDigest)).toEqual([digestOf(next)]);
    expect(byDigest.status?.triesTotal).toBe(3);
  });

  it("runs an Eval beside a plugin case source", async () => {
    counter += 1;
    const plugin = await plugins.push({
      org: ORG,
      artifact: writeArchive(
        [...claudePlugin({ name: `desk-${counter}`, version: "1.0.0", files: { "evals/answers/prompt.md": "Hi.\n", "evals/answers/graders/judge.md": JUDGE } }).entries()].map(
          ([filePath, content]) => ({ path: filePath, bytes: typeof content === "string" ? encoder.encode(content) : content }),
        ),
      ),
    });
    const slug = `beside-${counter}`;
    await pushes.push({ org: ORG, slug, artifact: folder(1) });
    const agent = await agentWith([plugin]);
    const created = await evalRuns.create(
      evalRunOf(agent, {
        cases: [
          { source: { case: "plugin" as const, value: { kind: ApiResourceKind.plugin, slug: plugin.metadata!.slug } } },
          evalSource(slug),
        ],
      }),
    );
    expect(created.status?.plugins.map((block) => block.notRunReason)).toEqual([""]);
    expect(created.status?.evals.map((block) => block.notRunReason)).toEqual([""]);
    expect(created.status?.triesTotal).toBe(2);
  });

  it("refuses an Eval that is not there, one of another organization, and a version it does not hold, by name", async () => {
    const agent = await agentWith();
    const missing = await refusal(evalRuns.create(evalRunOf(agent, { cases: [evalSource("no-such-eval")] })));
    expect(missing.code).toBe(Code.InvalidArgument);
    expect(missing.rawMessage).toBe(evalRunUnreadableEvalMessage("no-such-eval"));

    const elsewhere = `elsewhere-${++counter}`;
    await pushes.push({ org: OTHER_ORG, slug: elsewhere, artifact: folder(1) });
    const foreign = await refusal(evalRuns.create(evalRunOf(agent, { cases: [evalSource(elsewhere, "", OTHER_ORG)] })));
    expect(foreign.code).toBe(Code.InvalidArgument);

    const slug = `versioned-${++counter}`;
    await pushes.push({ org: ORG, slug, artifact: folder(1) });
    const noVersion = await refusal(evalRuns.create(evalRunOf(agent, { cases: [evalSource(slug, "beta")] })));
    expect(noVersion.code).toBe(Code.InvalidArgument);
    expect(noVersion.rawMessage).toBe(evalRunEvalVersionMessage(slug, "beta"));
  });

  it("still refuses an agent with no plugin when the eval run names no Eval", async () => {
    const agent = await agentWith();
    const error = await refusal(evalRuns.create(evalRunOf(agent, {})));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(EVAL_RUN_NO_CASE_SOURCES_MESSAGE);
  });
});
