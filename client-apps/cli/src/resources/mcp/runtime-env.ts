// Shared MCP runtime_env construction (single source of truth).
//
// The Connect RPC takes a runtime_env map of resolved credential values. Both
// the post-apply auto-discovery path (resources/apply/discovery.ts) and the
// `connect mcp-server` command build it the same way, so the logic lives here.
// Mirrors Go's mcpserver.buildRuntimeEnv + parseEnvOverrides (connect.go).
//
// Resolution order (lowest → highest priority):
//   1. OS environment variables, for keys the server declares in spec.env
//   2. Explicit --env KEY=VALUE overrides (override wins on collision)
//
// is_secret is taken from the server's declaration when the key is declared;
// an override for an undeclared key is treated as non-secret (matches Go).

import { create } from "@bufbuild/protobuf";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { UsageError } from "../../errors/index.js";

type ExecutionValue = ReturnType<typeof create<typeof ExecutionValueSchema>>;

/**
 * Parse `--env KEY=VALUE` strings into a map. Unlike Go (which silently drops
 * malformed entries), we reject an entry without `=` so a typo surfaces as a
 * clear usage error rather than a silently-ignored credential.
 */
export function parseEnvOverrides(overrides: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of overrides) {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new UsageError(`invalid --env value '${entry}': expected KEY=VALUE`);
    }
    result[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return result;
}

/**
 * Build the runtime_env map for the Connect RPC from the OS environment and the
 * supplied --env overrides. Only keys with a non-empty value are emitted.
 */
export function buildRuntimeEnv(
  server: McpServer,
  envOverrides: readonly string[] = [],
): Record<string, ExecutionValue> {
  const declarations = server.spec?.env ?? {};
  const overrides = parseEnvOverrides(envOverrides);
  const runtime: Record<string, ExecutionValue> = {};

  for (const [key, decl] of Object.entries(declarations)) {
    const value = process.env[key];
    if (value !== undefined && value !== "") {
      runtime[key] = create(ExecutionValueSchema, { value, isSecret: decl.isSecret });
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    runtime[key] = create(ExecutionValueSchema, { value, isSecret: declarations[key]?.isSecret ?? false });
  }

  return runtime;
}

/**
 * Merge `--env` overrides on top of the current process environment for a
 * spawned stdio subprocess (override wins). Mirrors Go's mergeEnv. Returns a
 * plain map suitable for the MCP SDK's StdioClientTransport `env` option.
 */
export function mergeProcessEnv(envOverrides: readonly string[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  for (const [key, value] of Object.entries(parseEnvOverrides(envOverrides))) {
    merged[key] = value;
  }
  return merged;
}
