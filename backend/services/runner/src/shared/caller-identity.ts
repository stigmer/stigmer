/**
 * The caller identity for MCP server configs — reserved platform env keys
 * that carry the platform-verified "who is calling" into user-defined MCP
 * server headers/args, without ever passing through the model.
 *
 * The identity is a (kind, value) pair with fixed precedence:
 *   1. The channel sender (Meta/Slack-verified, stamped into
 *      `SessionSpec.metadata` by the cloud broker — sender-identity.ts is
 *      the reader).
 *   2. The session creator (`stigmer_user`) from the Session resource's
 *      audit actor — console/CLI sessions have no channel sender, but the
 *      platform knows exactly who created the session.
 *   3. The anonymous sentinel — discovery (no session exists) and sessions
 *      with no readable creator. Consumers must treat anonymous as a
 *      first-class caller: answer tools/list, refuse tool calls.
 *
 * Injection is opt-in by construction: the values enter the env map used
 * for MCP placeholder resolution, and `filterEnvToDeclaredKeys` already
 * restricts every server to the keys it declared in `spec.env`. A server
 * that never declares the reserved keys never receives identity.
 * Declarations MUST be `optional: true` — execution creation validates
 * declared-env completeness in both editions, and these keys have no value
 * until the runner injects them.
 *
 * Trust model: the resulting header is RUNNER-asserted, not signed. It
 * closes the prompt-injection hole (the model cannot influence the value),
 * but the receiving server must pair it with a shared secret and be
 * operated by someone who trusts the runner's network path.
 */

import { readSenderIdentity } from "./sender-identity.js";

/** Reserved env key: the identity's kind token. */
export const CALLER_IDENTITY_KIND_ENV_KEY = "STIGMER_CALLER_IDENTITY_KIND";

/** Reserved env key: the identity's value. */
export const CALLER_IDENTITY_VALUE_ENV_KEY = "STIGMER_CALLER_IDENTITY_VALUE";

/** Reserved env key: the session the identity was resolved for. */
export const SESSION_ID_ENV_KEY = "STIGMER_SESSION_ID";

/**
 * Kind token for a platform user (console/CLI session creator). Channel
 * kinds (`whatsapp_phone`, `slack_user_id`, ...) pass through VERBATIM
 * from the cloud broker's metadata — this module never rewrites them.
 */
export const STIGMER_USER_KIND = "stigmer_user";

/**
 * Kind token for the anonymous caller. Deliberately a real token rather
 * than an absent key: every declared placeholder must resolve in every
 * resolution context, or discovery fails with PlaceholderResolutionError
 * before the server's tools are ever classified.
 */
export const ANONYMOUS_KIND = "anonymous";

/** The resolved caller identity. */
export interface CallerIdentity {
  kind: string;
  value: string;
}

/** The audit actor shape read from `status.audit.spec_audit.created_by`. */
export interface SessionCreatorActor {
  id?: string;
  email?: string;
}

/** The identity injected when no session context exists (discovery). */
export function anonymousCallerIdentity(): CallerIdentity {
  return { kind: ANONYMOUS_KIND, value: "" };
}

/**
 * Resolve the caller identity for a session: channel sender first, then
 * the session creator, then anonymous.
 *
 * The creator value prefers email over id: bindings are maintained by
 * humans, and the audit actor's `id` field is historically mixed
 * (identity-account id vs email — see the proto's own @internal note).
 * Binding matchers should compare emails case-insensitively.
 */
export function resolveCallerIdentity(
  sessionMetadata: Record<string, string> | undefined,
  creator?: SessionCreatorActor,
): CallerIdentity {
  const sender = readSenderIdentity(sessionMetadata);
  if (sender) {
    return { kind: sender.kind, value: sender.value };
  }

  const email = creator?.email?.trim();
  const id = creator?.id?.trim();
  const value = email || id;
  if (value) {
    return { kind: STIGMER_USER_KIND, value };
  }

  return anonymousCallerIdentity();
}

/**
 * Return a NEW env map with the reserved caller-identity keys set —
 * platform values are authoritative over same-named user entries (the
 * injectPlatformEnv precedent: a user env var must never be able to
 * impersonate a caller).
 *
 * Call this on the env map handed to MCP resolution ONLY — never on the
 * map that reaches agent subprocess environments. Per-server opt-in is
 * enforced downstream by filterEnvToDeclaredKeys.
 */
export function injectCallerIdentityEnv(
  envVars: Record<string, string>,
  identity: CallerIdentity,
  sessionId: string,
): Record<string, string> {
  const reserved: Record<string, string> = {
    [CALLER_IDENTITY_KIND_ENV_KEY]: identity.kind,
    [CALLER_IDENTITY_VALUE_ENV_KEY]: identity.value,
    [SESSION_ID_ENV_KEY]: sessionId,
  };

  for (const [key, value] of Object.entries(reserved)) {
    if (key in envVars && envVars[key] !== value) {
      console.info(
        `Platform env var '${key}' overrides value from ExecutionContext ` +
        `(caller-identity vars are authoritative)`,
      );
    }
  }

  return { ...envVars, ...reserved };
}

/**
 * Discovery-context injection: the connect workflow resolves the same
 * header templates with no session, so every declared reserved key gets
 * the anonymous sentinel — otherwise a caller-identity-templating server
 * can never be discovered. Gated on the server's declared keys, matching
 * injectPlatformEnv's contract in the discovery activity.
 */
export function injectAnonymousCallerIdentityForDiscovery(
  declaredEnvKeys: ReadonlySet<string>,
  envVars: Record<string, string>,
): Record<string, string> {
  const anonymous = anonymousCallerIdentity();
  const sentinels: Record<string, string> = {
    [CALLER_IDENTITY_KIND_ENV_KEY]: anonymous.kind,
    [CALLER_IDENTITY_VALUE_ENV_KEY]: anonymous.value,
    [SESSION_ID_ENV_KEY]: "",
  };

  let result: Record<string, string> | undefined;
  for (const [key, value] of Object.entries(sentinels)) {
    if (!declaredEnvKeys.has(key)) continue;
    if (!result) result = { ...envVars };
    result[key] = value;
  }

  return result ?? envVars;
}
