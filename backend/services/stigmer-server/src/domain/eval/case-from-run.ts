/**
 * An eval case built from a run: the one builder `buildCaseFromRun` and
 * `addCaseFromRun` share (controller.ts), so every surface that turns a bad
 * turn into a test case (the CLI, the SDK, the console) gets the same case.
 *
 * The case is the turn the run answered, in Claude Code's plugin-eval
 * format, under `<case>/`:
 *
 *   - `prompt.md`: the turn's user message as the session recorded it (what
 *     the model was given, a channel's digest included), else the run's
 *     request, behind an empty frontmatter block: the case takes the
 *     format's defaults and the agent's own tools, and a request that opens
 *     with a `---` block of its own is still read whole as the prompt;
 *   - `history.jsonl` and `case.yaml` (`context.history_file`), when the
 *     session holds turns before this one (in the log's order; for a turn
 *     that recorded no events, the runs created before it): every earlier
 *     run, superseded ones included, because the runner resumes a session as the model saw
 *     it (`RunSpec.supersedes_run_id` is display-only). Each turn is written
 *     by the graders' own transcript writer (../score/eval/trace.ts
 *     `evalTraceOf`), so a history reads as an eval run's trace does; a
 *     tool call that never returned is written with an empty answer;
 *   - `mocks/<server>/<tool>.md`: a fixed stand-in for each MCP tool the
 *     run called, under the server name the turn gave it (an agent's own
 *     server by its name, a plugin's as `plugin_<plugin>_<server>`), the
 *     name an eval run resolves a pushed eval's mocks by; its body is the
 *     recorded answer, `error: true` when the call failed. A tool answered
 *     differently on later calls keeps its first answer. The platform's
 *     own servers (named `stigmer…`, a name no agent may take) get no mock:
 *     they are not the agent's to stand in for;
 *   - `mocks/<server>/_tools.json`, the server's tools as the model was
 *     offered them in the turn (a `tools/list` result holding each mocked
 *     tool's description and input schema), read from the turn's
 *     `stigmer.mcp.tool_definition` events, one per server and tool a run
 *     called. An eval run's stand-in offers the model those definitions, so
 *     the replay is shown the tool the run was shown; a mocked tool with no
 *     definition is offered a generic description and an input schema that
 *     accepts anything, as before definitions were recorded. A case's file
 *     replaces its suite's `_tools.json` for that server whole (the format
 *     merges a case's mocks over its suite's file by file), so a case added
 *     to an eval ({@link CaseFromRunInput.suiteText}) also lists the tools
 *     the eval's own `mocks/<server>/_tools.json` holds, the turn's
 *     definitions winning per tool, and a tool the suite defines is not
 *     noted as undefined;
 *   - `graders/criteria.md`: an `llm` rubric whose PASS line the author
 *     writes and whose FAIL line names what went wrong: the first failing
 *     reason of the run's AI judge, else of its eval run, else the caller's
 *     own thumbs-down note. It is a stub, never a verdict;
 *   - `graders/skill-fired.md`, when the caller names a skill the run
 *     should have read: a `tool_used: Skill` check, by the skill's bare or
 *     plugin-qualified name.
 *
 * Every way the case differs from the run is a note: an answer kept from
 * the first of several, an answer longer than the session keeps inline,
 * a platform tool, a name no mock file can hold, a call that never
 * returned, a mocked tool the turn recorded no definition of (a turn
 * recorded before definitions were) or whose input schema was too large
 * to record, a request's attachments, a history the conversation's own
 * engine cannot resume (`@stigmer/plugin-package`
 * `EVAL_ENGINE_UNSUPPORTED_FEATURES`).
 *
 * Proven by __tests__/case-from-run.test.ts: each part over a run's stored
 * events, and every case it builds loads through the library's
 * `readEvalFolder` with no finding.
 */
import { createHash } from "node:crypto";

import { create, type JsonObject } from "@bufbuild/protobuf";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";

