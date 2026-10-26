/**
 * A synthetic Claude engine for the engine home and fetch suites: an SDK
 * package whose entry exports a marker instead of Anthropic's code, a
 * platform package whose `claude` is a short script, the pin a published
 * runner would carry for them, and a loopback registry that serves them and
 * counts every request.
 *
 * Shaped like the real packages where the runner reads them (the SDK's
 * `package.json` version beside its `sdk.mjs` entry and its `exports`, the
 * executable at the platform package's root), so a home built from it is
 * found, verified and loaded by the same code a real one is. The real
 * 0.3.310 packages are downloaded only by the build's measure step, never by
 * a unit test.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { buildPackageTarball, sriSha512 } from "@stigmer/artifact-fetch/testing";

import { CLAUDE_SDK, engineExecutable, type ClaudeEnginePin } from "../activities/execute-claude/engine-home.js";

/** The marker the synthetic SDK's entry exports, so a test can tell which engine loaded. */
export const FIXTURE_MARKER = "the synthetic Claude engine";

/** The synthetic SDK's files at `version`. */
export function sdkFiles(version: string, marker: string = FIXTURE_MARKER): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: CLAUDE_SDK,
      version,
      type: "module",
      exports: { ".": { types: "./sdk.d.ts", default: "./sdk.mjs" } },
    }),
    "sdk.mjs": `export const marker = ${JSON.stringify(marker)};\nexport const version = ${JSON.stringify(version)};\nexport function query() { throw new Error("synthetic"); }\n`,
  };
}

/** The synthetic platform package's files. */
export function platformFiles(name: string, version: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  return {
    "package.json": JSON.stringify({ name, version }),
    [engineExecutable(platform)]: "#!/bin/sh\necho synthetic claude\n",
  };
}

/** Writes a complete home for `version` into `home`, as an install leaves one. */
export function writeHome(home: string, version: string, platformPackage: string, marker: string = FIXTURE_MARKER): void {
  const write = (pkg: string, files: Record<string, string>): void => {
    for (const [path, content] of Object.entries(files)) {
      const target = join(home, "node_modules", ...pkg.split("/"), path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content, { mode: path === "claude" || path === "claude.exe" ? 0o755 : 0o644 });
    }
  };
  write(CLAUDE_SDK, sdkFiles(version, marker));
  write(platformPackage, platformFiles(platformPackage, version));
}

/** A route's answer: the tarball, or a scripted failure. */
export type RouteOverride = (res: ServerResponse, hit: number, body: Buffer) => boolean;

/** The loopback registry: its pin, its request counts, and a way to script failures per package. */
export interface FixtureRegistry {
  readonly pin: ClaudeEnginePin;
  readonly base: string;
  /** Requests per package name. */
  hits(name: string): number;
  /** Scripts a package's route; return true when the override answered. */
  override(name: string, route: RouteOverride): void;
  /** Serves different bytes for a package than the pin's integrity names. */
  tamper(name: string, bytes: Buffer): void;
  close(): Promise<void>;
}

/** Starts a registry serving the SDK and `platformPackage` at `version`. */
export async function startFixtureRegistry(version: string, platformPackage: string): Promise<FixtureRegistry> {
  const tarballs = new Map<string, Buffer>([
    [CLAUDE_SDK, buildPackageTarball(sdkFiles(version))],
    [platformPackage, buildPackageTarball(platformFiles(platformPackage, version), { claude: 0o755, "claude.exe": 0o755 })],
  ]);
  const served = new Map(tarballs);
  const counts = new Map<string, number>();
  const overrides = new Map<string, RouteOverride>();
  const byPath = new Map<string, string>();
  for (const name of tarballs.keys()) byPath.set(`/${name.replace("/", "%2f")}.tgz`, name);

  const server: Server = createServer((req, res) => {
    const name = byPath.get(req.url ?? "");
    if (name === undefined) {
      res.writeHead(404).end();
      return;
    }
    const hit = (counts.get(name) ?? 0) + 1;
    counts.set(name, hit);
    const body = served.get(name) as Buffer;
    if (overrides.get(name)?.(res, hit, body) === true) return;
    res.writeHead(200, { "content-length": String(body.length) }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const packages: Record<string, { resolved: string; integrity: string }> = {};
  for (const [path, name] of byPath) packages[name] = { resolved: `${base}${path}`, integrity: sriSha512(tarballs.get(name) as Buffer) };

  return {
    pin: { version, packages },
    base,
    hits: (name) => counts.get(name) ?? 0,
    override: (name, route) => void overrides.set(name, route),
    tamper: (name, bytes) => void served.set(name, bytes),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // A scripted body that never ends must not hold the close.
        server.closeAllConnections();
      }),
  };
}
