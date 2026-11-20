# Stigmer's plugin for coding agents

`@stigmer/coding-agent-plugin`: one plugin for Claude Code, Codex and Cursor
that answers a person's questions about Stigmer from the live docs, and the
guide a coding agent follows to set Stigmer up for their project.
It is the "Let your coding agent set it up" door
(`docs/getting-started/coding-agent.mdx`).

This is not `plugins/`, the catalogue Stigmer installs into its own agents. This
one is for the coding agent on a person's laptop.

## What is in it

- `plugin/skills/stigmer/SKILL.md`: the front door. It answers any question
  about Stigmer from the live docs (`stigmer docs search` and `stigmer docs
  read`, or the tool server's `search_docs` and `read_doc`), cited, checks the
  person's installed CLI and server before naming a command or feature, and
  carries the rules for acting for a person (`AGENT_RULES`,
  `mcp-server/src/instructions.ts`). Its "What Stigmer is", map and "when the
  answer isn't in the docs" sections are the docs assistant's
  (`docs-agent/skills/stigmer-docs/SKILL.md`), word for word.
- `plugin/skills/stigmer-setup/SKILL.md`: the setup guide. `stigmer
  coding-agent` prints it without its frontmatter
  (`client-apps/cli/src/commands/coding-agent.ts`), so a person who pastes the
  prompt gets the guide released with the CLI they installed.
- `plugin/skills/stigmer-run/SKILL.md`: running the person's agents and
  reading their runs: an agent on a file in their project, the last run,
  its output files, why it failed, approvals, follow-ups, scores and evals.
  Command line first, each job's Stigmer tool beside it. Every `stigmer`
  command any plugin skill names is held to the CLI's command tree by the
  CLI's own suite (`client-apps/cli/src/commands/__tests__/coding-agent.test.ts`).
- `plugin/skills/stigmer-integrate/SKILL.md`: putting the person's agent in
  their own product, whatever the stack: whose run it is (the app's service
  account, the signed-in user, an organization per customer), then each job
  (a backend run on a file, streaming, the chat and its look, sign-in,
  approvals in their screens, moving from Claude Managed Agents) as a method
  and the docs pages to read for their language. The calls live on those
  pages, a tab per language, not in the skill.
- `plugin/.mcp.json`: the bundled `stigmer mcp-server`, for making, running and
  reading agents once setup is done.
- `plugin/hooks/`: the guard. `hooks.json` is Claude Code's: a `PreToolUse`
  hook (`guard.mjs`, deciding in `decide.mjs`) that asks the person before a
  destructive tool, before answering a run's approval with allow, and before a
  `stigmer` command forced past its own question, even after they allowed the
  plugin's tools. Codex and Cursor each load `hooks/hooks.json` when their
  manifest names no hooks file, and would run Claude Code's hook wrongly, so
  their manifests name an empty file each (`codex-hooks.json`,
  `cursor-hooks.json`). Codex asks before the tools from their marks
  (`mcp-server/src/domains/toolmarks.ts`).
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
offers the plugin at the root. `__tests__/front-door.test.ts` holds the front
door's shared sections to the docs assistant's and its rules to
`AGENT_RULES`; `__tests__/guard.test.ts` holds the guard's tool list to the
tools the full roster marks destructive and tests every decision. The CLI's
suite holds the guard's command list to every command with a `--force`
option (`client-apps/cli/src/commands/__tests__/coding-agent.test.ts`). The
CLI's suite holds the guide to the CLI
(`client-apps/cli/src/commands/__tests__/coding-agent.test.ts`): every
`stigmer …` line it names is a command this CLI has, with flags it declares.
Run both after a change here. The door end to end, in a real coding agent, is
`make door-coding-agent` (`test/install/coding-agent-door.mjs`), by hand. The
plugin on the job after setup, putting the agent in an existing app from a
one-line ask, is `make walk-coding-agent-app APP=ledgerly-nextjs` (Next.js) or
`APP=statements-fastapi` (FastAPI) (`test/install/coding-agent-app.mjs`), by
hand: it passes when one of the app's signed-in customers uses the agent in the
app and the conversation is theirs.

## The question bank

`evals/` is the bank: the questions and jobs a developer brings to their
coding agent about Stigmer, one eval case per folder, grouped by job
(`deciding`, `setup`, `design`, `integrate`, `run-fix`, `quality`, `reach`,
`own-server`, `admin`, `stuck`). It lives beside `plugin/`, not in it, so it
is never published with the plugin. Every case is in the format both
`claude plugin eval` and Stigmer's own eval reader take: a `prompt.md` with
the person's words, and `graders/`:

- `must-<n>.md`: two to four, each one point the answer must make, without
  which the person would act wrongly or not at all, written from the docs
  pages the answer comes from;
- `fail-if-<n>.md`: one each for what fails an answer (wrong, invented, or
  contradicting the docs). Every judge grader holds one point: Claude Code's
  judge answers PASS or FAIL in one word, with no room to reason, and grades
  one point reliably where it misgrades a list. It reads the final message
  only, so an acting case's graders judge only what that message shows. It
  also reads a claim in an answer that denies it ("Stigmer runs no model of
  its own" failed "says Stigmer runs a model of its own"), so a fail-if line
  opens with "PASS unless the answer does this; an answer that says the
  opposite, denies it or warns against it does not do it:", then names the
  wrong claim exactly. A line that is a judgement ("runs Claude Managed
  Agents down", "a price other than these") says in its point what does not
  count ("saying plainly what it lacks", "leaving a price out"). Cases whose
  job has not been re-probed since still open with the older "PASS unless
  the answer does this:"; a job moves when its cases are next scored, after
  the same probe: its misgraded answers and a wrong answer for each line,
  through `claude plugin eval` on a scratch plugin whose case repeats a
  given answer word for word;
- `cites-the-page.md`: the answer links a page that answers it, as published
  (`stigmer\.ai/docs/<page>`, or several as `stigmer\.ai/docs/(<page>|<page>)`;
  a link to the docs' source on GitHub doesn't count). The list names every
  page that answers the question, and it is also the bank's record of which
  pages have a question. A case that acts may leave it out where its answer
  is the fixture's fact or the act itself;
- `skill-fired.md`: whether the plugin's skill loaded, an indicator outside
  the score;
- beside `graders/`, `welcome.md`: what a good answer may also say, never
  graded;
- for a case that acts on Stigmer (tagged `acts`), `reports-the-fact.md`: a
  fact only a real read of the fixture returns; for a destructive ask,
  `does-not-act.md`: the trace holds no such call, and the rubric passes only
  when the agent asks the person first.

`make bank-coding-agent` (`test/install/coding-agent-bank.mjs`) runs the bank
in Claude Code, with the plugin and without it, against a hermetic local
Stigmer seeded with `evals/_fixture/` (an agent with a finished run, one whose
runs fail, a skill), its runner on the fake model, and prints the score per
job. An acting try starts in a set-up person's project: the fixture agents'
manifests sit in its folder as `stigmer/<agent>.yaml`. A case passes only when every try passes every scored grader. A try
Claude Code could not run (a usage limit, a crash) is no reading: the table
counts it, leaves its case unread and says the run is not a valid reading,
and the command exits non-zero, so such a run is never taken as a score. It
calls a real
model on your own Claude Code sign-in, so it is by hand, in no lane;
`BANK_ARGS` narrows it (`--tag=<job>`, `--case=<glob>`, `--runs=<n>`) and
bounds it (`--max-cost-usd`, default $60 API-equivalent).

To add a case: write the question in the person's own words under its job's
folder, read the docs page that answers it, and write the rubric from that
page, one point per grader, each opening with the question its kind asks;
copy the frontmatter and `skill-fired.md` from a neighbour, since every case
shares one tool list and turn cap. A question no page answers is a docs
gap: write the case anyway, and fix the docs. `__tests__/bank.test.ts` holds
the bank's shape in the gate: Stigmer reads it with no finding, every judge
grader holds one point, every case has two to four Must points, every cited
page exists, every concept page, getting-started page and guide group has a
question, and every job has at least four.
