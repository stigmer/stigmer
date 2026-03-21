# Section Template: Code Showcase

<!--
  CODE SHOWCASE SECTION TEMPLATE
  ==============================
  Job: Prove — show it works.

  Code is the most persuasive element on a developer marketing site.
  A 5-line YAML that creates an agent carries more weight than a page
  of copy. This section exists to let code speak for itself.
-->

## Job

Prove that Stigmer works by showing real, minimal, impressive code. Let the code be the argument. The surrounding text exists only to set context — the code does the selling.

## Funnel Stage

Interest to Evaluation — the visitor wants to see what working with Stigmer actually looks like before committing to a deeper evaluation.

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Context label** | One line above the code block stating what it demonstrates | Positioned above the code. Format: "Define an agent in 5 lines of YAML" — a factual statement, not a marketing claim. |
| **Minimal example** | The code itself | Only essential lines. Self-explanatory without surrounding context. Complete enough to understand, minimal enough to be impressive. |
| **Syntax highlighting** | Language-tagged code block | Must use the correct language tag (`yaml`, `bash`, `typescript`, etc.) for proper highlighting. |
| **Copy button** | One-click clipboard copy | Positioned at the top-right corner of the code block. Provides visual feedback on copy. |

## Constraints

- **Minimalism**: The code must include only the lines necessary to demonstrate the capability. Strip comments, boilerplate, and optional fields. If the example works in 5 lines, do not show 15.
- **Self-explanatory**: A developer should understand what the code does without reading surrounding text. Field names, structure, and values should be self-documenting.
- **Language tag required**: Every code block must have a language tag for syntax highlighting and screen reader context.
- **Context label position**: Always above the code block, never below or inside it.
- **Runnable when possible**: If the code can be pasted and run (e.g., a `stigmer apply` YAML file or a `brew install` command), say so explicitly. "Paste this into `agent.yaml` and run `stigmer apply`."

## Copy Guidance

- The context label is a factual statement: "Define an agent in 5 lines of YAML," "Install and run your first agent in 3 commands." It is a caption, not a headline.
- Supporting text (if any) goes below the code block, not above. The code comes first — explanation second. This follows the "code before paragraph" required pattern from `copy-guidelines.json`.
- If showing multiple examples (e.g., YAML definition + terminal output), use tabs or a two-panel layout. Do not stack more than two code blocks vertically without a clear reason.
- Do not explain what the code does line by line. If the code needs line-by-line explanation, it is too complex for a showcase section. Simplify the example instead.

## Design Notes

- Code block background: Use the `--card` token or a slightly darker surface for contrast against the page background.
- Font: Geist Mono at weight 400. Font size: `text-sm` (14px) for readability without dominating the layout.
- Copy button: Top-right corner, `ghost` button variant, appears on hover (always visible on mobile).
- Tab interface (if multiple examples): Tabs above the code block, clearly labeled with the language or scenario name. Active tab uses `--primary` color.
- Section padding: `py-24` (96px) vertical. Code block max-width: `max-w-3xl` to prevent excessively wide lines.
- Animations: `fadeIn` on the code block. No stagger — code should appear as a single unit. Respect `prefers-reduced-motion`.

## Accessibility

- Code blocks use `<pre><code>` with the correct `language-*` class.
- Copy button has `aria-label="Copy code to clipboard"` and announces success ("Copied!") via `aria-live="polite"`.
- Tab interface (if used) follows the WAI-ARIA Tabs pattern: `role="tablist"`, `role="tab"`, `role="tabpanel"`, keyboard navigation with arrow keys.
- Code is horizontally scrollable on narrow viewports, never truncated or wrapped in a way that changes meaning.

## Quality Checklist

- [ ] Context label is a factual statement positioned above the code
- [ ] Code is minimal — only essential lines, no boilerplate
- [ ] Code is self-explanatory without surrounding text
- [ ] Code block has a language tag for syntax highlighting
- [ ] Copy button present and functional with visual feedback
- [ ] Code appears before any explanatory text (code-before-paragraph pattern)
- [ ] No more than two stacked code blocks without clear reason
- [ ] Horizontally scrollable on mobile, never truncated
- [ ] Copy button has `aria-label` and announces success
- [ ] Tab interface (if used) follows WAI-ARIA Tabs pattern
