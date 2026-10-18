/**
 * Which Environment a conversation runs in, and why: the server's order,
 * read before the conversation exists, and the conversation's own record
 * read after.
 *
 * The server resolves one Environment per conversation when it is created
 * (`SessionStatus.environment` and `environment_source`): the one the
 * conversation names, or its routine's; else its agent's default; else
 * its organization's default; else none, the server's standard sandbox. A
 * conversation on the person's own machine, or on a server whose
 * conversations run in no sandbox it starts, gets none whatever the
 * defaults say. `resolveEnvironmentChoice` previews that order from what a
 * page already loaded (the agent's spec, the organization's preferences),
 * so a composer can say "data-science · the agent's default" before the
 * first message; the conversation's own record is the answer the moment it
 * exists (`environmentChoiceOfStatus`). The preview reads the agent's
 * latest version where the server reads the version the conversation
 * pins, which agree for a new conversation.
 */
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { EnvironmentSource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { ResourceRef } from "@stigmer/client";

/** Whose choice a conversation's Environment is, in the order the server asks. */
export type EnvironmentSourceName = "session" | "routine" | "agent" | "organization";

/**
 * The sources in the order the server resolves them. The conversation's
 * own choice and its routine's are one step (a conversation a routine
 * starts carries the routine's choice as its own), listed apart because a
 * person reads them apart.
 */
export const ENVIRONMENT_SOURCE_ORDER: readonly EnvironmentSourceName[] = [
  "session",
  "routine",
  "agent",
  "organization",
];

/** An Environment as a page holds a reference to it: a stored reference or one a picker made. */
export type EnvironmentReference = Pick<ApiResourceReference, "org" | "slug"> & { readonly id?: string };

/** Which Environment applies, and why. */
export type EnvironmentChoice =
  /** One applies, chosen by `source`. */
  | { readonly kind: "chosen"; readonly environment: EnvironmentReference; readonly source: EnvironmentSourceName }
  /** Environments govern this conversation, and nothing names one: the server's standard sandbox. */
  | { readonly kind: "none" }
  /** No Environment governs this conversation: it runs on the person's own machine. */
  | { readonly kind: "own-machine" }
  /** No Environment governs this server's conversations: none runs in a sandbox it starts. */
  | { readonly kind: "not-on-server" };

/** What {@link resolveEnvironmentChoice} reads. Every reference is optional; an empty one counts as unset. */
export interface EnvironmentChoiceInputs {
  /** The conversation's own pick (the composer's), or the routine's own on a routine's form. */
  readonly own?: EnvironmentReference | ResourceRef | null;
  /** The routine's choice, for a conversation a routine starts. */
  readonly routine?: EnvironmentReference | ResourceRef | null;
  /** The agent's default (`AgentSpec.environment_ref`). */
  readonly agent?: EnvironmentReference | ResourceRef | null;
  /** The organization's default (`OrganizationPreferences.default_environment_ref`). */
  readonly organization?: EnvironmentReference | ResourceRef | null;
  /**
   * Why no Environment governs this conversation, when none does
   * ({@link environmentsNotApplying}); undefined when Environments govern
   * it, or the server has not said (an older server).
   */
  readonly notApplying?: EnvironmentsNotApplying;
}

/** Why no Environment governs a conversation: it runs on the person's own machine, or the server starts no sandbox for it. */
export type EnvironmentsNotApplying = "own-machine" | "not-on-server";

/**
 * Why no Environment would govern a conversation started here, or
 * undefined when one would (or the server has not said).
 *
 * `target` is the execution target the surface sends: `"local"` is the
 * person's own machine (the desktop app), where none applies; `"cloud"`
 * asks for a sandbox the server starts, whose refusal speaks if it cannot;
 * undefined lets the server decide, and `availability.applies` is the
 * server's answer for exactly that conversation.
 */
export function environmentsNotApplying(
  availability: { readonly applies: boolean } | undefined,
  target: "local" | "cloud" | undefined,
): EnvironmentsNotApplying | undefined {
  if (target === "local") {
    return "own-machine";
  }
  if (target === undefined && availability?.applies === false) {
    return "not-on-server";
  }
  return undefined;
}

function isSet(ref: EnvironmentReference | ResourceRef | null | undefined): ref is EnvironmentReference {
  return ref != null && ((ref.slug ?? "") !== "" || (ref.id ?? "") !== "");
}

function referenceOf(ref: EnvironmentReference | ResourceRef): EnvironmentReference {
  return { org: ref.org, slug: ref.slug, ...(ref.id ? { id: ref.id } : {}) };
}

/**
 * Previews the Environment a conversation will run in, in the server's
 * order: its own pick, its routine's, its agent's default, its
 * organization's default, else none. A conversation Environments do not
 * govern gets none whatever the defaults say.
 *
 * @example
 * ```ts
 * resolveEnvironmentChoice({ agent: agentSpec.environmentRef, organization: prefs.defaultEnvironmentRef });
 * // { kind: "chosen", environment: { org, slug: "data-science" }, source: "agent" }
 * ```
 */
export function resolveEnvironmentChoice(inputs: EnvironmentChoiceInputs): EnvironmentChoice {
  if (inputs.notApplying !== undefined) {
    return { kind: inputs.notApplying };
  }
  const bySource: Record<EnvironmentSourceName, EnvironmentReference | ResourceRef | null | undefined> = {
    session: inputs.own,
    routine: inputs.routine,
    agent: inputs.agent,
    organization: inputs.organization,
  };
  for (const source of ENVIRONMENT_SOURCE_ORDER) {
    const ref = bySource[source];
    if (isSet(ref)) {
      return { kind: "chosen", environment: referenceOf(ref), source };
    }
  }
  return { kind: "none" };
}

/** Each wire source's name, keyed by the enum so a new value fails to compile until it is named here. */
const SOURCE_NAMES: Readonly<Record<EnvironmentSource, EnvironmentSourceName | undefined>> = {
  [EnvironmentSource.UNSPECIFIED]: undefined,
  [EnvironmentSource.SESSION]: "session",
  [EnvironmentSource.ROUTINE]: "routine",
  [EnvironmentSource.AGENT]: "agent",
  [EnvironmentSource.ORGANIZATION]: "organization",
};

/** The wire's source as a name; undefined for UNSPECIFIED (none applied). */
export function environmentSourceName(source: EnvironmentSource): EnvironmentSourceName | undefined {
  return SOURCE_NAMES[source];
}

/**
 * The Environment a created conversation got, from its own record. An
 * unset Environment with no source means none applied: the server's
 * standard sandbox, or, for a conversation on the person's own machine
 * (`ownMachine`), none governs it.
 */
export function environmentChoiceOfStatus(
  status: { readonly environment?: ApiResourceReference; readonly environmentSource: EnvironmentSource } | undefined,
  ownMachine = false,
): EnvironmentChoice {
  const source = status === undefined ? undefined : environmentSourceName(status.environmentSource);
  if (status?.environment !== undefined && isSet(status.environment) && source !== undefined) {
    return { kind: "chosen", environment: referenceOf(status.environment), source };
  }
  return ownMachine ? { kind: "own-machine" } : { kind: "none" };
}
