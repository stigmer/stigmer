/**
 * A plugin eval's one reader of a try's transcript: what the format's
 * graders look at, in Claude Code's names. The third named reader of a
 * run's transcript beside `actionsOf` (../checks/actions.ts, hashes for
 * the free checks) and `subjectOf` (../judge/subject.ts, the judge's
 * document); when the transcript moves off the run's status onto a session
 * event log, these three are rewritten and no grader changes.
 *
 * The view (`EvalTrace`):
 *
 *   - the final message: the run's last assistant message;
 *   - the trace: the session as JSON, one message per line, in Claude
 *     Code's transcript shape (a user line for the request, an assistant
 *     line per assistant message with its text and `tool_use` blocks, a
 *     user line with the matching `tool_result` blocks), which is what an
 *     author's `trace` regex was written against;
 *   - the tool calls, each with its Claude name and its JSON-encoded
 *     input. An engine name reads as the Claude tool it covers
 *     (`@stigmer/tool-vocabulary` `claudeNameOf`): a tool that writes and
 *     edits reads as Write when its file was created in the run, as Edit
 *     otherwise. An MCP call reads as `mcp__plugin_<plugin>_<server>__<tool>`
 *     from its `mcp_server_slug`. A read of a mounted skill's `SKILL.md`
 *     reads as `Skill {"skill": "<plugin>:<name>"}`, since Stigmer activates
 *     a skill by reading that file on both engines. The input is the
 *     engine's own arguments, which `input_match` patterns read by value;
 *   - the files: the paths created in the run (`kind` ADD in the
 *     file-review ledger's captured change sets) and the contents, after
 *     the run, of the paths the graders name, inline or read back through
 *     the run's artifact store when the runner offloaded them. A try's
 *     workspace is an empty non-git directory, so the ledger holds a change
 *     set only where the install has artifact storage; with none, the
 *     files are `not-recorded` and a file grader leaves the try not graded.
 *
 * Sub-agent runs are not traversed, as the other two readers do not
 * traverse them.
 *
 * The skill mount: the runner writes each skill's file at
 * `.stigmer/skills/<name>/SKILL.md` in the workspace, a link into the
 * session's platform directory (`.../platform/skills/<name>/SKILL.md`), on
 * both engines (the runner's shared/skill-resolver.ts, rendered by
 * execute-deep-agent/prompt-builder.ts `renderSkillsSection` and
 * execute-cursor/prompt-builder.ts `formatSkillsSection`). SKILL_READ_PATH
 * must follow that mount: when the mount moves, a skill read stops reading
 * as `Skill` and every `tool_used: Skill` grader fails.
 *
 * Proven by __tests__/trace.test.ts, over a native and a Cursor transcript.
 */
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";

import { claudeNameOf } from "@stigmer/tool-vocabulary";
import type { ToolEngine } from "@stigmer/tool-vocabulary";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeKind,
  FileReviewEventType,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

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
  readonly files: EvalFiles;
}

/**
 * A read of a mounted skill's file (the module header): the workspace link
 * or the platform directory it points at, the skill's name captured.
 */
export const SKILL_READ_PATH =
  /(?:^|\/)(?:\.stigmer|platform)\/skills\/([^/]+)\/SKILL\.md$/;

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
  /** The workspace-relative paths whose content the graders read. */
  readonly wantedFiles: ReadonlyArray<string>;
  /** The run's artifact store, for content the runner offloaded. */
  readArtifact(storageKey: string): Promise<Uint8Array>;
}

