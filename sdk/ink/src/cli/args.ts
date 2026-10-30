// stigmer-ink's command line, read by one pure function so every usage error
// is a test case: what to run (start a turn with an agent, send a message into
// a session, or attach to a session and watch it), where, and how it ends.
// Node's own `parseArgs` reads the flags; no dependency.
//
// The key comes from STIGMER_API_KEY, the safe form: an argument is visible
// to every user of the machine in the process list. `--api-key` stays for
// scripts that cannot set the environment, and the usage says so.
//
// Proven by __tests__/cli-args.test.ts.

import { parseArgs } from "node:util";

/** The server `stigmer up` starts, when neither --base-url nor STIGMER_BASE_URL names one. */
export const DEFAULT_BASE_URL = "http://localhost:7234";

/** What stigmer-ink was asked to do. */
export type CliRequest =
  | { readonly kind: "help" }
  | { readonly kind: "usage-error"; readonly message: string }
  | {
      readonly kind: "run";
      readonly baseUrl: string;
      readonly apiKey: string | undefined;
      readonly org: string;
      /** Start a new conversation with this agent... */
      readonly agent: { readonly org: string; readonly slug: string } | undefined;
      /** ...or work in this session. */
      readonly sessionId: string | undefined;
      /** The message to send; absent only when attaching to watch a session. */
      readonly message: string | undefined;
      readonly until: "turn" | "exit";
      readonly approveDefault: "approve" | "deny";
      readonly mode: "agent" | "plan" | undefined;
    };

export const USAGE = `stigmer-ink: run a Stigmer agent in the terminal, then exit with how it ended.

Usage:
  stigmer-ink --agent <org/slug> --message <text> [options]   start a conversation
  stigmer-ink --session <id> --org <slug> --message <text>    send a message into a session
  stigmer-ink --session <id> --org <slug>                     watch a session (Ctrl+C to quit)

Options:
  -a, --agent <org/slug>          The agent to start a conversation with
  -m, --message <text>            The message to send
  -s, --session <id>              A session to send into or watch
  -o, --org <slug>                The organization (defaults to the agent's)
  -u, --base-url <url>            The server (or STIGMER_BASE_URL; default ${DEFAULT_BASE_URL})
  -k, --api-key <key>             An API key; prefer STIGMER_API_KEY, which other users cannot see
      --until <turn|exit>         Return when the turn ends (default), or when you quit
      --approve-default <approve|deny>
                                  Off a terminal, settle approvals this way (default deny)
  -M, --mode <agent|plan>         Interaction mode for follow-ups
  -h, --help                      Show this help

Environment:
  STIGMER_API_KEY                 The API key
  STIGMER_BASE_URL                The server

Exit codes: 0 completed; 1 failed, cancelled or terminated; 2 usage; 3 cannot
connect; 4 not signed in or not allowed; 5 not found; 130 interrupted.`;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | string | undefined {
  if (value === undefined) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : `${flag} must be ${allowed.join(" or ")}, not "${value}"`;
}

/** Reads stigmer-ink's arguments (without the node and script paths) and environment. */
export function parseCliArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): CliRequest {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        agent: { type: "string", short: "a" },
        message: { type: "string", short: "m" },
        session: { type: "string", short: "s" },
        org: { type: "string", short: "o" },
        "base-url": { type: "string", short: "u" },
        "api-key": { type: "string", short: "k" },
        until: { type: "string" },
        "approve-default": { type: "string" },
        mode: { type: "string", short: "M" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    return { kind: "usage-error", message: error instanceof Error ? error.message : String(error) };
  }
  if (values.help === true) return { kind: "help" };
  if (positionals.length > 0) return { kind: "usage-error", message: `unexpected argument "${positionals[0]}"` };

  const str = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : undefined);
  const agentArg = str("agent");
  const sessionId = str("session");
  const message = str("message");
  if (agentArg === undefined && sessionId === undefined) {
    return { kind: "usage-error", message: "name an agent (--agent org/slug) or a session (--session id)" };
  }
  if (agentArg !== undefined && sessionId !== undefined) {
    return { kind: "usage-error", message: "--agent starts a new conversation; --session works in one: pass one of them" };
  }

  let agent: { org: string; slug: string } | undefined;
  if (agentArg !== undefined) {
    const [first, second, ...rest] = agentArg.split("/");
    const named = second === undefined ? { org: str("org"), slug: first } : { org: first, slug: second };
    if (rest.length > 0 || !named.slug || !named.org) {
      return { kind: "usage-error", message: `--agent takes org/slug (or a slug with --org), not "${agentArg}"` };
    }
    agent = { org: named.org, slug: named.slug };
    if (message === undefined || message === "") {
      return { kind: "usage-error", message: "--agent needs --message: the first thing to say to it" };
    }
  }
  const org = str("org") ?? agent?.org;
  if (org === undefined || org === "") return { kind: "usage-error", message: "--session needs --org" };

  const until = oneOf(str("until"), ["turn", "exit"] as const, "--until");
  const approveDefault = oneOf(str("approve-default"), ["approve", "deny"] as const, "--approve-default");
  const mode = oneOf(str("mode"), ["agent", "plan"] as const, "--mode");
  for (const value of [until, approveDefault, mode]) {
    if (value !== undefined && value.startsWith("--")) return { kind: "usage-error", message: value };
  }

  return {
    kind: "run",
    baseUrl: str("base-url") ?? env.STIGMER_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: str("api-key") ?? env.STIGMER_API_KEY,
    org,
    agent,
    sessionId,
    message,
    until: (until as "turn" | "exit" | undefined) ?? (message === undefined ? "exit" : "turn"),
    approveDefault: (approveDefault as "approve" | "deny" | undefined) ?? "deny",
    mode: mode as "agent" | "plan" | undefined,
  };
}
