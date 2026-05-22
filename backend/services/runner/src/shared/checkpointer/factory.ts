/**
 * Checkpointer factory — creates the appropriate LangGraph checkpoint
 * saver based on runner configuration.
 *
 * Two backends:
 * - memory: MemorySaver (ephemeral, zero-config) — for OSS / local mode
 * - http: HttpCheckpointSaver (proxy-backed) — for cloud mode
 *
 * The returned saver is used by the deep agent activity (Phase 3).
 * Cursor executions do not use LangGraph checkpointers — they rely on
 * the Cursor SDK's native agent state persistence.
 */

import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { CheckpointerConfig } from "./types.js";
import { HttpCheckpointSaver } from "./http-saver.js";

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
 * Unlike the Python version (which returns an async context manager),
 * the JS MemorySaver and HttpCheckpointSaver do not require async
 * initialization or cleanup. This function is kept async to accommodate
 * future backends that might need setup (e.g. SQLite connection).
 */
export async function createCheckpointer(
  config: CheckpointerConfig,
): Promise<BaseCheckpointSaver> {
  switch (config.type) {
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
        `Unknown checkpointer type. Valid types: memory, http`,
      );
    }
  }
}
