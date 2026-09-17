// What `stigmer up` does once the local server answers: seed it. Two steps,
// in this order, each best-effort with its own warning, because the stack is
// already serving by the time either runs and a seeding failure must never
// tear it down:
//
//   1. the seedpack (the system org, the `stigmer` MCP server, the remaining
//      system agents, skills and workflows), content-hash idempotent;
//   2. the default plugins the official marketplace names, installed into the
//      same org as public, idempotent by the server's own digest.
//
// The seedpack goes first because the plugins install INTO the org it
// creates and reference the server it holds. When the seedpack retires, this
// file keeps step 2 and loses step 1, and nothing else moves.
//
// Both `up` shapes (detached and foreground) call this one function, so what
// a detached `up` seeds and what a container's `up --foreground` seeds cannot
// drift. Both always seed the local server `up` just started, never the
// active backend context: a user whose CLI is pointed at cloud must still get
// their local stack seeded, and must never have system resources applied to
// their cloud org. The client is pinned to a fresh local config
// (localhost:SERVER_PORT) with no auth, the trusted-local identity.

import type { BackendClient } from "../client/index.js";
import { log } from "../logger.js";
import { dataDir } from "./paths.js";

/** One seeding step: talks to the user through `say`, never throws past its own warning. */
export type BootstrapStep = (
  client: BackendClient,
  home: string,
  say: Say,
) => Promise<void>;

export type Say = (line: string) => void;

/** Seams of the bootstrap, injectable for tests; the defaults are the real steps over the real local client. */
export interface BootstrapDeps {
  readonly client?: BackendClient;
  readonly seedpack?: BootstrapStep;
  readonly plugins?: BootstrapStep;
  readonly say?: Say;
}

const sayToStderr: Say = (line) => {
  process.stderr.write(`${line}\n`);
};

export async function bootstrapLocalBackend(
  home: string,
  deps: BootstrapDeps = {},
): Promise<void> {
  const client = deps.client ?? (await freshLocalClient());
  const say = deps.say ?? sayToStderr;
  await (deps.seedpack ?? applySeedpackBestEffort)(client, home, say);
  await (deps.plugins ?? installDefaultPluginsBestEffort)(client, home, say);
}

async function freshLocalClient(): Promise<BackendClient> {
  const [{ createBackendClient }, { getDefault }] = await Promise.all([
    import("../client/index.js"),
    import("../config/config.js"),
  ]);
  return createBackendClient({
    config: getDefault(),
    getAccessToken: () => null,
  });
}

/** Step 1. Idempotent via a content-hash marker, so repeated `up`s are cheap. */
export async function applySeedpackBestEffort(
  client: BackendClient,
  home: string,
  say: Say,
): Promise<void> {
  try {
    const { applySeedpack } = await import("./seedpack/apply.js");
    const result = await applySeedpack(
      {
        controller: client.controller,
        stigmer: client.stigmer,
        info: say,
        warn: say,
      },
      { markerDir: dataDir(home), home },
    );
    log.debug("seedpack bootstrap complete", {
      applied: result.applied,
      hash: result.hash,
      org: result.org,
    });
  } catch (err) {
    log.warn("seedpack bootstrap failed", { error: String(err) });
    say(
      "Warning: failed to apply system resources (seedpack). Run 'stigmer seedpack apply' to retry.",
    );
  }
}

/**
 * Step 2. Runs even when step 1 warned: the plugins can only fail on their
 * own terms (an org that does not exist fails the push, and the warning
 * names the command that retries it).
 */
export async function installDefaultPluginsBestEffort(
  client: BackendClient,
  _home: string,
  say: Say,
): Promise<void> {
  try {
    const [{ installDefaultPlugins }, { resolveSeedpackOrg }] =
      await Promise.all([
        import("./plugins/defaults.js"),
        import("./seedpack/apply.js"),
      ]);
    const result = await installDefaultPlugins(
      { stigmer: client.stigmer, info: say },
      { org: resolveSeedpackOrg() },
    );
    log.debug("default plugins bootstrap complete", {
      outcomes: result.outcomes,
    });
    for (const name of result.failed) {
      say(
        `Warning: failed to install default plugin '${name}'. Run 'stigmer install ${name}' to retry.`,
      );
    }
  } catch (err) {
    log.warn("default plugins bootstrap failed", { error: String(err) });
    say(
      "Warning: failed to install the default plugins. Run 'stigmer marketplace show stigmer' to see them and 'stigmer install <name>' to retry.",
    );
  }
}
