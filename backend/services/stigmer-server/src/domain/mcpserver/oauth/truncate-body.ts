/**
 * Bounded HTTP-body snippets for error messages and rejection records —
 * ports pkg/domain/mcpserver/oauth/dcr.go's package-level truncateBody,
 * shared by the DCR, preflight, and token modules exactly as in Go.
 */

/** Go truncateBody's 256-byte cap, verbatim. */
export function truncateBody(body: string): string {
  const MAX = 256;
  return body.length <= MAX ? body : `${body.slice(0, MAX)}...`;
}
