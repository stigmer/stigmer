/**
 * The checkpoint prompt the Stigmer harness's summarizer is given
 * (`compaction.ts` passes it to deepagents' `createSummarizationMiddleware`
 * as `summaryPrompt`): the one source of truth for what a model is told when
 * its conversation is compacted.
 *
 * WHY A CHECKPOINT
 * ----------------
 * After the first compaction the person's opening message lives only in the
 * summary: deepagents builds every later call from the summary plus the
 * messages after the cutoff, and every message before it goes to the
 * summarizer. deepagents' default prompt asked for a recap ("the main topics
 * discussed"), and on a live run the agent lost its remaining steps and its
 * closing instruction after one compaction, ran a step nobody asked for, and
 * still said "done" (stigmer#2539). This prompt asks for what the next call
 * needs to carry on: the objective and the person's instructions in their own
 * words, what is done, in progress and next, and the exact names that
 * matter. The structure (seven headings, the rules, updating the previous
 * checkpoint in place) is OpenCode's compaction checkpoint (anomalyco/opencode
 * at 74f8d48, `packages/core/src/session/compaction.ts`, MIT), in our words.
 *
 * WHAT THE SUMMARIZER READS
 * -------------------------
 * deepagents sends one human message, no system prompt, no tools: this
 * prompt with the conversation pasted in as text at `{conversation}`, one
 * line per message, `Human:`, `AI:` or `Tool:` first (`getBufferString`).
 * The system prompt and the platform's advisories never reach it. The
 * person's messages do, the opening and any sent while the turn worked
 * (both are state), and so does deepagents' own summary of earlier work, a
 * `Human:` line too, which is why the prompt says who speaks. In a subagent's
 * stack the `Human:` side is the task its caller handed it.
 *
 * ONE PROMPT FOR BOTH CASES
 * -------------------------
 * A later compaction summarizes the previous summary together with the newer
 * messages. OpenCode gives that case a prompt of its own; deepagents takes one
 * `summaryPrompt` per middleware, so the update instruction is conditional
 * ({@link SUMMARY_UPDATE_CLAUSE}). It describes the previous summary instead
 * of quoting deepagents' wrapper, which has two shapes (with `<summary>` tags
 * when the history was offloaded, a plain lead-in when the offload failed).
 *
 * WHY THE CONVERSATION COMES LAST
 * -------------------------------
 * deepagents pastes the conversation in with `String.prototype.replace` and a
 * string replacement (deepagents 1.14.1, `createSummary`), so a `$'` in the
 * conversation, common in shell output, is replaced by everything after the
 * placeholder, and `` $` `` by everything before it. With the instructions
 * first and only one closing line after the conversation, a `$'` can paste
 * that one line, as it pastes deepagents' own trailing "Summary:" today.
 * OpenCode puts its instructions last to reuse the prompt cache of the
 * agent's own request; deepagents' summary call is a fresh single message
 * with no cache to reuse, so this order gives nothing up. The defect is
 * upstream's; the order only shrinks what it can do.
 *
 * The test doubles recognize a summary call by {@link SUMMARY_PROMPT_OPENING}
 * (the kit's `execute-deep-agent/__test-utils__/scripted-model.ts` imports
 * it; `test/support/src/mock-llm.ts`, another package, keeps a copy that its
 * own test reads back from this file).
 */

/** The prompt's first sentence: the one line the test doubles match a summary call on. */
export const SUMMARY_PROMPT_OPENING = "You are writing the checkpoint another agent will resume this work from.";

/** Who speaks in the pasted conversation (the header, "What the summarizer reads"). */
const WHO_SPEAKS =
  "The conversation below is between a user and an agent, one line per message. Lines starting with `Human:` are the user's words " +
  "(in a delegated task, the words of the agent that delegated it), except a summary of earlier work. Lines starting with `AI:` are the " +
  "agent's own replies and tool calls, and lines starting with `Tool:` are what its tools returned.";

/** The instruction that turns a later compaction into an update of the previous checkpoint. */
export const SUMMARY_UPDATE_CLAUSE =
  "If the conversation opens with a summary of earlier work, that summary is the existing checkpoint: update it into one checkpoint. " +
  "Newer history wins. Keep what it says unless newer history settles, replaces or contradicts it, and move finished work out of Active. " +
  "Drop what no longer matters for continuing the work.";

/** The checkpoint's sections, in order: the shape the next call resumes from. */
export const CHECKPOINT_HEADINGS = [
  "## Objective",
  "## Requirements",
  "## Decisions",
  "## Work State",
  "### Completed",
  "### Active",
  "### Blocked",
  "## Next Move",
  "## Relevant Files",
  "## Important Context",
] as const;

const TEMPLATE = `Write the checkpoint in exactly these sections, in this order, under these headings. Write "(none)" under a heading with nothing to say.

## Objective
- What the user wants accomplished, in one or two short sentences.

## Requirements
- Every constraint, preference, scope limit and instruction from the user that still applies, including how the work must end and what it must deliver.

## Decisions
- Decisions already made, each with its reason.

## Work State
### Completed
- Parts of the objective that are done.
### Active
- Parts being worked on now, and where each stands.
### Blocked
- What is stuck, and why.

## Next Move
1. The next actions, in order, through the end of the task.

## Relevant Files
- \`path\`: why it matters. At most 15, most important first: only what the next agent must open, not every file read or changed.

## Important Context
- Facts the next agent cannot continue without and cannot easily find again.`;

const RULES = `Rules:
- Carry forward every request and instruction from the user not yet carried out, in the user's exact words: messages the user sent while the agent worked, and every instruction about how the work must end or what it must deliver. Drop one only when newer history shows it done or withdrawn.
- Keep each section short: terse one-line bullets, not paragraphs or nested lists.
- Keep exact identifiers: file paths, symbols, commands, error strings, URLs and ids.
- Record the state of changes: uncommitted, committed, pushed, under review or merged.
- Never mention the summary, the checkpoint or that the conversation was compacted.
- Do not continue the task and do not call tools.
- Return only the checkpoint, with nothing before or after it.`;

/** deepagents' placeholder for the conversation, substituted once. */
const CONVERSATION_PLACEHOLDER = "{conversation}";

/** The line after the conversation; the only text a `$'` in it can paste (the header). */
export const SUMMARY_PROMPT_CLOSING = "Write the checkpoint now.";

/** The whole prompt: instructions first, the conversation last (the header). */
export const SUMMARY_PROMPT = [
  SUMMARY_PROMPT_OPENING,
  WHO_SPEAKS,
  SUMMARY_UPDATE_CLAUSE,
  TEMPLATE,
  RULES,
  `<conversation>\n${CONVERSATION_PLACEHOLDER}\n</conversation>`,
  SUMMARY_PROMPT_CLOSING,
].join("\n\n");
