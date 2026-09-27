# orders-sync

Syncs orders from the storefront into the fulfilment database every few
minutes, and answers the support desk's order questions.

## Layout

- `duration/`: parses the human-readable durations the config uses ("1h30m").
- `orders/`: the order store queries.
- `syncer/`: the sync loop and its defaults.
- `config/sync.yaml`: the settings the service reads at startup.
- `policies/`: the customer-facing policies the support desk answers from.
- `data/`: exports the team reads in the weekly update.

## Conventions

- Wrap every returned error with context: `fmt.Errorf("parse %q: %w", s, err)`.
- Tests are table-driven, one table per exported function, in the package's
  `_test.go` file.
- No new dependencies: the module uses the standard library only.
- Every exported function has a doc comment that starts with its name.
- Every user-visible change gets a line in `CHANGELOG.md` under
  `## [Unreleased]`, in the Keep a Changelog sections.

Run the tests with `go test ./...`.
