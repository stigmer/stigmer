/**
 * The runner's secret variables: the names the runner takes into custody
 * at boot and keeps out of every process its agents start, its
 * `RUNNER_SECRET_ENV_KEYS` (the runner's
 * `src/shared/runner-credential-keys.ts`). The server needs them twice: an
 * operator's plain runner settings (STIGMER_SANDBOX_RUNNER_ENV) may not
 * name one, or a driver would write a secret where it writes plain values
 * (a manifest, a snapshotted template); and the runner's attach waiter
 * accepts only these in a push, so the substrate driver refuses any other
 * name on the secret list at boot rather than on every Session's first
 * push.
 *
 * A copy, because the server imports nothing from the runner. It is kept
 * equal by the runner's own test (`src/attach/__tests__/push.test.ts`),
 * which loads this module and compares the two, so a name added on either
 * side turns that test red. This module imports nothing, so the runner can
 * load it from source.
 */
export const RUNNER_SECRET_NAMES: readonly string[] = [
  "STIGMER_RUNNER_HITL_SECRET",
  "STIGMER_TOKEN",
  "STIGMER_AUTH_TOKEN",
  "CURSOR_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "STIGMER_TEMPORAL_API_KEY",
  "STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA",
  "STIGMER_PAYLOAD_ENCRYPTION_KEY",
  "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY",
];
