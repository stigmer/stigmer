/**
 * Pins the process body both entries share (boot/run.ts), driven in-process
 * through a recording ProcessHost:
 *
 *   - it composes the given units, starts, and prints the ready line with
 *     the bound ports; the open-source unit's server holds its one
 *     organization by then;
 *   - SIGTERM runs the composed shutdown and exits 0, and a second signal
 *     does nothing more; a shutdown that fails is logged and exits 1;
 *   - a failed start is logged and exits 1, with no ready line;
 *   - a composition failure rejects, for the entry to report on stderr.
 *
 * The shipped entry itself (main.ts) is proven on the built artifact by
 * scripts/verify-boot.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { READY_LINE_KEY } from "../ready-line.js";
import { nodeProcessHost, runServer } from "../run.js";
import type { ProcessHost } from "../run.js";
import { openSourceEdition } from "../../editions/open-source.js";
import type { SandboxProvisioner } from "../../sandbox/provisioner.js";
import { resetOperatorIdentityForTests } from "../../pipeline/steps/defaults.js";

interface RecordingHost extends ProcessHost {
  readonly signals: Map<string, () => void>;
  readonly exits: number[];
  readonly stdout: string[];
  /** Resolves with the first exit code. */
  readonly exited: Promise<number>;
}

function recordingHost(): RecordingHost {
  const signals = new Map<string, () => void>();
  const exits: number[] = [];
  const stdout: string[] = [];
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  return {
    signals,
    exits,
    stdout,
    exited,
    onSignal: (signal, handler) => {
      signals.set(signal, handler);
    },
    exit: (code) => {
      exits.push(code);
      resolveExit(code);
    },
    writeStdout: (text) => {
      stdout.push(text);
    },
  };
}

describe("runServer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "run-server-test-"));
    vi.stubEnv("STIGMER_MODEL_REGISTRY_REFRESH", "off");
    vi.stubEnv("TEMPORAL_HOST_PORT", "127.0.0.1:1");
    vi.stubEnv("DB_PATH", path.join(dir, "stigmer.db"));
    vi.stubEnv("STORAGE_PATH", path.join(dir, "storage"));
    vi.stubEnv("ARTIFACT_LOCAL_BASE_PATH", path.join(dir, "artifacts"));
    vi.stubEnv("GRPC_PORT", "0");
    vi.stubEnv("STIGMER_READY_LINE", "stdout");
    vi.stubEnv("LOG_LEVEL", "error");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts the composed units, prints the ready line, and exits 0 on SIGTERM once", async () => {
    const host = recordingHost();
    await runServer({ extensions: [openSourceEdition], host });

    expect(host.stdout).toHaveLength(1);
    const ready = JSON.parse(host.stdout[0] ?? "") as Record<
      string,
      { grpcPort: number }
    >;
    const grpcPort = ready[READY_LINE_KEY]?.grpcPort ?? 0;
    expect(grpcPort).toBeGreaterThan(0);

    const organizations = createClient(
      OrganizationQueryController,
      createGrpcTransport({ baseUrl: `http://127.0.0.1:${grpcPort}` }),
    );
    expect(
      (await organizations.findMyOrganizations({})).entries.map(
        (org) => org.metadata?.id,
      ),
    ).toEqual(["stigmer"]);

    host.signals.get("SIGTERM")?.();
    host.signals.get("SIGINT")?.();
    expect(await host.exited).toBe(0);
    expect(host.exits).toEqual([0]);
  });

  it("a shutdown that fails is logged and exits 1", async () => {
    // A unit's sandbox driver whose background work cannot stop: the
    // composed shutdown awaits it, so its rejection reaches runServer.
    vi.stubEnv("SANDBOX_PROVISIONER_TYPE", "failing-stop");
    vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
    const provisioner = {
      startBackground() {
        return {
          stop: () => Promise.reject(new Error("the sandboxes will not stop")),
        };
      },
    } as unknown as SandboxProvisioner;
    const stderr: string[] = [];
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      });
    try {
      const host = recordingHost();
      await runServer({
        extensions: [
          {
            name: "failing-stop-sandboxes",
            drivers: {
              sandboxProvisionerDrivers: new Map([
                ["failing-stop", () => provisioner],
              ]),
            },
          },
        ],
        host,
      });
      host.signals.get("SIGTERM")?.();

      expect(await host.exited).toBe(1);
      expect(host.exits).toEqual([1]);
      expect(stderr.join("")).toContain("shutdown failed");
    } finally {
      write.mockRestore();
    }
  });

  it("a failed start is logged and exits 1, with no ready line", async () => {
    const host = recordingHost();
    await runServer({
      extensions: [
        {
          name: "broken",
          start: () => Promise.reject(new Error("the unit cannot start")),
        },
      ],
      host,
    });

    expect(host.exits).toEqual([1]);
    expect(host.stdout).toEqual([]);
  });

  it("the real host registers its signal handlers and exits through the process", () => {
    const on = vi.spyOn(process, "on").mockImplementation(() => process);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    try {
      const handler = (): void => {};
      nodeProcessHost.onSignal("SIGTERM", handler);
      nodeProcessHost.exit(3);
      expect(on).toHaveBeenCalledWith("SIGTERM", handler);
      expect(exit).toHaveBeenCalledWith(3);
    } finally {
      on.mockRestore();
      exit.mockRestore();
    }
  });

  it("the real host writes the ready line to the process's stdout", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      nodeProcessHost.writeStdout("ready\n");
      expect(write).toHaveBeenCalledWith("ready\n");
    } finally {
      write.mockRestore();
    }
  });

  it("a composition failure rejects for the entry to report", async () => {
    const host = recordingHost();
    await expect(
      runServer({ extensions: [{ name: "odd", orgLimit: 0 }], host }),
    ).rejects.toThrow(/declares orgLimit 0/);
    expect(host.exits).toEqual([]);
  });
});
