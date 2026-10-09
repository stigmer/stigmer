/**
 * The value-entry shape the console's credential forms collect: one
 * variable's value, whether it is secret, and what it is for. Owned here
 * rather than borrowed from the client SDK because it is a form shape, not a
 * wire shape: whatever a form collects is saved as a vault secret or a
 * session's own secret, both of which carry the value alone.
 */

/** One value a credential form collected for a declared variable. */
export interface EnvVarInput {
  /** The value as entered. */
  readonly value: string;
  /** Whether the declaration marks it secret (masked in the form). */
  readonly isSecret: boolean;
  /** What the variable is for, when the declaration says. */
  readonly description?: string;
}

/** The values of collected entries, keyed by variable name, as a vault or a session stores them. */
export function valuesOf(
  env: Readonly<Record<string, EnvVarInput>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([, v]) => v.value !== "")
      .map(([key, v]) => [key, v.value]),
  );
}
