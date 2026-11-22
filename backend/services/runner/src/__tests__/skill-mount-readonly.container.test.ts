/**
 * A conversation with a computer keeps its skills and plugins on disk for
 * its commands, read-only to them (stigmer#2588), proved in a Linux
 * container shaped as every separating runner ships: root with only SETUID,
 * SETGID, CHOWN, KILL and DAC_OVERRIDE, no-new-privileges, the agent's
 * commands as uid 10001 through `setpriv` (`shared/agent-identity.ts`).
 *
 * The runner's own tree code (`shared/archive-tree.ts`), bundled as it is,
 * runs as root: it caches a skill's archive on the agent's volume, unpacks
 * the skill and a plugin under `/runner/mounts/<session>`, and links them
 * into the platform folder the agent owns. Pinned, as the agent: a write to
 * a skill file, a new file in the tree, a removal, a mode change and a
 * write to a plugin's hook are all refused, while reading works; a command
 * that swaps the link for a folder of its own is undone at the next turn's
 * check; and after the image layer is cleared (a sandbox's wake) the next
 * turn unpacks again from the cached archive, with no download. Red first,
 * in the same container: the tree the agent owned before (the old mount)
 * takes the same write.
 *
 * It needs Docker and the Node image, so it runs only when
 * `STIGMER_TEST_CONTAINER=1` (the runner lane sets it); elsewhere it skips.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AGENT_GID, AGENT_UID, setprivArgs } from "../shared/agent-identity.js";

const IMAGE = "node:22.22.1-bookworm";
const RUN = process.env.STIGMER_TEST_CONTAINER === "1";
const RUNNER = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_TREE = join(RUNNER, "src", "shared", "archive-tree.ts");

/** The stand-in runner: root, mounting through the real tree code, probing as the agent. */
const PROOF_SCRIPT = `
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { cachedArchive, keepArchive, placeArchiveTree, pluginTreeKey, skillTreeKey } from ${JSON.stringify(ARCHIVE_TREE)};

const mode = process.argv[2];
const plan = JSON.parse(fs.readFileSync("/proof/plan.json", "utf8"));
spawnSync("groupadd", ["--gid", "${AGENT_GID}", "stigmer-agent"]);
spawnSync("useradd", ["--uid", "${AGENT_UID}", "--gid", "${AGENT_GID}", "--no-create-home", "stigmer-agent"]);
const enc = (text) => new TextEncoder().encode(text);
const asAgent = (command) => spawnSync("setpriv", [...plan.setpriv, "--", "sh", "-c", command], { encoding: "utf8" });
const tried = (command) => ({ ok: asAgent(command).status === 0 });

const home = "/data/agent";
const platform = home + "/platform";
fs.mkdirSync(home, { recursive: true });
fs.chownSync(home, ${AGENT_UID}, ${AGENT_GID});
asAgent("mkdir -p " + platform + "/skills " + platform + "/plugins " + platform + "/archives");

const skill = platform + "/skills/notes";
const plugin = platform + "/plugins/" + "d".repeat(64);
const skillEntries = [{ path: "SKILL.md", content: enc("# Pushed") }, { path: "scripts/run.sh", content: enc("#!/bin/sh\\necho ok\\n") }];
const pluginEntries = [{ path: "hooks/check", content: enc("#!/bin/sh\\nexit 0\\n") }];
const report = { mode };

if (mode === "agent-owned") {
  // The old mount: the tree written with the agent's rights.
  asAgent("mkdir -p " + skill + " && printf '# Pushed' > " + skill + "/SKILL.md");
  report.writeSkill = tried("printf edited > " + skill + "/SKILL.md");
  process.stdout.write(JSON.stringify(report) + "\\n");
  process.exit(0);
}

const archive = enc("the skill's archive bytes");
const sha = createHash("sha256").update(archive).digest("hex");
let downloads = 0;
const download = async () => (downloads += 1, archive);
const turn = async () => {
  const bytes = await cachedArchive(platform, sha, download);
  await keepArchive(platform, sha, bytes, true);
  const skillTree = await placeArchiveTree({ linkPath: skill, sessionId: "ses-1", key: skillTreeKey(sha, "# Pushed"), entries: skillEntries, label: "skill artifact" });
  const pluginTree = await placeArchiveTree({ linkPath: plugin, sessionId: "ses-1", key: pluginTreeKey("d".repeat(64)), entries: pluginEntries, label: "plugin archive" });
  return { skillTree, pluginTree };
};

const first = await turn();
const treeDir = fs.readlinkSync(skill);
report.link = treeDir;
report.treeOwner = fs.statSync(treeDir).uid;
report.modes = { skillMd: fs.statSync(treeDir + "/SKILL.md").mode & 0o777, script: fs.statSync(treeDir + "/scripts/run.sh").mode & 0o777 };
report.readSkill = asAgent("cat " + skill + "/SKILL.md").stdout;
report.writeSkill = tried("printf edited > " + skill + "/SKILL.md");
report.addFile = tried("printf planted > " + skill + "/planted.md");
report.removeFile = tried("rm -f " + skill + "/scripts/run.sh");
report.chmodFile = tried("chmod 777 " + skill + "/SKILL.md");
report.writeHook = tried("printf 'exit 1' > " + plugin + "/hooks/check");
report.writeTreeDirect = tried("printf edited > " + treeDir + "/SKILL.md");

report.swap = tried("rm " + skill + " && mkdir " + skill + " && printf forged > " + skill + "/SKILL.md");
report.swappedRead = fs.readFileSync(skill + "/SKILL.md", "utf8");
await first.skillTree.verify();
report.afterCheck = { isLink: fs.lstatSync(skill).isSymbolicLink(), read: fs.readFileSync(skill + "/SKILL.md", "utf8") };

// A wake: the image layer under /runner is fresh; the agent's volume is kept.
fs.rmSync("/runner/mounts", { recursive: true, force: true });
await turn();
report.afterWake = { read: fs.readFileSync(skill + "/SKILL.md", "utf8"), downloads };
process.stdout.write(JSON.stringify(report) + "\\n");
`;

