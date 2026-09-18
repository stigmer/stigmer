# Release hold

**Do not cut a release from `main` while this file exists.** `make release` and
the release procedure both refuse while it is here; a maintainer lifts the hold
by deleting this file in the pull request that lands the last change named
below, and that pull request's review is the review of the lift.

## Why the next release waits

`main` carries the console's Marketplace page and Upload plugin
([#1176](https://github.com/stigmer/stigmer/pull/1176)). That change removes
`MarketplaceBrowser` and `MarketplaceBrowserProps` from `@stigmer/react` and
reshapes `PreparedInstall` in `@stigmer/plugin-package/client`, both published
in v3.17.0, so the next release is a major whatever else it carries.

Two changes must ride that same major rather than force a second one:

- The seedpack's deletion
  ([#1166](https://github.com/stigmer/stigmer/pull/1166)): `stigmer seedpack`,
  `STIGMER_SEEDPACK_ORG` and the `@stigmer/seedpack` package go,
  `stigmer bootstrap` and the official plugin catalogue replace them, and an
  existing install's `assistant` is handed to the plugin in place on its next
  `stigmer up`. It is `feat!` on its own.
- The Go SDK's module path moving from `sdk/go/v3` to `sdk/go/v4`. The Go SDK
  reaches users only through the module proxy resolving the `sdk/go/v<X>` tag,
  and a v4 tag over a `/v3` module path fails `go get` on the path mismatch (the
  v3.0.0 precedent is `94653af18`).

A release cut between these would ship a major without the seedpack's exit and a
Go tag the proxy cannot serve.

## Lifting

Delete this file in the pull request that lands the last of the two changes
above (the Go module path, once #1166 has merged), and say in that release's
notes that `stigmer up` retires an older install's seedpack rows and keeps its
`assistant` agent, and that Go consumers import
`github.com/stigmer/stigmer/sdk/go/v4`.
