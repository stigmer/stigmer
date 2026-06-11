import type { EnvVarInput } from "@stigmer/sdk";

/**
 * Host-app callback that supplies environment variables for a single
 * execution.
 *
 * Invoked once per execution, at submit time — never cached — so
 * short-lived credentials (e.g. a freshly minted platform token scoped
 * to the signed-in user) are always current when the execution starts.
 * May return the variables synchronously or via a promise.
 *
 * Host-provided values take precedence over composer-collected env on
 * key collisions: the host injects identity material, and a stale or
 * user-supplied value must never shadow it.
 *
 * If the provider throws (or rejects), the submission is aborted and
 * the error surfaces through the owning flow's error channel — an
 * execution never runs with missing or stale credentials.
 *
 * @example
 * ```tsx
 * <SessionViewer
 *   sessionId={id}
 *   org={org}
 *   getRuntimeEnv={async () => ({
 *     PLATFORM_TOKEN: { value: await mintShortLivedToken(), isSecret: true },
 *     PLATFORM_ORG: { value: activeOrg },
 *   })}
 * />
 * ```
 */
export type RuntimeEnvProvider = () =>
  | Promise<Record<string, EnvVarInput>>
  | Record<string, EnvVarInput>;

/**
 * Resolves the effective `runtimeEnv` for one execution by merging
 * composer-collected env with host-provided env from a
 * {@link RuntimeEnvProvider}.
 *
 * Host values win on key collisions (see {@link RuntimeEnvProvider}).
 * Returns `undefined` when neither source contributes any variables,
 * so callers can pass the result straight to execution creation.
 *
 * Provider errors are intentionally not caught here: callers must
 * treat a failure as fatal for the submission. Callers without a
 * provider should pass the composer env through directly rather than
 * paying this function's await.
 */
export async function resolveExecutionRuntimeEnv(
  getRuntimeEnv: RuntimeEnvProvider,
  composerEnv: Record<string, EnvVarInput> | undefined,
): Promise<Record<string, EnvVarInput> | undefined> {
  const hostEnv = await getRuntimeEnv();
  const merged = { ...composerEnv, ...hostEnv };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
