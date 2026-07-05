/**
 * The Plan-mode prompt directive, shared by both harnesses.
 *
 * Plan mode's output contract spans three components that must agree:
 * - the model produces the plan as its FINAL message (this directive),
 * - the runner publishes that final message verbatim as a plan markdown
 *   artifact, named from the plan's title (`plan-artifact.ts` —
 *   `extractFinalPlanText`, `planArtifactName`),
 * - the SDK promotes the same message to a first-class plan document in the
 *   thread and offers "Build from plan".
 *
 * This module is the single source of truth for how the model is told to
 * behave, so the two harnesses can never drift apart on the contract. Each
 * harness wraps the directive in its own prompt framing (the Cursor harness
 * uses XML-tag sections, the native harness markdown headings) — the framing
 * is house style; the words are shared.
 *
 * Enforcement is separate from instruction: the native harness ALSO denies
 * filesystem writes at the tool layer (see execute-deep-agent/setup.ts), so
 * for it this directive is guidance toward a well-formed plan, not the
 * enforcement mechanism. The Cursor harness has no tool-level lever (the
 * Cursor SDK exposes no mode parameter), so there this directive is the
 * enforcement — a documented stopgap.
 */

/**
 * Directive body injected into the system prompt of every Plan-mode
 * execution. Deliberately explicit about the deliverable's shape: the final
 * message is published verbatim as a plan document (whose filename is derived
 * from the leading `#` title), so a fenced or chat-suffixed plan degrades the
 * reviewable document the user sees.
 */
export const PLAN_MODE_DIRECTIVE = [
  "IMPORTANT: You are in Plan mode — a read-only analysis turn whose " +
    "deliverable is an implementation plan.",
  "",
  "Constraints:",
  "- Do NOT create, edit, or delete any files.",
  "- Do NOT run commands that modify the filesystem or any external state.",
  "- Only read, search, and analyze.",
  "",
  "Deliverable — your FINAL message IS the plan. It is published verbatim " +
    "as a plan document that the user reviews and builds from, so:",
  "- Write it as a complete, well-structured markdown document: start with " +
    "a single `#` title and organize the work under `##` section headings. " +
    "Use lists and tables where they aid scanning.",
  "- Reference concrete file paths and describe the specific changes " +
    "planned for each.",
  "- Do NOT wrap the document in a code fence.",
  '- Do NOT end with conversational closers ("Let me know...", "Shall I ' +
    'proceed?") — the next step is the user\'s Build action, and trailing ' +
    "chat would be published as part of the document.",
].join("\n");
