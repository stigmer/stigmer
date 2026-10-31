// `eval run` dispatch: resolve what the eval run is about, start it, follow
// it to the end, and print or write the result; and `eval cancel`.
//
// The start, the follow loop, Ctrl+C, the deadlines and the exit on a lost
// eval run are follow.ts's (whose header holds those rules); this module
// reads what the eval run is about and creates it.
//
// The agent is read first, by id or by reference in the organization (the
// group's one rule, resources/agent/resolve.ts), so the eval run is
// created in the agent's own organization and the output names it by
// slug. Its version is not read here: create resolves a tag, refuses a
// version that does not exist, and stamps the hash, which the tables show.
// A plugin named with `--plugin` is read the same way, in the agent's
// organization beside `--agent`, since create takes its id; a plugin named
// with `--cases-from` is sent as written (an id, or a slug in the agent's
// organization, or org/slug), and the server matches it against the
// plugins a try loads. Every read is part of the start: its refusal exits
// 1, as create's does.
//
// The eval run is sent with no name: the server names it by its id, which
// is short and unique, and a person tells eval runs apart by subject and
// start time.
//
// The load findings of the plugin `--plugin` names (a case file that does
// not parse) go to stderr before the eval run starts, each as the server
// relays it, on one line: its message already starts with the file's
// path. Under `--json` they go into Stigmer's `findings` field of the
// result document beside the format's, and a finding fails the exit code.
// `--json` writes the SDK's result document with the subject's slug, and
// `stillRunning: true` when the command could not cancel an eval run it
// stopped following.

import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginWarning } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  toResultDocument,
  type EvalRunCaseSourceInput,
  type EvalRunInput,
  type EvalRunResultDocument,
  type Stigmer,
} from "@stigmer/client";
import { requireOrganization } from "../../client/single-org.js";
import { CommandResult } from "../../output/command-result.js";
import { resolveAgent } from "../agent/resolve.js";
import { idPrefixOf, parseReference } from "../reference.js";
import { asStartRefusal, runEval, type EvalIo } from "./follow.js";
import type { EvalRunOptions, EvalTarget } from "./options.js";
import { evalExitCode, oneLine, renderEvalReport, type EvalExit } from "./report.js";

export { CALL_DEADLINE_MS, POLL_INTERVAL_MS, POLL_RETRY_BUDGET_MS } from "./follow.js";

/** The commands that set the organization a slug is read in, when none is set. */
const SET_ORG_WITH = ["stigmer config context set --org <org>", "stigmer eval run --org <org> ..."] as const;

/** A problem reading a plugin's suite, as the result document carries it. */
interface ResultFinding {
  /** The finding's kind, such as `eval-case-invalid`. */
  readonly kind: string;
  /** The plugin-relative file it is about; empty for the suite as a whole. */
  readonly path: string;
  /** The sentence, which starts with the path. */
  readonly message: string;
}

/** The result document the command writes: the SDK's, with the named plugin's load findings. */
interface CliResultDocument extends EvalRunResultDocument {
  readonly findings: readonly ResultFinding[];
  /**
   * Present, and true, only when the command stopped following the eval
   * run and could not cancel it: it may still be running and spending.
   */
  readonly stillRunning?: true;
}

/** What the eval run is about, read: the subject and the spec fields that name it. */
interface ResolvedSubject {
  /** The subject's slug, for the output. */
  readonly slug: string;
  /** What the eval run runs on, for `Started <id> on <on>.` */
  readonly on: string;
  /** Where to cancel an eval run whose start went unanswered. */
  readonly cancelElsewhere: string;
  /** The plugin `--plugin` named, whose load findings the command reports. */
  readonly named?: Plugin;
  /** The create's subject fields. */
  readonly input: Pick<
    EvalRunInput,
    "org" | "agentId" | "agentVersion" | "pluginId" | "pluginDigest" | "comparedPluginId" | "cases"
  >;
}

/** Runs `stigmer eval run` and returns the code to exit with. */
export async function runEvalRun(client: Stigmer, org: string, options: EvalRunOptions, io: EvalIo): Promise<EvalExit> {
  const quiet = options.json.kind !== "none";
  const subject = await resolveSubject(client, org, options).catch(asStartRefusal);
  const findings = subject.named?.status?.evals?.findings ?? [];
  if (!quiet) {
    for (const finding of findings) io.stderr.write(`evals: ${oneLine(finding.message)}\n`);
  }
  return runEval(
    client,
    {
      cancelElsewhere: subject.cancelElsewhere,
      on: subject.on,
      create: () => startEvalRun(client, subject, options),
      report: (evalRun, interrupted, stillRunning) =>
        renderEvalReport(evalRun, {
          subjectSlug: subject.slug,
          interrupted,
          durationSeconds: toResultDocument(evalRun, { interrupted, nowMs: io.now() }).durationSeconds,
          stillRunning,
        }),
      document: (evalRun, interrupted, stillRunning) =>
        documentOf(evalRun, subject.slug, findings, interrupted, io.now(), stillRunning),
      exitCode: (evalRun, interrupted) => evalExitCode(evalRun, { interrupted, loadFindings: findings.length }),
    },
    options,
    io,
  );
}

