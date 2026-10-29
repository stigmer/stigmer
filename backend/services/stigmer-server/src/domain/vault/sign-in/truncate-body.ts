/**
 * Bounded HTTP-body snippets for error messages and rejection records,
 * shared by the DCR, preflight, and token modules.
 */

/** A 256-character cap; the error copy that embeds it is pinned. */
export function truncateBody(body: string): string {
  const MAX = 256;
  return body.length <= MAX ? body : `${body.slice(0, MAX)}...`;
}