import { parseToolsList, type SavedTool } from "@stigmer/eval-runtime";
import { EVAL_ENGINE_UNSUPPORTED_FEATURES, isToolNameSegment, type EvalEngine } from "@stigmer/plugin-package";
import { EvalCaseArchiveSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import type { EvalCaseArchive } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionEvent, StigmerMcpToolDefinitionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { Score } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult, ScoreSource } from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ToolUse } from "@stigmer/session-log";

import { writeArchive } from "../../archive/write.js";
import type { ArchiveFile } from "../../archive/write.js";
import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { sessionIdOf } from "../run/target.js";
import { EVAL_METRIC, FEEDBACK_METRIC, JUDGE_METRIC } from "../score/constants.js";
import { EVAL_ENGINES } from "../eval-run/matrix.js";
import { evalTraceOf } from "../score/eval/trace.js";
import { listRunScores } from "../score/queries.js";
import { toolUsesOf, turnOfTranscript } from "../score/turn.js";
import { readSessionEvents } from "../session/events/run-events.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import { MAX_CASE_ARCHIVE_BYTES, evalCaseSkillMessage, evalCaseTooLargeMessage } from "./constants.js";

/** The harnesses a recorded history resumes on, as a case's note names them. */
const RESUMING_HARNESSES = [...new Map(Object.values(EVAL_ENGINES).map((engine) => [engine.word, engine.label])).entries()]
  .filter(([word]) => !EVAL_ENGINE_UNSUPPORTED_FEATURES[word].includes("resumed conversations"))
  .map(([, label]) => `the ${label} harness`)
  .join(" or ");

/** What a case is built from. */
export interface CaseFromRunInput {
  readonly run: Run;
  /** The case's directory name; "" suggests one from the request. */
  readonly caseName: string;
  /** A skill the run should have read, "<plugin>:<skill>" as {@link caseSkillOf} reads it; "" adds no check. */
  readonly skill: string;
  /** The caller's identity: whose thumbs-down note seeds the rubric. */
  readonly callerId: string;
  /**
   * The eval the case is added to: one of its files' text, by its path from
   * the suite's root, or undefined when it holds none. Absent when the case
   * is answered for the caller to place, whose suite the server cannot see.
   */
  readonly suiteText?: (path: string) => string | undefined;
}

/** The case folder: its name, its files under `<case>/`, and how it differs from the run. */
export interface BuiltCase {
  readonly caseName: string;
  readonly files: ReadonlyArray<ArchiveFile>;
  readonly notes: ReadonlyArray<string>;
}

/** The longest name {@link suggestCaseName} returns. */
const MAX_CASE_NAME = 48;

/** The case name a request with no letters or digits gets. */
export const DEFAULT_CASE_NAME = "case-from-run";

/**
 * Names a suite's root keeps for itself (the library skips them as
 * cases): a case so named would be read as the suite's mocks or run
 * output.
 */
export const RESERVED_CASE_NAMES: ReadonlySet<string> = new Set(["mocks", "results"]);

/** The prefix of the platform's own MCP servers, which an agent may not take. */
const PLATFORM_SERVER_PREFIX = "stigmer";

/** A tool name a mock file can carry as is: no path separator, no dot, not the reserved `_server`/`_tools`. */
const MOCK_TOOL_NAME = /^[A-Za-z0-9-][A-Za-z0-9_-]*$/;

const encoder = new TextEncoder();

