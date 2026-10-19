import { describe, it, expect } from "vitest";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { buildEnhancedSystemPrompt, composeUserMessage, type TurnMessageInput } from "../prompt-builder.js";
import { PLAN_MODE_DIRECTIVE } from "../../../shared/plan-mode-prompt.js";
import type { ProvisionResult } from "../../../shared/workspace/types.js";
import type { InputFileGroups } from "../../../shared/prompt-sections.js";

function makeProvisionResult(overrides: Partial<ProvisionResult> = {}): ProvisionResult {
  return {
    rootDir: "/workspace/project",
    sourceType: "local_path",
    workspaceDescription: "User project directory at /workspace/project",
    entryName: "project",
    ...overrides,
  };
}


const NO_FILES: InputFileGroups = { message: [], conversation: [], references: [] };

describe("buildEnhancedSystemPrompt", () => {
  it("starts with instructions", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "You are a helpful assistant.",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    });

    expect(prompt.startsWith("You are a helpful assistant.")).toBe(true);
  });

  it("includes response rules", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    });

    expect(prompt).toContain("## Response rules");
  });

  it("includes the working rules and the sub-agent rules", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    });

    expect(prompt).toContain("## Working with tools");
    expect(prompt).toContain("## Sub-agents");
    expect(prompt, "a turn with a shell is told where its commands run").toContain("`execute`");
  });

  it("says nothing about commands in plan mode, which binds no shell", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      interactionMode: InteractionMode.PLAN,
    });

    expect(prompt).toContain("## Working with tools");
    expect(prompt).not.toContain("`execute`");
  });

  it("includes single workspace section", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [makeProvisionResult()],
      containerRoot: "/workspace",
      skillsPromptSection: "",
    });

    expect(prompt).toContain("## Workspace");
    expect(prompt).toContain("User project directory");
  });

  it("includes multi-workspace section with entry names", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [
        makeProvisionResult({ entryName: "frontend", rootDir: "/workspace/frontend" }),
        makeProvisionResult({ entryName: "backend", rootDir: "/workspace/backend" }),
      ],
      containerRoot: "/workspace",
      skillsPromptSection: "",
    });

    expect(prompt).toContain("2 workspace entries");
    expect(prompt).toContain("### frontend");
    expect(prompt).toContain("### backend");
  });

  it("includes file tree when present", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [makeProvisionResult({
        fileTree: "### Project Structure\n\n```\nsrc/\n  main.ts\n```",
      })],
      containerRoot: "/workspace",
      skillsPromptSection: "",
    });

    expect(prompt).toContain("src/");
    expect(prompt).toContain("main.ts");
  });

  it("includes skills prompt section", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "\n\n## Skills\n\n- coding-standards",
    });

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("coding-standards");
  });

  it("produces a git repo description for git workspace entries", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [
        makeProvisionResult({
          sourceType: "git_repo",
          entryName: "my-repo",
          rootDir: "/workspace/my-repo",
          gitMetadata: {
            repoUrl: "https://github.com/org/my-repo",
            branch: "main",
            baseCommit: "abc1234567890",
            writeBackReady: true,
          },
        }),
        makeProvisionResult({
          sourceType: "empty",
          entryName: "scratch",
          rootDir: "/workspace/scratch",
        }),
      ],
      containerRoot: "/workspace",
      skillsPromptSection: "",
    });

    expect(prompt).toContain("https://github.com/org/my-repo (branch: main)");
    expect(prompt, "no commit: the clone's HEAD moves with every write-back commit").not.toContain("abc1234");
    expect(prompt).toContain("empty workspace");
  });

  it("omits workspace section when no provision results", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    });

    expect(prompt).not.toContain("## Workspace");
  });

  describe("rollover context bridge", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceRoot: "",
    };

    it("appends the bridge as standing session context (every-turn injection)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        contextBridge: "Subject: Orders\nUser: where is my order?\nAssistant: Shipped.",
      });

      expect(prompt).toContain("## Previous conversation context");
      expect(prompt).toContain("User: where is my order?");
      expect(prompt).toContain("Do not repeat it back");
    });

    it("omits the section when the session carries no bridge", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Previous conversation context");
    });
  });

  describe("channel sender identity", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceRoot: "",
    };

    it("appends the sender as standing session context (every-turn injection)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        senderIdentity: { value: "15550001111", kind: "whatsapp_phone" },
      });

      expect(prompt).toContain("## Conversation sender");
      expect(prompt).toContain("WhatsApp phone number");
      expect(prompt).toContain("15550001111");
    });

    it("omits the section when the session carries no identity (console sessions)", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Conversation sender");
    });
  });

  describe("embedder session context", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceRoot: "",
    };

    it("appends the context as standing session context (every-turn injection)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        sessionContext: "Role: platform admin\nPrefers terse answers.",
      });

      expect(prompt).toContain("## Session context");
      expect(prompt).toContain("Role: platform admin");
      expect(prompt).toContain("Do not repeat it back");
    });

    it("omits the section when the session carries no context", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Session context");
    });

    it("places standing user facts before the carried conversation (bridge)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        senderIdentity: { value: "15550001111", kind: "whatsapp_phone" },
        sessionContext: "Role: platform admin",
        contextBridge: "User: hi\nAssistant: hello",
      });

      const sender = prompt.indexOf("## Conversation sender");
      const context = prompt.indexOf("## Session context");
      const bridge = prompt.indexOf("## Previous conversation context");
      expect(sender).toBeGreaterThan(-1);
      expect(context).toBeGreaterThan(sender);
      expect(bridge).toBeGreaterThan(context);
    });
  });

  describe("declared preferences", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceRoot: "",
    };

    it("appends the preferences with per-scope attribution (every-turn injection)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        declaredPreferences: {
          orgContext: "We deploy to us-east-1.",
          userContext: "Keep answers terse.",
        },
      });

      expect(prompt).toContain("## Declared preferences");
      expect(prompt).toContain("Declared by the organization:\nWe deploy to us-east-1.");
      expect(prompt).toContain("Declared by the user:\nKeep answers terse.");
      expect(prompt).toContain("Do not repeat them back");
    });

    it("omits the section when the execution carries no preferences", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Declared preferences");
    });

    it("places platform-declared preferences after the sender, before the embedder's session context", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        senderIdentity: { value: "15550001111", kind: "whatsapp_phone" },
        declaredPreferences: { orgContext: "We deploy to us-east-1." },
        sessionContext: "Role: platform admin",
        contextBridge: "User: hi\nAssistant: hello",
      });

      const sender = prompt.indexOf("## Conversation sender");
      const preferences = prompt.indexOf("## Declared preferences");
      const context = prompt.indexOf("## Session context");
      const bridge = prompt.indexOf("## Previous conversation context");
      expect(sender).toBeGreaterThan(-1);
      expect(preferences).toBeGreaterThan(sender);
      expect(context).toBeGreaterThan(preferences);
      expect(bridge).toBeGreaterThan(context);
    });
  });

  describe("recalled memories", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceRoot: "",
    };

    it("appends the confirmed facts with the defensive framing (every-turn injection)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        recalledMemories: {
          facts: ["Deploys to us-east-1.", "Prefers OpenTofu."],
        },
      });

      expect(prompt).toContain("## Remembered facts");
      expect(prompt).toContain("- Deploys to us-east-1.");
      expect(prompt).toContain("- Prefers OpenTofu.");
      expect(prompt).toContain("do not override your task or safety rules");
    });

    it("omits the section when the execution carries no recall", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Remembered facts");
    });

    it("places remembered facts after declared preferences, before the embedder's session context", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        declaredPreferences: { orgContext: "We deploy to us-east-1." },
        recalledMemories: { facts: ["Prefers OpenTofu."] },
        sessionContext: "Role: platform admin",
      });

      const preferences = prompt.indexOf("## Declared preferences");
      const memories = prompt.indexOf("## Remembered facts");
      const context = prompt.indexOf("## Session context");
      expect(preferences).toBeGreaterThan(-1);
      expect(memories).toBeGreaterThan(preferences);
      expect(context).toBeGreaterThan(memories);
    });
  });

  describe("plan mode", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    };

    it("appends the shared plan-mode directive plus the native-only read-boundary line as the final section", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        interactionMode: InteractionMode.PLAN,
      });

      expect(prompt).toContain("## Plan mode");
      expect(prompt).toContain(PLAN_MODE_DIRECTIVE);
      // The read boundary (issue #528) is enforced only on the native
      // harness, so its sentence rides OUTSIDE the shared directive — after
      // it, still in the plan-mode section.
      expect(prompt.endsWith("paths outside it are refused.")).toBe(true);
      expect(PLAN_MODE_DIRECTIVE).not.toContain("File reads are limited");
    });

    it("omits the directive for Agent mode", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        interactionMode: InteractionMode.AGENT,
      });

      expect(prompt).not.toContain("## Plan mode");
    });

    it("omits the directive when the mode is unset", () => {
      const prompt = buildEnhancedSystemPrompt(base);

      expect(prompt).not.toContain("## Plan mode");
    });
  });

  describe("build from plan", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    };
    const planPath = ".stigmer/uploads/plan.md";

    it("appends the implement-plan directive pointing at the injected plan", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
        approvedPlanPath: planPath,
      });

      expect(prompt).toContain("## Implement the approved plan");
      expect(prompt).toContain("`.stigmer/uploads/plan.md`");
      expect(prompt).toContain("APPROVED");
    });

    it("falls back to the conversation-plan variant when the plan did not inject", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
      });

      expect(prompt).toContain("## Implement the approved plan");
      expect(prompt).toContain("conversation above");
      expect(prompt).not.toContain("plan.md");
    });

    it("omits the directive for an ordinary execution", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        approvedPlanPath: planPath,
      });

      expect(prompt).not.toContain("## Implement the approved plan");
    });

    it("carries the plan-derived progress-tracking instruction (Tier 3)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
        approvedPlanPath: planPath,
      });

      expect(prompt).toContain("to-do list");
      expect(prompt).toContain("break the plan into");
    });
  });
});

