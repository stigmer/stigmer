/**
 * Boot-ordering (health gate) tests — the contract the CLI's serverGate
 * depends on (Go server.go:739-743, 839-843; grpc lib Stop :247-265):
 *
 *   - overall health is NOT_SERVING from construction until the
 *     composition root completes;
 *   - start() flips SERVING BEFORE the port binds, so the first probe that
 *     reaches the port already sees a serving server;
 *   - shutdown flips NOT_SERVING FIRST, then drains — and the port stops
 *     answering;
 *   - the artifact download lane binds before SERVING, so a lane that
 *     cannot bind fails start() with the address and the setting named and
 *     the server never reports itself serving (stigmer#1089), and a server
 *     on an ephemeral port gets an ephemeral lane whose minted download
 *     URLs reach it, and reports both ports it bound once started, and
 *     none before (the ready line's source, stigmer#1469);
 *   - the skill transfer lane's capability URLs on an ephemeral unified
 *     port name the port the server bound, and a PUT to one reaches it
 *     (stigmer#1386);
 *   - a served console's MCP OAuth callback is derived on the public
 *     origin the operator named in SKILL_TRANSFER_BASE_URL, whatever the
 *     port, and without one an ephemeral port still derives nothing
 *     (stigmer#1200).
 */
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import { ArtifactQueryController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/query_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import {
  createServer as netCreateServer,
  connect as netConnect,
} from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import { createLogger } from "../logger.js";
import type { LogEntry, Logger } from "../logger.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function compose(env: NodeJS.ProcessEnv = {}, logger: Logger = silentLogger) {
  // Each composed server gets a throwaway database — the storage stage
  // opens DB_PATH for real (never the developer's ~/.stigmer).
  const testDir = mkdtempSync(path.join(tmpdir(), "compose-test-"));
  const config = loadConfig({
    ...env,
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
    // No engine behind composed tests: 127.0.0.1:1 is deterministically
    // closed, so boots fail the non-fatal connect fast and can never touch
    // a live local Temporal (the conformance CRUD harness does the same).
    TEMPORAL_HOST_PORT: "127.0.0.1:1",
    DB_PATH: path.join(testDir, "stigmer.db"),
    // Keep the artifact store inside the test dir (never ~/.stigmer).
    ARTIFACT_LOCAL_BASE_PATH: path.join(testDir, "artifacts"),
    // Same for the skill artifact store — its boot-time staging wipe (#8)
    // must never run against the real ~/.stigmer/storage.
    STORAGE_PATH: path.join(testDir, "storage"),
  });
  return composeServer({
    config,
    logger,
    portOverride: 0,
    host: "127.0.0.1",
  });
}

describe("composition-root boot ordering", () => {
  it("is NOT_SERVING at construction and SERVING once the port answers", async () => {
    const server = await compose();
    expect(server.healthState.status("")).toBe(ServingStatus.NOT_SERVING);

    const port = await server.start();
    try {
      const client = createClient(
        Health,
        createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }),
      );
      // The serverGate contract: if the port accepts, health is already
      // SERVING — there is no bound-but-not-ready window.
      const response = await client.check({});
      expect(response.status).toBe(ServingStatus.SERVING);
    } finally {
      await server.shutdown();
    }
  });

  it("flips NOT_SERVING on shutdown and stops answering the port", async () => {
    const server = await compose();
    const port = await server.start();

    await server.shutdown();

    expect(server.healthState.status("")).toBe(ServingStatus.NOT_SERVING);
    const refused = await new Promise<boolean>((resolve) => {
      const probe = netConnect(port, "127.0.0.1");
      probe.once("connect", () => {
        probe.destroy();
        resolve(false);
      });
      probe.once("error", () => resolve(true));
    });
    expect(refused, "the drained port must refuse new connections").toBe(true);
  });
});

