/**
 * Environment variable resolution for deep agent execution.
 *
 * Resolves the merged environment from ExecutionContext — the single
 * source of truth for execution-scoped variables. The workflow injects
 * all resolved variables into ExecutionContext before the activity starts.
 *
 * The returned result separates plaintext keys from secret keys so that
 * downstream consumers (e.g., StatusBuilder in Phase 3b) can redact
 * secret values in user-facing displays.
 */

import type { StigmerClient } from "../../client/stigmer-client.js";

export interface EnvironmentResult {
  readonly mergedEnvVars: Record<string, string>;
  readonly secretKeys: ReadonlySet<string>;
}

/**
 * Fetch the ExecutionContext for the given execution and extract the
 * merged environment variables.
 *
 * If no ExecutionContext exists (e.g., the agent has no environment or
 * secrets configured), returns an empty result so execution can proceed.
 */
export async function resolveEnvironment(
  client: StigmerClient,
  executionId: string,
): Promise<EnvironmentResult> {
  let execCtx;
  try {
    execCtx = await client.getExecutionContextByExecutionId(executionId);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "not_found" || code === "NOT_FOUND") {
      console.log(
        `[env] No ExecutionContext found for execution ${executionId} — ` +
        `proceeding with empty environment.`,
      );
      return { mergedEnvVars: {}, secretKeys: new Set() };
    }
    throw err;
  }

  const mergedEnvVars: Record<string, string> = {};
  const secretKeys = new Set<string>();

  const data = execCtx.spec?.data;
  if (data) {
    for (const [key, execValue] of Object.entries(data)) {
      mergedEnvVars[key] = execValue.value;
      if (execValue.isSecret) {
        secretKeys.add(key);
      }
    }
  }

  console.log(
    `[env] Resolved environment: env_count=${Object.keys(mergedEnvVars).length}, ` +
    `secret_count=${secretKeys.size}`,
  );

  return { mergedEnvVars, secretKeys };
}