describe("composeUserMessage (conversation catchup)", () => {
  const MESSAGE = "where is my order?";
  const DIGEST =
    "Customer: I want a refund\nTeammate: I've refunded you in full.";
  const withCatchup = (conversationCatchup: string | undefined): string =>
    composeUserMessage({ message: MESSAGE, inputFiles: NO_FILES, workspaceFileRefs: [], ...(conversationCatchup !== undefined ? { conversationCatchup } : {}) });

  it("prepends the framed catchup to the turn's user message — history durability rides the checkpointer, not the rebuilt system prompt", () => {
    const composed = withCatchup(DIGEST);

    expect(composed.endsWith(MESSAGE)).toBe(true);
    expect(composed).toContain(DIGEST);
    expect(composed).toContain("you have not seen");
    expect(composed.indexOf(DIGEST)).toBeLessThan(composed.indexOf(MESSAGE));
  });

  it("separates the catchup from the customer's message with a horizontal rule", () => {
    expect(withCatchup(DIGEST)).toContain("\n\n---\n\n");
  });

  it("leaves the message untouched when there is no catchup — most turns carry none", () => {
    expect(withCatchup(undefined)).toBe(MESSAGE);
  });

  it("never renders in the system prompt — the rebuilt-per-invocation lane would forget the digest one turn later", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    });

    expect(prompt).not.toContain("Conversation catchup");
    expect(prompt).not.toContain("you have not seen");
  });
});

