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

/** `docs/concepts/skills.mdx`: the Skill it prints as one SKILL.md, whose page shows the description over the body. */
export const SKILL_EXAMPLE = {
  page: "concepts/skills",
  name: "variance-report",
  description:
    "How to lay out a variance report and which variances to flag. Use when a customer asks for a variance report, or hands over a ledger to review against its budget.",
  skillMd: "---\nname: variance-report\ndescription: >\n  How to lay out a variance report and which variances to flag. Use when a\n  customer asks for a variance report, or hands over a ledger to review against\n  its budget.\n---\n\n# Variance report\n\n## What to flag\n\n- Flag every account more than 10% over or under its budget.\n- Flag any account more than 5,000 over or under, whatever its percentage.\n- Revenue under budget is always flagged, even by 1%.\n\n## Layout\n\nSave the report as `variance-report.md`, laid out like\n`references/report-template.md`:\n\n- a two-sentence summary of the quarter;\n- one table of every account (budget, actual, variance in money and as a\n  percentage), flagged accounts first;\n- one line under the table for each flagged account, saying what could explain\n  it.\n\n## When the ledger doesn't add up\n\n- An account with no budget is listed but not flagged; say so in its line.\n- If the totals don't match the ledger's own total row, stop and say which rows\n  differ instead of writing the report.\n",
} as const satisfies DocsExample;

/**
 * `docs/guides/environments/set-up-an-environment.mdx`: the Environment it
 * makes, in the console and as a file, the data team's Agent it becomes the
 * default of, and how a conversation names it.
 */
export const ENVIRONMENT_EXAMPLE = {
  page: "guides/environments/set-up-an-environment",
  name: "Data science",
  slug: "data-science",
  description: "pandas and poppler, GitHub and our API only",
  hosts: ["api.github.com", "our-api.example.com"],
  apt: ["poppler-utils"],
  pip: ["pandas", "sqlalchemy==2.0.30"],
  agent: "data-analyst",
  conversationRow: "data-science · the agent's default",
} as const satisfies DocsExample;

/** Every page's example, for the site's check. */
export const DOCS_EXAMPLES: readonly DocsExample[] = [ROUTINE_EXAMPLE, AGENT_EXAMPLE, SKILL_EXAMPLE, ENVIRONMENT_EXAMPLE];
