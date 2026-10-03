// Whether the server the CLI talks to holds one organization, and the one
// guard every command that needs an organization runs.
//
// A server that holds one (the open-source edition: a laptop's `stigmer up`,
// a self-hosted install) makes it at its first start and fills it into every
// request that names none; its getServerInfo answers `single_org`. There the
// CLI never asks for, invents or prints an organization. A server that holds
// several refuses a request that names none, so a command that needs one says
// so first, with the ways to set it, instead of relaying the server's
// validation error.
//
// The answer is a fact about the server, asked once per client: concurrent
// askers share the pending answer, and a server that cannot answer (an older
// one, a fault) is treated as one that holds several, as it always was.
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/usage-error.js";

const answers = new WeakMap<Stigmer, Promise<boolean>>();

/** True when the server holds one organization and fills it into requests that name none. */
export function holdsOneOrganization(stigmer: Stigmer): Promise<boolean> {
  let answer = answers.get(stigmer);
  if (answer === undefined) {
    answer = Promise.resolve()
      .then(() => stigmer.platform.getServerInfo())
      .then((info) => info.singleOrg === true)
      .catch(() => false);
    answers.set(stigmer, answer);
  }
  return answer;
}

/**
 * Refuses an empty organization, but only on a server that needs one.
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
