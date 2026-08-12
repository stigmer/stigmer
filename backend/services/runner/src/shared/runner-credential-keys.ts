/**
 * Env var names of the runner's own credentials — the single source of truth
 * for every surface that isolates agent-spawned processes from the runner's
 * process env (issue #385).
 *
 * Inclusion rule: a name belongs here iff the runner reads it from its own
 * `process.env` to authenticate the runner's own outbound calls. User-supplied
 * credentials resolved from ExecutionContext (e.g. GITHUB_TOKEN, read only
 * from mergedEnvVars) must NEVER be listed — the ExecutionContext overlay is
 * their sanctioned delivery channel, and denying them here would break it.
 *
 * Consumers:
 * - shell-env.ts: SHELL_ENV_DENYLIST for the native harness `execute` tool.
 * - mcp-manager.test.ts: leak-tripwire canaries for MCP stdio subprocesses
 *   (that path passes NO runner env by construction; the test plants these
 *   names to prove none leak through).
 *
 * Ambient cloud-SDK chain vars (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * GOOGLE_APPLICATION_CREDENTIALS, ...) are deliberately absent: they are
 * dual-use on local runners (operators expect agent shells to keep their
 * ambient aws/gcloud auth), and on a local backend the shell can read the
 * credential files off disk regardless (owner ruling on #385).
 */
export const RUNNER_CREDENTIAL_ENV_KEYS: readonly string[] = [
  // Derives HITL approval fingerprints (fingerprint-secret.ts) — an agent
  // that reads this could forge approval receipts.
  "STIGMER_RUNNER_HITL_SECRET",
  // Stigmer control-plane auth (config.ts; rotated at runtime by
  // runner-manager.ts). Executions receive theirs via ExecutionContext.
  "STIGMER_TOKEN",
  // Fallback bearer token for model-registry/pricing fetches when
  // STIGMER_TOKEN is unset (registry-endpoint.ts).
  "STIGMER_AUTH_TOKEN",
  // Cursor harness credential (config.ts) — agent-spawned processes never
  // need direct Cursor API access.
  "CURSOR_API_KEY",
  // Direct-mode Anthropic key for the native harness (model-client.ts).
  "ANTHROPIC_API_KEY",
  // Direct-mode OpenAI key for the native harness (model-client.ts).
  "OPENAI_API_KEY",
  // Azure AI Foundry backend key (model-client.ts).
  "ANTHROPIC_FOUNDRY_API_KEY",
  // Bedrock backend bearer credential, read by the AWS SDK's chain
  // (llm-backend.ts documents it as a supported auth path).
  "AWS_BEARER_TOKEN_BEDROCK",
];
