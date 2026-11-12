/**
 * The docs front page's first-job block, as data: the recording its Terminal
 * tab plays, what that recording shows in words, the install line and the two
 * step-by-step pages its footer offers.
 *
 * `INSTALL` is the quickstart's first step, and `__tests__/first-job.test.tsx`
 * holds it there as `docSteps` reads the page, as the homepage's closing
 * commands are held. Data only, with relative imports: the markdown export
 * reads it (src/lib/llms-pages.ts).
 */
import { JOB } from "../../../../brand/job-story";

/** The terminal kit's recording the Terminal tab plays (sdk/ink/src/recordings.ts). */
export const RECORDING = "first-job";

/** What the recording shows, for a reader who cannot see it; the markdown export carries it too. */
export const TERMINAL_ALT =
  `stigmer run hands ${JOB.agent} the customer's ${JOB.ledger} with "${JOB.message}" ` +
  `The Agent reads the ledger, writes ${JOB.report}, says which accounts it flagged and works for 38s, ` +
  `and the CLI downloads the report into ./out.`;

/** The quickstart's install line, Homebrew's. */
export const INSTALL = "brew install stigmer/tap/stigmer";

/** The two pages that walk the job step by step: the terminal's, then the app's. */
export const STEP_BY_STEP = [
  { title: "Your first agent job", href: "/docs/getting-started/quickstart" },
  { title: "Do the same job from your app", href: "/docs/getting-started/call-from-your-app" },
] as const;
