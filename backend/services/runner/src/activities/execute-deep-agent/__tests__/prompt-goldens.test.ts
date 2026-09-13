/**
 * The native system prompt, whole, as goldens.
 *
 * Every other prompt test in this directory asserts with `toContain`; the
 * hermetic goldens are status JSON and never see a prompt. So until S3 M5 no
 * test pinned a rendered prompt byte for byte, and the relevance-filtered
 * `## Skills` section (eight or more skills, `turn-setup.ts`
 * `renderRootSkillsSection`) had no test at all. These goldens are the
 * photograph taken BEFORE the shared prompt glue moved into
 * `shared/prompt-sections.ts` (S3 M5, Q-M5-1), so the move could be proven
 * byte-identical — the same discipline M0 applied to the activity's status.
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
 * A golden moves only under a ruling quoted in this header; never a quiet
 * `-u`. Regenerate with `npx vitest run -u <this file>` once ruled.
 */

import { describe, it, expect } from "vitest";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ChannelTemplate, MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";

import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnInput } from "../../../harness/types.js";
import type { ResolvedAttachment } from "../../../shared/attachment-resolver.js";
import type { SkillMetadata } from "../../../shared/skill-resolver.js";
import type { RecalledMemoriesContent } from "../../../shared/recalled-memories.js";
import { formatChannelTemplatesSection } from "../../../shared/channel-attachment.js";
import { SourceType, type ProvisionResult } from "../../../shared/workspace/types.js";
import { buildEnhancedSystemPrompt, type PromptBuilderInput } from "../prompt-builder.js";
import { renderRootSkillsSection } from "../turn-setup.js";

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

/** The runtime's resolved record for the "everything" shape; the golden tests hand it to the same mapping `buildEngine` uses. */
function everythingInput(skills: readonly SkillMetadata[]): TurnInput {
  return turnInputFixture({
    message: USER_MESSAGE,
    skills: { root: [...skills], bySubAgent: new Map() },
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

/**
 * The mapping `turn-setup.ts` `buildEngine` performs from the resolved record
 * to the builder's input, reproduced here field for field (the golden pins
 * the prompt those fields render). The engine-only inputs it reads beside
 * `TurnInput` — the provision results, the container root, the storage's URL
 * kind, the vision facts — are stated as the fixture's values.
 */
function promptInputOf(
  input: TurnInput,
  extra: Partial<PromptBuilderInput> & { readonly recalledMemories?: RecalledMemoriesContent },
): PromptBuilderInput {
  const spec = input.execution.spec!;
  return {
    instructions: input.blueprint.instructions,
    provisionResults: [...PROVISION_RESULTS],
    containerRoot: "/ws",
    skillsPromptSection: renderRootSkillsSection(input),
    channelTemplatesPromptSection: formatChannelTemplatesSection(CHANNEL_MESSAGING) || undefined,
    workspaceFileRefs: ["app/src/deploy.ts", "docs/RELEASES.md"],
    workspaceRoot: "/ws",
    inputFiles: INPUT_FILES,
    vision: {
      inlineFilenames: ["diagram.png"],
      notViewable: [{ path: ".stigmer/inputs/huge.png", reason: "too_large" }],
    },
    downloadUrlKind: "presigned",
    interactionMode: spec.executionConfig?.interactionMode,
    buildFromPlan: spec.executionConfig?.buildFromPlan,
    contextBridge: input.standing.contextBridge,
    senderIdentity: input.standing.senderIdentity,
    sessionContext: input.standing.sessionContext,
    declaredPreferences: input.standing.declaredPreferences,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Goldens
// ---------------------------------------------------------------------------

describe("native system prompt goldens (S3 M5, Q-M5-1)", () => {
  it("everything at once, nine skills so the relevance filter fires", async () => {
    const input = everythingInput(NINE_SKILLS);
    const prompt = buildEnhancedSystemPrompt(
      promptInputOf(input, { recalledMemories: await input.standing.selectRecalledMemories() }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.everything.prompt.md");
  });

  it("three skills, below the relevance threshold: every skill listed, no also-available note", async () => {
    const input = everythingInput(THREE_SKILLS);
    const prompt = buildEnhancedSystemPrompt(
      promptInputOf(input, { recalledMemories: await input.standing.selectRecalledMemories() }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.skills-below-threshold.prompt.md");
  });

  it("plan mode appends the shared directive plus the native read-boundary sentence, last", async () => {
    const input = everythingInput(THREE_SKILLS);
    const prompt = buildEnhancedSystemPrompt(
      promptInputOf(input, { interactionMode: InteractionMode.PLAN, recalledMemories: RECALLED }),
    );
    await expect(prompt).toMatchFileSnapshot("./goldens/system-prompt.plan-mode.prompt.md");
  });

  it("build-from-plan points at the attached approved plan", async () => {
    const input = everythingInput(THREE_SKILLS);
    const prompt = buildEnhancedSystemPrompt(
      promptInputOf(input, {
        buildFromPlan: true,
        inputFiles: [
          ...INPUT_FILES,
          { filename: "release_aex1.plan.md", relativePath: ".stigmer/inputs/release_aex1.plan.md", sizeBytes: 2048 },
        ],
        recalledMemories: RECALLED,
      }),
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
