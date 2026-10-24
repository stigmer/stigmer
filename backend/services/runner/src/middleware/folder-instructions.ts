/**
 * A folder's own instruction file, shown with the first `read_file` beneath
 * it, once in the model's view.
 *
 * The workspace's roots' `AGENTS.md` (else `CLAUDE.md`) ride the system
 * prompt (`execute-deep-agent/repository-instructions.ts`). A repository may
 * keep more of them deeper (a package's own build and test rules), and the
 * agent needs one exactly when it starts working in that folder. So after a
 * successful read of a workspace file, this middleware walks from the file's
 * folder up to the nearest root, exclusive, takes each folder's file by the
 * same per-directory rule, read through the graph's own backend as the root
 * files are, and appends the ones the model does not see yet to the read's
 * result, shallowest first. OpenCode attaches nested `AGENTS.md` files on a
 * read the same way (`packages/core/src/tool/plugin/read.ts`).
 *
 * WHY ON THE READ, AND ONLY THERE
 * ------------------------------
 * A read is where the agent is about to work in that folder; a listing or a
 * search shows names, not content, and attaching there would show content to
 * an agent that only listed. In the system prompt, each first visit to a
 * folder would move the cached prefix; on the read's own result the notes
 * ride history, which never moves it. Appended to the result, not as a
 * message of their own: a message from a tool call would need a `Command`,
 * and the transcript would render it as something the person said. What the
 * person sees of the read is the tool's own output (`translator.ts`), so the
 * notes reach the model alone.
 *
 * ONCE IN THE MODEL'S VIEW
 * ------------------------
 * The paths a result carries are recorded on it, in its
 * `additional_kwargs` under {@link FOLDER_INSTRUCTIONS_KEY} (deepagents marks
 * its own summary message the same way, `lc_source`; no provider's converter
 * reads a key it does not know). A path counts as shown while a tool message
 * the model still sees carries it. "Still sees" is the messages from the
 * last compaction's cutoff on: deepagents' summarization keeps every message
 * in state and records a cutoff ({@link modelVisibleMessages}), so a ledger
 * over all of `state.messages` would never show a folder's notes again after
 * compaction summarised them away. Each tool call is handed the whole graph
 * state, the private `_summarizationEvent` channel included.
 *
 * Reads made together in one response run at once, each over the same state,
 * so none sees the others' results. They share a claim per model message (the
 * AI message holding the call), taken in one synchronous step at the moment a
 * result is decided: the first read under a folder to finish carries its
 * notes and the others do not.
 *
 * REPAIR, NEVER REFUSE
 * --------------------
 * A failed read, a read under a routed prefix (`.stigmer/`, the offload
 * roots: `platform-route.ts` `admitsRoutedRead`) and a read outside every root
 * are left as they are, and a failure in discovery leaves the read untouched.
 * The middleware is installed only on a graph whose tool scope may read the
 * workspace (`turn-setup.ts`, `subagent-transformer.ts`).
 *
 * WHERE IT SITS
 * -------------
 * Directly outside tool truncation (`middleware/index.ts`,
 * `subagent-wiring.ts`): the appended text is never cut, each file being
 * bounded by the run's `max_tool_result_chars` on its own. deepagents never
 * offloads a `read_file` result, so the addition cannot trip its offload.
 *
 * One `[REPO-INSTRUCTIONS] nested=<n>` line per attachment, with no path: a
 * hosted runner's log is no place for a person's file names.
 */

import { AIMessage, ToolMessage, type MessageContent } from "@langchain/core/messages";
import type { AnyBackendProtocol } from "deepagents";
import { admitsRoutedRead } from "../activities/execute-deep-agent/platform-route.js";
import { ENGINE_TOOL } from "../activities/execute-deep-agent/engine-tools.js";
import {
  INSTRUCTION_FILE_NAMES,
  nestedDirectories,
  readDirectoryInstructions,
  renderFolderInstructions,
  type InstructionFile,
} from "../activities/execute-deep-agent/repository-instructions.js";
import type { StigmerMiddleware, ToolCallRequest } from "./types.js";

/** Where a tool message records the instruction files it carries (the header). */
export const FOLDER_INSTRUCTIONS_KEY = "stigmer_folder_instructions";

/** The argument `read_file` names its file by (deepagents 1.14). */
const READ_PATH_ARG = "file_path";

/** How deepagents' (1.14) `read_file` words a failed read; it sets no error status. */
const READ_ERROR_PREFIX = "Error: ";

export interface FolderInstructionsConfig {
  /** The graph's own file backend, the one its `read_file` reads through. */
  readonly backend: AnyBackendProtocol;
  /** The workspace's roots, whose files ride the system prompt (`repository-instructions.ts` `workspaceRoots`). */
  readonly roots: readonly string[];
  /** The run's `max_tool_result_chars`, the bound on each file. */
  readonly maxChars: number;
}

