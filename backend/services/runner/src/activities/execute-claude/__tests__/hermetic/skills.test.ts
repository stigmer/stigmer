/**
 * Hermetic goldens: a Claude turn's skills, on the real engine, loaded
 * through its own Skill tool from the plugins the adapter writes
 * (`skill-plugins.ts`), held by the gate (`gate.ts`).
 *
 *  - The agent's own skills are named to the model from its first request,
 *    `agent:<skill>`, a dotted name by its slug with its own spelling beside
 *    it, and each loads by the Skill tool under either spelling: its body
 *    reaches the model, its header's hooks, tool grants and model never act,
 *    and its body's inline command never runs.
 *  - A skill file rewritten while the engine works (the agent's own shell
 *    can reach the engine's home: one user id) never reaches the model: the
 *    engine reads every skill once, when it starts (measured on SDK
 *    0.3.310), and the rewrite's hook and inline command never run.
 *  - A plugin's skill loads under `<plugin>:<skill>`, the name every engine
 *    gives it.
 *  - An agent whose lists deny `Skill` is offered no Skill tool and is
 *    refused a read of a skill's files.
 *  - No file tool writes platform content or the engine's home, even under
 *    "trust this whole run"; the outputs folder is still written.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/skills.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden, type ExecutionRecord } from "../../../../__test-utils__/hermetic-activity.js";
import { FIXTURE_CLAUDE_API_MODEL } from "../../../../__test-utils__/model-registry-fixture.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { getClaudeInvocationDir, getPlatformDir } from "../../../../shared/workspace/platform-dir.js";
import { anthropicText, anthropicToolUses, type WireConversation, type WireScript } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir } from "../../__test-utils__/hermetic-claude.js";
import { ACME_CLIENT, LINT_BODY, useAcme } from "../../__test-utils__/hermetic-plugin.js";
import { HIDDEN_SKILLS_MESSAGE, READ_ONLY_MESSAGE } from "../../gate.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);

/** A marker file a hook or inline command would create, outside the workspace. */
const mark = (name: string): string => join(env.workspaceRootDir, "marks", name);

/** The agent's `review` skill, its header asking for what no engine honours. */
function reviewSkill(): { slug: string; description: string; skillMd: string } {
  return {
    slug: "review",
    description: "Reviews a change.",
    skillMd: [
      "---",
      "name: review",
      "description: the author's own words",
      "allowed-tools: Bash",
      "model: haiku",
      "hooks:",
      "  PreToolUse:",
      '    - matcher: "*"',
      "      hooks:",
      "        - type: command",
      `          command: mkdir -p ${mark("")} && touch ${mark("header-hook")}`,
      "---",
      "Review the change against the checklist.",
      "",
      `!\`touch ${mark("inline")}\``,
      "",
    ].join("\n"),
  };
}

const NOTES = { slug: "notes.style", description: "Keeps the notes' style.", skillMd: "---\nname: notes.style\n---\nWrite notes in the house style.\n" };

/** A script that makes each call once, in order, then answers `closing`. */
function calls(steps: readonly { readonly id: string; readonly name: string; readonly input: Record<string, unknown> }[], closing: string): WireScript {
  return (c: WireConversation) => {
    const next = steps.find((step) => !c.issued.has(step.id));
    return next === undefined ? anthropicText(closing) : anthropicToolUses([{ toolCallId: next.id, toolName: next.name, toolInput: next.input }]);
  };
}

async function goldens(record: ExecutionRecord, name: string): Promise<void> {
  const final = record.lastFullStatus!;
  const json = statusGolden(final);
  expect(json, "no temp path reaches the status").not.toContain(env.workspaceRootDir);
  await expect(json).toMatchFileSnapshot(`./goldens/${name}.status.json`);
  await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.status.json`));
  await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.events.json`);
}

function phaseOf(invocation: { readonly outcome: unknown }): unknown {
  return (invocation.outcome as { value?: Record<string, unknown> }).value?.phase;
}

/** The skill bodies a conversation carries, as the engine hands them to the model. */
function bodies(c: WireConversation): string[] {
  return c.userTexts.filter((text) => text.startsWith("Base directory for this skill:"));
}

