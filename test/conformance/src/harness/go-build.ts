// Builds the OSS Go stigmer-server from source so the suite always tests HEAD.
// Domain: conformance harness (server lifecycle).
//
// The binary is written to a deterministic temp path so test workers can locate
// it without env-var plumbing: global-setup builds it fresh once per run, and
// each worker simply reuses that path.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Repo root is four levels up from test/conformance/src/harness/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Package path relative to the repo root; go.work resolves backend/libs/go and
// the generated Go stubs that the server depends on.
const SERVER_PACKAGE = "./backend/services/stigmer-server/cmd/server";

const OUTPUT_DIR = join(tmpdir(), "stigmer-conformance");
const BINARY_NAME = process.platform === "win32" ? "stigmer-server.exe" : "stigmer-server";

export function serverBinaryPath(): string {
  return join(OUTPUT_DIR, BINARY_NAME);
}

export async function buildServer(): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const binary = serverBinaryPath();
  await execFileAsync("go", ["build", "-o", binary, SERVER_PACKAGE], {
    cwd: REPO_ROOT,
    // A cold build pulls a large dependency graph; raise the stdio buffer so a
    // verbose toolchain warning stream cannot abort the build.
    maxBuffer: 64 * 1024 * 1024,
  });
  return binary;
}

// Used as a fallback when a single suite file runs without global-setup (e.g.
// from an editor). Building is idempotent; reuse an existing binary if present.
export async function ensureServerBinary(): Promise<string> {
  const binary = serverBinaryPath();
  if (existsSync(binary)) return binary;
  return buildServer();
}
