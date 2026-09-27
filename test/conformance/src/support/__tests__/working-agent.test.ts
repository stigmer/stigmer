// Unit arms for the working agent's fixture and seeding, with no server.
// Domain: conformance support.
//
// Pinned: the fixture carries exactly eight skills, the count at which the
// native harness starts choosing by relevance; each skill's frontmatter name
// is its directory's (the server names a pushed skill from the frontmatter,
// so a mismatch would push a skill the agent's references never find) and
// carries a description (what the relevance filter reads); seeding copies
// the workspace byte for byte into a fresh directory and replaces a
// previous session's edits; a directory that is not named for the workspace
// is refused, so a wrong argument can never empty an unrelated tree; the
// session bootstrap mounts that one workspace.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles } from "../../benchmark/workspace-facts";
import {
  seedWorkingWorkspace,
  WORKING_AGENT_FIXTURE_DIR,
  WORKING_AGENT_WORKSPACE_NAME,
  workingAgentSessionSpec,
  workingAgentSkillNames,
} from "../working-agent";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "working-agent-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("the working agent's skills", () => {
  it("are eight, each named in its frontmatter as its directory is, each with a description", async () => {
    const names = await workingAgentSkillNames();
    expect(names).toHaveLength(8);
    for (const name of names) {
      const skillMd = await readFile(join(WORKING_AGENT_FIXTURE_DIR, "skills", name, "SKILL.md"), "utf8");
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skillMd)?.[1] ?? "";
      expect(frontmatter, name).toMatch(new RegExp(`^name: ${name}$`, "m"));
      expect(frontmatter, name).toMatch(/^description: \S/m);
    }
  });
});

describe("seedWorkingWorkspace", () => {
  it("copies the fixture workspace byte for byte, and replaces a previous session's edits", async () => {
    const dir = join(base, WORKING_AGENT_WORKSPACE_NAME);
    await seedWorkingWorkspace(dir);
    expect(await changedFiles(join(WORKING_AGENT_FIXTURE_DIR, "workspace"), dir)).toEqual([]);

    await writeFile(join(dir, "NOTES.md"), "left by the last session\n");
    await writeFile(join(dir, "go.mod"), "module edited\n");
    await seedWorkingWorkspace(dir);
    expect(await changedFiles(join(WORKING_AGENT_FIXTURE_DIR, "workspace"), dir)).toEqual([]);
  });

  it("refuses a directory not named for the workspace", async () => {
    await expect(seedWorkingWorkspace(join(base, "home"))).rejects.toThrow(`is named ${WORKING_AGENT_WORKSPACE_NAME}`);
  });
});

describe("workingAgentSessionSpec", () => {
  it("bootstraps the session on the harness asked for, with the one workspace mounted by host path", () => {
    const spec = workingAgentSessionSpec(
      { org: "org", agentId: "agt_1", workspace: { name: WORKING_AGENT_WORKSPACE_NAME, path: "/tmp/x/orders-sync" }, mcpServerSlug: "orders-api", skillSlugs: [] },
      Harness.CURSOR,
      "harness benchmark",
    );
    expect(spec).toEqual({
      harness: Harness.CURSOR,
      subject: "harness benchmark",
      workspaceEntries: [
        { name: WORKING_AGENT_WORKSPACE_NAME, source: { source: { case: "localPath", value: { path: "/tmp/x/orders-sync" } } } },
      ],
    });
  });
});
