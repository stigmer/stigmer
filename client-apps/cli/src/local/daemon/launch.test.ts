// Pins the foreground launcher's contract with the daemon body: the config it
// hands over is the detached shape's, encoded through the same env contract;
// the children inherit that built environment; the post-readiness work (the
// bootstrap, the startup record, the caller's onReady) runs from onStarted;
// the daemon's exit code is the launcher's. Resolution is driven through the
// same overrides a container sets (STIGMER_SERVER_DIR, STIGMER_RUNNER_DIR,
// STIGMER_TEMPORAL_BIN), so nothing is downloaded or installed.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_PORT } from "../constants.js";
import { tcpConnects } from "../net/tcp.js";
import { loadStartupConfig } from "../state/startup-config.js";
import { DaemonEnvVar } from "./env.js";
import { upForeground } from "./launch.js";
import type { InternalDaemonDeps } from "./process.js";

// The launcher refuses to start beside a stack already serving on the server
// port — including a developer's own `stigmer up`. Report SKIPPED rather than
// a false failure in that case.
const serverPortBusy = await tcpConnects(SERVER_PORT, "127.0.0.1", 300);

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A built package in the shape the resolvers accept: package.json + dist/main.js.
function builtPackage(prefix: string): string {
  const dir = tempDir(prefix);
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "main.js"), "//");
  return dir;
}

const TOUCHED = ["STIGMER_SERVER_DIR", "STIGMER_RUNNER_DIR", "STIGMER_TEMPORAL_BIN", "STIGMER_NODE_BIN", "ANTHROPIC_API_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of TOUCHED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.STIGMER_SERVER_DIR = builtPackage("stigmer-fg-server-");
  process.env.STIGMER_RUNNER_DIR = builtPackage("stigmer-fg-runner-");
  const temporalBin = join(tempDir("stigmer-fg-temporal-"), "temporal");
  writeFileSync(temporalBin, "#!/bin/sh\n");
  process.env.STIGMER_TEMPORAL_BIN = temporalBin;
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe.skipIf(serverPortBusy)("upForeground", () => {
  it("runs the daemon body in-process with the detached shape's config and env, bootstrapping from onStarted", async () => {
    const home = tempDir("stigmer-fg-home-");
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const order: string[] = [];
    let captured: InternalDaemonDeps | null = null;

    const code = await upForeground({ noWeb: true }, home, {
      runDaemon: async (deps) => {
        captured = deps;
        order.push("daemon:started");
        await deps.onStarted?.();
        order.push("daemon:waiting");
        return 0;
      },
      bootstrap: async () => {
        order.push("bootstrap");
      },
      onReady: () => {
        order.push("onReady");
      },
      waitForShutdown: () => Promise.resolve(),
    });

    expect(code).toBe(0);
    expect(order).toEqual(["daemon:started", "bootstrap", "onReady", "daemon:waiting"]);

    const deps = captured as unknown as InternalDaemonDeps;
    // The config is the env contract read back — the detached daemon's view.
    expect(deps.config?.dataDir).toBe(join(home, ".stigmer", "data"));
    expect(deps.config?.temporalManaged).toBe(true);
    expect(deps.config?.noWeb).toBe(true);
    expect(deps.config?.server.entryPath).toBe(join(process.env.STIGMER_SERVER_DIR!, "dist", "main.js"));
    expect(deps.config?.runner?.entryPath).toBe(join(process.env.STIGMER_RUNNER_DIR!, "dist", "main.js"));
    expect(deps.config?.anthropicApiKey).toBe("sk-test");
    // The children inherit the built environment, contract variables included.
    expect(deps.env?.[DaemonEnvVar.DataDir]).toBe(join(home, ".stigmer", "data"));
    expect(deps.env?.[DaemonEnvVar.ServerEntry]).toBe(deps.config?.server.entryPath);
    // The startup record names this process as the daemon.
    expect(loadStartupConfig(join(home, ".stigmer", "data"))?.stigmer_server_pid).toBe(process.pid);
  });

  it("propagates the daemon's failure exit code without bootstrapping", async () => {
    const home = tempDir("stigmer-fg-home-");
    const bootstrap = vi.fn(async () => {});

    const code = await upForeground({}, home, {
      // A critical component failed to start: the body returns 1 before onStarted.
      runDaemon: async () => 1,
      bootstrap,
      waitForShutdown: () => Promise.resolve(),
    });

    expect(code).toBe(1);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(loadStartupConfig(join(home, ".stigmer", "data"))).toBeNull();
  });

  it("omits the runner from the contract in server-only mode", async () => {
    const home = tempDir("stigmer-fg-home-");
    let captured: InternalDaemonDeps | null = null;

    await upForeground({ serverOnly: true }, home, {
      runDaemon: async (deps) => {
        captured = deps;
        return 0;
      },
      bootstrap: async () => {},
      waitForShutdown: () => Promise.resolve(),
    });

    const deps = captured as unknown as InternalDaemonDeps;
    expect(deps.config?.serverOnly).toBe(true);
    expect(deps.config?.runner).toBeUndefined();
  });
});
