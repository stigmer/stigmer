// Builds the TypeScript server from source so the suite always tests HEAD —
// used by the local targets and the MCP bridge suite.
// Domain: conformance harness (server lifecycle).
//
// The build compiles in place (backend/services/stigmer-server/dist):
// tsc is deterministic and the dist path is stable, so workers locate the
// entry without env-var plumbing, exactly like the Go binary's temp path.
// Dependencies install only when node_modules is missing (a fresh checkout
// or CI); the file-linked workspace-lib dists must exist first — built
// below through the canonical root script, which also keeps single-file
// editor runs working from a fresh checkout.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Repo root is four levels up from test/conformance/src/harness/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const SERVER_DIR = join(REPO_ROOT, "backend", "services", "stigmer-server");

export function tsServerEntryPath(): string {
  return join(SERVER_DIR, "dist", "main.js");
}

export async function buildTsServer(): Promise<string> {
  // The server file-links the workspace libs (@stigmer/protos,
  // @stigmer/temporal-codecs since D4 #18, @stigmer/zip-structure since
  // D4 #8), so their dists must exist before the server compiles. The root
  // build:runner-deps script is the one canonical list of those libs —
  // building through it (rather than naming libs here) means a future
  // file-linked lib cannot silently break this harness the way
  // zip-structure did when only temporal-codecs was built. Idempotent tsc;
  // always fresh so the suite tests HEAD.
  await execFileAsync("npm", ["run", "build:runner-deps"], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
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
