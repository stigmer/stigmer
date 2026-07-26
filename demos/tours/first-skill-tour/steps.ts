/**
 * First Skill outcome tour — the page-level "what you'll build" preview at
 * the top of "Your first Skill". Two beats: `skillRefs` joins the session
 * (the page's one code change), and the same question the quickstart's
 * agent fumbled comes back grounded in the reader's actual return policy.
 *
 * Deliberately two beats where the other getting-started overviews run
 * five: the creation mechanics (author SKILL.md, zip, upload) are owned by
 * `skill-creation-tour`, embedded further down this same page — repeating
 * any of its frames here would depict the same screen twice on one page.
 * This tour is only the outcome.
 *
 * Continuity: the code and terminal beats live in the reader's quickstart
 * project (`_shared/quickstart-workspace.ts`). `SKILL_REFS_CODE` is the
 * exact midpoint of one continuous file — `quickstart-tour`'s DOMAIN_CODE
 * (previous page) plus the `skillRefs` line, and `connect-tools-tour`'s
 * MCP_REFS_CODE (next page) minus the `mcpServerRefs` line. The question
 * is the one quickstart-tour's final beat asks and fails to answer.
 *
 * Import discipline: `scenar narrate` loads this file in plain Node (tsx),
 * so it must only pull pure modules — type-only `@scenar/react` imports,
 * `_shared` data, and literals. Component rendering lives in `index.tsx`.
 */
import type { ScenarioStep, TerminalLine } from "@scenar/react";
import { QUICKSTART_WORKSPACE } from "../_shared/quickstart-workspace";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type FirstSkillTourStep =
  | { view: "code-skill-refs" }
  | { view: "terminal-expert" };

// ---------------------------------------------------------------------------
// Fixture data — code listing (beat 0)
// ---------------------------------------------------------------------------

/**
 * The reader's `ask-agent.ts` with the Skill attached. Identical to
 * `quickstart-tour`'s DOMAIN_CODE except for the `skillRefs` line — the
 * page's claim that "the only change is adding skillRefs" is the story,
 * so the highlight below carries it. The depicted slug (`return-policy`)
 * is the skill `skill-creation-tour` uploads further down this page.
 */
export const SKILL_REFS_CODE = [
  `// ${QUICKSTART_WORKSPACE.entryFile} — Add your Skill to the session`,
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  "  name: `session-${Date.now()}`,",
  '  org: "my-org",',
  '  skillRefs: [{ org: "my-org", slug: "return-policy" }],',
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "What is your return policy for defective items?",',
  "});",
];

/** 0-based index of the `skillRefs` line — the single line beat 0 highlights. */
export const SKILL_REFS_HIGHLIGHT_LINE = SKILL_REFS_CODE.findIndex((line) =>
  line.includes("skillRefs"),
);

// ---------------------------------------------------------------------------
// Fixture data — terminal output (beat 1)
// ---------------------------------------------------------------------------

/**
 * The grounded answer — the same output the page's "Run it again" step
 * quotes, so the embed and the prose cannot tell different stories.
 */
export const EXPERT_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: `npx tsx ${QUICKSTART_WORKSPACE.entryFile}` },
  { type: "blank", text: "" },
  { type: "output", text: "Defective items can be returned at any time," },
  { type: "output", text: "regardless of the standard 14-day return window." },
  { type: "output", text: "Simply ship the item back with a brief" },
  { type: "output", text: "description of the defect — we cover return" },
  { type: "output", text: "shipping at no cost to you." },
  { type: "blank", text: "" },
  { type: "output", text: "Once we receive the item, your refund will be" },
  { type: "output", text: "processed within 3–5 business days to your" },
  { type: "output", text: "original payment method." },
];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * No interactions anywhere: step 0 must be interaction-free (the packed
 * embed arms step-0 interactions at mount, under the poster), and the
 * editor/terminal shells expose no camera or cursor anchors to aim at —
 * the highlighted skillRefs line is the attention cue.
 */
export const firstSkillTourSteps: ScenarioStep<FirstSkillTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "code-skill-refs" },
    narration:
      "Back in your quickstart project, add skill refs to the session. That's the only code change.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-expert" },
    narration:
      "Same question as the quickstart, completely different answer. Grounded in your actual return policy.",
  },
];
