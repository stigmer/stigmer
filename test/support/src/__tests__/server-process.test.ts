// Unit arms for how spawnServer learns its server's ports (stigmer#1469): the
// child is handed port 0 for both listeners and asked for its ready line, so
// no harness ever hands it a port another listener could take; a fixed gRPC
// port passes through and a report contradicting it, or naming no bound port,
// is refused; the report is found among other stdout lines and across split
// writes; and a child that
// exits first, or never reports, fails with its log tail (the silent one with
// the rebuild hint a stale build needs).
// A fixture child (fixtures/ready-line-server.ts) stands in for the server;
// the server's own side of the contract is pinned by its boot/ready-line.ts
// tests and scripts/verify-boot.mjs.
// Domain: test support (stack spawns).
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { spawnServer, type RunningServer } from "../server-process.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/ready-line-server.ts", import.meta.url));

const running: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()));
});

async function spawnFixture(mode: string, extra: { port?: number; readyTimeoutMs?: number } = {}): Promise<RunningServer> {
  const server = await spawnServer(process.execPath, { args: [FIXTURE], env: { FIXTURE_MODE: mode }, ...extra });
  running.push(server);
  return server;
}

// The environment the fixture echoed as its first stdout line.
function echoedEnv(server: RunningServer): Record<string, string | undefined> {
  const line = server
    .logTail()
    .split("\n")
    .find((candidate) => candidate.startsWith('{"env":'));
  if (line === undefined) throw new Error(`the fixture echoed no environment:\n${server.logTail()}`);
  return (JSON.parse(line) as { env: Record<string, string | undefined> }).env;
}

describe("spawnServer", () => {
  it("hands the child port 0 for both listeners and takes the ports its ready line reports", async () => {
    const server = await spawnFixture("report");
    expect(echoedEnv(server)).toEqual({ GRPC_PORT: "0", ARTIFACT_HTTP_PORT: "0", STIGMER_READY_LINE: "stdout" });
    expect(server.port).toBeGreaterThan(0);
    expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port}`);
    const artifactPort = Number(new URL(server.artifactServeUrl).port);
    expect(artifactPort).toBeGreaterThan(0);
    expect(artifactPort).not.toBe(server.port);
  });

  it("passes a fixed gRPC port through and keeps the artifact lane ephemeral", async () => {
    const server = await spawnFixture("report", { port: 7299 });
    expect(echoedEnv(server)).toMatchObject({ GRPC_PORT: "7299", ARTIFACT_HTTP_PORT: "0" });
    expect(server.port).toBe(7299);
  });

  it("refuses a ready line that contradicts the fixed gRPC port", async () => {
    await expect(spawnFixture("wrong-port", { port: 7299 })).rejects.toThrow(
      "stigmer-server was asked for gRPC port 7299 but reported 7300 on its ready line",
    );
  });

  it("refuses a ready line that names no bound port, with the line and the field", async () => {
    // The harness runs local artifact storage, so a report without the
    // artifact lane's port cannot be turned into the runner's serve URL.
    const failure = spawnFixture("unbound");
    await expect(failure).rejects.toThrow("stigmer-server printed a ready line naming no bound port (artifactHttpPort)");
    await expect(failure).rejects.toThrow('"artifactHttpPort":null');
  });

  it("skips stdout lines that are not the report, and reads a report written in two parts", async () => {
    // Every mode echoes its environment first, so each arm here also proves
    // the skip; this one adds the split write.
    const server = await spawnFixture("split");
    expect(server.port).toBeGreaterThan(0);
  });

  it("fails with the log tail when the child exits before reporting", async () => {
    const failure = spawnFixture("exit");
    await expect(failure).rejects.toThrow("stigmer-server exited before becoming ready (code=3, signal=null)");
    await expect(failure).rejects.toThrow("fixture: refusing to boot");
  });

  it("fails with the rebuild hint when the child never reports", async () => {
    const failure = spawnFixture("silent", { readyTimeoutMs: 1_500 });
    await expect(failure).rejects.toThrow("stigmer-server did not print its ready line within 1500ms");
    await expect(failure).rejects.toThrow("rebuild it (make build-server)");
  });
});
