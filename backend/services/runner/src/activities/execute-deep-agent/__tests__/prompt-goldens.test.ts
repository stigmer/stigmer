/**
 * The native system prompt, whole, as goldens.
 *
 * Every other prompt test in this directory asserts with `toContain`; the
 * hermetic goldens are status JSON and never see a prompt. So until #1096 no
 * test pinned a rendered prompt byte for byte, and the relevance-filtered
 * `## Skills` section (eight or more skills, `turn-setup.ts`
 * `renderRootSkillsSection`) had no test at all. These goldens are the
 * photograph taken BEFORE the shared prompt glue moved into
 * `shared/prompt-sections.ts` (#1096), so the move could be proven
 * byte-identical — the same discipline the hermetic net applied to the
 * activity's status.
 *
 * Why bytes matter here beyond taste: `ScriptedModel` tells its scripted
 * roles apart by the system prompt's text (`__test-utils__/scripted-model.ts`
 * `systemPromptOf`), so a changed byte can silently re-route a scripted reply
 * in the sub-agent delegation golden.
 *
 * The shapes: everything at once (the multi-entry workspace, nine skills so
 * the filter fires, channel templates, referenced files, three input files
 * with a rename and a download URL, the vision disclosure, all five standing
 * sections); the below-threshold skills branch; plan mode; build-from-plan;
 * and the minimal prompt (no instructions, so `DEFAULT_INSTRUCTIONS`). Plan
 * mode and build-from-plan are mutually exclusive in production, so each has
 * its own golden.
 *
 * The goldens are taken through `turn-setup.ts` `composeSystemPrompt`, the
 * production mapping from the runtime's resolved record to the builder's
 * input, so they pin the mapping too, not a copy of it. (The first cut
 * photographed the prompt through a field-for-field copy of the mapping as
 * it then sat inline in `buildEngine`; the next extracted it and re-took the
 * goldens through the
 * extraction — byte-identical, which is the proof the extraction is one.)
 *
 * A golden moves only under a ruling quoted in this header; never a quiet
 * `-u`. Regenerate with `npx vitest run -u <this file>` once ruled.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema, ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ChannelTemplate, MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import { TURN_INPUT_FIXTURE_IDS, turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnInput } from "../../../harness/types.js";
import type { ResolvedAttachment } from "../../../shared/attachment-resolver.js";
import type { SkillMetadata } from "../../../shared/skill-resolver.js";
import type { RecalledMemoriesContent } from "../../../shared/recalled-memories.js";
import { SourceType, type ProvisionResult } from "../../../shared/workspace/types.js";
import { buildEnhancedSystemPrompt } from "../prompt-builder.js";
import { composeSystemPrompt } from "../turn-setup.js";

// ---------------------------------------------------------------------------
// Fixtures — every value is a plain fact a golden can name.
// ---------------------------------------------------------------------------

const USER_MESSAGE = "Deploy the payments service to kubernetes and draft the release notes.";

function skill(name: string, description: string): SkillMetadata {
  return { name, description, path: `.stigmer/skills/${name}/SKILL.md` };
}

/** Nine skills: three the message's terms reach, six it does not — the filter has something to exclude. */
const NINE_SKILLS: readonly SkillMetadata[] = [
  skill("k8s-deploy", "Deploy services to kubernetes clusters with helm charts"),
  skill("release-notes", "Draft release notes from the merged pull requests"),
  skill("payments-domain", "Payments service domain knowledge and ledger invariants"),
  skill("csv-wrangling", "Reshape and validate CSV exports"),
  skill("pdf-extraction", "Pull tables out of PDF statements"),
  skill("slack-digest", "Summarise a Slack channel's day"),
  skill("sql-tuning", "Explain and tune slow SQL queries"),
  skill("image-resize", "Batch-resize and convert images"),
  skill("calendar-sync", "Reconcile two calendars' events"),
];

const THREE_SKILLS: readonly SkillMetadata[] = NINE_SKILLS.slice(0, 3);

const PROVISION_RESULTS: readonly ProvisionResult[] = [
  {
    rootDir: "/ws/app",
    sourceType: SourceType.GIT_REPO,
    consumedKeys: [],
    workspaceDescription: "The payments service, cloned from git.",
    entryName: "app",
    gitMetadata: { repoUrl: "https://github.com/acme/payments", branch: "main", baseCommit: "0123456789abcdef", gitCredentialsConfigured: true },
    fileTree: "app/\n  src/\n  README.md",
  },
  {
    rootDir: "/ws/docs",
    sourceType: SourceType.LOCAL_PATH,
    consumedKeys: [],
    workspaceDescription: "The docs folder on the user's machine.",
    entryName: "docs",
  },
];

const INPUT_FILES: readonly ResolvedAttachment[] = [
  { filename: "spec.pdf", relativePath: ".stigmer/inputs/spec.pdf", sizeBytes: 204800 },
  { filename: "report (2).pdf", relativePath: ".stigmer/inputs/report (2).pdf", sizeBytes: 1024, renamedFrom: "report.pdf" },
  {
    filename: "diagram.png",
    relativePath: ".stigmer/inputs/diagram.png",
    sizeBytes: 4096,
    downloadUrl: "https://storage.example.test/diagram.png?sig=abc",
  },
];

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

