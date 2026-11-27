// Why an embedded chat could not start, classified once for its three
// readers: the line the person in front of the chat reads (their words),
// the host's `onError` (the developer's words and a typed reason to branch
// on), and the browser's console, where a developer who wired no `onError`
// still hears the cause. The classification reads the failure's Connect
// code (`classifyError`), whether the server was reached at all
// (`isUnreachable`), whether the organization the chat names is one of the
// signed-in account's own, and whether that account is an app user (signed
// in through the host's backend), since an app user minted with no role
// sees no agent of the organization at all.

import { classifyError } from "@stigmer/client";
import { isUnreachable } from "../internal/unreachable.js";

/**
 * Why the chat could not start:
 *
 * - `agent-not-found`: the organization has no agent by that name the
 *   account can see;
 * - `no-access`: the account may not use the agent (an app user signed in
 *   with no role in the organization among them);
 * - `organization-not-found`: none of the account's organizations is named
 *   as the chat names it;
 * - `unreachable`: Stigmer's server never answered;
 * - `no-credential`: no sign-in reached Stigmer (the client's
 *   `getAccessToken` gave no token, or Stigmer refused the one it gave);
 * - `unknown`: any other failure.
 */
export type AgentChatSetupReason =
  | "agent-not-found"
  | "no-access"
  | "organization-not-found"
  | "unreachable"
  | "no-credential"
  | "unknown";

/**
 * The error `AgentChat`'s `onError` receives when the chat could not start.
 * `message` is written for the developer ("your app signs its users in with
 * no role in acme, …"); `reason` is the cause to branch on; `cause` is the
 * failure as the client raised it.
 */
export class AgentChatSetupError extends Error {
  /** Why the chat could not start. */
  readonly reason: AgentChatSetupReason;
  /** What the person in front of the chat reads, in their words. */
  readonly endUserMessage: string;

  constructor(reason: AgentChatSetupReason, message: string, endUserMessage: string, cause: unknown) {
    super(message, { cause });
    this.name = "AgentChatSetupError";
    this.reason = reason;
    this.endUserMessage = endUserMessage;
  }
}

/** What the classification reads besides the failure itself. */
export interface AgentChatSetupContext {
  /** The organization the chat names (a slug or an id). */
  readonly org: string;
  /** The agent's slug. */
  readonly agent: string;
  /**
   * Whether `org` is one of the signed-in account's own organizations;
   * `null` when they could not be read.
   */
  readonly orgIsMine: boolean | null;
  /** Whether the signed-in account is an app user. */
  readonly appUser: boolean;
}

/** What an end user reads when the agent cannot be found. */
export const AGENT_NOT_FOUND_LINE = "This agent isn't available. It may have been renamed or removed.";
const NO_ACCESS_LINE = "Your account can't use this agent yet. Ask the app's team for access.";
const NOT_SET_UP_LINE = "This chat isn't set up yet, so it can't start.";
const UNREACHABLE_LINE = "Can't reach Stigmer right now. Check your connection and try again.";
const NO_CREDENTIAL_LINE = "Sign in to this app to use its chat.";
const UNKNOWN_LINE = "This agent couldn't be loaded. Try again in a moment.";

/** The chat's setup failure `error`, classified by its cause. */
export function classifyAgentSetupFailure(error: unknown, context: AgentChatSetupContext): AgentChatSetupError {
  if (error instanceof AgentChatSetupError) return error;
  const { org, agent, orgIsMine, appUser } = context;
  const make = (reason: AgentChatSetupReason, developer: string, endUser: string) =>
    new AgentChatSetupError(reason, developer, endUser, error);
  const noAccessAsAppUser = () =>
    make(
      "no-access",
      `your app signs its users in with no role in ${org}, so they can't see this agent; set a sign-in role in Settings → Embedding`,
      NO_ACCESS_LINE,
    );

  if (isUnreachable(error)) {
    return make("unreachable", "Stigmer's server can't be reached; check the client's baseUrl and that the server is running", UNREACHABLE_LINE);
  }
  switch (classifyError(error)) {
    case "auth":
      return make(
        "no-credential",
        "no sign-in reached Stigmer: the client's getAccessToken gave no token, or Stigmer refused the one it gave",
        NO_CREDENTIAL_LINE,
      );
    case "permission":
      if (appUser && orgIsMine === false) return noAccessAsAppUser();
      return make("no-access", `the signed-in account has no access to the agent "${agent}" in ${org}`, NO_ACCESS_LINE);
    case "not-found":
      if (orgIsMine === false) {
        if (appUser) return noAccessAsAppUser();
        return make(
          "organization-not-found",
          `none of the signed-in account's organizations is named "${org}"; check the organization in the agent prop`,
          NOT_SET_UP_LINE,
        );
      }
      return make("agent-not-found", `${org} has no agent named "${agent}"; check the agent prop against the agent's slug`, AGENT_NOT_FOUND_LINE);
    default:
      return make("unknown", `the chat could not start: ${error instanceof Error ? error.message : String(error)}`, UNKNOWN_LINE);
  }
}

const reported = new Set<string>();

/**
 * Write the developer's words to the browser's console, once per cause in
 * a page, as the kit reports a host part that threw: a developer who wired
 * no `onError` still sees why the chat did not start.
 *
 * @internal
 */
export function reportSetupFailure(failure: AgentChatSetupError): void {
  const key = `${failure.reason}\u0000${failure.message}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`Stigmer: ${failure.message}`, failure.cause);
}
