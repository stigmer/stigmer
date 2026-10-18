/**
 * The HTTPS hosts a sandbox's runner itself must reach, derived from the
 * driver's configuration: a sandbox whose Environment limits networking
 * keeps them open beside its listed hosts, so a `limited` Environment with
 * no hosts still runs a turn (Substrate's egress.ts adds them, and only
 * under `limited`: under `unrestricted` the HTTPS wildcard carries them,
 * and under the operator's `none` HTTPS is closed on purpose).
 *
 *   - the model providers whose keys or roots the operator gives the
 *     runner: Anthropic (`ANTHROPIC_BASE_URL`'s host, else
 *     `api.anthropic.com` when `ANTHROPIC_API_KEY` is set), OpenAI
 *     (`OPENAI_BASE_URL`'s host, else `api.openai.com` when
 *     `OPENAI_API_KEY` is set), and Bedrock
 *     (`ANTHROPIC_BEDROCK_BASE_URL`'s host, else
 *     `bedrock-runtime.<AWS_REGION>.amazonaws.com`);
 *   - Cursor's hosts when `CURSOR_API_KEY` is set;
 *   - the https:// public MCP address and OTLP endpoint.
 *
 * What cannot be derived (a Vertex or Foundry endpoint, a corporate proxy)
 * is the operator's list, STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS_PLATFORM.
 *
 * The defaults are copies of the runner's own (`agent-proxy/lanes.ts`,
 * `activities/execute-cursor/fetch-interceptor.ts`); a test in the runner
 * package (`environment/__tests__/platform-lanes.test.ts`) holds them
 * equal. The module imports nothing at run time, so that test can load it.
 */
import type { SandboxDriverConfig } from "./provisioner.js";

export const ANTHROPIC_DEFAULT_ROOT = "https://api.anthropic.com";
export const OPENAI_DEFAULT_ROOT = "https://api.openai.com/v1";
export const CURSOR_HOSTS: readonly string[] = ["api2.cursor.sh", "api.cursor.com", "api.cursor.sh"];

/** The host of an https:// URL, or `undefined` for anything else. */
function httpsHost(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  if (value === "") {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** The runner's own HTTPS hosts for this configuration, each once. */
export function runnerPlatformHosts(config: Pick<SandboxDriverConfig, "runnerEnv" | "runnerSecretEnv" | "mcpPublicEndpoint">): string[] {
  const env = config.runnerEnv;
  const secrets = config.runnerSecretEnv;
  const has = (name: string): boolean => (env[name] ?? secrets[name] ?? "").trim() !== "";
  const hosts: (string | undefined)[] = [];
  if (has("ANTHROPIC_BASE_URL")) {
    hosts.push(httpsHost(env["ANTHROPIC_BASE_URL"] ?? secrets["ANTHROPIC_BASE_URL"]));
  } else if (has("ANTHROPIC_API_KEY")) {
    hosts.push(httpsHost(ANTHROPIC_DEFAULT_ROOT));
  }
  if (has("OPENAI_BASE_URL")) {
    hosts.push(httpsHost(env["OPENAI_BASE_URL"] ?? secrets["OPENAI_BASE_URL"]));
  } else if (has("OPENAI_API_KEY")) {
    hosts.push(httpsHost(OPENAI_DEFAULT_ROOT));
  }
  if (has("ANTHROPIC_BEDROCK_BASE_URL")) {
    hosts.push(httpsHost(env["ANTHROPIC_BEDROCK_BASE_URL"]));
  } else if (has("AWS_REGION") && (has("AWS_BEARER_TOKEN_BEDROCK") || has("AWS_ACCESS_KEY_ID"))) {
    hosts.push(`bedrock-runtime.${(env["AWS_REGION"] ?? "").trim()}.amazonaws.com`);
  }
  if (has("CURSOR_API_KEY")) {
    hosts.push(...CURSOR_HOSTS);
  }
  hosts.push(httpsHost(config.mcpPublicEndpoint));
  hosts.push(httpsHost(env["OTEL_EXPORTER_OTLP_ENDPOINT"]));
  return [...new Set(hosts.filter((host): host is string => host !== undefined))];
}