interface Tried {
  readonly ok: boolean;
}

interface Report {
  readonly mode: string;
  readonly link?: string;
  readonly treeOwner?: number;
  readonly modes?: { readonly skillMd: number; readonly script: number };
  readonly readSkill?: string;
  readonly writeSkill: Tried;
  readonly addFile?: Tried;
  readonly removeFile?: Tried;
  readonly chmodFile?: Tried;
  readonly writeHook?: Tried;
  readonly writeTreeDirect?: Tried;
  readonly swap?: Tried;
  readonly swappedRead?: string;
  readonly afterCheck?: { readonly isLink: boolean; readonly read: string };
  readonly afterWake?: { readonly read: string; readonly downloads: number };
}

function runProof(mode: "separated" | "agent-owned"): Report {
  const dir = mkdtempSync(join(tmpdir(), "skill-mount-readonly-"));
  chmodSync(dir, 0o755);
  writeFileSync(join(dir, "entry.mjs"), PROOF_SCRIPT);
  const bundled = spawnSync(
    join(RUNNER, "node_modules", ".bin", "esbuild"),
    [join(dir, "entry.mjs"), "--bundle", "--platform=node", "--format=esm", "--target=node22", `--outfile=${join(dir, "proof.mjs")}`, "--log-level=error"],
    { encoding: "utf8", cwd: RUNNER },
  );
  expect(bundled.status, bundled.stderr).toBe(0);
  const identity = { name: "stigmer-agent", uid: AGENT_UID, gid: AGENT_GID, home: "/data/agent" };
  writeFileSync(join(dir, "plan.json"), JSON.stringify({ setpriv: setprivArgs(identity) }));
  const result = spawnSync(
    "docker",
    [
      "run", "--rm",
      "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "CHOWN", "--cap-add", "KILL", "--cap-add", "DAC_OVERRIDE",
      "--security-opt", "no-new-privileges",
      "--volume", `${dir}:/proof:ro`,
      "--env", "STIGMER_RUNNER_LAYER=1",
      IMAGE, "node", "/proof/proof.mjs", mode,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!) as Report;
}

describe.skipIf(!RUN)("a mounted skill, in a container shaped as every separating runner ships", () => {
  it("is read-only to the agent's commands, undoes a swapped link, and unpacks again after a wake without a download", () => {
    const report = runProof("separated");
    expect(report.link).toMatch(/^\/runner\/mounts\/ses-1\/skill-[0-9a-f]{64}$/);
    expect(report.treeOwner).toBe(0);
    expect(report.modes).toEqual({ skillMd: 0o644, script: 0o755 });
    expect(report.readSkill, "the agent reads its skill").toBe("# Pushed");
    for (const write of ["writeSkill", "addFile", "removeFile", "chmodFile", "writeHook", "writeTreeDirect"] as const) {
      expect(report[write]?.ok, `${write} as the agent`).toBe(false);
    }
    expect(report.swap?.ok, "the agent owns the platform folder, so it can replace the link").toBe(true);
    expect(report.swappedRead).toBe("forged");
    expect(report.afterCheck, "the next turn's check puts the link back").toEqual({ isLink: true, read: "# Pushed" });
    expect(report.afterWake, "a wake unpacks again from the cached archive").toEqual({ read: "# Pushed", downloads: 1 });
  }, 180_000);

  it("is red with the old agent-owned mount: the same write lands", () => {
    expect(runProof("agent-owned").writeSkill.ok).toBe(true);
  }, 180_000);
});
