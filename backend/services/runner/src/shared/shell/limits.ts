/**
 * The Stigmer harness's shell's bounds that the runner's configuration
 * names, apart from the command runner (`run-command.ts`) so `config.ts` can
 * default them without importing a module that starts processes: the turn
 * runtime's own graph opens no file and starts no process on the agent's
 * behalf
 * (`harness/__tests__/runtime-touches-no-agent-path.test.ts`).
 */

/**
 * Default ceiling on a command's timeout, in seconds (`Config.shellTimeoutMaxSeconds`,
 * STIGMER_SHELL_TIMEOUT_MAX_SECONDS): the most the model may raise one
 * command's bound to. 55 minutes: well past a long build or test suite, and
 * under the turn runtime's 60-minute backstop for an open operation, so the
 * shell's own bound always fires first.
 */
export const DEFAULT_SHELL_TIMEOUT_MAX_SECONDS = 3_300;
