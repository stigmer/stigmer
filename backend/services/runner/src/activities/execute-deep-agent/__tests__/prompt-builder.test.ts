import { describe, it, expect } from "vitest";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { buildEnhancedSystemPrompt, composeUserMessage } from "../prompt-builder.js";
import { PLAN_MODE_DIRECTIVE } from "../../../shared/plan-mode-prompt.js";
import { SourceType } from "../../../shared/workspace/types.js";
import type { ProvisionResult } from "../../../shared/workspace/types.js";

function makeProvisionResult(overrides: Partial<ProvisionResult> = {}): ProvisionResult {
  return {
    rootDir: "/workspace/project",
    sourceType: SourceType.LOCAL_PATH,
    consumedKeys: [],
    workspaceDescription: "User project directory at /workspace/project",
    entryName: "project",
    ...overrides,
  };
}

describe("buildEnhancedSystemPrompt", () => {
  it("starts with instructions", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "You are a helpful assistant.",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt.startsWith("You are a helpful assistant.")).toBe(true);
  });

  it("includes response rules", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Response rules");
  });

  it("includes sub-agent delegation rules", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Sub-agent delegation rules");
  });

  it("includes single workspace section", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [makeProvisionResult()],
      containerRoot: "/workspace",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
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
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
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
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
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
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("coding-standards");
  });

  it("includes referenced files section", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: ["src/config.yaml", "README.md"],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("## Referenced Files");
    expect(prompt).toContain("`src/config.yaml`");
    expect(prompt).toContain("`README.md`");
  });

  it("includes injected files section with size info", () => {
    // The section renders the injector's own result type (sizeBytes). A local
    // structural twin with a `size` field used to live in the prompt builder,
    // and production wiring silently dropped the size — this pin holds the
    // real field name so that drift class cannot return.
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [
        { filename: "data.csv", path: ".stigmer/inputs/data.csv", sizeBytes: 1024 },
        { filename: "notes.md", path: ".stigmer/inputs/notes.md", sizeBytes: 12 },
      ],
    });

    expect(prompt).toContain("## Input Files");
    expect(prompt).toContain("`.stigmer/inputs/data.csv` (1024 bytes)");
    expect(prompt).toContain("`.stigmer/inputs/notes.md` (12 bytes)");
  });

  it("discloses a duplicate-renamed injected file's original name", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [
        { filename: "report.pdf", path: ".stigmer/inputs/report.pdf", sizeBytes: 10 },
        {
          filename: "report-2.pdf",
          path: ".stigmer/inputs/report-2.pdf",
          sizeBytes: 20,
          renamedFrom: "report.pdf",
        },
      ],
    });

    expect(prompt).toContain(
      "`.stigmer/inputs/report-2.pdf` (20 bytes) (renamed from duplicate 'report.pdf')",
    );
    // The first file keeps a clean entry — no disclosure noise.
    expect(prompt).toContain("`.stigmer/inputs/report.pdf` (10 bytes)\n");
  });

  it("lists a minted download URL beside its file with the presigned hand-off line (issue #532)", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [
        {
          filename: "lease.pdf",
          path: ".stigmer/inputs/lease.pdf",
          sizeBytes: 2048,
          downloadUrl: "https://r2.example/lease?sig=abc",
        },
        { filename: "notes.md", path: ".stigmer/inputs/notes.md", sizeBytes: 12 },
      ],
      downloadUrlKind: "presigned",
    });

    expect(prompt).toContain(
      "`.stigmer/inputs/lease.pdf` (2048 bytes) — download URL: https://r2.example/lease?sig=abc",
    );
    // The URL-less file keeps a clean entry.
    expect(prompt).toContain("`.stigmer/inputs/notes.md` (12 bytes)\n");
    expect(prompt).toContain("These URLs are time-limited");
  });

  it("words a local-serve URL honestly — reachable only from this machine", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [
        {
          filename: "lease.pdf",
          path: ".stigmer/inputs/lease.pdf",
          sizeBytes: 2048,
          downloadUrl: "http://localhost:7235/attachments/01A/lease.pdf",
        },
      ],
      downloadUrlKind: "local-serve",
    });

    expect(prompt).toContain("download URL: http://localhost:7235/attachments/01A/lease.pdf");
    expect(prompt).toContain("reachable only from this machine");
    expect(prompt).not.toContain("time-limited");
  });

  it("renders no hand-off line when no listed file carries a URL (kind alone is not enough)", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [
        { filename: "local.csv", path: ".stigmer/inputs/local.csv", sizeBytes: 5 },
      ],
      downloadUrlKind: "presigned",
    });

    expect(prompt).toContain("## Input Files");
    expect(prompt).not.toContain("download URL");
    expect(prompt).not.toContain("time-limited");
  });

  it("produces a git repo description for git workspace entries", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [
        makeProvisionResult({
          sourceType: SourceType.GIT_REPO,
          entryName: "my-repo",
          rootDir: "/workspace/my-repo",
          gitMetadata: {
            repoUrl: "https://github.com/org/my-repo",
            branch: "main",
            baseCommit: "abc1234567890",
            gitCredentialsConfigured: true,
          },
        }),
        makeProvisionResult({
          sourceType: SourceType.EMPTY,
          entryName: "scratch",
          rootDir: "/workspace/scratch",
        }),
      ],
      containerRoot: "/workspace",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).toContain("https://github.com/org/my-repo");
    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("empty workspace");
  });

  it("omits workspace section when no provision results", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).not.toContain("## Workspace");
  });

  describe("rollover context bridge (DD-013)", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "",
      injectedFiles: [],
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
      workspaceFileRefs: [],
      workspaceRoot: "",
      injectedFiles: [],
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
      workspaceFileRefs: [],
      workspaceRoot: "",
      injectedFiles: [],
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

  describe("plan mode", () => {
    const base = {
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
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
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    };
    const planFile = {
      filename: "plan.md",
      path: ".stigmer/inputs/plan.md",
      sizeBytes: 1024,
    };

    it("appends the implement-plan directive pointing at the injected plan", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
        injectedFiles: [planFile],
      });

      expect(prompt).toContain("## Implement the approved plan");
      expect(prompt).toContain("`.stigmer/inputs/plan.md`");
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
        injectedFiles: [planFile],
      });

      expect(prompt).not.toContain("## Implement the approved plan");
    });

    it("carries the plan-derived progress-tracking instruction (Tier 3)", () => {
      const prompt = buildEnhancedSystemPrompt({
        ...base,
        buildFromPlan: true,
        injectedFiles: [planFile],
      });

      expect(prompt).toContain("to-do list");
      expect(prompt).toContain("break the plan into");
    });
  });
});

