/**
 * The Claude engine's whole environment, built from nothing for each
 * invocation.
 *
 * The engine is a program of its own the SDK starts, and the SDK hands it
 * exactly this environment (it replaces, never merges), so what is here is
 * all it holds:
 *
 *  - Where it lives: `HOME` and `CLAUDE_CONFIG_DIR` are one directory of the
 *    session's, made for this invocation and removed when it ends
 *    (`shared/workspace/platform-dir.ts` `getClaudeInvocationDir`): outside
 *    the workspace and outside what the agent's `.stigmer` link shows, so the
 *    engine reads no person's settings and leaves nothing behind. The
 *    session's conversation is the session store's (`session-store.ts`),
 *    never this directory's. `CLAUDE_CODE_PROJECT_DIR_NAME` fixes the key
 *    the engine files the conversation under, so a resume finds it from any
 *    workspace path.
 *  - Where its model calls go: the Anthropic lane of the runner's local
 *    proxy, with the turn's own key as its one credential
 *    (`agent-proxy/server.ts`). The key is worth model calls for this run
 *    while its turn is live, and nothing after; the host's token never
 *    enters this environment.
 *  - What it must not do on its own (each a documented switch of the
 *    engine): no traffic of its own beyond model calls, no updates, no
 *    built-in sub-agents, no background commands or agents (a command the
 *    engine left running would outlive the turn, and every sub-agent runs
 *    to its end before the main agent goes on), no forked sub-agents (a
 *    fork copies the conversation with the main agent's tools), no
 *    sub-agent below the first, no more sub-agents at once than the Stigmer
 *    harness runs (`shared/subagent-gate.ts`; a call past the cap is refused
 *    at once on both), no bundled skills (only the turn's own load,
 *    `skill-plugins.ts`), no auto memory, no
 *    `CLAUDE.md` of its own reading (the repository's instructions reach it
 *    the way they reach every engine, `prompt.ts`), no web fetch from its
 *    process, and the to-do list as `TodoWrite`, which the runtime projects
 *    into the session's to-do rows as it does every engine's.
 *  - Who it is to the provider: `CLAUDE_AGENT_SDK_CLIENT_APP`.
 *
 * Nothing else: no provider key, no Stigmer token, no MCP credential (every
 * MCP server is the host's, `mcp-bridge.ts`), no inherited variable but
 * `PATH`, which the agent host's own environment already carries free of
 * every secret (`agent-host/environment.ts`). No subprocess scrub: it needs a
 * sandbox the container cannot start, and the engine starts no process of
 * its own (the shell is the host's, `host-shell.ts`).
 */

import { DEFAULT_MAX_CONCURRENT } from "../../shared/subagent-gate.js";

/** What one invocation's environment is built from. */
export interface EngineEnvironmentInputs {
  /** The invocation's directory: the engine's home and configuration. */
  readonly home: string;
  /** The Anthropic lane of the runner's local proxy. */
  readonly anthropicBaseUrl: string;
  /** The turn's key at that proxy. */
  readonly turnKey: string;
  /** The project key the engine files the session's conversation under. */
  readonly projectKey: string;
  /** The host's own `PATH`. */
  readonly path: string;
}

/** The name the engine gives Stigmer when it identifies its client to the provider. */
export const CLAUDE_CLIENT_APP = "stigmer-runner";

/** The engine's documented switches this harness turns on, each a reason in the module header. */
export const ENGINE_SWITCHES: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1",
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_WEB_FETCH: "1",
  CLAUDE_CODE_ENABLE_TASKS: "0",
  CLAUDE_CODE_FORK_SUBAGENT: "0",
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(DEFAULT_MAX_CONCURRENT),
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
};

/** The engine's environment, whole (the header). */
export function engineEnvironment(inputs: EngineEnvironmentInputs): Record<string, string> {
  return {
    PATH: inputs.path,
    HOME: inputs.home,
    CLAUDE_CONFIG_DIR: inputs.home,
    CLAUDE_CODE_PROJECT_DIR_NAME: inputs.projectKey,
    ANTHROPIC_BASE_URL: inputs.anthropicBaseUrl,
    ANTHROPIC_API_KEY: inputs.turnKey,
    ...ENGINE_SWITCHES,
    CLAUDE_AGENT_SDK_CLIENT_APP: CLAUDE_CLIENT_APP,
  };
}
