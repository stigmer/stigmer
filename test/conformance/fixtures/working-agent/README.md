# The working agent's fixture

The harness benchmark's working agent, as a plugin in Claude Code's layout:
its skills, its `reviewer` sub-agent, the `orders-api` MCP server it calls,
and its `evals/` suite, which is the benchmark's quality arm
(`src/benchmark/quality-eval.ts`). The timing cells provision the agent from
the same skills and workspace (`src/support/working-agent.ts`). They are data, not code of this package. That is why they live
outside `src/` and `scripts/`, the two trees `tsconfig.json` includes.

Every byte here is part of the instrument. A change to a file moves every
benchmark cell that reads it, the same way a change to
`BARE_AGENT_INSTRUCTIONS` moves the bare cells and the request-shape goldens.
So a change here is reviewed as a change to what is measured.

## `evals/_fixture/workspace/`

A small Go module, `orders-sync`. It is copied fresh before every session, so
no session sees another session's edits. The copy goes to a fixed directory
outside this repository, for two reasons:

- The repository's `go.work` captures every `go` command run beneath its
  root, so a copy inside the tree would make the agent's own `go test` fail.
- The runner writes the workspace's host path into the prompt. A fixed path
  keeps the prompt identical from session to session, as a user's repository
  is.

It uses the standard library only, and its `go.mod` asks for Go 1.23. So
neither the agent's `go test` nor the benchmark's check ever downloads a
toolchain or a module.

It lives once in the suite, in a directory that is no case. Every case's
`scaffold.sh` copies it into the try's empty workspace, as a Claude Code
scaffold reaches a fixture beside its case.

The defects are planted on purpose, and the quality cases (`evals/<case>/`)
are graded against them:

- `duration/duration.go`: `ParseMinutes` knows only `h` and `m`, so `"90s"`
  is an error.
- `orders/store.go`: `FindByCustomer` builds its SQL by string formatting (an
  injection), and computes the offset as `page * pageSize` for 1-based pages,
  so page 1 skips the first page of results.
- `config/sync.yaml`: `sync.retry.max_attempts` is 50, above the service's
  limit of 10, and `timout` is a misspelled key.
- `syncer/syncer.go` holds the code defaults (`DefaultMaxAttempts = 5`) that
  the config overrides.

`policies/returns.md`, `data/signups.csv` and `CHANGELOG.md` are the sources
the support, data and changelog tasks answer from.

Two files are there for what the Stigmer harness does with a repository, and
are planted the same way:

- `AGENTS.md` holds the working rules the repository gives its agents. Its one
  rule, run `go vet ./...` as well as `go test ./...` before finishing a Go
  change, is written nowhere else: the workspace's `README.md` and the
  `repo-conventions` skill state the other conventions and ask only for
  `go test`. So an agent runs `go vet` because it read `AGENTS.md`, and the
  `follows-repo-instructions` case grades that alone.
- `logs/sync-2026-10-20.log` is a night's sync log of about 49,000
  characters in 410 lines: longer than the runner's 30,000-character bound on
  a tool result, in fewer lines than a read returns by default, so a whole
  read of it is cut. Its cause (the storefront answering 503 to every try) is
  written only in its last lines, after slow pages and skipped orders that are
  not the cause. It never names a config key, so the retry-limit question is
  not handed a second answer. The `working-long-log` timing cell and the
  `diagnose-sync-log` case ask why that sync failed. It is data, written once;
  `src/benchmark/__tests__/quality-suite.test.ts` pins its shape against the
  bound and the read limit.

The module is outside `go.work`, so the repository's `go vet` and `go build`
loops never visit it. Keep it `gofmt -s` clean so the repository's `gofmt -s -w .`
is a no-op here.

## `skills/`

Eight skills, one directory each, pushed to the working agent's organization
under their own names. Five serve a task: `repo-conventions`, `code-review`,
`customer-support`, `data-analysis`, `changelog`. Three are distractors:
`brand-voice`, `incident-postmortem`, `sql-migrations`.

Eight is deliberate. It is the count at which the Stigmer harness once began
choosing skills by relevance to the message, describing only the ones a
message's words reached. It now describes every mounted skill on every turn,
and the count stays so that the benchmark's baselines stay comparable.

A skill binds the grade as well as the agent. `repo-conventions` asks for a
row in the package's table-driven test for every fix, and `orders` has no
test, so an agent that follows it adds one. A grader over a Go edit
therefore allows that test, and `multi-part-change` does, the test's run
written to `test-output.txt` by the agent's own `go test`.
`src/benchmark/__tests__/quality-suite.test.ts` pins the skill's rule, the
absent test and the grader together.

## `evals/`

Eleven cases in the plugin-eval format, one directory each, every one a
`case.yaml` with its graders, deterministic first (a regex over the reply or
a file, `tool_used`, `mock_calls`) and an `llm` rubric only for judgement.
They are the quality tasks the benchmark judged before schema v6, moved
here: `memory-recall` left (a try loads no memory), and `refine-over-turns`
is a resumed conversation (`history.jsonl`, one recorded turn; its scaffold
puts the changelog in that turn's state), so it runs on Stigmer only.
`follows-repo-instructions` and `diagnose-sync-log` were added with the two
files above, each a case of its own: a case's score is what the report
keeps, so a check added to an existing case could not be read apart from
it.
`evals/mocks/orders-api/` answers `lookup_order` from the same table the MCP
tool fixture serves (`src/harness/mcp-server.ts`), with the real tool's
`_tools.json`.
