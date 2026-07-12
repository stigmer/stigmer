/**
 * Resolve execution environment variables from the ExecutionContext.
 *
 * Mirrors the Python agent-runner's environment.py: fetches the merged,
 * decrypted env vars from the backend so MCP servers receive credentials
 * (e.g. API keys for HTTP headers, secrets for stdio subprocesses).
 */

import type { StigmerClient } from "../../client/stigmer-client.js";

export interface EnvResult {
  envVars: Record<string, string>;
  secretKeys: Set<string>;
}

/**
 * Fetch and extract env vars from the ExecutionContext for a given execution.
 *
 * Returns an empty env if no ExecutionContext exists (e.g. executions
 * without any configured secrets or env vars).
 */
export async function resolveExecutionEnv(
  client: StigmerClient,
  executionId: string,
): Promise<EnvResult> {
  // A desktop runner exchanges its bootstrap credential for a token scoped to
  // this execution's session, so cloud's decrypt gate binds the read (#156).
  // No-op for cloud sandbox and OSS runners.
  const scopedToken = await client.acquireScopedRunnerToken({
    agentExecutionId: executionId,
  });

  let execCtx;
  try {
    execCtx = await client.getExecutionContextByExecutionId(executionId, scopedToken);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    // NOT_FOUND (5) is expected for executions without env vars
    if (code === 5) {
      console.log(
        `No ExecutionContext found for execution ${executionId} — ` +
          `proceeding with empty environment.`,
      );
      return { envVars: {}, secretKeys: new Set() };
    }
    throw err;
  }

  const envVars: Record<string, string> = {};
  const secretKeys = new Set<string>();
  const data = execCtx.spec?.data;

  if (data) {
    for (const [key, execValue] of Object.entries(data)) {
      envVars[key] = execValue.value;
      if (execValue.isSecret) {
        secretKeys.add(key);
      }
    }
  }

  console.log(
    `Resolved environment from ExecutionContext: ` +
      `context_id=${execCtx.metadata?.id}, ` +
      `env_count=${Object.keys(envVars).length}, ` +
      `secret_count=${secretKeys.size}, ` +
      `keys=[${Object.keys(envVars).sort().join(", ")}]`,
  );

  return { envVars, secretKeys };
}