/** Builds the case `input.run`'s turn makes (the module header). */
export async function buildCaseFromRun(store: Store, logger: Logger, input: CaseFromRunInput): Promise<BuiltCase> {
  const { run } = input;
  const runId = run.metadata?.id ?? "";
  const sessionId = sessionIdOf(run.spec);
  const events = sessionId === "" ? [] : await readSessionEvents(store, sessionId, {});
  const turns = turnsOf(events);
  const own = turns.find((turn) => turn.runId === runId);
  const earlier = await earlierTurnsOf(store, run, turns, own);
  const turn = turnOfTranscript({ run, events: own?.events ?? [] });
  const request = turn?.userMessage?.text || run.spec?.message || "";
  const caseName = input.caseName !== "" ? input.caseName : suggestCaseName(request);
  const notes: string[] = [];
  const files: Array<{ readonly path: string; readonly content: string }> = [{ path: "prompt.md", content: promptFile(request) }];

  if (earlier.length > 0) {
    const harness = await harnessOf(store, sessionId);
    const lines: string[] = [];
    let unanswered = 0;
    for (const previous of earlier) {
      const transcript = { run: previous.row, events: previous.turn.events };
      const trace = await evalTraceOf(transcript, {
        pluginName: "",
        harness,
        pluginsByDigest: new Map(),
        wantedFiles: [],
        /* v8 ignore next -- @preserve: wantedFiles is empty, so the trace reads no file */
        readArtifact: () => Promise.reject(new Error("a history reads no file")),
      });
      lines.push(...trace.traceLines);
      unanswered += toolUsesOf(turnOfTranscript(transcript)).filter((use) => use.result === undefined).length;
    }
    files.push({ path: "history.jsonl", content: `${lines.join("\n")}\n` });
    files.push({
      path: "case.yaml",
      content: `schema_version: "1.1"\nname: ${caseName}\ncontext:\n  history_file: history.jsonl\n`,
    });
    if (unanswered > 0) {
      notes.push(`${count(unanswered, "tool call")} in the conversation before this turn never returned; the history records ${unanswered === 1 ? "it" : "them"} with an empty answer`);
    }
    const engine = EVAL_ENGINES[harness];
    if (EVAL_ENGINE_UNSUPPORTED_FEATURES[engine.word].includes("resumed conversations")) {
      notes.push(`the conversation ran on the ${engine.label} harness, which cannot resume a recorded history: the case runs on ${RESUMING_HARNESSES} only`);
    }
  }

  files.push(...mockFilesOf(toolUsesOf(turn), definitionsOf(own?.events ?? []), input.suiteText, notes));
  files.push({ path: "graders/criteria.md", content: criteriaFile(failureOf(await listRunScores(store, logger, runId), input.callerId)) });
  if (input.skill !== "") {
    files.push({ path: "graders/skill-fired.md", content: skillFiredFile(input.skill) });
  }
  const fileIds = run.spec?.fileIds ?? [];
  if (fileIds.length > 0) {
    notes.push(`the message's files are not part of the case: ${fileIds.join(", ")}`);
  }
  return {
    caseName,
    files: files.map((file) => ({ path: `${caseName}/${file.path}`, bytes: encoder.encode(file.content) })),
    notes,
  };
}

/**
 * A request's skill as a case names it: "" for none, else
 * `<plugin>:<skill>` with both parts written and no control character, as
 * the CLI's `--skill` takes it; anything else is refused (INVALID_ARGUMENT,
 * naming it), so no request writes a check for a skill it never named.
 */
export function caseSkillOf(raw: string): string {
  if (raw === "") return "";
  const colon = raw.indexOf(":");
  const plugin = colon < 0 ? "" : raw.slice(0, colon).trim();
  const skill = colon < 0 ? "" : raw.slice(colon + 1).trim();
  if (plugin === "" || skill === "" || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw invalidArgumentError(evalCaseSkillMessage(raw));
  }
  return `${plugin}:${skill}`;
}

/**
 * The case as the archive buildCaseFromRun answers: its files zipped as the
 * CLI zips a folder, its digest, its notes. One past `limit` bytes is
 * refused (RESOURCE_EXHAUSTED), since it could not travel inline.
 */
export function caseArchiveOf(built: BuiltCase, limit = MAX_CASE_ARCHIVE_BYTES): EvalCaseArchive {
  const artifact = writeArchive(built.files);
  if (artifact.length > limit) {
    throw new ConnectError(evalCaseTooLargeMessage(artifact.length, limit), Code.ResourceExhausted);
  }
  return create(EvalCaseArchiveSchema, {
    caseName: built.caseName,
    artifact,
    digest: createHash("sha256").update(artifact).digest("hex"),
    notes: [...built.notes],
  });
}

/**
 * A case name from a request, as `claude plugin eval init` names a case
 * after its prompt: lower-case words joined by dashes, at most 48
 * characters, cut at a word (a first word longer than that is cut
 * itself). A request with no letters or digits is "case-from-run", and a
 * name the suite's root keeps for itself gains "-case".
 */
