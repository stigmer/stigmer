/**
 * The locked hosts of one runner: one per turn slot, each serving one turn at
 * a time, so a turn without a computer shares its process with no other
 * turn while it runs.
 *
 * Why one turn per host: the locked host is one Node process, and its heap
 * is capped at the runner's turn memory (`fence.ts`, `runner-serves.ts`). A
 * turn that grows past the cap ends the process it runs in; with one turn
 * per process that ends only itself, and only its slot restarts
 * (`supervisor.ts`). And the turns of a runner shared by many organizations
 * never hold each other's keys or credentials in one process at once: the
 * local proxy admits a host only for the turns opened in its own slot
 * (`agent-proxy/server.ts`).
 *
 * Slots: as many as the runner's turn cap (`Config.maxConcurrentActivities`,
 * `TEMPORAL_MAX_CONCURRENCY`), so on a static runner every turn finds a free
 * host at once. A turn that finds none (the manager's session workers each
 * have their own cap and share these hosts) waits for the next host released,
 * in arrival order.
 *
 * Which host: the one released last, so the hosts already started are reused
 * first and a runner that starts its hosts at their first turn starts a second
 * one only when two turns run at once.
 *
 * Each slot's supervisor keeps its own lifetime: started at boot or at its
 * first turn (`startOnFirstUse`), restarted on its own when it dies, with its
 * own token at the proxy. A fence refusal learned by any slot holds for all of
 * them (one Node cannot grow a lock), so once one slot has learned it every
 * turn reads it at once, with no other slot started to learn it again.
 */

import type { Config } from "../config.js";
import type { HarnessName } from "../harness/registry.js";
import type { AgentHostSupervisor, HostLease, TurnHosts } from "./supervisor.js";

export class LockedHostPool implements TurnHosts {
  /** The hosts no turn holds, the most recently released last. */
  private readonly idle: AgentHostSupervisor[];
  private readonly waiting: ((host: AgentHostSupervisor) => void)[] = [];

  constructor(readonly slots: readonly AgentHostSupervisor[]) {
    if (slots.length === 0) throw new Error("the locked hosts' pool needs at least one slot");
    // Slot 0 is lent first.
    this.idle = [...slots].reverse();
  }

  async boot(harness: HarnessName, config: Config): Promise<void> {
    await Promise.all(this.slots.map((slot) => slot.boot(harness, config)));
  }

  async shutdown(harness: HarnessName): Promise<void> {
    await Promise.all(this.slots.map((slot) => slot.shutdown(harness)));
  }

  async releaseSession(harness: HarnessName, sessionId: string): Promise<void> {
    await Promise.all(this.slots.map((slot) => slot.releaseSession(harness, sessionId)));
  }

  async acquire(): Promise<HostLease> {
    const refused = this.slots.find((slot) => slot.refusal !== undefined)?.refusal;
    if (refused !== undefined) throw refused;
    const host = this.idle.pop() ?? (await new Promise<AgentHostSupervisor>((resolve) => this.waiting.push(resolve)));
    let released = false;
    return {
      host,
      release: () => {
        if (released) return;
        released = true;
        const next = this.waiting.shift();
        if (next !== undefined) next(host);
        else this.idle.push(host);
      },
    };
  }
}
