/**
 * What a composition root releases when its boot fails after the agent host
 * started (`runner.ts`, `runner-manager.ts`): the harnesses, then the local
 * proxy. An embedder that catches the factory's error is otherwise left a
 * live host child, whose pipes hold its event loop open.
 *
 * No imports, on purpose: both roots import it statically, and their static
 * graphs stay what `__tests__/harness-boot-order.test.ts` pins.
 */

/** Filled by the root's body once the host is up. */
export interface HostedBoot {
  release?: () => Promise<void>;
}

/** Run `build`; when it fails, release what `boot` names (a failure there is logged) and rethrow. */
export async function releasingOnFailure<T>(build: (boot: HostedBoot) => Promise<T>): Promise<T> {
  const boot: HostedBoot = {};
  try {
    return await build(boot);
  } catch (err) {
    try {
      await boot.release?.();
    } catch (releaseErr) {
      console.warn(`[agent-host] releasing the agent host after a failed boot failed: ${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`);
    }
    throw err;
  }
}