describe("the artifact download lane", () => {
  it("fails start() when the lane cannot bind, naming the address and the setting, and never serves", async () => {
    const holder = netCreateServer();
    await new Promise<void>((resolve) =>
      holder.listen(0, "127.0.0.1", resolve),
    );
    const held = (holder.address() as AddressInfo).port;
    try {
      const server = await compose({ ARTIFACT_HTTP_PORT: String(held) });
      try {
        await expect(server.start()).rejects.toThrow(
          `the artifact file server could not bind '127.0.0.1:${held}' (EADDRINUSE): ARTIFACT_HTTP_PORT=${held} cannot be bound; set it to a free port`,
        );
        // SERVING is set before the unified port binds, so a server that is
        // still NOT_SERVING never opened it.
        expect(server.healthState.status("")).toBe(ServingStatus.NOT_SERVING);
      } finally {
        await server.shutdown();
      }
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  it("binds an ephemeral lane beside an ephemeral unified port, reports both, and a minted download URL reaches it", async () => {
    const server = await compose();
    expect(server.boundPorts()).toBeUndefined();
    const port = await server.start();
    try {
      // What the process entry announces on the ready line: the two ports
      // the listeners got, neither of them the 0 they were asked for.
      const bound = server.boundPorts();
      expect(bound?.grpc).toBe(port);
      expect(bound?.artifactHttp).toBeGreaterThan(0);
      expect(bound?.artifactHttp).not.toBe(port);

      const transport = createGrpcTransport({
        baseUrl: `http://127.0.0.1:${port}`,
      });
      const command = createClient(ArtifactCommandController, transport);
      const query = createClient(ArtifactQueryController, transport);
      const content = new TextEncoder().encode("ephemeral lane body\n");
      const created = await command.create({
        spec: {
          displayName: "ephemeral-lane.txt",
          contentType: "text/plain",
          source: { agentExecutionId: "aexec_01ephemerallane" },
        },
        content,
      });
      const download = await query.getDownloadUrl({
        value: created.metadata!.id,
      });

      // An OS-assigned port, never the privileged port 1 that +1 derived
      // from 0; the bytes coming back prove it is THIS server's lane.
      expect(Number(new URL(download.url).port)).toBeGreaterThan(1024);
      expect(Number(new URL(download.url).port)).toBe(bound?.artifactHttp);
      const served = await fetch(download.url);
      expect(served.status).toBe(200);
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(content);
    } finally {
      await server.shutdown();
    }
  });
});

describe("the skill transfer lane", () => {
  it("mints upload URLs for the port an ephemeral unified listener bound, and a PUT to one reaches it", async () => {
    const server = await compose();
    const port = await server.start();
    try {
      const transport = createGrpcTransport({
        baseUrl: `http://127.0.0.1:${port}`,
      });
      await seedOrganizations(transport, ["acme"]);
      const command = createClient(SkillCommandController, transport);
      // The lane stages bytes as given; the archive is validated at push,
      // which this case does not reach.
      const body = new TextEncoder().encode("staged skill bytes\n");
      const minted = await command.createArtifactUploadUrl({
        org: "acme",
        sizeBytes: BigInt(body.length),
      });

      // The bound port, never localhost:0 or the config default 7234.
      expect(Number(new URL(minted.url).port)).toBe(port);
      const put = await fetch(minted.url, {
        method: "PUT",
        body,
        headers: { "content-type": "application/zip" },
      });
      expect(put.status).toBe(204);
    } finally {
      await server.shutdown();
    }
  });
});

describe("the MCP OAuth callback", () => {
  /** A console export the console lane discovers: the app shell alone. */
  function consoleExport(): string {
    const dir = path.join(
      mkdtempSync(path.join(tmpdir(), "compose-console-")),
      "console",
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<html>app shell</html>");
    return dir;
  }

  /** A logger that keeps every entry at or above info, for the wiring-time lines. */
  function capturingLogger(): { logger: Logger; entries: LogEntry[] } {
    const entries: LogEntry[] = [];
    const logger = createLogger({
      level: "info",
      pretty: false,
      write: () => {},
      sink: (entry) => entries.push(entry),
    });
    return { logger, entries };
  }

  it("derives the served console's callback on the named public origin, on an ephemeral port too", async () => {
    const { logger, entries } = capturingLogger();
    const server = await compose(
      {
        STIGMER_CONSOLE_DIR: consoleExport(),
        SKILL_TRANSFER_BASE_URL: "https://stigmer.example.test/",
      },
      logger,
    );
    await server.start();
    try {
      const derived = entries.find((entry) =>
        entry.message.startsWith(
          "STIGMER_OAUTH_REDIRECT_URI is not set — deriving",
        ),
      );
      expect(derived?.fields).toEqual({
        redirectUri: "https://stigmer.example.test/auth/oauth/callback",
        from: "public-origin",
      });
    } finally {
      await server.shutdown();
    }
  });

  it("derives nothing on an ephemeral port when no public origin is named", async () => {
    const { logger, entries } = capturingLogger();
    const server = await compose(
      { STIGMER_CONSOLE_DIR: consoleExport() },
      logger,
    );
    await server.start();
    try {
      const redirectLines = entries.filter((entry) =>
        entry.message.startsWith("STIGMER_OAUTH_REDIRECT_URI is not set"),
      );
      expect(
        redirectLines.map((entry) => [entry.level, entry.message]),
      ).toEqual([
        [
          "warn",
          "STIGMER_OAUTH_REDIRECT_URI is not set — OAuth Connect flows for MCP servers are unavailable (initiateOAuthConnect will refuse)",
        ],
      ]);
    } finally {
      await server.shutdown();
    }
  });
});
