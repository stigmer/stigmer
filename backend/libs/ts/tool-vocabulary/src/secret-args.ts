// The tool-argument names whose values are secrets (stigmer#1119): the runner
// replaces a top-level argument under one of these names with a marker on
// every tool row's `args`, in its `args_preview` and in an approval message,
// so no reader of a conversation ever sees the value. Matched
// case-insensitively against the top-level key; a nested key, or a name that
// only contains one of these words (`auth_method`, `token_count`), is kept.
//
// One table for both sides that act on it: the runner redacts with it
// (`shared/args-preview.ts` in the runner), and the custom-tool check
// (custom-tools.ts) refuses a host tool whose input declares one of these
// names, since its host would read the marker where the agent wrote a value.
// `@stigmer/client` keeps its own copy for rows stored before the runner
// redacted (`isSecretArgKey`), because a client never depends on this
// package; the cross-language contract all three are held to is
// `test/fixtures/tool-view/secret-args.json`.
//
// Proven by __tests__/secret-args.test.ts.

/** Argument names whose top-level values are never shown to any reader (the header). */
export const SECRET_ARG_KEYS: ReadonlySet<string> = new Set([
  "password",
  "token",
  "secret",
  "api_key",
  "apikey",
  "credentials",
  "auth",
  "authorization",
]);

/** Whether a top-level argument name is one whose value is redacted, whatever its case. */
export function isSecretArgKey(key: string): boolean {
  return SECRET_ARG_KEYS.has(key.toLowerCase());
}
