/**
 * Whether an agent's conversations have a computer (AgentSpec.computer,
 * SessionStatus.computer), and everything refused because one does not.
 * One module, beside local-programs.ts and shaped like it, so the agent's
 * save, a conversation's write, a routine's save, an eval run's create and
 * each turn's create word every refusal the same way.
 *
 * The reading rule is the proto's: only COMPUTER_NONE means no computer.
 * An unset value (an agent or a conversation saved before the setting, or
 * no agent at all: the built-in assistant) reads as having one, so nothing
 * stored before the setting changes, and no version is rewritten to say so
 * (a version's identity is the hash of its stored spec).
 *
 * What needs a computer, and where each is refused:
 *   - the agent's own fields (a Bash entry in tools, its hooks, an
 *     Environment, COMPUTER_NONE on the Claude harness): INVALID_ARGUMENT
 *     at its save, since the write itself is wrong;
 *   - an MCP server of its own whose address is this machine or its
 *     private network: INVALID_ARGUMENT at its save (below);
 *   - what it lists (a plugin with hooks, a local MCP server or one whose
 *     address is this machine, a subagent whose pinned version has a
 *     computer): FAILED_PRECONDITION at its save, since the conflict is
 *     with another resource's state;
 *   - what a conversation adds (a repository, a folder, an Environment, the
 *     Claude harness, a plugin of its own with hooks or a local program):
 *     FAILED_PRECONDITION on every write, since the conflict is with its
 *     agent's setting;
 *   - every plugin a turn would load, again at each turn's create, because
 *     a plugin can gain a hook after the agent is saved. A hook that does
 *     not run is a policy that vanished, so the turn is refused, never run
 *     without it.
 *
 * An agent's own MCP servers are reached over HTTP only, so none starts a
 * program. But an agent without a computer runs in a program that may
 * reach neither the machine it runs on nor that machine's private network,
 * so a server whose host is a loopback name (`localhost`, `*.localhost`) or
 * a loopback, private, link-local or unspecified address literal (IPv4 or
 * IPv6, by the shared egress rule, `@stigmer/outbound/egress`) is refused,
 * on http and https alike: the agent's own at its save, a plugin's
 * wherever its plugins are checked. A name that resolves to such an
 * address is not known here; the runner judges every resolved address when
 * it connects. A tool list elsewhere (a plugin's agent's, a message's own) may
 * name Bash beside other tools: without a computer the turn simply lacks it.
 * One that names only the shell is refused, at the save that brings the
 * plugin and at the turn's create, because the runner refuses a list that
 * names nothing the turn has, which would fail the turn partway through.
 *
 * Tests: __tests__/computer.test.ts.
 */
import { isIP } from "node:net";

import { blockedReason } from "@stigmer/outbound/egress";
import { builtinToolOf, SHELL_TOOL } from "@stigmer/tool-vocabulary";

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Computer, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { failedPreconditionError, invalidArgumentError } from "../../pipeline/errors.js";
import type { RunPlugin } from "../vault/resolve.js";
import type { RunSubagent } from "./run-subagents.js";

/** The proto's reading rule: only COMPUTER_NONE means no computer. */
export function hasComputer(value: Computer | undefined): boolean {
  return value !== Computer.NONE;
}

/** The computer a conversation on this agent version gets; no agent (the built-in assistant) has one. */
export function agentComputer(spec: AgentSpec | undefined): Computer {
  return spec?.computer ?? Computer.UNSPECIFIED;
}

/** The refusal for COMPUTER_NONE on the Claude harness, which always runs with a computer. */
export const CLAUDE_NEEDS_COMPUTER_MESSAGE =
  "the Claude engine always runs with a computer; leave computer unset or set it to COMPUTER_REQUIRED, or choose the Stigmer engine";

/** Whether a tool list names the shell and nothing else, so a turn without a computer has none of it. */
export function namesOnlyTheShell(tools: readonly string[] | undefined): boolean {
  return tools !== undefined && tools.length > 0 && tools.every((entry) => builtinToolOf(entry) === SHELL_TOOL);
}

