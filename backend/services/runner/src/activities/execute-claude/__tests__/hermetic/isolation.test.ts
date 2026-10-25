/**
 * Hermetic golden: what the Claude engine is built from, and what it never
 * reads, on the real engine.
 *
 * The engine is started from nothing (`engine-options.ts`, `engine-env.ts`):
 * no setting source, no plugin, no agent of its own, no auto memory, no
 * attribution instruction, no background tasks, and exactly the tools the
 * turn offers. A workspace that carries Claude Code's own project files
 * (`.claude/settings.json` with a hook, `.mcp.json` with a server,
 * `.claude/skills|agents|commands`, `CLAUDE.md`) must change none of that:
 * the hook never runs, the server never starts, and no skill, agent,
 * command or `CLAUDE.md` text reaches a model call. The repository's own
 * instructions reach the model only through the reading every engine shares
 * (`shared/repository-instructions.ts`: `AGENTS.md`, else `CLAUDE.md`), so
 * here `AGENTS.md` is read and `CLAUDE.md` is not.
 *
 * The engine's bundled skills are off (`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`,
 * `engine-env.ts`): its init lists none, none reaches a request, and a turn
 * with no skills has no Skill tool.
 *
 * Egress: every request the engine makes, its agent loop and its own token
 * counts alike, arrives on the proxy's Anthropic lane with the run's
 * execution id; the engine is pointed nowhere else.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { anthropicText, anthropicToolUses } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";

/** Skills the engine bundles (SDK 0.3.310, listed at init before the switch turned them off). */
const BUNDLED_SKILLS = ["deep-research", "dataviz", "update-config", "code-review", "fewer-permission-prompts", "claude-api", "workflow-authoring", "run-skill-generator"];

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

const AGENTS_MD_MARK = "AGENTS_MD_MARK_7f3a";
const CLAUDE_MD_MARK = "CLAUDE_MD_MARK_91c2";
const WORKSPACE_NAMES = ["workspace-skill-4b1e", "workspace-agent-55d0", "workspace-command-a9e3", "workspace-server-0c6f"] as const;

/** The tools a turn with no servers and no sub-agents offers, as the engine's first request names them. */
const OFFERED_IN_REQUEST = ["Bash", "DeferredToolPlaceholder", "Edit", "Glob", "Grep", "Read", "ToolSearch", "Write"];
/** The same turn's tools as the engine's init reports them, the deferred ones included. */
const OFFERED_AT_INIT = "Bash,Edit,Glob,Grep,NotebookEdit,Read,TodoWrite,ToolSearch,Write,mcp__stigmer__bash";

function seed(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

describe("ExecuteClaude hermetic — the engine reads nothing of its own", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("a workspace's Claude Code files change nothing, and only the shared repository reading reaches the model", async () => {
    const repo = join(env.workspaceRootDir, "repos", "seeded");
    const hookMarker = join(env.workspaceRootDir, "hook-ran");
    const serverMarker = join(env.workspaceRootDir, "server-started");
    seed(repo, {
      "AGENTS.md": `# Repository\n\n${AGENTS_MD_MARK}\n`,
      "CLAUDE.md": `# Claude\n\n${CLAUDE_MD_MARK}\n`,
      ".claude/settings.json": JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `touch '${hookMarker}'` }] }] },
        permissions: { allow: ["Bash(*)"] },
        enabledPlugins: { "seeded@market": true },
      }),
      ".mcp.json": JSON.stringify({
        mcpServers: { [WORKSPACE_NAMES[3]]: { command: "node", args: ["-e", `require("fs").writeFileSync(${JSON.stringify(serverMarker)}, "x")`] } },
      }),
      [`.claude/skills/${WORKSPACE_NAMES[0]}/SKILL.md`]: `---\nname: ${WORKSPACE_NAMES[0]}\ndescription: A seeded skill.\n---\nDo it.\n`,
      [`.claude/agents/${WORKSPACE_NAMES[1]}.md`]: `---\nname: ${WORKSPACE_NAMES[1]}\ndescription: A seeded agent.\n---\nYou help.\n`,
      [`.claude/commands/${WORKSPACE_NAMES[2]}.md`]: "Run the seeded command.\n",
    });
    const logged = vi.spyOn(console, "log");
    // A call, so a project hook would fire, that lists none of the seeded files.
    const record = claudeExecutionRecord({ message: "List the files.", resources: [localPathEntry("seeded", repo)] });

    const invocation = await file.run(record, (c) =>
      c.issued.has("toolu_iso_glob") ? anthropicText("Listed.") : anthropicToolUses([{ toolCallId: "toolu_iso_glob", toolName: "Glob", toolInput: { pattern: "**/*.none" } }]),
    );
    const init = logged.mock.calls.map((args) => String(args[0])).find((line) => line.includes("engine init:")) ?? "";
    logged.mockRestore();

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(existsSync(hookMarker), "the workspace's hook never ran").toBe(false);
    expect(existsSync(serverMarker), "the workspace's MCP server never started").toBe(false);

    expect(init).toContain(`tools=${OFFERED_AT_INIT} `);
    expect(init).toContain(" agents= plugins= ");
    const listed = (/ skills=(.*)$/.exec(init)?.[1] ?? "").split(",").filter((name) => name !== "");
    expect(listed.filter((name) => BUNDLED_SKILLS.includes(name)), "the engine lists none of its bundled skills").toEqual([]);

    const conversations = file.wire().conversations;
    expect(conversations.length).toBe(2);
    for (const conversation of conversations) {
      const body = JSON.stringify(conversation.body);
      expect([...conversation.toolNames].sort()).toEqual(OFFERED_IN_REQUEST);
      expect(conversation.system, "the repository's instructions, read as every engine reads them").toContain(AGENTS_MD_MARK);
      for (const absent of [CLAUDE_MD_MARK, ...WORKSPACE_NAMES, ...BUNDLED_SKILLS, "MEMORY.md", "auto memory", "Co-Authored-By", "Generated with"]) {
        expect(body.includes(absent), `'${absent}' reached a model call`).toBe(false);
      }
    }

    const requests = file.wire().requests();
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const request of requests) {
      expect(request.path).toMatch(/^\/v1\/proxy\/llm\/anthropic\/v1\/messages(\/count_tokens)?(\?|$)/);
      expect(request.headers["x-stigmer-execution-id"]).toBe(FIXTURE.executionId);
    }
  });
});
