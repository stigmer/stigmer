/**
 * A plugin eval's one reader of a try: what the format's graders look at,
 * in Claude Code's names. The third reader of a turn beside `actionsOf`
 * (../checks/actions.ts, hashes for the free checks) and `subjectPartsOf`
 * (../judge/subject.ts, what the judge is shown), all three reading the
 * turn's session events through the fold every client uses (../turn.ts);
 * no grader depends on where the turn is stored. The files are the
 * exception: their bytes stay on the run (its file record and the files
 * the runner returned), and are read from there.
 *
 * The view (`EvalTrace`):
 *
 *   - the final message: the turn's last agent message with text;
 *   - the trace: the session as JSON, one message per line, in Claude
 *     Code's transcript shape (a user line for the request, an assistant
 *     line per agent message with its text and the `tool_use` blocks of
 *     the calls that follow it, a user line with the matching
 *     `tool_result` blocks), which is what an author's `trace` regex was
 *     written against. The log writes a message, then its tool uses, then
 *     their results, and no message for one without text; so a tool use
 *     after the previous uses' results opens an assistant line of its
 *     own, and a message's calls stay on its line. A block's id is the
 *     provider's call id (../turn.ts `callIdOf`);
 *   - the tool calls, each with its Claude name and its JSON-encoded
 *     input. An engine name reads as the Claude tool it covers
 *     (`@stigmer/tool-vocabulary` `claudeNameOf`): a tool that writes and
 *     edits reads as Write when its file was created in the run, as Edit
 *     otherwise. An MCP call reads as `mcp__<server>__<tool>`, its
 *     MCP server name already the name a turn gives a plugin's server,
 *     `plugin_<plugin>_<server>`, as Claude Code does. A read of a mounted
 *     skill's `SKILL.md` reads as `Skill {"skill": "<plugin>:<name>"}`,
 *     since Stigmer activates a skill by reading that file on both
 *     engines. The input is the
 *     engine's own arguments, which `input_match` patterns read by value;
 *   - the mock calls: each call to a server the try's case mocked (the
 *     run's own `spec.plugin_eval_case.mocks`, by the name the run gave
 *     the server), one JSON line each, `{"server", "tool", "input",
 *     "answer"}`, the server by its key in the plugin and the answer the
 *     mock gave, an error's text included;
 *   - the files: the paths created in the run (`kind` ADD in the change
 *     sets of the run's file record, RunStatus.file_changes) and the
 *     contents, after
 *     the run, of the paths the graders name, inline or read back through
 *     the run's artifact store when the runner offloaded them. A path no
 *     change set touched (a file a case's scaffold wrote and the try left
 *     alone) is read from the files the runner returned for the graders
 *     (`status.plugin_eval_files`); without them it is absent. A try with
 *     no scaffold starts in an empty non-git directory, so the record holds
 *     a change set only where the install has artifact storage; with none,
 *     the files are `not-recorded` and a file grader leaves the try not
 *     graded.
 *
 * Sub-agent threads are not traversed, as the other two readers do not
 * traverse them. A thinking, a harness note and a compaction add no line.
 *
 * The skill mounts, on both engines, rendered by
 * execute-deep-agent/prompt-builder.ts `renderSkillsSection` and
 * execute-cursor/prompt-builder.ts `formatSkillsSection`: an organization's
 * own skill at `.stigmer/skills/<name>/SKILL.md` in the workspace, a link
 * into the session's platform directory (`.../platform/skills/<name>/`,
 * the runner's shared/skill-resolver.ts); a plugin's skill inside the
 * plugin's mounted tree, `.stigmer/plugins/<digest>/<path>/SKILL.md`
 * (shared/plugin-mount.ts, harness/turn-context.ts `mountPluginSkills`),
 * named by the plugin's own list (`skillNames`, path to name).
 * SKILL_READ_PATH and PLUGIN_SKILL_READ_PATH must follow those mounts: when
 * a mount moves, a skill read stops reading as `Skill` and every
 * `tool_used: Skill` grader fails.
 *
 * Proven by __tests__/trace.test.ts, over a native and a Cursor transcript,
 * and ../__tests__/transcript-from-events.test.ts.
 */
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";

import { claudeNameOf } from "@stigmer/tool-vocabulary";
import type { ToolEngine } from "@stigmer/tool-vocabulary";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { PluginEvalFile } from "@stigmer/protos/ai/stigmer/agentic/run/v1/plugin_eval_case_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { eventIdOf } from "@stigmer/session-log";
import type { ToolUse } from "@stigmer/session-log";

import type { RunTranscript } from "../../session/events/run-events.js";
import { callIdOf, lastMessageOf, turnOfTranscript } from "../turn.js";

/** One tool call, in Claude Code's names. */
export interface EvalToolCall {
  /** The Claude tool name, the MCP name, `Skill`, or the engine's own name. */
  readonly name: string;
  /** The call's input as compact JSON; "{}" when the call carried none. */
  readonly input: string;
}

/** One file's content after the run, as a file target sees it. */
export type EvalFileContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary" }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string };

