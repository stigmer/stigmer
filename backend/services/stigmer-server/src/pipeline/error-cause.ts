/**
 * The server-side reader of an error's cause chain (stigmer/stigmer#1383).
 *
 * internalError (errors.ts) keeps the real failure on ConnectError.cause
 * and puts only authored copy on the wire (#478). The pipeline executor's
 * "pipeline step failed" line and the logging interceptor's tiered line
 * log the thrown error's message, which for an internalError IS that copy,
 * so without this module the operator reads "failed to load plugin" where
 * the fault was "database is locked". Both sites spread `causeFields` into
 * their fields, and write `causeStack` on a debug line of its own.
 *
 * Trade-offs:
 *   - The whole chain, bounded. Causes nest: a step's `{ cause }` wrapper
 *     (a schema step's rewrite, a driver's own refusal) is
 *     wrapped once more by the executor's internalError, so the first
 *     cause alone would often print a wrapper's copy instead of the
 *     driver's error. MAX_CAUSE_LINKS bounds the walk, and a repeated
 *     object stops it.
 *   - Any Error's ES2022 `cause` is followed, not only ConnectError's: the
 *     raw step errors and the `{ cause }` wrappers are plain Errors.
 *   - Name, string code and message only. The logger serializes fields
 *     with JSON.stringify (boot/logger.ts), and the cloud edition exports
 *     them to its collector as they are, so this renderer is where
 *     redaction happens: a `pg` DatabaseError keeps row values in
 *     `detail` and the statement in `query`, and neither is read here.
 *     `code` is read only when it is a string (a `pg` SQLSTATE, a Node
 *     `ECONNREFUSED`); ConnectError's numeric code is already in its
 *     message's prefix.
 *   - An AggregateError's own message is empty when Node reports a refused
 *     connection on every address it tried; the reason is only in
 *     `errors`, so up to MAX_AGGREGATE_ERRORS of their messages follow it.
 *   - One string, `cause`, beside the string `error` field: operators grep
 *     the line and the collector indexes strings.
 *   - The stack goes to debug alone, from the deepest Error link: that is
 *     the driver's or the code's own throw, while the wrappers' stacks
 *     point at catch sites the line already names by step or procedure.
 */
import type { LogFields } from "../boot/logger.js";

/** Deep enough for a driver error under two wrappers and the executor's. */
export const MAX_CAUSE_LINKS = 5;

/** A refused dual-stack connection lists two; more is a long tail. */
export const MAX_AGGREGATE_ERRORS = 3;

/**
 * The `cause` field for a failure's log line: the chain under `error`,
 * nearest first, joined by " <- ". Empty when there is no cause.
 */
export function causeFields(error: unknown): LogFields {
  const { links, truncated } = causeChain(error);
  if (links.length === 0) {
    return {};
  }
  const rendered = links.map(renderLink);
  if (truncated) {
    rendered.push("…");
  }
  return { cause: rendered.join(" <- ") };
}

/** The stack of the deepest Error under `error`, for a debug line. */
export function causeStack(error: unknown): string | undefined {
  const { links } = causeChain(error);
  for (const link of [...links].reverse()) {
    if (link instanceof Error && typeof link.stack === "string") {
      return link.stack;
    }
  }
  return undefined;
}

function causeChain(error: unknown): { links: unknown[]; truncated: boolean } {
  const links: unknown[] = [];
  const seen = new Set<unknown>([error]);
  let next = nextCause(error);
  while (next !== undefined && !seen.has(next)) {
    if (links.length === MAX_CAUSE_LINKS) {
      return { links, truncated: true };
    }
    links.push(next);
    seen.add(next);
    next = nextCause(next);
  }
  return { links, truncated: false };
}

function nextCause(link: unknown): unknown {
  return link instanceof Error ? link.cause : undefined;
}

function renderLink(link: unknown): string {
  if (!(link instanceof Error)) {
    return safeString(link);
  }
  const code = (link as { code?: unknown }).code;
  const head = typeof code === "string" ? `${link.name}[${code}]` : link.name;
  const parts = link.message === "" ? [] : [link.message];
  if (link instanceof AggregateError && Array.isArray(link.errors)) {
    const errors: unknown[] = link.errors;
    parts.push(
      ...errors
        .slice(0, MAX_AGGREGATE_ERRORS)
        .map((inner) =>
          inner instanceof Error ? inner.message : safeString(inner),
        ),
    );
    if (errors.length > MAX_AGGREGATE_ERRORS) {
      parts.push(`+${errors.length - MAX_AGGREGATE_ERRORS} more`);
    }
  }
  return parts.length === 0 ? head : `${head}: ${parts.join("; ")}`;
}

/** A log line must never throw from inside the catch that writes it. */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unrenderable cause]";
  }
}
