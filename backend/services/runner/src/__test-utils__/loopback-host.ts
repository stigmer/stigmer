/**
 * A harness row run the way production runs it — the remote adapter in
 * front, the real adapter in an agent host behind the pipe — with the host
 * served in the test's own process over a loopback channel
 * (`agent-host/channel.ts` `loopbackChannels`).
 *
 * Why in-process: every message still crosses as the pipe's JSON, through
 * the real codec, on a later tick, so the serialization, the status split
 * and the asynchrony are all the production path's; and the adapter's
 * vendor double (`vi.mock` of the model client) still reaches it, because
 * the host's modules are the test's modules. What only a real process can
 * show — the fd-3 pipe, the spawn, a host killed mid-turn — the spawned
 * host's own tests show (`agent-host/__tests__/`).
 *
 * The local proxy is a stand-in that admits every turn: the hermetic
 * drivers stub the network the proxy would forward to, and the proxy's own
 * rules have their own tests (`agent-proxy/__tests__/`). The in-process
 * host installs no process-wide routes (`agent-host/host.ts`), so the
 * test's registry stub and model double are not rerouted.
 */

import { loopbackChannels } from "../agent-host/channel.js";
import { serveAgentHost } from "../agent-host/host.js";
import { createRemoteAdapter, type LiveTurnRegistry } from "../agent-host/remote-adapter.js";
import { AgentHostSupervisor, type AgentProxyGate } from "../agent-host/supervisor.js";
import type { HarnessRow } from "../harness/registry.js";

/** The stand-in proxy's address; nothing dials it in a hermetic run. */
const LOOPBACK_PROXY_ENDPOINT = "http://127.0.0.1:9";

/** `row`, hosted: its adapter replaced by a remote adapter over an in-process host serving the real one. */
export function loopbackHostedRow(row: HarnessRow): HarnessRow {
  const proxy: AgentProxyGate & LiveTurnRegistry = {
    endpoint: LOOPBACK_PROXY_ENDPOINT,
    authorizeHost: () => {},
    openTurn: () => () => {},
  };
  const supervisor = new AgentHostSupervisor({
    proxy,
    start: () => {
      const [runnerEnd, hostEnd] = loopbackChannels();
      serveAgentHost(hostEnd, [row]);
      return { channel: runnerEnd, kill: () => hostEnd.close() };
    },
  });
  return { harness: row.harness, adapter: createRemoteAdapter(row.harness, row.adapter, supervisor, proxy) };
}
