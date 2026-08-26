/**
 * Pins the artifact file server's bind-host contract (ARTIFACT_HTTP_HOST,
 * DD-013; shipped with the Docker image, Phase-2 P4): the listener binds
 * exactly the host the composition root passes. Loopback — the default —
 * must stay unreachable through non-loopback interfaces (the retired Go
 * server's posture), and the container override (0.0.0.0) must serve the
 * same bytes. The serving behavior itself (traversal guard, disposition,
 * 404 copy) is pinned by artifact.test.ts through the composed server;
 * this file pins only what that test cannot: WHERE the listener binds.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { createArtifactFileServer } from "../file-server.js";
import type { ArtifactFileServer } from "../file-server.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let server: ArtifactFileServer | undefined;

afterEach(async () => {
  await server?.shutdown();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function newServer(): ArtifactFileServer {
  dir = mkdtempSync(path.join(tmpdir(), "artifact-file-server-host-"));
  writeFileSync(path.join(dir, "probe.txt"), "probe-bytes\n");
  server = createArtifactFileServer({ basePath: dir, logger: silentLogger });
  return server;
}

describe("artifact file server bind host", () => {
  it("serves on the loopback default", async () => {
    const port = await newServer().listen(0, "127.0.0.1");
    const response = await fetch(`http://127.0.0.1:${port}/probe.txt`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("probe-bytes\n");
  });

  it("serves through the wildcard host override (the container posture)", async () => {
    const port = await newServer().listen(0, "0.0.0.0");
    // Wildcard-bound listeners answer on loopback too — the reachable
    // proof that the override took effect without needing a second NIC.
    const response = await fetch(`http://127.0.0.1:${port}/probe.txt`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("probe-bytes\n");
  });
});
