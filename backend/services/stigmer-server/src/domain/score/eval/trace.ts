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
 */

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
