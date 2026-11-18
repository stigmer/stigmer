# Stigmer's plugin for coding agents

`@stigmer/coding-agent-plugin`: one plugin for Claude Code, Codex and Cursor,
and the guide a coding agent follows to set Stigmer up for a person's project.
It is the "Let your coding agent set it up" door
(`docs/getting-started/coding-agent.mdx`).

This is not `plugins/`, the catalogue Stigmer installs into its own agents. This
one is for the coding agent on a person's laptop.

## What is in it

- `plugin/skills/stigmer/SKILL.md`: the guide. `stigmer coding-agent` prints it
  without its frontmatter (`client-apps/cli/src/commands/coding-agent.ts`), so
  a person who pastes the prompt gets the guide released with the CLI they
  installed.
- `plugin/.mcp.json`: the bundled `stigmer mcp-server`, for making, running and
  reading agents once setup is done.
- The manifests and marketplace files of each tool, one plugin named `stigmer`
  at the folder's root: `.claude-plugin/` (Claude Code), `.cursor-plugin/`
  (Cursor), `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`
  (Codex).

## Build, publish, install

`npm run build` (`scripts/build.mjs`) copies `plugin/` to `dist/plugin/`,
stamps each manifest's `version` with the package's, writes `dist/index.js`
(`GUIDE`, `PLUGIN_REPOSITORY`), and fails if `npm pack` would leave a staged
file out. The release train publishes the package with the other libraries,
before the CLI that depends on it (`scripts/publish-libs.mjs`), which stamps
the release's version into the three manifests as into `package.json` and
refuses to publish one still at `0.0.0-dev`.

`reconcile-coding-agent-plugin.yaml` then makes the public repository
`stigmer/coding-agent-plugin` equal to the npm `latest` package's
`plugin/` folder (this build's `dist/plugin/`; the package is published from
`dist/`), the way `reconcile-homebrew.yaml` keeps the tap. People install
from that repository; the install lines are on the docs page.

## Tests

`npm run test -w @stigmer/coding-agent-plugin` builds the package and reads it
with Stigmer's own plugin reader (`@stigmer/plugin-package`), which knows all
three dialects: every manifest names the one plugin at the package's version,
the skill and the MCP server read with no warning, and each marketplace file
offers the plugin at the root. The CLI's suite holds the guide to the CLI
(`client-apps/cli/src/commands/__tests__/coding-agent.test.ts`): every
`stigmer …` line it names is a command this CLI has, with flags it declares.
Run both after a change here. The door end to end, in a real coding agent, is
`make door-coding-agent` (`test/install/coding-agent-door.mjs`), by hand.

## The question bank

`evals/` is the bank: the questions and jobs a developer brings to their
coding agent about Stigmer, one eval case per folder, grouped by job
(`deciding`, `setup`, `design`, `integrate`, `run-fix`, `quality`, `reach`,
`own-server`, `admin`, `stuck`). It lives beside `plugin/`, not in it, so it
is never published with the plugin. Every case is in the format both
`claude plugin eval` and Stigmer's own eval reader take: a `prompt.md` with
the person's words, and `graders/`:

- `criteria.md`: the judge's rubric, written from the docs page the answer
  comes from;
- `cites-the-page.md`: the answer names that page (`docs/<page>`, or several
  as `docs/(<page>|<page>)`);
- `skill-fired.md`: whether the plugin's skill loaded, an indicator outside
  the score;
- for a case that acts on Stigmer (tagged `acts`), `reports-the-fact.md`: a
  fact only a real read of the fixture returns; for a destructive ask,
  `does-not-act.md`: the trace holds no such call, and the rubric passes only
  when the agent asks the person first.

`make bank-coding-agent` (`test/install/coding-agent-bank.mjs`) runs the bank
in Claude Code, with the plugin and without it, against a hermetic local
Stigmer seeded with `evals/_fixture/` (an agent with a finished run, one whose
runs fail, a skill), its runner on the fake model, and prints the score per
job. A case passes only when every try passes every scored grader. A try
Claude Code could not run (a usage limit, a crash) is no reading: the table
counts it, leaves its case unread and says the run is not a valid reading,
and the command exits non-zero, so such a run is never taken as a score. It
calls a real
model on your own Claude Code sign-in, so it is by hand, in no lane;
`BANK_ARGS` narrows it (`--tag=<job>`, `--case=<glob>`, `--runs=<n>`) and
bounds it (`--max-cost-usd`, default $60 API-equivalent).

To add a case: write the question in the person's own words under its job's
folder, read the docs page that answers it, and write the rubric from that
page; copy the frontmatter and `skill-fired.md` from a neighbour, since every
case shares one tool list and turn cap. A question no page answers is a docs
gap: write the case anyway, and fix the docs. `__tests__/bank.test.ts` holds
the bank's shape in the gate: Stigmer reads it with no finding, every cited
page exists, every concept page, getting-started page and guide group has a
question, and every job has at least four.
