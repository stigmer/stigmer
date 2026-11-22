/**
 * The host app's own tools (a session's `custom_tools`) as a turn offers
 * them, on every engine: which tools a turn offers, the name each reaches
 * the model under, and the way back from that name.
 *
 * A custom tool is one the host app answers, never the runner: a call that
 * matches the tool's input schema is recorded as an `agent.custom_tool_use`
 * and the turn ends waiting, exactly as a call waiting for an approval
 * does; the host's `user.custom_tool_result` resumes it, and the resumed
 * engine hands the model that answer as the call's result
 * (`harness/custom-tool-answers.ts`). Nothing is held between the two runs,
 * so the sandbox may sleep while the person acts. A call that does not
 * match is refused to the model before any pause, with the shared
 * sentence (`@stigmer/tool-vocabulary` `customToolInputProblem`).
 *
 * Who is offered them:
 *  - only the main agent: a helper never pauses for an answer (the Claude
 *    engine loses a sub-agent's deferred call, `execute-claude/gate.ts`),
 *    and the Stigmer engine's helpers are held to the same rule;
 *  - only a turn someone can answer: an unattended turn (a chat link's
 *    visitor, a messaging channel, a schedule) has nobody who may answer
 *    (`approval-policy.ts` `isUnattendedApprovalMode`), so it offers none,
 *    rather than faking the host's answer;
 *  - whatever the agent's tool lists say: the lists were written for the
 *    agent and cannot know a page's tools, as the platform's own servers
 *    are always in scope (`middleware/tool-scope.ts`).
 *
 * The declaration is checked again here with the control plane's own check
 * (`customToolsProblem`). The server refuses a bad one when the session
 * declares it, so a problem here is a record the check never saw: the turn
 * offers none and says why in its log, rather than offering a tool no call
 * could pass.
 *
 * Names. On the Stigmer engine a custom tool is bound under its own name,
 * which the check keeps apart from every built-in. The Claude engine takes
 * extra tools only from MCP servers, so the host serves them as one server,
 * {@link CUSTOM_TOOL_SERVER}, and the model sees `mcp__stigmer-host__<name>`.
 * Claude Code builds that name itself, so it is never fitted, as no bridged
 * server's tool on that engine is (`execute-claude/mcp-bridge.ts`): at most
 * 83 characters, within the Anthropic API's 128. The server's name sits under the `stigmer` prefix
 * no agent's own server may take (`@stigmer/tool-vocabulary`
 * `isReservedMcpServerName`). Every row, event and card carries the
 * declared name.
 */

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { customToolsProblem } from "@stigmer/tool-vocabulary/custom-tools";

import { isUnattendedApprovalMode } from "./approval-policy.js";
import { mcpToolName } from "./mcp-tool-names.js";

/** The line a waiting call of the host app's tools carries on its row: never shown as an approval's message. */
export const CUSTOM_TOOL_WAITING_MESSAGE = "Waiting for the app's answer.";

/** The server the Claude engine reaches the host app's tools through (the header). */
export const CUSTOM_TOOL_SERVER = "stigmer-host";

/** One custom tool a turn offers. */
export interface CustomToolOffer {
  readonly name: string;
  readonly description: string;
  /** The tool's JSON Schema, an object schema. */
  readonly inputSchema: Record<string, unknown>;
}

/** What a turn's offer is read from. */
export interface CustomToolSources {
  readonly session: Pick<Session, "spec">;
  readonly execution: Run;
}

/** The custom tools the session declares, as plain JSON, whether or not this turn offers them. */
export function declaredCustomTools(session: Pick<Session, "spec">): CustomToolOffer[] {
  return (session.spec?.customTools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? {},
  }));
}

/**
 * The custom tools this turn offers its main agent (the header): none on an
 * unattended turn, and none when the declaration fails the shared check.
 */
export function offeredCustomTools(sources: CustomToolSources): readonly CustomToolOffer[] {
  const declared = declaredCustomTools(sources.session);
  if (declared.length === 0 || isUnattendedApprovalMode(sources.execution)) return [];
  const problem = customToolsProblem(declared);
  if (problem !== undefined) {
    console.warn(`[custom-tools] the session's custom tools are not offered: ${problem}`);
    return [];
  }
  return declared;
}

/** The name the Claude engine's model is offered a custom tool under: Claude Code's own, never fitted (the header). */
export function customToolEngineName(name: string): string {
  return mcpToolName(CUSTOM_TOOL_SERVER, name);
}

/** The custom tool an engine name stands for on the Claude engine; undefined for any other tool. */
export function customToolOfEngineName(offers: readonly CustomToolOffer[], engineName: string): CustomToolOffer | undefined {
  return offers.find((tool) => customToolEngineName(tool.name) === engineName);
}