/** What the run's file capture recorded. */
export type EvalFiles =
  | { readonly kind: "not-recorded" }
  | {
      readonly kind: "recorded";
      /** Workspace-relative paths created in the run, in capture order. */
      readonly created: ReadonlyArray<string>;
      /** The contents of the paths the graders asked for, by workspace-relative path. */
      readonly contents: ReadonlyMap<string, EvalFileContent>;
    };

/** The graders' view of one try (the module header). */
export interface EvalTrace {
  readonly lastMessage: string;
  /** The session as JSON lines, one message per line. */
  readonly traceLines: ReadonlyArray<string>;
  readonly toolCalls: ReadonlyArray<EvalToolCall>;
  /** The calls to mocked servers, one JSON line each (the module header). */
  readonly mockCalls: ReadonlyArray<string>;
  readonly files: EvalFiles;
}

/**
 * A read of a mounted skill's file (the module header): the workspace link
 * or the platform directory it points at, the skill's name captured.
 */
export const SKILL_READ_PATH =
  /(?:^|\/)(?:\.stigmer|platform)\/skills\/([^/]+)\/SKILL\.md$/;

/**
 * A read of a plugin skill's file inside the plugin's mounted tree (the
 * module header): the skill's path in the plugin captured.
 */
export const PLUGIN_SKILL_READ_PATH =
  /(?:^|\/)(?:\.stigmer|platform)\/plugins\/[^/]+\/(.+)\/SKILL\.md$/;

/** The argument names a file tool carries its path in, on either engine. */
const PATH_ARGUMENTS = [
  "file_path",
  "path",
  "target_file",
  "filePath",
  "targetFile",
] as const;

/** What reading a try needs beyond its run. */
export interface EvalTraceDeps {
  /** The plugin's name, as the format's `<plugin>` in `Skill` and MCP names. */
  readonly pluginName: string;
  /** The engine the try ran on. */
  readonly harness: Harness;
  /** The plugin's skills' names by their path in the plugin (`PluginSkill.path`); none when absent. */
  readonly skillNames?: ReadonlyMap<string, string>;
  /** The workspace-relative paths whose content the graders read. */
  readonly wantedFiles: ReadonlyArray<string>;
  /** The run's artifact store, for content the runner offloaded. */
  readArtifact(storageKey: string): Promise<Uint8Array>;
}

/** The graders' view of `transcript`'s run (the module header). */
export async function evalTraceOf(
  transcript: RunTranscript,
  deps: EvalTraceDeps,
): Promise<EvalTrace> {
  const { run } = transcript;
  const turn = turnOfTranscript(transcript);
  const files = await filesOf(run, deps);
  const created = new Set(files.kind === "recorded" ? files.created : []);
  const engine: ToolEngine =
    deps.harness === Harness.CURSOR ? "cursor" : "native";
  const seqOf = new Map(
    transcript.events.map((event) => [eventIdOf(event), event.seq] as const),
  );

  const toolCalls: EvalToolCall[] = [];
  const traceLines: string[] = [];
  const mockCalls: string[] = [];
  const mockedServers = new Map(
    (run.spec?.pluginEvalCase?.mocks ?? []).map((mock) => [mock.segment, mock.server] as const),
  );
  traceLines.push(
    line({
      type: "user",
      message: {
        role: "user",
        content: turn?.userMessage?.text ?? run.spec?.message ?? "",
      },
    }),
  );

  let group: { text: string; uses: ToolUse[] } | undefined;
  const flush = (): void => {
    if (group === undefined) {
      return;
    }
    const content: JsonValue[] = [];
    if (group.text !== "") {
      content.push({ type: "text", text: group.text });
    }
    const results: JsonValue[] = [];
    for (const use of group.uses) {
      const named = namedCall(use, engine, deps, created);
      toolCalls.push(named);
      const text = use.result?.text ?? "";
      const errored = use.result?.isError === true;
      const mockedServer = mockedServers.get(use.mcpServerName);
      if (use.mcpServerName !== "" && mockedServer !== undefined) {
        mockCalls.push(
          line({ server: mockedServer, tool: use.name, input: use.input, answer: text }),
        );
      }
      content.push({
        type: "tool_use",
        id: callIdOf(use),
        name: named.name,
        input: JSON.parse(named.input) as JsonValue,
      });
      results.push({
        type: "tool_result",
        tool_use_id: callIdOf(use),
        content: text,
        ...(errored ? { is_error: true } : {}),
      });
    }
    traceLines.push(
      line({ type: "assistant", message: { role: "assistant", content } }),
    );
    if (results.length > 0) {
      traceLines.push(
        line({ type: "user", message: { role: "user", content: results } }),
      );
    }
    group = undefined;
  };
  for (const item of turn?.items ?? []) {
    switch (item.kind) {
      case "message":
        flush();
        group = { text: item.text, uses: [] };
        break;
      case "tool_use": {
        const at = seqOf.get(item.id) ?? 0n;
        const answered = group?.uses.some((use) => {
          const resultAt = seqOf.get(use.result?.id ?? "");
          return resultAt !== undefined && resultAt < at;
        });
        if (group === undefined || answered === true) {
          flush();
          group = { text: "", uses: [] };
        }
        group.uses.push(item);
        break;
      }
      case "thinking":
      case "note":
      case "compacted":
        break;
      /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
      default: {
        const exhausted: never = item;
        return exhausted;
      }
    }
  }
  flush();

  return { lastMessage: lastMessageOf(turn), traceLines, toolCalls, mockCalls, files };
}

