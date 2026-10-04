// run() over HTTP: the standalone transports mount the stateless handler.
//
// Pins that run() in "http" and "both" modes binds a listener that answers
// (its /health probe, and an MCP request through the handler), and stops
// cleanly when its signal aborts. The routes themselves are pinned by
// http.test.ts through the same handler. The port is the one the listener
// reports in its startup line, never a probed one (stigmer#1469).

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfigFromEnv, type Config } from "../config";
import { run } from "../index";

function config(transport: Config["transport"]): Config {
  return { ...loadConfigFromEnv({}), transport, httpPort: "0", logLevel: "info" };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Captures stderr and resolves the port from run()'s "HTTP transport listening" line. */
function listeningPort(): () => number | undefined {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  return () => {
    const line = lines.find((l) => l.includes("HTTP transport listening"));
    const match = line === undefined ? null : /addr=:(\d+)/.exec(line);
    return match === null ? undefined : Number(match[1]);
  };
}

describe("run() over HTTP", () => {
  it.each(["http", "both"] as const)("serves %s through the handler and stops on abort", async (transport) => {
    const port = listeningPort();
    const controller = new AbortController();
    const running = run(config(transport), controller.signal);

    const bound = await vi.waitFor(() => {
      const p = port();
      expect(p).toBeDefined();
      return p!;
    });
    expect((await fetch(`http://127.0.0.1:${bound}/health`)).status).toBe(200);
    const listed = await fetch(`http://127.0.0.1:${bound}/channels`, {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);

    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });
});