describe("composeUserMessage (conversation catchup, cloud DD-006 / A27)", () => {
  const MESSAGE = "where is my order?";
  const DIGEST =
    "Customer: I want a refund\nTeammate: I've refunded you in full.";

  it("prepends the framed catchup to the turn's user message — history durability rides the checkpointer, not the rebuilt system prompt", () => {
    const composed = composeUserMessage(MESSAGE, DIGEST);

    expect(composed.endsWith(MESSAGE)).toBe(true);
    expect(composed).toContain(DIGEST);
    expect(composed).toContain("you have not seen");
    expect(composed.indexOf(DIGEST)).toBeLessThan(composed.indexOf(MESSAGE));
  });

  it("separates the catchup from the customer's message with a horizontal rule", () => {
    expect(composeUserMessage(MESSAGE, DIGEST)).toContain("\n\n---\n\n");
  });

  it("leaves the message untouched when there is no catchup — most turns carry none", () => {
    expect(composeUserMessage(MESSAGE, undefined)).toBe(MESSAGE);
  });

  it("never renders in the system prompt — the rebuilt-per-invocation lane would forget the digest one turn later", () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "Test",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/workspace",
      injectedFiles: [],
    });

    expect(prompt).not.toContain("Conversation catchup");
    expect(prompt).not.toContain("you have not seen");
  });
});
