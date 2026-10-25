# The background cells' workspace overlay

Two jobs where running a command in the background pays, for the harness
benchmark's `background-*` cells (`src/benchmark/cells.ts`). `workspace/` is
copied over the working agent's seeded workspace for those cells only, after
the seed (`src/support/working-agent.ts`), so the `orders-sync` module every
other cell and the quality eval read stays byte-identical.

It lives beside `fixtures/working-agent/`, not inside it, because the quality
eval pushes that whole directory as its plugin
(`src/benchmark/quality-eval.ts` `readPluginDirectory`): a file added there
would move the quality arm.

Every byte here is part of the instrument, as in the working agent's fixture.

- `workspace/integration/`: one test, `TestSyncConfig`, that reads
  `config/sync.yaml` and checks three settings, each after waiting 20 seconds
  on a stand-in for the staging service it reaches. The suite takes about a
  minute, under the shell's two-minute default, so an agent without
  background commands can run it in the foreground. Its checks never call
  `ParseMinutes` on a seconds value, so the job's other half (teaching
  `ParseMinutes` seconds) cannot change whether it passes. Go caches a
  passing test, and the workspace is re-seeded byte-identical, so the
  benchmark runs `go clean -testcache` before every attempt of these cells.
- `workspace/cmd/server/`: a standard-library HTTP server on
  `127.0.0.1:8765` whose `GET /minutes?d=` answers through
  `duration.ParseMinutes`: `1h30m` is `90`, and `90s` is a 400 naming the
  unknown unit (the planted defect). It never exits on its own, which is the
  point: without background commands an agent waits out the shell's limit or
  starts it with `&` and leaves it running. The benchmark refuses an attempt
  whose port is already taken, and stops whatever it finds left behind after
  every attempt (`src/benchmark/orphans.ts`).

Like the workspace it lays over, it uses the standard library only and stays
`gofmt -s` clean.
