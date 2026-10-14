/**
 * How a run says the platform stopped it for one of an eval run try's own
 * reasons, in words a person reads on the run and the eval run parses back.
 *
 * A run's status names no termination reason: a stopped run carries one
 * error sentence. The runner writes these sentences with
 * {@link formatTryStop} and the eval's case workflow reads them with
 * {@link parseTryStop}, so the wording lives once, here, rather than as a
 * literal each side copies. A typed reason belongs to the run's event log
 * when it carries one; until then this pair is the contract.
 *
 * The stops:
 *  - `cost-limit`: the run's cost cap. Not an eval stop alone (any run has
 *    a cap), but the eval tells a try stopped at its own share by it.
 *  - `scaffold-failed`: the case's scaffold script exited non-zero or ran
 *    past its limit, before the agent started. The try scores 0 with the
 *    error "scaffold failed: <detail>", as the format scores it.
 *  - `mock-aborted`: a mock stopped the run: its input guard was violated,
 *    its agent ended the run, or the agent mocks' call budget ran out. The
 *    try scores 0 with no error, reported as aborted.
 */

/** A try's own stop, as both sides read it. */
export type TryStop =
  | { readonly kind: "cost-limit"; readonly estimatedCostUsd: number; readonly maxCostUsd: number }
  | { readonly kind: "scaffold-failed"; readonly detail: string }
  | { readonly kind: "mock-aborted"; readonly server: string; readonly tool: string; readonly reason: string };

/**
 * The leading words of a cost-cap stop. Kept stable: a client may tell
 * this stop from the others by them.
 */
export const COST_LIMIT_ERROR_PREFIX = "Agent reached the cost limit";

const SCAFFOLD_PREFIX = "The eval case's scaffold failed: ";
const MOCK_PREFIX = "A mock stopped the run: ";

/** The run error for a try's stop. */
export function formatTryStop(stop: TryStop): string {
  switch (stop.kind) {
    case "cost-limit":
      return (
        `${COST_LIMIT_ERROR_PREFIX} for this message ` +
        `(~$${stop.estimatedCostUsd.toFixed(4)} of the $${stop.maxCostUsd.toFixed(2)} budget). ` +
        `Send another message to continue.`
      );
    case "scaffold-failed":
      return `${SCAFFOLD_PREFIX}${oneLine(stop.detail)}`;
    case "mock-aborted":
      return `${MOCK_PREFIX}server ${JSON.stringify(stop.server)}, tool ${JSON.stringify(stop.tool)}: ${oneLine(stop.reason)}`;
  }
}

/**
 * The try stop a run error names, or `undefined` for any other error. A
 * cost-limit stop's amounts are read when present and 0 otherwise; the
 * eval compares the run's own estimate, not these.
 */
export function parseTryStop(error: string): TryStop | undefined {
  if (error.startsWith(COST_LIMIT_ERROR_PREFIX)) {
    const amounts = /\(~\$([0-9.]+) of the \$([0-9.]+) budget\)/.exec(error);
    return {
      kind: "cost-limit",
      estimatedCostUsd: Number(amounts?.[1] ?? 0),
      maxCostUsd: Number(amounts?.[2] ?? 0),
    };
  }
  if (error.startsWith(SCAFFOLD_PREFIX)) {
    return { kind: "scaffold-failed", detail: error.slice(SCAFFOLD_PREFIX.length) };
  }
  if (error.startsWith(MOCK_PREFIX)) {
    const parts = /^server ("(?:[^"\\]|\\.)*"), tool ("(?:[^"\\]|\\.)*"): ([\s\S]*)$/.exec(error.slice(MOCK_PREFIX.length));
    if (parts === null) return undefined;
    const server = unquoted(parts[1] ?? '""');
    const tool = unquoted(parts[2] ?? '""');
    if (server === undefined || tool === undefined) return undefined;
    return { kind: "mock-aborted", server, tool, reason: parts[3] ?? "" };
  }
  return undefined;
}

/** A JSON string literal's value, or `undefined` for an escape JSON refuses. */
function unquoted(literal: string): string | undefined {
  try {
    return JSON.parse(literal) as string;
  } catch {
    return undefined;
  }
}

/** A detail on one line, so the sentence stays one. */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}
