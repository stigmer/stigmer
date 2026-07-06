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
 *
 * Fence hygiene inside the document is part of the same contract. A plan
 * frequently quotes file content that itself contains fenced code blocks
 * ("insert this section into README.md"); with a same-length outer fence the
 * inner block's closer terminates the outer fence early and corrupts the
 * rendered document — on every client (the react SDK and the terminal
 * renderer alike). And because the plan viewers render top-level ```mermaid
 * fences as diagrams, the directive steers diagrams into the plan body proper
 * rather than leaving them buried, unrendered, inside quoted file content.
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
  '- Give the `#` title a concise, descriptive name for the work itself; do ' +
    'NOT prefix it with "Plan:" (this document is already a plan — the ' +
    "prefix is redundant and leaks into the plan's filename).",
  "- Reference concrete file paths and describe the specific changes " +
    "planned for each.",
  "- Do NOT wrap the document in a code fence.",
  "- When quoting content that itself contains fenced code blocks (e.g. a " +
    "proposed file section with a code sample inside), open the outer fence " +
    "with MORE backticks than any inner fence (four or more) — a same-length " +
    "inner closer would terminate the outer fence early and corrupt the " +
    "rendered document.",
  "- Fenced ```mermaid blocks at the top level of the document render as " +
    "diagrams in the plan viewer. When a diagram helps communicate the " +
    "design (architecture, flows), include it directly in the plan body — " +
    "not only inside quoted file content, where it stays unrendered source.",
  '- Do NOT end with conversational closers ("Let me know...", "Shall I ' +
    'proceed?") — the next step is the user\'s Build action, and trailing ' +
    "chat would be published as part of the document.",
].join("\n");
