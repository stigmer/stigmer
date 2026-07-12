/**
 * Checkpointer factory — creates the appropriate LangGraph checkpoint
 * saver based on runner configuration.
 *
 * Three backends:
 * - sqlite: SqliteCheckpointSaver (durable local file) — the OSS / local /
 *   desktop default. Survives across ExecuteDeepAgent invocations so HITL,
 *   pause/resume, and transient recovery resume via Command(resume) rather than
 *   replaying from the original message (stigmer/stigmer#204).
 * - http: HttpCheckpointSaver (proxy-backed) — for cloud / managed runners.
 * - memory: MemorySaver (ephemeral, zero-config) — explicit opt-in for tests.
 *
 * The returned saver is used by the deep agent activity (Phase 3).
 * Cursor executions do not use LangGraph checkpointers — they rely on
 * the Cursor SDK's native agent state persistence.
 */

import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { CheckpointerConfig } from "./types.js";
import { HttpCheckpointSaver } from "./http-saver.js";
import { SqliteCheckpointSaver } from "./sqlite-saver.js";

export class CheckpointerCreationError extends Error {
  readonly checkpointerType: string;
  readonly cause?: Error;

  constructor(type: string, message: string, cause?: Error) {
    super(`Failed to create ${type} checkpointer: ${message}`);
    this.name = "CheckpointerCreationError";
    this.checkpointerType = type;
    this.cause = cause;
  }
}

/**
 * Create the appropriate checkpoint saver for the given config.
 *
 * This function is async to accommodate backends that need setup. The
 * SqliteCheckpointSaver opens its file handle in its constructor and creates
 * the schema lazily on first use; it must be closed by the caller (the deep
 * agent activity closes it in its cleanup, alongside the MCP connection).
 */
export async function createCheckpointer(
  config: CheckpointerConfig,
): Promise<BaseCheckpointSaver> {
  switch (config.type) {
    case "sqlite": {
      if (!config.sqlitePath) {
        throw new CheckpointerCreationError(
          "sqlite",
          "sqlitePath is required for SQLite checkpointer",
        );
      }
      const saver = new SqliteCheckpointSaver(config.sqlitePath);
      console.log(`Created SqliteCheckpointSaver checkpointer (path=${config.sqlitePath})`);
      return saver;
    }

    case "memory":
      console.log("Created MemorySaver checkpointer (ephemeral, in-memory)");
      return new MemorySaver();

    case "http": {
      if (!config.proxyEndpoint) {
        throw new CheckpointerCreationError(
          "http",
          "proxyEndpoint is required for HTTP checkpointer",
        );
      }
      if (!config.authToken) {
        throw new CheckpointerCreationError(
          "http",
          "authToken is required for HTTP checkpointer",
        );
      }
      const saver = new HttpCheckpointSaver(config.proxyEndpoint, config.authToken);
      console.log(`Created HttpCheckpointSaver checkpointer (proxy=${config.proxyEndpoint})`);
      return saver;
    }

    default: {
      const exhaustive: never = config.type;
      throw new CheckpointerCreationError(
        String(exhaustive),
        `Unknown checkpointer type. Valid types: sqlite, http, memory`,
      );
    }
  }
}
