// A real Connect backend over h2c serving the plugin push, and the CLI run
// against it, for the command suites that install a plugin (`mcp add`,
// `push plugin`, `apply`).
//
// The backend records every push and answers with the plugin a test chose,
// so a suite asserts both what reached the server and how the CLI renders
// the server's answer. The config file lives under a temporary HOME that
// points a selfhost backend at the listener; the program, the option
// reading, the archive and the transport are all real.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import type { PushPluginRequest } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { vi } from "vitest";
import { classify, ExitCode } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

/** A listening plugin backend: the pushes it received, and how to stop it. */
export interface PluginBackend {
  readonly port: number;
  readonly pushes: PushPluginRequest[];
  /** The plugin every push answers with; a test sets it before running. */
  answer: Plugin;
  close(): Promise<void>;
}

/** Start the backend on a free loopback port. */
export async function startPluginBackend(answer: Plugin): Promise<PluginBackend> {
  const sessions = new Set<ServerHttp2Session>();
  const state = {
    answer,
    pushes: [] as PushPluginRequest[],
  };
  const routes = (router: ConnectRouter) => {
    router.service(PluginCommandController, {
      push: (req) => {
        state.pushes.push(req);
        return state.answer;
      },
    });
  };
  const server: Http2Server = createHttp2Server(connectNodeAdapter({ routes }));
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    get pushes() {
      return state.pushes;
    },
    get answer() {
      return state.answer;
    },
    set answer(next: Plugin) {
      state.answer = next;
    },
    close: async () => {
      for (const session of sessions) session.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A temporary HOME whose config points a selfhost backend at `port`, context org `acme`. */
export interface TestHome {
  readonly dir: string;
  restore(): void;
}

export function useTestHome(port: number): TestHome {
  const original = process.env.HOME;
  const dir = mkdtempSync(join(tmpdir(), "stigmer-cli-home-"));
  process.env.HOME = dir;
  mkdirSync(join(dir, ".stigmer"), { recursive: true });
  writeFileSync(
    join(dir, ".stigmer", "config.yaml"),
    [
      "backend:",
      "  type: cloud",
      "backends:",
      "  test:",
      "    type: selfhost",
      `    endpoint: 127.0.0.1:${port}`,
      "current_backend: test",
      "context:",
      "  org: acme",
      "",
    ].join("\n"),
  );
  return {
    dir,
    restore: () => {
      if (original === undefined) delete process.env.HOME;
      else process.env.HOME = original;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** How one CLI run ended: its exit code, the error's message, and what it wrote. */
export interface RunOutcome {
  readonly exitCode: number;
  readonly message: string;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run `stigmer <args>` in process, capturing stdout and stderr. */
export async function runCli(args: readonly string[]): Promise<RunOutcome> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  let stderr = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await program.parseAsync(["node", "stigmer", ...args]);
    return { exitCode: ExitCode.Success, message: "", stdout, stderr };
  } catch (err) {
    return {
      exitCode: classify(err)?.exitCode ?? -1,
      message: err instanceof Error ? err.message : String(err),
      stdout,
      stderr,
    };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}