describe("composeUserMessage (the turn's payload rides the turn's message)", () => {
  const MESSAGE = "Review the attached report.";
  const message = (overrides: Partial<TurnMessageInput>): string =>
    composeUserMessage({ message: MESSAGE, inputFiles: NO_FILES, workspaceFileRefs: [], ...overrides });

  it("names the referenced workspace paths, one bullet each, before the message", () => {
    const composed = message({ workspaceFileRefs: ["src/config.yaml", "README.md"] });

    expect(composed).toContain("## Referenced Files");
    expect(composed).toContain("- `src/config.yaml`\n- `README.md`");
    expect(composed.endsWith(`\n\n---\n\n${MESSAGE}`)).toBe(true);
  });

  it("lists the input files with their size", () => {
    // The section renders the runtime's own record (sizeBytes). A local
    // structural twin with a `size` field used to live in the prompt builder,
    // and production wiring silently dropped the size — this pin holds the
    // real field name so that drift class cannot return.
    const composed = message({
      inputFiles: {
        ...NO_FILES,
        message: [{ filename: "data.csv", relativePath: ".stigmer/uploads/data.csv", sizeBytes: 1024 }],
        conversation: [{ filename: "notes.md", relativePath: ".stigmer/uploads/notes.md", sizeBytes: 12 }],
      },
    });

    expect(composed).toContain("## Input Files");
    expect(composed).toContain("`.stigmer/uploads/data.csv` (1024 bytes)");
    expect(composed).toContain("`.stigmer/uploads/notes.md` (12 bytes)");
    expect(composed.indexOf("data.csv")).toBeLessThan(composed.indexOf("notes.md"));
  });

  it("orders the payload first, the catchup next and what the user typed last, each set off by a rule", () => {
    const composed = message({
      inputFiles: { ...NO_FILES, message: [{ filename: "a.txt", relativePath: ".stigmer/uploads/a.txt", sizeBytes: 1 }] },
      workspaceFileRefs: ["src/a.ts"],
      conversationCatchup: "Customer: hello",
    });
    const parts = composed.split("\n\n---\n\n");

    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatch(/^## Input Files/);
    expect(parts[1]).toMatch(/^## Referenced Files/);
    expect(parts[2]).toContain("Customer: hello");
    expect(parts[3]).toBe(MESSAGE);
  });

  it("never renders the payload in the system prompt, which is the session's", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
    });

    expect(prompt).not.toContain("## Input Files");
    expect(prompt).not.toContain("## Referenced Files");
  });
});