export function suggestCaseName(request: string): string {
  const words = request
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  let name = "";
  for (const word of words) {
    const next = name === "" ? word : `${name}-${word}`;
    if (next.length > MAX_CASE_NAME) break;
    name = next;
  }
  const suggested = name !== "" ? name : (words[0]?.slice(0, MAX_CASE_NAME) ?? DEFAULT_CASE_NAME);
  return RESERVED_CASE_NAMES.has(suggested) ? `${suggested}-case` : suggested;
}

/** One run's events in the session, and where in the log it starts. */
interface SessionTurn {
  readonly runId: string;
  readonly firstSeq: bigint;
  readonly events: SessionEvent[];
}

/** The session's events grouped by run, in the order each run starts; events of no run are left out. */
function turnsOf(events: ReadonlyArray<SessionEvent>): SessionTurn[] {
  const turns = new Map<string, SessionTurn>();
  for (const event of events) {
    if (event.runId === "") continue;
    const turn = turns.get(event.runId);
    if (turn === undefined) {
      turns.set(event.runId, { runId: event.runId, firstSeq: event.seq, events: [event] });
    } else {
      turn.events.push(event);
    }
  }
  return [...turns.values()];
}

/**
 * The session's turns before the run's, each with its run's row (its id
 * alone when the row is gone): those that start earlier in the log; for a
 * run that recorded no events of its own, those whose run was created
 * before it. A run with no creation time, or whose row is gone, cannot be
 * placed then, and is left out.
 */
async function earlierTurnsOf(
  store: Store,
  run: Run,
  turns: ReadonlyArray<SessionTurn>,
  own: SessionTurn | undefined,
): Promise<Array<{ readonly turn: SessionTurn; readonly row: Run }>> {
  const runId = run.metadata?.id ?? "";
  const others = turns.filter((turn) => turn.runId !== runId);
  if (own !== undefined) {
    const before = others.filter((turn) => turn.firstSeq < own.firstSeq);
    return Promise.all(before.map(async (turn) => ({ turn, row: await runOrStub(store, turn.runId) })));
  }
  const createdAt = createdAtMs(run);
  if (createdAt === undefined) return [];
  const placed = await Promise.all(others.map(async (turn) => ({ turn, row: await runOrStub(store, turn.runId) })));
  return placed.filter(({ row }) => {
    const at = createdAtMs(row);
    return at !== undefined && at < createdAt;
  });
}

/** When a run's row was created; undefined when it carries no stamp. */
function createdAtMs(run: Run): number | undefined {
  const at = run.status?.audit?.specAudit?.createdAt;
  return at === undefined ? undefined : timestampMs(at);
}

/** The engine the session runs on; native when its row is gone. */
async function harnessOf(store: Store, sessionId: string): Promise<Harness> {
  try {
    return (await store.getResource(ApiResourceKind.session, sessionId, SessionSchema)).spec?.harness ?? Harness.UNSPECIFIED;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) return Harness.UNSPECIFIED;
    throw error;
  }
}

/** An earlier run's row, or its id alone when the row is gone (its events still say what it did). */
async function runOrStub(store: Store, runId: string): Promise<Run> {
  try {
    return await store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return create(RunSchema, { metadata: { id: runId } });
    }
    throw error;
  }
}

/** What the turn recorded of each MCP tool it called, by `<server>.<tool>`; the first of a tool's records is kept. */
function definitionsOf(events: ReadonlyArray<SessionEvent>): Map<string, StigmerMcpToolDefinitionEvent> {
  const definitions = new Map<string, StigmerMcpToolDefinitionEvent>();
  for (const event of events) {
    if (event.event.case !== "stigmerMcpToolDefinition") continue;
    const definition = event.event.value;
    const call = `${definition.mcpServerName}.${definition.name}`;
    if (!definitions.has(call)) definitions.set(call, definition);
  }
  return definitions;
}

