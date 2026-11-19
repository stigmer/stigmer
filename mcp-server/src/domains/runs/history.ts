// Run history reads: list_runs, get_run_outputs and get_run_scores.
//
// A person asks their coding agent about runs that already happened ("what
// did invoice-checker find last time?", "why did last night's run fail?",
// "how was it graded?"). get_run reads one run by its id; these three find
// the run and read what it left behind:
//   - list_runs: one agent's runs, newest first, across its conversations
//     (RunQueryController.listByAgent), each with its phase, timing and its
//     error in one line, so "the last run" is the first entry, whichever
//     conversation took it.
//   - get_run_outputs: the Files the run saved in its outputs folder, newest
//     per place, the CLI's `stigmer download run` rule
//     (client-apps/cli/src/resources/download.ts). Text comes back inline
//     through FileQueryController.getContent, at most 512 KB a file with the
//     truncation said; anything else is named, never inlined. No signed
//     download link is ever returned: it opens the file without a sign-in
//     for days, a credential that has no place in a chat. Saving to disk is
//     the CLI's (`stigmer download run <id>`).
//   - get_run_scores: the run's scores (ScoreQueryController.listByRun), each
//     with where it came from, whether it was graded, its verdict, criteria
//     and comment. An empty list is an answer too: nobody rated the run, no
//     judge grades the agent, and no eval ran it.

import type { CallOptions, Transport } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import type { Score } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreQueryController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { rpcError } from "../rpcerr.js";
import { getRun, sessionIdOf } from "./fetch.js";

/** Runs list_runs returns when the caller names no limit. */
export const DEFAULT_RUN_LIMIT = 10;

/** The most runs one list_runs call returns. */
export const MAX_RUN_LIMIT = 50;

/** The most bytes of one output get_run_outputs inlines: the server's own cap. */
export const MAX_INLINE_OUTPUT_BYTES = 512 * 1024;

/** The most outputs get_run_outputs reads; a run that wrote more is told to download. */
const MAX_OUTPUTS = 50;

/** One run as list_runs reports it. */
interface RunLine {
  readonly run_id: string;
  readonly session_id: string;
  readonly phase: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly error?: string;
}

/** List one agent's runs, newest first (the module header). */
export async function listRuns(
  serverAddress: string,
  token: string,
  args: { readonly org: string; readonly agent: string; readonly limit: number },
): Promise<string> {
  const desc = `agent "${args.agent}" in org "${args.org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    let agentId: string;
    try {
      const agent = await createClient(AgentQueryController, transport).getByReference(
        { org: args.org, kind: ApiResourceKind.agent, slug: args.agent },
        callOptions,
      );
      agentId = agent.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }
    let runs: Run[];
    try {
      const page = await createClient(RunQueryController, transport).listByAgent(
        { agentId, pageSize: args.limit },
        callOptions,
      );
      runs = page.entries.slice(0, args.limit);
    } catch (err) {
      throw rpcError(err, `runs of ${desc}`);
    }
    const body = {
      agent: args.agent,
      runs: runs.map(runLine),
      ...(runs.length === 0
        ? { note: "This agent has no runs you can see. Start one with run_agent or `stigmer run`." }
        : {}),
    };
    return JSON.stringify(body, null, 2);
  });
}

function runLine(run: Run): RunLine {
  const target = run.spec?.target;
  const error = firstLine(run.status?.error ?? "");
  return {
    run_id: run.metadata?.id ?? "",
    session_id: target?.case === "sessionId" ? target.value : "",
    phase: phaseName(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED),
    started_at: run.status?.startedAt ?? "",
    completed_at: run.status?.completedAt ?? "",
    ...(error === "" ? {} : { error }),
  };
}

/** A run's phase as get_run's turn names it: lower case, no prefix. */
export function phaseName(phase: RunPhase): string {
  const name = RunPhase[phase] ?? "RUN_PHASE_UNSPECIFIED";
  return name === "RUN_PHASE_UNSPECIFIED" ? "unspecified" : name.replace(/^RUN_/, "").toLowerCase();
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 300 ? `${line.slice(0, 300)}... (cut here; get_run reads the whole error)` : line;
}

/** One output as get_run_outputs reports it. */
interface OutputEntry {
  readonly path: string;
  readonly file_id: string;
  readonly size_bytes: number;
  readonly mime_type: string;
  readonly content?: string;
  readonly truncated?: boolean;
  readonly note?: string;
}

/** Read what a run saved in its outputs folder (the module header). */
export async function getRunOutputs(
  serverAddress: string,
  token: string,
  args: { readonly runId: string; readonly path?: string },
): Promise<string> {
  if (args.runId === "") {
    throw new Error("run_id is required");
  }
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const run = await getRun(transport, callOptions, args.runId);
    const files = await newestPerPlace(transport, callOptions, run);
    const wanted = (args.path ?? "").trim();
    const chosen = wanted === "" ? files : files.filter((f) => matchesPath(f, wanted));
    if (wanted !== "" && chosen.length === 0) {
      const places = files.map(placeOf);
      throw new Error(
        `run "${args.runId}" saved no output at "${wanted}"` +
          (places.length === 0 ? "; it saved no outputs." : `; its outputs: ${places.join(", ")}.`),
      );
    }
    const read = chosen.slice(0, MAX_OUTPUTS);
    const outputs: OutputEntry[] = [];
    for (const file of read) {
      outputs.push(await outputEntry(transport, callOptions, file, args.runId));
    }
    const body = {
      run_id: args.runId,
      phase: phaseName(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED),
      outputs,
      ...(files.length === 0
        ? { note: "This run saved no files in its outputs folder; its answer is in get_run's turn.answer." }
        : {}),
      ...(chosen.length > read.length
        ? { more: `${chosen.length - read.length} more outputs; save them all with \`stigmer download run ${args.runId}\`.` }
        : {}),
      save: `stigmer download run ${args.runId} --output-dir <folder>`,
    };
    return JSON.stringify(body, null, 2);
  });
}

