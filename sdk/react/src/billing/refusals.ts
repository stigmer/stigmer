// The refusals the server gives a run it will not start for want of a model
// key or of agent hours: their reasons, what each names, and the routes the
// notices link to. Apart from the notices, so a surface that only needs to
// tell a refusal (the launcher before a first message) loads the notices'
// drawing only when one arrives.

import { getErrorReason } from "@stigmer/client";

/**
 * The reason a server refuses a run that needs a provider nothing serves:
 * the organization holds no key for it, or this server's runners do not
 * reach it (`PlatformQueryController.getModelReadiness` reports the same).
 */
export const PROVIDER_KEY_REQUIRED = "PROVIDER_KEY_REQUIRED";

/** Models & providers, where the notice links by default: the top-level route every client serves. */
export const DEFAULT_MODELS_HUB_HREF = "/models";

/** What a `PROVIDER_KEY_REQUIRED` refusal names. */
export interface ProviderKeyRequired {
  /** The organization the run was refused in. */
  readonly org: string;
  /** The provider it has no key for: `anthropic` or `openai`. */
  readonly provider: string;
  /** The model the run would have used; empty when it names none. */
  readonly model: string;
}

/**
 * What a refusal names, when `error` is a `PROVIDER_KEY_REQUIRED` refusal;
 * `null` for any other error.
 */
export function providerKeyRequired(error: unknown): ProviderKeyRequired | null {
  const reason = getErrorReason(error);
  if (reason?.reason !== PROVIDER_KEY_REQUIRED) {
    return null;
  }
  return {
    org: reason.metadata.org ?? "",
    provider: reason.metadata.provider ?? "",
    model: reason.metadata.model ?? "",
  };
}

/**
 * The reason Stigmer Cloud refuses a new turn when the organization's plan
 * has used the agent hours it includes and new work pauses until they
 * reset. The refusal is FAILED_PRECONDITION with this reason and the
 * metadata `org`, `plan`, `included_hours` and `resets_at`; a guest or a
 * channel user is refused without it.
 */
export const AGENT_HOURS_USED_UP = "AGENT_HOURS_USED_UP";

/** What an `AGENT_HOURS_USED_UP` refusal names. */
export interface AgentHoursUsedUp {
  /** The organization the turn was refused in. */
  readonly org: string;
  /**
   * The plan whose hours are used; empty for a child organization, which is
   * on its parent's plan and cannot change it.
   */
  readonly plan: string;
  /** The hours the plan includes each month, as the refusal states them. */
  readonly includedHours: string;
  /** When the hours reset, an RFC 3339 instant; empty when the refusal names none. */
  readonly resetsAt: string;
}

/**
 * What a refusal names, when `error` is Stigmer Cloud's
 * `AGENT_HOURS_USED_UP`; `null` for any other error.
 */
export function agentHoursUsedUp(error: unknown): AgentHoursUsedUp | null {
  const reason = getErrorReason(error);
  if (reason?.reason !== AGENT_HOURS_USED_UP) {
    return null;
  }
  return {
    org: reason.metadata.org ?? "",
    plan: reason.metadata.plan ?? "",
    includedHours: reason.metadata.included_hours ?? "",
    resetsAt: reason.metadata.resets_at ?? "",
  };
}