/**
 * What an MCP server's address reaches, in words, when its host alone says
 * it is this machine or its private network: "this machine (loopback)" or
 * "this machine's private network (private (RFC 1918))". Undefined for any
 * other host, and for a value that is not a URL (its save's own validation
 * answers that).
 */
export function machineReachOf(url: string): string | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined;
  }
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "this machine (loopback)";
  }
  if (isIP(host) === 0) {
    return undefined;
  }
  const reason = blockedReason(host, "strict");
  if (reason === null) {
    return undefined;
  }
  return reason === "loopback" || reason === "unspecified"
    ? `this machine (${reason})`
    : `this machine's private network (${reason})`;
}

/** What a plugin carries that needs a computer, in words; undefined when it carries nothing that does. */
function pluginNeedsComputer(plugin: RunPlugin): string | undefined {
  if ((plugin.status.hooks?.groups.length ?? 0) > 0) {
    return "runs hooks";
  }
  const server = plugin.status.mcpServers.find((entry) => entry.transport.case === "stdio");
  if (server !== undefined) {
    return `runs its MCP server '${server.name}' as a local program`;
  }
  for (const entry of plugin.status.mcpServers) {
    if (entry.transport.case !== "http") continue;
    const reach = machineReachOf(entry.transport.value.url);
    if (reach !== undefined) {
      return `has its MCP server '${entry.name}' at ${entry.transport.value.url}, which reaches ${reach}`;
    }
  }
  const shellOnly = plugin.status.agents.find((agent) => namesOnlyTheShell(agent.tools));
  if (shellOnly !== undefined) {
    return `has an agent, '${shellOnly.name}', whose only tool is the shell`;
  }
  return undefined;
}

/** Whether the agent's own hooks block holds any hook. */
function hasOwnHooks(spec: AgentSpec): boolean {
  return spec.hooks.some(
    (source) => source.source.case === "inline" && source.source.value.groups.length > 0,
  );
}

/**
 * Refuses an agent without a computer that names anything needing one: its
 * own fields first (INVALID_ARGUMENT), then the plugins and subagents it
 * lists (FAILED_PRECONDITION). Returns when the agent has a computer.
 */
export function refuseAgentWithoutComputer(
  spec: AgentSpec,
  plugins: readonly RunPlugin[],
  subagents: readonly RunSubagent[],
): void {
  if (hasComputer(spec.computer)) {
    return;
  }
  const remedy = "or give the agent a computer";
  if (spec.harness === Harness.CLAUDE) {
    throw invalidArgumentError(CLAUDE_NEEDS_COMPUTER_MESSAGE);
  }
  const shell = spec.tools.find((entry) => builtinToolOf(entry) === SHELL_TOOL);
  if (shell !== undefined) {
    throw invalidArgumentError(
      `this agent has no computer, so its tools can't list '${shell}', which runs commands; remove it from tools, ${remedy}`,
    );
  }
  if (hasOwnHooks(spec)) {
    throw invalidArgumentError(
      `this agent has no computer, so it can't run its own hooks; remove its hooks, ${remedy}`,
    );
  }
  if ((spec.environmentRef?.id ?? "") !== "" || (spec.environmentRef?.slug ?? "") !== "") {
    throw invalidArgumentError(
      `this agent has no computer, so it can't name an Environment; remove environment_ref, ${remedy}`,
    );
  }
  for (const server of spec.mcpServers) {
    const reach = machineReachOf(server.url);
    if (reach !== undefined) {
      throw invalidArgumentError(
        `this agent has no computer, so its MCP server '${server.name}' can't be at ${server.url}, which reaches ${reach}; ` +
          `use an address on the internet, ${remedy}`,
      );
    }
  }
  for (const plugin of plugins) {
    const why = pluginNeedsComputer(plugin);
    if (why !== undefined) {
      throw failedPreconditionError(
        `this agent has no computer, so it can't use plugin '${plugin.name}', which ${why}; remove the plugin, ${remedy}`,
      );
    }
  }
  for (const subagent of subagents) {
    if (hasComputer(subagent.spec.computer)) {
      throw failedPreconditionError(
        `this agent has no computer, so it can't list subagent '${subagent.name}', which has one; remove it from subagents, ` +
          `save '${subagent.name}' without a computer and list that version, ${remedy}`,
      );
    }
  }
}

