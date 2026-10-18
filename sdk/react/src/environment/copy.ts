/**
 * The words every surface uses for an Environment: why one applies, that
 * none does, and what the server's sandboxes cannot do. One table, so the
 * composer, the agent's page, a routine, the organization's preferences
 * and an open conversation's Setup panel say the same thing the same way.
 */
import type { EnvironmentChoice, EnvironmentSourceName, EnvironmentsNotApplying } from "./resolve.js";

/** Why an Environment applies, by whose choice it is. */
export const ENVIRONMENT_SOURCE_COPY: Readonly<Record<EnvironmentSourceName, string>> = {
  session: "chosen for this conversation",
  routine: "set by the routine",
  agent: "the agent's default",
  organization: "the organization's default",
};

/** A conversation Environments govern, with nothing naming one. */
export const NO_ENVIRONMENT_COPY = "No environment: the server's standard sandbox";

/** Why no Environment governs a conversation. */
export const ENVIRONMENTS_NOT_APPLYING_COPY: Readonly<Record<EnvironmentsNotApplying, string>> = {
  "own-machine": "Environments don't apply here: this conversation runs on your own machine",
  "not-on-server": "Environments don't apply here: conversations on this server don't run in sandboxes it starts",
};

/** The banner over the Environments list and form on a server whose conversations run in no sandbox it starts. */
export const ENVIRONMENTS_NOT_ON_SERVER_BANNER =
  "Environments don't apply on this server: its conversations don't run in sandboxes it starts. You can still create them for a server that does.";

/** Why "Limited" is unavailable: the server's sandboxes cannot enforce a host list. */
export const LIMITED_NETWORKING_UNAVAILABLE_COPY = "This server's sandboxes can't limit networking to listed websites.";

/** Why packages are unavailable: the server's sandboxes cannot install them. */
export const PACKAGES_UNAVAILABLE_COPY = "This server's sandboxes can't install packages.";

/**
 * One line for a choice: "data-science · the agent's default", "No
 * environment: the server's standard sandbox", or why none applies.
 * `nameOf` turns a reference into the name a person knows it by (its
 * display name where the page has it); the slug is used otherwise.
 */
export function describeEnvironmentChoice(
  choice: EnvironmentChoice,
  nameOf: (environment: { readonly org: string; readonly slug: string; readonly id?: string }) => string = (e) =>
    e.slug,
): string {
  switch (choice.kind) {
    case "chosen":
      return `${nameOf(choice.environment)} · ${ENVIRONMENT_SOURCE_COPY[choice.source]}`;
    case "none":
      return NO_ENVIRONMENT_COPY;
    case "own-machine":
    case "not-on-server":
      return ENVIRONMENTS_NOT_APPLYING_COPY[choice.kind];
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

/**
 * The first row of a picker: what applies when the field is left empty.
 * "Default: data-science (the agent's default)", or "Default: none" when
 * nothing further down the order names one.
 */
export function inheritedRowLabel(
  inherited: EnvironmentChoice,
  nameOf: (environment: { readonly org: string; readonly slug: string; readonly id?: string }) => string = (e) =>
    e.slug,
): string {
  return inherited.kind === "chosen"
    ? `Default: ${nameOf(inherited.environment)} (${ENVIRONMENT_SOURCE_COPY[inherited.source]})`
    : "Default: none";
}
