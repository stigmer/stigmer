/**
 * The environment the agent host starts with — and so the base environment
 * of every process the agent's turn starts there: the native shell
 * (`shared/shell-env.ts` builds it from the host's `process.env`), the
 * hooks, the MCP servers' base.
 *
 * Today it is the environment the agent's tools have always seen: the
 * runner's own, without the runner's secrets. The boot capture has already
 * moved every one of them out of `process.env`
 * (`shared/runner-credential-store.ts`); the names are dropped here too, as
 * the shell's environment drops them (`SHELL_ENV_DENYLIST`), so a secret
 * planted after the capture still never reaches the host. The operator's
 * settings, the user's own environment on a local runner (their cloud CLI
 * logins among them), and the engines' non-secret settings all pass, as
 * they did when the engines ran in the runner's process.
 *
 * Where the runner starts the host as the agent user (a container shape,
 * `shared/agent-identity.ts`), it is an allow-list instead: the host holds
 * nothing the agent may not have (#2016). What passes is what a process
 * needs to run (the path, the locale, the time zone, a terminal, a temporary
 * directory), the network's proxy and trust settings, and the engines' and
 * the runner's non-secret settings (`CURSOR_`, `STIGMER_`, `OTEL_` and
 * `NODE_` names, the runner's secrets still dropped, and the OpenTelemetry
 * exporter's `*_HEADERS`, which carry a collector's token, and
 * `NODE_AUTH_TOKEN`, an npm registry's). A cloud credential
 * the operator gave the runner (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`,
 * `AZURE_*`) does not pass: the runner's model lanes sign for the host
 * (`agent-proxy/lanes.ts`). An operator who wants more names in the agent's
 * environment lists them in `STIGMER_AGENT_ENV_PASSTHROUGH`, comma-separated.
 */

import { agentIdentity } from "../shared/agent-identity.js";
import { RUNNER_SECRET_ENV_KEYS } from "../shared/runner-credential-keys.js";

const RUNNER_SECRETS: ReadonlySet<string> = new Set(RUNNER_SECRET_ENV_KEYS);

/** The names a separating runner's host is started with, besides the prefixes below. */
const ALLOWED_NAMES: ReadonlySet<string> = new Set([
  "PATH",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TERM",
  "TMPDIR",
  "SHELL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);

const ALLOWED_PREFIXES = ["LC_", "CURSOR_", "STIGMER_", "OTEL_", "NODE_"] as const;

/** Names under those prefixes that carry a credential, not a setting: a collector's auth headers (`OTEL_EXPORTER_OTLP_HEADERS` and its per-signal forms) and an npm registry's token. */
const CARRIES_A_CREDENTIAL = /^(?:OTEL_.*_HEADERS|NODE_AUTH_TOKEN)$/;

/** The operator's own additions to a separating runner's agent environment. */
export const AGENT_ENV_PASSTHROUGH = "STIGMER_AGENT_ENV_PASSTHROUGH";

/** The host's environment, from this process's current one. */
export function agentHostEnvironment(env: NodeJS.ProcessEnv = process.env, separating: boolean = agentIdentity() !== null): NodeJS.ProcessEnv {
  const passthrough = new Set((env[AGENT_ENV_PASSTHROUGH] ?? "").split(",").map((name) => name.trim()).filter((name) => name.length > 0));
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || RUNNER_SECRETS.has(name)) continue;
    if (separating && !passthrough.has(name) && (!(ALLOWED_NAMES.has(name) || ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix))) || CARRIES_A_CREDENTIAL.test(name))) continue;
    out[name] = value;
  }
  return out;
}
