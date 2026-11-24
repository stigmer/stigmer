/**
 * The docs front page's setup prompt, as data: the prompt a person copies and
 * the line that says where it goes.
 *
 * The prompt is the brand's own (brand/coding-agent-prompt.ts, whose test
 * holds the setup page's, the console's and the plugin README's copies to
 * it), so the front page cannot say it another way. Data only, with relative
 * imports: the markdown export reads it (src/lib/llms-pages.ts).
 */
import { CODING_AGENT_PROMPT } from "../../../../brand/coding-agent-prompt";

/** The prompt, as one paragraph: what the block shows and what Copy puts on the clipboard. */
export const PROMPT = CODING_AGENT_PROMPT;

/** Where the prompt goes and what the reader needs first, which is nothing. */
export const THEN = "Then paste it into your coding agent, opened in your app's folder. It makes your Stigmer account when it signs you in.";

/** The button, before a press and for a moment after one. */
export const COPY = "Copy the prompt";
export const COPIED = "Copied";
