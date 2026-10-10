/**
 * Who the agent host runs as (`shared/agent-identity.ts`).
 *
 * Pinned:
 *  - only root on Linux in a container shape (the start script's marker)
 *    separates; a local runner, a non-root one, macOS and a runner started
 *    without the layer do not;
 *  - the agent's home is `STIGMER_AGENT_HOME` when set, else the default;
 *  - the agent user and group are appended when missing, left alone when
 *    present, and an id another account holds is refused.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_GID, AGENT_UID, DEFAULT_AGENT_HOME, agentIdentity, ensureAgentUser } from "../agent-identity.js";

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

  it("refuses an id another account already holds", () => {
    expect(() => ensureAgentUser(identity, files("root:x:0:0::/root:/bin/sh\nsomeone:x:10001:10001::/home/someone:/bin/sh\n", "root:x:0:\n"))).toThrow(
      "already gives id 10001 to someone; the agent user stigmer-agent needs it for its own",
    );
  });
});
