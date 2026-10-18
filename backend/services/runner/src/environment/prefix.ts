/**
 * Where the agent's Environment packages install, and the folders of it the
 * agent's PATH gains (`install.ts` installs there; `agent-host/environment.ts`
 * puts them first on the host's PATH). Kept apart from the install so the
 * agent host's import graph stays as small as its boot needs.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { agentIdentity, type AgentIdentity } from "../shared/agent-identity.js";

/** Where a separating runner installs the agent's packages. */
export const ENVIRONMENT_PREFIX = "/opt/stigmer/environment";

/** The prefix the agent's packages install into: the shared one when the runner separates, else under this user's home. */
export function environmentPrefix(identity: AgentIdentity | null = agentIdentity()): string {
  return identity !== null ? ENVIRONMENT_PREFIX : join(homedir(), ".stigmer", "environment");
}

/** The directories the agent's PATH gains, first: the Python venv's, then the shared bin. */
export function environmentPathEntries(prefix: string): readonly string[] {
  return [join(prefix, "python", "bin"), join(prefix, "bin")];
}
