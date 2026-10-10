/**
 * The separation, proved in a Linux container (#2016): a process the runner
 * starts as the agent user can read none of the runner's secrets, by any
 * path an agent's command would try.
 *
 * The container runs as root with the capability set every shape ships
 * (all dropped but SETUID, SETGID, CHOWN and KILL; no-new-privileges). A
 * stand-in runner holds canaries where the runner holds its keys: under
 * each of the runner's secret names in its environment, a cloud credential
 * beside them, a state file only root reads, and code only root writes. It
 * starts the probe exactly as the supervisor starts the agent host: through
 * `setpriv` with `setprivArgs` (`shared/agent-identity.ts`), in the
 * environment `agentHostEnvironment` gives a separating runner's host
 * (`agent-host/environment.ts`).
 *
 * Pinned, as the agent: the runner's `/proc/<pid>/environ` and `mem`, its
 * state file, a link planted into `/proc/<runner>`, rewriting its code, and
 * `su` are all refused, and no canary is in the agent's own environment;
 * and the runner can still end that process (a host that will not exit).
 * Red first, in the same container: the same probe started without the drop
 * reads the canaries from `/proc`.
 *
 * It needs Docker and the Node image, so it runs only when
 * `STIGMER_TEST_CONTAINER=1` (the runner lane sets it); elsewhere it skips.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { agentHostEnvironment } from "../agent-host/environment.js";
import { AGENT_GID, AGENT_UID, setprivArgs } from "../shared/agent-identity.js";
import { RUNNER_SECRET_ENV_KEYS } from "../shared/runner-credential-keys.js";

const IMAGE = "node:22.22.1-bookworm";
const RUN = process.env.STIGMER_TEST_CONTAINER === "1";

const CANARY = "canary-7f3e";
const runnerEnv: Record<string, string> = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  ...Object.fromEntries(RUNNER_SECRET_ENV_KEYS.map((name) => [name, `${CANARY}-${name}`])),
  AWS_SECRET_ACCESS_KEY: `${CANARY}-aws`,
};

/** The stand-in runner: root, holding the canaries, starting the probe as the supervisor starts the host. */
const RUNNER_SCRIPT = `
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const plan = JSON.parse(readFileSync("/proof/plan.json", "utf8"));
mkdirSync("/runner-state", { mode: 0o700 });
writeFileSync("/runner-state/key", "${CANARY}-state", { mode: 0o600 });
mkdirSync("/runner-code", { mode: 0o755 });
writeFileSync("/runner-code/main.js", "// the runner", { mode: 0o644 });
spawnSync("groupadd", ["--gid", "${AGENT_GID}", "stigmer-agent"]);
spawnSync("useradd", ["--uid", "${AGENT_UID}", "--gid", "${AGENT_GID}", "--no-create-home", "stigmer-agent"]);
const probe = [process.execPath, "/proof/agent.mjs", String(process.pid)];
const command = process.argv[2] === "separated" ? ["setpriv", ...plan.setpriv, "--", ...probe] : probe;
const result = spawnSync(command[0], command.slice(1), { env: plan.env, encoding: "utf8" });
const sleeper = spawn("setpriv", [...plan.setpriv, "--", "sleep", "30"], { stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 300));
let killed;
try {
  process.kill(sleeper.pid, "SIGKILL");
  killed = await new Promise((resolve) => sleeper.once("exit", (_code, signal) => resolve(signal)));
} catch (err) {
  killed = err.code;
}
const report = JSON.parse(result.stdout.trim().split("\\n").at(-1));
process.stdout.write(JSON.stringify({ ...report, runnerKillsAgent: killed }) + "\\n");
process.stderr.write(result.stderr);
`;

/** The agent: every path a command would try to the runner's secrets. */
const AGENT_SCRIPT = `
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
const runner = process.argv[2];
const attempts = { uid: process.getuid() };
const attempt = (name, f) => {
  try {
    attempts[name] = { ok: true, text: String(f()) };
  } catch (err) {
    attempts[name] = { ok: false, error: err.code ?? String(err.message).slice(0, 200) };
  }
};
attempt("runnerEnviron", () => readFileSync("/proc/" + runner + "/environ", "latin1"));
attempt("runnerMem", () => (closeSync(openSync("/proc/" + runner + "/mem", "r")), "opened"));
attempt("runnerState", () => readFileSync("/runner-state/key", "utf8"));
attempt("linkIntoProc", () => (symlinkSync("/proc/" + runner, "/tmp/d"), readFileSync("/tmp/d/environ", "latin1")));
attempt("rewriteRunnerCode", () => (writeFileSync("/runner-code/main.js", "planted"), "written"));
attempt("su", () => execFileSync("su", ["-c", "id", "root"], { stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }).toString());
attempts.ownEnvironment = JSON.stringify(process.env);
console.log(JSON.stringify(attempts));
`;

interface Attempt {
  readonly ok: boolean;
  readonly text?: string;
  readonly error?: string;
}

function runProof(mode: "separated" | "shared"): Record<string, Attempt> & { readonly uid: number; readonly ownEnvironment: string; readonly runnerKillsAgent: string } {
  const dir = mkdtempSync(join(tmpdir(), "agent-separation-"));
  writeFileSync(join(dir, "runner.mjs"), RUNNER_SCRIPT);
  writeFileSync(join(dir, "agent.mjs"), AGENT_SCRIPT);
  const identity = { name: "stigmer-agent", uid: AGENT_UID, gid: AGENT_GID, home: "/home/stigmer-agent" };
  writeFileSync(join(dir, "plan.json"), JSON.stringify({ setpriv: setprivArgs(identity), env: { ...agentHostEnvironment(runnerEnv, true), HOME: identity.home } }));
  const env = Object.entries(runnerEnv).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
  const result = spawnSync(
    "docker",
    [
      "run", "--rm",
      "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "CHOWN", "--cap-add", "KILL",
      "--security-opt", "no-new-privileges",
      "--volume", `${dir}:/proof:ro`,
      ...env,
      IMAGE, "node", "/proof/runner.mjs", mode,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!) as never;
}

describe.skipIf(!RUN)("the agent user, in a container shaped as every runner ships", () => {
  it("reads none of the runner's secrets by any path a command would try", () => {
    const agent = runProof("separated");
    expect(agent.uid).toBe(AGENT_UID);
    for (const path of ["runnerEnviron", "runnerMem", "runnerState", "linkIntoProc", "rewriteRunnerCode", "su"] as const) {
      expect(agent[path]?.ok, `${path}: ${JSON.stringify(agent[path])}`).toBe(false);
    }
    expect(agent.ownEnvironment).not.toContain(CANARY);
    expect(agent.runnerKillsAgent, "the runner ends a host that will not exit").toBe("SIGKILL");
  }, 180_000);

  it("is red without the drop: the same probe, run as the runner's own user, reads the canaries", () => {
    const shared = runProof("shared");
    expect(shared.uid).toBe(0);
    expect(shared.runnerEnviron?.ok).toBe(true);
    expect(shared.runnerEnviron?.text).toContain(`${CANARY}-STIGMER_TOKEN`);
    expect(shared.runnerState?.ok).toBe(true);
  }, 180_000);
});