/** The run's Files, newest per place in its outputs folder (the CLI's rule). */
async function newestPerPlace(transport: Transport, callOptions: CallOptions, run: Run): Promise<File[]> {
  const query = createClient(FileQueryController, transport);
  const org = run.metadata?.org ?? "";
  const runId = run.metadata?.id ?? "";
  const byPlace = new Map<string, File>();
  let pageToken = "";
  try {
    do {
      const page = await query.list({ org, runId, pageToken }, callOptions);
      for (const file of page.entries) {
        const place = placeOf(file);
        if (!byPlace.has(place)) byPlace.set(place, file);
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
  } catch (err) {
    throw rpcError(err, `outputs of run "${runId}"`);
  }
  return [...byPlace.values()];
}

/** Where a File sits in the outputs folder; its filename when it has no path. */
function placeOf(file: File): string {
  const outputPath = file.status?.outputPath ?? "";
  return outputPath !== "" ? outputPath : (file.spec?.filename ?? "");
}

function matchesPath(file: File, wanted: string): boolean {
  const place = placeOf(file);
  return place === wanted || (file.spec?.filename ?? "") === wanted || place.endsWith(`/${wanted}`);
}

async function outputEntry(
  transport: Transport,
  callOptions: CallOptions,
  file: File,
  runId: string,
): Promise<OutputEntry> {
  const id = file.metadata?.id ?? "";
  const mimeType = file.spec?.mimeType ?? "";
  const base = {
    path: placeOf(file),
    file_id: id,
    size_bytes: Number(file.status?.sizeBytes ?? 0n),
    mime_type: mimeType,
  };
  if (!isTextType(mimeType, base.path)) {
    return { ...base, note: `Not text, so not shown here; save it with \`stigmer download run ${runId}\`.` };
  }
  let data: Uint8Array;
  let truncated: boolean;
  try {
    const content = await createClient(FileQueryController, transport).getContent(
      { id, maxBytes: BigInt(MAX_INLINE_OUTPUT_BYTES) },
      callOptions,
    );
    data = content.data;
    truncated = content.truncated;
  } catch (err) {
    throw rpcError(err, `output "${base.path}" of run "${runId}"`);
  }
  const text = decodeText(data, truncated);
  if (text === undefined) {
    return { ...base, note: `Not valid UTF-8 text; save it with \`stigmer download run ${runId}\`.` };
  }
  return {
    ...base,
    content: text,
    ...(truncated
      ? {
          truncated: true,
          note: `Only the first ${MAX_INLINE_OUTPUT_BYTES / 1024} KB is shown; save the whole file with \`stigmer download run ${runId}\`.`,
        }
      : {}),
  };
}

const TEXT_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "application/yaml",
  "application/x-yaml",
  "application/xml",
  "application/toml",
  "application/csv",
  "application/sql",
  "application/javascript",
  "application/typescript",
]);

