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
import { createRemoteAdapter } from "./remote-adapter.js";
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
}

export async function hostHarnesses(
  rows: readonly HarnessRow[],
  config: Config,
  options: HostHarnessesOptions = {},
): Promise<HostedHarnesses> {
  const proxy = await AgentProxy.start(config);
  const trust = writeTrustedCertificates(proxy.cursorCertificate, process.env.NODE_EXTRA_CA_CERTS);
  const supervisor = new AgentHostSupervisor({
    proxy,
    start: options.start ?? processHostStarter(() => ({ ...agentHostEnvironment(), NODE_EXTRA_CA_CERTS: trust.file })),
  });
  return {
    rows: rows.map((row) =>
      HOSTED_HARNESSES.has(row.harness)
        ? { harness: row.harness, adapter: createRemoteAdapter(row.harness, row.adapter, supervisor, proxy) }
        : row,
    ),
    warmCursorSdk: () =>
      supervisor.warmCursorSdk().catch((err: unknown) => ({ warmed: false, durationMs: 0, error: err instanceof Error ? err.message : String(err) })),
    close: async () => {
      await proxy.close();
      trust.remove();
    },
  };
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
