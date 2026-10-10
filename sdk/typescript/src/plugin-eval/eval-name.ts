// The name a client gives a new plugin eval: the plugin's name and the
// moment it started, as in "thermos evals 2026-10-10 05:40:12 UTC".
//
// An eval is one suite run and is read from its plugin's page, never
// addressed by name, but its slug (derived from the name) must be unique in
// the organization, so a second eval of the same plugin needs a name of its
// own. The time to the second gives one; the CLI and the console use this
// one rule so their evals read alike in a list. Pure; pinned by
// `__tests__/eval-name.test.ts`.

/** The name for an eval of `pluginName` started at `at`. */
export function pluginEvalName(pluginName: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 19).replace("T", " ");
  return `${pluginName.trim() || "plugin"} evals ${stamp} UTC`;
}
