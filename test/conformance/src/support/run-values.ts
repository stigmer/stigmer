// Reading where a run's values live and what the runner receives.
// Domain: conformance support for the execution suites.
//
// A run records where each value it uses lives on its status, as its source
// manifest (RunStatus.credentials.sources: key, declarer, origin, vault id,
// entry; never a value), and a runner bound to the run fetches the values
// from those vaults when the work starts (VaultValueController.fetchValues).
// The suites read the manifest as any viewer of the run can, and fetch as a
// runner would, with the run's own credential from the platform exchange.
import type { Run, RunValueSource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunValueDeclarerKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { ExecutionValues } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import type { ConformanceClients } from "../harness/clients";

export { RunValueDeclarerKind };
export { RunValueOrigin } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

/** The run's source manifest, as stored. */
export async function runSourcesOf(clients: ConformanceClients, runId: string): Promise<RunValueSource[]> {
  const run: Run = await clients.agentExecutionQuery.get({ value: runId });
  return run.status?.credentials?.sources ?? [];
}

/** The manifest entries for `key`, optionally of one declarer kind. */
export function sourcesFor(
  sources: readonly RunValueSource[],
  key: string,
  kind?: RunValueDeclarerKind,
): RunValueSource[] {
  return sources.filter((source) => source.key === key && (kind === undefined || source.declarer?.kind === kind));
}

/** The one agent-declared entry for `key`, or undefined. */
export function agentSourceOf(sources: readonly RunValueSource[], key: string): RunValueSource | undefined {
  const found = sourcesFor(sources, key, RunValueDeclarerKind.AGENT);
  if (found.length > 1) {
    throw new Error(`the manifest names ${key} for the agent ${found.length} times`);
  }
  return found[0];
}

/** The run's own credential, minted through the platform exchange by `by`. */
export async function runCredentialOf(by: ConformanceClients, runId: string): Promise<string> {
  const minted = await by.platformQuery.getRunnerScopedToken({ scope: { case: "runId", value: runId } });
  if (minted.runnerScopedToken === "") {
    throw new Error(`the exchange minted no credential for run ${runId}`);
  }
  return minted.runnerScopedToken;
}

/** The run's values, fetched as a runner presenting `runner`'s credential would. */
export function fetchRunValues(runner: ConformanceClients, runId: string): Promise<ExecutionValues> {
  return runner.vaultValue.fetchValues({ executionId: runId });
}
