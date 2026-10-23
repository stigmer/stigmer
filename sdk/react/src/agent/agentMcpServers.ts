/**
 * An MCP server an agent writes itself, as its editors hold it, and the
 * checks they run before a save. The checks are feedback, not the rule:
 * the server's save step (`ValidateMcpServers` in
 * `backend/services/stigmer-server/src/domain/agent/steps.ts`) judges every
 * write and its refusal is shown when it differs. They read the same
 * shared names the server does, so the two agree: the name grammar and
 * the reserved names (`@stigmer/tool-vocabulary`), the URL rule a
 * plugin's HTTP server is held to (`isAcceptableServerUrl`), an address
 * that names no variable, and a header named once in any letter case.
 *
 * How a header's value reads on the page is decided here too: a value that
 * only names keys (`${LEDGER_API_KEY}`, or `Bearer ${TOKEN}`) is shown, since
 * it carries no secret; any other value reads "set". The value is in the
 * agent's spec for anyone who reads the agent, so this is courtesy, not
 * protection: the page need not print a token someone pasted.
 *
 * Pinned by `__tests__/agentMcpServers.test.ts`.
 */

import { isAcceptableServerUrl } from "@stigmer/plugin-package";
import { MCP_SERVER_NAME_PATTERN, isReservedMcpServerName } from "@stigmer/tool-vocabulary";

/** An agent's MCP server as an editor holds it: its name, its URL, the headers it is sent with. */
export interface AgentMcpServerValue {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** `server` as plain values, its headers copied: a stored server (a message) or one being edited. */
export function agentMcpServerValue(server: {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}): AgentMcpServerValue {
  return { name: server.name, url: server.url, headers: { ...server.headers } };
}

/** A value that only names keys, after an optional auth scheme word: `${A}`, `${A}-${B}`, `Bearer ${TOKEN}`. */
const ONLY_KEYS = /^(?:[A-Za-z]+\s+)?\$\{[A-Za-z_][A-Za-z0-9_]*\}(?:[\s:/-]*\$\{[A-Za-z_][A-Za-z0-9_]*\})*$/;

/** How a header's value reads on the page: itself when it only names keys, else "set". */
export function headerValueShown(value: string): string {
  return ONLY_KEYS.test(value.trim()) ? value : "set";
}

/** A server as its form holds it: the header rows as entries, so a name typed twice is still seen twice. */
export interface AgentMcpServerDraft {
  readonly name: string;
  readonly url: string;
  readonly headers: readonly (readonly [string, string])[];
}

/**
 * What is wrong with `server` before it is saved beside the agent's
 * `others` (their names), in words a person acts on; `null` when nothing
 * the console can see is.
 */
export function agentMcpServerProblem(server: AgentMcpServerDraft, others: readonly string[]): string | null {
  const name = server.name;
  if (name === "") return "Give the server a name.";
  if (!MCP_SERVER_NAME_PATTERN.test(name)) {
    return "A name is lowercase letters, digits and hyphens, starts with a letter, and ends with a letter or digit.";
  }
  if (isReservedMcpServerName(name)) {
    return "Names starting with stigmer are the platform's, and plugin names a plugin's servers. Choose another name.";
  }
  if (others.includes(name)) return `This agent already has a server named ${name}. Give each server its own name.`;
  const url = server.url;
  if (url === "") return "Give the server's URL.";
  if (url.includes("${")) {
    return "The URL cannot name a variable: where a run dials is fixed when the agent is saved, so write it out.";
  }
  if (!isAcceptableServerUrl(url)) {
    return "The URL must be https (or http on this machine), with no user name, password or #fragment in it.";
  }
  const seen = new Set<string>();
  for (const [header, value] of server.headers) {
    if (header.trim() === "") return value.trim() === "" ? "Remove the empty header, or give it a name." : "Give every header a name.";
    const key = header.toLowerCase();
    if (seen.has(key)) return `The header ${header} is named more than once.`;
    seen.add(key);
  }
  return null;
}
