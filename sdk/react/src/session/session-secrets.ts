/**
 * A host app's per-turn values for a conversation: credentials that belong
 * to the conversation (a project-scoped API key, say) and that its runs
 * should use. They are written as the conversation's own secrets
 * (`SessionSpec.secrets`): sealed for the conversation's life, never
 * returned by a read, replaced on every turn the host supplies them.
 */

/**
 * Host-app callback that supplies a conversation's own secrets, by name.
 *
 * Values supplied here become the conversation's, not the person's: they
 * stay sealed on the conversation for its whole life and serve every turn
 * in it, including turns a teammate the conversation is shared with sends,
 * until a later turn replaces them. Do not hand a person's own token (a
 * user's identity or session token) here when anyone else can send turns
 * to the conversation; give the person's runs their own credentials
 * through their My vault instead.
 *
 * Invoked once per turn, at submit time — never cached — so rotating
 * credentials are current when the turn starts. May return the values
 * synchronously or via a promise. Host values take precedence over
 * composer-collected values on a name collision: the host owns the
 * conversation's credentials, and a stale or user-supplied value must
 * never shadow them.
 *
 * If the provider throws (or rejects), the submission is aborted and the
 * error surfaces through the owning flow's error channel.
 *
 * Never invoked for the `"guest"` audience, first turn or follow-up: a
 * share-link guest brings no values, and the share's vaults are what its
 * runs use.
 *
 * @example
 * ```tsx
 * <SessionViewer
 *   sessionId={id}
 *   org={org}
 *   getSessionSecrets={async () => ({ PROJECT_API_KEY: await projectApiKey(projectId) })}
 * />
 * ```
 */
export type SessionSecretsProvider = () =>
  | Promise<Record<string, string>>
  | Record<string, string>;

/**
 * Merges composer-collected secrets with a host provider's. Host values
 * win on collisions. Returns `undefined` when neither contributes anything.
 * Provider errors are intentionally not caught: callers treat a failure as
 * fatal for the submission.
 */
export async function resolveSessionSecrets(
  getSessionSecrets: SessionSecretsProvider,
  composerSecrets: Record<string, string> | undefined,
): Promise<Record<string, string> | undefined> {
  const hostSecrets = await getSessionSecrets();
  const merged = { ...composerSecrets, ...hostSecrets };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
