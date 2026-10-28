/**
 * An error's cause chain: the one walk over it, and the one way it is
 * printed in a log line.
 *
 * The walk follows the standard `cause` property, outermost first, each
 * error once, so a cycle ends it. The model-error classifiers read its links
 * by meaning (`model-error.ts`, `model-retry.ts`); a failed turn's log line
 * prints them (`harness/run-turn.ts`).
 *
 * The printed form is one line: each link as `Name[ code]: message` (no
 * colon when the message is empty, as Node leaves an `AggregateError`'s), joined
 * by ` <- `, outermost first. An `AggregateError`'s `errors` follow its link
 * in brackets, one level each, since that is where Node's fetch puts a
 * connect that failed on every address. A link whose name and message repeat
 * the link above it is dropped: LangChain wraps a failure once per
 * middleware, copying the message each time, and those copies say nothing.
 * A cause that is not an `Error` ends the line as its string. The whole line
 * is capped at {@link MAX_CAUSE_CHAIN_CHARS}: a chain can be as long as the
 * middleware stack, and one log line must not carry a flood.
 */

import { headCutIndex } from "./text-cut.js";

/** The longest printed chain; the cut keeps the start, where the outermost links are. */
export const MAX_CAUSE_CHAIN_CHARS = 4096;

const LINK_SEPARATOR = " <- ";
const ELISION = " …[cut]";

/** The error and its causes, outermost first, each once. */
export function causeChainOf(err: unknown): Error[] {
  const links: Error[] = [];
  for (let current: unknown = err; current instanceof Error && !links.includes(current); current = current.cause) {
    links.push(current);
  }
  return links;
}

/** An error's own string `code` (an errno such as `ECONNRESET`, or undici's `UND_ERR_*`); a numeric one is not a name. */
export function errorCodeOf(err: Error): string | undefined {
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code : undefined;
}

function describeLink(err: Error): string {
  const code = errorCodeOf(err);
  const head = `${err.name}${code !== undefined ? ` ${code}` : ""}`;
  return err.message === "" ? head : `${head}: ${err.message}`;
}

function describeAggregated(err: Error): string {
  if (!(err instanceof AggregateError) || !Array.isArray(err.errors) || err.errors.length === 0) return "";
  const members = err.errors.map((member: unknown) => (member instanceof Error ? describeLink(member) : String(member)));
  return ` [${members.join("; ")}]`;
}

/**
 * The error and its causes on one line, outermost first: `Name[ code]: message`
 * per link, joined by ` <- `, capped at {@link MAX_CAUSE_CHAIN_CHARS}.
 */
export function describeCauseChain(err: unknown): string {
  const links = causeChainOf(err);
  if (links.length === 0) return String(err);

  const parts: string[] = [];
  let above: Error | undefined;
  for (const link of links) {
    const aggregated = describeAggregated(link);
    const repeats = above !== undefined && link.name === above.name && link.message === above.message;
    if (!repeats || aggregated !== "") parts.push(describeLink(link) + aggregated);
    above = link;
  }
  const endCause = links[links.length - 1]?.cause;
  if (endCause !== undefined && endCause !== null && !(endCause instanceof Error)) parts.push(String(endCause));

  const line = parts.join(LINK_SEPARATOR);
  if (line.length <= MAX_CAUSE_CHAIN_CHARS) return line;
  return line.slice(0, headCutIndex(line, MAX_CAUSE_CHAIN_CHARS - ELISION.length)) + ELISION;
}
