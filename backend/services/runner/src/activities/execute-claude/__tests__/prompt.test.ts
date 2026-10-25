/**
 * Pins the Claude harness's prompt (`prompt.ts`): the system prompt's append
 * in its documented order, the section an agent is told its own skills in,
 * a sub-agent's prompt, the roots whose instruction files it shows, the
 * confined reader of those files, and the turn's message.
 *
 * Why it matters: the append is rebuilt every turn and is the only place the
 * agent's instructions, workspace, repository instructions and standing
 * context reach this engine, so an order slip changes what the model reads
 * last (the freshest instruction). The reader is a security boundary: a
 * repository can plant a symlink, and the prompt must never show a file the
 * agent could not already read inside its workspace. Its cases run on real
 * directories under the OS temp dir, and each refusal is checked against a
 * plain read of the same path first, so the fixture is a real escape and the
 * test would fail against a reader without the guard.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ChannelTemplate, MessagingChannel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_io_pb";

import { turnInputFixture, type TurnInputFixtureOverrides } from "../../../__test-utils__/turn-input-fixture.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import type { TurnInput } from "../../../harness/types.js";
import { visionDisclosureLines } from "../../../shared/attachment-vision.js";
import { BUILT_IN_ASSISTANT_INSTRUCTIONS } from "../../../shared/builtin-assistant-prompt.js";
import { formatChannelTemplatesSection, type ChannelMessagingInfo } from "../../../shared/channel-attachment.js";
import { formatConversationCatchupText } from "../../../shared/conversation-catchup.js";
import { buildImplementPlanDirective } from "../../../shared/implement-plan-prompt.js";
import type { MessageFile, MountedFile } from "../../../shared/file-mount.js";
import { PLAN_MODE_DIRECTIVE } from "../../../shared/plan-mode-prompt.js";
import { outputsFolderInstruction, standingContextSections } from "../../../shared/prompt-sections.js";
import type { ProvisionResult } from "../../../shared/workspace/types.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import type { SubagentSpec } from "../agents.js";
import { composeSubagentPrompt, composeSystemAppend, composeTurnMessage, instructionRoots, skillsSection, workspaceInstructionReader } from "../prompt.js";
import { engineSkillOf } from "../skill-plugins.js";

const PRIMARY = "/work/primary";

function workspace(results: readonly ProvisionResult[]): TurnInput["workspace"] {
  return {
    dirs: [PRIMARY],
    primaryDir: PRIMARY,
    gitWorkspace: false,
    captureSubstrate: false,
    fileReview: true,
    captureMode: false,
    changeSetId: "aex:0",
    provision: { workspaceDirs: [PRIMARY], provisionResults: [...results], workspaceBackend: mockWorkspaceBackend() },
  };
}

function input(overrides: TurnInputFixtureOverrides = {}): TurnInput {
  return turnInputFixture({ workspace: workspace([]), ...overrides });
}

function withSpec(base: TurnInput, edit: (spec: NonNullable<TurnInput["execution"]["spec"]>) => void): TurnInput {
  edit(base.execution.spec!);
  return base;
}

function messageFile(filename: string, relativePath: string, kind: MessageFile["kind"] = "document"): MessageFile {
  return { filename, relativePath, sizeBytes: 12, fileId: `file_${filename}`, mountPath: filename, mimeType: "text/plain", kind };
}

function channelInfo(): ChannelMessagingInfo {
  const template = {
    name: "fee_reminder",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    parameterFormat: "POSITIONAL",
    parameterNames: ["1"],
    bodyText: "Hi {{1}}",
    headerFormat: "",
    rejectionReason: "",
    unsupportedReason: "",
  } as ChannelTemplate;
  return { channel: { channel: "isc-whatsapp", provider: "whatsapp" } as MessagingChannel, templates: [template] };
}

describe("composeSystemAppend", () => {
  it("writes every section in the documented order, the turn's own append last", () => {
    const base = input({
      blueprint: { instructions: "You review pull requests." },
      workspace: workspace([{ rootDir: PRIMARY, sourceType: "git_repo", workspaceDescription: "The service's repository.", fileTree: "src/\n  main.ts", entryName: "service" }]),
      mcp: { ...turnInputFixture().mcp, channelMessaging: [channelInfo()] },
      standing: { ...turnInputFixture().standing, sessionContext: "The person is on call.", contextBridge: "Earlier they asked about CI." },
      files: { message: [messageFile("x.plan.md", ".stigmer/uploads/x.plan.md")], conversation: [], references: [], visionImages: [], visionNotViewable: [] },
      appendSystemPrompt: "Answer in French.",
    });
    const turn = withSpec(base, (spec) => {
      spec.buildFromPlan = true;
    });
    const recalled = { facts: ["Prefers small PRs."] };
    const repository = "\n\n## Repository instructions\n\nRun the linter.";
    const skills = "\n\n## Skills\n\nYour skills.";

    const standing = standingContextSections({ sessionContext: "The person is on call.", contextBridge: "Earlier they asked about CI.", recalledMemories: recalled });
    const expected =
      "You review pull requests." +
      "\n\n## Workspace\n\nYour working directory is `/work/primary`.\n\n### service (`/work/primary`)\n\nThe service's repository.\n\nsrc/\n  main.ts" +
      repository +
      skills +
      `\n\n${formatChannelTemplatesSection([channelInfo()])}` +
      `\n\n## Remembered facts\n\n${standing[0]!.body}` +
      `\n\n## Session context\n\n${standing[1]!.body}` +
      `\n\n## Previous conversation context\n\n${standing[2]!.body}` +
      `\n\n## Files for the person\n\n${outputsFolderInstruction("/work/primary/.stigmer/outputs/")}` +
      `\n\n## Implement the approved plan\n\n${buildImplementPlanDirective("/work/primary/.stigmer/uploads/x.plan.md")}` +
      "\n\nAnswer in French.";
    expect(composeSystemAppend(turn, recalled, repository, skills)).toBe(expected);
  });

  it("frames the conversation sender and declared preferences under their own headings, sender first", () => {
    const turn = input({
      standing: {
        ...turnInputFixture().standing,
        senderIdentity: { value: "15550001111", kind: "whatsapp_phone" },
        declaredPreferences: { userContext: "Keep answers short." },
      },
    });
    const append = composeSystemAppend(turn, undefined, "");
    const sender = append.indexOf("## Conversation sender\n\n");
    const preferences = append.indexOf("## Declared preferences\n\n");
    expect(sender).toBeGreaterThan(-1);
    expect(preferences).toBeGreaterThan(sender);
  });

  it("falls back to the built-in assistant's instructions when the agent has none", () => {
    const append = composeSystemAppend(input({ blueprint: { instructions: "" } }), undefined, "");
    expect(append.startsWith(BUILT_IN_ASSISTANT_INSTRUCTIONS)).toBe(true);
  });

  it("writes no workspace section when nothing was provisioned, and names an unnamed entry by its place", () => {
    expect(composeSystemAppend(input(), undefined, "")).not.toContain("## Workspace");
    const append = composeSystemAppend(
      input({
        workspace: workspace([
          { rootDir: "/work/primary/a", sourceType: "local_path", workspaceDescription: "First.", entryName: "" },
          { rootDir: "/work/primary/b", sourceType: "empty", workspaceDescription: "Second.", entryName: "named" },
        ]),
      }),
      undefined,
      "",
    );
    expect(append).toContain("### entry-1 (`/work/primary/a`)\n\nFirst.\n\n### named (`/work/primary/b`)\n\nSecond.");
  });

  it("in plan mode, writes the plan directive and no outputs folder", () => {
    const turn = withSpec(input(), (spec) => {
      spec.interactionMode = InteractionMode.PLAN;
    });
    const append = composeSystemAppend(turn, undefined, "");
    expect(append).toContain(`\n\n## Plan mode\n\n${PLAN_MODE_DIRECTIVE}`);
    expect(append).not.toContain("## Files for the person");
  });

  it("outside plan mode, names the outputs folder under the primary directory and writes no plan directive", () => {
    const append = composeSystemAppend(input(), undefined, "");
    expect(append).toContain(outputsFolderInstruction("/work/primary/.stigmer/outputs/"));
    expect(append).not.toContain("## Plan mode");
  });

  it("builds from a plan only in the conversation when the message carried no plan file", () => {
    const turn = withSpec(input(), (spec) => {
      spec.buildFromPlan = true;
    });
    expect(composeSystemAppend(turn, undefined, "")).toContain(`## Implement the approved plan\n\n${buildImplementPlanDirective(undefined)}`);
  });

  it("writes no channel section when no template is sendable", () => {
    const unsendable = channelInfo();
    unsendable.templates = unsendable.templates.map((template) => ({ ...template, unsupportedReason: "dynamic header" }) as ChannelTemplate);
    const append = composeSystemAppend(input({ mcp: { ...turnInputFixture().mcp, channelMessaging: [unsendable] } }), undefined, "");
    expect(append).not.toContain("<available_channel_templates>");
  });

  it("appends nothing for an empty turn append and ends on the last platform section", () => {
    const append = composeSystemAppend(input({ appendSystemPrompt: "" }), undefined, "");
    expect(append.endsWith(outputsFolderInstruction("/work/primary/.stigmer/outputs/"))).toBe(true);
  });

  it("never carries the person's message", () => {
    const turn = input({ message: "a secret request only the message holds" });
    expect(composeSystemAppend(turn, undefined, "")).not.toContain("a secret request only the message holds");
  });
});

describe("skillsSection", () => {
  const review = engineSkillOf({ name: "review", description: "Reviews a change.", path: ".stigmer/skills/review/SKILL.md" }, PRIMARY);
  const dotted = engineSkillOf({ name: "platform.x", description: "Knows the platform.", path: ".stigmer/skills/platform.x/SKILL.md" }, PRIMARY);

  it("is empty when the engine's listing already names exactly the agent's skills", () => {
    expect(skillsSection([review, dotted], 2)).toBe("");
    expect(skillsSection([], 0)).toBe("");
  });

  it("names the agent's own skills by the names the Skill tool takes, and says the others are not its to load", () => {
    const section = skillsSection([review, dotted], 3);
    expect(section.startsWith("\n\n## Skills\n\n")).toBe(true);
    expect(section).toContain("- `agent:review`: Reviews a change.\n- `agent:platform.x`: Knows the platform.");
    expect(section).toContain("other agents in this conversation, which you cannot load");
  });

  it("tells an agent with no skills of its own that the listing's are others'", () => {
    expect(skillsSection([], 2)).toBe("\n\n## Skills\n\nYou have no skills of your own. The skill listing names skills of other agents in this conversation, which you cannot load.");
  });
});

describe("composeSubagentPrompt", () => {
  const spec = (overrides: Partial<SubagentSpec> = {}): SubagentSpec => ({
    name: "test-runner",
    kind: "saved",
    description: "Runs the tests.",
    instructions: "You run the tests.\n",
    scope: ToolScope.unrestricted(),
    skills: [],
    servers: [],
    model: undefined,
    shellValues: {},
    ...overrides,
  });
  const repository = "\n\n## Repository instructions\n\nRun the linter.";
  const ci = engineSkillOf({ name: "ci", description: "CI checks.", path: ".stigmer/skills/ci/SKILL.md" }, PRIMARY);

  it("is its instructions, its own skills, the outputs folder and the repository's instructions, in that order", () => {
    const prompt = composeSubagentPrompt({ spec: spec(), skills: [ci] }, { turnSkillCount: 2, planMode: false, repositoryInstructionsSection: repository, primaryDir: PRIMARY });
    expect(prompt).toBe(
      "You run the tests." + skillsSection([ci], 2) + `\n\n## Files for the person\n\n${outputsFolderInstruction("/work/primary/.stigmer/outputs/")}` + repository,
    );
  });

  it("names no outputs folder in plan mode, and no repository instructions when its lists keep it from reading the workspace", () => {
    const noRead = spec({ scope: ToolScope.of("Subagent", { tools: [], disallowedTools: ["Read"] }) });
    expect(composeSubagentPrompt({ spec: noRead, skills: [] }, { turnSkillCount: 0, planMode: true, repositoryInstructionsSection: repository, primaryDir: PRIMARY })).toBe("You run the tests.");
  });

  it("stands on its description when it has no instructions", () => {
    expect(composeSubagentPrompt({ spec: spec({ instructions: "  " }), skills: [] }, { turnSkillCount: 0, planMode: true, repositoryInstructionsSection: "", primaryDir: PRIMARY })).toBe("Runs the tests.");
  });
});

describe("instructionRoots", () => {
  it("lists the primary directory first, then each entry root inside it, each once", () => {
    expect(instructionRoots("/w", ["/w/a", "/w/b/c", "/w/a", "/w"])).toEqual(["/w", "/w/a", "/w/b/c"]);
  });

  it("leaves out an entry root outside the primary directory", () => {
    expect(instructionRoots("/w", ["/elsewhere", "/w/../x", "/wx"])).toEqual(["/w"]);
  });
});

describe("workspaceInstructionReader", () => {
  let base: string;
  let workspaceDir: string;
  let outsideDir: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "claude-prompt-reader-"));
    workspaceDir = join(base, "workspace");
    outsideDir = join(base, "outside");
    await mkdir(join(workspaceDir, "pkg"), { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(workspaceDir, "AGENTS.md"), "Root instructions.");
    await writeFile(join(workspaceDir, "pkg", "AGENTS.md"), "Package instructions.");
    await writeFile(join(outsideDir, "AGENTS.md"), "Secrets from outside the workspace.");
    await writeFile(join(workspaceDir, "binary.md"), Buffer.from([0x41, 0x00, 0x42]));
    await writeFile(join(workspaceDir, "huge.md"), Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    await symlink(outsideDir, join(workspaceDir, "escape"));
    await symlink(join(outsideDir, "AGENTS.md"), join(workspaceDir, "linked-outside.md"));
    await symlink(join(workspaceDir, "AGENTS.md"), join(workspaceDir, "linked-inside.md"));
    await symlink(workspaceDir, join(base, "workspace-link"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("reads a text file at the workspace root and in a directory inside it", async () => {
    const read = workspaceInstructionReader(workspaceDir);
    await expect(read(join(workspaceDir, "AGENTS.md"))).resolves.toBe("Root instructions.");
    await expect(read(join(workspaceDir, "pkg", "AGENTS.md"))).resolves.toBe("Package instructions.");
  });

  it("refuses a file reached through a symlinked directory that escapes the workspace", async () => {
    const escaped = join(workspaceDir, "escape", "AGENTS.md");
    await expect(readFile(escaped, "utf8")).resolves.toBe("Secrets from outside the workspace.");
    await expect(workspaceInstructionReader(workspaceDir)(escaped)).resolves.toBeUndefined();
  });

  it("refuses a symlinked file, even one pointing inside the workspace", async () => {
    const outward = join(workspaceDir, "linked-outside.md");
    const inward = join(workspaceDir, "linked-inside.md");
    await expect(readFile(outward, "utf8")).resolves.toBe("Secrets from outside the workspace.");
    await expect(readFile(inward, "utf8")).resolves.toBe("Root instructions.");
    const read = workspaceInstructionReader(workspaceDir);
    await expect(read(outward)).resolves.toBeUndefined();
    await expect(read(inward)).resolves.toBeUndefined();
  });

  it("refuses a file outside the workspace named directly", async () => {
    await expect(workspaceInstructionReader(workspaceDir)(join(outsideDir, "AGENTS.md"))).resolves.toBeUndefined();
    await expect(workspaceInstructionReader(workspaceDir)(join(workspaceDir, "..", "outside", "AGENTS.md"))).resolves.toBeUndefined();
  });

  it("reads through a workspace path that is itself a symlink, comparing real locations", async () => {
    const linkedWorkspace = join(base, "workspace-link");
    expect(await realpath(linkedWorkspace)).toBe(await realpath(workspaceDir));
    await expect(workspaceInstructionReader(linkedWorkspace)(join(workspaceDir, "AGENTS.md"))).resolves.toBe("Root instructions.");
    await expect(workspaceInstructionReader(workspaceDir)(join(linkedWorkspace, "pkg", "AGENTS.md"))).resolves.toBe("Package instructions.");
  });

  it("reads a missing file, a directory, a binary file and an oversized file as absent", async () => {
    const read = workspaceInstructionReader(workspaceDir);
    await expect(read(join(workspaceDir, "missing.md"))).resolves.toBeUndefined();
    await expect(read(join(workspaceDir, "nowhere", "AGENTS.md"))).resolves.toBeUndefined();
    await expect(read(join(workspaceDir, "pkg"))).resolves.toBeUndefined();
    await expect(read(join(workspaceDir, "binary.md"))).resolves.toBeUndefined();
    await expect(read(join(workspaceDir, "huge.md"))).resolves.toBeUndefined();
  });

  it("reads everything as absent when the workspace itself does not exist", async () => {
    await expect(workspaceInstructionReader(join(base, "gone"))(join(workspaceDir, "AGENTS.md"))).resolves.toBeUndefined();
  });
});

describe("composeTurnMessage", () => {
  it("is the person's text alone when the turn carries nothing else", () => {
    expect(composeTurnMessage(input({ message: "Fix the build." }))).toBe("Fix the build.");
  });

  it("lists the turn's files in real paths, then the highlighted paths, then the catchup, then the text, each set off by a rule", () => {
    const conversationFile: MountedFile = { filename: "old.csv", relativePath: ".stigmer/uploads/old.csv", sizeBytes: 30, fileId: "f2", mountPath: "old.csv", mimeType: "text/csv" };
    const base = input({
      message: "Look at these.",
      files: {
        message: [messageFile("notes.txt", ".stigmer/uploads/notes.txt"), messageFile("shot.png", ".stigmer/uploads/shot.png", "image")],
        conversation: [conversationFile],
        references: [{ filename: "ref.md", relativePath: ".stigmer/inputs/ref.md", sizeBytes: 5 }],
        visionImages: [{ filename: "shot.png", mimeType: "image/png", base64: "AAAA", byteSize: 3 }],
        visionNotViewable: [],
      },
      standing: { ...turnInputFixture().standing, conversationCatchup: "They discussed the release." },
    });
    const turn = withSpec(base, (spec) => {
      spec.workspaceFileRefs = ["src/main.ts", "/abs/elsewhere.ts"];
    });
    const message = composeTurnMessage(turn);
    const parts = message.split("\n\n---\n\n");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(
      "## Input Files\n\nThese files were provided as read-only reference material for the task. " +
        "They are not part of the project's source; read them when you need their contents, and do not modify or delete them.\n\n" +
        "Sent with this message:\n" +
        "- `/work/primary/.stigmer/uploads/notes.txt` (12 bytes)\n" +
        "- `/work/primary/.stigmer/uploads/shot.png` (12 bytes)\n" +
        "Shared earlier in this conversation:\n" +
        "- `/work/primary/.stigmer/uploads/old.csv` (30 bytes)\n" +
        "Reference files:\n" +
        "- `/work/primary/.stigmer/inputs/ref.md` (5 bytes)" +
        `\n\n${visionDisclosureLines(["shot.png"], []).join("\n")}`,
    );
    expect(parts[1]).toBe(
      "## Referenced Files\n\nThe person highlighted these workspace paths for your attention.\n\n- `/work/primary/src/main.ts`\n- `/abs/elsewhere.ts`",
    );
    expect(parts[2]).toBe(formatConversationCatchupText("They discussed the release."));
    expect(parts[3]).toBe("Look at these.");
  });

  it("writes no vision lines when the turn carries no image facts", () => {
    const turn = input({
      message: "Read it.",
      files: { message: [messageFile("notes.txt", ".stigmer/uploads/notes.txt")], conversation: [], references: [], visionImages: [], visionNotViewable: [] },
    });
    const [files] = composeTurnMessage(turn).split("\n\n---\n\n");
    expect(files?.endsWith("- `/work/primary/.stigmer/uploads/notes.txt` (12 bytes)")).toBe(true);
  });

  it("writes only the parts the turn has", () => {
    const turn = withSpec(input({ message: "Check this file." }), (spec) => {
      spec.workspaceFileRefs = ["README.md"];
    });
    expect(composeTurnMessage(turn)).toBe(
      "## Referenced Files\n\nThe person highlighted these workspace paths for your attention.\n\n- `/work/primary/README.md`\n\n---\n\nCheck this file.",
    );
  });
});
