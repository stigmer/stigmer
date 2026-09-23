// What makes a backend ready for the CLI: the organization it falls back to
// on a local or selfhost backend (DEFAULT_LOCAL_ORG, `stigmer`) exists.
// Nothing is installed into it: a session with no agent runs the built-in
// assistant, so a fresh install needs no default content. `stigmer up` runs
// this against the local server it just started; `stigmer bootstrap` runs it
// against whatever backend the CLI is pointed at, a raw self-hosted server.
// One definition, so a laptop, a container and a raw server cannot drift in
// what "ready" means.
//
// "Ensure" is find-then-create with the race closed by the server: two
// launchers racing the same check see one `already-exists`, and that IS the
// desired end state, so it is reported as `present`, never rethrown. Any
// other refusal propagates with the server's sentence; the caller decides
// how loud to be.
//
// The create carries no label. Writing a label in the reserved `stigmer.ai/`
// namespace needs a platform permission that a self-hosted server with
// authentication on grants to nobody, and nothing reads one on an
// organization (stigmer/stigmer#1192). Organizations created by older CLIs
// keep the `stigmer.ai/system` label they were given; it is inert.
//
// Inside `up` the bootstrap is best-effort with one warning naming the
// retry, because the stack is already serving and a failure here must never
// tear it down. Both `up` shapes (detached and foreground) call the same
// function, and both target the local server `up` just started, never the
// active backend context: a CLI pointed at a remote backend still gets its
// local stack bootstrapped and never creates an organization elsewhere. The
// client is pinned to a fresh local config (localhost:SERVER_PORT) with no
// auth, the trusted-local identity.

import { ManagementMode } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/enum_pb";
import { type Stigmer, StigmerError } from "@stigmer/sdk";
import type { BackendClient } from "../client/index.js";
import { DEFAULT_LOCAL_ORG } from "../config/resolve.js";
import { log } from "../logger.js";

export type Say = (line: string) => void;

export type BootstrapOutcome = "present" | "created";

/**
 * Make sure the organization the CLI falls back to exists on the backend
 * `stigmer` is bound to: what `stigmer bootstrap` runs. Idempotent; a lost
 * create race counts as `present`.
 */
export async function bootstrapBackend(stigmer: Stigmer): Promise<BootstrapOutcome> {
  const mine = await stigmer.organization.findMyOrganizations();
  if (mine.entries.some((org) => org.metadata?.slug === DEFAULT_LOCAL_ORG)) {
    return "present";
  }
  try {
    // Organizations are self-owning: the org field is the slug itself, the
    // shape the console's create form and the e2e harness both use.
    await stigmer.organization.create({
      name: "Stigmer",
      slug: DEFAULT_LOCAL_ORG,
      org: DEFAULT_LOCAL_ORG,
      description: "The organization the Stigmer CLI uses when none is named",
      managementMode: ManagementMode.self_managed,
    });
    return "created";
  } catch (error) {
    if (error instanceof StigmerError && error.code === "already-exists") {
      return "present";
    }
    throw error;
  }
}

/** Seams of the local bootstrap, injectable for tests; the defaults are the real act over the real local client. */
export interface BootstrapDeps {
  readonly client?: BackendClient;
  readonly say?: Say;
  readonly bootstrap?: (stigmer: Stigmer) => Promise<BootstrapOutcome>;
}

const sayToStderr: Say = (line) => {
  process.stderr.write(`${line}\n`);
};

/** What `stigmer up` does once the local server answers. Never throws past its own warning. */
export async function bootstrapLocalBackend(deps: BootstrapDeps = {}): Promise<void> {
  const client = deps.client ?? (await freshLocalClient());
  const say = deps.say ?? sayToStderr;

  let outcome: BootstrapOutcome;
  try {
    outcome = await (deps.bootstrap ?? bootstrapBackend)(client.stigmer);
  } catch (err) {
    log.warn("bootstrap failed", { error: String(err) });
    say("Warning: failed to bootstrap the local backend. Run 'stigmer up' again to retry.");
    return;
  }
  log.debug("bootstrap complete", { org: outcome });
  if (outcome === "created") say(`Created the '${DEFAULT_LOCAL_ORG}' organization`);
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
