/**
 * The one-time handover of the agent's files (`shared/agent-handover.ts`),
 * on a real tree, with the ownership change recorded (a test cannot give
 * files to another user).
 *
 * Pinned:
 *  - a session's state moves from the runner's `~/.stigmer` into the
 *    agent's, contents intact, and a name the agent's home already holds is
 *    left where it is;
 *  - every entry of the agent's state and of the workspace root is handed
 *    over, a link changed itself and its target never reached;
 *  - a workspace root inside the runner's state has the directories above
 *    it made traversable but not listable;
 *  - nothing in the agent's home is the agent's while the walk works in it:
 *    the home is taken back before anything is written in it, and every
 *    directory is handed over after its contents;
 *  - an agent home that would hold the runner's own files (its home's
 *    ancestor, or a place inside its state) is refused before anything moves;
 *  - the marker makes it run once: a later boot only hands over the agent's
 *    home and the workspace root themselves;
 *  - a move across filesystems copies, then removes; a workspace root
 *    outside the runner's state has no directories closed above it, and
 *    an agent's home without state yet is left as it is.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// renameSync passes through, but a test can make it cross filesystems once.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import { HANDOVER_MARKER, handOverToAgent } from "../agent-handover.js";

const identity = { name: "stigmer-agent", uid: 10001, gid: 10001, home: "" };

function tree() {
  const base = mkdtempSync(join(tmpdir(), "agent-handover-"));
  const runnerHome = join(base, "data");
  const agentHome = join(runnerHome, "agent");
  const workspaceRoot = join(runnerHome, ".stigmer", "data", "workspace");
  mkdirSync(join(runnerHome, ".stigmer", "sessions", "ses-1", "platform"), { recursive: true });
  writeFileSync(join(runnerHome, ".stigmer", "sessions", "ses-1", "checkpoints.db"), "checkpoints");
  mkdirSync(join(runnerHome, ".stigmer", "workspace-locks"), { recursive: true });
  mkdirSync(join(workspaceRoot, "sessions", "ses-1"), { recursive: true });
  writeFileSync(join(workspaceRoot, "sessions", "ses-1", "README.md"), "work");
  const outside = join(base, "outside.txt");
  writeFileSync(outside, "not the agent's");
  symlinkSync(outside, join(workspaceRoot, "sessions", "ses-1", "link"));
  return { runnerHome, agentHome, workspaceRoot, outside, who: { ...identity, home: agentHome } };
}

describe("handing the agent's files to the agent user", () => {
  it("moves the session state, hands every entry over without following links, and closes the runner's directories above the workspace", () => {
    const t = tree();
    const chowned: string[] = [];
    const result = handOverToAgent(t.who, { runnerHome: t.runnerHome, workspaceRoot: t.workspaceRoot }, { chown: (path) => void chowned.push(path) });

    expect(result).toEqual({ moved: ["sessions"], firstTime: true });
    expect(readFileSync(join(t.agentHome, ".stigmer", "sessions", "ses-1", "checkpoints.db"), "utf8")).toBe("checkpoints");
    expect(existsSync(join(t.runnerHome, ".stigmer", "sessions"))).toBe(false);
    expect(existsSync(join(t.runnerHome, ".stigmer", "workspace-locks")), "the runner's own state stays").toBe(true);

    expect(chowned).toContain(join(t.agentHome, ".stigmer", "sessions", "ses-1", "checkpoints.db"));
    expect(chowned).toContain(join(t.workspaceRoot, "sessions", "ses-1", "README.md"));
    expect(chowned).toContain(join(t.workspaceRoot, "sessions", "ses-1", "link"));
    expect(chowned, "a link's target is never reached").not.toContain(t.outside);
    expect(chowned.filter((path) => path.includes("workspace-locks"))).toEqual([]);

    expect(statSync(join(t.runnerHome, ".stigmer")).mode & 0o777).toBe(0o711);
    expect(statSync(join(t.runnerHome, ".stigmer", "data")).mode & 0o777).toBe(0o711);
    expect(existsSync(join(t.runnerHome, ".stigmer", HANDOVER_MARKER))).toBe(true);
  });

  it("runs once: a later boot hands over only the agent's home and the workspace root themselves", () => {
    const t = tree();
    handOverToAgent(t.who, { runnerHome: t.runnerHome, workspaceRoot: t.workspaceRoot }, { chown: () => {} });
    const chowned: string[] = [];
    expect(handOverToAgent(t.who, { runnerHome: t.runnerHome, workspaceRoot: t.workspaceRoot }, { chown: (path) => void chowned.push(path) })).toEqual({ moved: [], firstTime: false });
    expect(chowned).toEqual([t.agentHome, t.workspaceRoot]);
  });

  it("takes the agent's home back before writing in it, and hands each directory over after its contents", () => {
    const t = tree();
    mkdirSync(t.agentHome, { recursive: true });
    const calls: string[] = [];
    handOverToAgent(t.who, { runnerHome: t.runnerHome, workspaceRoot: t.workspaceRoot }, { chown: (path, uid) => void calls.push(`${uid} ${path}`) });
    const state = join(t.agentHome, ".stigmer");
    expect(calls[0], "the home is root's before the state moves in").toBe(`0 ${t.agentHome}`);
    expect(calls.indexOf(`10001 ${join(state, "sessions", "ses-1", "checkpoints.db")}`)).toBeLessThan(calls.indexOf(`10001 ${state}`));
    expect(calls.indexOf(`10001 ${state}`)).toBeLessThan(calls.indexOf(`10001 ${t.agentHome}`));
    for (const dir of [t.agentHome, state, t.workspaceRoot]) {
      expect(calls.indexOf(`0 ${dir}`), `${dir} is listed as root's`).toBeLessThan(calls.indexOf(`10001 ${dir}`));
    }
  });

  it("leaves a name the agent's home already holds where it is", () => {
    const t = tree();
    mkdirSync(join(t.agentHome, ".stigmer", "sessions"), { recursive: true });
    const result = handOverToAgent(t.who, { runnerHome: t.runnerHome, workspaceRoot: t.workspaceRoot }, { chown: () => {} });
    expect(result.moved).toEqual([]);
    expect(existsSync(join(t.runnerHome, ".stigmer", "sessions", "ses-1", "checkpoints.db"))).toBe(true);
  });
});

describe("handing over across filesystems and outside the runner's state", () => {
  it("copies the session state, then removes it, when the agent's home is on another filesystem", () => {
    const t = tree();
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
    });
    expect(handOverToAgent(t.who, { runnerHome: t.runnerHome, workspaceRoot: t.workspaceRoot }, { chown: () => {} }).moved).toEqual(["sessions"]);
    expect(readFileSync(join(t.agentHome, ".stigmer", "sessions", "ses-1", "checkpoints.db"), "utf8")).toBe("checkpoints");
    expect(existsSync(join(t.runnerHome, ".stigmer", "sessions"))).toBe(false);
  });

  it("refuses a move that fails for another reason", () => {
    const t = tree();
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    });
    expect(() => handOverToAgent(t.who, { runnerHome: t.runnerHome, workspaceRoot: t.workspaceRoot }, { chown: () => {} })).toThrow("EACCES");
  });

  it("closes no directory above a workspace root outside the runner's state", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-handover-driver-"));
    const runnerHome = join(base, "root");
    const workspaceRoot = join(base, "workspace");
    mkdirSync(join(runnerHome, ".stigmer"), { recursive: true });
    const chowned: string[] = [];
    const who = { ...identity, home: join(base, "home", "stigmer-agent") };
    expect(handOverToAgent(who, { runnerHome, workspaceRoot }, { chown: (path) => void chowned.push(path) })).toEqual({ moved: [], firstTime: true });
    expect(chowned).toContain(workspaceRoot);
    expect(statSync(join(runnerHome, ".stigmer")).mode & 0o777, "nothing above the workspace is the runner's").not.toBe(0o711);
  });

  it("refuses the default workspace under a runner home the agent cannot pass, naming WORKSPACE_ROOT_DIR", () => {
    // A driver's HOME is /root, 0700: the default ~/.stigmer/workspaces/runner
    // under it would be a workspace the agent cannot open.
    const base = mkdtempSync(join(tmpdir(), "agent-handover-closed-"));
    const runnerHome = join(base, "root");
    const workspaceRoot = join(runnerHome, ".stigmer", "workspaces", "runner");
    mkdirSync(runnerHome, { mode: 0o700 });
    chmodSync(runnerHome, 0o700);
    const who = { ...identity, home: join(base, "home", "stigmer-agent") };
    expect(() => handOverToAgent(who, { runnerHome, workspaceRoot }, { chown: () => {} })).toThrow(
      `the workspace root ${workspaceRoot} is out of the agent's reach: ${runnerHome} (mode 0700) is closed to it; set WORKSPACE_ROOT_DIR to a directory outside the runner's home`,
    );
    chmodSync(runnerHome, 0o755);
    expect(handOverToAgent(who, { runnerHome, workspaceRoot }, { chown: () => {} }).firstTime).toBe(true);
  });

  it("refuses an agent home that would hold the runner's own files, above its home or inside its state", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-handover-enclosing-"));
    const runnerHome = join(base, "data");
    const refusal = `would hold the runner's own files (${join(runnerHome, ".stigmer")}); set STIGMER_AGENT_HOME to a directory of the agent's own, outside the runner's state`;
    for (const home of ["/", base, join(runnerHome, ".stigmer", "agent")]) {
      expect(() => handOverToAgent({ ...identity, home }, { runnerHome, workspaceRoot: join(base, "workspace") }, { chown: () => {} }), home).toThrow(refusal);
    }
    expect(existsSync(join(base, "workspace")), "refused before anything is made").toBe(false);
  });

  it("refuses an agent home that is the runner's own", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-handover-shared-"));
    expect(() => handOverToAgent({ ...identity, home: base }, { runnerHome: base, workspaceRoot: join(base, "workspace") }, { chown: () => {} })).toThrow(
      "the agent's home (" + base + ") is the runner's own; set STIGMER_AGENT_HOME to a directory of the agent's own",
    );
  });

  it("walks nothing on a sandbox's wake: no state to move, and a workspace that is the agent's already", () => {
    // The runner's home does not persist in a sandbox, so its marker is gone
    // at every wake; the workspace claim, the agent's since the first boot,
    // is what says the handover ran.
    const base = mkdtempSync(join(tmpdir(), "agent-handover-wake-"));
    const workspaceRoot = join(base, "workspace");
    mkdirSync(join(workspaceRoot, "node_modules", "deep"), { recursive: true });
    const owner = { ...identity, uid: process.getuid!(), gid: process.getgid!(), home: join(base, "agent") };
    const chowned: string[] = [];
    expect(handOverToAgent(owner, { runnerHome: join(base, "root"), workspaceRoot }, { chown: (path) => void chowned.push(path) })).toEqual({ moved: [], firstTime: false });
    expect(chowned).toEqual([owner.home, workspaceRoot]);
  });
});