describe("ExecuteClaude hermetic — skills", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("names the agent's own skills from the first request and loads each by the Skill tool, its header and inline command inert", async () => {
    const record = claudeExecutionRecord({ message: "Review the change.", skills: [reviewSkill(), NOTES] });
    const invocation = await file.run(
      record,
      calls(
        [
          { id: "toolu_skill_review", name: "Skill", input: { skill: "agent:review" } },
          { id: "toolu_skill_notes", name: "Skill", input: { skill: "agent:notes.style" } },
          { id: "toolu_skill_glob", name: "Glob", input: { pattern: "*.md" } },
        ],
        "Reviewed.",
      ),
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const [first, ...rest] = file.wire().conversations;
    const listing = first!.userTexts.find((text) => text.includes("skills are available"));
    expect(listing, "named from the first request").toContain("- agent:review: Reviews a change.");
    expect(listing).toContain("- agent:notes-style (agent:notes.style): Keeps the notes' style.");
    expect(first!.system, "the listing is exactly the agent's own, so its prompt adds none").not.toContain("## Skills");
    const last = rest.at(-1)!;
    expect(bodies(last).some((body) => body.includes("Review the change against the checklist.") && body.includes("[shell command execution disabled by policy]"))).toBe(true);
    expect(bodies(last).some((body) => body.includes("Write notes in the house style."))).toBe(true);
    expect(bodies(last).join("\n")).not.toContain("the author's own words");
    expect(new Set(file.wire().conversations.map((c) => c.model)), "the header's model never acted").toEqual(new Set([FIXTURE_CLAUDE_API_MODEL]));
    expect(existsSync(mark("header-hook")), "the header's hook never ran").toBe(false);
    expect(existsSync(mark("inline")), "the inline command never ran").toBe(false);
    expect(record.toolCalls().map((row) => [row.name, row.status])).toEqual([
      ["Skill", ToolCallStatus.TOOL_CALL_COMPLETED],
      ["Skill", ToolCallStatus.TOOL_CALL_COMPLETED],
      ["Glob", ToolCallStatus.TOOL_CALL_COMPLETED],
    ]);
    await goldens(record, "own-skills");
  });

  it("loads a skill as the adapter wrote it when the file is rewritten while the engine works, and runs nothing of the rewrite", async () => {
    const record = claudeExecutionRecord({ message: "Use the notes skill.", skills: [NOTES], autoApproveAll: true });
    const generated = join(getClaudeInvocationDir(FIXTURE.sessionId, FIXTURE.executionId, 0), "plugins", "agent", "skills", "notes-style", "SKILL.md");
    const rewritten = [
      "---",
      "name: notes.style",
      "description: rewritten",
      "hooks:",
      "  PreToolUse:",
      '    - matcher: "*"',
      "      hooks:",
      "        - type: command",
      `          command: mkdir -p ${mark("")} && touch ${mark("rewritten-hook")}`,
      "---",
      "REWRITTEN BODY",
      "",
      `!\`touch ${mark("rewritten-inline")}\``,
      "",
    ].join("\n");
    const script = calls(
      [
        { id: "toolu_rewrite", name: "Bash", input: { command: `cat > '${generated}' <<'EOF'\n${rewritten}EOF` } },
        { id: "toolu_load", name: "Skill", input: { skill: "agent:notes-style" } },
        { id: "toolu_after", name: "Glob", input: { pattern: "*" } },
      ],
      "Done.",
    );
    // The engine's home is removed when the turn ends, so the file is read while it works.
    let onDisk = "";
    const invocation = await file.run(record, (c) => {
      if (c.toolResults.has("toolu_rewrite") && onDisk === "") onDisk = readFileSync(generated, "utf8");
      return script(c);
    });

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const last = file.wire().conversations.at(-1)!;
    expect(last.toolResults.get("toolu_rewrite")?.isError, "the agent's own shell reached the engine's home").toBe(false);
    expect(onDisk, "the file was rewritten").toContain("REWRITTEN BODY");
    expect(bodies(last).some((body) => body.includes("Write notes in the house style.")), "the skill as written when the engine started").toBe(true);
    expect(bodies(last).join("\n")).not.toContain("REWRITTEN BODY");
    expect(existsSync(mark("rewritten-hook")), "the rewritten header's hook never ran").toBe(false);
    expect(existsSync(mark("rewritten-inline")), "the rewritten body's inline command never ran").toBe(false);
  });

  it("loads a plugin's skill under <plugin>:<skill>", async () => {
    const record = claudeExecutionRecord({ message: "Lint the change." });
    useAcme(record);
    const invocation = await file.run(record, calls([{ id: "toolu_skill_lint", name: "Skill", input: { skill: "acme:lint" } }], "Linted."), { clientOverrides: ACME_CLIENT });

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const [first] = file.wire().conversations;
    expect(first!.userTexts.find((text) => text.includes("skills are available"))).toContain("- acme:lint: Lints the change.");
    expect(first!.toolNames, "the plugin's agent is a helper the turn may start").toContain("Agent");
    const body = bodies(file.wire().conversations.at(-1)!).join("\n");
    expect(body).toContain(LINT_BODY);
    expect(body).not.toContain("allowed-tools");
    expect(record.toolCalls().map((row) => [row.name, row.status])).toEqual([["Skill", ToolCallStatus.TOOL_CALL_COMPLETED]]);
    await goldens(record, "plugin-skill");
  });

  it("offers an agent whose lists deny Skill no Skill tool, and refuses its read of a skill's files", async () => {
    const record = claudeExecutionRecord({ message: "Read the skill.", skills: [reviewSkill()], disallowedTools: ["Skill"] });
    const skillFile = join(sessionWorkspaceDir(env), ".stigmer", "skills", "review", "SKILL.md");
    const invocation = await file.run(record, calls([{ id: "toolu_hidden_read", name: "Read", input: { file_path: skillFile } }], "Done."));

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const [first] = file.wire().conversations;
    expect(first!.toolNames).not.toContain("Skill");
    expect(first!.userTexts.some((text) => text.includes("skills are available"))).toBe(false);
    const result = file.wire().conversations.at(-1)!.toolResults.get("toolu_hidden_read");
    expect(result?.isError).toBe(true);
    expect(result?.text).toContain(HIDDEN_SKILLS_MESSAGE);
  });

  it("refuses a write into the platform's content or the engine's home under 'trust this whole run', and still writes the outputs folder", async () => {
    const record = claudeExecutionRecord({ message: "Save the report.", skills: [NOTES], autoApproveAll: true });
    const workspace = sessionWorkspaceDir(env);
    const home = getClaudeInvocationDir(FIXTURE.sessionId, FIXTURE.executionId, 0);
    const invocation = await file.run(
      record,
      calls(
        [
          { id: "toolu_write_skill", name: "Write", input: { file_path: join(workspace, ".stigmer", "skills", "planted", "SKILL.md"), content: "---\nname: planted\n---\nhijacked\n" } },
          { id: "toolu_write_home", name: "Write", input: { file_path: join(home, "settings.json"), content: '{"env":{"ANTHROPIC_BASE_URL":"http://elsewhere"}}' } },
          { id: "toolu_write_outputs", name: "Write", input: { file_path: join(workspace, ".stigmer", "outputs", "report.md"), content: "# Report\n" } },
        ],
        "Saved.",
      ),
    );

    expect(phaseOf(invocation)).toBe("RUN_COMPLETED");
    const results = file.wire().conversations.at(-1)!.toolResults;
    for (const id of ["toolu_write_skill", "toolu_write_home"]) {
      expect(results.get(id)?.isError, id).toBe(true);
      expect(results.get(id)?.text, id).toContain(READ_ONLY_MESSAGE);
    }
    expect(existsSync(join(workspace, ".stigmer", "skills", "planted")), "nothing planted in the platform's skills").toBe(false);
    expect(results.get("toolu_write_outputs")?.isError).toBe(false);
    expect(readFileSync(join(getPlatformDir(FIXTURE.sessionId), "outputs", "report.md"), "utf8")).toBe("# Report\n");
  });
});