const TEXT_EXTENSIONS = /\.(md|markdown|txt|csv|tsv|json|jsonl|ya?ml|xml|html?|toml|log|sql|js|ts|py|sh)$/i;

/** Text by its media type, or, with none recorded, by its extension. */
export function isTextType(mimeType: string, path: string): boolean {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "") return TEXT_EXTENSIONS.test(path);
  return type.startsWith("text/") || TEXT_TYPES.has(type) || type.endsWith("+json") || type.endsWith("+xml");
}

/**
 * The bytes as UTF-8, or undefined when they aren't. A cut at the size cap
 * may split a character, so a truncated read drops an incomplete tail first.
 */
function decodeText(data: Uint8Array, truncated: boolean): string | undefined {
  const bytes = truncated ? data.subarray(0, completeUtf8Length(data)) : data;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** The length of the longest prefix that ends on a whole UTF-8 character. */
function completeUtf8Length(data: Uint8Array): number {
  let i = data.length - 1;
  let continuation = 0;
  while (i >= 0 && continuation < 4 && ((data[i] ?? 0) & 0xc0) === 0x80) {
    i -= 1;
    continuation += 1;
  }
  if (i < 0) return data.length;
  const lead = data[i] ?? 0;
  const need = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0;
  return need > continuation ? i : data.length;
}

/** Read a run's scores (the module header). */
export async function getRunScores(serverAddress: string, token: string, runId: string): Promise<string> {
  if (runId === "") {
    throw new Error("run_id is required");
  }
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const run = await getRun(transport, callOptions, runId);
    const query = createClient(ScoreQueryController, transport);
    const scores: Score[] = [];
    let pageToken = "";
    try {
      do {
        const page = await query.listByRun({ runId, pageToken }, callOptions);
        scores.push(...page.entries);
        pageToken = page.nextPageToken;
      } while (pageToken !== "" && scores.length < 200);
    } catch (err) {
      throw rpcError(err, `scores of run "${runId}"`);
    }
    const body = {
      run_id: runId,
      session_id: sessionIdOf(run),
      scores: scores.map(scoreView),
      ...(scores.length === 0
        ? {
            note:
              "No scores: nobody rated this run, no AI judge grades this agent, and no eval ran it. " +
              "Say it was not graded rather than guess a quality.",
          }
        : {}),
      ...(scores.length > 0 && !scores.some((s) => s.spec?.source === ScoreSource.judge)
        ? { judge: "No AI judge graded this run." }
        : {}),
    };
    return JSON.stringify(body, null, 2);
  });
}

function scoreView(score: Score): Record<string, unknown> {
  const spec = score.spec;
  const status = score.status;
  const state = status?.state ?? ScoreState.unspecified;
  const value = spec?.value;
  return {
    metric: spec?.metric ?? "",
    source: sourceName(spec?.source ?? ScoreSource.unspecified),
    state: stateName(state),
    ...(value?.case === "passed" ? { passed: value.value } : {}),
    ...(status?.notGradedReason ? { not_graded_reason: status.notGradedReason } : {}),
    ...(spec?.judgeModel ? { judge_model: spec.judgeModel } : {}),
    ...(spec?.comment ? { comment: spec.comment } : {}),
    criteria: (spec?.criteria ?? []).map((c) => ({
      name: c.name,
      result: criterionName(c.result),
      ...(c.reason === "" ? {} : { reason: c.reason }),
    })),
    created_at: score.status?.audit?.specAudit?.createdAt
      ? new Date(Number(score.status.audit.specAudit.createdAt.seconds) * 1000).toISOString()
      : "",
  };
}

const SOURCE_NAMES: Record<number, string> = {
  [ScoreSource.check]: "check (the platform's run-health check)",
  [ScoreSource.human]: "person",
  [ScoreSource.judge]: "judge (an AI judge)",
  [ScoreSource.eval]: "eval",
};

function sourceName(source: ScoreSource): string {
  return SOURCE_NAMES[source] ?? "unspecified";
}

function stateName(state: ScoreState): string {
  switch (state) {
    case ScoreState.graded:
      return "graded";
    case ScoreState.not_graded:
      return "not graded";
    case ScoreState.pending:
      return "pending";
    default:
      return "unspecified";
  }
}

function criterionName(result: CriterionResult): string {
  switch (result) {
    case CriterionResult.passed:
      return "passed";
    case CriterionResult.failed:
      return "failed";
    case CriterionResult.not_applicable:
      return "not applicable";
    default:
      return "unspecified";
  }
}
