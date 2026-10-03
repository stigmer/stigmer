// The server process the harness boots when it needs the library itself:
// the shipped process body (backend/services/stigmer-server/src/boot/run.ts)
// with no extension unit, so the server holds any number of organizations.
// Domain: test support (stack spawns).
//
// The shipped entry (dist/main.js) composes the open-source edition's unit,
// which holds one organization. The suites that prove isolation between
// organizations, and the browser tests that give each test an organization
// of its own, need several, so they spawn this entry instead. It shares the
// shipped entry's whole body, so the two cannot drift in how a process
// boots; only the composed units differ.
//
// It reaches the server's own build by path, the way ts-build.ts reaches
// dist/main.js: the repository's harness, not a package consumer, so the
// package barrel is not involved. Plain ESM, so node runs it with no build;
// ensureLibraryServerEntry() (ts-build.ts) builds the server first.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RUN_MODULE = join(
  REPO_ROOT,
  "backend",
  "services",
  "stigmer-server",
  "dist",
  "boot",
  "run.js",
);

const { runServer } = await import(pathToFileURL(RUN_MODULE).href);

runServer({ extensions: [] }).catch((error) => {
  console.error(
    "boot failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