/** The fixed mocks for the turn's MCP calls and each mocked server's `_tools.json` (the module header), each difference noted. */
function mockFilesOf(
  uses: ReadonlyArray<ToolUse>,
  definitions: ReadonlyMap<string, StigmerMcpToolDefinitionEvent>,
  suiteText: CaseFromRunInput["suiteText"],
  notes: string[],
): Array<{ path: string; content: string }> {
  const kept = new Map<string, { readonly use: ToolUse; differing: number }>();
  const platform = new Set<string>();
  const unnamed = new Set<string>();
  const unanswered = new Set<string>();
  for (const use of uses) {
    const server = use.mcpServerName;
    if (server === "") continue;
    const call = `${server}.${use.name}`;
    if (server.startsWith(PLATFORM_SERVER_PREFIX)) {
      platform.add(server);
      continue;
    }
    if (!isToolNameSegment(server) || !MOCK_TOOL_NAME.test(use.name)) {
      unnamed.add(call);
      continue;
    }
    if (use.result === undefined) {
      if (!kept.has(call)) unanswered.add(call);
      continue;
    }
    const first = kept.get(call);
    if (first === undefined) {
      unanswered.delete(call);
      kept.set(call, { use, differing: 0 });
    } else if (first.use.result?.text !== use.result.text || first.use.result?.isError !== use.result.isError) {
      first.differing += 1;
    }
  }
  for (const [call, { use, differing }] of kept) {
    if (differing > 0) {
      notes.push(`${call} answered differently on ${count(differing, "later call")}; its mock keeps the first answer`);
    }
    if (use.fullOutput !== undefined) {
      notes.push(`${call} answered more than the session keeps inline; its mock holds the part the session kept`);
    }
    // A mock body's {{input...}} and {{file:...}} are placeholders the
    // mock fills per call (eval-runtime mock.ts), so a recorded answer
    // holding one would not replay as recorded.
    if ((use.result?.text ?? "").includes("{{")) {
      notes.push(`${call} answered with text a mock reads as a placeholder ("{{"); check its mock replays the answer as recorded`);
    }
  }
  for (const call of unanswered) {
    notes.push(`${call} never returned, so it has no mock`);
  }
  for (const server of platform) {
    notes.push(`${server} is the platform's own server; the case calls it for real`);
  }
  for (const call of unnamed) {
    notes.push(`${call} has a name no mock file can carry, so it has no mock`);
  }
  const mocks = [...kept.values()].map(({ use }) => ({
    path: `mocks/${use.mcpServerName}/${use.name}.md`,
    content: `---\ntype: fixed\n${use.result?.isError === true ? "error: true\n" : ""}---\n${use.result?.text ?? ""}`,
  }));
  return [...mocks, ...toolsFilesOf([...kept.values()].map(({ use }) => use), definitions, suiteText, notes)];
}

/** One tool of a `_tools.json`, in MCP's `tools/list` shape. */
interface ListedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: JsonObject;
}

/**
 * Each mocked server's `_tools.json`: its mocked tools as the turn offered
 * them, then, for a case added to an eval, the tools the suite's own file
 * for that server lists and the turn did not record (the module header). A
 * definition whose schema was too large to record takes the suite's schema
 * for that tool when it has one. A server with no recorded definition gets
 * no file, so a suite's file still applies whole. A called tool that
 * neither defines is noted, as is a schema neither holds.
 */
