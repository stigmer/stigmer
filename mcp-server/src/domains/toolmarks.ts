// The marks every tool carries (MCP tool annotations): whether it only
// reads, whether it can destroy something, whether repeating it is safe, and
// whether it reaches beyond Stigmer.
//
// Clients act on them. Stigmer's own runner tightens approval for a tool
// marked destructive; Codex asks the person before any tool call unless the
// tool is marked read-only, or marked both not destructive and closed world
// (openai/codex, codex-rs/core/src/mcp_tool_call.rs). A client reads a
// missing destructiveHint or openWorldHint as true, so every set here states
// all four hints. Titles stay off: each tool's name and description say it.
//
// Every registerTool call passes one of these as `annotations`; the roster
// test fails any tool registered without them.

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** Reads Stigmer's own data; changes nothing. */
export const READ: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** Reads something outside Stigmer (the public docs); changes nothing. */
export const READ_OPEN_WORLD: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
});

/** Creates or changes Stigmer data, losing nothing; safe to repeat. */
export const WRITE_IDEMPOTENT: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** Creates Stigmer data, losing nothing; each call adds another. */
export const WRITE: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
});

/**
 * Acts beyond Stigmer: spends model tokens, reaches a person, or lets a
 * run act on the world. Not destructive, but a client that asks before
 * acting on the world asks first.
 */
export const WRITE_OPEN_WORLD: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
});

/** Removes or stops something for good; it can't be undone. */
export const DESTRUCTIVE: ToolAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
});