/**
 * The messages the model is shown, as deepagents' (1.14) summarization
 * rebuilds them (`getEffectiveMessages`, not exported): after a compaction,
 * the summary and the messages from the recorded cutoff on; otherwise every
 * message. Held to the installed library by its test.
 */
export function modelVisibleMessages(state: Record<string, unknown>): unknown[] {
  const messages = Array.isArray(state.messages) ? (state.messages as unknown[]) : [];
  const event = state._summarizationEvent;
  if (typeof event !== "object" || event === null) return messages;
  const { cutoffIndex, summaryMessage } = event as { cutoffIndex?: unknown; summaryMessage?: unknown };
  if (typeof cutoffIndex !== "number") return messages;
  return [summaryMessage, ...messages.slice(cutoffIndex)];
}

/** The instruction files the model still sees on a tool message. */
function shownPaths(state: Record<string, unknown>): Set<string> {
  const shown = new Set<string>();
  for (const message of modelVisibleMessages(state)) {
    if (!ToolMessage.isInstance(message)) continue;
    const paths = message.additional_kwargs?.[FOLDER_INSTRUCTIONS_KEY];
    if (!Array.isArray(paths)) continue;
    for (const path of paths) if (typeof path === "string") shown.add(path);
  }
  return shown;
}

/** The model message a call belongs to, as a key its sibling calls share. */
function responseKey(state: Record<string, unknown>, callId: string): string {
  const messages = Array.isArray(state.messages) ? (state.messages as unknown[]) : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!AIMessage.isInstance(message)) continue;
    const ids = (message.tool_calls ?? []).map((call) => call.id ?? "");
    if (ids.includes(callId)) return message.id ?? ids.join("\n");
  }
  return callId;
}

/** The text a result's content carries, for telling a failed read apart. */
function textOf(content: MessageContent): string {
  if (typeof content === "string") return content;
  const first = content[0];
  return typeof first === "object" && first !== null && first.type === "text" && typeof first.text === "string" ? first.text : "";
}

function readFailed(message: ToolMessage): boolean {
  return message.status === "error" || textOf(message.content).startsWith(READ_ERROR_PREFIX);
}

/** The result with the folders' files appended and recorded on it. */
function withFolderInstructions(message: ToolMessage, files: readonly InstructionFile[]): ToolMessage {
  const text = renderFolderInstructions(files);
  const content: MessageContent = typeof message.content === "string"
    ? `${message.content}\n\n${text}`
    : [...message.content, { type: "text", text }];
  const earlier = message.additional_kwargs?.[FOLDER_INSTRUCTIONS_KEY];
  return new ToolMessage({
    content,
    tool_call_id: message.tool_call_id,
    name: message.name,
    id: message.id,
    artifact: message.artifact,
    status: message.status,
    metadata: message.metadata,
    additional_kwargs: {
      ...message.additional_kwargs,
      [FOLDER_INSTRUCTIONS_KEY]: [...(Array.isArray(earlier) ? earlier : []), ...files.map((file) => file.path)],
    },
    response_metadata: message.response_metadata,
  });
}

/** The middleware; see the module header. */
export function createFolderInstructionsMiddleware(config: FolderInstructionsConfig): StigmerMiddleware {
  /** The instruction files claimed by the calls of one model message (the header). */
  let claim: { readonly key: string; readonly paths: Set<string> } | undefined;

  /** The folders' files this read may carry, before the claim: read, not yet seen by the model. */
  async function discover(request: ToolCallRequest, filePath: string): Promise<InstructionFile[]> {
    if (await admitsRoutedRead(filePath)) return [];
    const shown = shownPaths(request.state);
    const files: InstructionFile[] = [];
    for (const dir of nestedDirectories(filePath, config.roots)) {
      if (INSTRUCTION_FILE_NAMES.some((name) => shown.has(`${dir}/${name}`))) continue;
      const file = await readDirectoryInstructions(config.backend, dir, config.maxChars);
      if (file !== undefined) files.push(file);
    }
    return files;
  }

  return {
    name: "FolderInstructionsMiddleware",

    async wrapToolCall(request, handler) {
      const result = await handler(request);
      const filePath = request.toolCall.args[READ_PATH_ARG];
      if (request.toolCall.name !== ENGINE_TOOL.readFile || typeof filePath !== "string") return result;
      if (!ToolMessage.isInstance(result) || readFailed(result)) return result;
      let found: InstructionFile[];
      try {
        found = await discover(request, filePath);
      } catch {
        return result;
      }
      if (found.length === 0) return result;

      // The claim: one synchronous step from here to the return (the header).
      const key = responseKey(request.state, request.toolCall.id);
      if (claim?.key !== key) claim = { key, paths: new Set() };
      const claimed = claim.paths;
      const files = found.filter((file) => !claimed.has(file.path));
      for (const file of files) claimed.add(file.path);
      if (files.length === 0) return result;

      console.log(`[REPO-INSTRUCTIONS] nested=${files.length}`);
      return withFolderInstructions(result, files);
    },
  };
}
