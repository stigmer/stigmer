// The values a docs page prints and its pictures draw, one example per page.
//
// A docs page that shows a screen names things: a routine called
// `daily-variance-report`, its message, its time zone. The scene that draws
// the page's picture builds its fixtures from this file, and the acts that
// fill a form type these values, so the picture can show nothing its page
// does not say. The site's `docs-screens` test holds every value here to its
// page's source (whitespace collapsed, since a sentence wraps across MDX
// lines): a page edited without this file, or this file without its page,
// fails in the docs lane before the picture goes stale.
//
// It imports nothing: the catalogue (read under Node) and the site's tests
// read it, where the kit's sources do not load.

/** One page's example: the page, and each value it prints that its pictures draw. */
export interface DocsExample {
  /** The page, as its path under docs/ without the extension. */
  readonly page: string;
  /** Each value, by what it is; a list is several values, each printed on the page. */
  readonly [value: string]: string | readonly string[];
}

/** `docs/guides/routines/run-an-agent-on-a-schedule.mdx`: the routine it makes, in the console and as a file. */
export const ROUTINE_EXAMPLE = {
  page: "guides/routines/run-an-agent-on-a-schedule",
  org: "acme",
  name: "daily-variance-report",
  agent: "variance-reporter",
  message: "Report yesterday's ledger variances against budget, and save the report as variances.csv.",
  cron: "0 9 * * *",
  timeZone: "Asia/Kolkata",
} as const satisfies DocsExample;

/** `docs/concepts/agents.mdx`: the Agent its YAML prints, which its detail page renders field by field. */
export const AGENT_EXAMPLE = {
  page: "concepts/agents",
  name: "variance-reporter",
  description: "Turns a customer's ledger into a variance report.",
  instructions: [
    "You review a customer's quarterly ledger and report how each account did against its budget.",
    "Read the ledger with the ledger tools, map each line to the customer's chart of accounts, and lay out the report the way the variance-report Skill says.",
    "When an account needs a correcting entry, propose it with post_adjustment, which waits for a person's yes before anything is posted.",
  ],
  skills: ["variance-report", "chart-of-accounts"],
  plugin: "ledger",
  tools: ["Read", "Grep", "mcp__plugin_ledger_ledger"],
  envNames: ["LEDGER_API_URL", "LEDGER_API_KEY"],
  envDescriptions: ["Base URL of the ledger API", "API key for the ledger API"],
} as const satisfies DocsExample;

/** Every page's example, for the site's check. */
export const DOCS_EXAMPLES: readonly DocsExample[] = [ROUTINE_EXAMPLE, AGENT_EXAMPLE];
