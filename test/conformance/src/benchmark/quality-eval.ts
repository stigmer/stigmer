// The benchmark's quality arm: the working agent as a plugin whose `evals/`
// suite holds the quality tasks (fixtures/working-agent, in the plugin-eval
// format), run by Stigmer's own plugin evals.
// Domain: conformance benchmark (the quality arm).
//
// One eval per run, in a fresh organization: the plugin is pushed through the
// real install, and the eval runs every case on each planned target (a
// harness on its parity model), with the platform's judge on the judge model
// for the AI-graded checks, one arm (no without-plugin comparison: the
// benchmark compares engines, not the plugin's worth), and the tools a
// working session uses granted beyond each case's read-only list. Its result
// document (`@stigmer/sdk` `toResultDocument`, the format's `schemaVersion:
// 1` file) becomes the report's `quality`, so the quality numbers read the
// way any plugin author reads theirs. A failure to push, create or follow the
// eval is recorded by stage, never thrown: the timing cells' report still
// lands.
//
// `renderQuality` is the pure half: the operator's table, one row per case
// and target, read from the document as JSON.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { toResultDocument } from "@stigmer/sdk";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { createUniqueOrganization } from "../support/organizations";
import { awaitPluginEvalEnd, makePluginEval } from "../support/plugin-evals";
import { pluginArchive, type PluginFixture } from "../support/plugins";
import { WORKING_AGENT_FIXTURE_DIR } from "../support/working-agent";
import type { QualityTarget } from "./cells";
import type { QualityEval } from "./report";

/** The tools every quality try may use beyond its case's read-only list: what a working session edits and runs with. */
export const QUALITY_ALLOW_TOOLS: readonly string[] = ["Bash", "Edit", "Write", "Task"];

/** The eval's spending limit, in estimated US dollars. */
export const QUALITY_MAX_COST_USD = 100;

/** How long the eval may run before the run stops following it. */
export const QUALITY_EVAL_BUDGET_MS = 4 * 60 * 60 * 1000;

export interface QualityEvalOptions {
  /** Tries per case and target. */
  readonly runs: number;
  readonly judgeModel: string;
  /** Tries running at once; 4 unless given. */
  readonly concurrency?: number;
  /** Only the cases whose name matches (`--case`); every case when absent. */
  readonly caseGlob?: string;
  readonly timeoutMs?: number;
  /** The plugin's directory; the working agent's fixture unless given. */
  readonly pluginDir?: string;
}

/** The plugin's files from its directory, by plugin-relative path. */
export async function readPluginDirectory(dir: string): Promise<PluginFixture> {
  const files: PluginFixture = new Map();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.set(relative(dir, path).split(sep).join("/"), await readFile(path));
    }
  };
  await walk(dir);
  return files;
}

/** Runs the quality eval on `targets` and returns what the report keeps (the module header). */
export async function runQualityEval(
  clients: ConformanceClients,
  targets: readonly QualityTarget[],
  options: QualityEvalOptions,
  io: { log: (line: string) => void },
): Promise<QualityEval> {
  const fixtures = new FixtureTracker();
  const quality: QualityEval = {
    plugin: "",
    eval_id: "",
    targets: targets.map((target) => `${target.harness === "cursor" ? "cursor" : "native"}/${target.modelRequested}`),
    judge_model: options.judgeModel,
    runs: options.runs,
    document: null,
  };
  try {
    let org: string;
    let pluginId: string;
    try {
      ({ id: org } = await createUniqueOrganization(clients.organizationCommand, "the benchmark's quality eval"));
      fixtures.defer(() => clients.organizationCommand.delete({ value: org }));
      const plugin = await clients.pluginCommand.push({
        org,
        artifact: pluginArchive(await readPluginDirectory(options.pluginDir ?? WORKING_AGENT_FIXTURE_DIR)),
      });
      pluginId = plugin.metadata!.id;
      fixtures.defer(() => clients.pluginCommand.delete({ value: pluginId }));
      quality.plugin = plugin.metadata?.name ?? "";
    } catch (error) {
      return { ...quality, failure: { stage: "create", message: `push the working agent's plugin: ${errorMessage(error)}` } };
    }
    let evalId: string;
    try {
      const created = await clients.pluginEvalCommand.create(
        makePluginEval({
          org,
          pluginId,
          targets: targets.map((target) => ({
            harness: target.harness === "cursor" ? Harness.CURSOR : Harness.NATIVE,
            modelName: target.modelRequested,
          })),
          runs: options.runs,
          ablation: PluginEvalAblation.none,
          maxCostUsd: QUALITY_MAX_COST_USD,
          concurrency: options.concurrency ?? 4,
          allowTools: QUALITY_ALLOW_TOOLS,
          judgeModel: options.judgeModel,
          ...(options.caseGlob === undefined ? {} : { caseGlob: options.caseGlob }),
        }),
      );
      evalId = created.metadata!.id;
      quality.eval_id = evalId;
    } catch (error) {
      return { ...quality, failure: { stage: "create", message: `create the eval: ${errorMessage(error)}` } };
    }
    io.log(`quality: eval ${evalId} started`);
    try {
      const ended = await awaitPluginEvalEnd(clients, evalId, options.timeoutMs ?? QUALITY_EVAL_BUDGET_MS);
      const document = JSON.parse(JSON.stringify(toResultDocument(ended))) as Record<string, unknown>;
      if (ended.status?.phase === PluginEvalPhase.failed) {
        return { ...quality, document, failure: { stage: "execution", message: `the eval failed: ${ended.status.error}` } };
      }
      return { ...quality, document };
    } catch (error) {
      return { ...quality, failure: { stage: "execution", message: `follow the eval: ${errorMessage(error)}` } };
    }
  } finally {
    await fixtures.cleanup();
  }
}

/** The operator's quality table (the module header): one row per case and target, then the cases not run, then a failure. */
export function renderQuality(quality: QualityEval | null): string[] {
  if (quality === null) return [];
  const lines: string[] = ["", `Quality: plugin eval ${quality.eval_id || "(not created)"}, judge ${quality.judge_model}, ${quality.runs} tries per case`];
  const document = quality.document;
  const targets = document === null ? [] : arrayOf(document["targets"]);
  if (targets.length > 0) {
    lines.push("", "| quality case | target | score | pass^k |", "|---|---|---|---|");
    for (const target of targets) {
      const label = stringOf(recordOf(target)["label"]);
      for (const entry of arrayOf(recordOf(target)["cases"])) {
        const evalCase = recordOf(entry);
        const score = recordOf(evalCase["aggregates"])["score"];
        lines.push(`| ${stringOf(evalCase["name"])} | ${label} | ${typeof score === "number" ? score.toFixed(2) : "n/a"} | ${evalCase["passK"] === true ? "yes" : "no"} |`);
      }
    }
  }
  const notRun = document === null ? [] : arrayOf(document["notRun"]);
  if (notRun.length > 0) {
    lines.push("", "Quality cases not run:");
    for (const entry of notRun) {
      const row = recordOf(entry);
      lines.push(`- ${stringOf(row["name"])}${typeof row["target"] === "string" ? ` on ${row["target"]}` : ""}: ${stringOf(row["reason"])}`);
    }
  }
  if (quality.failure !== undefined) lines.push("", `Quality eval: ${quality.failure.stage}: ${quality.failure.message}`);
  return lines;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