function toolsFilesOf(
  mocked: ReadonlyArray<ToolUse>,
  definitions: ReadonlyMap<string, StigmerMcpToolDefinitionEvent>,
  suiteText: CaseFromRunInput["suiteText"],
  notes: string[],
): Array<{ path: string; content: string }> {
  const byServer = new Map<string, ListedTool[]>();
  const undefinedCalls: string[] = [];
  const omitted: string[] = [];
  const suites = new Map<string, ReadonlyMap<string, SavedTool>>();
  const suiteOf = (server: string): ReadonlyMap<string, SavedTool> => {
    let suite = suites.get(server);
    if (suite === undefined) {
      const text = suiteText?.(`mocks/${server}/_tools.json`);
      suite = new Map((text === undefined ? [] : parseToolsList(text)).map((tool) => [tool.name, tool]));
      suites.set(server, suite);
    }
    return suite;
  };
  for (const use of mocked) {
    const call = `${use.mcpServerName}.${use.name}`;
    const definition = definitions.get(call);
    const saved = suiteOf(use.mcpServerName).get(use.name);
    if (definition === undefined) {
      if (saved === undefined) undefinedCalls.push(call);
      continue;
    }
    const inputSchema = definition.inputSchema ?? (saved?.inputSchema as JsonObject | undefined);
    if (definition.inputSchemaOmitted && inputSchema === undefined) omitted.push(call);
    const tools = byServer.get(use.mcpServerName) ?? [];
    tools.push({ name: use.name, description: definition.description, ...(inputSchema === undefined ? {} : { inputSchema }) });
    byServer.set(use.mcpServerName, tools);
  }
  if (undefinedCalls.length > 0) {
    notes.push(
      `the turn recorded no definition of ${undefinedCalls.join(", ")} (it ran before tools' definitions were recorded, or its server's tools could not be listed): ` +
        `${undefinedCalls.length === 1 ? "its mock offers" : "their mocks offer"} a generic description and an input schema that accepts anything`,
    );
  }
  if (omitted.length > 0) {
    notes.push(
      `${omitted.join(", ")} had an input schema too large to record: ` +
        `${omitted.length === 1 ? "its mock offers its" : "their mocks offer their"} description with an input schema that accepts anything`,
    );
  }
  return [...byServer].map(([server, recorded]) => {
    const names = new Set(recorded.map((tool) => tool.name));
    const rest = [...suiteOf(server).values()].filter((tool) => !names.has(tool.name));
    return { path: `mocks/${server}/_tools.json`, content: `${JSON.stringify({ tools: [...recorded, ...rest] }, null, 2)}\n` };
  });
}

/**
 * What went wrong, in one line: the first failing reason of the run's AI
 * judge, else of its eval run, else the caller's own thumbs-down note; ""
 * when none says.
 */
function failureOf(scores: ReadonlyArray<Score>, callerId: string): string {
  for (const metric of [JUDGE_METRIC, EVAL_METRIC]) {
    for (const score of scores) {
      if (score.spec?.metric !== metric) continue;
      for (const criterion of score.spec.criteria) {
        const reason = oneLine(criterion.reason);
        if (criterion.result === CriterionResult.failed && reason !== "") return reason;
      }
    }
  }
  for (const score of scores) {
    const spec = score.spec;
    const thumbsDown = spec?.metric === FEEDBACK_METRIC && spec.source === ScoreSource.human && spec.value.case === "passed" && !spec.value.value;
    const own = (score.status?.audit?.specAudit?.createdBy?.id ?? "") === callerId;
    const note = oneLine(spec?.comment ?? "");
    if (thumbsDown && own && note !== "") return note;
  }
  return "";
}

/**
 * The prompt file: the request verbatim behind an empty frontmatter block.
 * The format reads a leading `---` block as the case's settings, so a
 * request that opens with one of its own (a sender's `allowed_tools`, a
 * lone rule) would otherwise choose the case's tools or fail it; behind
 * the empty block, the body is read whole as the prompt.
 */
function promptFile(request: string): string {
  return `---\n---\n${request.trim()}\n`;
}

function criteriaFile(failure: string): string {
  const fail =
    failure === ""
      ? "FAIL if <what a wrong or missing response looks like>."
      : `FAIL if the response repeats what went wrong in the run this case was made from: ${withStop(failure)}`;
  return `---\ntype: llm\n---\n\nPASS if <what a correct response contains>.\n${fail}\n`;
}

/** A `tool_used: Skill` check matching `skill` by its bare or plugin-qualified name. */
function skillFiredFile(skill: string): string {
  const bare = skill.slice(skill.indexOf(":") + 1);
  // The pattern sits in a single-quoted YAML scalar, where a quote is
  // written twice; the skill name is escaped as regex text first.
  const pattern = `"skill"\\s*:\\s*"(?:[\\w-]+:)?${escapeRegex(bare)}"`.replaceAll("'", "''");
  return `---\ntype: tool_used\ntool: Skill\ninput_match: '${pattern}'\n---\n`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}

function withStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
