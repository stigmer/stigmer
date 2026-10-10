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

import { spawnSync } from "node:child_process";
import { appendFileSync, lchownSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

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
 * Where the agent's state lives (`~/.stigmer/sessions`, the HITL gates): the
 * agent's home in a separating shape, else this process's `HOME`. The
 * runner names it for the paths it hands the host; the host, started with
 * that `HOME`, reads the same.
 */
export function agentStateHome(facts: ProcessFacts = currentProcessFacts()): string {
  return agentIdentity(facts)?.home ?? (facts.env.HOME || facts.env.USERPROFILE || homedir());
}

/**
 * The `setpriv` arguments that start a process as the agent: its uid and
 * gid, no supplementary groups, no inheritable capabilities, and
 * no-new-privileges, so no file capability or set-uid binary re-arms it
 * (measured in a container with only SETUID and SETGID: uid 10001, every
 * capability set empty, the runner's `/proc/<pid>/environ` refused).
 */
export function setprivArgs(identity: AgentIdentity): readonly string[] {
  return [`--reuid=${identity.uid}`, `--regid=${identity.gid}`, "--clear-groups", "--inh-caps=-all", "--no-new-privs"];
}

/**
 * The capabilities a separating runner needs, by their bit in the kernel's
 * capability sets: `SETUID` and `SETGID` to drop to the agent, `CHOWN` to
 * hand it its home and workspace, `KILL` to end a host that will not exit
 * (a process of another user cannot be signalled without it).
 */
export const RUNNER_CAPABILITY_BITS: ReadonlyMap<string, number> = new Map([
  ["SETUID", 7],
  ["SETGID", 6],
  ["CHOWN", 0],
  ["KILL", 5],
]);

/** The names in {@link RUNNER_CAPABILITY_BITS} that `/proc/self/status`'s `CapEff` line lacks. */
export function missingCapabilities(status: string): readonly string[] {
  const line = status.split("\n").find((l) => l.startsWith("CapEff:"));
  const effective = line === undefined ? 0n : BigInt(`0x${line.slice("CapEff:".length).trim()}`);
  return [...RUNNER_CAPABILITY_BITS].filter(([, bit]) => (effective & (1n << BigInt(bit))) === 0n).map(([name]) => name);
}

/**
 * Ready a separating runner to start its host as the agent: it holds the
 * capabilities that takes, the agent user exists, its home exists and is
 * the agent's (the directory itself, never followed or recursed), and
 * `setpriv` can drop to it. Returns `null` when
 * all hold, else the one line the runner exits 78 with: a container runner
 * never runs the agent's side as root.
 */
export function prepareAgentSeparation(
  identity: AgentIdentity,
  io: {
    readonly ensureUser?: (identity: AgentIdentity) => void;
    readonly makeHome?: (identity: AgentIdentity) => void;
    readonly probe?: (args: readonly string[]) => { readonly status: number | null; readonly error?: Error | undefined; readonly stderr: string };
    readonly processStatus?: () => string;
  } = {},
): string | null {
  const guide = "see docs/guides/self-hosting/runners.mdx (the agent user)";
  const missing = missingCapabilities((io.processStatus ?? (() => readFileSync("/proc/self/status", "utf8")))());
  if (missing.length > 0) {
    return `the runner lacks the ${missing.join(", ")} capabilit${missing.length === 1 ? "y" : "ies"} it needs to run the agent as its own user (SETUID, SETGID, CHOWN and KILL); ${guide}`;
  }
  try {
    (io.ensureUser ?? ensureAgentUser)(identity);
    (io.makeHome ?? makeAgentHome)(identity);
  } catch (err) {
    return `the runner cannot prepare the agent user ${identity.name}: ${err instanceof Error ? err.message : String(err)}; ${guide}`;
  }
  const probe = (io.probe ?? probeSetpriv)([...setprivArgs(identity), "--", "true"]);
  if (probe.error !== undefined) {
    return `the runner cannot start processes as the agent user: setpriv is missing (${probe.error.message}); add util-linux's setpriv to the base image; ${guide}`;
  }
  if (probe.status !== 0) {
    return `the runner cannot start processes as the agent user (${probe.stderr.trim() || `setpriv exited ${probe.status}`}); check the pod's or container's security settings; ${guide}`;
  }
  return null;
}

function makeAgentHome(identity: AgentIdentity): void {
  mkdirSync(identity.home, { recursive: true, mode: 0o700 });
  lchownSync(identity.home, identity.uid, identity.gid);
}

function probeSetpriv(args: readonly string[]): { readonly status: number | null; readonly error?: Error | undefined; readonly stderr: string } {
  const result = spawnSync("setpriv", [...args], { encoding: "utf8", timeout: 10_000 });
  return { status: result.status, error: result.error, stderr: result.stderr ?? "" };
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
