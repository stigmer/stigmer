// What makes a backend a ready Stigmer: the system org exists and the
// official marketplace's default plugins are installed into it, public.
// `stigmer up` runs this against the local server it just started;
// `stigmer bootstrap` runs the same two phases against whatever backend the
// CLI is pointed at, for a raw self-hosted server or the platform's daily
// lane. One definition, so a laptop, a container and the hosted platform
// cannot drift in what "ready" means.
//
// Two phases, and the order matters:
//
//   1. prepare: resolve the official marketplace (acquiring `@stigmer/plugins`
//      at the CLI's version on a release's first run) and prepare every
//      default. No backend is touched.
//   2. run: ensure the system org, then push the prepared defaults, each
//      skipped when the backend already holds it at the same digest.
//
// `stigmer up` slides one more step between them: retiring the seedpack an
// older release installed. That step deletes rows, so it runs only after
// phase 1 has every replacement in hand; a user who upgrades offline and
// cannot fetch the new catalogue keeps the old rows for another day instead
// of losing them and getting nothing back. The retire lives here and not in
// `stigmer bootstrap` on purpose: a verb a scheduled lane runs against the
// platform must never be able to delete rows.
//
// Inside `up` every phase is best-effort with its own warning naming the
// retry, because the stack is already serving by the time any of them runs
// and a seeding failure must never tear it down. Both `up` shapes (detached
// and foreground) call this one function, and both seed the local server
// `up` just started, never the active backend context: a CLI pointed at
// cloud still gets its local stack seeded, and never has system resources
// applied to its cloud org. The client is pinned to a fresh local config
// (localhost:SERVER_PORT) with no auth, the trusted-local identity.

import type { Stigmer } from "@stigmer/sdk";
import type { BackendClient } from "../client/index.js";
import { log } from "../logger.js";
import type { ResolveOfficialOptions } from "../marketplace/official.js";
import type {
  DefaultPluginsResult,
  PreparedDefault,
} from "./plugins/defaults.js";
import { dataDir } from "./paths.js";
import { type EnsureSystemOrgOutcome, SYSTEM_ORG } from "./system-org.js";

export type Say = (line: string) => void;

/** Everything phase 2 needs, gathered without a backend. */
export interface PreparedBootstrap {
  readonly defaults: readonly PreparedDefault[];
}

export interface BootstrapResult {
  readonly org: EnsureSystemOrgOutcome;
  readonly plugins: DefaultPluginsResult;
}

export interface PrepareBootstrapOptions {
  /** How the official tree is found (injectable for tests). */
  readonly official?: ResolveOfficialOptions;
}

/** Phase 1. Throws when the catalogue cannot be resolved or a default cannot be prepared. */
export async function prepareBootstrap(
  options: PrepareBootstrapOptions = {},
): Promise<PreparedBootstrap> {
  const { prepareDefaultPlugins } = await import("./plugins/defaults.js");
  return { defaults: await prepareDefaultPlugins(options.official) };
}

/**
 * Phase 2. Throws when the system org cannot be ensured; a default that
 * fails to land is reported in the result, not thrown, so the caller can
 * name each one.
 */
export async function runBootstrap(
  stigmer: Stigmer,
  prepared: PreparedBootstrap,
  say: Say,
): Promise<BootstrapResult> {
  const [{ ensureSystemOrg }, { installPreparedDefaults }] = await Promise.all(
    [import("./system-org.js"), import("./plugins/defaults.js")],
  );
  const org = await ensureSystemOrg(stigmer);
  if (org === "created") say(`Created the '${SYSTEM_ORG}' organization`);
  const plugins = await installPreparedDefaults(
    { stigmer, info: say },
    prepared.defaults,
    SYSTEM_ORG,
  );
  return { org, plugins };
}

/** Both phases, against the backend `stigmer` is bound to: what `stigmer bootstrap` runs. */
export async function bootstrapBackend(
  stigmer: Stigmer,
  say: Say,
  options: PrepareBootstrapOptions = {},
): Promise<BootstrapResult> {
  return runBootstrap(stigmer, await prepareBootstrap(options), say);
}

/** Seams of the local bootstrap, injectable for tests; the defaults are the real phases over the real local client. */
export interface BootstrapDeps {
  readonly client?: BackendClient;
  readonly say?: Say;
  readonly prepare?: () => Promise<PreparedBootstrap>;
  readonly retire?: (stigmer: Stigmer, home: string, say: Say) => Promise<void>;
  readonly run?: (
    stigmer: Stigmer,
    prepared: PreparedBootstrap,
    say: Say,
  ) => Promise<BootstrapResult>;
}

const sayToStderr: Say = (line) => {
  process.stderr.write(`${line}\n`);
};

/** What `stigmer up` does once the local server answers. Never throws past its own warnings. */
export async function bootstrapLocalBackend(
  home: string,
  deps: BootstrapDeps = {},
): Promise<void> {
  const client = deps.client ?? (await freshLocalClient());
  const say = deps.say ?? sayToStderr;

  let prepared: PreparedBootstrap;
  try {
    prepared = await (deps.prepare ?? prepareBootstrap)();
  } catch (err) {
    log.warn("bootstrap preparation failed", { error: String(err) });
    say(
      "Warning: could not prepare the default plugins, so the local backend was not bootstrapped and nothing was retired. Run 'stigmer up' again to retry.",
    );
    return;
  }

  try {
    await (deps.retire ?? retireSeedpack)(client.stigmer, home, say);
  } catch (err) {
    log.warn("seedpack retire failed", { error: String(err) });
    say(
      "Warning: failed to retire the resources an older release installed. Run 'stigmer up' again to retry.",
    );
  }

  try {
    const result = await (deps.run ?? runBootstrap)(client.stigmer, prepared, say);
    log.debug("bootstrap complete", {
      org: result.org,
      outcomes: result.plugins.outcomes,
    });
    for (const name of result.plugins.failed) {
      say(
        `Warning: failed to install default plugin '${name}'. Run 'stigmer bootstrap' to retry.`,
      );
    }
  } catch (err) {
    log.warn("bootstrap failed", { error: String(err) });
    say(
      "Warning: failed to bootstrap the local backend. Run 'stigmer bootstrap' to retry.",
    );
  }
}

// The retire step in the shape the seam expects; the module is loaded only
// inside `up`, the one place a retire may run.
async function retireSeedpack(
  stigmer: Stigmer,
  home: string,
  say: Say,
): Promise<void> {
  const { retireSeedpack: retire, renderRetireReport } = await import(
    "./seedpack-retire.js"
  );
  const result = await retire(stigmer, { markerDir: dataDir(home) });
  renderRetireReport(result, say);
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
