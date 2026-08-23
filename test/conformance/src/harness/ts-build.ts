// Builds the TypeScript stigmer-server-ts from source so the suite always
// tests HEAD — the go-build.ts twin for the local-ts target.
// Domain: conformance harness (server lifecycle).
//
// The build compiles in place (backend/services/stigmer-server-ts/dist):
// tsc is deterministic and the dist path is stable, so workers locate the
// entry without env-var plumbing, exactly like the Go binary's temp path.
// Dependencies install only when node_modules is missing (a fresh checkout
// or CI); the file-linked @stigmer/protos dist must exist first — the
// make target's build-ts-stubs dependency guarantees it, and the fallback
// here keeps single-file editor runs working.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Repo root is four levels up from test/conformance/src/harness/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const SERVER_DIR = join(REPO_ROOT, "backend", "services", "stigmer-server-ts");

export function tsServerEntryPath(): string {
  return join(SERVER_DIR, "dist", "main.js");
}

export async function buildTsServer(): Promise<string> {
  if (!existsSync(join(SERVER_DIR, "node_modules"))) {
    await execFileAsync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: SERVER_DIR,
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  await execFileAsync("npm", ["run", "build"], {
    cwd: SERVER_DIR,
    maxBuffer: 64 * 1024 * 1024,
  });
  return tsServerEntryPath();
}

// Fallback for a single suite file run without global-setup (e.g. from an
// editor). Building is idempotent; reuse an existing dist if present.
export async function ensureTsServerEntry(): Promise<string> {
  const entry = tsServerEntryPath();
  if (existsSync(entry)) return entry;
  return buildTsServer();
}
