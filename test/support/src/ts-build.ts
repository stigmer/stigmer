// Builds the TypeScript server from source so the suite always tests HEAD —
// used by the local targets, the enterprise target and the MCP bridge suite.
// Domain: test support (stack spawns).
//
// The build compiles in place (backend/services/stigmer-server/dist):
// tsc is deterministic and the dist path is stable, so workers locate the
// entry without env-var plumbing.
// Dependencies install only when node_modules is missing (a fresh checkout
// or CI); the file-linked workspace-lib dists must exist first — built
// below through the canonical root script, which also keeps single-file
// editor runs working from a fresh checkout.
//
// The server and library-entry functions take an optional checkout root,
// defaulting to this one: the live benchmark boots another checkout's server
// through it (`--stack`), so one instrument measures two versions of the code.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Repo root is three levels up from test/support/src/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const serverDir = (root: string): string => join(root, "backend", "services", "stigmer-server");

const ENTERPRISE_DIR = join(REPO_ROOT, "ee", "server");

// The shipped entry: the open-source edition, which holds one organization.
export function tsServerEntryPath(root: string = REPO_ROOT): string {
  return join(serverDir(root), "dist", "main.js");
}

// The library entry: the same process body with no extension unit, holding
// any number of organizations (library-server.mjs says why the harness
// needs it).
export function libraryServerEntryPath(root: string = REPO_ROOT): string {
  return join(root, "test", "support", "src", "library-server.mjs");
}

export async function buildTsServer(root: string = REPO_ROOT): Promise<string> {
  // The server file-links the workspace libs (@stigmer/apis,
  // @stigmer/temporal-codecs, @stigmer/zip-structure), so their dists must
  // exist before the server compiles. The root
  // build:runner-deps script is the one canonical list of those libs —
  // building through it (rather than naming libs here) means a future
  // file-linked lib cannot silently break this harness the way
  // zip-structure did when only temporal-codecs was built. Idempotent tsc;
  // always fresh so the suite tests HEAD.
  await execFileAsync("npm", ["run", "build:runner-deps"], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!existsSync(join(serverDir(root), "node_modules"))) {
    await execFileAsync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: serverDir(root),
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  await execFileAsync("npm", ["run", "build"], {
    cwd: serverDir(root),
    maxBuffer: 64 * 1024 * 1024,
  });
  return tsServerEntryPath(root);
}

// Fallback for a single suite file run without global-setup (e.g. from an
// editor). Building is idempotent; reuse an existing dist if present.
export async function ensureTsServerEntry(root: string = REPO_ROOT): Promise<string> {
  const entry = tsServerEntryPath(root);
  if (existsSync(entry)) return entry;
  return buildTsServer(root);
}

// The library entry, building the server first when its dist is missing:
// the entry imports the built process body.
export async function ensureLibraryServerEntry(root: string = REPO_ROOT): Promise<string> {
  await ensureTsServerEntry(root);
  return libraryServerEntryPath(root);
}

// The conformance suite's licensed Enterprise server: TypeScript under
// Stigmer Enterprise's own package, run from source and never built
// (ee/server/test/conformance/licensed-server.ts says why). The harness
// starts it by path; nothing here imports from ee/.
export function enterpriseServerEntryPath(): string {
  return join(ENTERPRISE_DIR, "test", "conformance", "licensed-server.ts");
}

// The loader `node --import` takes to run that entry: the repository root's
// own tsx, resolved from the root manifest that declares it, so the spawned
// server's working directory never decides which tsx loads.
export function tsxLoaderUrl(): string {
  return pathToFileURL(createRequire(join(REPO_ROOT, "package.json")).resolve("tsx")).href;
}

// The Enterprise entry, building the server first when its dist is missing
// (the entry composes onto the built library). Enterprise keeps its own
// dependencies, which this harness does not install: without them it
// refuses, naming the install.
export async function ensureEnterpriseServerEntry(): Promise<string> {
  await ensureTsServerEntry();
  if (!existsSync(join(ENTERPRISE_DIR, "node_modules"))) {
    throw new Error(
      "ee/server/node_modules is missing: the enterprise target runs Stigmer Enterprise from source " +
        "on its own dependencies; install them with `npm ci` in ee/server first",
    );
  }
  return enterpriseServerEntryPath();
}