/** Cancels an eval run and says what happened. */
export async function cancelEvalRun(client: Stigmer, id: string): Promise<CommandResult> {
  const cancelled = await client.evalrun.cancel(id);
  const finished = cancelled.status?.triesFinished ?? 0;
  const total = cancelled.status?.triesTotal ?? 0;
  return CommandResult.success(`Cancelled ${id}: tries in flight stop; ${finished} of ${total} tries had finished.`).withData({
    evalRunId: id,
    triesFinished: finished,
    triesTotal: total,
  });
}

async function resolveSubject(client: Stigmer, org: string, options: EvalRunOptions): Promise<ResolvedSubject> {
  const subject = options.subject;
  if (subject.kind === "plugin") {
    const plugin = await resolvePlugin(client, subject.plugin.ref, org);
    const slug = plugin.metadata?.slug || plugin.metadata?.name || subject.plugin.ref;
    return {
      slug,
      on: slug,
      cancelElsewhere: "cancel it from the plugin's Evals tab in the console",
      named: plugin,
      input: { org: plugin.metadata?.org ?? "", pluginId: plugin.metadata?.id ?? "", pluginDigest: subject.plugin.digest },
    };
  }
  const agent = await resolveAgent(client, subject.agent.ref, org, SET_ORG_WITH);
  const agentOrg = agent.metadata?.org ?? "";
  const slug = agent.metadata?.slug || agent.metadata?.name || subject.agent.ref;
  const compared = subject.compared === "" ? undefined : await resolvePlugin(client, subject.compared, agentOrg);
  const on = subject.agent.version === "" ? slug : `${slug}@${subject.agent.version}`;
  return {
    slug,
    on: compared === undefined ? on : `${on} with and without ${compared.metadata?.slug || subject.compared}`,
    cancelElsewhere: "cancel it from the agent's Evals tab in the console",
    ...(compared !== undefined && { named: compared }),
    input: {
      org: agentOrg,
      agentId: agent.metadata?.id ?? "",
      agentVersion: subject.agent.version,
      comparedPluginId: compared?.metadata?.id ?? "",
      cases: [
        ...subject.casesFrom.map((ref) => caseSourceOf(ref, agentOrg)),
        ...subject.evals.map((target) => evalSourceOf(target, agentOrg)),
      ],
    },
  };
}

async function resolvePlugin(client: Stigmer, ref: string, org: string): Promise<Plugin> {
  const parsed = parseReference(ref, org, idPrefixOf(ApiResourceKind.plugin));
  if (parsed.kind === "id") {
    return client.plugin.get(parsed.id);
  }
  await requireOrganization(client, parsed.org, SET_ORG_WITH);
  return client.plugin.getByReference({ org: parsed.org, slug: parsed.slug });
}

/** A `--cases-from` reference as the create's case source: by id, or by slug in its organization. */
function caseSourceOf(ref: string, agentOrg: string): EvalRunCaseSourceInput {
  const parsed = parseReference(ref, agentOrg, idPrefixOf(ApiResourceKind.plugin));
  return parsed.kind === "id"
    ? { plugin: { org: "", slug: "", id: parsed.id } }
    : { plugin: { org: parsed.org, slug: parsed.slug } };
}

/** An `--eval` reference as the create's case source: by id, or by slug in its organization, at its version. */
function evalSourceOf(target: EvalTarget, agentOrg: string): EvalRunCaseSourceInput {
  const parsed = parseReference(target.ref, agentOrg, idPrefixOf(ApiResourceKind.eval));
  const ref =
    parsed.kind === "id" ? { org: "", slug: "", id: parsed.id } : { org: parsed.org, slug: parsed.slug };
  return { eval: { ...ref, ...(target.version !== "" && { version: target.version }) } };
}

async function startEvalRun(client: Stigmer, subject: ResolvedSubject, options: EvalRunOptions): Promise<EvalRun> {
  try {
    return await client.evalrun.create({
      name: "",
      ...subject.input,
      targets: [...options.targets],
      runs: options.runs,
      ablation: options.ablation,
      ...(options.threshold !== undefined && { threshold: options.threshold }),
      caseGlob: options.caseGlob,
      caseTags: [...options.caseTags],
      judgeModel: options.judgeModel,
      maxCostUsd: options.maxCostUsd,
      concurrency: options.concurrency,
      allowTools: [...options.allowTools],
      realMcpServers: options.realMcpServers,
      allowRealServers: options.allowRealServers,
      skipScaffold: options.skipScaffold,
    });
  } catch (error) {
    return asStartRefusal(error);
  }
}

function documentOf(
  evalRun: EvalRun,
  subjectSlug: string,
  findings: readonly PluginWarning[],
  interrupted: boolean,
  nowMs: number,
  stillRunning: boolean,
): CliResultDocument {
  return {
    ...toResultDocument(evalRun, { interrupted, nowMs, subjectSlug }),
    findings: findings.map((finding) => ({ kind: finding.kind, path: finding.path, message: finding.message })),
    ...(stillRunning && { stillRunning: true as const }),
  };
}
