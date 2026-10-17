/**
 * The MCP servers an evaluated agent version brings itself: the ones it
 * writes, and the ones each subagent it lists writes, at the version the
 * agent pinned. A try runs the agent's subagents too, under the try's own
 * tool lists, so an eval names and turns off every one of them, as it does
 * the plugins' servers no mock answers: no eval reaches a real system the
 * eval did not ask for.
 *
 * A subagent whose pinned version is gone contributes nothing here: the
 * try's own run is refused naming it when it is planned
 * (domain/run/run-subagents.ts), so an eval never runs one.
 *
 * Proven by __tests__/written-servers.test.ts.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";

import type { Store } from "../../store/interface.js";
import { runSubagents } from "../run/run-subagents.js";
import type { RunSubagent } from "../run/run-subagents.js";

/** The names of the servers `spec` and its subagents write, each once, in the agent's order. */
export async function writtenServerNames(store: Store, spec: AgentSpec | undefined, org: string): Promise<string[]> {
  let subagents: RunSubagent[] = [];
  try {
    subagents = await runSubagents(store, spec, org);
  } catch (error) {
    if (!(error instanceof ConnectError && error.code === Code.FailedPrecondition)) throw error;
  }
  const names = [...(spec?.mcpServers ?? []), ...subagents.flatMap((subagent) => subagent.spec.mcpServers)].map(
    (server) => server.name,
  );
  return [...new Set(names)];
}
