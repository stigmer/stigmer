/**
 * Heartbeat client for the unified runner bidi stream.
 *
 * Opens a persistent bidirectional gRPC stream to the Stigmer server and
 * sends periodic RunnerHeartbeat messages (every 30s). The server uses
 * these heartbeats for liveness detection and sandbox lifecycle management.
 *
 * Opt-in: disabled when STIGMER_RUNNER_ID is not set (local/OSS mode).
 * Failures are logged but never crash the worker process.
 */

import { hostname } from "node:os";
import { arch, platform } from "node:process";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { RunnerCommandController } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/command_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import {
  RunnerHeartbeatSchema,
  RunnerStreamClientMessageSchema,
  type RunnerStreamClientMessage,
  type RunnerStreamServerMessage,
} from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { RunnerConnectionInfoSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { getActiveCount } from "./idle-watchdog.js";
import type { Config } from "./config.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

export function startHeartbeat(config: Config): () => void {
  if (!config.runnerId) {
    console.log("Heartbeat disabled (STIGMER_RUNNER_ID not set)");
    return () => {};
  }

  let stopped = false;
  const abortController = new AbortController();

  const connectionInfo = create(RunnerConnectionInfoSchema, {
    hostname: hostname(),
    os: platform,
    arch,
  });

  function buildHeartbeat(): RunnerStreamClientMessage {
    const active = getActiveCount();
    const heartbeat = create(RunnerHeartbeatSchema, {
      runnerId: config.runnerId!,
      phase: active > 0 ? RunnerPhase.BUSY : RunnerPhase.READY,
      currentExecutions: active,
      connectionInfo,
      processType: "runner",
    });
    return create(RunnerStreamClientMessageSchema, {
      message: { case: "heartbeat", value: heartbeat },
    });
  }

  async function runStream(): Promise<void> {
    const transport = createGrpcTransport({
      baseUrl: config.stigmerBackendEndpoint,
      interceptors: config.stigmerToken
        ? [
            (next) => async (req) => {
              req.header.set("authorization", `Bearer ${config.stigmerToken}`);
              return next(req);
            },
          ]
        : [],
    });

    const client = createClient(RunnerCommandController, transport);

    async function* heartbeatGenerator(): AsyncIterable<RunnerStreamClientMessage> {
      yield buildHeartbeat();

      while (!stopped) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, HEARTBEAT_INTERVAL_MS);
          abortController.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          }, { once: true });
        });
        if (stopped) break;
        yield buildHeartbeat();
      }
    }

    const responses: AsyncIterable<RunnerStreamServerMessage> = client.connect(
      heartbeatGenerator(),
      { signal: abortController.signal },
    );

    for await (const msg of responses) {
      if (msg.message.case === "commandRequest") {
        console.log(
          `[heartbeat] Received command: ${msg.message.value.command.case ?? "unknown"}`,
        );
      }
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        console.log(`[heartbeat] Connecting to ${config.stigmerBackendEndpoint}...`);
        await runStream();
        if (!stopped) {
          console.warn("[heartbeat] Stream ended unexpectedly, reconnecting...");
        }
      } catch (err: unknown) {
        if (stopped) break;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[heartbeat] Stream error: ${message} — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      }
    }
  }

  loop().catch((err) => {
    if (!stopped) {
      console.error("[heartbeat] Fatal loop error (heartbeat stopped):", err);
    }
  });

  console.log(`[heartbeat] Started for runner ${config.runnerId}`);

  return () => {
    stopped = true;
    abortController.abort();
  };
}
