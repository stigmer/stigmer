/**
 * The one box an opened step's contents sit in, whatever the step's kind: a
 * read's or a write's lines, a search's matches, a listing, a command's
 * output, a connected app's fields and an error's words. The drawing's
 * `.out` (the session page, S33 to S38): the faint ground, a hairline of the
 * muted border, a 6px corner (`rounded-lg`, the kit's radius), 8px 12px
 * inside, mono 12/16 in the muted foreground, which the theme's contrast
 * contract holds on `--stgm-muted-faint` (`sdk/theme/src/contract/pairs.ts`).
 *
 * Inside a step the box is the step body's, drawn once: the parts a body is
 * made of (`ResultView`, `TerminalSession`, `McpToolDetail`) are asked for no
 * frame of their own (`framed={false}`), so a box is never drawn in a box.
 * A host that draws one of those parts on its own keeps the part's own frame.
 *
 * Classes, not a component: the box is a `<pre>` for lines, a `<div>` for a
 * grid of matches and a `<dl>` for fields, and each keeps its own element.
 *
 * @internal Not part of the public API.
 */
export const STEP_INSET =
  "stg:overflow-x-auto stg:rounded-lg stg:border stg:border-border-muted stg:bg-muted-faint stg:px-3 stg:py-2 stg:font-mono stg:text-xs stg:text-muted-foreground stg:whitespace-pre";

/**
 * The line under a step's box that says how much of it shows and what opens
 * the rest ("Lines 14–17 of 88 · Open the whole file", "Last 5 of 214 lines ·
 * Show all"): the drawing's `.out-more`, 12/16 muted, 4px under the box.
 *
 * @internal Not part of the public API.
 */
export const STEP_INSET_FOOT = "stg:mt-1 stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-1 stg:text-xs stg:text-muted-foreground";
