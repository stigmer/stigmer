// Whether the server the CLI talks to holds one organization, the one guard
// every command that needs an organization runs, and whether output names it.
//
// A server that holds one (the open-source edition: a laptop's `stigmer up`,
// a self-hosted install) makes it at its first start and fills it into every
// request that names none; its getServerInfo answers `single_org`. There the
// CLI never asks for, invents or prints an organization. A server that holds
// several refuses a write or an organization-scoped read that names none, so
// a command that needs one says so first, with the ways to set it, instead of
// relaying the server's validation error.
//
// The answer is a fact about the server, asked once per client: concurrent
// askers share the pending answer. A server that predates the field answers
// without it and is treated as one that holds several, as it always was. A
// failed ask (an unreachable server, a refused credential) rejects with its
// own error, so the command reports the real cause rather than "organization
// not set", and is not remembered, so the next ask tries again.
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/usage-error.js";

const answers = new WeakMap<Stigmer, Promise<boolean>>();

/** True when the server holds one organization and fills it into requests that name none. */
export function holdsOneOrganization(stigmer: Stigmer): Promise<boolean> {
  let answer = answers.get(stigmer);
  if (answer === undefined) {
    answer = Promise.resolve()
      .then(() => stigmer.platform.getServerInfo())
      .then((info) => info.singleOrg === true);
    answers.set(stigmer, answer);
    answer.catch(() => answers.delete(stigmer));
  }
  return answer;
}

/**
 * Whether output leaves the organization out: true on a server that holds
 * one. A failed ask keeps it in, so printing never fails a command whose
 * work already succeeded.
 */
export function omitsOrganization(stigmer: Stigmer): Promise<boolean> {
  return holdsOneOrganization(stigmer).catch(() => false);
}

/**
 * Refuses an empty organization, but only on a server that needs one.
 * A failed ask rejects with its own error rather than this refusal.
 * `setItWith` lists the commands that name it, one per line.
 */
export async function requireOrganization(
  stigmer: Stigmer,
  org: string,
  setItWith: readonly string[],
): Promise<void> {
  if (org !== "" || (await holdsOneOrganization(stigmer))) {
    return;
  }
  throw new UsageError(
    "organization not set\n\nSet it with:\n" +
      setItWith.map((line) => `  ${line}`).join("\n"),
  );
}
