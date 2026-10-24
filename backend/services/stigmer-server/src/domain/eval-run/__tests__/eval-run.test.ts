/**
 * Composed-server round-trips for the EvalRun kind: a real server over a
 * temp SQLite store with no engine behind it, raw Connect clients, plugins
 * pushed as the CLI pushes them. Pins: create mints the eval's own id,
 * stamps the plugin's current version, plans its tries (the comparison not
 * provisional) and, with no engine to start its workflow, answers the eval
 * failed with the reason; create
 * refuses a digest that is not the plugin's current version (an earlier
 * one, or one that is no version of it), an organization that is not the
 * plugin's, a case_glob that is not a glob, a missing plugin, a
 * version without eval cases, a filter that keeps no case, a suite larger
 * than an eval may run (naming the counts; 200 cases and 1000 tries run,
 * one more of either is refused), a target model the catalog
 * does not know and a target engine the platform does not offer; listByPlugin answers a plugin's evals newest first;
 * cancel answers a finished eval unchanged and is UNAVAILABLE for a running
 * one with no engine to stop it; delete is refused while the eval runs,
 * naming cancel, and otherwise removes the eval with its tries'
 * conversations and nothing else; the plugin's delete is refused while one
 * of its evals runs and otherwise removes its evals and their tries.
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
import { PluginCommandController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/command_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunCommandController } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/command_pb";
import { EvalRunQueryController } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/query_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPhase } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";
import {
  EVAL_RUN_LABEL,
  evalRunActiveDeleteMessage,
  evalRunActiveOnSubjectDeleteMessage,
  evalRunNotCurrentVersionMessage,
  evalRunTooLargeMessage,
  EVAL_RUN_MAX_CASES,
  EVAL_RUN_MAX_TRIES,
} from "../constants.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
const OTHER_ORG = "globex";
const encoder = new TextEncoder();

let dir: string;
let server: ComposedServer;
let orgId: string;
let otherOrgId: string;
let plugins: Client<typeof PluginCommandController>;
let evals: Client<typeof EvalRunCommandController>;
let evalQuery: Client<typeof EvalRunQueryController>;
let sessions: Client<typeof SessionCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "eval-run-domain-test-"));
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
  const orgIds = await seedOrganizations(transport, [ORG, OTHER_ORG]);
  orgId = organizationId(orgIds, ORG);
  otherOrgId = organizationId(orgIds, OTHER_ORG);
  plugins = createClient(PluginCommandController, transport);
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
  "evals/review-fires/prompt.md": "Look over my diff.\n",
  "evals/review-fires/graders/criteria.md":
    "---\ntype: llm\n---\n\nPASS if the reply names the bug.\n",
  "evals/review-quiet/prompt.md": "---\nruns: 2\n---\n\nWhat time is it?\n",
  "evals/review-quiet/graders/no-review.md":
    "---\ntype: regex\npattern: review\nmatch: not_contains\n---\n",
};

let counter = 0;
async function install(files: Record<string, string> = CASES, version = "1.0.0"): Promise<Plugin> {
  counter += 1;
  return plugins.push({
    org: ORG,
    artifact: archiveOf(
      claudePlugin({
        name: `thermos-${counter}`,
        version,
        skills: [{ name: `thermos-${counter}-review`, description: "Review code", body: "# Review\nRead it all." }],
        files,
      }),
    ),
  });
}

function evalOf(plugin: Plugin, spec: Record<string, unknown> = {}, org = ORG) {
  return {
    apiVersion: API_VERSION,
    kind: "EvalRun",
    metadata: { org },
    spec: { subject: { case: "pluginId" as const, value: plugin.metadata!.id }, maxCostUsd: 5, ...spec },
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
async function trySession(evalId: string | undefined): Promise<string> {
  const created = await sessions.create({
    apiVersion: API_VERSION,
    kind: "Session",
    metadata: { name: `try-${counter++}`, org: ORG },
    spec: {},
  });
  const id = created.metadata!.id;
  if (evalId !== undefined) {
    const stored = await server.store.getResource(ApiResourceKind.session, id, SessionSchema);
    stored.metadata!.labels[EVAL_RUN_LABEL] = evalId;
    await server.store.saveResource(ApiResourceKind.session, id, SessionSchema, stored);
  }
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

describe("eval run create", () => {
  it("mints its own id, stamps the current version, plans its tries, and fails with the reason when no engine can start it", async () => {
    const plugin = await install();
    const created = await evals.create({
      ...evalOf(plugin),
      metadata: { org: ORG, id: "evr_chosen_by_the_caller" },
    });
    expect(created.metadata?.id).toMatch(/^evr_/);
    expect(created.metadata?.id).not.toBe("evr_chosen_by_the_caller");
    expect(created.metadata?.org).toBe(orgId);
    expect(created.spec?.pluginDigest).toBe(plugin.status?.digest);
    // review-fires: 3 tries per arm; review-quiet: its own 2; two arms each.
    expect(created.status?.triesTotal).toBe(2 * 3 + 2 * 2);
    // Both arms run the built-in assistant, the with-arm listing the plugin: the comparison is not provisional.
    expect(created.status?.phase).toBe(EvalRunPhase.failed);
    expect(created.status?.error).toBe("the eval run's workflow could not be started");

    const read = await evalQuery.get({ value: created.metadata!.id });
    expect(read.status?.phase).toBe(EvalRunPhase.failed);
    expect(read.spec?.pluginDigest).toBe(plugin.status?.digest);
  });

  it("refuses a digest naming an earlier version, and plans by the spec's runs and ablation", async () => {
    const first = await install(CASES, "1.0.0");
    const firstDigest = first.status!.digest;
    const upgraded = await plugins.push({
      org: ORG,
      artifact: archiveOf(
        claudePlugin({
          name: first.metadata!.slug,
          version: "1.1.0",
          skills: [{ name: `${first.metadata!.slug}-review`, description: "Review code", body: "# Review\nNewer." }],
          files: {
            "evals/only/prompt.md": "Just this one.\n",
            "evals/only/graders/says-one.md": "---\ntype: regex\npattern: one\n---\n",
          },
        }),
      ),
    });
    const current = upgraded.status!.digest;
    expect(current).not.toBe(firstDigest);
    const earlier = await refusal(evals.create(evalOf(first, { pluginDigest: firstDigest })));
    expect(earlier.code).toBe(Code.FailedPrecondition);
    expect(earlier.rawMessage).toBe(evalRunNotCurrentVersionMessage(current));

    const created = await evals.create(
      evalOf(first, { pluginDigest: current, runs: 1, ablation: EvalRunAblation.none }),
    );
    expect(created.spec?.pluginDigest).toBe(current);
    expect(created.status?.triesTotal).toBe(1);
  });

  it("refuses what an eval cannot run, before writing anything", async () => {
    const plugin = await install();
    const before = (await evalQuery.listByPlugin({ pluginId: plugin.metadata!.id })).entries.length;

    const wrongOrg = await refusal(evals.create(evalOf(plugin, {}, OTHER_ORG)));
    expect(wrongOrg.code).toBe(Code.FailedPrecondition);
    expect(wrongOrg.rawMessage).toBe(`metadata.org must be the plugin's organization (${orgId})`);
    expect(otherOrgId).not.toBe(orgId);

    const unknownDigest = await refusal(evals.create(evalOf(plugin, { pluginDigest: "a".repeat(64) })));
    expect(unknownDigest.code).toBe(Code.FailedPrecondition);
    expect(unknownDigest.rawMessage).toBe(evalRunNotCurrentVersionMessage(plugin.status!.digest));

    const badGlob = await refusal(evals.create(evalOf(plugin, { caseGlob: "review-[z-a]" })));
    expect(badGlob.code).toBe(Code.InvalidArgument);
    expect(badGlob.rawMessage).toBe("spec.case_glob 'review-[z-a]' is not a valid glob: range 'z-a' is reversed");

    const missing = await refusal(evals.create({ ...evalOf(plugin), spec: { subject: { case: "pluginId", value: "plg_absent" }, maxCostUsd: 5 } }));
    expect(missing.code).toBe(Code.NotFound);

    const noCases = await install({ "README.md": "no evals here" });
    const empty = await refusal(evals.create(evalOf(noCases)));
    expect(empty.code).toBe(Code.FailedPrecondition);
    expect(empty.rawMessage).toContain("has no eval cases");

    const filtered = await refusal(evals.create(evalOf(plugin, { caseGlob: "nothing-*" })));
    expect(filtered.code).toBe(Code.FailedPrecondition);
    expect(filtered.rawMessage).toBe("no eval case matches case_glob and case_tags");

    const targets = Array.from({ length: 6 }, () => ({ harness: Harness.NATIVE, modelName: "" }));
    const tooLarge = await refusal(evals.create(evalOf(plugin, { runs: 50, targets })));
    expect(tooLarge.code).toBe(Code.FailedPrecondition);
    expect(tooLarge.rawMessage).toBe(evalRunTooLargeMessage(2, 2 * 6 * 2 * 50));

    const typo = await refusal(
      evals.create(evalOf(plugin, { targets: [{ harness: Harness.NATIVE, modelName: "claude-sonet-4.6" }] })),
    );
    expect(typo.code).toBe(Code.InvalidArgument);
    expect(typo.rawMessage).toContain("spec.targets[0].model_name: model 'claude-sonet-4.6' is not in the model registry");

    const unoffered = await refusal(
      evals.create(
        evalOf(plugin, {
          targets: [
            { harness: Harness.NATIVE, modelName: "" },
            { harness: Harness.CLAUDE, modelName: "" },
          ],
        }),
      ),
    );
    expect(unoffered.code).toBe(Code.FailedPrecondition);
    expect(unoffered.rawMessage).toBe("Claude is not available on this platform yet (spec.targets[1].harness)");

    expect((await evalQuery.listByPlugin({ pluginId: plugin.metadata!.id })).entries).toHaveLength(before);
  });

  it("runs at most 200 cases and 1000 tries, refusing one more of either", async () => {
    expect([EVAL_RUN_MAX_CASES, EVAL_RUN_MAX_TRIES]).toEqual([200, 1000]);
    const many = (count: number) =>
      install(
        Object.fromEntries(
          Array.from({ length: count }, (_, index) => [
            [`evals/case-${index}/prompt.md`, "Say yes.\n"],
            [`evals/case-${index}/graders/says-yes.md`, "---\ntype: regex\npattern: yes\n---\n"],
          ]).flat(),
        ),
      );
    const single = { ablation: EvalRunAblation.none };

    const atLimit = await many(200);
    const largest = await evals.create(evalOf(atLimit, { ...single, runs: 5 }));
    expect(largest.status?.triesTotal).toBe(1000);

    const oneCaseOver = await many(201);
    const cases = await refusal(evals.create(evalOf(oneCaseOver, { ...single, runs: 1 })));
    expect(cases.code).toBe(Code.FailedPrecondition);
    expect(cases.rawMessage).toBe(evalRunTooLargeMessage(201, 201));

    const oneTryOver = await many(91);
    const tries = await refusal(evals.create(evalOf(oneTryOver, { ...single, runs: 11 })));
    expect(tries.code).toBe(Code.FailedPrecondition);
    expect(tries.rawMessage).toBe(evalRunTooLargeMessage(91, 1001));
  });
});

describe("eval run reads, cancel and delete", () => {
  it("lists a plugin's evals newest first, and only that plugin's", async () => {
    const plugin = await install();
    const other = await install();
    const first = await evals.create(evalOf(plugin));
    const second = await evals.create(evalOf(plugin));
    await evals.create(evalOf(other));
    const listed = await evalQuery.listByPlugin({ pluginId: plugin.metadata!.id });
    expect(listed.entries.map((e) => e.metadata?.id)).toEqual([second.metadata!.id, first.metadata!.id]);
    expect(listed.entries).toHaveLength(2);
  });

  it("answers a finished eval's cancel unchanged, and cannot stop a running one with no engine", async () => {
    const plugin = await install();
    const failed = await evals.create(evalOf(plugin));
    const unchanged = await evals.cancel({ value: failed.metadata!.id });
    expect(unchanged.status?.phase).toBe(EvalRunPhase.failed);

    await setPhase(failed.metadata!.id, EvalRunPhase.running);
    const noEngine = await refusal(evals.cancel({ value: failed.metadata!.id }));
    expect(noEngine.code).toBe(Code.Unavailable);
  });

  it("refuses to delete a running eval, naming cancel, and otherwise removes it with its tries' conversations only", async () => {
    const plugin = await install();
    const evalRun: EvalRun = await evals.create(evalOf(plugin));
    const evalId = evalRun.metadata!.id;
    const tries = [await trySession(evalId), await trySession(evalId)];
    const unrelated = await trySession(undefined);
    const otherEvalTry = await trySession("evr_another");

    await setPhase(evalId, EvalRunPhase.running);
    const refused = await refusal(evals.delete({ value: evalId }));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(evalRunActiveDeleteMessage(evalId));
    expect(await sessionExists(tries[0]!)).toBe(true);

    await setPhase(evalId, EvalRunPhase.partial);
    const deleted = await evals.delete({ value: evalId });
    expect(deleted.metadata?.id).toBe(evalId);
    expect(await Promise.all(tries.map(sessionExists))).toEqual([false, false]);
    expect(await sessionExists(unrelated)).toBe(true);
    expect(await sessionExists(otherEvalTry)).toBe(true);
    expect((await refusal(evalQuery.get({ value: evalId }))).code).toBe(Code.NotFound);
  });

  it("refuses the plugin's delete while one of its evals runs, and otherwise deletes its evals and their tries", async () => {
    const plugin = await install();
    const running = await evals.create(evalOf(plugin));
    const finished = await evals.create(evalOf(plugin));
    const runningId = running.metadata!.id;
    const evalTry = await trySession(finished.metadata!.id);

    await setPhase(runningId, EvalRunPhase.running);
    const refused = await refusal(plugins.delete({ value: plugin.metadata!.id }));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(evalRunActiveOnSubjectDeleteMessage("plugin", runningId));
    expect(await sessionExists(evalTry)).toBe(true);

    await setPhase(runningId, EvalRunPhase.completed);
    await plugins.delete({ value: plugin.metadata!.id });
    for (const id of [runningId, finished.metadata!.id]) {
      await expect(
        server.store.getResource(ApiResourceKind.eval_run, id, EvalRunSchema),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    }
    expect(await sessionExists(evalTry)).toBe(false);
  });
});

