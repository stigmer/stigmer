/**
 * Who the agent host runs as (`shared/agent-identity.ts`).
 *
 * Pinned:
 *  - only root on Linux in a container shape (the start script's marker)
 *    separates; a local runner, a non-root one, macOS and a runner started
 *    without the layer do not;
 *  - the agent's home is `STIGMER_AGENT_HOME` when set, else the default;
 *  - the agent user and group are appended when missing, left alone when
 *    present, and an id another account holds is refused;
 *  - the agent's state lives under the agent's home when the runner
 *    separates, else under this process's `HOME`;
 *  - a separating runner is ready only when the user, its home and a
 *    `setpriv` drop all work, and each failure is one line naming its fix.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_GID,
  AGENT_UID,
  DEFAULT_AGENT_HOME,
  agentIdentity,
  agentStateHome,
  ensureAgentUser,
  prepareAgentSeparation,
  setprivArgs,
} from "../agent-identity.js";

const layer = { STIGMER_RUNNER_LAYER: "1" };

describe("whether the runner separates", () => {
  it("separates only as root on Linux in a container shape", () => {
    expect(agentIdentity({ platform: "linux", uid: 0, env: layer })).toEqual({ name: "stigmer-agent", uid: AGENT_UID, gid: AGENT_GID, home: DEFAULT_AGENT_HOME });
    expect(agentIdentity({ platform: "linux", uid: 0, env: {} }), "no layer: a local runner").toBeNull();
    expect(agentIdentity({ platform: "linux", uid: 1000, env: layer }), "not root").toBeNull();
    expect(agentIdentity({ platform: "darwin", uid: 0, env: layer }), "not Linux").toBeNull();
    expect(agentIdentity({ platform: "win32", uid: undefined, env: layer }), "no uids").toBeNull();
  });

  it("homes the agent where the deployment names, else at the default", () => {
    expect(agentIdentity({ platform: "linux", uid: 0, env: { ...layer, STIGMER_AGENT_HOME: "/data/agent" } })?.home).toBe("/data/agent");
    expect(agentIdentity({ platform: "linux", uid: 0, env: { ...layer, STIGMER_AGENT_HOME: "  " } })?.home).toBe(DEFAULT_AGENT_HOME);
  });
});

describe("the agent user on a base image the operator brings", () => {
  function files(passwd: string, group: string): { readonly passwd: string; readonly group: string } {
    const dir = mkdtempSync(join(tmpdir(), "agent-identity-"));
    writeFileSync(join(dir, "passwd"), passwd);
    writeFileSync(join(dir, "group"), group);
    return { passwd: join(dir, "passwd"), group: join(dir, "group") };
  }
  const identity = { name: "stigmer-agent", uid: AGENT_UID, gid: AGENT_GID, home: "/home/stigmer-agent" };

  it("adds the user and the group when they are missing, and only once", () => {
    const f = files("root:x:0:0:root:/root:/bin/bash", "root:x:0:\n");
    ensureAgentUser(identity, f);
    ensureAgentUser(identity, f);
    expect(readFileSync(f.passwd, "utf8")).toBe("root:x:0:0:root:/root:/bin/bash\nstigmer-agent:x:10001:10001:Stigmer agent:/home/stigmer-agent:/bin/bash\n");
    expect(readFileSync(f.group, "utf8")).toBe("root:x:0:\nstigmer-agent:x:10001:\n");
  });

  it("refuses an agent account whose ids are not the ones the runner starts it as", () => {
    expect(() => ensureAgentUser(identity, files("root:x:0:0::/root:/bin/sh\nstigmer-agent:x:1500:1500::/home/stigmer-agent:/bin/sh\n", "root:x:0:\nstigmer-agent:x:10001:\n"))).toThrow(
      "gives stigmer-agent id 1500; the runner starts the agent as 10001, so the account must have that id",
    );
  });

  it("refuses an id another account already holds", () => {
    expect(() => ensureAgentUser(identity, files("root:x:0:0::/root:/bin/sh\nsomeone:x:10001:10001::/home/someone:/bin/sh\n", "root:x:0:\n"))).toThrow(
      "already gives id 10001 to someone; the agent user stigmer-agent needs it for its own",
    );
  });
});

/** `CapEff` with SETUID, SETGID, CHOWN, KILL and DAC_OVERRIDE, as every shipped shape grants (bits 7, 6, 0, 5, 1). */
const ALL_FOUR = "Name:\tnode\nCapEff:\t00000000000000e3\n";

