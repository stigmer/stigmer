/**
 * The composition roots' one call into the agent host: start the local
 * proxy, set up the supervisor, and hand back the harness table with every
 * hosted harness's adapter replaced by its remote stand-in
 * (`remote-adapter.ts`). The roots then boot, bind, release and shut down
 * the returned rows exactly as they did the table itself; the registry
 * (`harness/registry.ts`) cannot tell the difference, by design.
 *
 * Which harnesses are hosted is `harness-adapters.ts`'s to say
 * (`HOSTED_HARNESSES`). The host runs in every shape the runner runs in, as
 * the runner's own user until a separating shape starts it as another one,
 * so the engines run in one kind of process everywhere and the one path is
 * the one every test sees.
 *
 * The host sees the environment the agent's tools have always seen
 * (`environment.ts`). When the sandbox has an Environment with packages, the folders they
 * install into come first on the host's PATH (`environment/install.ts`),
 * and the install starts here, once the agent's home is handed over,
 * beside the worker: each turn awaits it (`harness/run-turn.ts`).
 *
 * THIS MODULE IS IMPORTED BEFORE THE HARNESSES BOOT, so its static graph
 * stays SDK-free like the table's
 * (`__tests__/harness-boot-order.test.ts` boots through it).
 */

import { homedir } from "node:os";

import type { Config } from "../config.js";
import { HOSTED_HARNESSES } from "../harness-adapters.js";
import type { HarnessRow } from "../harness/registry.js";
import { AgentProxy } from "../agent-proxy/server.js";
import { agentHostEnvironment, withEnvironmentPath } from "./environment.js";
import { startEnvironmentInstall } from "../environment/install.js";
import { sandboxEnvironmentFrom } from "../environment/spec.js";
import { installAgentFs, refusingAgentFs } from "../shared/agent-fs.js";
import { handOverToAgent, type HandoverIo } from "../shared/agent-handover.js";
import { agentIdentity, prepareAgentSeparation, type AgentIdentity } from "../shared/agent-identity.js";
import { createRemoteAdapter } from "./remote-adapter.js";
import { remoteAgentFs } from "./remote-fs.js";
import { AgentHostSupervisor, processHostStarter, type HostStarter } from "./supervisor.js";

/** The table the root runs, and what to release once its harnesses have shut down. */
export interface HostedHarnesses {
  readonly rows: readonly HarnessRow[];
  /** Close the local proxy; after `shutdownHarnesses`, which stops the host. */
  close(): Promise<void>;
}

export interface HostHarnessesOptions {
  /** How the host is started; the tests serve one in-process. Defaults to a child process. */
  readonly start?: HostStarter;
  /** Who the host runs as; defaults to this process's facts (`shared/agent-identity.ts`). */
  readonly identity?: AgentIdentity | null;
  /** How a separating runner that cannot drop to the agent leaves; defaults to `process.exit`. */
  readonly exit?: (code: number) => void;
  /** The separation's preparation; the tests stand one in. */
  readonly prepareSeparation?: (identity: AgentIdentity) => string | null;
}

/** The exit code of a runner that cannot start its host as the agent: a configuration error, as `layer/start.sh` refuses one. */
export const SEPARATION_REFUSED_EXIT = 78;

export async function hostHarnesses(
  rows: readonly HarnessRow[],
  config: Config,
  options: HostHarnessesOptions = {},
): Promise<HostedHarnesses> {
  const identity = options.identity === undefined ? agentIdentity() : options.identity;
  if (identity !== null) {
    // A container runner never runs the agent's side as root: one that
    // cannot drop to the agent user stops here, before any harness boots.
    const refusal = (options.prepareSeparation ?? ((who: AgentIdentity) => prepareAgentSeparation(who) ?? handOver(who, config.workspaceRootDir)))(identity);
    if (refusal !== null) {
      console.error(`[agent-host] ${refusal}`);
      (options.exit ?? process.exit)(SEPARATION_REFUSED_EXIT);
      throw new Error(refusal);
    }
  }
  const environment = sandboxEnvironmentFrom();
  startEnvironmentInstall(environment);
  const proxy = await AgentProxy.start(config);
  const supervisor = new AgentHostSupervisor({
    proxy,
    start:
      options.start ??
      processHostStarter(() => withEnvironmentPath(agentHostEnvironment(), environment, identity)),
  });
  // From here on, the runtime's operations on the agent's paths are the host's.
  const restoreFs = installAgentFs(
    remoteAgentFs({
      fs: async (request) => (await supervisor.connection()).call("fs", request),
      exec: async (request) => (await supervisor.connection()).call("exec", request),
    }),
  );
  return {
    rows: rows.map((row) =>
      HOSTED_HARNESSES.has(row.harness)
        ? { harness: row.harness, adapter: createRemoteAdapter(row.harness, row.adapter, supervisor, proxy) }
        : row,
    ),
    close: async () => {
      restoreFs();
      // A separating runner never performs them itself: after the host, they fail.
      if (identity !== null) installAgentFs(refusingAgentFs("the agent host has closed; the runner performs no operation on the agent's paths itself"));
      await proxy.close();
    },
  };
}

/**
 * Hand the agent its files on a separating runner's first boot
 * (`shared/agent-handover.ts`), and its workspace root on every boot;
 * `null` when done, else the line the runner refuses to start with.
 */
export function handOver(
  identity: AgentIdentity,
  workspaceRoot: string,
  runnerHome: string = process.env.HOME || homedir(),
  io?: HandoverIo,
): string | null {
  try {
    const result = handOverToAgent(identity, { runnerHome, workspaceRoot }, io);
    if (result.firstTime) console.log(`[agent-host] handed the agent's files to ${identity.name}${result.moved.length > 0 ? ` (moved ${result.moved.join(", ")})` : ""}`);
    return null;
  } catch (err) {
    return `the runner cannot hand the agent user its files: ${err instanceof Error ? err.message : String(err)}`;
  }
}
