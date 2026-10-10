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
 * (`environment.ts`), plus one setting: `NODE_EXTRA_CA_CERTS` names a file
 * holding the Cursor lane's certificate (`agent-proxy/cursor-lane.ts`), and
 * the operator's own extra certificates when they named some, so the host's
 * Cursor SDK trusts the lane on loopback and everything it trusted before.
 * Once configured, the host also sets `CURSOR_BACKEND_URL` to the lane for
 * its Cursor SDK (`entry.ts`); the agent's shells and hooks leave it out.
 *
 * THIS MODULE IS IMPORTED BEFORE THE HARNESSES BOOT, so its static graph
 * stays connect- and SDK-free like the table's
 * (`__tests__/harness-boot-order.test.ts` boots through it).
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../config.js";
import { HOSTED_HARNESSES } from "../harness-adapters.js";
import type { HarnessRow } from "../harness/registry.js";
import { AgentProxy } from "../agent-proxy/server.js";
import { agentHostEnvironment } from "./environment.js";
import { installAgentFs } from "../shared/agent-fs.js";
import { agentIdentity, prepareAgentSeparation, type AgentIdentity } from "../shared/agent-identity.js";
import { createRemoteAdapter } from "./remote-adapter.js";
import { remoteAgentFs } from "./remote-fs.js";
import { AgentHostSupervisor, processHostStarter, type HostStarter } from "./supervisor.js";

/** The table the root runs, and what to release once its harnesses have shut down. */
export interface HostedHarnesses {
  readonly rows: readonly HarnessRow[];
  /** Close the local proxy; after `shutdownHarnesses`, which stops the host. */
  close(): Promise<void>;
  /** Warm the Cursor SDK in the host, for an idle pool member; never throws. */
  warmCursorSdk(): Promise<{ readonly warmed: boolean; readonly durationMs: number; readonly error: string | null }>;
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
    const refusal = (options.prepareSeparation ?? prepareAgentSeparation)(identity);
    if (refusal !== null) {
      console.error(`[agent-host] ${refusal}`);
      (options.exit ?? process.exit)(SEPARATION_REFUSED_EXIT);
      throw new Error(refusal);
    }
  }
  const proxy = await AgentProxy.start(config);
  const trust = writeTrustedCertificates(proxy.cursorCertificate, process.env.NODE_EXTRA_CA_CERTS);
  const supervisor = new AgentHostSupervisor({
    proxy,
    start: options.start ?? processHostStarter(() => ({ ...agentHostEnvironment(), NODE_EXTRA_CA_CERTS: trust.file })),
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
    warmCursorSdk: () =>
      supervisor.warmCursorSdk().catch((err: unknown) => ({ warmed: false, durationMs: 0, error: err instanceof Error ? err.message : String(err) })),
    close: async () => {
      restoreFs();
      await proxy.close();
      trust.remove();
    },
  };
}

/** The pool member's log line for a warm-up's result. */
export function logCursorWarmup(result: { readonly warmed: boolean; readonly durationMs: number; readonly error: string | null }): void {
  if (result.warmed) console.log(`[pool-member] Cursor SDK state stores warmed in ${result.durationMs}ms`);
  else console.warn(`[pool-member] Cursor SDK warm-up skipped (non-fatal): ${result.error} (${result.durationMs}ms)`);
}

/**
 * The file the host's `NODE_EXTRA_CA_CERTS` names: the lane's certificate,
 * after the operator's extra certificates when `operatorFile` names a
 * readable file (Node reads one such file, so both go in it). The folder
 * and the file are readable by any user, so a host started as another user
 * reads them too; the certificate is public, its key never leaves the
 * runner's memory.
 */
export function writeTrustedCertificates(certPem: string, operatorFile: string | undefined): { readonly file: string; remove(): void } {
  let operator = "";
  if (operatorFile) {
    try {
      operator = readFileSync(operatorFile, "utf8");
    } catch (err) {
      console.warn(`[agent-host] NODE_EXTRA_CA_CERTS=${operatorFile} could not be read, so the agent host trusts only the Cursor lane's certificate besides the defaults: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "stigmer-agent-proxy-"));
  chmodSync(dir, 0o755);
  const file = join(dir, "trusted.pem");
  writeFileSync(file, `${operator}${operator && !operator.endsWith("\n") ? "\n" : ""}${certPem}`, { mode: 0o644 });
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