describe("the agent's state and the drop to it", () => {
  const identity = { name: "stigmer-agent", uid: AGENT_UID, gid: AGENT_GID, home: "/data/agent" };

  it("keeps the agent's state under its home when the runner separates, else under HOME", () => {
    expect(agentStateHome({ platform: "linux", uid: 0, env: { ...layer, HOME: "/root", STIGMER_AGENT_HOME: "/data/agent" } })).toBe("/data/agent");
    expect(agentStateHome({ platform: "darwin", uid: 501, env: { HOME: "/Users/me" } })).toBe("/Users/me");
  });

  it("drops with the measured flags: the agent's ids, no groups, no inheritable capabilities, no new privileges", () => {
    expect(setprivArgs(identity)).toEqual(["--reuid=10001", "--regid=10001", "--clear-groups", "--inh-caps=-all", "--no-new-privs"]);
  });

  it("is ready only when the user, its home and a setpriv drop all work", () => {
    const steps: string[] = [];
    const ok = { processStatus: () => ALL_FOUR, ensureUser: () => void steps.push("user"), makeHome: () => void steps.push("home"), probe: (args: readonly string[]) => (steps.push(args.join(" ")), { status: 0, stderr: "" }) };
    expect(prepareAgentSeparation(identity, ok)).toBeNull();
    expect(steps).toEqual(["user", "home", "--reuid=10001 --regid=10001 --clear-groups --inh-caps=-all --no-new-privs -- true"]);
  });

  it("refuses, with its one line, on a process that is not a root runner holding the four capabilities", () => {
    // This test's process is that: no /proc at all on macOS, no capabilities
    // as a Linux user, so the real check refuses either way.
    expect(prepareAgentSeparation(identity)).toMatch(/^the runner (cannot read its own capabilities|lacks the SETUID, SETGID, CHOWN, KILL, DAC_OVERRIDE capabilities) /);
    const home = join(mkdtempSync(join(tmpdir(), "agent-home-")), "agent");
    expect(prepareAgentSeparation({ ...identity, home }, { processStatus: () => ALL_FOUR, ensureUser: () => {} }), "no setpriv drop from here").toMatch(
      /^the runner cannot start processes as the agent user/,
    );
    expect(existsSync(home), "the home is made, still root's: the handover gives it away").toBe(true);
  });

  it("refuses, with its one line, a runner that cannot read its own capabilities", () => {
    expect(
      prepareAgentSeparation(identity, {
        processStatus: () => {
          throw new Error("ENOENT: /proc/self/status");
        },
      }),
    ).toMatch(/^the runner cannot read its own capabilities \(ENOENT: \/proc\/self\/status\); see /);
  });

  it("names the fix for each way it cannot drop", () => {
    const fine = { processStatus: () => ALL_FOUR, ensureUser: () => {}, makeHome: () => {} };
    expect(prepareAgentSeparation(identity, { ...fine, processStatus: () => "Name:\tnode\nCapEff:\t00000000000000c3\n" })).toMatch(
      /^the runner lacks the KILL capability it needs to run the agent as its own user \(SETUID, SETGID, CHOWN, KILL and DAC_OVERRIDE\); see /,
    );
    expect(prepareAgentSeparation(identity, { ...fine, processStatus: () => "CapEff:\t0000000000000000\n" })).toMatch(/^the runner lacks the SETUID, SETGID, CHOWN, KILL, DAC_OVERRIDE capabilities /);
    expect(prepareAgentSeparation(identity, { ...fine, probe: () => ({ status: null, error: new Error("spawnSync setpriv ENOENT"), stderr: "" }) })).toMatch(
      /^the runner cannot start processes as the agent user: setpriv is missing \(spawnSync setpriv ENOENT\); add util-linux's setpriv to the base image; see /,
    );
    expect(prepareAgentSeparation(identity, { ...fine, probe: () => ({ status: 1, stderr: "setpriv: setresuid failed: Operation not permitted\n" }) })).toMatch(
      /^the runner cannot start processes as the agent user \(setpriv: setresuid failed: Operation not permitted\); check the pod's or container's security settings; see /,
    );
    expect(
      prepareAgentSeparation(identity, {
        ...fine,
        ensureUser: () => {
          throw new Error("/etc/passwd already gives id 10001 to someone");
        },
      }),
    ).toMatch(/^the runner cannot prepare the agent user stigmer-agent: \/etc\/passwd already gives id 10001 to someone; see /);
  });
});
