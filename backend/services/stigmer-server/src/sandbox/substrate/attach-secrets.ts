/**
 * The secret names the runner's attach waiter accepts in a push: its secret
 * list, `RUNNER_SECRET_ENV_KEYS` in the runner's
 * `src/shared/runner-credential-keys.ts`. The waiter refuses a push naming
 * any other variable, so the driver refuses such a name at boot, where an
 * operator sees it, rather than on every Session's first push.
 *
 * A copy, because the server imports nothing from the runner. It is kept
 * equal by the runner's own test (`src/attach/__tests__/push.test.ts`),
 * which loads this module and compares the two, so a name added on either
 * side turns that test red. This module imports nothing, so the runner can
 * load it from source.
 */
export const ATTACH_SECRET_NAMES: readonly string[] = [
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
