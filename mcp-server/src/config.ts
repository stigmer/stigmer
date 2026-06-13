// Environment-variable configuration for mcp-server-stigmer.
//
// Every value is read from a STIGMER_-prefixed environment variable with a
// development-friendly default. This is the embeddable configuration surface
// (plain types, no internal coupling) and the parity mirror of the Go server's
// internal/config + pkg/mcpserver Config (inventory §4.4) — the validation
// reproduces Go's hard-errors AND warnings, not just the defaults.

import { log, type LogFormat, type LogLevel } from "./logger.js";

/** Communication mode between MCP clients and the server. */
export type Transport = "stdio" | "http" | "both";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) discovery settings.
 *
 * Purely additive: the server stays a stateless Bearer passthrough that never
 * validates tokens. Issuer values come from deployment config, never code, so
 * the OSS server is issuer-agnostic. (HTTP discovery wiring itself lands in T02.)
 */
export interface OAuthConfig {
  readonly enabled: boolean;
  readonly resource: string;
  readonly authorizationServers: string[];
  readonly scopesSupported: string[];
}

/** Runtime configuration for the MCP server. */
export interface Config {
  /** gRPC dial target for stigmer-server (e.g. "localhost:7234"). */
  readonly stigmerServerAddress: string;
  /**
   * API key for stigmer-server. Used for stdio/both; in http mode every
   * request carries its own Bearer token. Empty when targeting an
   * unauthenticated local backend.
   */
  readonly apiKey: string;
  readonly transport: Transport;
  readonly httpPort: string;
  /** Whether HTTP requests require an Authorization: Bearer header. */
  readonly httpAuthEnabled: boolean;
  readonly oauth: OAuthConfig;
  readonly logFormat: LogFormat;
  readonly logLevel: LogLevel;
}

const VALID_TRANSPORTS: readonly string[] = ["stdio", "http", "both"];
const VALID_LOG_FORMATS: readonly string[] = ["text", "json"];
const VALID_LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];

/** Reads configuration from the process environment, applying defaults. */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    stigmerServerAddress: envOr(env, "STIGMER_SERVER_ADDRESS", "localhost:7234"),
    apiKey: env.STIGMER_API_KEY ?? "",
    transport: envOr(env, "STIGMER_MCP_TRANSPORT", "stdio").toLowerCase() as Transport,
    httpPort: envOr(env, "STIGMER_MCP_HTTP_PORT", "8080"),
    // Go semantics: only the exact string "true" enables auth.
    httpAuthEnabled: envOr(env, "STIGMER_MCP_HTTP_AUTH_ENABLED", "true") === "true",
    oauth: {
      enabled: env.STIGMER_MCP_OAUTH_ENABLED === "true",
      resource: (env.STIGMER_MCP_OAUTH_RESOURCE ?? "").trim(),
      authorizationServers: splitList(env.STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS),
      scopesSupported: splitList(env.STIGMER_MCP_OAUTH_SCOPES_SUPPORTED),
    },
    logFormat: envOr(env, "STIGMER_MCP_LOG_FORMAT", "text").toLowerCase() as LogFormat,
    logLevel: envOr(env, "STIGMER_MCP_LOG_LEVEL", "info").toLowerCase() as LogLevel,
  };
}

/**
 * Validates invariants that must hold before the server starts. Throws on hard
 * errors; emits warnings (via the configured logger) for the soft cases the Go
 * server warns about. Configure the logger before calling this so warnings are
 * formatted consistently.
 */
export function validateConfig(cfg: Config): void {
  if (!VALID_TRANSPORTS.includes(cfg.transport)) {
    throw new Error(
      `invalid STIGMER_MCP_TRANSPORT "${cfg.transport}": must be stdio, http, or both`,
    );
  }

  if (cfg.stigmerServerAddress === "") {
    throw new Error("STIGMER_SERVER_ADDRESS must not be empty");
  }

  if (cfg.stigmerServerAddress.includes("://")) {
    log.warn(
      "STIGMER_SERVER_ADDRESS contains a URL scheme; gRPC targets are host:port — " +
        "the scheme is informational and TLS is derived from the port",
      { value: cfg.stigmerServerAddress },
    );
  } else if (!hasExplicitPort(cfg.stigmerServerAddress)) {
    log.warn(
      "STIGMER_SERVER_ADDRESS has no explicit port; :443 with TLS is assumed for non-loopback addresses",
      { value: cfg.stigmerServerAddress },
    );
  }

  if (!VALID_LOG_FORMATS.includes(cfg.logFormat)) {
    throw new Error(`invalid STIGMER_MCP_LOG_FORMAT "${cfg.logFormat}": must be text or json`);
  }

  if (!VALID_LOG_LEVELS.includes(cfg.logLevel)) {
    throw new Error(
      `invalid STIGMER_MCP_LOG_LEVEL "${cfg.logLevel}": must be debug, info, warn, or error`,
    );
  }

  if (cfg.oauth.enabled) {
    if (cfg.oauth.resource === "") {
      throw new Error(
        "STIGMER_MCP_OAUTH_RESOURCE must be set when STIGMER_MCP_OAUTH_ENABLED is true",
      );
    }
    if (cfg.oauth.authorizationServers.length === 0) {
      throw new Error(
        "STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS must list at least one issuer when STIGMER_MCP_OAUTH_ENABLED is true",
      );
    }
  }
}

function envOr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v !== undefined && v !== "" ? v : fallback;
}

/** Parses a comma-separated value into trimmed, non-empty entries. */
function splitList(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/**
 * Reports whether an authority carries an explicit port. Tolerates bracketed
 * IPv6 (`[::1]:443`) and treats bare IPv6 (`::1`) as port-less, matching the
 * intent of Go's net.SplitHostPort in the config warning path.
 */
function hasExplicitPort(authority: string): boolean {
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    return close !== -1 && authority.slice(close + 1).startsWith(":");
  }
  const lastColon = authority.lastIndexOf(":");
  return lastColon !== -1 && authority.indexOf(":") === lastColon;
}
