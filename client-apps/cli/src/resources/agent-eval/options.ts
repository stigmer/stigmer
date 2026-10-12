// `agent eval` options, read into what the eval's create asks for. Pure: no
// client, no I/O, so every refusal is unit-tested.
//
// The flags are `plugin eval`'s (resources/plugin-eval/options.ts, whose
// header says what each means and how it is checked), read by the same
// function, but `--ablation`: an agent eval runs each case on the agent
// alone, one arm, with no run without its plugins to compare against. One
// flag is the agent's own: `--plugin <slug>`, repeatable, runs only the
// cases of the plugins named, each one the agent attaches (the server
// refuses one it does not). With no `--model` the eval names no target and
// the server runs each case on the agent as it runs: its own engine, model
// and settings.
//
// The agent is named as every agent reference in the CLI is (an id, a slug
// in the current organization, or org/slug), with an optional `@version`:
// a version hash or a tag, which the server resolves and stamps. The
// version's form is the server's to judge; the CLI refuses only what can
// never be one (empty, blank, too long).
//
// A refusal exits 1, as `plugin eval`'s do.

import { invalid, readEvalOptions, type EvalFlags, type EvalOptions } from "../plugin-eval/options.js";

/** The most plugins `--plugin` may name (the API's limit). */
const MAX_PLUGINS = 64;

/** The longest plugin slug or agent version the API accepts. */
const MAX_NAME = 128;

/** The options as commander hands them over. */
export interface AgentEvalFlags extends EvalFlags {
  readonly plugin?: readonly string[];
}

/** The options, checked. */
export interface AgentEvalOptions extends EvalOptions {
  /** The slugs of the plugins whose cases run; empty runs every plugin's. */
  readonly plugins: readonly string[];
}

/** An agent as the command names it: by id or name, and optionally a version. */
export interface AgentTarget {
  /** The agent reference, without the version. */
  readonly ref: string;
  /** A version hash or tag; empty for the current version. */
  readonly version: string;
}

/** Reads `<agent>[@version]`. */
export function parseAgentTarget(raw: string): AgentTarget {
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf("@");
  const ref = at < 0 ? trimmed : trimmed.slice(0, at);
  const version = at < 0 ? "" : trimmed.slice(at + 1);
  if (ref === "") {
    throw invalid("name the agent to evaluate, as in `stigmer agent eval reviewer`");
  }
  if (at >= 0 && (version === "" || version.length > MAX_NAME || /\s/.test(version))) {
    throw invalid(
      `'${version}' is not an agent version: a version is a hash or a tag \`stigmer get agent ${ref} --version-history\` shows`,
    );
  }
  return { ref, version };
}

/** Checks every option and fills the defaults. */
export function readAgentEvalOptions(flags: AgentEvalFlags): AgentEvalOptions {
  const shared = readEvalOptions(flags, { noun: "agent", example: "stigmer agent eval reviewer" });
  const plugins = (flags.plugin ?? []).map((slug) => slug.trim());
  if (plugins.length > MAX_PLUGINS) {
    throw invalid(`--plugin may be given at most ${MAX_PLUGINS} times`);
  }
  for (const slug of plugins) {
    if (slug === "" || slug.length > MAX_NAME) {
      throw invalid(`--plugin names a plugin by its slug, at most ${MAX_NAME} characters, as in --plugin thermos`);
    }
  }
  return { ...shared, plugins: [...new Set(plugins)] };
}
