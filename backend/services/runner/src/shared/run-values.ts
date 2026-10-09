/**
 * A run's values, fetched from their vaults when the turn's work starts and
 * delivered per declarer.
 *
 * The server keeps no copy of a run's values: the run records only where
 * each one lives (its source manifest), and `fetchValues` opens those
 * vaults for a runner credential bound to the live execution, as they are
 * now. The answer is grouped by who declared each value, and each group
 * reaches only its declarer:
 *
 *   - `agent`: the agent's own keys, for its shell and hooks. Never a tool's
 *     key, a login or a repository's token: the server plans none of those
 *     for the agent.
 *   - `tools`: each MCP server's keys, by server id, with the URL whose
 *     address the server checked against each login it hands over. A
 *     server is filled only from its own group, and only while it still
 *     dials that URL (shared/mcp-resolver.ts).
 *   - `repositories`: each cloned repository's token, by entry name and
 *     URL, for its git commands and write-back only
 *     (shared/workspace/git-credential.ts).
 *
 * Nothing is re-read within a turn, and nothing is cached across turns: each
 * activity fetches once, so a key rotated in its vault reaches the next turn.
 *
 * A fetch the server refuses with FAILED_PRECONDITION (an entry gone since
 * the run was planned, a vault the run may no longer use, a tool moved to
 * another address, a sign-in that cannot be renewed) is the person's to fix:
 * its message names the key, its declarer and the vault, and the turn ends
 * with it (`RunValuesRefusedError`). Any other failure is the platform's and
 * propagates as it is. There is no fallback to a read without a credential:
 * the server answers only a credential bound to the execution.
 */

import { Code, ConnectError } from "@connectrpc/connect";
import type { ExecutionValues } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";

import type { StigmerClient } from "../client/stigmer-client.js";

/** One tool's values, and the URL they may be sent to ("" for a local program). */
export interface ToolValueGroup {
  readonly url: string;
  readonly values: Readonly<Record<string, string>>;
}

/** One cloned repository's token. */
export interface RepositoryToken {
  /** The workspace entry's name, as the session carries it. */
  readonly name: string;
  readonly url: string;
  readonly token: string;
}

/** A run's values, per declarer. */
export interface RunValues {
  /** The agent's own keys: its shell and hooks. */
  readonly agent: Readonly<Record<string, string>>;
  /** Each tool's values, by MCP server id. */
  readonly tools: ReadonlyMap<string, ToolValueGroup>;
  readonly repositories: readonly RepositoryToken[];
}

/** A run with no values: nothing declared anything, or nothing was found for an optional key. */
export const NO_RUN_VALUES: RunValues = { agent: {}, tools: new Map(), repositories: [] };

/** The server refused the fetch for a reason the person fixes; `message` is the server's, naming what and where. */
export class RunValuesRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunValuesRefusedError";
  }
}

/** The fetch's answer as the runner keeps it. */
export function runValuesOf(answer: ExecutionValues): RunValues {
  const tools = new Map<string, ToolValueGroup>();
  for (const tool of answer.tools) {
    tools.set(tool.mcpServerId, { url: tool.url, values: { ...tool.values } });
  }
  return {
    agent: { ...answer.agent },
    tools,
    repositories: answer.repositories.map(({ name, url, token }) => ({ name, url, token })),
  };
}

/** The token of the repository a workspace entry clones, matched by its name and URL together. */
export function repositoryTokenFor(
  repositories: readonly RepositoryToken[],
  name: string,
  url: string,
): string | undefined {
  return repositories.find((repository) => repository.name === name && repository.url === url)?.token;
}

/**
 * Fetches an execution's values (a run's, or a connect's with the token its
 * workflow input carries). A FAILED_PRECONDITION becomes
 * {@link RunValuesRefusedError}; every other failure propagates.
 */
export async function fetchRunValues(
  client: StigmerClient,
  executionId: string,
  token?: string,
): Promise<RunValues> {
  let answer: ExecutionValues;
  try {
    answer = await client.fetchExecutionValues(executionId, token);
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
      throw new RunValuesRefusedError(err.rawMessage);
    }
    throw err;
  }
  const values = runValuesOf(answer);
  console.log(
    `Fetched values for execution ${executionId}: ` +
      `agent=[${Object.keys(values.agent).sort().join(", ")}], ` +
      `tools=${values.tools.size}, repositories=${values.repositories.length}`,
  );
  return values;
}

/**
 * Fetches a run's values for its turn: the activity's run credential, or a
 * desktop runner's exchanged token (issue #156), is the authority.
 */
export async function fetchTurnValues(
  client: StigmerClient,
  executionId: string,
): Promise<RunValues> {
  const scopedToken = await client.acquireScopedRunnerToken({ agentExecutionId: executionId });
  return fetchRunValues(client, executionId, scopedToken);
}
