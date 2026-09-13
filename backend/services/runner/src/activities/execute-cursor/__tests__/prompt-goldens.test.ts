/**
 * The Cursor prompt, whole, as goldens — one per shape `buildPrompt` selects.
 *
 * `build-prompt.test.ts` pins every branch with `toContain`; the hermetic
 * goldens are status JSON and never see a prompt. So until S3 M5 no test
 * pinned a rendered Cursor prompt byte for byte. These goldens are the
 * photograph taken BEFORE the shared prompt glue moved into
 * `shared/prompt-sections.ts` (S3 M5, Q-M5-1), so the move could be proven
 * byte-identical except where a ruling says otherwise — the same discipline
 * M0 applied to the activity's status.
 *
 * The shapes (`buildPrompt`'s four, plus the two per-execution directives):
 * the enhanced prompt on a first execution with every section populated
 * (three skills, two sub-agents — one with advisory MCP access and a model
 * override —, two workspace dirs plus one runner-internal dir the sanitizer
 * drops, referenced files, three input files with a rename and a download
 * URL, the vision disclosure, channel templates, all five standing sections,
 * the catchup); the enhanced prompt in plan mode; a resumed agent's raw
 * follow-up; a resumed agent's prefixed follow-up (build-from-plan, this
 * turn's attachments, the catchup); the decisions-only HITL reinvocation on a
 * resumed agent (an APPROVE, an already-applied APPROVE, a SKIP and a REJECT);
 * and the HITL recovery on a fresh agent mid-HITL.
 *
 * Rulings that moved a golden are quoted here:
 *  - (none yet)
 *
 * Regenerate with `npx vitest run -u <this file>` only under such a ruling.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { McpAccessSchema, SubAgentSchema, type SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PendingApprovalSchema, type PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction, InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ChannelTemplate, MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";

import type { SkillMetadata } from "../../../shared/skill-resolver.js";
import { buildPrompt, type BuildPromptInput } from "../prompt-builder.js";
import type { AgentResolution, AgentResolutionReason } from "../session-lifecycle.js";

// ---------------------------------------------------------------------------
// Fixtures — every value is a plain fact a golden can name.
// ---------------------------------------------------------------------------

const USER_MESSAGE = "Deploy the payments service to kubernetes and draft the release notes.";

function resolution(reason: AgentResolutionReason): AgentResolution {
  return {
    // buildPrompt never touches the agent handle; a stub keeps the type happy.
    agent: {} as AgentResolution["agent"],
    agentId: "agent-golden",
    isNew: reason !== "resumed_successfully",
    resumed: reason === "resumed_successfully",
    mode: "local",
    reason,
  };
}

function skill(name: string, description: string): SkillMetadata {
  return { name, description, path: `.stigmer/skills/${name}/SKILL.md` };
}

const SKILLS: readonly SkillMetadata[] = [
  skill("k8s-deploy", "Deploy services to kubernetes clusters with helm charts"),
  skill("release-notes", "Draft release notes from the merged pull requests"),
  skill("payments-domain", "Payments service domain knowledge and ledger invariants"),
];

function subAgent(name: string, description: string, extra: { mcpServers?: string[]; modelOverride?: string } = {}): SubAgent {
  const sa = create(SubAgentSchema, { name, description, instructions: "Do the thing thoroughly." });
  if (extra.mcpServers) sa.mcpAccess = extra.mcpServers.map((s) => create(McpAccessSchema, { mcpServer: s }));
  if (extra.modelOverride) sa.modelOverride = extra.modelOverride;
  return sa;
}

const SUB_AGENTS: SubAgent[] = [
  subAgent("researcher", "Reads the codebase and reports how a feature works", { mcpServers: ["github"], modelOverride: "claude-sonnet" }),
  subAgent("writer", "Drafts release notes from a change list"),
];

const ATTACHMENTS: BuildPromptInput["attachments"] = [
  { path: ".stigmer/inputs/spec.pdf" },
  { path: ".stigmer/inputs/report (2).pdf", renamedFrom: "report.pdf" },
  { path: ".stigmer/inputs/diagram.png", downloadUrl: "https://storage.example.test/diagram.png?sig=abc" },
];

const VISION: BuildPromptInput["vision"] = {
  inlineFilenames: ["diagram.png"],
  notViewable: [{ path: ".stigmer/inputs/huge.png", reason: "too_large" }],
};

const CHANNEL_MESSAGING = [
  {
    channel: { channel: "isc-whatsapp", provider: "whatsapp" } as MessagingChannel,
    templates: [
      {
        name: "fee_reminder",
        language: "en",
        category: "UTILITY",
        status: "APPROVED",
        parameterFormat: "POSITIONAL",
        parameterNames: ["1", "2"],
        bodyText: "Hi {{1}}, your fee of {{2}} is due.",
        headerFormat: "",
        rejectionReason: "",
        unsupportedReason: "",
      } as ChannelTemplate,
    ],
  },
];

function pending(id: string, toolName: string, message: string): PendingApproval {
  return create(PendingApprovalSchema, { toolCallId: id, toolName, message });
}

const PENDING: PendingApproval[] = [
  pending("call-1", "Write", "Write file: deploy/values.yaml"),
  pending("call-2", "Write", "Write file: CHANGELOG.md"),
  pending("call-3", "Shell", "Run: helm upgrade payments ./chart"),
  pending("call-4", "Delete", "Delete file: old-notes.md"),
];

const DECISIONS: ReadonlyMap<string, ApprovalAction> = new Map([
  ["call-1", ApprovalAction.APPROVE],
  ["call-2", ApprovalAction.APPROVE],
  ["call-3", ApprovalAction.SKIP],
  ["call-4", ApprovalAction.REJECT],
]);

/** The whole standing context plus this turn's payload, as the activity hands it to `buildPrompt`. */
function everything(reason: AgentResolutionReason, overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    resolution: resolution(reason),
    approvalDecisions: new Map(),
    instructions: "You are the payments release agent.",
    userMessage: USER_MESSAGE,
    skills: SKILLS,
    channelMessaging: CHANNEL_MESSAGING,
    subAgents: SUB_AGENTS,
    workspaceDirs: ["/ws/app", "/ws/docs", "/Users/me/.stigmer/runtimes/cursor-runner/dist/main.js"],
    workspaceFileRefs: ["app/src/deploy.ts", "docs/RELEASES.md"],
    attachments: ATTACHMENTS,
    vision: VISION,
    downloadUrlKind: "presigned",
    pendingApprovals: [],
    contextBridge: "Earlier the user asked for a staging deploy; it succeeded.",
    senderIdentity: { value: "15550001111", kind: "whatsapp_phone" },
    sessionContext: "The user is the on-call engineer this week.",
    declaredPreferences: { orgContext: "We deploy to eu-west-1.", userContext: "Keep answers terse." },
    recalledMemories: { facts: ["Prefers helm over kustomize.", "Release notes go in CHANGELOG.md."] },
    conversationCatchup: "The customer confirmed the maintenance window on WhatsApp.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Goldens
// ---------------------------------------------------------------------------

describe("Cursor prompt goldens (S3 M5, Q-M5-1)", () => {
  it("the enhanced prompt on a first execution, every section populated", async () => {
    const prompt = buildPrompt(everything("created_first_execution"));
    await expect(prompt).toMatchFileSnapshot("./goldens/prompt.enhanced.everything.prompt.md");
  });

  it("the enhanced prompt in plan mode", async () => {
    const prompt = buildPrompt(everything("created_first_execution", { interactionMode: InteractionMode.PLAN }));
    await expect(prompt).toMatchFileSnapshot("./goldens/prompt.enhanced.plan-mode.prompt.md");
  });

  it("a resumed agent's raw follow-up: the message alone", async () => {
    const prompt = buildPrompt(
      everything("resumed_successfully", { attachments: [], vision: undefined, conversationCatchup: undefined }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/prompt.resumed.raw.prompt.md");
  });

  it("a resumed agent's prefixed follow-up: build-from-plan, this turn's attachments, the catchup", async () => {
    const prompt = buildPrompt(
      everything("resumed_successfully", {
        buildFromPlan: true,
        attachments: [...ATTACHMENTS, { path: ".stigmer/inputs/release_aex1.plan.md" }],
      }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/prompt.resumed.prefixed.prompt.md");
  });

  it("the decisions-only HITL reinvocation on a resumed agent", async () => {
    const prompt = buildPrompt(
      everything("resumed_successfully", {
        approvalDecisions: DECISIONS,
        pendingApprovals: PENDING,
        appliedToolCallIds: new Set(["call-1"]),
      }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/prompt.hitl.reinvocation.prompt.md");
  });

  it("the HITL recovery on a fresh agent mid-HITL: the whole story, then the decisions", async () => {
    const prompt = buildPrompt(
      everything("created_after_resume_failure", {
        approvalDecisions: DECISIONS,
        pendingApprovals: PENDING,
        appliedToolCallIds: new Set(["call-1"]),
        turnRecoveryDigest: "Tool: Write file: deploy/values.yaml — awaiting approval\nTool: Read file: chart/Chart.yaml — completed",
      }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/prompt.hitl.recovery.prompt.md");
  });
});
