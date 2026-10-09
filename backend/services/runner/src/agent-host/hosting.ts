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
 * The host sees the environment the agent's tools have always seen: the
 * runner's own, after the boot capture has taken every secret of the
 * runner's out of it (`shared/runner-credential-store.ts`).
 *
 * THIS MODULE IS IMPORTED BEFORE THE HARNESSES BOOT, so its static graph
 * stays connect- and SDK-free like the table's
 * (`__tests__/harness-boot-order.test.ts` boots through it).
 */

import type { Config } from "../config.js";
import { HOSTED_HARNESSES } from "../harness-adapters.js";
import type { HarnessRow } from "../harness/registry.js";
import { AgentProxy } from "../agent-proxy/server.js";
import { createRemoteAdapter } from "./remote-adapter.js";
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
}

export async function hostHarnesses(
  rows: readonly HarnessRow[],
  config: Config,
  options: HostHarnessesOptions = {},
): Promise<HostedHarnesses> {
  const proxy = await AgentProxy.start(config);
  const supervisor = new AgentHostSupervisor({
    proxy,
    start: options.start ?? processHostStarter(() => ({ ...process.env })),
  });
  return {
    rows: rows.map((row) =>
      HOSTED_HARNESSES.has(row.harness)
        ? { harness: row.harness, adapter: createRemoteAdapter(row.harness, row.adapter, supervisor, proxy) }
        : row,
    ),
    close: () => proxy.close(),
  };
}