const RECALLED: RecalledMemoriesContent = { facts: ["Prefers helm over kustomize.", "Release notes go in CHANGELOG.md."] };

const PLAN_ATTACHMENT: ResolvedAttachment = {
  filename: "release_aex1.plan.md",
  relativePath: ".stigmer/inputs/release_aex1.plan.md",
  sizeBytes: 2048,
};

interface EverythingShape {
  readonly skills: readonly SkillMetadata[];
  readonly interactionMode?: InteractionMode;
  readonly buildFromPlan?: boolean;
  readonly inputFiles?: readonly ResolvedAttachment[];
}

/**
 * The runtime's resolved record for the "everything" shape — every field the
 * prompt reads, populated: the two-entry workspace rooted at `/ws`, the
 * skills, the channel, the referenced files on the spec, the input files with
 * one inline image and one that degraded, the presigned storage, all five
 * standing facts. `composeSystemPrompt` reads it exactly as `buildEngine`
 * does.
 */
function everythingInput(shape: EverythingShape): TurnInput {
  const sessionId = TURN_INPUT_FIXTURE_IDS.sessionId;
  const executionId = TURN_INPUT_FIXTURE_IDS.executionId;
  const execution = create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: executionId, org: TURN_INPUT_FIXTURE_IDS.org, name: executionId }),
    spec: create(AgentExecutionSpecSchema, {
      sessionId,
      message: USER_MESSAGE,
      workspaceFileRefs: ["app/src/deploy.ts", "docs/RELEASES.md"],
      executionConfig: create(ExecutionConfigSchema, {
        ...(shape.interactionMode !== undefined ? { interactionMode: shape.interactionMode } : {}),
        ...(shape.buildFromPlan !== undefined ? { buildFromPlan: shape.buildFromPlan } : {}),
      }),
    }),
  });
  return turnInputFixture({
    execution,
    skills: { root: [...shape.skills], bySubAgent: new Map() },
    workspace: {
      dirs: ["/ws"],
      primaryDir: "/ws",
      gitWorkspace: false,
      captureMode: false,
      changeSetId: `${executionId}:0`,
      provision: { workspaceDirs: ["/ws"], provisionResults: [...PROVISION_RESULTS], workspaceBackend: mockWorkspaceBackend() },
    },
    mcp: {
      servers: [],
      channelMessaging: CHANNEL_MESSAGING,
      leases: { global: false, categories: new Set(), servers: new Set() },
      policies: new Map(),
    },
    attachments: {
      results: [...(shape.inputFiles ?? INPUT_FILES)],
      visionImages: [{ filename: "diagram.png", mimeType: "image/png", base64: "", byteSize: 4096 }],
      visionNotViewable: [{ path: ".stigmer/inputs/huge.png", reason: "too_large" }],
    },
    artifactStorage: makeInMemoryArtifactStorage({ downloadUrlKind: "presigned" }).storage,
    standing: {
      contextBridge: "Earlier the user asked for a staging deploy; it succeeded.",
      senderIdentity: { value: "15550001111", kind: "whatsapp_phone" },
      sessionContext: "The user is the on-call engineer this week.",
      declaredPreferences: { orgContext: "We deploy to eu-west-1.", userContext: "Keep answers terse." },
      conversationCatchup: undefined,
      selectRecalledMemories: async () => RECALLED,
    },
  });
}

/** The prompt as `buildEngine` composes it: the production mapping over the record and the awaited memory selection. */
async function systemPromptOf(input: TurnInput): Promise<string> {
  return composeSystemPrompt(input, await input.standing.selectRecalledMemories());
}

// ---------------------------------------------------------------------------
// Goldens
// ---------------------------------------------------------------------------

describe("native system prompt goldens", () => {
  it("everything at once, nine skills so the relevance filter fires", async () => {
    const prompt = await systemPromptOf(everythingInput({ skills: NINE_SKILLS }));
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.everything.prompt.md");
  });

  it("three skills, below the relevance threshold: every skill listed, no also-available note", async () => {
    const prompt = await systemPromptOf(everythingInput({ skills: THREE_SKILLS }));
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.skills-below-threshold.prompt.md");
  });

  it("plan mode appends the shared directive plus the native read-boundary sentence, last", async () => {
    const prompt = await systemPromptOf(everythingInput({ skills: THREE_SKILLS, interactionMode: InteractionMode.PLAN }));
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.plan-mode.prompt.md");
  });

  it("build-from-plan points at the attached approved plan", async () => {
    const prompt = await systemPromptOf(
      everythingInput({ skills: THREE_SKILLS, buildFromPlan: true, inputFiles: [...INPUT_FILES, PLAN_ATTACHMENT] }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.build-from-plan.prompt.md");
  });

  it("the minimal prompt: no instructions, nothing else — the default instructions and the two rule blocks", async () => {
    const prompt = buildEnhancedSystemPrompt({
      instructions: "",
      provisionResults: [],
      containerRoot: "",
      skillsPromptSection: "",
      workspaceFileRefs: [],
      workspaceRoot: "/ws",
      inputFiles: [],
    });
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.minimal.prompt.md");
  });
});