function line(value: JsonObject): string {
  return JSON.stringify(value);
}

/** One call in Claude Code's names (the module header). */
function namedCall(
  use: ToolUse,
  engine: ToolEngine,
  deps: EvalTraceDeps,
  created: ReadonlySet<string>,
): EvalToolCall {
  const { pluginName } = deps;
  const args: JsonObject = use.input;
  const input = JSON.stringify(args);
  if (use.mcpServerName !== "") {
    return { name: `mcp__${use.mcpServerName}__${use.name}`, input };
  }
  const path = pathArgumentOf(args);
  const fileChange =
    path === undefined
      ? undefined
      : created.has(normalise(path))
        ? "add"
        : "modify";
  const name = claudeNameOf(engine, use.name, fileChange);
  if (name === "Read" && path !== undefined) {
    const pluginSkill = PLUGIN_SKILL_READ_PATH.exec(path)?.[1];
    const skill =
      pluginSkill === undefined
        ? SKILL_READ_PATH.exec(path)?.[1]
        : (deps.skillNames?.get(pluginSkill) ?? pluginSkill.split("/").pop());
    if (skill !== undefined) {
      return {
        name: "Skill",
        input: JSON.stringify({ skill: `${pluginName}:${skill}` }),
      };
    }
  }
  return { name, input };
}

function pathArgumentOf(args: JsonObject): string | undefined {
  for (const key of PATH_ARGUMENTS) {
    const value = args[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return undefined;
}

function normalise(path: string): string {
  let normalised = path.trim();
  while (normalised.startsWith("./")) {
    normalised = normalised.slice(2);
  }
  return normalised;
}

/**
 * The created paths and wanted contents from the run's file record: each
 * change set's captured files. A record with no change set is an install
 * that records no files (the module header).
 */
async function filesOf(run: Run, deps: EvalTraceDeps): Promise<EvalFiles> {
  const sets = run.status?.fileChanges ?? [];
  if (sets.length === 0) {
    return { kind: "not-recorded" };
  }
  const changes: CapturedFileChange[] = sets.flatMap((cs) => cs.changes);
  const created = new Set<string>();
  for (const change of changes) {
    const path = normalise(change.pathAfter);
    if (change.kind === FileChangeKind.ADD && path !== "") {
      created.add(path);
    }
  }
  const reported = new Map(
    (run.status?.pluginEvalFiles?.files ?? []).map((file) => [normalise(file.path), file] as const),
  );
  const contents = new Map<string, EvalFileContent>();
  for (const wanted of deps.wantedFiles) {
    const path = normalise(wanted);
    contents.set(path, await contentOf(changes, path, deps, reported.get(path)));
  }
  return { kind: "recorded", created: [...created], contents };
}

/** One path's content after the run: its last change, read back when offloaded. */
async function contentOf(
  changes: ReadonlyArray<CapturedFileChange>,
  path: string,
  deps: EvalTraceDeps,
  reported: PluginEvalFile | undefined,
): Promise<EvalFileContent> {
  let last: CapturedFileChange | undefined;
  for (const change of changes) {
    if (
      normalise(change.pathAfter) === path ||
      normalise(change.pathBefore) === path
    ) {
      last = change;
    }
  }
  if (last === undefined) {
    return reportedContent(reported);
  }
  if (
    last.kind === FileChangeKind.DELETE ||
    normalise(last.pathAfter) !== path
  ) {
    return { kind: "absent" };
  }
  const after = last.after;
  if (after?.isBinary === true || last.kind === FileChangeKind.BINARY_CHANGE) {
    return { kind: "binary" };
  }
  if (after === undefined) {
    return { kind: "text", text: "" };
  }
  switch (after.body.case) {
    case "inline":
      return { kind: "text", text: after.body.value };
    case "ref": {
      try {
        const bytes = await deps.readArtifact(after.body.value.storageKey);
        return { kind: "text", text: new TextDecoder().decode(bytes) };
      } catch (error) {
        return {
          kind: "unreadable",
          reason: `'${path}' could not be read back: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    case undefined:
      return { kind: "text", text: "" };
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = after.body;
      return exhausted;
    }
  }
}

/** A file no change set touched, as the runner returned it for the graders; absent when it returned none. */
function reportedContent(file: PluginEvalFile | undefined): EvalFileContent {
  switch (file?.content.case) {
    case "text":
      return { kind: "text", text: file.content.value };
    case "binary":
      return { kind: "binary" };
    case "unreadable":
      return { kind: "unreadable", reason: file.content.value };
    default:
      return { kind: "absent" };
  }
}