/** The words a conversation's refusal opens with. */
function conversationPrefix(agentName: string): string {
  return agentName === ""
    ? "this conversation's agent has no computer"
    : `agent '${agentName}' has no computer`;
}

/**
 * Refuses a conversation without a computer that adds anything needing one:
 * a repository or a folder, an Environment of its own, the Claude harness,
 * or a plugin with hooks or a local program among `plugins`. Each is
 * FAILED_PRECONDITION, naming the agent and the thing to remove. Returns
 * when the conversation has a computer.
 */
export function refuseConversationWithoutComputer(
  session: Session,
  agentName: string,
  plugins: readonly RunPlugin[],
): void {
  if (hasComputer(session.status?.computer)) {
    return;
  }
  const prefix = conversationPrefix(agentName);
  const remedy = "or give the agent a computer";
  for (const resource of session.spec?.resources ?? []) {
    switch (resource.resource.case) {
      case "gitRepository":
        throw failedPreconditionError(
          `${prefix}, so this conversation can't attach repository '${resource.name}'; remove it, ${remedy}`,
        );
      case "localPath":
        throw failedPreconditionError(
          `${prefix}, so this conversation can't attach folder '${resource.name}'; remove it, ${remedy}`,
        );
      case "file":
      case undefined:
        break;
      /* v8 ignore start -- @preserve: the never arm; the compiler proves no resource reaches it */
      default: {
        const exhaustive: never = resource.resource;
        throw new Error(`refuseConversationWithoutComputer: unknown resource ${String(exhaustive)}`);
      }
      /* v8 ignore stop */
    }
  }
  const environment = session.spec?.environmentRef;
  if ((environment?.id ?? "") !== "" || (environment?.slug ?? "") !== "") {
    throw failedPreconditionError(
      `${prefix}, so this conversation can't run in an Environment; remove environment_ref, ${remedy}`,
    );
  }
  refuseClaudeWithoutComputer(session.status?.computer, session.spec?.harness, agentName);
  refusePluginsWithoutComputer(prefix, plugins);
}

/**
 * Refuses the Claude harness for a conversation whose agent has no
 * computer: the conversation's own choice, a routine's, or an eval run's
 * target. Returns when the agent has a computer or the harness is another.
 */
export function refuseClaudeWithoutComputer(
  computer: Computer | undefined,
  harness: Harness | undefined,
  agentName: string,
): void {
  if (hasComputer(computer) || harness !== Harness.CLAUDE) {
    return;
  }
  throw failedPreconditionError(
    `${conversationPrefix(agentName)}, so its conversations can't run on the Claude engine, which always has one; choose the Stigmer engine, or give the agent a computer`,
  );
}

/**
 * Refuses a turn of a conversation without a computer when its own tool
 * list (`RunSpec.tools`) names only the shell, or a plugin it would load
 * carries hooks, a local program or an agent whose only tool is the shell;
 * the plugins move after the agent's save, so each turn asks again.
 * Returns when the conversation has a computer.
 */
export function refuseTurnWithoutComputer(
  session: Session | undefined,
  agentName: string,
  plugins: readonly RunPlugin[],
  turnTools: readonly string[] = [],
): void {
  if (hasComputer(session?.status?.computer)) {
    return;
  }
  const prefix = conversationPrefix(agentName);
  if (namesOnlyTheShell(turnTools)) {
    throw failedPreconditionError(
      `${prefix}, so this message's tools can't be only '${turnTools.join("', '")}', which runs commands; name other tools, or give the agent a computer`,
    );
  }
  refusePluginsWithoutComputer(prefix, plugins);
}

function refusePluginsWithoutComputer(prefix: string, plugins: readonly RunPlugin[]): void {
  for (const plugin of plugins) {
    const why = pluginNeedsComputer(plugin);
    if (why !== undefined) {
      throw failedPreconditionError(
        `${prefix}, so this conversation can't use plugin '${plugin.name}', which ${why}; remove the plugin from the agent or the conversation, or give the agent a computer`,
      );
    }
  }
}
