# The working agent's fixture

The files the harness benchmark's working agent is provisioned from
(`src/support/working-agent.ts`): the repository it works in and the skills it
carries. They are data, not code of this package. That is why they live
outside `src/` and `scripts/`, the two trees `tsconfig.json` includes.

Every byte here is part of the instrument. A change to a file moves every
benchmark cell that reads it, the same way a change to
`BARE_AGENT_INSTRUCTIONS` moves the bare cells and the request-shape goldens.
So a change here is reviewed as a change to what is measured.

## `workspace/`

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

The defects are planted on purpose, and the quality tasks
(`scripts/benchmark-harnesses/quality-tasks.yaml`) are graded against them:

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

The module is outside `go.work`, so the repository's `go vet` and `go build`
loops never visit it. Keep it `gofmt -s` clean so the repository's `gofmt -s -w .`
is a no-op here.

## `skills/`

Eight skills, one directory each, pushed to the working agent's organization
under their own names. Five serve a task: `repo-conventions`, `code-review`,
`customer-support`, `data-analysis`, `changelog`. Three are distractors:
`brand-voice`, `incident-postmortem`, `sql-migrations`.

Eight is deliberate. It is the count at which the native harness once began
choosing skills by relevance to the message, describing only the ones a
message's words reached. It now describes every mounted skill on every turn,
as the Cursor harness does, and the count stays so that the benchmark's
baselines stay comparable.
