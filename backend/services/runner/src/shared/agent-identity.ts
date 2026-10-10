/**
 * Who the agent host runs as (#2016): in a container shape, an unprivileged
 * agent user the runner's own files and process are closed to; everywhere
 * else, the runner's own user, as before.
 *
 * A runner separates when it runs as root on Linux in a container shape,
 * which the runner layer's start script marks (`layer/start.sh` exports
 * `STIGMER_RUNNER_LAYER=1`: every container driver, the chart, compose and
 * the attach waiter start the runner through it). A local runner (`stigmer
 * up`, the desktop app, the `local-process` driver) runs as the person
 * whose keys it holds, and does not separate.
 *
 * The agent user is `stigmer-agent`, uid and gid 10001. The sandbox image
 * creates it (`Dockerfile.sandbox`); on a base image the operator brings,
 * the runner adds it at boot ({@link ensureAgentUser}), so the start script
 * stays a checker that forks nothing. Its home is where the agent's state
 * persists in each shape: `STIGMER_AGENT_HOME` when the deployment names
 * one (the chart puts it on the runner's data volume), else
 * `/home/stigmer-agent`.
 */

import { appendFileSync, readFileSync } from "node:fs";

/** The agent user a separating runner starts its host as. */
export interface AgentIdentity {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly home: string;
}

export const AGENT_USER = "stigmer-agent";
export const AGENT_UID = 10001;
export const AGENT_GID = 10001;
export const DEFAULT_AGENT_HOME = "/home/stigmer-agent";

/** The marker the runner layer's start script exports. */
export const RUNNER_LAYER_ENV = "STIGMER_RUNNER_LAYER";

/** Where this process is: what decides whether it separates. */
export interface ProcessFacts {
  readonly platform: NodeJS.Platform;
  readonly uid: number | undefined;
  readonly env: NodeJS.ProcessEnv;
}

export function currentProcessFacts(): ProcessFacts {
  return { platform: process.platform, uid: typeof process.getuid === "function" ? process.getuid() : undefined, env: process.env };
}

/** The agent user this runner starts its host as, or `null` when the host runs as the runner's own user. */
export function agentIdentity(facts: ProcessFacts = currentProcessFacts()): AgentIdentity | null {
  if (facts.platform !== "linux" || facts.uid !== 0 || facts.env[RUNNER_LAYER_ENV] !== "1") return null;
  const home = facts.env.STIGMER_AGENT_HOME?.trim() || DEFAULT_AGENT_HOME;
  return { name: AGENT_USER, uid: AGENT_UID, gid: AGENT_GID, home };
}

/**
 * Add the agent user and group to `/etc/passwd` and `/etc/group` when a
 * base image does not have them (the sandbox image does). Lines are only
 * appended, never rewritten; an existing entry of that name or id is left
 * as it is, and an id taken by another name is refused, since the agent
 * would then share that account's files.
 */
export function ensureAgentUser(identity: AgentIdentity, files: { readonly passwd: string; readonly group: string } = { passwd: "/etc/passwd", group: "/etc/group" }): void {
  const ensure = (file: string, line: string, id: number): void => {
    const existing = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
    for (const entry of existing) {
      const [name, , entryId] = entry.split(":");
      if (name === identity.name) return;
      if (entryId === String(id)) {
        throw new Error(`${file} already gives id ${id} to ${name}; the agent user ${identity.name} needs it for its own`);
      }
    }
    const raw = readFileSync(file, "utf8");
    appendFileSync(file, `${raw.length > 0 && !raw.endsWith("\n") ? "\n" : ""}${line}\n`);
  };
  ensure(files.group, `${identity.name}:x:${identity.gid}:`, identity.gid);
  ensure(files.passwd, `${identity.name}:x:${identity.uid}:${identity.gid}:Stigmer agent:${identity.home}:/bin/bash`, identity.uid);
}