/** The graders' view of `run` (the module header). */
export async function evalTraceOf(
  run: Run,
  deps: EvalTraceDeps,
): Promise<EvalTrace> {
  const files = await filesOf(run, deps);
  const created = new Set(files.kind === "recorded" ? files.created : []);
  const engine: ToolEngine =
    deps.harness === Harness.CURSOR ? "cursor" : "native";
  const messages = run.status?.messages ?? [];

  const toolCalls: EvalToolCall[] = [];
  const traceLines: string[] = [];
  if (!messages.some((message) => message.type === MessageType.MESSAGE_HUMAN)) {
    traceLines.push(
      line({
        type: "user",
        message: { role: "user", content: run.spec?.message ?? "" },
      }),
    );
  }
  for (const message of messages) {
    switch (message.type) {
      case MessageType.MESSAGE_HUMAN:
        traceLines.push(
          line({
            type: "user",
            message: { role: "user", content: message.content },
          }),
        );
        break;
      case MessageType.MESSAGE_AI: {
        const content: JsonValue[] = [];
        if (message.content !== "") {
          content.push({ type: "text", text: message.content });
        }
        const results: JsonValue[] = [];
        for (const call of message.toolCalls) {
          const named = namedCall(call, engine, deps.pluginName, created);
          toolCalls.push(named);
          content.push({
            type: "tool_use",
            id: call.id,
            name: named.name,
            input: JSON.parse(named.input) as JsonValue,
          });
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: call.error !== "" ? call.error : call.result,
            ...(call.error !== "" ? { is_error: true } : {}),
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
        break;
      }
      case MessageType.MESSAGE_TOOL:
        traceLines.push(
          line({
            type: "user",
            message: {
              role: "user",
              content: [{ type: "tool_result", content: message.content }],
            },
          }),
        );
        break;
      case MessageType.MESSAGE_SYSTEM:
      case MessageType.MESSAGE_THINKING:
      case MessageType.MESSAGE_TYPE_UNSPECIFIED:
        break;
      default: {
        const exhausted: never = message.type;
        return exhausted;
      }
    }
  }

  return { lastMessage: lastMessageOf(run), traceLines, toolCalls, files };
}

function line(value: JsonObject): string {
  return JSON.stringify(value);
}

/** The run's final message: its last assistant message with text. */
function lastMessageOf(run: Run): string {
  const messages = run.status?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.type === MessageType.MESSAGE_AI && message.content !== "") {
      return message.content;
    }
  }
  return "";
}

/** One call in Claude Code's names (the module header). */
function namedCall(
  call: ToolCall,
  engine: ToolEngine,
  pluginName: string,
  created: ReadonlySet<string>,
): EvalToolCall {
  const args: JsonObject = call.args ?? {};
  const input = JSON.stringify(args);
  if (call.mcpServerSlug !== "") {
    return {
      name: `mcp__plugin_${pluginName}_${call.mcpServerSlug}__${call.name}`,
      input,
    };
  }
  const path = pathArgumentOf(args);
  const fileChange =
    path === undefined
      ? undefined
      : created.has(normalise(path))
        ? "add"
        : "modify";
  const name = claudeNameOf(engine, call.name, fileChange);
  if (name === "Read" && path !== undefined) {
    const skill = SKILL_READ_PATH.exec(path)?.[1];
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
 * The created paths and wanted contents from the file-review ledger: each
 * change set's last captured candidate. A ledger with no capture event is
 * an install that records no files (the module header).
 */
async function filesOf(run: Run, deps: EvalTraceDeps): Promise<EvalFiles> {
  const events = run.status?.fileReviewEventStream?.events ?? [];
  const captured = events.some(
    (event) =>
      event.eventType === FileReviewEventType.BASELINE_CAPTURED ||
      event.eventType === FileReviewEventType.CANDIDATE_CAPTURED,
  );
  if (!captured) {
    return { kind: "not-recorded" };
  }
  const bySet = new Map<string, ReadonlyArray<CapturedFileChange>>();
  for (const event of events) {
    if (event.payload.case === "candidateCaptured") {
      bySet.set(event.changeSetId, event.payload.value.changes);
    }
  }
  const changes = [...bySet.values()].flat();
  const created: string[] = [];
  for (const change of changes) {
    const path = normalise(change.pathAfter);
    if (
      change.kind === FileChangeKind.ADD &&
      path !== "" &&
      !created.includes(path)
    ) {
      created.push(path);
    }
  }
  const contents = new Map<string, EvalFileContent>();
  for (const wanted of deps.wantedFiles) {
    const path = normalise(wanted);
    contents.set(path, await contentOf(changes, path, deps));
  }
  return { kind: "recorded", created, contents };
}

/** One path's content after the run: its last change, read back when offloaded. */
async function contentOf(
  changes: ReadonlyArray<CapturedFileChange>,
  path: string,
  deps: EvalTraceDeps,
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
  if (
    last === undefined ||
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
    default: {
      const exhausted: never = after.body;
      return exhausted;
    }
  }
}
